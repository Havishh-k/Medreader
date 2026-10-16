import type { FrameQuality } from '../camera/frame-quality';

export class HintGenerator {
  private lastHintTime = 0;
  private readonly THROTTLE_MS = 3500; // Max 1 hint every 3.5 seconds

  generateHint(quality: FrameQuality): string | null {
    const now = Date.now();
    if (now - this.lastHintTime < this.THROTTLE_MS) {
      return null;
    }

    let hint = null;

    if (quality.glare > 0.25) {
      hint = "Too much glare. Tilt slightly.";
    } else if (quality.coverage < 0.006 && quality.sharpness < 35) {
      // Only suggest if the frame is virtually empty and blurry
      hint = "Point camera at the medicine.";
    } else if (quality.centering < -0.4) {
      hint = "Move camera right.";
    } else if (quality.centering > 0.4) {
      hint = "Move camera left.";
    } else if (quality.sharpness < 30) {
      hint = "Hold steady.";
    }

    if (hint) {
      this.lastHintTime = now;
    }
    
    return hint;
  }
  
  resetThrottle() {
    this.lastHintTime = 0;
  }
}
