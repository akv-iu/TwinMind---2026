import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatPanel } from '@/components/ChatPanel';
import { useTwinMindStore } from '@/store/useTwinMindStore';
import type { Suggestion, TranscriptChunk } from '@/types';

const initialState = useTwinMindStore.getState();

function successResponse(chunks: string[] = ['ok']): Response {
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

function interruptedResponse(): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode('partial'));
      controller.error(new Error('drop'));
    },
  });
  return new Response(stream, { status: 200 });
}

function buildTranscript(count: number): TranscriptChunk[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `t-${index}`,
    text: `line-${index}`,
    timestamp: Date.now() + index,
  }));
}

describe('ChatPanel', () => {
  beforeEach(() => {
    useTwinMindStore.setState(initialState, true);
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('disables send for empty and whitespace input', () => {
    render(React.createElement(ChatPanel, { className: 'h-screen' }));

    const send = screen.getByRole('button', { name: 'Send' });
    expect(send).toBeDisabled();

    const input = screen.getByPlaceholderText('Ask a follow-up...');
    fireEvent.change(input, { target: { value: '   ' } });
    expect(send).toBeDisabled();
  });

  it('sends typed message and calls /api/chat', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(successResponse(['hello']));

    render(React.createElement(ChatPanel, { className: 'h-screen' }));

    fireEvent.change(screen.getByPlaceholderText('Ask a follow-up...'), {
      target: { value: 'Test message' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));

    expect(useTwinMindStore.getState().chatMessages.some((message) => message.role === 'user' && message.content === 'Test message')).toBe(true);
    expect(fetchSpy.mock.calls[0][0]).toBe('/api/chat');
  });

  it('fires outbound chat request when suggestion injection appends a user message', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(successResponse(['from suggestion']));

    render(React.createElement(ChatPanel, { className: 'h-screen' }));

    const suggestion: Suggestion = {
      id: 's-1',
      type: 'question',
      text: 'What are the blockers?',
    };

    act(() => {
      useTwinMindStore.getState().injectSuggestionToChat(suggestion);
    });

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));

    const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string) as {
      messages: { role: string; content: string }[];
    };
    expect(body.messages[body.messages.length - 1].content).toBe(
      suggestion.text,
    );
  });

  it('finalizes interrupted streams and shows retry state', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(interruptedResponse());

    render(React.createElement(ChatPanel, { className: 'h-screen' }));
    fireEvent.change(screen.getByPlaceholderText('Ask a follow-up...'), {
      target: { value: 'Trigger error' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(
      () => expect(useTwinMindStore.getState().chatStatus).toBe('error'),
      {
        timeout: 2000,
      },
    );

    const assistant = [...useTwinMindStore.getState().chatMessages]
      .reverse()
      .find((message) => message.role === 'assistant');

    expect(assistant).toBeDefined();
    expect(assistant?.isStreaming).toBe(false);
    expect(assistant?.content.endsWith('[Response interrupted - please retry]')).toBe(
      true,
    );
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('keeps prior messages on non-200 and exposes retry', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('bad', { status: 500 }));

    render(React.createElement(ChatPanel, { className: 'h-screen' }));

    fireEvent.change(screen.getByPlaceholderText('Ask a follow-up...'), {
      target: { value: 'Trigger 500' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(useTwinMindStore.getState().chatStatus).toBe('error'));

    const messages = useTwinMindStore.getState().chatMessages;
    expect(messages.some((message) => message.role === 'user')).toBe(true);
    expect(messages.some((message) => message.role === 'assistant')).toBe(true);
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('caps recentTranscript payload to last 30 transcript chunks', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(successResponse(['ok']));

    useTwinMindStore.setState({
      transcript: buildTranscript(100),
      lastFinalizedAt: Date.now(),
    });

    render(React.createElement(ChatPanel, { className: 'h-screen' }));
    fireEvent.change(screen.getByPlaceholderText('Ask a follow-up...'), {
      target: { value: 'Check transcript cap' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));

    const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string) as {
      recentTranscript: string;
    };
    const lines = body.recentTranscript.split('\n');
    expect(lines).toHaveLength(30);
    expect(lines[0]).toBe('line-70');
    expect(lines[29]).toBe('line-99');
  });
});
