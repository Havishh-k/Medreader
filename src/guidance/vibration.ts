/**
 * Provides binary haptic feedback for key scan states.
 * 
 * Note: PWA cannot use directional haptics (Android HapticFeedbackConstants).
 * `navigator.vibrate` is binary on/off only.
 */

export function vibrateLock(): void {
  if (typeof navigator !== 'undefined' && navigator.vibrate) {
    // Single short pulse for "framing is good, hold steady"
    navigator.vibrate(50);
  }
}

export function vibrateSuccess(): void {
  if (typeof navigator !== 'undefined' && navigator.vibrate) {
    // Longer pulse for "scan complete/processing"
    navigator.vibrate(100);
  }
}

export function vibrateError(): void {
  if (typeof navigator !== 'undefined' && navigator.vibrate) {
    // Two quick pulses for "scan failed / abstain"
    navigator.vibrate([50, 100, 50]);
  }
}
