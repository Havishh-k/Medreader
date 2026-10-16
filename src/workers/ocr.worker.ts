import * as ort from 'onnxruntime-web';

// Prefer WebGPU if available, fall back to WASM
ort.env.wasm.wasmPaths = '/node_modules/onnxruntime-web/dist/';

let detSession: ort.InferenceSession | null = null;
let recSession: ort.InferenceSession | null = null;
let dictionary: string[] = [];

export interface OcrResult {
  text: string;
  confidence: number;
  box: [number, number, number, number]; // x, y, w, h
}

// ─── Initialization ─────────────────────────────────────────────

async function initModels() {
  if (detSession && recSession) return;

  try {
    const providers: string[] = [];
    // @ts-ignore — navigator.gpu check
    if (typeof navigator !== 'undefined' && 'gpu' in navigator) providers.push('webgpu');
    providers.push('wasm');

    detSession = await ort.InferenceSession.create('/models/det.onnx', { executionProviders: providers });
    recSession = await ort.InferenceSession.create('/models/rec.onnx', { executionProviders: providers });

    const dictResp = await fetch('/models/dict.txt');
    const dictText = await dictResp.text();
    dictionary = dictText.split('\n').map(l => l.trim()).filter(l => l.length > 0);

    console.log('[OCR Worker] Models loaded. Dict size:', dictionary.length, 'Providers:', providers);
    self.postMessage({ type: 'init_done' });
  } catch (err) {
    const errStr = String(err);
    if (errStr.includes('404') || errStr.includes('not found') || errStr.includes('Failed to fetch') || errStr.includes('NetworkError')) {
      console.warn('[OCR Worker] ONNX models not found in /models/. The app will fall back to Tesseract OCR engine. To enable ONNX scene-text recognition, place det.onnx, rec.onnx, and dict.txt in public/models/');
    } else {
      console.error('[OCR Worker] Init failed:', err);
    }
    self.postMessage({ type: 'init_error', error: errStr });
  }
}

// ─── Detection (DBNet) ──────────────────────────────────────────

const DET_SIZE = 640;
const DET_MEAN = [0.485, 0.456, 0.406];
const DET_STD = [0.229, 0.224, 0.225];
const DET_THRESH = 0.3;
const DET_MIN_BOX_SIZE = 5;

function preprocessForDetection(imgData: ImageData): ort.Tensor {
  const pixels = DET_SIZE * DET_SIZE;
  const float32 = new Float32Array(3 * pixels);
  const data = imgData.data;

  for (let i = 0; i < pixels; i++) {
    const r = data[i * 4] / 255.0;
    const g = data[i * 4 + 1] / 255.0;
    const b = data[i * 4 + 2] / 255.0;
    float32[0 * pixels + i] = (r - DET_MEAN[0]) / DET_STD[0];
    float32[1 * pixels + i] = (g - DET_MEAN[1]) / DET_STD[1];
    float32[2 * pixels + i] = (b - DET_MEAN[2]) / DET_STD[2];
  }

  return new ort.Tensor('float32', float32, [1, 3, DET_SIZE, DET_SIZE]);
}

interface BBox { x: number; y: number; w: number; h: number; }

function extractBoxes(probMap: Float32Array, origW: number, origH: number): BBox[] {
  // Binarize
  const binary = new Uint8Array(DET_SIZE * DET_SIZE);
  for (let i = 0; i < binary.length; i++) {
    binary[i] = probMap[i] > DET_THRESH ? 1 : 0;
  }

  // Connected components via flood fill
  const labels = new Int32Array(binary.length);
  let nextLabel = 1;
  const componentBounds = new Map<number, { minX: number; maxX: number; minY: number; maxY: number }>();

  for (let y = 0; y < DET_SIZE; y++) {
    for (let x = 0; x < DET_SIZE; x++) {
      const idx = y * DET_SIZE + x;
      if (binary[idx] === 1 && labels[idx] === 0) {
        const label = nextLabel++;
        const bounds = { minX: x, maxX: x, minY: y, maxY: y };
        // BFS flood fill
        const queue = [idx];
        labels[idx] = label;
        while (queue.length > 0) {
          const ci = queue.pop()!;
          const cx = ci % DET_SIZE;
          const cy = (ci - cx) / DET_SIZE;
          bounds.minX = Math.min(bounds.minX, cx);
          bounds.maxX = Math.max(bounds.maxX, cx);
          bounds.minY = Math.min(bounds.minY, cy);
          bounds.maxY = Math.max(bounds.maxY, cy);
          // 4-connected neighbors
          for (const [nx, ny] of [[cx-1,cy],[cx+1,cy],[cx,cy-1],[cx,cy+1]]) {
            if (nx >= 0 && nx < DET_SIZE && ny >= 0 && ny < DET_SIZE) {
              const ni = ny * DET_SIZE + nx;
              if (binary[ni] === 1 && labels[ni] === 0) {
                labels[ni] = label;
                queue.push(ni);
              }
            }
          }
        }
        componentBounds.set(label, bounds);
      }
    }
  }

  // Scale boxes back to original image coordinates
  const scaleX = origW / DET_SIZE;
  const scaleY = origH / DET_SIZE;
  const boxes: BBox[] = [];

  for (const bounds of componentBounds.values()) {
    const w = bounds.maxX - bounds.minX;
    const h = bounds.maxY - bounds.minY;
    if (w < DET_MIN_BOX_SIZE || h < DET_MIN_BOX_SIZE) continue;
    boxes.push({
      x: Math.round(bounds.minX * scaleX),
      y: Math.round(bounds.minY * scaleY),
      w: Math.round(w * scaleX),
      h: Math.round(h * scaleY),
    });
  }

  // Sort by area descending, take top 10
  boxes.sort((a, b) => (b.w * b.h) - (a.w * a.h));
  return boxes.slice(0, 10);
}

// ─── Recognition (SVTR) ─────────────────────────────────────────

const REC_H = 48;
const REC_W = 320;

function preprocessForRecognition(imgData: ImageData): ort.Tensor {
  const pixels = REC_H * REC_W;
  const float32 = new Float32Array(3 * pixels);
  const data = imgData.data;

  for (let i = 0; i < pixels; i++) {
    const r = data[i * 4] / 255.0;
    const g = data[i * 4 + 1] / 255.0;
    const b = data[i * 4 + 2] / 255.0;
    float32[0 * pixels + i] = (r - 0.5) / 0.5;
    float32[1 * pixels + i] = (g - 0.5) / 0.5;
    float32[2 * pixels + i] = (b - 0.5) / 0.5;
  }

  return new ort.Tensor('float32', float32, [1, 3, REC_H, REC_W]);
}

function ctcDecode(logits: Float32Array, timesteps: number, numClasses: number): { text: string; confidence: number } {
  let result = '';
  let lastIdx = 0;
  let totalConf = 0;
  let charCount = 0;

  for (let t = 0; t < timesteps; t++) {
    let maxIdx = 0;
    let maxVal = -Infinity;
    for (let c = 0; c < numClasses; c++) {
      const val = logits[t * numClasses + c];
      if (val > maxVal) { maxVal = val; maxIdx = c; }
    }
    if (maxIdx !== 0 && maxIdx !== lastIdx) {
      if (maxIdx - 1 < dictionary.length) {
        result += dictionary[maxIdx - 1];
        // Approximate confidence from logit via sigmoid
        totalConf += 1.0 / (1.0 + Math.exp(-maxVal));
        charCount++;
      }
    }
    lastIdx = maxIdx;
  }

  return { text: result, confidence: charCount > 0 ? totalConf / charCount : 0 };
}

// ─── Main Pipeline ──────────────────────────────────────────────

// Reusable canvases to avoid GC
let detCanvas: OffscreenCanvas | null = null;
let detCtx: OffscreenCanvasRenderingContext2D | null = null;
let recCanvas: OffscreenCanvas | null = null;
let recCtx: OffscreenCanvasRenderingContext2D | null = null;
let srcCanvas: OffscreenCanvas | null = null;
let srcCtx: OffscreenCanvasRenderingContext2D | null = null;

async function processFrame(bitmap: ImageBitmap): Promise<OcrResult[]> {
  if (!detSession || !recSession) throw new Error('Models not loaded');

  const origW = bitmap.width;
  const origH = bitmap.height;
  const startTime = performance.now();

  // Draw source bitmap onto a reusable canvas
  if (!srcCanvas || srcCanvas.width !== origW || srcCanvas.height !== origH) {
    srcCanvas = new OffscreenCanvas(origW, origH);
    srcCtx = srcCanvas.getContext('2d', { willReadFrequently: true })!;
  }
  srcCtx!.drawImage(bitmap, 0, 0);

  // ── Step 1: Detection ──
  if (!detCanvas) {
    detCanvas = new OffscreenCanvas(DET_SIZE, DET_SIZE);
    detCtx = detCanvas.getContext('2d', { willReadFrequently: true })!;
  }
  detCtx!.drawImage(bitmap, 0, 0, DET_SIZE, DET_SIZE);
  const detImgData = detCtx!.getImageData(0, 0, DET_SIZE, DET_SIZE);
  const detTensor = preprocessForDetection(detImgData);

  // Get the first input name dynamically
  const detInputName = detSession.inputNames[0];
  const detOutput = await detSession.run({ [detInputName]: detTensor });
  const detOutputName = detSession.outputNames[0];
  const probMap = detOutput[detOutputName].data as Float32Array;

  const boxes = extractBoxes(probMap, origW, origH);
  console.log(`[OCR Worker] Detection found ${boxes.length} text regions in ${(performance.now() - startTime).toFixed(0)}ms`);

  if (boxes.length === 0) return [];

  // ── Step 2: Recognition on each box ──
  if (!recCanvas) {
    recCanvas = new OffscreenCanvas(REC_W, REC_H);
    recCtx = recCanvas.getContext('2d', { willReadFrequently: true })!;
  }

  const results: OcrResult[] = [];
  // Only recognize top 3 largest boxes for performance
  const topBoxes = boxes.slice(0, 3);

  for (const box of topBoxes) {
    // Crop the text region from the source image
    // Add 2px padding to avoid cutting off text edges
    const pad = 2;
    const cx = Math.max(0, box.x - pad);
    const cy = Math.max(0, box.y - pad);
    const cw = Math.min(origW - cx, box.w + pad * 2);
    const ch = Math.min(origH - cy, box.h + pad * 2);

    // Resize to REC_W × REC_H, maintaining aspect ratio with right-padding
    const aspectRatio = cw / ch;
    const targetW = Math.min(REC_W, Math.round(REC_H * aspectRatio));

    recCtx!.fillStyle = '#000'; // Pad with black
    recCtx!.fillRect(0, 0, REC_W, REC_H);
    recCtx!.drawImage(srcCanvas!, cx, cy, cw, ch, 0, 0, targetW, REC_H);

    const recImgData = recCtx!.getImageData(0, 0, REC_W, REC_H);
    const recTensor = preprocessForRecognition(recImgData);

    const recInputName = recSession.inputNames[0];
    const recOutput = await recSession.run({ [recInputName]: recTensor });
    const recOutputName = recSession.outputNames[0];
    const logits = recOutput[recOutputName].data as Float32Array;
    const shape = recOutput[recOutputName].dims; // [1, T, num_classes]
    const timesteps = shape[1] as number;
    const numClasses = shape[2] as number;

    const { text, confidence } = ctcDecode(logits, timesteps, numClasses);

    if (text.length > 0) {
      results.push({
        text,
        confidence,
        box: [box.x, box.y, box.w, box.h],
      });
    }
  }

  console.log(`[OCR Worker] Full pipeline: ${results.length} texts in ${(performance.now() - startTime).toFixed(0)}ms`);
  return results;
}

// ─── Message Handler ────────────────────────────────────────────

self.onmessage = async (e: MessageEvent) => {
  const { type, payload } = e.data;

  if (type === 'init') {
    await initModels();
  } else if (type === 'process') {
    try {
      // Accept either ImageBitmap or ImageData
      let bitmap: ImageBitmap;
      if (payload.bitmap) {
        bitmap = payload.bitmap;
      } else if (payload.imgData) {
        bitmap = await createImageBitmap(payload.imgData);
      } else {
        self.postMessage({ type: 'process_done', id: payload.id, results: [] });
        return;
      }
      const results = await processFrame(bitmap);
      self.postMessage({ type: 'process_done', id: payload.id, results });
    } catch (err) {
      console.error('[OCR Worker] Process error:', err);
      self.postMessage({ type: 'process_error', id: payload.id, error: String(err) });
    }
  }
};
