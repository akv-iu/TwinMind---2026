import { afterEach, describe, expect, it, vi } from 'vitest';
import { streamChat } from '@/lib/chatStreamReader';
import type { ChatRequest } from '@/types';

const requestBody: ChatRequest = {
  messages: [{ role: 'user', content: 'hello' }],
  recentTranscript: 'hello',
};

function responseFromChunks(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
  return new Response(stream, { status: 200 });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('streamChat', () => {
  it('streams deltas and calls onDone once on success', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      responseFromChunks(['one ', 'two ', 'three']),
    );

    const onDelta = vi.fn();
    const onDone = vi.fn();
    const onError = vi.fn();

    await streamChat({
      body: requestBody,
      onDelta,
      onDone,
      onError,
      signal: new AbortController().signal,
    });

    expect(onDelta).toHaveBeenCalledTimes(3);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });

  it('calls onError when reader throws mid-stream', async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('partial'));
        controller.error(new Error('stream dropped'));
      },
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(stream, { status: 200 }),
    );

    const onDelta = vi.fn();
    const onDone = vi.fn();
    const onError = vi.fn();

    await streamChat({
      body: requestBody,
      onDelta,
      onDone,
      onError,
      signal: new AbortController().signal,
    });

    expect(onDone).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('calls onError on non-200 responses', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('bad', { status: 500 }),
    );

    const onDone = vi.fn();
    const onError = vi.fn();

    await streamChat({
      body: requestBody,
      onDelta: vi.fn(),
      onDone,
      onError,
      signal: new AbortController().signal,
    });

    expect(onDone).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('calls onError when the signal aborts during read', async () => {
    const controller = new AbortController();
    const abortErr = new DOMException('Aborted', 'AbortError');

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      const signal = init?.signal as AbortSignal | undefined;
      const encoder = new TextEncoder();
      let readCount = 0;

      return {
        ok: true,
        body: {
          getReader() {
            return {
              read: async () => {
                readCount += 1;
                if (readCount === 1) {
                  return { done: false, value: encoder.encode('chunk') };
                }

                return new Promise((_, reject) => {
                  if (signal?.aborted) {
                    reject(abortErr);
                    return;
                  }
                  signal?.addEventListener(
                    'abort',
                    () => reject(abortErr),
                    { once: true },
                  );
                });
              },
            };
          },
        },
      } as Response;
    });

    const onError = vi.fn();
    const promise = streamChat({
      body: requestBody,
      onDelta: vi.fn(),
      onDone: vi.fn(),
      onError,
      signal: controller.signal,
    });

    await Promise.resolve();
    await Promise.resolve();
    controller.abort();
    await promise;

    expect(onError).toHaveBeenCalledTimes(1);
  });
});
