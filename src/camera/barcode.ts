// Types for native BarcodeDetector API
declare global {
  interface Window {
    BarcodeDetector: any;
  }
}

export interface BarcodeResult {
  rawValue: string;
  format: string;
}

let detector: any = null;

export async function initBarcodeDetector(): Promise<boolean> {
  if ('BarcodeDetector' in window) {
    try {
      detector = new window.BarcodeDetector({ 
        formats: ['qr_code', 'data_matrix', 'ean_13', 'code_128'] 
      });
      return true;
    } catch (e) {
      console.warn('BarcodeDetector initialization failed', e);
    }
  }
  return false;
}

export async function scanBarcode(bitmap: ImageBitmap): Promise<BarcodeResult[]> {
  if (detector) {
    try {
      const barcodes = await detector.detect(bitmap);
      return barcodes.map((b: any) => ({
        rawValue: b.rawValue,
        format: b.format
      }));
    } catch (e) {
      console.warn('Barcode detect failed', e);
    }
  }
  // TODO: zxing-wasm fallback if native is unavailable
  return [];
}
