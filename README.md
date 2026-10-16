# MedReader 💊

> **OCR-Based Accessible Document and Medicine Label Reader with Audio Output**  
> *Final Year Community Engagement Project (CEP) — Vidyalankar School of Information Technology (VSIT)*

MedReader is an offline-first, client-side Progressive Web App (PWA) designed to empower visually impaired and elderly users to independently and safely identify Indian medicine packaging and read printed documents through real-time camera assistance, computer vision preprocessing, multi-frame consensus, and multi-modal audio/haptic guidance.

---

## 🌟 Key Features

1. **Dual Scanning Modes**:
   - **Medicine Mode**: ROI cropping, non-destructive contrast preservation, Tesseract.js (PSM 3) / ONNX DBNet+SVTR pipeline, fuzzy trigram matching against a 7,056-brand Indian medicine SQLite database, and multi-frame consensus voting (3/5 agreement).
   - **Document Mode**: Otsu global binarization, Tesseract.js (PSM 3) full-page reading, and verbatim text-to-speech without database lookups.
2. **Safety Architecture**:
   - **Multi-Frame Consensus**: Eliminates single-frame hallucination by requiring rolling consensus across 5 captured frames.
   - **Safe Abstention Gate**: After 10 failed identification cycles, gracefully abstains with a voice prompt: *"Unable to verify medicine. Please seek human assistance."*
   - **Expiry Date Detection**: Extracts expiry date strings (e.g. `EXP 11/27`, `Nov 2027`), verifies validity against current date, and flags expired medicine.
3. **Accessibility (WCAG 2.1 AAA Compliant)**:
   - **Audio Guidance**: Geiger-counter sonification clicking mode and pitch-shifted continuous tone indicating camera alignment and text proximity.
   - **Haptic Feedback**: Discrete vibration patterns for alignment lock (50ms), successful readout (100ms), and error/abstention.
   - **High Contrast UI**: 21:1 black and yellow/white high-contrast visual layout for low-vision users.
   - **Screen Reader Support**: Integrated ARIA live assertive and polite regions compatible with Android TalkBack.
4. **100% Client-Side & Offline**:
   - Runs in-browser via WebAssembly (`sql.js`, `tesseract.js`, `onnxruntime-web`) and Web Workers.
   - Zero cloud API dependency — fully functional offline without internet access.

---

## 🚀 Quick Start

### Prerequisites
- Node.js (v18+)
- npm

### Installation
```bash
# Clone the repository
git clone https://github.com/Havishh-k/Medreader.git
cd Medreader

# Install dependencies
npm install

# Start local development server
npm run dev
```

### Production Build
```bash
npm run build
npm run test
```

---

## 🌐 Deployment to Vercel

MedReader is built completely as a static Progressive Web App (PWA). There is **no backend server or Python venv required** for runtime!

To deploy on Vercel:
1. Push your repository to GitHub.
2. Log in to [Vercel](https://vercel.com).
3. Import `Havishh-k/Medreader`.
4. Build Settings:
   - **Framework Preset**: Vite
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`
5. Click **Deploy**.

---

## 🧪 Testing & Evaluation

Run the unit test suite:
```bash
npm run test
```

Run the golden dataset benchmark evaluation:
```bash
npx tsx scripts/evaluate.ts
```

---

## 📄 License
MIT License. Built for academic and community engagement purposes.
