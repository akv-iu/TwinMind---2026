import { describe, expect, it } from 'vitest';
import { parseSuggestionsResponse } from '@/lib/suggestionsEngine';

const VALID_JSON = JSON.stringify({
  suggestions: [
    { type: 'question', text: 'What should we prioritize next?' },
    { type: 'talking_point', text: 'Highlight the launch timeline risks.' },
    { type: 'fact_check', text: 'Verify the Q4 churn percentage claim.' },
  ],
});

describe('parseSuggestionsResponse', () => {
  it('parses clean JSON with three suggestions', () => {
    const parsed = parseSuggestionsResponse(VALID_JSON);
    expect(parsed).not.toBeNull();
    expect(parsed).toHaveLength(3);
    expect(parsed?.every((item) => Boolean(item.id))).toBe(true);
  });

  it('parses markdown-fenced JSON', () => {
    const parsed = parseSuggestionsResponse(`\`\`\`json\n${VALID_JSON}\n\`\`\``);
    expect(parsed).not.toBeNull();
    expect(parsed).toHaveLength(3);
  });

  it('rejects prose-wrapped content', () => {
    const parsed = parseSuggestionsResponse(`Here you go: ${VALID_JSON}`);
    expect(parsed).toBeNull();
  });

  it('rejects arrays that are not length 3', () => {
    const parsed = parseSuggestionsResponse(
      JSON.stringify({
        suggestions: [
          { type: 'question', text: 'Q1' },
          { type: 'talking_point', text: 'T1' },
        ],
      }),
    );
    expect(parsed).toBeNull();
  });

  it('rejects invalid suggestion type values', () => {
    const parsed = parseSuggestionsResponse(
      JSON.stringify({
        suggestions: [
          { type: 'question', text: 'Q1' },
          { type: 'talking_point', text: 'T1' },
          { type: 'invalid', text: 'X1' },
        ],
      }),
    );
    expect(parsed).toBeNull();
  });

  it('rejects empty suggestion text values', () => {
    const parsed = parseSuggestionsResponse(
      JSON.stringify({
        suggestions: [
          { type: 'question', text: 'Q1' },
          { type: 'talking_point', text: '  ' },
          { type: 'fact_check', text: 'F1' },
        ],
      }),
    );
    expect(parsed).toBeNull();
  });
});
