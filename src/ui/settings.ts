import { ICONS } from './icons';

export class SettingsScreen {
  private btn: HTMLElement;
  private modal: HTMLElement;
  private appRoot: HTMLElement;

  constructor() {
    this.btn = document.getElementById('settings-btn')!;
    this.modal = document.getElementById('settings-screen')!;
    this.appRoot = document.getElementById('app-root')!;

    // Ensure hidden and display none initially
    this.modal.hidden = true;
    this.modal.style.display = 'none';
    this.modal.className = 'modal-overlay';
    
    this.btn.addEventListener('click', (e) => {
      e.preventDefault();
      this.open();
    });
    
    this.modal.innerHTML = `
      <div class="settings-sheet" role="dialog" aria-modal="true" aria-labelledby="settings-heading">
        <div class="settings-header">
          <h2 id="settings-heading">Settings & Preferences</h2>
          <button id="close-settings" class="modal-close-btn" aria-label="Close Settings" title="Close">
            ${ICONS.close(20)}
          </button>
        </div>

        <!-- Voice & Audio Guidance -->
        <div class="settings-section">
          <h3 class="settings-section-title">
            ${ICONS.volume(16)} <span>Speech & Audio</span>
          </h3>
          <div class="settings-card">
            <div class="settings-row">
              <div class="settings-row-label">
                <span class="settings-label-title">Language</span>
                <span class="settings-label-desc">Voice synthesizer language</span>
              </div>
              <select id="lang-select" class="settings-select" aria-label="Language selection">
                <option value="en">English (US/UK)</option>
                <option value="hi">Hindi (हिंदी)</option>
                <option value="mr">Marathi (मराठी)</option>
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
          <h3 class="settings-section-title">
            ${ICONS.eye(16)} <span>Visual Accessibility</span>
          </h3>
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
          <h3 class="settings-section-title">
            ${ICONS.tap(16)} <span>Interactive Gesture Guide</span>
          </h3>
          <div class="gesture-grid">
            <div class="gesture-card">
              <span class="gesture-icon-title">${ICONS.doubleTap(18)} <span>Double Tap</span></span>
              <span class="gesture-desc"><strong>In Results:</strong> Read detailed clinical instructions & directions.<br/><strong>In Camera:</strong> Start or stop scan.</span>
            </div>
            <div class="gesture-card">
              <span class="gesture-icon-title">${ICONS.hold(18)} <span>Hold Screen</span></span>
              <span class="gesture-desc"><strong>In Results:</strong> Read full clinical details & warnings.<br/><strong>In Camera:</strong> Toggle flashlight in dark rooms.</span>
            </div>
            <div class="gesture-card">
              <span class="gesture-icon-title">${ICONS.swipeDown(18)} <span>Swipe Down</span></span>
              <span class="gesture-desc">Instantly stop and silence speech readout at any moment.</span>
            </div>
            <div class="gesture-card">
              <span class="gesture-icon-title">${ICONS.tap(18)} <span>Swipe Up</span></span>
              <span class="gesture-desc">Start new scan or scan next medicine immediately.</span>
            </div>
            <div class="gesture-card">
              <span class="gesture-icon-title">${ICONS.swipeHorizontal(18)} <span>Swipe Left / Right</span></span>
              <span class="gesture-desc">Switch between Medicine scanner and Document reading modes.</span>
            </div>
            <div class="gesture-card">
              <span class="gesture-icon-title">${ICONS.shake(18)} <span>Device Shake</span></span>
              <span class="gesture-desc">Shake phone to toggle flashlight or repeat prescription details.</span>
            </div>
            <div class="gesture-card">
              <span class="gesture-icon-title">${ICONS.target(18)} <span>Single Tap</span></span>
              <span class="gesture-desc">Autofocus camera lens, or replay concise prescription summary.</span>
            </div>
            <div class="gesture-card">
              <span class="gesture-icon-title">${ICONS.keyboard(18)} <span>Bluetooth Clicker</span></span>
              <span class="gesture-desc">Press Spacebar, Enter, or wireless shutter clicker to scan.</span>
            </div>
          </div>
        </div>

        <button id="done-settings" class="settings-done-btn">Done</button>
      </div>
    `;

    // Close handlers (both top close button and bottom Done button)
    const handleClose = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      this.close();
    };

    const closeBtn = document.getElementById('close-settings');
    if (closeBtn) {
      closeBtn.addEventListener('click', handleClose);
      closeBtn.addEventListener('touchend', handleClose);
    }

    const doneBtn = document.getElementById('done-settings');
    if (doneBtn) {
      doneBtn.addEventListener('click', handleClose);
      doneBtn.addEventListener('touchend', handleClose);
    }
    
    // Close when tapping outside the sheet on the dark overlay
    this.modal.addEventListener('click', (e) => {
      if (e.target === this.modal) {
        e.preventDefault();
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

    // Tick mode toggle
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
    this.modal.style.display = 'flex';
    this.appRoot.setAttribute('inert', '');
    
    try {
      history.pushState({ modal: 'settings' }, '');
      window.addEventListener('popstate', this.onPopState);
    } catch {}
    
    const closeBtn = document.getElementById('close-settings');
    closeBtn?.focus();
  }

  close() {
    this.modal.hidden = true;
    this.modal.style.display = 'none';
    this.appRoot.removeAttribute('inert');
    window.removeEventListener('popstate', this.onPopState);
    
    try {
      if (history.state?.modal === 'settings') {
        history.back();
      }
    } catch {}
  }
  
  private onPopState = (e: PopStateEvent) => {
    if (!e.state || e.state.modal !== 'settings') {
      this.modal.hidden = true;
      this.modal.style.display = 'none';
      this.appRoot.removeAttribute('inert');
      window.removeEventListener('popstate', this.onPopState);
    }
  };
}
