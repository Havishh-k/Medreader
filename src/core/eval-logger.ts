import type { FrameQuality } from '../camera/frame-quality';
import type { Decision } from './label-logic';
import type { OcrResult } from '../workers/ocr.worker';

export interface TrialLog {
  timestamp: number;
  scanDurationMs: number;
  framesAnalysed: number;
  frameQualities: FrameQuality[];
  rawOcrPerFrame: OcrResult[][];
  decision: Decision | null;
}

export class EvalLogger {
  private enabled = false;
  private currentTrial: Partial<TrialLog> | null = null;
  private trials: TrialLog[] = [];

  enable() {
    this.enabled = true;
    console.warn("Evaluation Logging ENABLED. Do not use in production.");
  }

  startTrial() {
    if (!this.enabled) return;
    this.currentTrial = {
      timestamp: Date.now(),
      framesAnalysed: 0,
      frameQualities: [],
      rawOcrPerFrame: [],
      decision: null
    };
  }

  logFrame(quality: FrameQuality, ocr: OcrResult[]) {
    if (!this.enabled || !this.currentTrial) return;
    this.currentTrial.framesAnalysed!++;
    this.currentTrial.frameQualities!.push(quality);
    this.currentTrial.rawOcrPerFrame!.push(ocr);
  }

  endTrial(decision: Decision) {
    if (!this.enabled || !this.currentTrial) return;
    
    this.currentTrial.decision = decision;
    this.currentTrial.scanDurationMs = Date.now() - this.currentTrial.timestamp!;
    
    this.trials.push(this.currentTrial as TrialLog);
    this.currentTrial = null;
    
    // Auto-save to localStorage to prevent data loss on reload
    try {
      localStorage.setItem('eval_logs', JSON.stringify(this.trials));
    } catch (e) {
      console.warn("Could not save eval logs to localStorage", e);
    }
  }

  exportLogs() {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(this.trials, null, 2));
    const a = document.createElement('a');
    a.href = dataStr;
    a.download = `eval_logs_${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }
  
  clearLogs() {
    this.trials = [];
    localStorage.removeItem('eval_logs');
  }
}

// Singleton export
export const evalLogger = new EvalLogger();
