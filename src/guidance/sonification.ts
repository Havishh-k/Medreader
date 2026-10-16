import type { FrameQuality } from '../camera/frame-quality';

export class SonificationEngine {
  private ctx: AudioContext | null = null;
  private oscillator: OscillatorNode | null = null;
  private gainNode: GainNode | null = null;
  private panner: StereoPannerNode | null = null;
  
  private isMuted = true;
  private initialized = false;

  // Base frequency (e.g. 220Hz - A3) and max frequency (e.g. 880Hz - A5)
  private readonly MIN_FREQ = 220;
  private readonly MAX_FREQ = 880;

  public tickMode: boolean = false;
  private tickIntervalId: ReturnType<typeof setInterval> | null = null;
  private lastComposite: number = 0;

  async init(): Promise<void> {
    if (this.initialized) return;

    // Must be called on user interaction!
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    this.ctx = new AudioContextClass();
    
    // Resume context if suspended
    if (this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }

    this.gainNode = this.ctx.createGain();
    this.gainNode.gain.value = 0; // start muted

    this.panner = this.ctx.createStereoPanner();
    
    this.oscillator = this.ctx.createOscillator();
    this.oscillator.type = 'sine';
    this.oscillator.frequency.value = this.MIN_FREQ;

    // Connect graph: Osc -> Panner -> Gain -> Dest
    this.oscillator.connect(this.panner);
    this.panner.connect(this.gainNode);
    this.gainNode.connect(this.ctx.destination);

    this.oscillator.start();
    this.initialized = true;
  }

  setTickMode(enabled: boolean) {
    this.tickMode = enabled;
    if (!enabled && this.tickIntervalId !== null) {
      clearInterval(this.tickIntervalId);
      this.tickIntervalId = null;
      
      if (!this.isMuted && this.initialized && this.ctx) {
        this.gainNode!.gain.setTargetAtTime(0.3, this.ctx.currentTime, 0.05);
      }
    }
  }

  update(quality: FrameQuality) {
    if (!this.initialized || !this.ctx || this.isMuted) return;

    if (this.tickMode) {
      this.updateTick(quality);
    } else {
      this.updateContinuous(quality);
    }
  }

  private updateContinuous(quality: FrameQuality) {
    // Map composite score (0 to 1) to frequency logarithmically or linearly
    const targetFreq = this.MIN_FREQ + (quality.composite * (this.MAX_FREQ - this.MIN_FREQ));
    
    // Map centering (-1.0 to 1.0) directly to pan
    const targetPan = Math.max(-1.0, Math.min(1.0, quality.centering));

    const timeConstant = 0.05; // 50ms smoothing to prevent clicks
    const now = this.ctx!.currentTime;
    
    this.oscillator!.frequency.setTargetAtTime(targetFreq, now, timeConstant);
    this.panner!.pan.setTargetAtTime(targetPan, now, timeConstant);
  }

  private updateTick(quality: FrameQuality) {
    this.updateContinuous(quality);

    if (quality.composite >= 0.95) {
      if (this.tickIntervalId !== null) {
        clearInterval(this.tickIntervalId);
        this.tickIntervalId = null;
      }
      this.gainNode!.gain.setTargetAtTime(0.3, this.ctx!.currentTime, 0.05);
    } else {
      const nextInterval = Math.max(100, Math.round(1000 * (1 - quality.composite)));
      const prevInterval = Math.max(100, Math.round(1000 * (1 - this.lastComposite)));

      if (this.tickIntervalId === null || nextInterval !== prevInterval) {
        if (this.tickIntervalId !== null) {
          clearInterval(this.tickIntervalId);
        }
        this.tickIntervalId = setInterval(() => this.triggerTick(), nextInterval);
      }
    }
    
    this.lastComposite = quality.composite;
  }

  private triggerTick() {
    if (!this.initialized || !this.ctx || this.isMuted) return;
    const now = this.ctx.currentTime;
    
    this.gainNode!.gain.cancelScheduledValues(now);
    this.gainNode!.gain.setValueAtTime(this.gainNode!.gain.value, now);
    this.gainNode!.gain.linearRampToValueAtTime(0.3, now + 0.005);
    this.gainNode!.gain.linearRampToValueAtTime(0.3, now + 0.025);
    this.gainNode!.gain.linearRampToValueAtTime(0, now + 0.030);
  }

  mute() {
    if (!this.initialized || !this.ctx || this.isMuted) return;
    this.isMuted = true;
    
    if (this.tickIntervalId !== null) {
      clearInterval(this.tickIntervalId);
      this.tickIntervalId = null;
    }
    
    const now = this.ctx.currentTime;
    // Fast ramp to 0 to avoid clicks
    this.gainNode!.gain.setTargetAtTime(0, now, 0.02);
  }

  unmute() {
    if (!this.initialized || !this.ctx || !this.isMuted) return;
    this.isMuted = false;
    const now = this.ctx.currentTime;
    // Volume max 0.3 to avoid blasting user
    this.gainNode!.gain.setTargetAtTime(0.3, now, 0.05);
  }

  isCurrentlyMuted(): boolean {
    return this.isMuted;
  }

  toggleMute(): boolean {
    if (this.isMuted) {
      this.unmute();
    } else {
      this.mute();
    }
    return this.isMuted;
  }
}
