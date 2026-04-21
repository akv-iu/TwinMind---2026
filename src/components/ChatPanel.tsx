'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { streamChat } from '@/lib/chatStreamReader';
import { useTwinMindStore } from '@/store/useTwinMindStore';
import type { ChatMessage } from '@/types';

interface ChatPanelProps {
  className?: string;
}

const STREAM_TIMEOUT_MS = 55_000;
const RECENT_TRANSCRIPT_CHUNKS = 30;
const BOTTOM_EPSILON_PX = 40;
const INTERRUPTED_MARKER = '\n\n[Response interrupted - please retry]';

function toMessagePayload(messages: ChatMessage[]): { role: 'user' | 'assistant'; content: string }[] {
  return messages.map((message) => ({
    role: message.role,
    content: message.content,
  }));
}

function getMessagesUpToLatestUser(messages: ChatMessage[]): ChatMessage[] {
  const latestUserIndex = [...messages]
    .map((message) => message.role)
    .lastIndexOf('user');

  if (latestUserIndex === -1) {
    return [];
  }

  return messages.slice(0, latestUserIndex + 1);
}

export function ChatPanel({ className }: ChatPanelProps) {
  const chatMessages = useTwinMindStore((state) => state.chatMessages);
  const chatStatus = useTwinMindStore((state) => state.chatStatus);
  const appendChatMessage = useTwinMindStore((state) => state.appendChatMessage);
  const updateStreamingMessage = useTwinMindStore(
    (state) => state.updateStreamingMessage,
  );
  const finalizeStreamingMessage = useTwinMindStore(
    (state) => state.finalizeStreamingMessage,
  );
  const setChatStatus = useTwinMindStore((state) => state.setChatStatus);

  const [inputText, setInputText] = useState('');
  const [isUserAtBottom, setIsUserAtBottom] = useState(true);

  const messagesRef = useRef<HTMLDivElement | null>(null);

  const lastMessage = chatMessages[chatMessages.length - 1];
  const canSend = inputText.trim().length > 0 && chatStatus !== 'loading';

  const chatStatusLabel = useMemo(() => {
    if (chatStatus === 'loading') {
      return 'Thinking...';
    }
    if (chatStatus === 'error') {
      return 'Last response failed. You can retry.';
    }
    return 'Ready';
  }, [chatStatus]);

  const sendChatRequest = useCallback(
    async (messageSnapshot?: ChatMessage[]) => {
      const snapshot = messageSnapshot ?? useTwinMindStore.getState().chatMessages;
      if (snapshot.length === 0) {
        return;
      }

      setChatStatus('loading');

      const assistantId = crypto.randomUUID();
      const recentTranscript = useTwinMindStore
        .getState()
        .transcript.slice(-RECENT_TRANSCRIPT_CHUNKS)
        .map((chunk) => chunk.text)
        .join('\n');

      appendChatMessage({
        id: assistantId,
        role: 'assistant',
        content: '',
        isStreaming: true,
        timestamp: Date.now(),
      });

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), STREAM_TIMEOUT_MS);

      try {
        await streamChat({
          body: {
            messages: toMessagePayload(snapshot),
            recentTranscript,
          },
          onDelta: (delta) => {
            updateStreamingMessage(assistantId, delta);
          },
          onDone: () => {
            finalizeStreamingMessage(assistantId);
            setChatStatus('idle');
          },
          onError: () => {
            updateStreamingMessage(assistantId, INTERRUPTED_MARKER);
            finalizeStreamingMessage(assistantId);
            setChatStatus('error');
          },
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }
    },
    [
      appendChatMessage,
      finalizeStreamingMessage,
      setChatStatus,
      updateStreamingMessage,
    ],
  );

  useEffect(() => {
    const latest = chatMessages[chatMessages.length - 1];
    if (!latest) {
      return;
    }
    if (latest.role !== 'user') {
      return;
    }
    if (chatStatus === 'loading') {
      return;
    }

    void sendChatRequest();
  }, [chatMessages, chatStatus, sendChatRequest]);

  useEffect(() => {
    if (!isUserAtBottom) {
      return;
    }

    const container = messagesRef.current;
    if (!container) {
      return;
    }

    container.scrollTop = container.scrollHeight;
  }, [chatMessages.length, lastMessage?.content, isUserAtBottom]);

  const handleScroll = () => {
    const container = messagesRef.current;
    if (!container) {
      return;
    }

    const atBottom =
      container.scrollHeight - (container.scrollTop + container.clientHeight) <
      BOTTOM_EPSILON_PX;
    setIsUserAtBottom(atBottom);
  };

  const handleSend = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const content = inputText.trim();
    if (!content || chatStatus === 'loading') {
      return;
    }

    appendChatMessage({
      id: crypto.randomUUID(),
      role: 'user',
      content,
      isStreaming: false,
      timestamp: Date.now(),
    });
    setInputText('');
  };

  const handleRetry = () => {
    if (chatStatus === 'loading') {
      return;
    }
    const retrySnapshot = getMessagesUpToLatestUser(
      useTwinMindStore.getState().chatMessages,
    );
    if (retrySnapshot.length === 0) {
      return;
    }
    void sendChatRequest(retrySnapshot);
  };

  return (
    <section aria-label="Chat" className={className}>
      <div className="flex h-full flex-col p-4">
        <div className="mb-2 text-xs text-gray-500">{chatStatusLabel}</div>

        <div
          ref={messagesRef}
          onScroll={handleScroll}
          className="flex-1 space-y-3 overflow-y-auto rounded border border-gray-200 bg-gray-50 p-3"
        >
          {chatMessages.map((message) => (
            <div
              key={message.id}
              title={new Date(message.timestamp).toLocaleTimeString()}
              className={
                message.role === 'user'
                  ? 'ml-8 rounded-lg bg-blue-600 p-3 text-sm text-white'
                  : 'mr-8 rounded-lg bg-white p-3 text-sm text-gray-900 border border-gray-200'
              }
            >
              <span>{message.content}</span>
              {message.isStreaming ? (
                <span className="ml-1 inline-block animate-pulse">▍</span>
              ) : null}
            </div>
          ))}
        </div>

        {chatStatus === 'error' ? (
          <div className="mt-2">
            <button
              type="button"
              className="rounded border border-red-200 bg-red-50 px-3 py-1 text-xs text-red-700 hover:bg-red-100"
              onClick={handleRetry}
            >
              Retry
            </button>
          </div>
        ) : null}

        <form onSubmit={handleSend} className="mt-3 flex gap-2">
          <textarea
            className="min-h-[44px] flex-1 resize-none rounded border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
            value={inputText}
            onChange={(event) => setInputText(event.target.value)}
            placeholder="Ask a follow-up..."
          />
          <button
            type="submit"
            disabled={!canSend}
            className="rounded bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-gray-400"
          >
            Send
          </button>
        </form>
      </div>
    </section>
  );
}
