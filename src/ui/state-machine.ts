import { TtsManager } from '../speech/tts-manager';
import { SonificationEngine } from '../guidance/sonification';
import { HintGenerator } from '../guidance/hints';
import { ExtractionPipeline } from '../camera/pipeline';
import { CameraStream } from '../camera/stream';
import { vibrateLock, vibrateSuccess, vibrateError } from '../guidance/vibration';

export type AppState = 'Idle' | 'Guidance' | 'Readout';

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
  
  // Task 1.2: Document/Medicine mode
  private mode: 'document' | 'medicine' = 'medicine';
  
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
      this.soundIcon.textContent = isMuted ? '🔇' : '🔊';
      this.soundBtn.setAttribute('aria-label', isMuted ? 'Unmute Audio Guidance Tone' : 'Mute Audio Guidance Tone');
      this.setToast(isMuted ? 'Guidance Tone Muted' : 'Guidance Tone On', isMuted ? '🔇' : '🔊');
      if ('vibrate' in navigator) {
        try { navigator.vibrate(35); } catch {}
      }
    });

    // Replay speech button
    this.resReplayBtn.addEventListener('click', () => {
      const expiryText = this.resExpiry.textContent || '';
      const readStr = `${this.resBrand.textContent}. Strength: ${this.resStrength.textContent}. Expiry: ${expiryText}.`;
      this.tts.speakAssertive(readStr);
      if ('vibrate' in navigator) {
        try { navigator.vibrate(30); } catch {}
      }
    });

    // Copy prescription info to clipboard
    this.resCopyBtn.addEventListener('click', async () => {
      const textToCopy = `MedReader Prescription Info:\nBrand: ${this.resBrand.textContent}\nStrength: ${this.resStrength.textContent}\nExpiry: ${this.resExpiry.textContent}\n${this.resDescription.textContent ? 'Details: ' + this.resDescription.textContent : ''}`;
      try {
        await navigator.clipboard.writeText(textToCopy);
        this.setToast('Copied to clipboard! ✓', '📋');
      } catch (err) {
        this.setToast('Failed to copy', '❌');
      }
      if ('vibrate' in navigator) {
        try { navigator.vibrate(35); } catch {}
      }
    });

    // Tap / Double-tap on camera screen
    let lastTapTime = 0;
    let singleTapTimer: ReturnType<typeof setTimeout> | null = null;

    this.cameraContainer.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).closest('#torch-btn')) return;

      const now = Date.now();
      const timeSinceLast = now - lastTapTime;

      // Double-tap threshold (40ms - 350ms): toggle scan
      if (timeSinceLast > 40 && timeSinceLast < 350) {
        if (singleTapTimer) {
          clearTimeout(singleTapTimer);
          singleTapTimer = null;
        }
        lastTapTime = 0;

        if (this.state === 'Idle' || this.state === 'Readout') {
          this.transitionTo('Guidance');
        } else if (this.state === 'Guidance') {
          this.transitionTo('Idle');
        }
        return;
      }

      lastTapTime = now;

      // Single tap (focus): delay slightly to allow double-tap detection
      const rect = this.cameraContainer.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const normX = Math.min(Math.max(x / rect.width, 0), 1);
      const normY = Math.min(Math.max(y / rect.height, 0), 1);

      singleTapTimer = setTimeout(async () => {
        this.focusRing.style.left = `${x}px`;
        this.focusRing.style.top = `${y}px`;
        this.focusRing.hidden = false;
        this.focusRing.classList.remove('focus-ring--active');
        void this.focusRing.offsetWidth; // force DOM reflow
        this.focusRing.classList.add('focus-ring--active');

        // Tactile click haptic on tap
        if ('vibrate' in navigator) {
          try { navigator.vibrate(35); } catch {}
        }

        setTimeout(() => {
          this.focusRing.classList.remove('focus-ring--active');
          setTimeout(() => { this.focusRing.hidden = true; }, 250);
        }, 600);

        if (this.state === 'Guidance') {
          this.setToast('Focusing camera...', '🔍');
          const ok = await this.camera.triggerFocus({ x: normX, y: normY });
          if (ok) {
            this.setToast('Focused ✓', '🎯');
          }
        }
      }, 280);
    });

    // Manual torch / flash button
    this.torchBtn.addEventListener('click', async () => {
      if (this.state === 'Idle') {
        this.setToast('Start scan first to use flash', '🔦');
        this.tts.speakPolite('Start scan first to use flash');
        return;
      }
      this.autoTorchTriggered = true;
      const nextState = !this.camera.isTorchOn;
      const ok = await this.camera.setTorch(nextState);
      if (ok) {
        this.torchBtn.classList.toggle('torch-btn--active', nextState);
        this.setToast(nextState ? 'Flash ON' : 'Flash OFF', '🔦');
        this.tts.speakPolite(nextState ? 'Flash on' : 'Flash off');
      } else {
        this.setToast('Flash not available on this device', '⚠️');
      }
    });

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

    // Task 1.2: Wire mode toggle buttons
    const modeButtons = document.querySelectorAll('#mode-toggle .mode-btn');
    modeButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const newMode = (btn as HTMLElement).dataset.mode as 'document' | 'medicine';
        if (newMode === this.mode) return;
        this.mode = newMode;
        
        // Update ARIA states
        modeButtons.forEach(b => {
          b.setAttribute('aria-checked', b === btn ? 'true' : 'false');
          b.classList.toggle('mode-btn--active', b === btn);
        });
        
        // If currently scanning, restart with new mode
        if (this.state === 'Guidance') {
          this.transitionTo('Idle');
          this.transitionTo('Guidance');
        }
      });
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
      } else if (e.data.type === 'query_result') {
        const found = e.data.result;
        
        if (found && this.state === 'Guidance') {
          // Phase 5: Accumulate reads for voting (Rolling window of 5)
          this.accumulatedReads.push(found);
          if (this.accumulatedReads.length > 5) {
             this.accumulatedReads.shift();
          }
          
          // Check for consensus (2 out of 5 frames must agree on the brand name)
          const brandCounts = new Map<string, number>();
          for (const read of this.accumulatedReads) {
             brandCounts.set(read.brand_name, (brandCounts.get(read.brand_name) || 0) + 1);
          }
          
          let consensusBrand = null;
          let bestStrength = '';
          for (const [brand, count] of brandCounts.entries()) {
             // Confirm if 2 frames agree, or on distance <= 0.5 (strong match)
             if (count >= 2 || (found.distance <= 0.5 && this.accumulatedReads.length >= 1)) {
               consensusBrand = brand;
               const lastRead = [...this.accumulatedReads].reverse().find(r => r.brand_name === brand);
               if (lastRead) bestStrength = lastRead.strength;
               break;
             }
          }
          
          if (consensusBrand) {
            this.resBrand.textContent = consensusBrand;
            const { dosage, usage } = parseDosageAndUsage(bestStrength);
            this.resStrength.textContent = dosage || 'Standard';
            
            if (usage && usage.length > 40) {
              this.resDescription.innerHTML = `<strong>ℹ️ Directions & Details:</strong><br/>${usage}`;
              this.resAccordion.hidden = false;
              this.resAccordion.open = false;
            } else {
              this.resDescription.innerHTML = '';
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
                : `${monthNames[month-1]} ${year} ✓`;
              
              if (isExpired) {
                this.resStatus.textContent = "Expired";
                this.resStatus.className = "status-badge invalid";
              } else {
                this.resStatus.textContent = "Valid";
                this.resStatus.className = "status-badge";
              }
            } else {
              this.resExpiry.textContent = "Not specified";
              this.resStatus.textContent = "Valid";
              this.resStatus.className = "status-badge";
            }
            
            this.transitionTo('Readout');
          } else {
            console.log('[Scan] Waiting for consensus... reads:', this.accumulatedReads.map(r => r.brand_name));
            this.consensusAttempts++;
            if (this.consensusAttempts >= 120) {
              this.liveAssertive.textContent = 'Unable to verify medicine. Please seek human assistance.';
              this.tts.speakAssertive('Unable to verify medicine. Please seek human assistance.');
              vibrateError();
              this.transitionTo('Idle');
            }
          }
        } else if (!found && this.state === 'Guidance') {
          // No match at all — give user at least 25-30 seconds (120 frames) of guidance
          this.consensusAttempts++;
          if (this.consensusAttempts >= 120) {
            this.liveAssertive.textContent = 'Unable to verify medicine. Please seek human assistance.';
            this.tts.speakAssertive('Unable to verify medicine. Please seek human assistance.');
            vibrateError();
            this.transitionTo('Idle');
          } else if (this.consensusAttempts > 0 && this.consensusAttempts % 35 === 0) {
            this.tts.speakPolite('Scanning medicine... hold steady.');
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
        this.scanBtnIcon.textContent = '🛑';
        if (this.scannerLaser) this.scannerLaser.hidden = false;
        
        // Task 1.2: Branch based on mode
        if (this.mode === 'medicine') {
          this.pipeline = new ExtractionPipeline('tesseract', '3', false);
          this.ensureDbWorker();
        } else {
          this.pipeline = new ExtractionPipeline('tesseract', '3', true);
        }
        
        await this.camera.start();
        await this.sonification.init();
        
        // Only unmute if TalkBack mode active or user unmuted via header
        if (this.tts.talkbackMode) {
          this.sonification.unmute();
          this.soundIcon.textContent = '🔊';
        }
        
        this.hints.resetThrottle();
        this.capturingFrames = 0;
        this.lastCaptureTime = 0;
        this.tts.speakPolite(
          this.mode === 'medicine'
            ? "Guiding. Hold the medicine steady."
            : "Guiding. Hold the document steady."
        );
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
        this.scanBtnIcon.textContent = '🔄';
        cancelAnimationFrame(this.rafId);
        if (this.pipeline) {
          this.pipeline.destroy();
          this.pipeline = null;
        }
        
        // Build concise speech string
        const expiryText = this.resExpiry.textContent || '';
        const readStr = `${this.resBrand.textContent}. Strength: ${this.resStrength.textContent}. Expiry: ${expiryText}.`;
        this.tts.speakAssertive(readStr);
        break;
    }
  }

  private isExtracting = false;
  private accumulatedReads: any[] = [];
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
                this.setToast('Low light: Flash enabled', '💡');
                this.tts.speakPolite('Low light. Flash turned on.');
              }
            });
          }
          
          const hint = this.hints.generateHint(currentQuality);
          if (hint) {
            this.setToast(hint, '📐');
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
               
               const allText = res.texts.join(' ').toLowerCase();
               console.log('[Scan] OCR result text length:', allText.length, 'text:', JSON.stringify(allText.slice(0, 200)));
               if (allText.replace(/[^a-z0-9]/g, '').length < 2) return;
               
               // Task 1.2: Branch based on mode
               if (this.mode === 'document') {
                 // Document Mode: speak text verbatim, no DB lookup
                 this.resBrand.textContent = 'Document Text';
                 this.resStrength.textContent = 'Document';
                 this.resExpiry.textContent = 'N/A';
                 this.resDescription.textContent = allText;
                 this.resAccordion.hidden = false;
                 this.resAccordion.open = true;
                 this.resStatus.textContent = 'Read';
                 this.resStatus.className = 'status-badge';
                 this.transitionTo('Readout');
                 this.tts.speakAssertive(allText.slice(0, 250));
                 return;
               }
               
               // Medicine Mode: query the DB for fuzzy matching
               this.queryDb(allText);
            });
          }
        }
      }
    }
    
    this.rafId = requestAnimationFrame(this.loop);
  };
  
  private setToast(msg: string, icon: string = '✨') {
    if (this.toastIcon) this.toastIcon.textContent = icon;
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
      this.resDescription.innerHTML = '';
    }
    this.scanBtnText.textContent = 'Start Scan';
    this.scanBtnIcon.textContent = '⚡';
    this.triggerBtn.removeAttribute('disabled');
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
      'Guidance': 'Scanning started. Follow audio guidance.',
      'Readout': `Medicine identified. ${this.resBrand.textContent}. Strength: ${this.resStrength.textContent}. Expiry: ${this.resExpiry.textContent}.`,
    };
    this.liveAssertive.textContent = announcements[this.state];
  }
}
