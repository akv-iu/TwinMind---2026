# Plan: Chat System

Spec: [_specs/chat-system.md](../_specs/chat-system.md)
Branch (for future commit work): `claude/feature/chat-system`

## Context

`chat-system` is the on-demand deep-reasoning surface — the rightmost column of the 3-column layout. It is the most intricate slice in the product: it owns (a) a streaming `/api/chat` route that calls Groq's `llama3-70b-8192` with `stream: true`, (b) server-side token-budget trimming via `trimHistoryToTokenBudget` (master spec §8.6), (c) a `ReadableStream`/`TextDecoder` client loop that feeds `updateStreamingMessage` token-by-token, and (d) bulletproof error recovery (§8.10) so a dropped connection never leaves `isStreaming: true` forever.

This maps to **Step 7** of the master spec build order (§9). Prerequisites:
- **app-foundation** — store actions (`appendChatMessage`, `updateStreamingMessage`, `finalizeStreamingMessage`, `injectSuggestionToChat`, `setChatStatus`), `ChatRequest` type, `/api/chat` 200 stub all exist.
- **ui-layout** — 3-column grid with `ChatPanel` slotted in the third column (right).
- **real-time-transcription** — finalized `TranscriptChunk[]` arrives in the store so `recentTranscript` can be built from `transcript.slice(-30)`.

Downstream:
- **deployment** — configures `maxDuration: 60` in `vercel.json` and injects `GROQ_API_KEY` server-side. This slice depends on the env var being available at runtime but does **not** do the missing-var handling (that's deployment's spec).
- **suggestion-generation** — owns the `SuggestionCard` click handler that calls `store.injectSuggestionToChat`. This slice only cares that *some* `user` message appears in the store — the trigger is transparent.

## Working assumptions (flag if wrong)

- **Groq SDK**: use the official `groq-sdk` npm package — master spec locks it as the stack.
- **Scroll behavior**: `ChatPanel`'s own column already has `overflow-y: auto` from `ui-layout`. Auto-scroll manipulates `scrollTop` on the inner messages container.

## Open Questions — decisions

The spec left 7 Open Questions unanswered. Questions 1, 2, 4, and 7 were confirmed with the user; 3, 5, and 6 default as below.

| # | Question | Decision | Source |
|---|---|---|---|
| 1 | In-flight conflict (new user msg while streaming) | **Block** — Send disabled + `SuggestionCard` visually non-interactive while `chatStatus === 'loading'` | User-confirmed |
| 2 | Retry on error | **Manual retry button** on the error state; re-sends against the last user message | User-confirmed |
| 3 | Streaming indicator | **Blinking cursor** appended while `isStreaming === true` | Default (spec lists this option) |
| 4 | Auto-scroll policy | **Follow bottom while user is at bottom; pause when they scroll up; resume when they scroll back** | User-confirmed |
| 5 | Timestamp display | **On hover** (`title` attribute with locale time) | Default (keeps UI clean) |
| 6 | Reader-loop overall timeout | **55 seconds** via `AbortController` | Default (under Vercel's 60s `maxDuration`) |
| 7 | Non-200 UX | **Inline system-style message** in the chat stream | User-confirmed |

## Scope

1. **Server route**: Replace `/api/chat` stub with the full streaming handler. Prepends `CHAT_SYSTEM_PROMPT` + transcript context, runs `trimHistoryToTokenBudget`, calls Groq with `stream: true`, returns a `ReadableStream` with `Content-Type: text/event-stream`.
2. **Server utility** `src/lib/trimHistoryToTokenBudget.ts` — pure, testable; 10 000-token budget; `Math.ceil(totalChars / 4)`; drops oldest user+assistant pairs; never orphans a role; never drops the latest user message.
3. **Server utility** `src/lib/chatSystemPrompt.ts` — exports `CHAT_SYSTEM_PROMPT` (per master spec §7.2) and `buildSystemMessage(recentTranscript)`.
4. **Client utility** `src/lib/chatStreamReader.ts` — pure, React-free `fetch` + `ReadableStream` + `TextDecoder` loop with `AbortSignal` for the 55s timeout; `try`/`catch` so callers can always finalize.
5. **Client component** `src/components/ChatPanel.tsx` — message list, text input + Send, streaming reader integration, auto-scroll (follow-bottom with pause), blinking cursor, inline error + retry.
6. **Single effect** reacting to any unresolved latest `user` message — unifies the typed-Send path and the `injectSuggestionToChat` path.
7. **Tests**: trim invariants, stream happy path + drop, non-200 error, suggestion-injection fires outbound, transcript window capped at 30, empty Send disabled.

**Out of scope**:
- `SuggestionCard` click handler (→ `suggestion-generation`).
- Missing `GROQ_API_KEY` structured 500 + log (→ `deployment`).
- `vercel.json` `maxDuration: 60` (→ `deployment`).
- Mobile / narrow-viewport chat UX (→ `ui-layout` / post-launch).
- Persistence across sessions.

## Implementation Steps

### 1. Install Groq SDK
```
npm install groq-sdk
```
Fixed by the master spec — do not substitute.

### 2. `src/lib/chatSystemPrompt.ts`
- Export `CHAT_SYSTEM_PROMPT` (from master spec §7.2): emphasizes depth, structured responses, referencing transcript specifics, honest uncertainty when unknown.
- Export `buildSystemMessage(recentTranscript: string)` → `{ role: 'system', content: `${CHAT_SYSTEM_PROMPT}\n\nRecent conversation transcript:\n${recentTranscript}` }`.

### 3. `src/lib/trimHistoryToTokenBudget.ts` (master spec §8.6)

Signature:
```ts
export function trimHistoryToTokenBudget(
  messages: { role: MessageRole; content: string }[],
  budget = 10_000,
): { role: MessageRole; content: string }[];
```

Algorithm:
- `estimate(msgs) = Math.ceil(msgs.reduce((n, m) => n + m.content.length, 0) / 4)`.
- While `estimate(result) > budget` AND `result.length > 1`: drop the **first user+assistant pair** from the front. If the oldest message is an orphan assistant (defensive), drop it alone.
- **Never drop the last message** — if trimming would empty the array save for the last user message, stop there; the route sends what remains (pragmatic trimmer, not a blocker).
- System prompt is **not** passed into this function (prepended fresh in the route), so there's zero risk of dropping it.

### 4. `src/app/api/chat/route.ts`

Replace the 200-stub from app-foundation with:
```ts
import Groq from 'groq-sdk';
import { buildSystemMessage } from '@/lib/chatSystemPrompt';
import { trimHistoryToTokenBudget } from '@/lib/trimHistoryToTokenBudget';
import type { ChatRequest } from '@/types';

export async function POST(req: Request) {
  const { messages, recentTranscript } = (await req.json()) as ChatRequest;
  const trimmed = trimHistoryToTokenBudget(messages);
  const groqMessages = [buildSystemMessage(recentTranscript), ...trimmed];

  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  const completion = await groq.chat.completions.create({
    model: 'llama3-70b-8192',
    messages: groqMessages,
    stream: true,
  });

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      for await (const chunk of completion) {
        const delta = chunk.choices[0]?.delta?.content ?? '';
        if (delta) controller.enqueue(encoder.encode(delta));
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
  });
}
```
- No try/catch for missing env — that's `deployment`'s handler (OQ-tier, separate slice).
- No manual `req.json()` validation — type boundary is the `ChatRequest` contract; a malformed body yields Next's default 400.

### 5. `src/lib/chatStreamReader.ts`

Pure, React-free, independently testable:
```ts
export async function streamChat(opts: {
  body: ChatRequest;
  onDelta: (delta: string) => void;
  onDone: () => void;
  onError: (err: unknown) => void;
  signal: AbortSignal;
}): Promise<void>
```
- `fetch('/api/chat', { method: 'POST', body: JSON.stringify(opts.body), signal: opts.signal })`.
- If `!res.ok` → `onError(new Error('chat ${res.status}'))` and return.
- `reader = res.body!.getReader(); decoder = new TextDecoder();`
- Loop `reader.read()`; on each value → `onDelta(decoder.decode(value, { stream: true }))`.
- On `done` → `onDone()`.
- Wrap the whole thing in try/catch → `onError(err)`; never rethrow.

### 6. `src/components/ChatPanel.tsx`

State & subscriptions:
- `useTwinMindStore` → `chatMessages`, `chatStatus`, `transcript`, `appendChatMessage`, `updateStreamingMessage`, `finalizeStreamingMessage`, `setChatStatus`.
- Local `inputText: string`, `isUserAtBottom: boolean`, `messagesRef: HTMLDivElement`.

Unified trigger effect (handles both typed Send and `injectSuggestionToChat`):
```ts
useEffect(() => {
  const last = chatMessages[chatMessages.length - 1];
  if (!last) return;
  if (last.role !== 'user') return;
  if (chatStatus === 'loading') return;
  sendChatRequest();
}, [chatMessages, chatStatus]);
```

`sendChatRequest()`:
```ts
setChatStatus('loading');
const assistantId = crypto.randomUUID();
const priorMessages = useTwinMindStore.getState().chatMessages;
const recentTranscript = useTwinMindStore.getState().transcript.slice(-30).map(c => c.text).join('\n');

appendChatMessage({
  id: assistantId,
  role: 'assistant',
  content: '',
  isStreaming: true,
  timestamp: Date.now(),
});

const controller = new AbortController();
const timeoutId = setTimeout(() => controller.abort(), 55_000);

try {
  await streamChat({
    body: {
      messages: priorMessages.map(m => ({ role: m.role, content: m.content })),
      recentTranscript,
    },
    onDelta: (d) => updateStreamingMessage(assistantId, d),
    onDone: () => { finalizeStreamingMessage(assistantId); setChatStatus('idle'); },
    onError: () => {
      updateStreamingMessage(assistantId, '\n\n[Response interrupted — please retry]');
      finalizeStreamingMessage(assistantId);
      setChatStatus('error');
    },
    signal: controller.signal,
  });
} finally {
  clearTimeout(timeoutId);
}
```
- `priorMessages` is read from `getState()` and snapshotted *before* appending the empty assistant placeholder — the assistant placeholder must never reach Groq.
- `recentTranscript` also uses `getState()` to avoid stale closure.

Rendering:
- Scrollable `<div ref={messagesRef} onScroll={...}>` containing a list of `ChatMessage` bubbles.
- Bubble content: `{msg.content}{msg.isStreaming && <span className="animate-pulse">▍</span>}`.
- Timestamp on hover via `title={new Date(msg.timestamp).toLocaleTimeString()}`.
- Error state (`chatStatus === 'error'`): inline `<button onClick={sendChatRequest}>Retry</button>` under the last message. Prior messages remain intact.
- Input area: `<textarea>` + Send. Send disabled when `inputText.trim() === ''` OR `chatStatus === 'loading'`. On submit: append a `user` `ChatMessage` with `crypto.randomUUID()`, role `'user'`, `isStreaming: false`, then clear the textarea. The unified effect fires the request.
- Auto-scroll:
  - `onScroll` handler: `isUserAtBottom = scrollHeight - (scrollTop + clientHeight) < 40`.
  - `useEffect` on `chatMessages` (length and last-message content): if `isUserAtBottom`, set `scrollTop = scrollHeight`.

### 7. Tests

Organize under `tests/chat/`:

- `tests/chat/trimHistory.test.ts`:
  - Under budget → returns array equal to input.
  - Over budget → drops oldest pair (assertion: length decreases by 2 per iteration, first surviving role is `'user'`).
  - Only last message remains when budget is impossibly small → returns `[lastUser]` without infinite loop.
  - Char/4 boundary: a single message of exactly `4 * budget` chars stays; `4 * budget + 4` chars gets dropped if it isn't the last.
- `tests/chat/streamReader.test.ts`:
  - Mock `fetch` with a `ReadableStream` yielding three chunks → `onDelta` called 3×, `onDone` 1×, `onError` 0×.
  - Mock reader that throws mid-stream → `onError` called 1× with the error, `onDone` 0×.
  - Mock non-200 response → `onError` called 1×, `onDone` 0×.
  - Abort signal fires mid-stream → `onError` called with an abort-shaped error.
- `tests/chat/chatPanel.test.tsx` (React Testing Library):
  - Empty input → Send disabled; whitespace-only input → disabled.
  - Typing text + clicking Send → a `user` `ChatMessage` is in the store and `fetch` is called with `/api/chat`.
  - Calling `store.injectSuggestionToChat({ id, type, text })` directly → component fires `fetch` with the suggestion text as the last user message (no other code path invoked).
  - Simulated mid-stream throw → last assistant message has `isStreaming === false` and content ends with `\n\n[Response interrupted — please retry]`; `chatStatus === 'error'`; retry button visible; prior messages intact.
  - Non-200 response → same as drop path (inline error, retry button, no lost messages).
  - Seeded store with 100 transcript chunks → outbound `body.recentTranscript` contains exactly 30 `\n`-joined lines.

## Critical files to create / modify

- **Modify**: [src/app/api/chat/route.ts](../src/app/api/chat/route.ts) — full streaming handler
- **Create**: [src/lib/chatSystemPrompt.ts](../src/lib/chatSystemPrompt.ts)
- **Create**: [src/lib/trimHistoryToTokenBudget.ts](../src/lib/trimHistoryToTokenBudget.ts)
- **Create**: [src/lib/chatStreamReader.ts](../src/lib/chatStreamReader.ts)
- **Create**: [src/components/ChatPanel.tsx](../src/components/ChatPanel.tsx)
- **Modify**: [src/app/page.tsx](../src/app/page.tsx) — slot `<ChatPanel />` into the third column's placeholder left by `ui-layout`
- **Create**: [tests/chat/trimHistory.test.ts](../tests/chat/trimHistory.test.ts)
- **Create**: [tests/chat/streamReader.test.ts](../tests/chat/streamReader.test.ts)
- **Create**: [tests/chat/chatPanel.test.tsx](../tests/chat/chatPanel.test.tsx)

## Invariants to preserve

1. **Zero client-side `GROQ_API_KEY` reference** — not in `ChatPanel`, not in any hook, not in any shared util. Only the route handler touches `process.env.GROQ_API_KEY`.
2. **Trim runs server-side** (§8.6 INVARIANT) — client sends full history; do not trim in `ChatPanel` or `streamChat`.
3. **Always finalize on error** (§8.10) — the catch path calls `updateStreamingMessage(id, '[Response interrupted — please retry]')` then `finalizeStreamingMessage(id)`. `isStreaming: true` surviving past an error is a bug.
4. **Transcript snapshot is fresh** — built via `getState().transcript.slice(-30)` inside `sendChatRequest()`, not via a value captured at render.
5. **System prompt never flows through the trimmer** — prepended fresh in the route; never stored in `chatMessages`.
6. **Cross-pipeline trigger is store-only** — `SuggestionCard` does not call into `ChatPanel` directly; it appends a `user` message via `injectSuggestionToChat`, and the single effect in `ChatPanel` observes.
7. **Last user message is never trimmed** even when over budget.
8. **Reader timeout ≤ Vercel `maxDuration`** — 55 s < 60 s. If `deployment` changes the Vercel cap, update this constant (currently a literal in `ChatPanel.tsx`).
9. **Input blocked during stream** — Send disabled + cards non-interactive while `chatStatus === 'loading'`. Prevents the in-flight conflict case entirely.

## Verification

1. `npx tsc --noEmit` — passes under strict.
2. `npm run lint` — clean.
3. `npm run dev`, then type a message + Send → tokens stream in token-by-token (not single batch), blinking cursor visible during, disappears on finalize.
4. **Suggestion injection flow** (verifiable once `suggestion-generation` is wired, or via a throwaway `store.injectSuggestionToChat(...)` call in the devtools console): a `user` bubble with the suggestion text appears → assistant reply streams in.
5. **Dropped-stream simulation**: DevTools → Network → Throttle to Offline mid-stream → final message ends with `\n\n[Response interrupted — please retry]`; cursor gone; retry button visible. Click retry → new streaming attempt.
6. **Overflow simulation**: seed `chatMessages` with 80 synthetic pairs of long content in devtools → send a message → no Groq 400; server log (if present) confirms trim dropped oldest pairs.
7. **No client-side Groq**: DevTools Network filter for `groq` during a full chat interaction → zero matches. `grep -ri "groq" .next/static/` post-build → zero matches (also enforced by `deployment`).
8. **Empty-input guard**: Send stays disabled on empty and whitespace-only input.
9. **In-flight block**: while a stream is running, Send button is disabled; simulated suggestion click is ignored.
10. `npm test` — all chat tests green.

## Stop condition

This slice is **done** when:
- Typing a message → streamed assistant reply token-by-token.
- An external append to `chatMessages` via `store.injectSuggestionToChat(...)` triggers an outbound call with no further code change in `ChatPanel` or anywhere else.
- `deployment` can add `vercel.json` with `maxDuration: 60` with no code changes here.
- `suggestion-generation` can wire `SuggestionCard` click handlers with no changes to `ChatPanel`.

Do **not** begin `suggestion-generation` inside this slice — the master spec build order (§9) is sequential and each step closes out before the next begins.
