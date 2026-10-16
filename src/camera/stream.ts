export class CameraStream {
  private videoEl: HTMLVideoElement;
  private stream: MediaStream | null = null;
  private isRunning = false;

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
          height: { ideal: 720 }
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
  }

  /**
   * Captures the current frame as an ImageBitmap.
   * Useful for passing to Workers without cloning overhead.
   */
  async grabFrame(): Promise<ImageBitmap | null> {
    if (!this.isRunning || !this.videoEl.videoWidth) return null;
    return createImageBitmap(this.videoEl);
  }
}
