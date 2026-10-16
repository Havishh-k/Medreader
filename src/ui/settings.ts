export class SettingsScreen {
  private btn: HTMLElement;
  private modal: HTMLElement;
  private appRoot: HTMLElement;

  constructor() {
    this.btn = document.getElementById('settings-btn')!;
    this.modal = document.getElementById('settings-screen')!;
    this.appRoot = document.getElementById('app-root')!;

    this.btn.addEventListener('click', () => this.open());
    
    this.modal.className = 'modal-overlay';
    this.modal.innerHTML = `
      <div class="settings-sheet" role="dialog" aria-modal="true" aria-labelledby="settings-heading">
        <div class="settings-header">
          <h2 id="settings-heading">Settings & Preferences</h2>
          <button id="close-settings" class="modal-close-btn" aria-label="Close Settings">✕</button>
        </div>

        <!-- Voice & Audio Guidance -->
        <div class="settings-section">
          <h3 class="settings-section-title">🔊 Speech & Audio</h3>
          <div class="settings-card">
            <div class="settings-row">
              <div class="settings-row-label">
                <span class="settings-label-title">Language</span>
                <span class="settings-label-desc">Text-to-Speech voice language</span>
              </div>
              <select id="lang-select" class="settings-select" aria-label="Language selection">
                <option value="en">English 🇬🇧</option>
                <option value="hi">Hindi 🇮🇳</option>
                <option value="mr">Marathi 🇮🇳</option>
              </select>
            </div>

            <div class="settings-row">
              <div class="settings-row-label">
                <span class="settings-label-title">Speech Rate</span>
                <span class="settings-label-desc">Speed of voice readout</span>
              </div>
              <select id="rate-select" class="settings-select" aria-label="Speech speed selection">
                <option value="0.8">0.8x (Slow)</option>
                <option value="1.0">1.0x (Normal)</option>
                <option value="1.2">1.2x (Fast)</option>
                <option value="1.4">1.4x (Very Fast)</option>
              </select>
            </div>

            <div class="settings-row">
              <div class="settings-row-label">
                <span class="settings-label-title">Audio Guidance Style</span>
                <span class="settings-label-desc">Pitch tone vs Geiger ticking</span>
              </div>
              <select id="tick-toggle" class="settings-select" aria-label="Audio guidance style">
                <option value="continuous">Continuous Tone</option>
                <option value="tick">Geiger Ticking</option>
              </select>
            </div>
          </div>
        </div>

        <!-- Visual Accessibility -->
        <div class="settings-section">
          <h3 class="settings-section-title">👁️ Visual Accessibility</h3>
          <div class="settings-card">
            <div class="settings-row">
              <div class="settings-row-label">
                <span class="settings-label-title">High Contrast Mode</span>
                <span class="settings-label-desc">WCAG 2.1 AAA Yellow-on-Black</span>
              </div>
              <select id="contrast-toggle" class="settings-select" aria-label="High contrast toggle">
                <option value="off">Off (Standard Dark)</option>
                <option value="on">On (High Contrast AAA)</option>
              </select>
            </div>
          </div>
        </div>

        <!-- Gesture Shortcuts Guide -->
        <div class="settings-section">
          <h3 class="settings-section-title">⚡ Interactive Gesture Guide</h3>
          <div class="gesture-grid">
            <div class="gesture-card">
              <span class="gesture-icon-title">👆 Single Tap</span>
              <span class="gesture-desc">Tap camera viewfinder anywhere to trigger physical autofocus.</span>
            </div>
            <div class="gesture-card">
              <span class="gesture-icon-title">✌️ Double Tap</span>
              <span class="gesture-desc">Quick double-tap anywhere on screen to toggle start/stop scan.</span>
            </div>
            <div class="gesture-card">
              <span class="gesture-icon-title">🔦 Flash Button</span>
              <span class="gesture-desc">Tap torch icon in top-right to illuminate label in dark rooms.</span>
            </div>
            <div class="gesture-card">
              <span class="gesture-icon-title">⌨️ Remote Trigger</span>
              <span class="gesture-desc">Press Spacebar, Enter, or Bluetooth shutter button to scan.</span>
            </div>
          </div>
        </div>
      </div>
    `;

    document.getElementById('close-settings')!.addEventListener('click', () => this.close());
    
    // Close when tapping outside the sheet on the overlay
    this.modal.addEventListener('click', (e) => {
      if (e.target === this.modal) {
        this.close();
      }
    });

    // Close on Escape key
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.modal.hidden) {
        this.close();
      }
    });

    // Language selection
    const langSelect = document.getElementById('lang-select') as HTMLSelectElement;
    const savedLang = localStorage.getItem('ttsLanguage') || 'en';
    langSelect.value = savedLang;
    langSelect.addEventListener('change', () => {
      localStorage.setItem('ttsLanguage', langSelect.value);
      window.dispatchEvent(new CustomEvent('languageChanged', { detail: langSelect.value }));
    });

    // Speech Rate selection
    const rateSelect = document.getElementById('rate-select') as HTMLSelectElement;
    const savedRate = localStorage.getItem('ttsRate') || '1.0';
    rateSelect.value = savedRate;
    rateSelect.addEventListener('change', () => {
      localStorage.setItem('ttsRate', rateSelect.value);
      window.dispatchEvent(new CustomEvent('rateChanged', { detail: parseFloat(rateSelect.value) }));
    });

    // High contrast toggle
    const contrastToggle = document.getElementById('contrast-toggle') as HTMLSelectElement;
    if (localStorage.getItem('highContrast') === 'true') {
      document.body.setAttribute('data-high-contrast', 'true');
      contrastToggle.value = 'on';
    }
    contrastToggle.addEventListener('change', () => {
      const on = contrastToggle.value === 'on';
      if (on) {
        document.body.setAttribute('data-high-contrast', 'true');
      } else {
        document.body.removeAttribute('data-high-contrast');
      }
      localStorage.setItem('highContrast', String(on));
    });

    // Tick mode toggle (dispatches custom event for sonification engine to listen)
    const tickToggle = document.getElementById('tick-toggle') as HTMLSelectElement;
    if (localStorage.getItem('tickMode') === 'true') {
      tickToggle.value = 'tick';
    }
    tickToggle.addEventListener('change', () => {
      const isTick = tickToggle.value === 'tick';
      localStorage.setItem('tickMode', String(isTick));
      window.dispatchEvent(new CustomEvent('tickModeChanged', { detail: isTick }));
    });
  }

  open() {
    this.modal.hidden = false;
    // A11y: Trap focus and hide background
    this.appRoot.setAttribute('inert', '');
    
    // Push history state to handle Android Back button gracefully
    history.pushState({ modal: 'settings' }, '');
    window.addEventListener('popstate', this.onPopState);
    
    this.modal.querySelector('h2')?.focus();
  }

  close() {
    this.modal.hidden = true;
    this.appRoot.removeAttribute('inert');
    window.removeEventListener('popstate', this.onPopState);
    
    // If user clicked close button, pop the state manually
    if (history.state?.modal === 'settings') {
      history.back();
    }
  }
  
  private onPopState = (e: PopStateEvent) => {
    // If we popped out of settings state, close it
    if (!e.state || e.state.modal !== 'settings') {
      this.modal.hidden = true;
      this.appRoot.removeAttribute('inert');
      window.removeEventListener('popstate', this.onPopState);
    }
  };
}
