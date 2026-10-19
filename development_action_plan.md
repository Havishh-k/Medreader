# Development & Implementation Action Plan: EchoSight

This document serves as the instructional roadmap for the engineering team to implement the dual-engine architecture, accessibility hardening, and evaluation harness outlined in the EchoSight Master Project Blueprint. 

**Instructions for Developers:**
- Do not modify core algorithmic logic unless explicitly specified.
- Ensure all UI changes are tested with a screen reader (TalkBack/VoiceOver).
- Adhere strictly to the acceptance criteria for each task.

---

### 1. Sprint 1: UI, State Machine, & Accessibility

**Task 1.1: High-Contrast Mode Toggle**
*   **What:** Introduce a prominent UI toggle to switch between Document and Medicine modes. Add high-contrast CSS overrides for WCAG 2.1 AAA compliance.
*   **Where:** 
    *   `index.html`: Insert `<div id="mode-toggle">` between `</header>` and `<main>` (around line 23).
    *   `src/styles/app.css`: Add a `[data-high-contrast="true"]` selector on the `<body>` tag. Override variables to pure black background (#000000), pure white text (#FFFFFF), and yellow primary actions (#FFFF00).
    *   `src/ui/settings.ts`: Add a toggle for High Contrast Mode.
*   **Acceptance Criteria:** 
    *   The segmented control uses `role="radiogroup"` with minimum 48x48px touch targets.
    *   Contrast ratio for text is at least 7:1; yellow-on-black action elements reach ~19.6:1.
    *   Default mode is set to "Medicine".

**Task 1.2: State Machine Mode Branching**
*   **What:** Update the state machine to bypass the SQLite database loading when Document Mode is active.
*   **Where:** `src/ui/state-machine.ts`
*   **Acceptance Criteria:**
    *   Add a `private mode: 'document' | 'medicine' = 'medicine';` property.
    *   In `transitionTo('Guidance')`, if `mode === 'document'`, do NOT call `this.ensureDbWorker()`. 
    *   Create the `ExtractionPipeline` with `engine = 'tesseract'` (and subsequently PSM 3) for Document Mode.

**Task 1.3: TalkBack Accessibility Hardening**
*   **What:** Implement focus trapping for settings modals and ensure dynamic ARIA announcements cover all state transitions.
*   **Where:** `index.html`, `src/ui/state-machine.ts`, `src/ui/settings.ts`
*   **Acceptance Criteria:**
    *   When `#settings-screen` is open, add the `inert` attribute to `#app-root` to trap Tab/Shift+Tab focus.
    *   `updateAria()` must inject text into `#live-assertive` on scan start/stop (e.g., "Scanning started").
    *   Ensure the Safe Abstention Gate (when consensus fails) triggers an assertive announcement: "Unable to verify. Please seek human assistance."

---

### 2. Sprint 2: Web Workers & Dual-Engine OCR

**Task 2.1: Dynamic Page Segmentation Mode (PSM) Configuration**
*   **What:** Modify the Tesseract wrapper to accept a variable PSM argument so it can switch between reading flat documents and scattered medicine labels.
*   **Where:** `src/camera/pipeline.ts` (specifically the `RealOcrWorker` class)
*   **Acceptance Criteria:**
    *   Change the constructor to `constructor(psm: '3' | '6' | '11' = '11')`.
    *   In `init()`, pass `this.psm` to `tessedit_pageseg_mode`.
    *   `ExtractionPipeline` must instantiate the worker with the correct PSM based on the active mode ('3' for Document, '11' for Medicine).

**Task 2.2: WASM Memory Lifecycle Management**
*   **What:** Audit and enforce strict memory cleanup to prevent Out-Of-Memory (OOM) crashes on low-end Android devices during repeated scan sessions.
*   **Where:** `src/camera/pipeline.ts`, `src/ui/state-machine.ts`
*   **Acceptance Criteria:**
    *   Verify `RealOcrWorker.terminate()` successfully clears the ~20-50MB Tesseract heap. If not, explicitly nullify `this.worker`.
    *   Verify `StateMachine.teardownDbWorker()` correctly allows the 418MB ArrayBuffer to be garbage collected when returning to Idle.
    *   Confirm via Chrome DevTools Memory tab that memory returns to baseline after a scan cycle.

---

### 3. Sprint 3: Computer Vision & Pre-processing

**Task 3.1: Otsu's Global Thresholding (Document Mode)**
*   **What:** Implement a mathematical Otsu thresholding function for clean binarization of flat academic documents.
*   **Where:** `src/camera/preprocess.ts`
*   **Acceptance Criteria:**
    *   Create `export function applyOtsuThreshold(ctx, width, height)`.
    *   The function must convert the canvas to grayscale, calculate a 256-bin histogram, maximize inter-class variance to find the threshold, and binarize the pixels (0 or 255).
    *   Operates in-place on the provided canvas context.

**Task 3.2: Isolate Pre-processing Pipelines**
*   **What:** Ensure that aggressive pre-processing (CLAHE, Laplacian blur rejection) is strictly isolated to the Medicine Mode to save CPU cycles during Document Mode.
*   **Where:** `src/camera/pipeline.ts`, `src/camera/frame-quality.ts`
*   **Acceptance Criteria:**
    *   Document Mode pipeline: Grayscale → Otsu Thresholding → Tesseract PSM 3.
    *   Medicine Mode pipeline: ROI Crop → 2x Upscale → Unsharp Mask → CLAHE → ONNX / Tesseract PSM 11.
    *   Skip frame dropping based on Laplacian variance in Document Mode if lighting is adequate.

---

### 4. Sprint 4: Sonification & Haptics

**Task 4.1: Geiger-Counter Sonification Mode**
*   **What:** Add a pulsed "Geiger-counter" ticking mode as an alternative to the continuous sine wave pitch, reducing auditory fatigue.
*   **Where:** `src/guidance/sonification.ts`
*   **Acceptance Criteria:**
    *   Add a `tickMode: boolean = false` property.
    *   When true, use `setInterval` or audio clock scheduling to trigger short bursts (envelope: 5ms attack, 20ms sustain, 5ms release).
    *   Tick interval scales inversely with the `composite` quality score (e.g., 1000ms at 0.0, 100ms at 0.9).
    *   Transitions to a continuous tone when composite score ≥ 0.95 (locked).

**Task 4.2: Haptic Feedback Integration**
*   **What:** Trigger the binary vibration patterns during state changes to provide tactile confirmation.
*   **Where:** `src/ui/state-machine.ts` (importing from `src/guidance/vibration.ts`)
*   **Acceptance Criteria:**
    *   Call `vibrateLock()` (50ms) when a frame achieves a composite score > 0.9.
    *   Call `vibrateSuccess()` (100ms) when transitionTo('Readout') occurs.
    *   Call `vibrateError()` ([50, 100, 50]ms) when the Safe Abstention Gate triggers.

---

### 5. Sprint 5: Golden Dataset & Evaluation Harness

**Task 5.1: Dataset Curation**
*   **What:** Collect and structure 100 test samples (50 documents, 50 medicines) to validate OCR accuracy and the safety gate.
*   **Where:** New directory `golden_dataset/` at project root.
*   **Acceptance Criteria:**
    *   Follow the exact directory structure: `documents/DOC-001/` and `medicines/MED-001/`.
    *   Capture frames using the app's `CameraStream.grabFrame()` on a target Android device.
    *   Include `frame.png`, `metadata.json`, and ground truth text files for all 100 samples.

**Task 5.2: Automated Benchmark Script**
*   **What:** Create a Node.js script to run the golden dataset through the OCR pipelines and calculate Character Error Rate (CER) and Word Error Rate (WER).
*   **Where:** `scripts/evaluate.ts`
*   **Acceptance Criteria:**
    *   Implements Levenshtein distance formulas for characters (CER) and tokens (WER).
    *   Generates a Markdown/CSV table comparing Raw OCR, Post-Preprocess, and Post-Validation metrics.
    *   Explicitly tracks False Positives (dangerous hallucinations) and False Negatives (abstentions).

---

### 6. Task Assignment Matrix

| Task ID | Description | Assigned Developer | Status | Target Completion Date |
|:---|:---|:---|:---|:---|
| **1.1** | High-Contrast Mode Toggle & CSS | [Unassigned] | Not Started | YYYY-MM-DD |
| **1.2** | State Machine Mode Branching | [Unassigned] | Not Started | YYYY-MM-DD |
| **1.3** | TalkBack Accessibility Hardening | [Unassigned] | Not Started | YYYY-MM-DD |
| **2.1** | Dynamic PSM Configuration | [Unassigned] | Not Started | YYYY-MM-DD |
| **2.2** | WASM Memory Lifecycle Audit | [Unassigned] | Not Started | YYYY-MM-DD |
| **3.1** | Implement Otsu's Thresholding | [Unassigned] | Not Started | YYYY-MM-DD |
| **3.2** | Isolate Pre-processing Pipelines | [Unassigned] | Not Started | YYYY-MM-DD |
| **4.1** | Geiger-Counter Sonification Mode | [Unassigned] | Not Started | YYYY-MM-DD |
| **4.2** | Haptic Feedback Integration | [Unassigned] | Not Started | YYYY-MM-DD |
| **5.1** | Curate Golden Dataset (100 samples) | [Unassigned] | Not Started | YYYY-MM-DD |
| **5.2** | Automated Benchmark Script (CER/WER) | [Unassigned] | Not Started | YYYY-MM-DD |
