import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SuggestionBatch } from '@/types';
import { SuggestionCard } from '@/components/SuggestionCard';
import { SuggestionsPanel } from '@/components/SuggestionsPanel';
import { useTwinMindStore } from '@/store/useTwinMindStore';

vi.mock('@/lib/suggestionsEngine', () => ({
  startSuggestionsEngine: vi.fn(),
  stopSuggestionsEngine: vi.fn(),
}));

const initialState = useTwinMindStore.getState();

function makeBatch(id: string, createdAt: number, label: string): SuggestionBatch {
  return {
    id,
    createdAt,
    transcriptSnapshot: `${label} snapshot`,
    suggestions: [
      { id: `${id}-q`, type: 'question', text: `${label} question` },
      { id: `${id}-t`, type: 'talking_point', text: `${label} talking point` },
      { id: `${id}-f`, type: 'fact_check', text: `${label} fact check` },
    ],
  };
}

describe('suggestions panel rendering', () => {
  beforeEach(() => {
    useTwinMindStore.setState(initialState, true);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders card labels/colors for all three suggestion types', () => {
    const { rerender } = render(
      React.createElement(SuggestionCard, {
        suggestion: {
          id: 's1',
          type: 'question',
          text: 'Q',
        },
        onClick: vi.fn(),
      }),
    );
    expect(screen.getByText('Question to ask')).toHaveClass('bg-blue-100');

    rerender(
      React.createElement(SuggestionCard, {
        suggestion: {
          id: 's2',
          type: 'talking_point',
          text: 'T',
        },
        onClick: vi.fn(),
      }),
    );
    expect(screen.getByText('Talking point')).toHaveClass('bg-green-100');

    rerender(
      React.createElement(SuggestionCard, {
        suggestion: {
          id: 's3',
          type: 'fact_check',
          text: 'F',
        },
        onClick: vi.fn(),
      }),
    );
    expect(screen.getByText('Fact check')).toHaveClass('bg-amber-100');
  });

  it('renders batches newest-first with monotonically decreasing opacity', () => {
    useTwinMindStore.setState({
      suggestionBatches: [
        makeBatch('b1', 1, 'oldest'),
        makeBatch('b2', 2, 'middle'),
        makeBatch('b3', 3, 'newest'),
      ],
    });

    const { container } = render(
      React.createElement(SuggestionsPanel, { className: 'h-screen' }),
    );

    const batchNodes = container.querySelectorAll('[data-testid^="suggestion-batch-"]');
    expect(batchNodes).toHaveLength(3);
    expect(batchNodes[0]).toHaveAttribute('data-testid', 'suggestion-batch-b3');
    expect(batchNodes[1]).toHaveAttribute('data-testid', 'suggestion-batch-b2');
    expect(batchNodes[2]).toHaveAttribute('data-testid', 'suggestion-batch-b1');

    const opacities = Array.from(batchNodes).map((node) =>
      Number.parseFloat((node as HTMLDivElement).style.opacity),
    );
    expect(opacities[0]).toBeGreaterThanOrEqual(opacities[1]);
    expect(opacities[1]).toBeGreaterThanOrEqual(opacities[2]);
    expect(opacities[2]).toBeGreaterThanOrEqual(0.2);
  });

  it('injects suggestion text into chat on card click', () => {
    useTwinMindStore.setState({
      suggestionBatches: [makeBatch('b9', 9, 'clickable')],
      chatMessages: [],
    });

    render(React.createElement(SuggestionsPanel, { className: 'h-screen' }));
    fireEvent.click(screen.getByRole('button', { name: /clickable question/i }));

    const messages = useTwinMindStore.getState().chatMessages;
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe('user');
    expect(messages[0].content).toBe('clickable question');
    expect(messages[0].triggeredBySuggestion).toBe('b9-q');
  });

  it('shows hint text when hint is visible and there are no batches', () => {
    useTwinMindStore.setState({
      suggestionBatches: [],
      suggestionsHintVisible: true,
    });

    render(React.createElement(SuggestionsPanel, { className: 'h-screen' }));

    expect(
      screen.getByText('Speak for 30+ seconds to get suggestions.'),
    ).toBeInTheDocument();
  });
});
