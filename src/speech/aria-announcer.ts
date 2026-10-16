/**
 * Manages ARIA live regions for accessibility.
 * Pre-primed containers in index.html are required so TalkBack tracks them properly.
 */

export class AriaAnnouncer {
  private politeEl: HTMLElement;
  private assertiveEl: HTMLElement;
  
  // Timeout references to prevent identical string deduplication
  private politeTimer = 0;
  private assertiveTimer = 0;

  constructor() {
    this.politeEl = document.getElementById('live-polite')!;
    this.assertiveEl = document.getElementById('live-assertive')!;
    
    if (!this.politeEl || !this.assertiveEl) {
      console.warn("ARIA live regions missing from DOM. A11y will be broken.");
    }
  }

  announcePolite(text: string) {
    if (!this.politeEl) return;
    this.updateRegion(this.politeEl, text, 'politeTimer');
  }

  announceAssertive(text: string) {
    if (!this.assertiveEl) return;
    this.updateRegion(this.assertiveEl, text, 'assertiveTimer');
  }
  
  clear() {
    if (this.politeEl) this.politeEl.textContent = '';
    if (this.assertiveEl) this.assertiveEl.textContent = '';
  }

  /**
   * Clears the region briefly before setting new text.
   * This forces TalkBack to read the text even if it's identical to the previous text.
   */
  private updateRegion(el: HTMLElement, text: string, timerKey: 'politeTimer' | 'assertiveTimer') {
    if (this[timerKey]) {
      clearTimeout(this[timerKey]);
    }
    
    // Clear to force change event
    el.textContent = '';
    
    this[timerKey] = window.setTimeout(() => {
      el.textContent = text;
    }, 50);
  }
}
