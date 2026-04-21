import Groq from 'groq-sdk';
import { parseSuggestionsResponse } from '@/lib/suggestionsEngine';
import type { SuggestionsRequest, SuggestionsResponse } from '@/types';

export const runtime = 'nodejs';

const SYSTEM_PROMPT = `You are an assistant that, given a recent transcript of a conversation, suggests EXACTLY THREE items:
1) a question the speaker could ask next ("type": "question")
2) a talking point worth raising ("type": "talking_point")
3) a fact in the transcript that is worth verifying ("type": "fact_check")

Respond ONLY with JSON of the form:
{ "suggestions": [ { "type": "...", "text": "..." }, ... ] }
No prose, no markdown fences. Keep each "text" under 140 characters.`;

export async function POST(req: Request): Promise<Response> {
  if (!process.env.GROQ_API_KEY) {
    console.error('[api/suggestions] missing GROQ_API_KEY');
    return Response.json({ error: 'SERVER_MISCONFIGURED' }, { status: 500 });
  }

  let body: SuggestionsRequest;
  try {
    body = (await req.json()) as SuggestionsRequest;
  } catch {
    return Response.json({ error: 'BAD_JSON' }, { status: 400 });
  }

  if (typeof body?.recentTranscript !== 'string') {
    return Response.json({ error: 'BAD_INPUT' }, { status: 400 });
  }

  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

  try {
    const completion = await groq.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      temperature: 0.4,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: body.recentTranscript },
      ],
    });

    const raw = completion.choices[0]?.message?.content ?? '';
    const suggestions = parseSuggestionsResponse(raw);
    if (!suggestions) {
      return Response.json({ error: 'PARSE_FAILURE' }, { status: 422 });
    }

    const payload: SuggestionsResponse = { suggestions };
    return Response.json(payload);
  } catch (error) {
    console.error('[api/suggestions] groq error', error);
    return Response.json({ error: 'UPSTREAM_FAILURE' }, { status: 502 });
  }
}
