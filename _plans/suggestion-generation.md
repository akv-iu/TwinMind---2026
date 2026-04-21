# Plan: Suggestion Generation

Spec: [_specs/suggestion-generation.md](../_specs/suggestion-generation.md)
Branch (for future commit work): `claude/feature/suggestion-generation`

## Context

The `suggestion-generation` slice is the **proactive-AI pipeline** (master spec §2, §5.2). Every ~30 seconds it reads the most recent finalized transcript window, asks `llama3-8b-8192` (via `/api/suggestions`) for three structured suggestions — one question, one talking point, one fact-check — and appends a `SuggestionBatch` to the store. `SuggestionsPanel` renders batches newest-first with linear opacity fade. A click on a card calls `injectSuggestionToChat`; the chat wiring completes in `chat-system`.

The slice is **decoupled from transcription and chat** through the Zustand store only (CLAUDE.md §1). It reads `transcript`, `lastFinalizedAt`, and writes `suggestionBatches`, `suggestionsStatus`, and one new field introduced here (see below). It must not import from `TranscriptPanel`, `ChatPanel`, or any of their engines.

All five Open Questions in the spec are answered:

| Question | Decision |
|---|---|
| End-to-end latency budget | Under 5 s |
| Pre-first-batch empty-state wording | Not required (panel stays empty) |
| Cap on `suggestionBatches` history | Keep the last **10** |
| 30 s cadence user-configurable? | Fixed at 30 s |
| Hint after 3 rejected cycles | Yes — render a subtle hint |

Prerequisite slices per master-spec §9 build order: `app-foundation` (store + types + empty `/api/suggestions` stub), `ui-layout` (the `SuggestionsPanel` stub), `real-time-transcription` (so `transcript` and `lastFinalizedAt` actually populate). `deployment` supplies `process.env.GROQ_API_KEY` — this slice is the first one that reads it.

## Working assumptions (flag if wrong)

- **Groq SDK**: `npm install groq-sdk` in this slice (first slice to call Groq). `chat-system` reuses it.
- **Store extension**: cap the `suggestionBatches` to 10 inside `appendSuggestionBatch`, and add one new field `suggestionsHintVisible: boolean` + one new action `setSuggestionsHintVisible(v)` to the store. Both are narrow changes that this slice owns; they slightly extend the contract `app-foundation` defined (plan §4, §5).
- **Engine location**: a single module `src/lib/suggestionsEngine.ts` holds `setInterval`, the `isRunning` flag, the skip counter, the guard chain, the fetch call, and the start/stop lifecycle. It is imported once by `SuggestionsPanel` and driven from a `useEffect`.
- **Guards co-located** with the engine (same file), all pure functions over store state — no React imports.
- **First tick fires immediately** when the engine starts (not after a 30 s wait), so a user who has already been speaking for a while sees their first batch without a cold delay. Subsequent ticks every 30 s.
- **Client fetch timeout**: `AbortController` with `9000 ms` — same ceiling used by `chat-system` under Hobby. Deployment's `vercel.json` caps `/api/suggestions` at `maxDuration: 10`; the client budget stays a beat under the server cap.

## Scope

1. Install `groq-sdk`.
2. Implement the real `/api/suggestions` route handler (replacing the `app-foundation` 200 stub).
3. Implement `src/lib/suggestionsEngine.ts` — guards, parser, trigger, start/stop.
4. Extend `useTwinMindStore`: cap `appendSuggestionBatch`, add `suggestionsHintVisible` + `setSuggestionsHintVisible`.
5. Fill in `SuggestionsPanel.tsx` and add `SuggestionCard.tsx` (the stub comes from `ui-layout`).
6. Tests under `tests/` — four files covering guards, parser, engine lifecycle, panel rendering.

**Out of scope**: the chat side of `injectSuggestionToChat` (the store action exists from `app-foundation`; wiring to a live chat UI is `chat-system`'s job), any change to transcription, any deployment config.

## Implementation Steps

### 1. Dependency

- `npm install groq-sdk`.

### 2. `/api/suggestions/route.ts` (replaces the stub)

```ts
import Groq from 'groq-sdk';
import type { Suggestion, SuggestionsRequest, SuggestionsResponse } from '@/types';
import { parseSuggestionsResponse } from '@/lib/suggestionsEngine';

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
  try { body = await req.json(); } catch { return Response.json({ error: 'BAD_JSON' }, { status: 400 }); }
  if (typeof body?.recentTranscript !== 'string') return Response.json({ error: 'BAD_INPUT' }, { status: 400 });

  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  try {
    const completion = await groq.chat.completions.create({
      model: 'llama3-8b-8192',
      temperature: 0.4,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: body.recentTranscript },
      ],
    });
    const raw = completion.choices[0]?.message?.content ?? '';
    const suggestions = parseSuggestionsResponse(raw);
    if (!suggestions) return Response.json({ error: 'PARSE_FAILURE' }, { status: 422 });
    const payload: SuggestionsResponse = { suggestions };
    return Response.json(payload);
  } catch (err) {
    console.error('[api/suggestions] groq error', err);
    return Response.json({ error: 'UPSTREAM_FAILURE' }, { status: 502 });
  }
}
```

### 3. `src/lib/suggestionsEngine.ts`

Exports:

```ts
// Guards — all pure; take store snapshot args so they are trivially testable.
export function shouldRunSuggestions(transcript: TranscriptChunk[]): boolean;
export function isTranscriptSettled(lastFinalizedAt: number, nowMs: number): boolean;
export function isTranscriptFresh(lastFinalizedAt: number, nowMs: number): boolean;
// Parser — strips ```json fences, trims, validates shape + length 3, assigns ids.
export function parseSuggestionsResponse(raw: string): Suggestion[] | null;
// Lifecycle
export function startSuggestionsEngine(): void;
export function stopSuggestionsEngine(): void;
// Internal (exported only for tests): resetEngineState()
```

Module-scoped state (not React state):

```ts
let isRunning = false;
let intervalHandle: ReturnType<typeof setInterval> | null = null;
let deferTimer: ReturnType<typeof setTimeout> | null = null;
let skippedCycles = 0;
const TICK_MS = 30_000;
const DEFER_MS = 5_000;
const MIN_WORDS = 30;
const SETTLED_MS = 8_000;
const FRESH_MS = 3 * 60_000;
const HINT_AFTER_SKIPS = 3;
const RECENT_CHUNKS = 30;
const CLIENT_FETCH_TIMEOUT_MS = 9_000;
```

`tick()`:

```ts
if (isRunning) return;
const s = useTwinMindStore.getState();
const now = Date.now();

// Stale (>3 min silence): idle panel, no hint update.
if (!isTranscriptFresh(s.lastFinalizedAt, now)) {
  s.setSuggestionsStatus('idle');
  return;
}
// Too-few words: skip and increment hint counter.
if (!shouldRunSuggestions(s.transcript)) {
  onSkip(); return;
}
// Still talking: defer 5s, do NOT count as a skip against the hint.
if (!isTranscriptSettled(s.lastFinalizedAt, now)) {
  if (deferTimer) clearTimeout(deferTimer);
  deferTimer = setTimeout(tick, DEFER_MS);
  return;
}
await runSuggestionsCall();
```

`runSuggestionsCall()`:

```ts
isRunning = true;
useTwinMindStore.getState().setSuggestionsStatus('loading');
const ctrl = new AbortController();
const timeoutId = setTimeout(() => ctrl.abort(), CLIENT_FETCH_TIMEOUT_MS);
try {
  const snapshot = useTwinMindStore.getState().transcript.slice(-RECENT_CHUNKS).map(c => c.text).join('\n');
  const res = await fetch('/api/suggestions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recentTranscript: snapshot }),
    signal: ctrl.signal,
  });
  if (!res.ok) throw new Error(`suggestions ${res.status}`);
  const data = (await res.json()) as SuggestionsResponse;
  const batch: SuggestionBatch = {
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    suggestions: data.suggestions,
    transcriptSnapshot: snapshot,
  };
  useTwinMindStore.getState().appendSuggestionBatch(batch);
  useTwinMindStore.getState().setSuggestionsStatus('idle');
  onSuccess();
} catch (err) {
  console.error('[suggestionsEngine] call failed', err);
  useTwinMindStore.getState().setSuggestionsStatus('error');
} finally {
  clearTimeout(timeoutId);
  isRunning = false;  // master spec §8.5: MUST reset in finally, not then
}
```

`onSkip()` — `skippedCycles++; if (skippedCycles >= HINT_AFTER_SKIPS) setSuggestionsHintVisible(true)`.
`onSuccess()` — `skippedCycles = 0; setSuggestionsHintVisible(false)`.

`startSuggestionsEngine()`:
- If `intervalHandle` already set, no-op.
- Call `tick()` once immediately.
- `intervalHandle = setInterval(tick, TICK_MS)`.

`stopSuggestionsEngine()`:
- Clear `intervalHandle`, `deferTimer`, `isRunning = false`, `skippedCycles = 0`, `setSuggestionsHintVisible(false)`.

`parseSuggestionsResponse(raw)`:
1. `raw.trim()` → strip leading/trailing ```` ```json ```` or ```` ``` ```` via regex.
2. `JSON.parse(...)` in try/catch → return `null` on failure.
3. Check shape: `parsed.suggestions` is an array of length exactly 3, every element has `type ∈ {'question','talking_point','fact_check'}` and `text` a non-empty string.
4. Attach `id: crypto.randomUUID()` to each.
5. Return the array, or `null` if any check fails.

### 4. Store extensions (`src/store/useTwinMindStore.ts`)

- Extend state type with `suggestionsHintVisible: boolean` (initial `false`).
- Add action `setSuggestionsHintVisible: (v: boolean) => void`.
- Modify `appendSuggestionBatch(batch)` to cap at 10:

```ts
appendSuggestionBatch: (batch) => set((s) => ({
  suggestionBatches: [...s.suggestionBatches, batch].slice(-10),
})),
```

All three changes are strict extensions — existing code reading the store remains unaffected.

### 5. Components

**`src/components/SuggestionCard.tsx`** (pure presentational):

```tsx
type Props = { suggestion: Suggestion; onClick: (s: Suggestion) => void };
// Type label colors: question → bg-blue-100 text-blue-800,
//                    talking_point → bg-green-100 text-green-800,
//                    fact_check → bg-amber-100 text-amber-800
// Whole card is a <button>, calls onClick(suggestion).
```

No business logic — just type label + text + onClick.

**`src/components/SuggestionsPanel.tsx`**:

- `useEffect(() => { startSuggestionsEngine(); return stopSuggestionsEngine; }, [])`.
- Subscribe to `suggestionBatches`, `suggestionsStatus`, `suggestionsHintVisible`, `injectSuggestionToChat`.
- Render:
  - If `suggestionsHintVisible` and `suggestionBatches.length === 0`: a small hint "Speak for 30+ seconds to get suggestions".
  - Else: map `suggestionBatches.slice().reverse()` into batch sections. For the i-th rendered batch out of N, opacity = `1 - 0.8 * (i / Math.max(N - 1, 1))`, floored at `0.2`. (N=1 → 1.0; N=10 → 1.0 down to 0.2 linearly.)
  - Inside each batch, render the three suggestions as `SuggestionCard`s. `onClick={injectSuggestionToChat}`.
  - If `suggestionsStatus === 'error'`: a small inline "Couldn't reach the suggestions service — retrying." Auto-clears on next successful tick (status returns to `'idle'`).

### 6. Tests

**`tests/suggestions-guards.test.ts`** — unit-level, no React, no fetch:
- `shouldRunSuggestions`: 29-word transcript → `false`; 30-word → `true`; 31-word → `true`. Count is total words across all `text` fields (space-split).
- `isTranscriptSettled`: `nowMs - lastFinalizedAt < 8_000` → `false`; `>= 8_000` → `true`. `lastFinalizedAt === 0` (never spoken) → `false`.
- `isTranscriptFresh`: `nowMs - lastFinalizedAt <= 180_000` → `true`; `> 180_000` → `false`.

**`tests/suggestions-parse.test.ts`**:
- Clean JSON with 3 valid entries → array length 3, every entry has an id.
- ```` ```json\n{...}\n``` ```` → parses cleanly.
- Prose before JSON (`"Here you go: { ... }"`) → `null` (we do not attempt best-effort extraction).
- `length !== 3` → `null`.
- Invalid `type` value → `null`.
- Empty `text` → `null`.

**`tests/suggestions-engine.test.ts`** — `vi.useFakeTimers()`, `vi.spyOn(global, 'fetch')`:
- Before each: `useTwinMindStore.setState(initialState, true); resetEngineState()`.
- Stale transcript (`lastFinalizedAt = Date.now() - 4 * 60_000`) + `startSuggestionsEngine` → `setSuggestionsStatus('idle')` called, no fetch.
- < 30 words → after 3 ticks (`advanceTimersByTime(90_000)`), `suggestionsHintVisible === true`, no fetch.
- 30+ words, fresh, but unsettled (`lastFinalizedAt = now - 2000`) → no fetch at 30s tick; after 5s defer, fetch fires.
- Happy path → batch appended; `suggestionsStatus` flips `loading → idle`; `skippedCycles` resets to 0; hint clears if it was on.
- Overlapping ticks: stub fetch to return a never-resolving promise; advance 30s twice → `fetch` called exactly once.
- Fetch throws (mock `Promise.reject`) → `suggestionsStatus === 'error'`; `isRunning === false` (prove via internal `resetEngineState`'s behavior or by confirming a subsequent tick can proceed — advance 30s and verify a fresh call).
- `stopSuggestionsEngine()` after a tick → no more ticks fire; `deferTimer` cleared.

**`tests/suggestions-panel.test.tsx`** — RTL:
- Render `<SuggestionCard>` for each of the three types; assert the type label text/class is correct per type. (Three-case snapshot/assert.)
- Render `<SuggestionsPanel>` with 3 batches in the store; reverse order (newest first); opacity decreases monotonically.
- Click a card → `useTwinMindStore.getState().chatMessages` has one new message with `role === 'user'`, `content === suggestion.text`, `triggeredBySuggestion === suggestion.id`. (This exercises `injectSuggestionToChat` end-to-end at the store layer.)
- `suggestionsHintVisible === true` + no batches → hint text visible.

## Critical files to create / modify

- [src/app/api/suggestions/route.ts](../src/app/api/suggestions/route.ts) — replace stub (modify)
- [src/lib/suggestionsEngine.ts](../src/lib/suggestionsEngine.ts) — guards + parser + lifecycle (new)
- [src/store/useTwinMindStore.ts](../src/store/useTwinMindStore.ts) — add `suggestionsHintVisible`, cap batches (modify)
- [src/components/SuggestionsPanel.tsx](../src/components/SuggestionsPanel.tsx) — fill in stub (modify)
- [src/components/SuggestionCard.tsx](../src/components/SuggestionCard.tsx) — new presentational (new)
- [tests/suggestions-guards.test.ts](../tests/suggestions-guards.test.ts) (new)
- [tests/suggestions-parse.test.ts](../tests/suggestions-parse.test.ts) (new)
- [tests/suggestions-engine.test.ts](../tests/suggestions-engine.test.ts) (new)
- [tests/suggestions-panel.test.tsx](../tests/suggestions-panel.test.tsx) (new)
- [package.json](../package.json) — add `groq-sdk` (modify via `npm i`)

## Invariants to preserve

1. **`GROQ_API_KEY` is read only inside `src/app/api/suggestions/route.ts`.** Never import `process.env.GROQ_API_KEY` into `suggestionsEngine.ts`, `SuggestionsPanel.tsx`, or any client module. Deployment's ESLint rule will catch violations.
2. **Guard chain runs at the trigger (engine module), not in the component and not in the store** (CLAUDE.md §5). The engine is the boundary between timer and API call.
3. **`isRunning` resets in `finally`, never in `then`** (master spec §8.5). Errors must never deadlock the engine.
4. **Transcript snapshot is captured at call-start**, not at response-time. Guaranteed by `.slice().map().join()` producing a frozen string before `fetch`.
5. **Guards key off store state (`lastFinalizedAt`, `transcript`)**, never off interim activity (CLAUDE.md §2).
6. **Immutable store updates** — `appendSuggestionBatch` returns a new array via spread + `slice(-10)`; never `.push()`/`.splice()`.
7. **`SuggestionsPanel` is a pure reader** of transcript state; it does not import from `TranscriptPanel` or `ChatPanel`. The only cross-pipeline write is `injectSuggestionToChat`, which is a store action (not a direct component call).
8. **`SuggestionCard` contains no business logic** — it is presentational; click handler is passed in.
9. **Client fetch timeout (`9_000 ms`) stays under the server `maxDuration`** (currently `10` under Hobby — deployment plan §Cross-slice note). If the Vercel plan upgrades to Pro, update both this constant and `ChatPanel.tsx`'s constant together.

## Verification

In order, after implementing:

1. `npx tsc --noEmit` — passes under strict mode.
2. `npm run lint` — clean. The `no-restricted-syntax` rule from deployment rejects any accidental client-side `process.env.GROQ_API_KEY` reference.
3. `npm test` — all four test files green.
4. `npm run dev`. In Chrome/Edge, click Start, speak for at least 30 seconds of varied content (not a single word repeated — the parser needs meaningful words).
5. Open the Network tab; filter `groq`. **Zero** matches client-side.
6. Filter `suggestions`. Within ~30 s of first speaking, a `POST /api/suggestions` request fires and returns 200 with 3 suggestions. Panel shows a new batch at the top.
7. Keep speaking. A second batch appears ~30 s later at the top; the first fades to ~0.6 opacity.
8. Stop speaking for 3 min 30 s. The engine falls idle (`suggestionsStatus === 'idle'`); no more network calls to `/api/suggestions`. Resume speaking — calls resume.
9. Stay silent after starting (speak < 30 words) for 90+ s. After 3 skipped cycles, the hint renders in the panel.
10. Simulate a slow network: DevTools → Network → Throttling "Slow 3G". Trigger two back-to-back ticks (`useTwinMindStore.getState()` + manual re-trigger). Only one `POST /api/suggestions` is in flight at a time — the second is rejected by `isRunning`.
11. Click a suggestion card → inspect `useTwinMindStore.getState().chatMessages` — the last message is `{ role: 'user', content: <suggestion.text>, triggeredBySuggestion: <suggestion.id> }`. Chat UI rendering lands in `chat-system`; the store write is what matters here.
12. Kill the Groq API (temporarily unset `GROQ_API_KEY` in `.env.local`, restart `npm run dev`). Click Start → `suggestionsStatus` goes to `error` in the store; panel shows the retry hint; `isRunning` is `false` so the next tick can proceed.
13. After deploy: `grep -ri "groq" .next/static/` → zero matches (also enforced by the bundle-scan CI workflow from deployment).

## Stop condition

This slice is **done** when (a) `SuggestionsPanel` produces real batches end-to-end from live speech, (b) clicking a card writes a `user` message into `chatMessages` through `injectSuggestionToChat`, and (c) deployment's bundle-scan CI stays green. Do **not** begin `chat-system` inside this slice — master spec §9 build order is sequential.
