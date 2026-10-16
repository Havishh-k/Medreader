// src/ui/icons.ts — Crisp, accessible SVG vector icons (Lucide / Feather inspired)

function svg(paths: string, size = 20, className = 'svg-icon'): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="${className}" aria-hidden="true">${paths}</svg>`;
}

export const ICONS = {
  // Medical Pill / Capsule
  pill: (size = 20) => svg(`
    <path d="m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z"/>
    <path d="m8.5 8.5 7 7"/>
  `, size, 'svg-icon svg-pill'),

  // Document
  document: (size = 20) => svg(`
    <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/>
    <polyline points="14 2 14 8 20 8"/>
    <line x1="16" y1="13" x2="8" y2="13"/>
    <line x1="16" y1="17" x2="8" y2="17"/>
    <line x1="10" y1="9" x2="8" y2="9"/>
  `, size, 'svg-icon svg-document'),

  // Volume / Speaker High
  volume: (size = 20) => svg(`
    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
    <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
    <path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>
  `, size, 'svg-icon svg-volume'),

  // Volume Mute / Volume X
  volumeMute: (size = 20) => svg(`
    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
    <line x1="22" y1="9" x2="16" y2="15"/>
    <line x1="16" y1="9" x2="22" y2="15"/>
  `, size, 'svg-icon svg-volume-mute'),

  // Settings Gear
  settings: (size = 20) => svg(`
    <circle cx="12" cy="12" r="3"/>
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
  `, size, 'svg-icon svg-settings'),

  // Flashlight / Torch
  flashlight: (size = 20) => svg(`
    <path d="M18 6c0 2-2 4-2 7v6a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2v-6c0-3-2-5-2-7a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2Z"/>
    <line x1="6" y1="6" x2="18" y2="6"/>
    <line x1="12" y1="12" x2="12" y2="12.01"/>
  `, size, 'svg-icon svg-flashlight'),

  // Flashlight Active (with beam rays)
  flashlightActive: (size = 20) => svg(`
    <path d="M18 6c0 2-2 4-2 7v6a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2v-6c0-3-2-5-2-7a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2Z" fill="currentColor"/>
    <line x1="12" y1="2" x2="12" y2="0"/>
    <line x1="7" y1="2" x2="6" y2="0"/>
    <line x1="17" y1="2" x2="18" y2="0"/>
  `, size, 'svg-icon svg-flashlight-active'),

  // Spark / Status Sparkle
  sparkle: (size = 18) => svg(`
    <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/>
  `, size, 'svg-icon svg-sparkle'),

  // Calendar
  calendar: (size = 20) => svg(`
    <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
    <line x1="16" y1="2" x2="16" y2="6"/>
    <line x1="8" y1="2" x2="8" y2="6"/>
    <line x1="3" y1="10" x2="21" y2="10"/>
  `, size, 'svg-icon svg-calendar'),

  // Info Circle
  info: (size = 18) => svg(`
    <circle cx="12" cy="12" r="10"/>
    <line x1="12" y1="16" x2="12" y2="12"/>
    <line x1="12" y1="8" x2="12.01" y2="8"/>
  `, size, 'svg-icon svg-info'),

  // Copy / Clipboard
  copy: (size = 18) => svg(`
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
  `, size, 'svg-icon svg-copy'),

  // Scan Lightning / Zap
  zap: (size = 20) => svg(`
    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
  `, size, 'svg-icon svg-zap'),

  // Scan Stop Square
  stop: (size = 20) => svg(`
    <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/>
  `, size, 'svg-icon svg-stop'),

  // Scan Refresh / Loop
  refresh: (size = 20) => svg(`
    <path d="M21.5 2v6h-6"/>
    <path d="M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/>
  `, size, 'svg-icon svg-refresh'),

  // Checkmark / Success
  check: (size = 18) => svg(`
    <polyline points="20 6 9 17 4 12"/>
  `, size, 'svg-icon svg-check'),

  // Warning Triangle
  warning: (size = 18) => svg(`
    <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/>
    <line x1="12" y1="9" x2="12" y2="13"/>
    <line x1="12" y1="17" x2="12.01" y2="17"/>
  `, size, 'svg-icon svg-warning'),

  // Search / Target Focus
  target: (size = 18) => svg(`
    <circle cx="12" cy="12" r="10"/>
    <circle cx="12" cy="12" r="6"/>
    <circle cx="12" cy="12" r="2"/>
  `, size, 'svg-icon svg-target'),

  // Lightbulb / Low Light
  lightbulb: (size = 18) => svg(`
    <path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-1 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/>
    <path d="M9 18h6"/>
    <path d="M10 22h4"/>
  `, size, 'svg-icon svg-lightbulb'),

  // Ruler / Move closer
  ruler: (size = 18) => svg(`
    <path d="M21.3 8.7 8.7 21.3a1 1 0 0 1-1.4 0l-6-6a1 1 0 0 1 0-1.4L13.9 1.3a1 1 0 0 1 1.4 0l6 6a1 1 0 0 1 0 1.4z"/>
    <path d="m14.5 3.5 2 2"/>
    <path d="m11.5 6.5 3 3"/>
    <path d="m8.5 9.5 2 2"/>
    <path d="m5.5 12.5 3 3"/>
  `, size, 'svg-icon svg-ruler'),

  // Close / X
  close: (size = 20) => svg(`
    <line x1="18" y1="6" x2="6" y2="18"/>
    <line x1="6" y1="6" x2="18" y2="18"/>
  `, size, 'svg-icon svg-close'),

  // Eye / Visual Accessibility
  eye: (size = 18) => svg(`
    <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/>
    <circle cx="12" cy="12" r="3"/>
  `, size, 'svg-icon svg-eye'),

  // Single Tap Hand
  tap: (size = 18) => svg(`
    <path d="M18 11V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v0"/>
    <path d="M14 10V4a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v2"/>
    <path d="M10 10.5V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v8"/>
    <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/>
  `, size, 'svg-icon svg-tap'),

  // Double Tap Gestures
  doubleTap: (size = 18) => svg(`
    <circle cx="12" cy="12" r="9"/>
    <circle cx="12" cy="12" r="4"/>
  `, size, 'svg-icon svg-double-tap'),

  // Keyboard / Remote Clicker
  keyboard: (size = 18) => svg(`
    <rect width="20" height="16" x="2" y="4" rx="2"/>
    <path d="M6 8h.01"/>
    <path d="M10 8h.01"/>
    <path d="M14 8h.01"/>
    <path d="M18 8h.01"/>
    <path d="M8 12h.01"/>
    <path d="M12 12h.01"/>
    <path d="M16 12h.01"/>
    <path d="M7 16h10"/>
  `, size, 'svg-icon svg-keyboard'),

  // Chevron Down
  chevronDown: (size = 16) => svg(`
    <polyline points="6 9 12 15 18 9"/>
  `, size, 'svg-icon svg-chevron'),

  // Cross / Error
  xCircle: (size = 18) => svg(`
    <circle cx="12" cy="12" r="10"/>
    <line x1="15" y1="9" x2="9" y2="15"/>
    <line x1="9" y1="9" x2="15" y2="15"/>
  `, size, 'svg-icon svg-x-circle'),
};
