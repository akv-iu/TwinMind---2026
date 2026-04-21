export interface TranscriptChunk {
  id: string;
  text: string;
  timestamp: number;
}

export type SuggestionType = 'question' | 'talking_point' | 'fact_check';

export interface Suggestion {
  id: string;
  type: SuggestionType;
  text: string;
}

export interface SuggestionBatch {
  id: string;
  createdAt: number;
  suggestions: Suggestion[];
  transcriptSnapshot: string;
}

export type MessageRole = 'user' | 'assistant';

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  isStreaming: boolean;
  triggeredBySuggestion?: string;
  timestamp: number;
}

export interface SuggestionsRequest {
  recentTranscript: string;
}

export interface SuggestionsResponse {
  suggestions: Suggestion[];
}

export interface ChatRequest {
  messages: { role: MessageRole; content: string }[];
  recentTranscript: string;
}
