import Groq from 'groq-sdk';
import { buildSystemMessage } from '@/lib/chatSystemPrompt';
import { trimHistoryToTokenBudget } from '@/lib/trimHistoryToTokenBudget';
import type { ChatRequest } from '@/types';

export const runtime = 'nodejs';

export async function POST(req: Request): Promise<Response> {
  const { messages, recentTranscript } = (await req.json()) as ChatRequest;
  const trimmed = trimHistoryToTokenBudget(messages);
  const groqMessages = [buildSystemMessage(recentTranscript), ...trimmed];

  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  const completion = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: groqMessages,
    stream: true,
  });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();

      for await (const chunk of completion) {
        const delta = chunk.choices[0]?.delta?.content ?? '';
        if (delta) {
          controller.enqueue(encoder.encode(delta));
        }
      }

      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
    },
  });
}
