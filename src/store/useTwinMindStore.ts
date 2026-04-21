import { create } from 'zustand';
import type {
  ChatMessage,
  Suggestion,
  SuggestionBatch,
  TranscriptChunk,
} from '@/types';

type StatusFlag = 'idle' | 'loading' | 'error';

export interface TwinMindStore {
  transcript: TranscriptChunk[];
  isRecording: boolean;
  lastFinalizedAt: number;

  suggestionBatches: SuggestionBatch[];
  suggestionsStatus: StatusFlag;
  suggestionsHintVisible: boolean;

  chatMessages: ChatMessage[];
  chatStatus: StatusFlag;

  appendTranscriptChunk: (text: string) => void;
  setIsRecording: (val: boolean) => void;
  appendSuggestionBatch: (batch: SuggestionBatch) => void;
  setSuggestionsStatus: (s: StatusFlag) => void;
  setSuggestionsHintVisible: (visible: boolean) => void;
  appendChatMessage: (msg: ChatMessage) => void;
  updateStreamingMessage: (id: string, delta: string) => void;
  finalizeStreamingMessage: (id: string) => void;
  injectSuggestionToChat: (suggestion: Suggestion) => void;
}

export const useTwinMindStore = create<TwinMindStore>((set) => ({
  transcript: [],
  isRecording: false,
  lastFinalizedAt: 0,

  suggestionBatches: [],
  suggestionsStatus: 'idle',
  suggestionsHintVisible: false,

  chatMessages: [],
  chatStatus: 'idle',

  appendTranscriptChunk: (text) =>
    set((state) => ({
      transcript: [
        ...state.transcript,
        { id: crypto.randomUUID(), text, timestamp: Date.now() },
      ],
      lastFinalizedAt: Date.now(),
    })),

  setIsRecording: (val) => set({ isRecording: val }),

  appendSuggestionBatch: (batch) =>
    set((state) => ({
      suggestionBatches: [...state.suggestionBatches, batch].slice(-10),
    })),

  setSuggestionsStatus: (s) => set({ suggestionsStatus: s }),
  setSuggestionsHintVisible: (visible) =>
    set({ suggestionsHintVisible: visible }),

  appendChatMessage: (msg) =>
    set((state) => ({
      chatMessages: [...state.chatMessages, msg],
    })),

  updateStreamingMessage: (id, delta) =>
    set((state) => ({
      chatMessages: state.chatMessages.map((msg) =>
        msg.id === id ? { ...msg, content: msg.content + delta } : msg,
      ),
    })),

  finalizeStreamingMessage: (id) =>
    set((state) => ({
      chatMessages: state.chatMessages.map((msg) =>
        msg.id === id ? { ...msg, isStreaming: false } : msg,
      ),
    })),

  injectSuggestionToChat: (suggestion) =>
    set((state) => ({
      chatMessages: [
        ...state.chatMessages,
        {
          id: crypto.randomUUID(),
          role: 'user',
          content: suggestion.text,
          isStreaming: false,
          triggeredBySuggestion: suggestion.id,
          timestamp: Date.now(),
        },
      ],
    })),
}));
