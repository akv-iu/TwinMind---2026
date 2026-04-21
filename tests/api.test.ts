import { describe, expect, it } from 'vitest';
import { POST as suggestionsPOST } from '@/app/api/suggestions/route';
import { POST as chatPOST } from '@/app/api/chat/route';

describe('route stubs', () => {
  it('POST /api/suggestions returns 200', async () => {
    const res = await suggestionsPOST();
    expect(res.status).toBe(200);
  });

  it('POST /api/chat returns 200', async () => {
    const res = await chatPOST();
    expect(res.status).toBe(200);
  });
});
