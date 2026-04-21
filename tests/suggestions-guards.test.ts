import { describe, expect, it } from 'vitest';
import type { TranscriptChunk } from '@/types';
import {
  isTranscriptFresh,
  isTranscriptSettled,
  shouldRunSuggestions,
} from '@/lib/suggestionsEngine';

function chunkWithWords(count: number): TranscriptChunk {
  const text = Array.from({ length: count }, (_, index) => `w${index + 1}`).join(' ');
  return { id: `c-${count}`, text, timestamp: Date.now() };
}

describe('suggestions guards', () => {
  it('shouldRunSuggestions enforces minimum 30 words', () => {
    expect(shouldRunSuggestions([chunkWithWords(29)])).toBe(false);
    expect(shouldRunSuggestions([chunkWithWords(30)])).toBe(true);
    expect(shouldRunSuggestions([chunkWithWords(31)])).toBe(true);
  });

  it('isTranscriptSettled enforces 8 second quiet window', () => {
    const now = 10_000;
    expect(isTranscriptSettled(0, now)).toBe(false);
    expect(isTranscriptSettled(now - 7_999, now)).toBe(false);
    expect(isTranscriptSettled(now - 8_000, now)).toBe(true);
    expect(isTranscriptSettled(now - 12_000, now)).toBe(true);
  });

  it('isTranscriptFresh enforces 3 minute freshness window', () => {
    const now = 200_000;
    expect(isTranscriptFresh(0, now)).toBe(false);
    expect(isTranscriptFresh(now - 180_000, now)).toBe(true);
    expect(isTranscriptFresh(now - 180_001, now)).toBe(false);
  });
});
