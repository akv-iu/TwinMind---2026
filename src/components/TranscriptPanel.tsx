'use client';

import { useEffect, useRef, useState } from 'react';
import { useTwinMindStore } from '@/store/useTwinMindStore';

interface TranscriptPanelProps {
  className?: string;
}

const RECOVERABLE_ERRORS = new Set(['network', 'no-speech', 'audio-capture']);

export function TranscriptPanel({ className }: TranscriptPanelProps) {
  const transcript = useTwinMindStore((state) => state.transcript);
  const isRecording = useTwinMindStore((state) => state.isRecording);
  const appendTranscriptChunk = useTwinMindStore(
    (state) => state.appendTranscriptChunk,
  );
  const setIsRecording = useTwinMindStore((state) => state.setIsRecording);

  const [interimText, setInterimText] = useState('');
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const [unsupported, setUnsupported] = useState(false);

  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const Ctor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Ctor) {
      setUnsupported(true);
    }

    return () => {
      if (restartTimerRef.current) {
        clearTimeout(restartTimerRef.current);
        restartTimerRef.current = null;
      }

      const recognition = recognitionRef.current;
      if (recognition) {
        recognition.onresult = null;
        recognition.onerror = null;
        recognition.onend = null;
        recognition.abort();
        recognitionRef.current = null;
      }

      setIsRecording(false);
    };
  }, [setIsRecording]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [transcript.length]);

  const startRecording = () => {
    if (unsupported || permissionError) {
      return;
    }

    const Ctor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Ctor) {
      setUnsupported(true);
      return;
    }

    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }

    const recognition = new Ctor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onresult = (event) => {
      let interim = '';

      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];

        if (result.isFinal) {
          const text = result[0].transcript.trim();
          if (text) {
            useTwinMindStore.getState().appendTranscriptChunk(text);
          }
        } else {
          interim += result[0].transcript;
        }
      }

      setInterimText(interim);
    };

    recognition.onerror = (event) => {
      if (event.error === 'not-allowed') {
        setPermissionError(
          'Microphone access denied. Enable mic access in the browser and reload.',
        );
        setInterimText('');
        useTwinMindStore.getState().setIsRecording(false);
        return;
      }

      if (RECOVERABLE_ERRORS.has(event.error)) {
        if (restartTimerRef.current) {
          clearTimeout(restartTimerRef.current);
        }

        restartTimerRef.current = setTimeout(() => {
          if (useTwinMindStore.getState().isRecording) {
            try {
              recognitionRef.current?.start();
            } catch {
              // Ignore repeated start failures; onend/onerror handles future retries.
            }
          }
        }, 1000);
      }
    };

    recognition.onend = () => {
      if (useTwinMindStore.getState().isRecording) {
        try {
          recognitionRef.current?.start();
        } catch {
          // Ignore repeated start failures; onerror handles recoverable restart timing.
        }
      }
    };

    recognitionRef.current = recognition;
    useTwinMindStore.getState().setIsRecording(true);

    try {
      recognition.start();
      setPermissionError(null);
    } catch {
      useTwinMindStore.getState().setIsRecording(false);
    }
  };

  const stopRecording = () => {
    const pendingInterim = interimText.trim();
    if (pendingInterim) {
      appendTranscriptChunk(pendingInterim);
    }
    setInterimText('');

    useTwinMindStore.getState().setIsRecording(false);

    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }

    recognitionRef.current?.stop();
  };

  if (unsupported) {
    return (
      <section aria-label="Transcript" className={className}>
        <div className="p-4">
          <p className="text-sm text-gray-700">
            This browser does not support live speech recognition. Use Chrome
            or Edge.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section aria-label="Transcript" className={className}>
      <div className="flex h-full flex-col gap-3 p-4">
        {permissionError ? (
          <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {permissionError}
          </p>
        ) : null}

        <button
          type="button"
          onClick={isRecording ? stopRecording : startRecording}
          className="w-fit rounded border border-gray-300 px-4 py-2 text-sm font-medium text-gray-900 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={Boolean(permissionError)}
        >
          {isRecording ? 'Stop Recording' : 'Start Recording'}
        </button>

        <div className="flex-1 space-y-2">
          {transcript.map((chunk) => (
            <p key={chunk.id} className="text-sm text-gray-900">
              {chunk.text}
            </p>
          ))}
          {interimText.trim() ? (
            <p className="text-sm italic text-gray-400">{interimText}</p>
          ) : null}
          <div ref={endRef} />
        </div>
      </div>
    </section>
  );
}
