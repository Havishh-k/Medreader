import { describe, expect, it } from 'vitest';
import { splitSpeechText } from '../../src/speech/tts-manager';

describe('speech chunking', () => {
  it('keeps every report word while producing browser-safe chunks', () => {
    const report = Array.from({ length: 80 }, (_, index) => `detail${index}.`).join(' ');
    const chunks = splitSpeechText(report, 80);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every(chunk => chunk.length <= 80)).toBe(true);
    expect(chunks.join(' ')).toBe(report);
  });
});
