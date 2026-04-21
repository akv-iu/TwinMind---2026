'use client';

import { useEffect } from 'react';
import { startSuggestionsEngine, stopSuggestionsEngine } from '@/lib/suggestionsEngine';
import { useTwinMindStore } from '@/store/useTwinMindStore';
import { SuggestionCard } from '@/components/SuggestionCard';

interface SuggestionsPanelProps {
  className?: string;
}

export function SuggestionsPanel({ className }: SuggestionsPanelProps) {
  const suggestionBatches = useTwinMindStore((state) => state.suggestionBatches);
  const suggestionsStatus = useTwinMindStore((state) => state.suggestionsStatus);
  const suggestionsHintVisible = useTwinMindStore(
    (state) => state.suggestionsHintVisible,
  );
  const injectSuggestionToChat = useTwinMindStore(
    (state) => state.injectSuggestionToChat,
  );

  useEffect(() => {
    startSuggestionsEngine();
    return () => {
      stopSuggestionsEngine();
    };
  }, []);

  const batches = suggestionBatches.slice().reverse();
  const denominator = Math.max(batches.length - 1, 1);

  return (
    <section aria-label="Suggestions" className={className}>
      <div className="flex h-full flex-col gap-3 p-4">
        {suggestionsHintVisible && suggestionBatches.length === 0 ? (
          <p className="text-xs text-gray-500">
            Speak for 30+ seconds to get suggestions.
          </p>
        ) : null}

        {suggestionsStatus === 'error' ? (
          <p className="text-xs text-red-600">
            Couldn&apos;t reach the suggestions service - retrying.
          </p>
        ) : null}

        <div className="space-y-3">
          {batches.map((batch, index) => {
            const opacity = Math.max(0.2, 1 - 0.8 * (index / denominator));

            return (
              <div
                key={batch.id}
                data-testid={`suggestion-batch-${batch.id}`}
                className="space-y-2"
                style={{ opacity }}
              >
                {batch.suggestions.map((suggestion) => (
                  <SuggestionCard
                    key={suggestion.id}
                    suggestion={suggestion}
                    onClick={injectSuggestionToChat}
                  />
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
