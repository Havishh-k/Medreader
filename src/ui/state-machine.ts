import { TtsManager } from '../speech/tts-manager';
import { SonificationEngine } from '../guidance/sonification';
import { HintGenerator } from '../guidance/hints';
import { ExtractionPipeline } from '../camera/pipeline';
import { CameraStream } from '../camera/stream';
import { vibrateLock, vibrateSuccess, vibrateError } from '../guidance/vibration';
import { ICONS } from './icons';
import {
  bestScannedText,
  findMedicineConsensus,
  isLikelyClinicalDocument,
  isReadableDocument,
  type MedicineRead,
} from '../core/scan-content';

export type AppState = 'Idle' | 'Guidance' | 'Readout';
type ReadoutKind = 'medicine' | 'document';
const MAX_SCAN_ATTEMPTS = 12;
const GUIDANCE_REMINDER_INTERVAL = 4;

function parseDosageAndUsage(raw: string): { dosage: string; usage: string } {
  if (!raw || !raw.trim()) {
    return { dosage: 'Standard', usage: '' };
  }
  const clean = raw.trim();

  // If it's already a concise strength string (<= 40 chars) without clinical description sentences
  if (clean.length <= 40 && !clean.toLowerCase().includes(' is a ') && !clean.toLowerCase().includes(' used for ')) {
    return { dosage: clean, usage: '' };
  }

  // Regex pattern matching medicine strength e.g. "0.03 mg/0.15 mg", "500mg", "650 mg", "10ml", "400mg/325mg"
  const dosageRegex = /\b\d+(\.\d+)?\s*(mg|mcg|µg|g|ml|%|w\/v)(\s*\/\s*\d+(\.\d+)?\s*(mg|mcg|µg|g|ml|%|w\/v))*/i;
  const match = clean.match(dosageRegex);

  let dosage = match ? match[0] : '';

  if (!dosage) {
    // If no unit matched, take the first short phrase up to first delimiter
    const firstSentence = clean.split(/[.,;\n]/)[0].trim();
    dosage = firstSentence.length <= 35 ? firstSentence : firstSentence.slice(0, 32) + '...';
  }

  return { dosage, usage: clean };
}

export class StateMachine {
  private state: AppState = 'Idle';
  private tts = new TtsManager();
  private sonification = new SonificationEngine();
  private hints = new HintGenerator();
  private pipeline: ExtractionPipeline | null = null;
  private camera = new CameraStream('camera');
  
  private readoutKind: ReadoutKind = 'medicine';
  private fullReadoutText = '';
  
  // DOM Elements
  private triggerBtn: HTMLElement;
  private scanBtnText: HTMLElement;
  private scanBtnIcon: HTMLElement;
  private visualToast: HTMLElement;
  private toastIcon: HTMLElement;
  private toastMsg: HTMLElement;
  private resultsCard: HTMLElement;
  private resBrand: HTMLElement;
  private resStrength: HTMLElement;
  private resExpiry: HTMLElement;
  private resStatus: HTMLElement;
  private resAccordion: HTMLDetailsElement;
  private resDescription: HTMLElement;
  private resReplayBtn: HTMLElement;
  private resCopyBtn: HTMLElement;
  private resultCategory: HTMLElement;
  private strengthLabel: HTMLElement;
  private expiryLabel: HTMLElement;
  private accordionTitle: HTMLElement;
  private scanInstructions: HTMLElement;
  private liveAssertive: HTMLElement;
  private cameraContainer: HTMLElement;
  private focusRing: HTMLElement;
  private torchBtn: HTMLElement;
  private soundBtn: HTMLElement;
  private soundIcon: HTMLElement;
  private scannerReticle: HTMLElement;
  private scannerLaser: HTMLElement;
  private autoTorchTriggered = false;

  private rafId = 0;
  private capturingFrames = 0;
  private readonly MAX_CAPTURE_FRAMES = 6;

  // Single persistent DB worker — created once per scan, reused for all queries
  private dbWorker: Worker | null = null;
  private dbReady = false;
  private pendingDbQuery: string | null = null;

  constructor() {
    this.triggerBtn = document.getElementById('scan-trigger')!;
    this.scanBtnText = document.getElementById('scan-btn-text')!;
    this.scanBtnIcon = document.getElementById('scan-btn-icon')!;
    this.visualToast = document.getElementById('visual-toast')!;
    this.toastIcon = document.getElementById('toast-icon')!;
    this.toastMsg = document.getElementById('toast-msg')!;
    this.resultsCard = document.getElementById('results-card')!;
    this.resBrand = document.getElementById('res-brand')!;
    this.resStrength = document.getElementById('res-strength')!;
    this.resExpiry = document.getElementById('res-expiry')!;
    this.resStatus = document.getElementById('res-status')!;
    this.resAccordion = document.getElementById('res-accordion') as HTMLDetailsElement;
    this.resDescription = document.getElementById('res-description')!;
    this.resReplayBtn = document.getElementById('res-replay-btn')!;
    this.resCopyBtn = document.getElementById('res-copy-btn')!;
    this.resultCategory = document.querySelector('.result-category-label')!;
    this.strengthLabel = document.querySelector('#chip-dosage .chip-label')!;
    this.expiryLabel = document.querySelector('#chip-expiry .chip-label')!;
    this.accordionTitle = document.querySelector('.accordion-title-wrap span:last-child')!;
    this.scanInstructions = document.getElementById('scan-instructions')!;
    this.liveAssertive = document.getElementById('live-assertive')!;
    this.cameraContainer = document.getElementById('camera-container')!;
    this.focusRing = document.getElementById('focus-ring')!;
    this.torchBtn = document.getElementById('torch-btn')!;
    this.soundBtn = document.getElementById('sound-btn')!;
    this.soundIcon = document.getElementById('sound-icon')!;
    this.scannerReticle = document.getElementById('scanner-reticle')!;
    this.scannerLaser = document.getElementById('scanner-laser')!;

    // Sound mute/unmute header button
    this.soundBtn.addEventListener('click', () => {
      const isMuted = this.sonification.toggleMute();
      this.soundIcon.innerHTML = isMuted ? ICONS.volumeMute(20) : ICONS.volume(20);
      this.soundBtn.setAttribute('aria-label', isMuted ? 'Unmute Audio Guidance Tone' : 'Mute Audio Guidance Tone');
      this.setToast(isMuted ? 'Guidance Tone Muted' : 'Guidance Tone On', isMuted ? ICONS.volumeMute(18) : ICONS.volume(18));
      if ('vibrate' in navigator) {
        try { navigator.vibrate(35); } catch {}
      }
    });

    // Replay speech button
    this.resReplayBtn.addEventListener('click', () => {
      this.tts.speakAssertive(this.buildReadoutSpeech());
      if ('vibrate' in navigator) {
        try { navigator.vibrate(30); } catch {}
      }
    });

    // Copy the complete recognized result to clipboard
    this.resCopyBtn.addEventListener('click', async () => {
      const textToCopy = this.readoutKind === 'document'
        ? `EchoSight scanned report:\n\n${this.fullReadoutText}`
        : `EchoSight medicine information:\nBrand: ${this.resBrand.textContent}\nStrength: ${this.resStrength.textContent}\nExpiry: ${this.resExpiry.textContent}\n${this.resDescription.textContent ? 'Details: ' + this.resDescription.textContent : ''}`;
      try {
        await navigator.clipboard.writeText(textToCopy);
        this.setToast('Copied to clipboard!', ICONS.check(18));
      } catch (err) {
        this.setToast('Failed to copy', ICONS.xCircle(18));
      }
      if ('vibrate' in navigator) {
        try { navigator.vibrate(35); } catch {}
      }
    });

    // Flashlight button
    this.torchBtn.addEventListener('click', () => {
      this.toggleTorch();
    });

    // Setup tactile touch and accessibility gestures
    this.setupGestures();

    // Wire main button
    this.triggerBtn.addEventListener('click', () => {
      if (this.state === 'Idle' || this.state === 'Readout') {
        this.transitionTo('Guidance');
      } else if (this.state === 'Guidance') {
        this.transitionTo('Idle');
      }
    });

    // Bluetooth remote / Keyboard support
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        if (this.state === 'Idle' || this.state === 'Readout') {
          e.preventDefault();
          this.transitionTo('Guidance');
        } else if (this.state === 'Guidance') {
          e.preventDefault();
          this.transitionTo('Idle');
        }
      }
    });

    // Listen for tick mode changes from settings
    window.addEventListener('tickModeChanged', (e: Event) => {
      const isTick = (e as CustomEvent).detail;
      this.sonification.setTickMode(isTick);
    });
    // Restore tick mode from localStorage
    if (localStorage.getItem('tickMode') === 'true') {
      this.sonification.setTickMode(true);
    }

    // Listen for language and rate changes from settings
    window.addEventListener('languageChanged', (e: Event) => {
      const lang = (e as CustomEvent).detail;
      this.tts.setLanguage(lang);
    });
    window.addEventListener('rateChanged', (e: Event) => {
      const rate = (e as CustomEvent).detail;
      this.tts.setRate(rate);
    });
    
    this.updateAria();
  }

  private ensureDbWorker() {
    if (this.dbWorker) return;
    this.dbReady = false;
    this.dbWorker = new Worker(new URL('../workers/db.worker.ts', import.meta.url), { type: 'module' });
    this.dbWorker.onmessage = (e) => {
      if (e.data.type === 'init_done') {
        this.dbReady = true;
        // If a query was queued while we were initializing, send it now
        if (this.pendingDbQuery) {
          this.dbWorker!.postMessage({ type: 'query', payload: { text: this.pendingDbQuery } });
          this.pendingDbQuery = null;
        }
      } else if (e.data.type === 'init_error') {
        if (this.state === 'Guidance') {
          const message = 'Medicine reference data is unavailable. Please try again after reloading the app.';
          vibrateError();
          void this.transitionTo('Idle').then(() => {
            this.setToast(message, ICONS.warning(18));
            this.liveAssertive.textContent = message;
            this.tts.speakAssertive(message);
          });
        }
      } else if (e.data.type === 'query_result') {
        const found = e.data.result;
        
        if (found && this.state === 'Guidance') {
          // Phase 5: Accumulate reads for voting (Rolling window of 5)
          this.accumulatedReads.push(found);
          if (this.accumulatedReads.length > 5) {
             this.accumulatedReads.shift();
          }
          
          const consensusRead = findMedicineConsensus(this.accumulatedReads);
          
          if (consensusRead) {
            this.readoutKind = 'medicine';
            this.fullReadoutText = '';
            this.configureMedicineResult();
            this.resBrand.textContent = consensusRead.brand_name;
            const { dosage, usage } = parseDosageAndUsage(consensusRead.strength || '');
            this.resStrength.textContent = dosage === 'Standard' ? 'Not listed' : dosage;

            const details = [
              consensusRead.generic_name ? `Active ingredient: ${consensusRead.generic_name}` : '',
              usage && usage.length > 40 ? `Product details: ${usage}` : '',
              consensusRead.manufacturer ? `Manufacturer: ${consensusRead.manufacturer}` : '',
              consensusRead.source_url ? 'Source: official manufacturer product catalogue' : '',
            ].filter(Boolean);

            if (details.length > 0) {
              this.resDescription.textContent = details.join('\n');
              this.resAccordion.hidden = false;
              this.resAccordion.open = false;
            } else {
              this.resDescription.textContent = '';
              this.resAccordion.hidden = true;
            }
            
            // Extract and display expiry date from accumulated reads
            const lastReadWithExpiry = [...this.accumulatedReads]
              .reverse()
              .find(r => r.expiry);
            
            if (lastReadWithExpiry?.expiry) {
              const { year, month } = lastReadWithExpiry.expiry;
              const monthNames = ['Jan','Feb','Mar','Apr','May','Jun',
                                  'Jul','Aug','Sep','Oct','Nov','Dec'];
              const now = new Date();
              const isExpired = year < now.getFullYear() || 
                (year === now.getFullYear() && month < now.getMonth() + 1);
              
              this.resExpiry.textContent = isExpired 
                ? `EXPIRED: ${monthNames[month-1]} ${year}` 
                : `${monthNames[month-1]} ${year} (Valid)`;
              
              if (isExpired) {
                this.resStatus.textContent = "Expired";
                this.resStatus.className = "status-badge invalid";
              } else {
                this.resStatus.textContent = "Valid";
                this.resStatus.className = "status-badge";
              }
            } else {
              this.resExpiry.textContent = "Expiry unknown";
              this.resStatus.textContent = "Unknown";
              this.resStatus.className = "status-badge unknown";
            }
            
            this.transitionTo('Readout');
          } else {
            console.log('[Scan] Waiting for consensus... reads:', this.accumulatedReads.map(r => r.brand_name));
            this.consensusAttempts++;
            if (this.consensusAttempts >= MAX_SCAN_ATTEMPTS) {
              this.liveAssertive.textContent = 'Unable to verify medicine. Please seek human assistance.';
              this.tts.speakAssertive('Unable to verify medicine. Please seek human assistance.');
              vibrateError();
              this.transitionTo('Idle');
            }
          }
        } else if (!found && this.state === 'Guidance') {
          const documentText = bestScannedText([e.data.rawText || '']);
          if (isReadableDocument(documentText)) {
            this.showDocumentResult(documentText);
            return;
          }

          // Bound repeated OCR attempts so an unreadable item fails safely instead of scanning indefinitely.
          this.consensusAttempts++;
          if (this.consensusAttempts >= MAX_SCAN_ATTEMPTS) {
            this.liveAssertive.textContent = 'Unable to verify medicine. Please seek human assistance.';
            this.tts.speakAssertive('Unable to verify medicine. Please seek human assistance.');
            vibrateError();
            this.transitionTo('Idle');
          } else if (this.consensusAttempts % GUIDANCE_REMINDER_INTERVAL === 0) {
            this.tts.speakPolite('Still reading. Hold the item steady.');
          }
        }
      }
    };
  }

  /** Send a query to the persistent DB worker */
  private queryDb(text: string) {
    this.ensureDbWorker();
    if (this.dbReady) {
      this.dbWorker!.postMessage({ type: 'query', payload: { text } });
    } else {
      // Queue — will be sent once init_done fires
      this.pendingDbQuery = text;
    }
  }

  private teardownDbWorker() {
    if (this.dbWorker) {
      this.dbWorker.terminate();
      this.dbWorker = null;
      this.dbReady = false;
      this.pendingDbQuery = null;
    }
  }

  async transitionTo(newState: AppState) {
    if (this.state === newState) return;
    this.state = newState;
    this.updateAria();
    
    switch (newState) {
      case 'Idle':
        if (this.camera.isTorchOn) {
          this.camera.setTorch(false);
          this.torchBtn.classList.remove('torch-btn--active');
        }
        this.autoTorchTriggered = false;
        this.camera.stop();
        this.sonification.mute();
        this.tts.clear();
        cancelAnimationFrame(this.rafId);
        if (this.scannerLaser) this.scannerLaser.hidden = true;
        if (this.scannerReticle) this.scannerReticle.classList.remove('reticle--locked');
        // Tear down pipeline and DB worker to free memory
        if (this.pipeline) {
          this.pipeline.destroy();
          this.pipeline = null;
        }
        this.teardownDbWorker();
        this.resetUI();
        break;
        
      case 'Guidance':
        this.autoTorchTriggered = false;
        this.resetUI();
        this.accumulatedReads = [];
        this.consensusAttempts = 0;
        this.scanBtnText.textContent = 'Stop Scan';
        this.scanBtnIcon.innerHTML = ICONS.stop(20);
        if (this.scannerLaser) this.scannerLaser.hidden = false;
        
        this.pipeline = new ExtractionPipeline('11', 'auto');
        this.ensureDbWorker();
        
        try {
          await this.camera.start();
        } catch {
          await this.transitionTo('Idle');
          const message = 'Camera access is required to scan. Please allow camera permission and try again.';
          this.setToast(message, ICONS.warning(18));
          this.liveAssertive.textContent = message;
          this.tts.speakAssertive(message);
          return;
        }
        await this.sonification.init();
        
        // Only unmute if TalkBack mode active or user unmuted via header
        if (this.tts.talkbackMode) {
          this.sonification.unmute();
          this.soundIcon.innerHTML = ICONS.volume(20);
        }
        
        this.hints.resetThrottle();
        this.capturingFrames = 0;
        this.lastCaptureTime = 0;
        this.tts.speakPolite('Guiding. Hold the medicine or report steady inside the frame.');
        this.loop();
        break;
        
      case 'Readout':
        vibrateSuccess();
        if (this.camera.isTorchOn) {
          this.camera.setTorch(false);
          this.torchBtn.classList.remove('torch-btn--active');
        }
        this.camera.stop();
        this.sonification.mute();
        if (this.scannerLaser) this.scannerLaser.hidden = true;
        if (this.scannerReticle) this.scannerReticle.classList.add('reticle--locked');
        this.resultsCard.hidden = false;
        this.triggerBtn.removeAttribute('disabled');
        this.scanBtnText.textContent = 'Scan Again';
        this.scanBtnIcon.innerHTML = ICONS.refresh(20);
        cancelAnimationFrame(this.rafId);
        if (this.pipeline) {
          this.pipeline.destroy();
          this.pipeline = null;
        }
        
        this.tts.speakAssertive(this.buildReadoutSpeech());
        break;
    }
  }

  private isExtracting = false;
  private accumulatedReads: MedicineRead[] = [];
  private lastCaptureTime = 0;
  private consensusAttempts = 0;
  
  private loop = async () => {
    if (this.state !== 'Guidance' || !this.pipeline) return;
    
    // Frame Throttling to 5 fps (200ms)
    const now = performance.now();
    if (now - this.lastCaptureTime > 200) {
      this.lastCaptureTime = now;
      
      const frame = await this.camera.grabFrame();
      if (frame) {
        this.pipeline.pushFrame(frame);
        
        const frames = this.pipeline['buffer'].getFrames();
        if (frames.length > 0) {
          const currentQuality = frames[frames.length - 1].quality;
          this.sonification.update(currentQuality);
          
          // Visual reticle locked indicator: turns emerald green when sharp & clear
          const isQualityLocked = currentQuality.sharpness > 140 && currentQuality.composite > 0.45;
          if (this.scannerReticle) {
            this.scannerReticle.classList.toggle('reticle--locked', isQualityLocked);
          }

          // Haptic lock pulse when framing is excellent
          if (currentQuality.composite > 0.9) {
            vibrateLock();
          }

          // Low-light auto torch trigger (luminance < 45 on 0-255 scale)
          if (currentQuality.luminance < 45 && !this.autoTorchTriggered && this.camera.hasTorch()) {
            this.autoTorchTriggered = true;
            this.camera.setTorch(true).then((ok) => {
              if (ok) {
                this.torchBtn.classList.add('torch-btn--active');
                this.setToast('Low light: Flash enabled', ICONS.lightbulb(18));
                this.tts.speakPolite('Low light. Flash turned on.');
              }
            });
          }
          
          const hint = this.hints.generateHint(currentQuality);
          if (hint) {
            this.setToast(hint, ICONS.ruler(18));
            this.tts.speakPolite(hint);
          }
          
          // Continuous Real-Time Extraction
          if (frames.length >= 1 && (currentQuality.composite > 0.15 || currentQuality.sharpness > 30) && !this.isExtracting) {
            this.isExtracting = true;
            console.log('[Scan] Triggering extraction, frames:', frames.length,
              'composite:', currentQuality.composite.toFixed(3),
              'coverage:', currentQuality.coverage.toFixed(3),
              'sharpness:', currentQuality.sharpness.toFixed(1));
            this.pipeline.extractBuffered().then((res) => {
               this.isExtracting = false;
               
               const allText = bestScannedText(res.texts);
               console.log('[Scan] OCR result text length:', allText.length, 'text:', JSON.stringify(allText.slice(0, 200)));
               if (allText.replace(/[^a-z0-9]/gi, '').length < 2) return;

               if (isLikelyClinicalDocument(allText)) {
                 this.showDocumentResult(allText);
                 return;
               }

               this.queryDb(allText);
            });
          }
        }
      }
    }
    
    this.rafId = requestAnimationFrame(this.loop);
  };
  
  private setToast(msg: string, iconHtml?: string) {
    if (this.toastIcon) this.toastIcon.innerHTML = iconHtml || ICONS.sparkle(18);
    if (this.toastMsg) this.toastMsg.textContent = msg;
    this.visualToast.hidden = false;
  }

  private resetUI() {
    this.visualToast.hidden = true;
    this.resultsCard.hidden = true;
    if (this.scannerReticle) {
      this.scannerReticle.classList.remove('reticle--locked');
    }
    if (this.scannerLaser) {
      this.scannerLaser.hidden = true;
    }
    if (this.resAccordion) {
      this.resAccordion.hidden = true;
      this.resAccordion.open = false;
    }
    if (this.resDescription) {
      this.resDescription.textContent = '';
    }
    this.scanBtnText.textContent = 'Start Scan';
    this.scanBtnIcon.innerHTML = ICONS.zap(20);
    this.triggerBtn.removeAttribute('disabled');
  }

  private configureMedicineResult() {
    this.resultCategory.textContent = 'Identified Medicine';
    this.strengthLabel.textContent = 'Dosage / Strength';
    this.expiryLabel.textContent = 'Expiry Date';
    this.accordionTitle.textContent = 'Verified Medicine Details';
    this.resReplayBtn.setAttribute('aria-label', 'Replay medicine summary');
    this.resCopyBtn.setAttribute('aria-label', 'Copy medicine details');
  }

  private showDocumentResult(text: string) {
    if (this.state !== 'Guidance') return;
    this.readoutKind = 'document';
    this.fullReadoutText = text;
    this.resultCategory.textContent = 'Detected Document';
    this.resBrand.textContent = isLikelyClinicalDocument(text) ? 'Clinical Report' : 'Printed Document';
    this.strengthLabel.textContent = 'Content';
    this.resStrength.textContent = 'Full text';
    this.expiryLabel.textContent = 'Readout';
    this.resExpiry.textContent = 'Complete';
    this.resStatus.textContent = 'Ready';
    this.resStatus.className = 'status-badge';
    this.accordionTitle.textContent = 'Full Report Text';
    this.resDescription.textContent = text;
    this.resAccordion.hidden = false;
    this.resAccordion.open = true;
    this.resReplayBtn.setAttribute('aria-label', 'Read the full report aloud again');
    this.resCopyBtn.setAttribute('aria-label', 'Copy full report text');
    this.transitionTo('Readout');
  }

  private buildReadoutSpeech(): string {
    if (this.readoutKind === 'document') {
      return `Document detected. Reading the complete report. ${this.fullReadoutText}. End of report. Swipe up to scan another item.`;
    }

    const expiryText = this.resExpiry.textContent || 'Not specified';
    let speech = `${this.resBrand.textContent}. Strength: ${this.resStrength.textContent}. Expiry: ${expiryText}.`;
    const details = this.resDescription.textContent?.trim();
    if (details) speech += ` ${details}.`;
    speech += ' Swipe up to scan another item.';
    return speech;
  }

  // Enhanced ARIA with state transition announcements
  private updateAria() {
    if (this.state === 'Idle' || this.state === 'Readout') {
       this.triggerBtn.setAttribute('aria-label', this.state === 'Idle' ? "Start Scan" : "Scan Again");
    } else if (this.state === 'Guidance') {
       this.triggerBtn.setAttribute('aria-label', "Stop Scan");
    }
    
    const announcements: Record<AppState, string> = {
      'Idle': 'Scanning stopped.',
      'Guidance': 'Scanning started. Hold a medicine or medical report inside the frame and follow audio guidance.',
      'Readout': this.readoutKind === 'document' ? 'Document text ready.' : 'Medicine information ready.',
    };
    this.liveAssertive.textContent = announcements[this.state];
  }

  public async toggleTorch(): Promise<boolean> {
    if (this.state === 'Idle') {
      this.setToast('Start scan first to use flash', ICONS.flashlight(18));
      this.tts.speakPolite('Start scan first to use flash');
      return false;
    }
    this.autoTorchTriggered = true;
    const nextState = !this.camera.isTorchOn;
    const ok = await this.camera.setTorch(nextState);
    if (ok) {
      this.torchBtn.classList.toggle('torch-btn--active', nextState);
      this.setToast(nextState ? 'Flash ON' : 'Flash OFF', ICONS.flashlight(18));
      this.tts.speakPolite(nextState ? 'Flash on' : 'Flash off');
      if ('vibrate' in navigator) {
        try { navigator.vibrate(nextState ? [50, 50] : [30]); } catch {}
      }
    } else {
      this.setToast('Flash not available on this device', ICONS.warning(18));
    }
    return ok;
  }

  private speakFullInstructions() {
    if (this.state !== 'Readout') return;

    if (this.readoutKind === 'document') {
      this.resAccordion.open = true;
      this.setToast('Reading full report...', ICONS.document(18));
      this.tts.speakAssertive(this.buildReadoutSpeech());
      return;
    }

    const brand = this.resBrand.textContent || 'Identified medicine';
    const strength = this.resStrength.textContent || '';
    const expiry = this.resExpiry.textContent || '';
    const desc = this.resDescription.textContent?.replace(/^Directions & Details:\s*/i, '').trim();

    if ('vibrate' in navigator) {
      try { navigator.vibrate([60, 40, 100]); } catch {}
    }

    if (this.resAccordion && !this.resAccordion.hidden) {
      this.resAccordion.open = true;
    }
    this.setToast('Reading full instructions...', ICONS.info(18));

    let speech = `Detailed clinical instructions for ${brand}. `;
    if (strength && strength !== '--') {
      speech += `Strength: ${strength}. `;
    }
    if (expiry) {
      speech += `Expiry status: ${expiry}. `;
    }
    if (desc && desc.length > 0) {
      speech += `Directions and precautions: ${desc}. `;
    } else {
      speech += `Standard packaging. No additional clinical warnings or directions on label. `;
    }
    speech += `Swipe down to silence, or swipe up to scan another item.`;

    this.tts.speakAssertive(speech);
  }

  private async handleDeviceShake() {
    if ('vibrate' in navigator) {
      try { navigator.vibrate([50, 40, 80]); } catch {}
    }

    if (this.state === 'Guidance') {
      await this.toggleTorch();
    } else if (this.state === 'Readout') {
      this.speakFullInstructions();
    } else if (this.state === 'Idle') {
      this.transitionTo('Guidance');
    }
  }

  private setupGestures() {
    let lastTapTime = 0;
    let singleTapTimer: ReturnType<typeof setTimeout> | null = null;
    let longPressTimer: ReturnType<typeof setTimeout> | null = null;
    let startX = 0;
    let startY = 0;
    let startTime = 0;
    let longPressTriggered = false;

    const onPointerDown = (e: PointerEvent) => {
      // Don't intercept explicit interactive buttons/inputs/controls
      if ((e.target as HTMLElement).closest('#torch-btn, #res-replay-btn, #res-copy-btn, summary, details, button, select, input, a')) {
        return;
      }

      startX = e.clientX;
      startY = e.clientY;
      startTime = Date.now();
      longPressTriggered = false;

      // Start long-press timer (600ms hold)
      if (longPressTimer) clearTimeout(longPressTimer);
      longPressTimer = setTimeout(() => {
        longPressTriggered = true;
        if (singleTapTimer) {
          clearTimeout(singleTapTimer);
          singleTapTimer = null;
        }

        if (this.state === 'Readout') {
          this.speakFullInstructions();
        } else if (this.state === 'Guidance') {
          this.toggleTorch();
        } else if (this.state === 'Idle') {
          this.tts.speakPolite('EchoSight ready. Double tap or swipe up to scan a medicine or medical report.');
        }

        if ('vibrate' in navigator) {
          try { navigator.vibrate([60, 40, 100]); } catch {}
        }
      }, 600);
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!startTime) return;
      const moveDist = Math.hypot(e.clientX - startX, e.clientY - startY);
      // Cancel long press if finger moved more than 15px
      if (moveDist > 15 && longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
    };

    const onPointerUp = async (e: PointerEvent) => {
      if (!startTime) return;
      if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }

      if (longPressTriggered) {
        longPressTriggered = false;
        startTime = 0;
        return;
      }

      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      const dist = Math.hypot(dx, dy);
      const elapsed = Date.now() - startTime;
      startTime = 0;

      // Swipe Detection (>45px movement within 650ms)
      if (dist > 45 && elapsed < 650) {
        if (singleTapTimer) {
          clearTimeout(singleTapTimer);
          singleTapTimer = null;
        }
        lastTapTime = 0;

        if (Math.abs(dy) > Math.abs(dx)) {
          // Vertical swipe
          if (dy > 45) {
            // Swipe Down: Instant Emergency Silence
            this.tts.clear();
            this.setToast('Speech silenced', ICONS.swipeDown(18));
            if ('vibrate' in navigator) {
              try { navigator.vibrate([30, 30]); } catch {}
            }
          } else if (dy < -45) {
            // Swipe Up: Start scanning or next medicine
            if (this.state === 'Readout' || this.state === 'Idle') {
              this.setToast('Starting scan...', ICONS.zap(18));
              this.transitionTo('Guidance');
            } else if (this.state === 'Guidance') {
              this.hints.resetThrottle();
              this.tts.speakPolite('Guiding. Hold the medicine or report steady inside the frame.');
            }
          }
        } else {
          this.tts.speakPolite('One scanner now detects medicines and medical reports automatically.');
        }
        return;
      }

      // Tap & Double Tap Detection
      if (dist <= 15) {
        const now = Date.now();
        const timeSinceLast = now - lastTapTime;

        if (timeSinceLast > 40 && timeSinceLast < 380) {
          // Double-tap detected
          if (singleTapTimer) {
            clearTimeout(singleTapTimer);
            singleTapTimer = null;
          }
          lastTapTime = 0;

          if (this.state === 'Readout') {
            // User requested: Double tap reads detailed clinical usage and instructions!
            this.speakFullInstructions();
          } else if (this.state === 'Idle') {
            this.transitionTo('Guidance');
          } else if (this.state === 'Guidance') {
            this.transitionTo('Idle');
          }

          if ('vibrate' in navigator) {
            try { navigator.vibrate([40, 40]); } catch {}
          }
          return;
        }

        lastTapTime = now;

        // Calculate relative coordinates in camera viewport
        const rect = this.cameraContainer.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const normX = Math.min(Math.max(x / rect.width, 0), 1);
        const normY = Math.min(Math.max(y / rect.height, 0), 1);

        singleTapTimer = setTimeout(async () => {
          if (this.state === 'Guidance') {
            // Visual focus ring animation
            this.focusRing.style.left = `${x}px`;
            this.focusRing.style.top = `${y}px`;
            this.focusRing.hidden = false;
            this.focusRing.classList.remove('focus-ring--active');
            void this.focusRing.offsetWidth;
            this.focusRing.classList.add('focus-ring--active');

            if ('vibrate' in navigator) {
              try { navigator.vibrate(35); } catch {}
            }

            setTimeout(() => {
              this.focusRing.classList.remove('focus-ring--active');
              setTimeout(() => { this.focusRing.hidden = true; }, 250);
            }, 600);

            this.setToast('Focusing camera...', ICONS.target(18));
            const ok = await this.camera.triggerFocus({ x: normX, y: normY });
            if (ok) {
              this.setToast('Focused', ICONS.check(18));
            }
          } else if (this.state === 'Readout') {
            this.tts.speakAssertive(this.buildReadoutSpeech());
            if ('vibrate' in navigator) {
              try { navigator.vibrate(30); } catch {}
            }
          } else if (this.state === 'Idle') {
            this.tts.speakPolite('EchoSight ready. Double tap to scan a medicine or medical report.');
          }
        }, 280);
      }
    };

    const onPointerCancel = () => {
      if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
      startTime = 0;
      longPressTriggered = false;
    };

    // Attach to camera container and results card
    [this.cameraContainer, this.resultsCard].forEach(elem => {
      elem.addEventListener('pointerdown', onPointerDown);
      elem.addEventListener('pointermove', onPointerMove);
      elem.addEventListener('pointerup', onPointerUp);
      elem.addEventListener('pointercancel', onPointerCancel);
    });

    // Device Shake Gesture
    let lastShakeTime = 0;
    let lastX = 0, lastY = 0, lastZ = 0;

    if (typeof window !== 'undefined' && 'DeviceMotionEvent' in window) {
      window.addEventListener('devicemotion', (event) => {
        const acc = event.accelerationIncludingGravity;
        if (!acc || acc.x === null || acc.y === null || acc.z === null) return;

        const now = Date.now();
        if (now - lastShakeTime < 1500) return; // 1.5s debounce

        const deltaX = Math.abs(acc.x - lastX);
        const deltaY = Math.abs(acc.y - lastY);
        const deltaZ = Math.abs(acc.z - lastZ);

        lastX = acc.x;
        lastY = acc.y;
        lastZ = acc.z;

        if (deltaX + deltaY + deltaZ > 28) {
          lastShakeTime = now;
          this.handleDeviceShake();
        }
      }, { passive: true });
    }
  }
}
