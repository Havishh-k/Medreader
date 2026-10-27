import { FrameBuffer } from './buffer';
import { analyzeFrame } from './frame-quality';
import { scanBarcode } from './barcode';
import { createWorker } from 'tesseract.js';
import { applyCLAHE, applyOtsuThreshold } from './preprocess';
import { isReadableDocument } from '../core/scan-content';

const TESSERACT_WORKER_URL = new URL('../../node_modules/tesseract.js/dist/worker.min.js', import.meta.url).href;
const TESSERACT_CORE_URL = new URL('../../node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js', import.meta.url).href;
const ENGLISH_DATA_URL = new URL('../../eng.traineddata', import.meta.url).href;
type ScanProfile = 'auto' | 'medicine' | 'document';

export interface OcrResult {
  text: string;
  confidence: number;
  box: [number, number, number, number];
}

class RealOcrWorker {
  onmessage: ((e: MessageEvent) => void) | null = null;
  private worker: Tesseract.Worker | null = null;
  private initPromise: Promise<void>;
  private psm: '3' | '6' | '11';
  private profile: ScanProfile;
  
  constructor(psm: '3' | '6' | '11' = '11', profile: ScanProfile = 'auto') {
    this.psm = psm;
    this.profile = profile;
    this.initPromise = this.init();
  }
  
  async init() {
    const response = await fetch(ENGLISH_DATA_URL);
    if (!response.ok) throw new Error(`Failed to load English OCR data (${response.status})`);

    this.worker = await createWorker([{ code: 'eng', data: new Uint8Array(await response.arrayBuffer()) }], undefined, {
      workerPath: TESSERACT_WORKER_URL,
      corePath: TESSERACT_CORE_URL,
      workerBlobURL: true,
    });
    await this.worker.setParameters({
      tessedit_pageseg_mode: this.psm as any,
      preserve_interword_spaces: '1',
      user_defined_dpi: '300',
    });
    this.onmessage?.({ data: { type: 'init_done' } } as MessageEvent);
  }
  
  async postMessage(msg: any) {
    if (msg.type === 'process') {
      const bmp = msg.payload.bitmap as ImageBitmap | undefined;
      try {
        await this.initPromise;
        if (!this.worker || !bmp) {
          this.onmessage?.({ data: { type: 'process_done', id: msg.payload.id, results: [] } } as MessageEvent);
          return;
        }

        const firstProfile = this.profile === 'document' ? 'document' : 'medicine';
        const first = await this.recognize(bmp, firstProfile);
        const results = [first];

        // Reports need a full-page, layout-aware pass. Run it only when the fast
        // medicine pass sees enough text to avoid doubling every scan's latency.
        if (this.profile === 'auto' && isReadableDocument(first.text)) {
          results.push(await this.recognize(bmp, 'document'));
        }

        this.onmessage?.({
          data: {
            type: 'process_done',
            id: msg.payload.id,
            results: results.filter(result => result.text),
          }
        } as MessageEvent);
      } catch (err) {
        console.error("[OCR] Tesseract err:", err);
        this.onmessage?.({ data: { type: 'process_error', id: msg.payload.id, error: String(err) } } as MessageEvent);
      } finally {
        bmp?.close();
      }
    }
  }

  private async recognize(bmp: ImageBitmap, profile: 'medicine' | 'document'): Promise<OcrResult> {
    let canvas: OffscreenCanvas;
    let ctx: OffscreenCanvasRenderingContext2D;

    if (profile === 'document') {
      const scale = 1.5;
      canvas = new OffscreenCanvas(Math.round(bmp.width * scale), Math.round(bmp.height * scale));
      ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
      applyOtsuThreshold(ctx, canvas.width, canvas.height);
    } else {
      const sw = bmp.width * 0.75;
      const sh = bmp.height * 0.75;
      const cropped = await createImageBitmap(bmp, bmp.width * 0.125, bmp.height * 0.125, sw, sh);
      canvas = new OffscreenCanvas(Math.round(cropped.width * 2), Math.round(cropped.height * 2));
      ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(cropped, 0, 0, canvas.width, canvas.height);
      cropped.close();
      applyCLAHE(ctx, canvas.width, canvas.height, 8, 3.0);
    }

    await this.worker!.setParameters({ tessedit_pageseg_mode: (profile === 'document' ? '3' : this.psm) as any });
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    const { data: { text, confidence } } = await this.worker!.recognize(blob);
    console.log(`[OCR] ${profile} pass:`, JSON.stringify(text.trim()), 'confidence:', confidence);
    return { text: text.trim(), confidence: confidence / 100, box: [0, 0, bmp.width, bmp.height] };
  }

  private toGrayscale(ctx: OffscreenCanvasRenderingContext2D, width: number, height: number): void {
    const imgData = ctx.getImageData(0, 0, width, height);
    const d = imgData.data;
    for (let i = 0; i < d.length; i += 4) {
      const luma = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000;
      d[i] = luma;
      d[i + 1] = luma;
      d[i + 2] = luma;
    }
    ctx.putImageData(imgData, 0, 0);
  }
  
  async terminate() {
    if (this.worker) {
      await this.worker.terminate();
      this.worker = null;
    }
  }
}

export class ExtractionPipeline {
  private buffer = new FrameBuffer(6);
  private worker: RealOcrWorker;
  private pendingCount = 0;
  private resolveExtraction: ((results: { texts: string[]; barcodes: string[] }) => void) | null = null;
  
  private finalTexts: string[] = [];
  private finalBarcodes: string[] = [];

  constructor(psmMode: '3' | '6' | '11' = '11', profile: ScanProfile = 'auto') {
    this.worker = new RealOcrWorker(psmMode, profile);
    this.worker.onmessage = (e) => this.handleWorkerMessage(e);
  }

  pushFrame(bitmap: ImageBitmap) {
    const quality = analyzeFrame(bitmap);
    if (quality.composite > 0.1 || quality.sharpness > 25) {
      this.buffer.add(bitmap, quality);
    } else {
      bitmap.close();
    }
  }

  async extractBuffered(): Promise<{ texts: string[]; barcodes: string[] }> {
    this.finalTexts = [];
    this.finalBarcodes = [];
    const frames = this.buffer.takeFrames();
    
    if (frames.length === 0) return { texts: [], barcodes: [] };
    
    const best = frames[0];
    const rest = frames.slice(1);
    rest.forEach(f => f.bitmap.close());

    return new Promise(async (resolve) => {
      this.resolveExtraction = resolve;
      this.pendingCount = 1;
      
      try {
        // Finish native barcode access before OCR closes the shared ImageBitmap.
        const barcodes = await scanBarcode(best.bitmap);
        barcodes.forEach(barcode => this.finalBarcodes.push(barcode.rawValue));
        
        console.log('[Pipeline] Sending best frame for OCR, quality:', best.quality.composite.toFixed(3));
        this.worker.postMessage({
          type: 'process',
          payload: { id: 0, bitmap: best.bitmap }
        });
        
      } catch (err) {
        console.error("Extraction failed:", err);
        best.bitmap.close();
        if (this.resolveExtraction) {
          this.resolveExtraction({ texts: [], barcodes: [] });
          this.resolveExtraction = null;
        }
      }
    });
  }
  
  private handleWorkerMessage(e: MessageEvent) {
    const { type, results } = e.data;
    
    if (type === 'process_error') {
      // OCR processing failed — resolve with empty results so the loop continues
      console.warn('[Pipeline] OCR process error:', e.data.error);
      this.pendingCount--;
      if (this.pendingCount <= 0 && this.resolveExtraction) {
        this.resolveExtraction({ texts: [], barcodes: [] });
        this.resolveExtraction = null;
      }
      return;
    }
    
    if (type === 'process_done') {
      const ocr = results as OcrResult[];
      ocr.forEach(r => this.finalTexts.push(r.text));
      
      this.pendingCount--;
      if (this.pendingCount <= 0 && this.resolveExtraction) {
        this.resolveExtraction({
          texts: this.finalTexts,
          barcodes: this.finalBarcodes
        });
        this.resolveExtraction = null;
      }
    }
  }
  
  destroy() {
    this.buffer.clear();
    this.worker.terminate();
  }
}
