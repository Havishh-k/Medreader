/**
 * Preprocessing functions for OCR pipeline.
 * These are used to prepare camera frames before sending them to OCR models (like Tesseract or ONNX).
 */

/**
 * Crops the image bitmap to the center 60% of the frame.
 * This corresponds to the visual framing guide rectangle that the user targets.
 * 
 * @param bitmap The source image bitmap
 * @returns A promise that resolves to the cropped ImageBitmap
 */
export async function cropROI(bitmap: ImageBitmap): Promise<ImageBitmap> {
    // Calculate 80% width and height (10% padding on each side)
    const sw = bitmap.width * 0.8;
    const sh = bitmap.height * 0.8;
    
    // Calculate starting X and Y to center the crop
    const sx = bitmap.width * 0.1;
    const sy = bitmap.height * 0.1;
    
    // Use createImageBitmap for zero-copy cropping
    return createImageBitmap(bitmap, sx, sy, sw, sh);
}

/**
 * Applies a 3x3 unsharp mask convolution kernel to an offscreen canvas.
 * Kernel used: [0, -1, 0, -1, 5, -1, 0, -1, 0]
 * Operates in-place on the canvas context.
 * 
 * @param ctx The OffscreenCanvasRenderingContext2D
 * @param width Canvas width
 * @param height Canvas height
 */
export function applyUnsharpMask(ctx: OffscreenCanvasRenderingContext2D, width: number, height: number): void {
    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;
    
    // The unsharp mask kernel
    const kernel = [
        0, -1,  0,
       -1,  5, -1,
        0, -1,  0
    ];
    
    // Use Uint8ClampedArray for automatic clamping of values to [0, 255]
    // Need a copy of data to read from while writing to a new array
    const output = new Uint8ClampedArray(data.length);
    
    // Iterate over all pixels
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const dstOff = (y * width + x) * 4;
            let r = 0, g = 0, b = 0;
            
            // Apply convolution
            for (let cy = -1; cy <= 1; cy++) {
                for (let cx = -1; cx <= 1; cx++) {
                    // Handle edge cases by clamping coordinates to bounds
                    const scy = Math.min(Math.max(y + cy, 0), height - 1);
                    const scx = Math.min(Math.max(x + cx, 0), width - 1);
                    
                    const srcOff = (scy * width + scx) * 4;
                    const weight = kernel[(cy + 1) * 3 + (cx + 1)];
                    
                    r += data[srcOff] * weight;
                    g += data[srcOff + 1] * weight;
                    b += data[srcOff + 2] * weight;
                }
            }
            
            // Set clamped values to output (Uint8ClampedArray handles clamping automatically)
            output[dstOff] = r;
            output[dstOff + 1] = g;
            output[dstOff + 2] = b;
            // Preserve original alpha
            output[dstOff + 3] = data[dstOff + 3];
        }
    }
    
    // Write back the convolved pixels
    for (let i = 0; i < data.length; i++) {
        data[i] = output[i];
    }
    ctx.putImageData(imageData, 0, 0);
}

/**
 * Applies Contrast Limited Adaptive Histogram Equalization (CLAHE).
 * Enhances local contrast, helping to distinguish text from backgrounds in uneven lighting.
 * Operates in-place on the canvas context and writes back a grayscale image (rgb channels equal).
 * 
 * @param ctx The OffscreenCanvasRenderingContext2D
 * @param width Canvas width
 * @param height Canvas height
 * @param tileGridSize The number of tiles per row/col (default 8)
 * @param clipLimit Limit for contrast clipping (default 3.0)
 */
export function applyCLAHE(
    ctx: OffscreenCanvasRenderingContext2D,
    width: number,
    height: number,
    tileGridSize: number = 8,
    clipLimit: number = 3.0
): void {
    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;

    // 1. Convert to grayscale luminance
    const gray = new Uint8Array(width * height);
    for (let i = 0; i < width * height; i++) {
        const r = data[i * 4];
        const g = data[i * 4 + 1];
        const b = data[i * 4 + 2];
        // Standard luminance formula
        gray[i] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    }

    const tileW = Math.ceil(width / tileGridSize);
    const tileH = Math.ceil(height / tileGridSize);

    // 2. Compute histograms and CDFs for each tile
    // CDFs stored as Float32Array (256 values per tile)
    const cdfs = new Float32Array(tileGridSize * tileGridSize * 256);

    for (let ty = 0; ty < tileGridSize; ty++) {
        for (let tx = 0; tx < tileGridSize; tx++) {
            const startX = tx * tileW;
            const startY = ty * tileH;
            // Handle edge tiles which might be smaller
            const endX = Math.min(startX + tileW, width);
            const endY = Math.min(startY + tileH, height);
            
            const w = endX - startX;
            const h = endY - startY;
            const numPixels = w * h;
            
            // Compute histogram for the tile
            const hist = new Int32Array(256);
            for (let y = startY; y < endY; y++) {
                for (let x = startX; x < endX; x++) {
                    const val = gray[y * width + x];
                    hist[val]++;
                }
            }
            
            // Clip histogram
            let clipTarget = Math.round(clipLimit * (numPixels / 256));
            if (clipTarget < 1) clipTarget = 1;
            
            let excess = 0;
            for (let i = 0; i < 256; i++) {
                if (hist[i] > clipTarget) {
                    excess += hist[i] - clipTarget;
                    hist[i] = clipTarget;
                }
            }
            
            // Redistribute excess uniformly
            const binIncr = Math.floor(excess / 256);
            let upper = excess % 256;
            
            for (let i = 0; i < 256; i++) {
                hist[i] += binIncr;
            }
            
            // Distribute remaining excess evenly spaced
            if (upper > 0) {
                const step = Math.max(1, Math.floor(256 / upper));
                for (let i = 0; i < 256 && upper > 0; i += step) {
                    hist[i]++;
                    upper--;
                }
            }
            
            // Compute Cumulative Distribution Function (CDF)
            const cdfOffset = (ty * tileGridSize + tx) * 256;
            let sum = 0;
            for (let i = 0; i < 256; i++) {
                sum += hist[i];
                // Normalize CDF to [0, 1] range
                cdfs[cdfOffset + i] = sum / numPixels;
            }
        }
    }

    // 3. Bilinear Interpolation
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const val = gray[y * width + x];
            
            // Map pixel to tile coordinates (center of tiles is integer + 0.5)
            const txRaw = (x + 0.5) / tileW - 0.5;
            const tyRaw = (y + 0.5) / tileH - 0.5;
            
            let tx1 = Math.floor(txRaw);
            let ty1 = Math.floor(tyRaw);
            let tx2 = tx1 + 1;
            let ty2 = ty1 + 1;
            
            // Fractional distances for interpolation
            const px = txRaw - tx1;
            const py = tyRaw - ty1;
            
            // Boundary handling - clamp to valid tile indices
            tx1 = Math.max(0, Math.min(tx1, tileGridSize - 1));
            ty1 = Math.max(0, Math.min(ty1, tileGridSize - 1));
            tx2 = Math.max(0, Math.min(tx2, tileGridSize - 1));
            ty2 = Math.max(0, Math.min(ty2, tileGridSize - 1));
            
            // Get CDF values from the 4 nearest tiles
            const cdf11 = cdfs[(ty1 * tileGridSize + tx1) * 256 + val];
            const cdf12 = cdfs[(ty1 * tileGridSize + tx2) * 256 + val];
            const cdf21 = cdfs[(ty2 * tileGridSize + tx1) * 256 + val];
            const cdf22 = cdfs[(ty2 * tileGridSize + tx2) * 256 + val];
            
            // Bilinear interpolation
            const cdf1 = cdf11 * (1 - px) + cdf12 * px;
            const cdf2 = cdf21 * (1 - px) + cdf22 * px;
            const finalCdf = cdf1 * (1 - py) + cdf2 * py;
            
            // Map the final CDF to a pixel value [0, 255]
            const outVal = Math.max(0, Math.min(255, Math.round(finalCdf * 255)));
            
            // Write grayscale result back to all 3 RGB channels
            const idx = (y * width + x) * 4;
            data[idx] = outVal;
            data[idx + 1] = outVal;
            data[idx + 2] = outVal;
            // alpha remains unchanged
        }
    }

    // 4. Update canvas
    ctx.putImageData(imageData, 0, 0);
}

/**
 * Applies Otsu's Global Thresholding algorithm to the image data in the canvas context.
 * This function is intended for Document Mode only (NOT for medicine labels) to binarize 
 * the image into black text on white paper.
 * 
 * Algorithm:
 * 1. Convert to grayscale using standard luminance: 0.299*R + 0.587*G + 0.114*B
 * 2. Compute 256-bin histogram
 * 3. Find threshold that maximises inter-class variance
 * 4. Binarize: < threshold becomes 0 (black), >= threshold becomes 255 (white)
 * 5. Write back to context in-place.
 * 
 * @param ctx The OffscreenCanvasRenderingContext2D containing the image to process.
 * @param width The width of the image.
 * @param height The height of the image.
 */
export function applyOtsuThreshold(
  ctx: OffscreenCanvasRenderingContext2D,
  width: number,
  height: number
): void {
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;
  const numPixels = width * height;
  
  const gray = new Uint8Array(numPixels);
  const hist = new Int32Array(256);
  
  let sum = 0;
  for (let i = 0; i < numPixels; i++) {
    const idx = i * 4;
    const r = data[idx];
    const g = data[idx + 1];
    const b = data[idx + 2];
    const gVal = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    gray[i] = gVal;
    hist[gVal]++;
    sum += gVal;
  }
  
  let sumB = 0;
  let wB = 0;
  let wF = 0;
  let maxVar = 0;
  let threshold = 0;
  
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    wF = numPixels - wB;
    if (wF === 0) break;
    
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    
    const varBetween = wB * wF * (mB - mF) * (mB - mF);
    
    if (varBetween > maxVar) {
      maxVar = varBetween;
      threshold = t;
    }
  }
  
  for (let i = 0; i < numPixels; i++) {
    const idx = i * 4;
    const val = gray[i] < threshold ? 0 : 255;
    data[idx] = val;
    data[idx + 1] = val;
    data[idx + 2] = val;
  }
  
  ctx.putImageData(imageData, 0, 0);
}
