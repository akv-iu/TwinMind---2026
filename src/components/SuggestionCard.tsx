import type { Suggestion } from '@/types';

interface SuggestionCardProps {
  suggestion: Suggestion;
  onClick: (suggestion: Suggestion) => void;
}

const TYPE_STYLES: Record<Suggestion['type'], { label: string; className: string }> = {
  question: {
    label: 'Question to ask',
    className: 'bg-blue-100 text-blue-800',
  },
  talking_point: {
    label: 'Talking point',
    className: 'bg-green-100 text-green-800',
  },
  fact_check: {
    label: 'Fact check',
    className: 'bg-amber-100 text-amber-800',
  },
};

export function SuggestionCard({ suggestion, onClick }: SuggestionCardProps) {
  const style = TYPE_STYLES[suggestion.type];

  return (
    <button
      type="button"
      onClick={() => onClick(suggestion)}
      className="w-full rounded-lg border border-gray-200 bg-white p-3 text-left transition hover:bg-gray-50"
    >
      <span
        className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${style.className}`}
      >
        {style.label}
      </span>
      <p className="mt-2 text-sm text-gray-900">{suggestion.text}</p>
    </button>
  );
}
