import { beforeEach, describe, expect, it } from 'vitest';
import { useTwinMindStore } from '@/store/useTwinMindStore';
import type { ChatMessage, Suggestion, SuggestionBatch } from '@/types';

const initialState = useTwinMindStore.getState();

beforeEach(() => {
  useTwinMindStore.setState({
    ...initialState,
    transcript: [],
    isRecording: false,
    lastFinalizedAt: 0,
    suggestionBatches: [],
    suggestionsStatus: 'idle',
    chatMessages: [],
    chatStatus: 'idle',
  });
});

describe('useTwinMindStore immutability', () => {
  it('appendTranscriptChunk produces a new transcript array reference', () => {
    const before = useTwinMindStore.getState().transcript;
    useTwinMindStore.getState().appendTranscriptChunk('hello');
    const after = useTwinMindStore.getState().transcript;
    expect(after).not.toBe(before);
    expect(after).toHaveLength(1);
    expect(after[0].text).toBe('hello');
    expect(useTwinMindStore.getState().lastFinalizedAt).toBeGreaterThan(0);
  });

  it('appendSuggestionBatch produces a new array reference', () => {
    const before = useTwinMindStore.getState().suggestionBatches;
    const batch: SuggestionBatch = {
      id: 'b1',
      createdAt: Date.now(),
      suggestions: [
        { id: 's1', type: 'question', text: 'q' },
        { id: 's2', type: 'talking_point', text: 't' },
        { id: 's3', type: 'fact_check', text: 'f' },
      ],
      transcriptSnapshot: 'snap',
    };
    useTwinMindStore.getState().appendSuggestionBatch(batch);
    const after = useTwinMindStore.getState().suggestionBatches;
    expect(after).not.toBe(before);
    expect(after).toEqual([batch]);
  });

  it('appendChatMessage produces a new array reference', () => {
    const before = useTwinMindStore.getState().chatMessages;
    const msg: ChatMessage = {
      id: 'm1',
      role: 'user',
      content: 'hi',
      isStreaming: false,
      timestamp: Date.now(),
    };
    useTwinMindStore.getState().appendChatMessage(msg);
    const after = useTwinMindStore.getState().chatMessages;
    expect(after).not.toBe(before);
    expect(after).toEqual([msg]);
  });
});

describe('streaming message updates (§6.3)', () => {
  it('updateStreamingMessage produces a new message object for the match and keeps other refs', () => {
    const a: ChatMessage = {
      id: 'a',
      role: 'assistant',
      content: 'hel',
      isStreaming: true,
      timestamp: 1,
    };
    const b: ChatMessage = {
      id: 'b',
      role: 'user',
      content: 'hi',
      isStreaming: false,
      timestamp: 2,
    };
    useTwinMindStore.setState({ chatMessages: [a, b] });

    useTwinMindStore.getState().updateStreamingMessage('a', 'lo');
    const after = useTwinMindStore.getState().chatMessages;

    const newA = after.find((m) => m.id === 'a')!;
    const newB = after.find((m) => m.id === 'b')!;
    expect(newA).not.toBe(a);
    expect(newA.content).toBe('hello');
    expect(newB).toBe(b);
  });

  it('finalizeStreamingMessage flips isStreaming false and creates a new object', () => {
    const a: ChatMessage = {
      id: 'a',
      role: 'assistant',
      content: 'done',
      isStreaming: true,
      timestamp: 1,
    };
    useTwinMindStore.setState({ chatMessages: [a] });

    useTwinMindStore.getState().finalizeStreamingMessage('a');
    const after = useTwinMindStore.getState().chatMessages[0];
    expect(after).not.toBe(a);
    expect(after.isStreaming).toBe(false);
    expect(after.content).toBe('done');
  });
});

describe('injectSuggestionToChat (§6.4)', () => {
  it('appends a user message carrying the suggestion text and id', () => {
    const suggestion: Suggestion = { id: 'sugg-1', type: 'question', text: 'ask X?' };
    useTwinMindStore.getState().injectSuggestionToChat(suggestion);
    const msgs = useTwinMindStore.getState().chatMessages;
    expect(msgs).toHaveLength(1);
    const [m] = msgs;
    expect(m.role).toBe('user');
    expect(m.content).toBe('ask X?');
    expect(m.triggeredBySuggestion).toBe('sugg-1');
    expect(m.isStreaming).toBe(false);
  });
});
