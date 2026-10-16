import type { FrameQuality } from '../camera/frame-quality';

export class HintGenerator {
  private lastHintTime = 0;
  private readonly THROTTLE_MS = 2500; // Max 1 hint every 2.5 seconds

  generateHint(quality: FrameQuality): string | null {
    const now = Date.now();
    if (now - this.lastHintTime < this.THROTTLE_MS) {
      return null;
    }

    let hint = null;

    if (quality.glare > 0.15) {
      hint = "Too much glare. Tilt slightly.";
    } else if (quality.coverage < 0.03) {
      // At 320x240 analysis resolution, a medicine label with readable text
      // typically produces coverage of 0.03-0.10. Only show "move closer"
      // when there are almost no edges at all (blank wall / sky / floor).
      hint = "Move closer to the label.";
    } else if (quality.centering < -0.3) {
      hint = "Move camera right.";
    } else if (quality.centering > 0.3) {
      hint = "Move camera left.";
    } else if (quality.sharpness < 50) { // Assuming variance < 50 is very blurry
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
