import { TtsManager } from '../speech/tts-manager';
import { SonificationEngine } from '../guidance/sonification';
import { HintGenerator } from '../guidance/hints';
import { ExtractionPipeline } from '../camera/pipeline';
import { CameraStream } from '../camera/stream';
import { vibrateLock, vibrateSuccess, vibrateError } from '../guidance/vibration';

export type AppState = 'Idle' | 'Guidance' | 'Readout';

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
  private visualToast: HTMLElement;
  private resultsCard: HTMLElement;
  private resBrand: HTMLElement;
  private resStrength: HTMLElement;
  private resExpiry: HTMLElement;
  private resStatus: HTMLElement;
  private scanInstructions: HTMLElement;
  // Task 1.3: ARIA live region for assertive announcements
  private liveAssertive: HTMLElement;
  private cameraContainer: HTMLElement;
  private focusRing: HTMLElement;
  private torchBtn: HTMLElement;
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
    this.visualToast = document.getElementById('visual-toast')!;
    this.resultsCard = document.getElementById('results-card')!;
    this.resBrand = document.getElementById('res-brand')!;
    this.resStrength = document.getElementById('res-strength')!;
    this.resExpiry = document.getElementById('res-expiry')!;
    this.resStatus = document.getElementById('res-status')!;
    this.scanInstructions = document.getElementById('scan-instructions')!;
    this.liveAssertive = document.getElementById('live-assertive')!;
    this.cameraContainer = document.getElementById('camera-container')!;
    this.focusRing = document.getElementById('focus-ring')!;
    this.torchBtn = document.getElementById('torch-btn')!;

    // Tap on camera screen to focus
    this.cameraContainer.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).closest('#torch-btn')) return;

      const rect = this.cameraContainer.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const normX = Math.min(Math.max(x / rect.width, 0), 1);
      const normY = Math.min(Math.max(y / rect.height, 0), 1);

      this.focusRing.style.left = `${x}px`;
      this.focusRing.style.top = `${y}px`;
      this.focusRing.hidden = false;
      this.focusRing.classList.remove('focus-ring--active');
      void this.focusRing.offsetWidth; // force DOM reflow
      this.focusRing.classList.add('focus-ring--active');

      setTimeout(() => {
        this.focusRing.classList.remove('focus-ring--active');
        setTimeout(() => { this.focusRing.hidden = true; }, 250);
      }, 600);

      this.camera.triggerFocus({ x: normX, y: normY });
    });

    // Manual torch / flash button
    this.torchBtn.addEventListener('click', async () => {
      this.autoTorchTriggered = true;
      const nextState = !this.camera.isTorchOn;
      const ok = await this.camera.setTorch(nextState);
      if (ok) {
        this.torchBtn.classList.toggle('torch-btn--active', nextState);
        this.setToast(nextState ? 'Flash ON' : 'Flash OFF');
      } else {
        this.setToast('Flash not available on this device');
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
             if (count >= 2) {
               consensusBrand = brand;
               // Pick the strength from the most recent read of this brand
               const lastRead = [...this.accumulatedReads].reverse().find(r => r.brand_name === brand);
               if (lastRead) bestStrength = lastRead.strength;
               break;
             }
          }
          
          if (consensusBrand) {
            this.resBrand.textContent = consensusBrand;
            this.resStrength.textContent = bestStrength ? `Strength: ${bestStrength}` : 'Strength: Unknown';
            
            // Gap 1: Extract and display expiry date from accumulated reads
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
                ? `⚠️ EXPIRED: ${monthNames[month-1]} ${year}` 
                : `Expiry: ${monthNames[month-1]} ${year} ✓`;
              
              if (isExpired) {
                this.resStatus.textContent = "Expired";
                this.resStatus.className = "status-badge invalid";
              } else {
                this.resStatus.textContent = "Valid";
                this.resStatus.className = "status-badge";
              }
            } else {
              this.resExpiry.textContent = "Expiry: Not found on label";
              this.resStatus.textContent = "Valid";
              this.resStatus.className = "status-badge";
            }
            
            this.transitionTo('Readout');
          } else {
            console.log('[Scan] Waiting for consensus... reads:', this.accumulatedReads.map(r => r.brand_name));
            
            // Task 1.3: Safe Abstention Gate — after 10 failed consensus attempts
            this.consensusAttempts++;
            if (this.consensusAttempts >= 10) {
              this.liveAssertive.textContent = 'Unable to verify medicine. Please seek human assistance.';
              this.tts.speakAssertive('Unable to verify medicine. Please seek human assistance.');
              vibrateError();
              this.transitionTo('Idle');
            }
          }
        } else if (!found && this.state === 'Guidance') {
          // No match at all — also counts toward abstention
          this.consensusAttempts++;
          if (this.consensusAttempts >= 10) {
            this.liveAssertive.textContent = 'Unable to verify medicine. Please seek human assistance.';
            this.tts.speakAssertive('Unable to verify medicine. Please seek human assistance.');
            vibrateError();
            this.transitionTo('Idle');
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

  /** Terminate DB worker and free its ~20-50MB of WASM + DB memory */
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
        // Tear down pipeline (terminates Tesseract/ONNX worker) and DB worker to free memory
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
        this.accumulatedReads = [];  // Clear previous consensus
        this.consensusAttempts = 0;  // Reset abstention counter
        this.triggerBtn.textContent = 'Stop Scan (Scanning...)';
        
        // Task 1.2: Branch based on mode
        if (this.mode === 'medicine') {
          // Medicine Mode: ONNX pipeline (or Tesseract fallback), NO Otsu, PSM 11 (sparse scene text), DB worker
          this.pipeline = new ExtractionPipeline('onnx', '11', false);
          this.ensureDbWorker();
        } else {
          // Document Mode: Tesseract PSM 3 only with Otsu, NO DB worker (saves memory)
          this.pipeline = new ExtractionPipeline('tesseract', '3', true);
        }
        
        await this.camera.start();
        await this.sonification.init();
        
        // Only unmute the buzzing if TalkBack (Screen Reader) mode is active
        if (this.tts.talkbackMode) {
          this.sonification.unmute();
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
        vibrateSuccess();  // Task 4.2: haptic on success
        if (this.camera.isTorchOn) {
          this.camera.setTorch(false);
          this.torchBtn.classList.remove('torch-btn--active');
        }
        this.camera.stop();
        this.sonification.mute();
        this.resultsCard.hidden = false;
        this.triggerBtn.removeAttribute('disabled');
        this.triggerBtn.textContent = 'Scan Again';
        cancelAnimationFrame(this.rafId);
        // Tear down pipeline to free Tesseract/ONNX memory
        if (this.pipeline) {
          this.pipeline.destroy();
          this.pipeline = null;
        }
        // Keep DB worker alive for quick re-scans, tear down on Idle
        
        // Build speech string including expiry info
        const expiryText = this.resExpiry.textContent || '';
        const readStr = `${this.resBrand.textContent}. ${this.resStrength.textContent}. ${expiryText}.`;
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
    
    // Phase 4B: Frame Throttling to 5 fps (200ms)
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
          
          // Task 4.2: Haptic lock pulse when framing is excellent
          if (currentQuality.composite > 0.9) {
            vibrateLock();
          }

          // Low-light auto torch trigger (luminance < 45 on 0-255 scale)
          if (currentQuality.luminance < 45 && !this.autoTorchTriggered && this.camera.hasTorch()) {
            this.autoTorchTriggered = true;
            this.camera.setTorch(true).then((ok) => {
              if (ok) {
                this.torchBtn.classList.add('torch-btn--active');
                this.setToast('Low light: Flash enabled');
                this.tts.speakPolite('Low light. Flash turned on.');
              }
            });
          }
          
          const hint = this.hints.generateHint(currentQuality);
          if (hint) {
            this.setToast(hint);
            this.tts.speakPolite(hint);
          }
          
          // Continuous Real-Time Extraction
          if (frames.length >= 2 && currentQuality.composite > 0.35 && !this.isExtracting) {
            this.isExtracting = true;
            console.log('[Scan] Triggering extraction, frames:', frames.length,
              'composite:', currentQuality.composite.toFixed(3),
              'coverage:', currentQuality.coverage.toFixed(3),
              'sharpness:', currentQuality.sharpness.toFixed(1));
            this.pipeline.extractBuffered().then((res) => {
               this.isExtracting = false;
               
               const allText = res.texts.join(' ').toLowerCase();
               console.log('[Scan] OCR result text length:', allText.length, 'text:', JSON.stringify(allText.slice(0, 200)));
               if (allText.length < 3) return; // ignore empty
               
               // Task 1.2: Branch based on mode
               if (this.mode === 'document') {
                 // Document Mode: speak text verbatim, no DB lookup
                 this.resBrand.textContent = 'Document Text';
                 this.resStrength.textContent = allText.slice(0, 500);
                 this.resExpiry.textContent = '';
                 this.resStatus.textContent = 'Read';
                 this.resStatus.className = 'status-badge';
                 this.transitionTo('Readout');
                 this.tts.speakAssertive(allText);
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
  
  private setToast(msg: string) {
    this.visualToast.textContent = msg;
    this.visualToast.hidden = false;
  }

  private resetUI() {
    this.visualToast.hidden = true;
    this.resultsCard.hidden = true;
    this.triggerBtn.textContent = 'Start Scan';
    this.triggerBtn.removeAttribute('disabled');
  }

  // Task 1.3: Enhanced ARIA with state transition announcements
  private updateAria() {
    if (this.state === 'Idle' || this.state === 'Readout') {
       this.triggerBtn.setAttribute('aria-label', this.state === 'Idle' ? "Start Scan" : "Scan Again");
    } else if (this.state === 'Guidance') {
       this.triggerBtn.setAttribute('aria-label', "Stop Scan");
    }
    
    // Inject state transition text into ARIA live region for screen readers
    const announcements: Record<AppState, string> = {
      'Idle': 'Scanning stopped.',
      'Guidance': 'Scanning started. Follow audio guidance.',
      'Readout': `Medicine identified. ${this.resBrand.textContent}. ${this.resStrength.textContent}. ${this.resExpiry.textContent}.`,
    };
    this.liveAssertive.textContent = announcements[this.state];
  }
}
