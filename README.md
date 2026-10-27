# EchoSight 💊

> **OCR-Based Accessible Document and Medicine Label Reader with Audio Output**  
> *Final Year Community Engagement Project (CEP) — Vidyalankar School of Information Technology (VSIT)*

EchoSight is an offline-capable, client-side Progressive Web App (PWA) designed to help visually impaired and elderly users identify Indian medicine packaging and read printed medical reports through real-time camera assistance, multi-frame consensus, and audio/haptic guidance. Complete one online scan before relying on the installed app offline so its runtime OCR and medicine assets are cached.

---

## 🌟 Key Features

1. **One Automatic Scanner**:
   - Users scan once; EchoSight distinguishes medicine packaging from printed documents and clinical reports without a mode switch.
   - Medicine labels use colour-aware preprocessing, Tesseract.js sparse-text recognition, fuzzy SQLite matching, and multi-frame consensus.
   - Reports receive an adaptive full-page OCR pass, keep their complete recognized text, and are read aloud in browser-safe speech chunks.
2. **Safety Architecture**:
   - **Multi-Frame Consensus**: Uses a rolling window of 5 captured frames and requires the same medicine on at least 2 separate reads.
   - **Safe Abstention Gate**: Unverified medicine scans eventually stop with the voice prompt: *"Unable to verify medicine. Please seek human assistance."*
   - **Expiry Date Detection**: Extracts expiry date strings (e.g. `EXP 11/27`, `Nov 2027`), verifies validity against current date, and flags expired medicine.
3. **Accessibility-focused interface**:
   - **Audio Guidance**: Geiger-counter sonification clicking mode and pitch-shifted continuous tone indicating camera alignment and text proximity.
   - **Haptic Feedback**: Discrete vibration patterns for alignment lock (50ms), successful readout (100ms), and error/abstention.
   - **High Contrast UI**: black and yellow/white high-contrast visual layout for low-vision users.
   - **Screen Reader Support**: Integrated ARIA live assertive and polite regions compatible with Android TalkBack.
4. **100% Client-Side Processing**:
   - Runs in-browser via WebAssembly (`sql.js`, `tesseract.js`) and Web Workers.
   - No report image or recognized text is sent to a cloud OCR service.
5. **Official Medicine Provenance**:
   - The bundled catalogue is generated from Mankind Pharma's official product list; every record stores its manufacturer and source URL.
   - Ambiguous, very short, or common report words are rejected instead of being guessed as medicine names.

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

### Refresh the medicine catalogue

```bash
# Downloads the current official source snapshot, validates it, then replaces the DB atomically
npm run data:refresh
```

`data/official-medicines.json` is committed so normal builds are reproducible and do not require network access. `npm run data:build` rebuilds the SQLite file from that verified snapshot only.

---

## 🌐 Deployment to Vercel

EchoSight is built completely as a static Progressive Web App (PWA). There is **no backend server or Python venv required** for runtime!

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

The benchmark exits with an error when no real `frame.png` samples are present. Do not report zero-sample output as OCR accuracy; use consented, de-identified medicine and clinical-report photos with ground truth.

---

## 📄 License
MIT License. Built for academic and community engagement purposes.
