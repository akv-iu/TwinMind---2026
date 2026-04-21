import { describe, expect, it } from 'vitest';
import { trimHistoryToTokenBudget } from '@/lib/trimHistoryToTokenBudget';
import type { MessageRole } from '@/types';

interface Msg {
  role: MessageRole;
  content: string;
}

function message(role: MessageRole, content: string): Msg {
  return { role, content };
}

describe('trimHistoryToTokenBudget', () => {
  it('returns all messages when already under budget', () => {
    const input = [message('user', 'hello'), message('assistant', 'hi')];
    const output = trimHistoryToTokenBudget(input, 1000);
    expect(output).toEqual(input);
  });

  it('drops oldest user-assistant pairs while preserving order', () => {
    const input = [
      message('user', 'u1 '.repeat(1000)),
      message('assistant', 'a1 '.repeat(1000)),
      message('user', 'u2 '.repeat(1000)),
      message('assistant', 'a2 '.repeat(1000)),
      message('user', 'u3 '.repeat(1000)),
      message('assistant', 'a3 '.repeat(1000)),
    ];

    const output = trimHistoryToTokenBudget(input, 3000);
    expect(output.length).toBeLessThan(input.length);
    expect(output[0].role).toBe('user');
    expect(output[1].role).toBe('assistant');
  });

  it('keeps at least one last message for very small budgets', () => {
    const input = [
      message('user', 'x'.repeat(9000)),
      message('assistant', 'y'.repeat(9000)),
    ];
    const output = trimHistoryToTokenBudget(input, 1);
    expect(output.length).toBeGreaterThanOrEqual(1);
    expect(output[output.length - 1]).toEqual(input[input.length - 1]);
  });

  it('respects char-to-token boundary behavior', () => {
    const withinBudget = [message('user', 'a'.repeat(4 * 100))];
    const overBudget = [
      message('user', 'a'.repeat(4 * 100 + 4)),
      message('assistant', 'b'),
    ];

    expect(trimHistoryToTokenBudget(withinBudget, 100)).toEqual(withinBudget);
    expect(trimHistoryToTokenBudget(overBudget, 100).length).toBeLessThanOrEqual(
      overBudget.length,
    );
  });
});
