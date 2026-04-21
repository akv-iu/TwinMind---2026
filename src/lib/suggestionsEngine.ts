import type {
  Suggestion,
  SuggestionBatch,
  SuggestionType,
  SuggestionsResponse,
  TranscriptChunk,
} from '@/types';
import { useTwinMindStore } from '@/store/useTwinMindStore';

const TICK_MS = 30_000;
const DEFER_MS = 5_000;
const MIN_WORDS = 30;
const SETTLED_MS = 8_000;
const FRESH_MS = 3 * 60_000;
const HINT_AFTER_SKIPS = 3;
const RECENT_CHUNKS = 30;
const CLIENT_FETCH_TIMEOUT_MS = 9_000;

let isRunning = false;
let intervalHandle: ReturnType<typeof setInterval> | null = null;
let deferTimer: ReturnType<typeof setTimeout> | null = null;
let skippedCycles = 0;

function isSuggestionType(value: string): value is SuggestionType {
  return (
    value === 'question' ||
    value === 'talking_point' ||
    value === 'fact_check'
  );
}

function countWords(transcript: TranscriptChunk[]): number {
  return transcript.reduce((count, chunk) => {
    const words = chunk.text.trim().split(/\s+/).filter(Boolean);
    return count + words.length;
  }, 0);
}

function getRecentTranscriptSnapshot(transcript: TranscriptChunk[]): string {
  return transcript
    .slice(-RECENT_CHUNKS)
    .map((chunk) => chunk.text)
    .join('\n');
}

function onSkip() {
  skippedCycles += 1;
  if (skippedCycles >= HINT_AFTER_SKIPS) {
    useTwinMindStore.getState().setSuggestionsHintVisible(true);
  }
}

function onSuccess() {
  skippedCycles = 0;
  useTwinMindStore.getState().setSuggestionsHintVisible(false);
}

export function shouldRunSuggestions(transcript: TranscriptChunk[]): boolean {
  return countWords(transcript) >= MIN_WORDS;
}

export function isTranscriptSettled(
  lastFinalizedAt: number,
  nowMs: number,
): boolean {
  if (lastFinalizedAt === 0) {
    return false;
  }
  return nowMs - lastFinalizedAt >= SETTLED_MS;
}

export function isTranscriptFresh(lastFinalizedAt: number, nowMs: number): boolean {
  if (lastFinalizedAt === 0) {
    return false;
  }
  return nowMs - lastFinalizedAt <= FRESH_MS;
}

export function parseSuggestionsResponse(raw: string): Suggestion[] | null {
  const trimmed = raw.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const jsonText = fenceMatch ? fenceMatch[1].trim() : trimmed;

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return null;
  }

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('suggestions' in parsed)
  ) {
    return null;
  }

  const suggestions = (parsed as { suggestions: unknown }).suggestions;
  if (!Array.isArray(suggestions) || suggestions.length !== 3) {
    return null;
  }

  const hydrated: Suggestion[] = [];
  for (const item of suggestions) {
    if (
      typeof item !== 'object' ||
      item === null ||
      !('type' in item) ||
      !('text' in item)
    ) {
      return null;
    }

    const type = (item as { type: unknown }).type;
    const text = (item as { text: unknown }).text;
    if (typeof type !== 'string' || !isSuggestionType(type)) {
      return null;
    }
    if (typeof text !== 'string' || text.trim().length === 0) {
      return null;
    }

    hydrated.push({
      id: crypto.randomUUID(),
      type,
      text: text.trim(),
    });
  }

  return hydrated;
}

async function runSuggestionsCall() {
  if (isRunning) {
    return;
  }

  isRunning = true;
  useTwinMindStore.getState().setSuggestionsStatus('loading');

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), CLIENT_FETCH_TIMEOUT_MS);
  const snapshot = getRecentTranscriptSnapshot(useTwinMindStore.getState().transcript);

  try {
    const response = await fetch('/api/suggestions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recentTranscript: snapshot }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`suggestions ${response.status}`);
    }

    const data = (await response.json()) as SuggestionsResponse;
    if (!Array.isArray(data.suggestions) || data.suggestions.length !== 3) {
      throw new Error('Invalid suggestions payload');
    }

    const batch: SuggestionBatch = {
      id: crypto.randomUUID(),
      createdAt: Date.now(),
      suggestions: data.suggestions,
      transcriptSnapshot: snapshot,
    };

    const state = useTwinMindStore.getState();
    state.appendSuggestionBatch(batch);
    state.setSuggestionsStatus('idle');
    onSuccess();
  } catch (error) {
    console.error('[suggestionsEngine] call failed', error);
    useTwinMindStore.getState().setSuggestionsStatus('error');
  } finally {
    clearTimeout(timeoutId);
    isRunning = false;
  }
}

async function tick() {
  if (isRunning) {
    return;
  }

  const state = useTwinMindStore.getState();
  const nowMs = Date.now();

  if (!isTranscriptFresh(state.lastFinalizedAt, nowMs)) {
    state.setSuggestionsStatus('idle');
    return;
  }

  if (!shouldRunSuggestions(state.transcript)) {
    onSkip();
    return;
  }

  if (!isTranscriptSettled(state.lastFinalizedAt, nowMs)) {
    if (deferTimer) {
      clearTimeout(deferTimer);
    }
    deferTimer = setTimeout(() => {
      void tick();
    }, DEFER_MS);
    return;
  }

  await runSuggestionsCall();
}

export function startSuggestionsEngine() {
  if (intervalHandle) {
    return;
  }

  void tick();
  intervalHandle = setInterval(() => {
    void tick();
  }, TICK_MS);
}

export function stopSuggestionsEngine() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }

  if (deferTimer) {
    clearTimeout(deferTimer);
    deferTimer = null;
  }

  isRunning = false;
  skippedCycles = 0;
  useTwinMindStore.getState().setSuggestionsHintVisible(false);
}

export function resetEngineState() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
  if (deferTimer) {
    clearTimeout(deferTimer);
    deferTimer = null;
  }

  isRunning = false;
  skippedCycles = 0;
}
