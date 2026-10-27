# EchoSight — Android Device Testing Checklist

## Prerequisites

1. Build the production bundle:
   ```bash
   npm run build
   ```

2. Serve over HTTPS (required for camera + service worker):
   ```bash
   npx serve dist
   # Then use ngrok or similar for HTTPS tunnel:
   # ngrok http 3000
   ```

3. Open the HTTPS URL on your Android phone in Chrome

---

## Test Matrix

### Basic Functionality

- [ ] **T1: App loads** — PWA installs, service worker registers
  - Verify: No console errors, "Start Scan" button visible
  
- [ ] **T2: Camera opens** — Tap "Start Scan"
  - Verify: Camera feed visible, framing guide rectangle shows

- [ ] **T3: Automatic reader is clear**
  - Verify: One scan action is shown; no Document/Medicine choice is required
  - Verify: Banner says medicines and medical reports are detected automatically

### Medicine Scanning

- [ ] **T4: Sonification** — Hold phone near a medicine label
  - Verify: Hear pitch change (continuous tone) or ticking (Geiger mode)

- [ ] **T5: Medicine OCR** — Scan Otrivin Oxy label
  - Verify: Brand name "Otrivin" appears in results card
  - Verify: Strength shows (e.g., "10ml")
  - Verify: Expiry date shows (if visible on label) OR "Not specified"

- [ ] **T6: TTS speaks result** — After medicine identified
  - Verify: Phone speaks "Otrivin Oxy. Strength: 10ml. Expiry: Nov 2027."

- [ ] **T7: Multi-frame consensus** — Watch console for "[Scan] Waiting for consensus..."
  - Verify: Result appears after 2 frames agree, or after one especially strong database match

- [ ] **T8: Haptic feedback** — Feel vibration on identification
  - Verify: Short vibration when medicine identified

### Medical Report Scanning

- [ ] **T9: Clinical report OCR** — Scan a printed hospital or clinic report with patient, diagnosis, test, and prescription details
  - Verify: "Clinical Report" appears without changing a mode
  - Verify: The full recognized report is visible under "Full Report Text"
  - Verify: TTS reads from the start through "End of report" without stopping after 250 characters
  - Verify: Replay Voice reads the complete report again

### Safety

- [ ] **T10: Safe Abstention** — Point camera at blank wall for 30+ seconds
  - Verify: After the configured failure threshold, phone says "Unable to verify medicine. Please seek human assistance."
  - Verify: Error vibration pattern fires
  - Verify: Returns to Idle state

- [ ] **T11: Expired medicine** — Scan a medicine with a past expiry date
  - Verify: Badge shows "Expired" in red
  - Verify: TTS says "EXPIRED"

### Accessibility

- [ ] **T12: TalkBack navigation** — Enable Settings → Accessibility → TalkBack
  - Verify: All buttons are announced with labels
  - Verify: Automatic reader banner announces support for medicines and medical reports
  - Verify: State transitions and the detected result type are announced

- [ ] **T13: High Contrast** — Open Settings → High Contrast Mode → On
  - Verify: Background turns pure black
  - Verify: Text turns white, accents turn yellow
  - Verify: Framing guide turns yellow
  - Verify: Survives page reload

- [ ] **T14: Focus trapping** — Open Settings modal
  - Verify: Tab key stays within modal, doesn't escape to background
  - Verify: Android Back button closes modal

### Performance

- [ ] **T15: Offline mode** — Disconnect WiFi after first load, scan again
  - Verify: App still works (cached via service worker)
  - Verify: Medicine DB still loads from cache

- [ ] **T16: Memory** — Chrome DevTools remote → Memory tab
  - Verify: Heap < 150 MB after 3 scan cycles
  - Verify: Memory returns to baseline after returning to Idle

### Audio Guidance

- [ ] **T17: Continuous tone** — Settings → Audio Guidance → Continuous Tone
  - Verify: Smooth sine wave, pitch rises with quality

- [ ] **T18: Geiger ticking** — Settings → Audio Guidance → Geiger-Counter
  - Verify: Distinct clicks that speed up as framing improves
  - Verify: Merges to continuous at very high quality

---

## Results Log

| Test | Pass/Fail | Notes | Date |
|:-----|:----------|:------|:-----|
| T1   |           |       |      |
| T2   |           |       |      |
| T3   |           |       |      |
| T4   |           |       |      |
| T5   |           |       |      |
| T6   |           |       |      |
| T7   |           |       |      |
| T8   |           |       |      |
| T9   |           |       |      |
| T10  |           |       |      |
| T11  |           |       |      |
| T12  |           |       |      |
| T13  |           |       |      |
| T14  |           |       |      |
| T15  |           |       |      |
| T16  |           |       |      |
| T17  |           |       |      |
| T18  |           |       |      |

**Device:** ___________________  
**Chrome Version:** ___________  
**Date:** _____________________  
**Tester:** ___________________
