export class CameraStream {
  private videoEl: HTMLVideoElement;
  private stream: MediaStream | null = null;
  private isRunning = false;
  private _isTorchOn = false;

  constructor(videoElementId: string) {
    this.videoEl = document.getElementById(videoElementId) as HTMLVideoElement;
    if (!this.videoEl) {
      throw new Error(`Video element #${videoElementId} not found`);
    }
  }

  async start(): Promise<void> {
    if (this.isRunning) return;
    
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'environment',
          width: { ideal: 1280 },
          height: { ideal: 720 },
          // Request continuous auto-focus if supported by the browser
          // @ts-ignore
          focusMode: { ideal: 'continuous' }
        },
        audio: false
      });
      
      this.videoEl.srcObject = this.stream;
      
      return new Promise((resolve) => {
        this.videoEl.onloadedmetadata = () => {
          this.videoEl.play();
          this.isRunning = true;
          resolve();
        };
      });
    } catch (err) {
      console.error('Camera access denied or unavailable', err);
      throw new Error('CAMERA_DENIED');
    }
  }

  stop(): void {
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }
    this.videoEl.srcObject = null;
    this.isRunning = false;
    this._isTorchOn = false;
  }

  /**
   * Captures the current frame as an ImageBitmap.
   * Useful for passing to Workers without cloning overhead.
   */
  async grabFrame(): Promise<ImageBitmap | null> {
    if (!this.isRunning || !this.videoEl.videoWidth) return null;
    return createImageBitmap(this.videoEl);
  }

  /**
   * Checks if the active camera supports torch/flash mode.
   */
  hasTorch(): boolean {
    if (!this.stream) {
      // Check device constraint support if stream isn't open yet
      const supported = (navigator.mediaDevices && navigator.mediaDevices.getSupportedConstraints)
        ? (navigator.mediaDevices.getSupportedConstraints() as any)
        : {};
      return Boolean(supported.torch);
    }
    const track = this.stream.getVideoTracks()[0];
    if (!track) return false;
    const capabilities = (track.getCapabilities ? track.getCapabilities() : {}) as any;
    if (typeof capabilities.torch === 'boolean') {
      return capabilities.torch;
    }
    const supported = (navigator.mediaDevices && navigator.mediaDevices.getSupportedConstraints)
      ? (navigator.mediaDevices.getSupportedConstraints() as any)
      : {};
    return Boolean(supported.torch);
  }

  get isTorchOn(): boolean {
    return this._isTorchOn;
  }

  /**
   * Turns the camera flash/torch on or off.
   */
  async setTorch(enabled: boolean): Promise<boolean> {
    if (!this.stream) {
      try {
        await this.start();
      } catch {
        return false;
      }
    }
    const track = this.stream?.getVideoTracks()[0];
    if (!track) return false;

    try {
      await (track as any).applyConstraints({
        advanced: [{ torch: enabled }]
      });
      this._isTorchOn = enabled;
      return true;
    } catch (err) {
      console.warn('[Camera] Standard torch constraint failed, trying fallback:', err);
      try {
        await (track as any).applyConstraints({
          // @ts-ignore
          torch: enabled
        });
        this._isTorchOn = enabled;
        return true;
      } catch (err2) {
        console.warn('[Camera] Fallback torch failed:', err2);
        return false;
      }
    }
  }

  /**
   * Triggers re-focusing, optionally at a specific normalized tap point (0.0 to 1.0).
   */
  async triggerFocus(point?: { x: number; y: number }): Promise<void> {
    if (!this.stream) return;
    const track = this.stream.getVideoTracks()[0];
    if (!track) return;

    const capabilities = (track.getCapabilities ? track.getCapabilities() : {}) as any;

    try {
      const advancedConstraints: any = {};
      
      if (capabilities.focusMode && capabilities.focusMode.includes('continuous')) {
        advancedConstraints.focusMode = 'continuous';
      } else if (capabilities.focusMode && capabilities.focusMode.includes('single-shot')) {
        advancedConstraints.focusMode = 'single-shot';
      }

      if (point && capabilities.pointsOfInterest) {
        advancedConstraints.pointsOfInterest = [{ x: point.x, y: point.y }];
      }

      if (Object.keys(advancedConstraints).length > 0) {
        await (track as any).applyConstraints({
          advanced: [advancedConstraints]
        });
      }
    } catch (err) {
      console.warn('[Camera] Tap-to-focus constraint error:', err);
    }
  }
}
