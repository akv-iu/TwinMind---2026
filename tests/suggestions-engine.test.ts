import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Suggestion, TranscriptChunk } from '@/types';
import {
  resetEngineState,
  startSuggestionsEngine,
  stopSuggestionsEngine,
} from '@/lib/suggestionsEngine';
import { useTwinMindStore } from '@/store/useTwinMindStore';

const initialState = useTwinMindStore.getState();

function makeTranscript(words: number): TranscriptChunk[] {
  const text = Array.from({ length: words }, (_, index) => `w${index + 1}`).join(' ');
  return [{ id: 't-1', text, timestamp: Date.now() }];
}

function makeSuggestions(): Suggestion[] {
  return [
    { id: 's1', type: 'question', text: 'What should we ask next?' },
    { id: 's2', type: 'talking_point', text: 'Discuss integration milestones.' },
    { id: 's3', type: 'fact_check', text: 'Validate the timeline estimate.' },
  ];
}

async function flushMicrotasks() {
  for (let i = 0; i < 6; i += 1) {
    await Promise.resolve();
  }
}

async function waitForCondition(
  predicate: () => boolean,
  attempts = 20,
): Promise<void> {
  for (let i = 0; i < attempts; i += 1) {
    if (predicate()) {
      return;
    }
    await flushMicrotasks();
  }
  throw new Error('Condition not met in time');
}

describe('suggestions engine lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    useTwinMindStore.setState(initialState, true);
    resetEngineState();
  });

  afterEach(() => {
    stopSuggestionsEngine();
    resetEngineState();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('keeps suggestions idle and skips API calls for stale transcript', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    useTwinMindStore.setState({
      transcript: makeTranscript(40),
      lastFinalizedAt: Date.now() - 4 * 60_000,
      suggestionsStatus: 'error',
    });

    startSuggestionsEngine();
    await flushMicrotasks();

    expect(useTwinMindStore.getState().suggestionsStatus).toBe('idle');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('shows hint after repeated low-word skips', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    useTwinMindStore.setState({
      transcript: makeTranscript(10),
      lastFinalizedAt: Date.now() - 9_000,
    });

    startSuggestionsEngine();
    await flushMicrotasks();

    vi.advanceTimersByTime(90_000);
    await flushMicrotasks();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(useTwinMindStore.getState().suggestionsHintVisible).toBe(true);
  });

  it('defers an unsettled transcript and retries after 5 seconds', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          suggestions: makeSuggestions(),
        }),
        { status: 200 },
      ),
    );

    useTwinMindStore.setState({
      transcript: makeTranscript(40),
      lastFinalizedAt: Date.now() - 4_000,
    });

    startSuggestionsEngine();
    await flushMicrotasks();

    expect(fetchSpy).not.toHaveBeenCalled();

    vi.advanceTimersByTime(4_999);
    await flushMicrotasks();
    expect(fetchSpy).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    await waitForCondition(() => fetchSpy.mock.calls.length === 1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('appends a batch and resets hint/status on success', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          suggestions: makeSuggestions(),
        }),
        { status: 200 },
      ),
    );

    useTwinMindStore.setState({
      transcript: makeTranscript(40),
      lastFinalizedAt: Date.now() - 12_000,
      suggestionsHintVisible: true,
    });

    startSuggestionsEngine();
    await waitForCondition(
      () => useTwinMindStore.getState().suggestionBatches.length === 1,
    );

    const state = useTwinMindStore.getState();
    expect(state.suggestionBatches).toHaveLength(1);
    expect(state.suggestionBatches[0].suggestions).toHaveLength(3);
    expect(state.suggestionsStatus).toBe('idle');
    expect(state.suggestionsHintVisible).toBe(false);
  });

  it('prevents overlapping in-flight API calls', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(() => new Promise(() => {}));

    useTwinMindStore.setState({
      transcript: makeTranscript(40),
      lastFinalizedAt: Date.now() - 12_000,
    });

    startSuggestionsEngine();
    await flushMicrotasks();

    vi.advanceTimersByTime(60_000);
    await flushMicrotasks();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('resets run state after failures so a later tick can proceed', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            suggestions: makeSuggestions(),
          }),
          { status: 200 },
        ),
      );

    useTwinMindStore.setState({
      transcript: makeTranscript(40),
      lastFinalizedAt: Date.now() - 12_000,
    });

    startSuggestionsEngine();
    await waitForCondition(() => fetchSpy.mock.calls.length === 1);
    expect(useTwinMindStore.getState().suggestionsStatus).toBe('error');

    vi.advanceTimersByTime(30_000);
    await waitForCondition(
      () =>
        fetchSpy.mock.calls.length === 2 &&
        useTwinMindStore.getState().suggestionsStatus === 'idle',
    );

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(useTwinMindStore.getState().suggestionsStatus).toBe('idle');
  });

  it('stops interval/defer timers when engine is stopped', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          suggestions: makeSuggestions(),
        }),
        { status: 200 },
      ),
    );

    useTwinMindStore.setState({
      transcript: makeTranscript(40),
      lastFinalizedAt: Date.now() - 2_000,
    });

    startSuggestionsEngine();
    stopSuggestionsEngine();

    vi.advanceTimersByTime(120_000);
    await flushMicrotasks();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(useTwinMindStore.getState().suggestionsHintVisible).toBe(false);
  });
});
