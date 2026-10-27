import { AriaAnnouncer } from './aria-announcer';

export type SpeechLanguage = 'en' | 'hi' | 'mr';

export function splitSpeechText(text: string, maxLength = 220): string[] {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return [];

  const sentences = normalized.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [normalized];
  const chunks: string[] = [];

  for (const sentence of sentences.map(part => part.trim())) {
    if (sentence.length <= maxLength) {
      const last = chunks[chunks.length - 1];
      if (last && last.length + sentence.length + 1 <= maxLength) {
        chunks[chunks.length - 1] = `${last} ${sentence}`;
      } else {
        chunks.push(sentence);
      }
      continue;
    }

    const words = sentence.split(' ');
    let chunk = '';
    for (const word of words) {
      if (chunk && chunk.length + word.length + 1 > maxLength) {
        chunks.push(chunk);
        chunk = word;
      } else {
        chunk = chunk ? `${chunk} ${word}` : word;
      }
    }
    if (chunk) chunks.push(chunk);
  }

  return chunks;
}

export class TtsManager {
  private announcer = new AriaAnnouncer();
  private speechGeneration = 0;
  
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
    this.speechGeneration++;
    this.announcer.clear();
    if (!this.talkbackMode && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
  }

  private synthNative(text: string) {
    if ('speechSynthesis' in window) {
      const generation = ++this.speechGeneration;
      window.speechSynthesis.cancel();
      const chunks = splitSpeechText(text);
      const voices = window.speechSynthesis.getVoices();
      const langPrefix = this.language === 'hi' ? 'hi' : this.language === 'mr' ? 'mr' : 'en';
      const langVoice = voices.find(v => v.lang.toLowerCase().startsWith(langPrefix));

      const speakChunk = (index: number) => {
        if (generation !== this.speechGeneration || index >= chunks.length) return;
        const utterance = new SpeechSynthesisUtterance(chunks[index]);
        utterance.rate = this.rate;
        if (langVoice) utterance.voice = langVoice;
        utterance.onend = () => speakChunk(index + 1);
        window.speechSynthesis.speak(utterance);
      };

      console.log(`[TTS] Speaking ${chunks.length} chunk(s) (${this.language}, ${this.rate}x)`);
      speakChunk(0);
    } else {
      console.warn('[TTS] Web Speech API not supported in this browser.');
    }
  }
}
