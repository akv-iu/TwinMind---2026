import type { MessageRole } from '@/types';

interface MessageLike {
  role: MessageRole;
  content: string;
}

function estimateTokens(messages: MessageLike[]): number {
  const totalChars = messages.reduce((sum, message) => sum + message.content.length, 0);
  return Math.ceil(totalChars / 4);
}

export function trimHistoryToTokenBudget(
  messages: MessageLike[],
  budget = 10_000,
): MessageLike[] {
  const result = [...messages];

  while (estimateTokens(result) > budget && result.length > 1) {
    const first = result[0];

    if (first.role === 'assistant') {
      result.shift();
      continue;
    }

    if (result.length <= 2) {
      break;
    }

    if (result[1]?.role === 'assistant') {
      result.splice(0, 2);
      continue;
    }

    result.shift();
  }

  return result;
}
