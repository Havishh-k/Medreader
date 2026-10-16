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
    // initWorker() removed for now, using native speech
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
      
      // Attempt to pick a good default English voice if available
      const voices = window.speechSynthesis.getVoices();
      if (voices.length > 0) {
        const engVoice = voices.find(v => v.lang.startsWith('en-'));
        if (engVoice) utterance.voice = engVoice;
      }
      
      console.log(`[TTS] Speaking: "${text}"`);
      window.speechSynthesis.speak(utterance);
    } else {
      console.warn('[TTS] Web Speech API not supported in this browser.');
    }
  }
}
