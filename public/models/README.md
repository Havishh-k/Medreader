# ONNX OCR Models

Place the following files here for ONNX-based scene text recognition:

- `det.onnx` — Text detection model (DBNet from PaddleOCR PP-OCRv4)
- `rec.onnx` — Text recognition model (SVTR from PaddleOCR PP-OCRv4)  
- `dict.txt` — Character dictionary for CTC decoding

## How to obtain

```bash
pip install paddle2onnx paddlepaddle

# Detection model
wget https://paddleocr.bj.bcebos.com/PP-OCRv4/english/en_PP-OCRv4_det_infer.tar
tar xf en_PP-OCRv4_det_infer.tar
paddle2onnx --model_dir en_PP-OCRv4_det_infer --model_filename inference.pdmodel --params_filename inference.pdiparams --save_file det.onnx --opset_version 11

# Recognition model  
wget https://paddleocr.bj.bcebos.com/PP-OCRv4/english/en_PP-OCRv4_rec_infer.tar
tar xf en_PP-OCRv4_rec_infer.tar
paddle2onnx --model_dir en_PP-OCRv4_rec_infer --model_filename inference.pdmodel --params_filename inference.pdiparams --save_file rec.onnx --opset_version 11

# Dictionary
wget -O dict.txt https://raw.githubusercontent.com/PaddlePaddle/PaddleOCR/main/ppocr/utils/en_dict.txt
```

If these files are not present, the app automatically falls back to Tesseract.js OCR.
