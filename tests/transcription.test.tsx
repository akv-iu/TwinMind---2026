import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TranscriptPanel } from '@/components/TranscriptPanel';
import { useTwinMindStore } from '@/store/useTwinMindStore';

const initialState = useTwinMindStore.getState();

const originalSpeechRecognition = window.SpeechRecognition;
const originalWebkitSpeechRecognition = window.webkitSpeechRecognition;

interface MockResultInput {
  isFinal: boolean;
  transcript: string;
}

function createResult(
  isFinal: boolean,
  transcript: string,
): SpeechRecognitionResult {
  const alternative = {
    transcript,
    confidence: 0.9,
  } as SpeechRecognitionAlternative;

  const result = {
    length: 1,
    isFinal,
    item: () => alternative,
  } as unknown as SpeechRecognitionResult & {
    [index: number]: SpeechRecognitionAlternative;
  };

  result[0] = alternative;
  return result;
}

function createResultList(
  inputs: MockResultInput[],
): SpeechRecognitionResultList {
  const results = inputs.map((input) =>
    createResult(input.isFinal, input.transcript),
  );

  const list = {
    length: results.length,
    item: (index: number) => results[index],
  } as unknown as SpeechRecognitionResultList & {
    [index: number]: SpeechRecognitionResult;
  };

  results.forEach((result, index) => {
    list[index] = result;
  });

  return list;
}

class MockSpeechRecognition {
  static instances: MockSpeechRecognition[] = [];

  continuous = false;
  interimResults = false;
  lang = '';

  onresult: ((this: SpeechRecognition, ev: SpeechRecognitionEvent) => void) | null =
    null;
  onerror:
    | ((this: SpeechRecognition, ev: SpeechRecognitionErrorEvent) => void)
    | null = null;
  onend: ((this: SpeechRecognition, ev: Event) => void) | null = null;

  start = vi.fn();
  stop = vi.fn();
  abort = vi.fn();

  constructor() {
    MockSpeechRecognition.instances.push(this);
  }

  emitResult(inputs: MockResultInput[], resultIndex = 0) {
    this.onresult?.call(this as unknown as SpeechRecognition, {
      resultIndex,
      results: createResultList(inputs),
    } as SpeechRecognitionEvent);
  }

  emitError(error: SpeechRecognitionErrorEvent['error']) {
    this.onerror?.call(this as unknown as SpeechRecognition, {
      error,
      message: '',
    } as SpeechRecognitionErrorEvent);
  }

  emitEnd() {
    this.onend?.call(this as unknown as SpeechRecognition, new Event('end'));
  }
}

function renderPanel() {
  render(React.createElement(TranscriptPanel, { className: 'h-screen overflow-y-auto' }));
}

function startRecording() {
  fireEvent.click(screen.getByRole('button', { name: 'Start Recording' }));
  const instance = MockSpeechRecognition.instances.at(-1);
  if (!instance) {
    throw new Error('No SpeechRecognition instance was created');
  }
  return instance;
}

beforeEach(() => {
  useTwinMindStore.setState(initialState, true);
  MockSpeechRecognition.instances = [];
  window.SpeechRecognition =
    MockSpeechRecognition as unknown as SpeechRecognitionStatic;
  window.webkitSpeechRecognition = undefined;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
  window.SpeechRecognition = originalSpeechRecognition;
  window.webkitSpeechRecognition = originalWebkitSpeechRecognition;
});

describe('TranscriptPanel speech recognition', () => {
  it('keeps interim text out of the store', () => {
    renderPanel();
    const recognition = startRecording();

    act(() => {
      recognition.emitResult([{ isFinal: false, transcript: 'hello' }]);
    });

    expect(useTwinMindStore.getState().transcript).toHaveLength(0);
    expect(screen.getByText('hello')).toBeInTheDocument();
  });

  it('appends final chunks once with trimmed text', () => {
    renderPanel();
    const recognition = startRecording();

    act(() => {
      recognition.emitResult([{ isFinal: true, transcript: '  hello world  ' }]);
    });

    const transcript = useTwinMindStore.getState().transcript;
    expect(transcript).toHaveLength(1);
    expect(transcript[0].text).toBe('hello world');
    expect(useTwinMindStore.getState().lastFinalizedAt).toBeGreaterThan(0);
  });

  it('finalizes pending interim text on manual stop', () => {
    renderPanel();
    const recognition = startRecording();

    act(() => {
      recognition.emitResult([{ isFinal: false, transcript: 'foo' }]);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Stop Recording' }));

    const transcript = useTwinMindStore.getState().transcript;
    expect(transcript).toHaveLength(1);
    expect(transcript[0].text).toBe('foo');
    expect(useTwinMindStore.getState().isRecording).toBe(false);
    expect(recognition.stop).toHaveBeenCalledTimes(1);
  });

  it('handles not-allowed errors with persistent permission state and no restart', () => {
    vi.useFakeTimers();
    renderPanel();
    const recognition = startRecording();

    act(() => {
      recognition.emitError('not-allowed');
    });

    expect(
      screen.getByText(
        'Microphone access denied. Enable mic access in the browser and reload.',
      ),
    ).toBeInTheDocument();
    expect(useTwinMindStore.getState().isRecording).toBe(false);

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(recognition.start).toHaveBeenCalledTimes(1);
  });

  it('restarts after recoverable network errors when recording stays active', () => {
    vi.useFakeTimers();
    renderPanel();
    const recognition = startRecording();

    act(() => {
      recognition.emitError('network');
    });

    act(() => {
      vi.advanceTimersByTime(999);
    });
    expect(recognition.start).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(recognition.start).toHaveBeenCalledTimes(2);
  });

  it('does not restart from recoverable errors if recording is stopped first', () => {
    vi.useFakeTimers();
    renderPanel();
    const recognition = startRecording();

    act(() => {
      recognition.emitError('network');
    });
    fireEvent.click(screen.getByRole('button', { name: 'Stop Recording' }));

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(recognition.start).toHaveBeenCalledTimes(1);
  });

  it('auto-restarts on end only while recording is true', () => {
    renderPanel();
    const recognition = startRecording();

    act(() => {
      recognition.emitEnd();
    });
    expect(recognition.start).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole('button', { name: 'Stop Recording' }));
    act(() => {
      recognition.emitEnd();
    });
    expect(recognition.start).toHaveBeenCalledTimes(2);
  });

  it('renders unsupported browser notice when speech recognition is unavailable', () => {
    window.SpeechRecognition = undefined;
    window.webkitSpeechRecognition = undefined;

    renderPanel();

    expect(
      screen.getByText(
        'This browser does not support live speech recognition. Use Chrome or Edge.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Start Recording' }),
    ).not.toBeInTheDocument();
  });

  it('scrolls to bottom when final transcript chunks are appended', () => {
    const scrollIntoViewSpy = vi
      .spyOn(Element.prototype, 'scrollIntoView')
      .mockImplementation(() => {});

    renderPanel();
    const callsBeforeAppend = scrollIntoViewSpy.mock.calls.length;
    const recognition = startRecording();

    act(() => {
      recognition.emitResult([{ isFinal: true, transcript: 'final text' }]);
    });

    expect(scrollIntoViewSpy.mock.calls.length).toBeGreaterThan(callsBeforeAppend);
    scrollIntoViewSpy.mockRestore();
  });
});
