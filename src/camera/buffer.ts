import { FrameQuality } from './frame-quality';

export interface BufferedFrame {
  bitmap: ImageBitmap;
  quality: FrameQuality;
  timestamp: number;
}

export class FrameBuffer {
  private frames: BufferedFrame[] = [];
  private readonly capacity: number;

  constructor(capacity: number = 6) {
    this.capacity = capacity;
  }

  add(bitmap: ImageBitmap, quality: FrameQuality): void {
    this.frames.push({
      bitmap,
      quality,
      timestamp: Date.now()
    });
    
    // Sort descending by composite score
    this.frames.sort((a, b) => b.quality.composite - a.quality.composite);
    
    // Discard worst if over capacity
    if (this.frames.length > this.capacity) {
      const dropped = this.frames.pop();
      dropped?.bitmap.close(); // Free GPU/memory resources
    }
  }

  getFrames(): BufferedFrame[] {
    return this.frames;
  }
  
  takeFrames(): BufferedFrame[] {
    const copy = [...this.frames];
    this.frames = [];
    return copy;
  }

  clear(): void {
    for (const f of this.frames) {
      if (f.bitmap) f.bitmap.close();
    }
    this.frames = [];
  }
}
