export interface FrameQuality {
  sharpness: number;   // Laplacian variance (higher = sharper)
  glare: number;       // Fraction of overexposed pixels (0.0 to 1.0)
  centering: number;   // Distance from center (-1.0 to 1.0)
  coverage: number;    // Fraction of screen with high edge density
  composite: number;   // Overall score (0.0 to 1.0)
  luminance: number;   // Average frame luminance (0 to 255) for low-light detection
}

// Reusable canvas for analysis to avoid GC thrashing
const ANALYSIS_WIDTH = 320;
const ANALYSIS_HEIGHT = 240;
let canvas: OffscreenCanvas | HTMLCanvasElement | null = null;
let ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null = null;

function getContext(): OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D {
  if (!ctx) {
    if (typeof OffscreenCanvas !== 'undefined') {
      canvas = new OffscreenCanvas(ANALYSIS_WIDTH, ANALYSIS_HEIGHT);
      ctx = canvas.getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D;
    } else {
      canvas = document.createElement('canvas');
      canvas.width = ANALYSIS_WIDTH;
      canvas.height = ANALYSIS_HEIGHT;
      ctx = canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
    }
  }
  return ctx;
}

export function analyzeFrame(bitmap: ImageBitmap): FrameQuality {
  const context = getContext();
  context.drawImage(bitmap, 0, 0, ANALYSIS_WIDTH, ANALYSIS_HEIGHT);
  const imgData = context.getImageData(0, 0, ANALYSIS_WIDTH, ANALYSIS_HEIGHT);
  const data = imgData.data;
  
  let mean = 0;
  let glareCount = 0;
  const len = data.length;
  const numPixels = len / 4;
  
  // Grayscale conversion and glare check
  const gray = new Uint8ClampedArray(numPixels);
  for (let i = 0, j = 0; i < len; i += 4, j++) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    
    // Luminance
    const luma = (r * 299 + g * 587 + b * 114) / 1000;
    gray[j] = luma;
    mean += luma;
    
    // Glare: pixels near pure white
    if (r > 240 && g > 240 && b > 240) {
      glareCount++;
    }
  }
  mean /= numPixels;
  
  const glare = glareCount / numPixels;
  
  // Laplacian variance (sharpness)
  // 3x3 kernel: [0, 1, 0, 1, -4, 1, 0, 1, 0]
  let lapMean = 0;
  const lap = new Int32Array(numPixels);
  let edgesCount = 0;
  let sumX = 0, sumY = 0;

  for (let y = 1; y < ANALYSIS_HEIGHT - 1; y++) {
    for (let x = 1; x < ANALYSIS_WIDTH - 1; x++) {
      const idx = y * ANALYSIS_WIDTH + x;
      const val = 
        gray[idx - ANALYSIS_WIDTH] + // top
        gray[idx - 1] +              // left
        gray[idx + 1] +              // right
        gray[idx + ANALYSIS_WIDTH] - // bottom
        4 * gray[idx];               // center
        
      lap[idx] = val;
      lapMean += val;
      
      // Edge threshold for coverage/centering — 15 is sensitive enough to pick
      // up medicine label text at 320×240 analysis resolution.
      if (Math.abs(val) > 15) {
        edgesCount++;
        sumX += x;
        sumY += y;
      }
    }
  }
  
  const lapPixels = (ANALYSIS_WIDTH - 2) * (ANALYSIS_HEIGHT - 2);
  lapMean /= lapPixels;
  
  let variance = 0;
  for (let i = 0; i < numPixels; i++) {
    // only inner pixels were calculated, but others are 0, which biases variance slightly. 
    // it's fine for our heuristic.
    variance += (lap[i] - lapMean) * (lap[i] - lapMean);
  }
  variance /= lapPixels;

  // Center of mass of edges
  let centeringX = 0; // -1 to 1 (left to right)
  if (edgesCount > 0) {
    const cx = sumX / edgesCount;
    centeringX = (cx / ANALYSIS_WIDTH) * 2 - 1.0;
  }
  
  const coverage = edgesCount / lapPixels;

  // Composite score (heuristic weighting)
  // Sharpness is critical, glare is bad, coverage should be adequate
  // Variance typically ranges 0 to 1000+, map to 0-1
  const normSharpness = Math.min(variance / 500, 1.0);
  const composite = (normSharpness * 0.5) + (Math.max(0, 1 - glare * 5) * 0.3) + (Math.min(coverage * 2, 1) * 0.2);

  return {
    sharpness: variance,
    glare,
    centering: centeringX,
    coverage,
    composite,
    luminance: mean
  };
}
