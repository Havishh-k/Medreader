import { FrameBuffer } from './buffer';
import { analyzeFrame } from './frame-quality';
import { scanBarcode } from './barcode';
import type { OcrResult } from '../workers/ocr.worker';
import { createWorker } from 'tesseract.js';
import { cropROI, applyUnsharpMask, applyCLAHE, applyOtsuThreshold } from './preprocess';

const TESSERACT_WORKER_URL = new URL('../../node_modules/tesseract.js/dist/worker.min.js', import.meta.url).href;
const TESSERACT_CORE_URL = new URL('../../node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js', import.meta.url).href;
const ENGLISH_DATA_URL = new URL('../../eng.traineddata', import.meta.url).href;

class RealOcrWorker {
  onmessage: ((e: MessageEvent) => void) | null = null;
  private worker: Tesseract.Worker | null = null;
  private initPromise: Promise<void>;
  private psm: '3' | '6' | '11';
  private isDocumentMode: boolean;
  
  constructor(psm: '3' | '6' | '11' = '3', isDocumentMode: boolean = false) {
    this.psm = psm;
    this.isDocumentMode = isDocumentMode;
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

        let canvas: OffscreenCanvas;
        let ctx: OffscreenCanvasRenderingContext2D;

        if (this.isDocumentMode) {
          // ─── Document Mode Pipeline ───
          // 1.5x scale + Otsu Global Thresholding for high-contrast black/white document scan
          const scale = 1.5;
          canvas = new OffscreenCanvas(bmp.width * scale, bmp.height * scale);
          ctx = canvas.getContext('2d', { willReadFrequently: true })!;
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
          
          applyOtsuThreshold(ctx, canvas.width, canvas.height);
        } else {
          // ─── Medicine Mode Pipeline ───
          // Center 75% crop (matches the visual framing guide)
          const sw = bmp.width * 0.75;
          const sh = bmp.height * 0.75;
          const sx = bmp.width * 0.125;
          const sy = bmp.height * 0.125;
          const cropped = await createImageBitmap(bmp, sx, sy, sw, sh);
          
          // 2.0x upscale with high-quality smoothing to boost font size into Tesseract LSTM sweet spot (35-45px)
          const scale = 2.0;
          canvas = new OffscreenCanvas(Math.round(cropped.width * scale), Math.round(cropped.height * scale));
          ctx = canvas.getContext('2d', { willReadFrequently: true })!;
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(cropped, 0, 0, canvas.width, canvas.height);
          cropped.close();
          
          // Local contrast normalization for colored medicine packaging (e.g. blue-on-cyan, red-on-white)
          applyCLAHE(ctx, canvas.width, canvas.height, 8, 3.0);
        }
        
        const blob = await canvas.convertToBlob({ type: 'image/png' });

        const { data: { text, confidence } } = await this.worker.recognize(blob);
        console.log('[OCR] Tesseract Recognized text:', JSON.stringify(text.trim()), 'confidence:', confidence);
        this.onmessage?.({
          data: {
            type: 'process_done',
            id: msg.payload.id,
            results: [{ text: text.trim(), confidence: confidence / 100, box: [0, 0, bmp.width, bmp.height] }]
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

export type OcrEngine = 'tesseract' | 'onnx';

export class ExtractionPipeline {
  private buffer = new FrameBuffer(6);
  private worker: Worker | RealOcrWorker;
  private pendingCount = 0;
  private resolveExtraction: ((results: { texts: string[]; barcodes: string[] }) => void) | null = null;
  
  private finalTexts: string[] = [];
  private finalBarcodes: string[] = [];
  private engine: OcrEngine;
  private psmMode: '3' | '6' | '11';
  private isDocumentMode: boolean;

  constructor(engine: OcrEngine = 'tesseract', psmMode: '3' | '6' | '11' = '3', isDocumentMode: boolean = false) {
    this.engine = engine;
    this.psmMode = psmMode;
    this.isDocumentMode = isDocumentMode;
    if (engine === 'tesseract') {
      this.worker = new RealOcrWorker(psmMode, isDocumentMode);
    } else {
      this.worker = new Worker(new URL('../workers/ocr.worker.ts', import.meta.url), { type: 'module' });
    }
    
    this.worker.onmessage = (e) => this.handleWorkerMessage(e);
    // Don't post 'init' for RealOcrWorker, it inits itself.
    if (engine === 'onnx') {
      this.worker.postMessage({ type: 'init' });
    }
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
        // Run barcode scanner
        scanBarcode(best.bitmap).then(barcodes => {
          barcodes.forEach(b => this.finalBarcodes.push(b.rawValue));
        }).catch(e => console.error("Barcode err:", e));
        
        console.log('[Pipeline] Sending best frame for OCR, quality:', best.quality.composite.toFixed(3));
        (this as any)._extractionStartTime = performance.now();
        
        if (this.engine === 'onnx') {
           // Preprocess before ONNX (Phase 1C, 1A)
           // ONNX does its own resizing to 640x640, so just crop and sharpen
           const cropped = await cropROI(best.bitmap);
           const canvas = new OffscreenCanvas(cropped.width, cropped.height);
           const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
           ctx.drawImage(cropped, 0, 0);
           applyUnsharpMask(ctx, canvas.width, canvas.height);
           
           // Extract bitmap for zero-copy transfer
           const preprocessedBitmap = canvas.transferToImageBitmap();
           
           // Transferable ImageBitmap for zero-copy
           this.worker.postMessage({
             type: 'process',
             payload: { id: 0, bitmap: preprocessedBitmap }
           }, [preprocessedBitmap]); // Transfer ownership
           
           cropped.close();
           // best.bitmap is left unclosed since it might be needed if we didn't crop, but we did. We should close it if not transferred.
           best.bitmap.close();
        } else {
           // Tesseract handles its own preprocessing in RealOcrWorker
           this.worker.postMessage({
             type: 'process',
             payload: { id: 0, bitmap: best.bitmap }
           });
        }
        
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
    
    if (type === 'init_error') {
      // ONNX models failed to load — swap to Tesseract immediately
      console.warn('[Pipeline] ONNX init failed, falling back to Tesseract.');
      this.engine = 'tesseract';
      this.worker.terminate();
      this.worker = new RealOcrWorker(this.psmMode, this.isDocumentMode);
      this.worker.onmessage = (ev) => this.handleWorkerMessage(ev);
      return;
    }
    
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
      const duration = performance.now() - (this as any)._extractionStartTime;
      const ocr = results as OcrResult[];
      ocr.forEach(r => this.finalTexts.push(r.text));
      
      this.pendingCount--;
      if (this.pendingCount <= 0 && this.resolveExtraction) {
        // Phase 2 Latency Gate: Fall back to Tesseract if ONNX is too slow (> 1.5s)
        if (this.engine === 'onnx' && duration > 1500 && !(this as any)._hasCheckedLatency) {
          console.warn(`[OCR] ONNX latency was ${duration.toFixed(0)}ms (limit 1500ms). Falling back to Tesseract.`);
          this.engine = 'tesseract';
          this.worker.terminate();
          this.worker = new RealOcrWorker(this.psmMode, this.isDocumentMode);
          this.worker.onmessage = (ev) => this.handleWorkerMessage(ev);
        }
        (this as any)._hasCheckedLatency = true;

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
    if (this.worker instanceof RealOcrWorker) {
      this.worker.terminate();
    } else if (this.worker instanceof Worker) {
      this.worker.terminate();
    }
    // Task 2.2 Memory Audit: Hardening GC by releasing reference
    (this as any).worker = null;
  }
}
