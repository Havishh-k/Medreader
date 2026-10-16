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
   * Forces the camera driver / Camera2 API to perform a physical lens autofocus sweep.
   */
  async triggerFocus(point?: { x: number; y: number }): Promise<boolean> {
    if (!this.stream) return false;
    const track = this.stream.getVideoTracks()[0];
    if (!track) return false;

    const capabilities = (track.getCapabilities ? track.getCapabilities() : {}) as any;

    // Strategy 1: Explicit 'single-shot' autofocus trigger (standard Camera2 AF sweep)
    try {
      const advanced: any = { focusMode: 'single-shot' };
      if (point && capabilities.pointsOfInterest) {
        advanced.pointsOfInterest = [{ x: point.x, y: point.y }];
      }
      await (track as any).applyConstraints({ advanced: [advanced] });
      console.log('[Camera] Triggered single-shot AF sweep');

      // Return to continuous auto-focus after the sweep completes
      setTimeout(async () => {
        try {
          await (track as any).applyConstraints({
            advanced: [{ focusMode: 'continuous' }]
          });
        } catch {}
      }, 1200);

      return true;
    } catch (err) {
      console.warn('[Camera] single-shot focus failed, trying focusMode cycling:', err);
    }

    // Strategy 2: Cycle focusMode ('manual' -> 'continuous') to force firmware re-metering
    try {
      await (track as any).applyConstraints({
        advanced: [{ focusMode: 'manual' }]
      });
      await (track as any).applyConstraints({
        advanced: [{ focusMode: 'continuous' }]
      });
      console.log('[Camera] Cycled focusMode to trigger re-focus');
      return true;
    } catch (err) {
      console.warn('[Camera] Focus mode cycling failed, trying macro focusDistance:', err);
    }

    // Strategy 3: If manual focusDistance is supported, set optimal reading distance (e.g. 15-20cm macro)
    if (capabilities.focusDistance) {
      try {
        const { min = 0, max = 10 } = capabilities.focusDistance;
        // Setting higher diopter value (e.g. 60-70% toward macro) brings close-up medicine into sharp focus
        const closeUpDist = min + (max - min) * 0.7;
        await (track as any).applyConstraints({
          advanced: [{ focusMode: 'manual', focusDistance: closeUpDist }]
        });
        console.log('[Camera] Applied macro focusDistance:', closeUpDist);
        return true;
      } catch (err) {
        console.warn('[Camera] Focus distance constraint failed:', err);
      }
    }

    // Strategy 4: Universal fallback — nudge zoom constraint to force ISP autofocus re-evaluation
    if (capabilities.zoom) {
      try {
        const currentSettings = track.getSettings() as any;
        const currentZoom = currentSettings.zoom || capabilities.zoom.min || 1.0;
        await (track as any).applyConstraints({
          advanced: [{ zoom: Math.min(currentZoom + 0.05, capabilities.zoom.max || 2.0) }]
        });
        setTimeout(async () => {
          try {
            await (track as any).applyConstraints({ advanced: [{ zoom: currentZoom }] });
          } catch {}
        }, 150);
        console.log('[Camera] Nudged zoom to force ISP refocus');
        return true;
      } catch {}
    }

    return false;
  }
}
