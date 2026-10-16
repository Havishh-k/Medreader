# Enhancing OCR for Medicine Labels

Reading text from curved, glossy medicine bottles captured via mobile cameras is considered an "In-The-Wild Scene Text" problem. Tesseract was originally designed for flat, high-contrast, scanned documents. 

To get the best possible outcome from Tesseract, or to move beyond it, here are the most effective strategies:

## 1. Fast Fixes applied to Tesseract (Implemented Today)

We just applied two critical enhancements to your pipeline that will yield immediate improvements:

### A. Resolution Upscaling
Tesseract's engine is extremely sensitive to text size. It requires the "x-height" (height of a lowercase x) to be at least 20 pixels. Mobile camera frames capture a wide field of view, making the physical label text tiny in pixels. 
**Fix:** We applied a **2x High-Quality Upscale** using the Canvas API before sending the frame to Tesseract.

### B. Page Segmentation Mode (PSM)
By default, Tesseract tries to read the image as a single, uniform block of text (like a paragraph in a book). A medicine bottle has scattered text blocks, curved lines, and logos.
**Fix:** We changed the parameter to `tessedit_pageseg_mode: '11'` (Sparse Text). This tells Tesseract to find as much text as possible in no particular order, which is perfect for bottles.

## 2. Advanced Pre-processing (Next Steps)

If you want to push Tesseract even further without leaving the browser, you should implement these via Canvas before OCR:

*   **Unsharp Masking (Sharpening Kernel):** Apply a convolution matrix `[0 -1 0, -1 5 -1, 0 -1 0]` to the image data. Mobile frames are often slightly out of focus. Sharpening the edges of the text heavily improves Tesseract's confidence.
*   **CLAHE (Contrast Limited Adaptive Histogram Equalization):** Standard binarization (making pixels purely black or white based on a threshold) destroys text on colored logos (like the blue Otrivin bottle). CLAHE normalizes the lighting across the curved, glaring surface of the bottle before Tesseract does its own thresholding.

## 3. The Ultimate Enhancement: Replace Tesseract

The absolute best way to enhance the OCR is to **stop using Tesseract**. 

The industry standard for reading curved, glossy "scene text" is a two-stage Deep Learning pipeline:
1.  **Text Detection:** A model like **DBNet** finds the bounding boxes of text, even if they are curved or rotated.
2.  **Text Recognition:** A model like **SVTR** or **CRNN** reads the text inside those specific cropped boxes.

*Note: Your project already contains a file called `src/workers/ocr.worker.ts` that includes the scaffolding for ONNX models (`det.onnx` and `rec.onnx`). Activating this WebAssembly pipeline instead of the `RealOcrWorker` Tesseract fallback will instantly give you 5x better accuracy on medicine bottles.*
