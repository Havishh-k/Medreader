import { AriaAnnouncer } from './aria-announcer';

export type SpeechLanguage = 'en' | 'hi' | 'mr';

export class TtsManager {
  private announcer = new AriaAnnouncer();
  private eSpeakWorker: Worker | null = null;
  
  // By default we assume TalkBack is ON to be safe. User can toggle it in settings.
  // In a real app we might try `window.matchMedia('(prefers-reduced-motion: reduce)')` as a weak heuristic, 
  // but explicit user setting is best.
  public talkbackMode = false; // Set to false so desktop testers hear the voice natively
  public language: SpeechLanguage = 'en';
  public rate = 1.0;

  constructor() {
    const savedRate = localStorage.getItem('ttsRate');
    if (savedRate) {
      const parsed = parseFloat(savedRate);
      if (!isNaN(parsed)) this.rate = parsed;
    }
    const savedLang = localStorage.getItem('ttsLanguage');
    if (savedLang === 'en' || savedLang === 'hi' || savedLang === 'mr') {
      this.language = savedLang;
    }
  }

  setRate(newRate: number) {
    this.rate = Math.max(0.5, Math.min(2.0, newRate));
    localStorage.setItem('ttsRate', String(this.rate));
  }

  setLanguage(newLang: SpeechLanguage) {
    this.language = newLang;
    localStorage.setItem('ttsLanguage', newLang);
  }

  /**
   * Speak assertive text (like readout results or critical errors).
   */
  speakAssertive(text: string) {
    if (this.talkbackMode) {
      this.announcer.announceAssertive(text);
    } else {
      this.synthNative(text);
    }
  }

  /**
   * Speak polite text (like guidance hints or state changes).
   */
  speakPolite(text: string) {
    if (this.talkbackMode) {
      this.announcer.announcePolite(text);
    } else {
      this.synthNative(text);
    }
  }
  
  clear() {
    this.announcer.clear();
    if (!this.talkbackMode && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
  }

  private synthNative(text: string) {
    if ('speechSynthesis' in window) {
      // Chrome/Webkit bug: speech queue can get stuck silently. 
      // Cancelling before speaking a new prompt ensures it fires immediately.
      window.speechSynthesis.cancel();
      
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = this.rate;
      
      // Match voice to chosen language (en, hi, mr)
      const voices = window.speechSynthesis.getVoices();
      if (voices.length > 0) {
        const langPrefix = this.language === 'hi' ? 'hi' : this.language === 'mr' ? 'mr' : 'en';
        const langVoice = voices.find(v => v.lang.toLowerCase().startsWith(langPrefix));
        if (langVoice) utterance.voice = langVoice;
      }
      
      console.log(`[TTS] Speaking (${this.language}, ${this.rate}x): "${text}"`);
      window.speechSynthesis.speak(utterance);
    } else {
      console.warn('[TTS] Web Speech API not supported in this browser.');
    }
  }
}
