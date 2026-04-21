import { describe, expect, it } from 'vitest';
import { POST as suggestionsPOST } from '@/app/api/suggestions/route';
import { POST as chatPOST } from '@/app/api/chat/route';

describe('route stubs', () => {
  it('POST /api/suggestions returns 500 without GROQ_API_KEY', async () => {
    const req = new Request('http://localhost/api/suggestions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recentTranscript: 'hello world' }),
    });
    const res = await suggestionsPOST(req);
    expect(res.status).toBe(500);
  });

  it('POST /api/chat returns 200', async () => {
    const res = await chatPOST();
    expect(res.status).toBe(200);
  });
});
