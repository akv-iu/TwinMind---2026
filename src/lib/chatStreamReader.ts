import type { ChatRequest } from '@/types';

interface StreamChatOptions {
  body: ChatRequest;
  onDelta: (delta: string) => void;
  onDone: () => void;
  onError: (error: unknown) => void;
  signal: AbortSignal;
}

export async function streamChat(opts: StreamChatOptions): Promise<void> {
  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(opts.body),
      signal: opts.signal,
    });

    if (!response.ok) {
      opts.onError(new Error(`chat ${response.status}`));
      return;
    }

    if (!response.body) {
      opts.onError(new Error('chat stream missing body'));
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        opts.onDone();
        return;
      }

      const delta = decoder.decode(value, { stream: true });
      if (delta) {
        opts.onDelta(delta);
      }
    }
  } catch (error) {
    opts.onError(error);
  }
}
