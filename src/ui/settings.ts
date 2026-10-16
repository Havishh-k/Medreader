export class SettingsScreen {
  private btn: HTMLElement;
  private modal: HTMLElement;
  private appRoot: HTMLElement;

  constructor() {
    this.btn = document.getElementById('settings-btn')!;
    this.modal = document.getElementById('settings-screen')!;
    this.appRoot = document.getElementById('app-root')!;

    this.btn.addEventListener('click', () => this.open());
    
    // Add some basic UI for testing
    this.modal.innerHTML = `
      <div style="background: white; color: black; padding: 24px; height: 100%; overflow-y: auto;">
        <h1 tabindex="-1">Settings</h1>
        
        <div style="margin-top: 24px;">
          <label for="lang-select">Language</label>
          <select id="lang-select" style="display:block; width:100%; padding: 12px; margin-top: 8px;">
            <option value="en">English</option>
            <option value="hi">Hindi</option>
            <option value="mr">Marathi</option>
          </select>
        </div>
        
        <div style="margin-top: 24px;">
          <label for="talkback-toggle">TalkBack Output</label>
          <select id="talkback-toggle" style="display:block; width:100%; padding: 12px; margin-top: 8px;">
            <option value="auto">Auto (System Voice)</option>
            <option value="off">Off (eSpeak Voice)</option>
          </select>
        </div>

        <div style="margin-top: 24px;">
          <label for="contrast-toggle">High Contrast Mode</label>
          <select id="contrast-toggle" style="display:block; width:100%; padding: 12px; margin-top: 8px;">
            <option value="off">Off (Default)</option>
            <option value="on">On (WCAG AAA)</option>
          </select>
        </div>

        <div style="margin-top: 24px;">
          <label for="tick-toggle">Audio Guidance Style</label>
          <select id="tick-toggle" style="display:block; width:100%; padding: 12px; margin-top: 8px;">
            <option value="continuous">Continuous Tone</option>
            <option value="tick">Geiger-Counter Ticking</option>
          </select>
        </div>

        <button id="close-settings" style="margin-top: 32px; padding: 16px; width: 100%; background: #000; color: white;">Close Settings</button>
      </div>
    `;

    document.getElementById('close-settings')!.addEventListener('click', () => this.close());

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
    this.modal.style.position = 'fixed';
    this.modal.style.top = '0';
    this.modal.style.left = '0';
    this.modal.style.width = '100vw';
    this.modal.style.height = '100vh';
    this.modal.style.zIndex = '100';

    // A11y: Trap focus and hide background
    this.appRoot.setAttribute('inert', '');
    
    // Push history state to handle Android Back button gracefully
    history.pushState({ modal: 'settings' }, '');
    window.addEventListener('popstate', this.onPopState);
    
    this.modal.querySelector('h1')?.focus();
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
