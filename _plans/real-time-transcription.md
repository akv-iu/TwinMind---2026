# Plan: Real-Time Transcription

Spec: [_specs/real-time-transcription.md](../_specs/real-time-transcription.md)
Branch (for future commit work): `claude/feature/real-time-transcription`

## Context

The `real-time-transcription` slice is the **data-capture pipeline** of the three-pipeline architecture (master spec §2, §5.1). It owns the browser's `SpeechRecognition` lifecycle end-to-end: start/stop, interim-vs-final separation, error recovery, unsolicited-stop restart, and auto-scroll. It is the **only writer to `transcript[]` and `isRecording`** (master spec §5.1). Suggestions and Chat observe the store downstream; nothing else writes to those fields.

Prerequisites (must land first in master-spec §9 order): `app-foundation` (store + types) and `ui-layout` (the three-column shell, which renders `TranscriptPanel` as an empty stub). This slice fills in that stub.

This slice **does not** call any LLM, does not import from `SuggestionsPanel` or `ChatPanel`, and does not run the guards that live in the suggestions pipeline (`shouldRunSuggestions`, `isTranscriptSettled`, `isTranscriptFresh`). It faithfully updates `lastFinalizedAt` — downstream uses it.

All four Open Questions in the spec are answered:

| Question | Decision |
|---|---|
| Language selector vs hard-code | Hard-code `lang: 'en-US'` |
| Manual Stop while interim pending | Finalize + append the pending interim text before stopping |
| Session persistence on refresh | No persistence — transcript is in-memory only |
| Mic level / VAD affordance on Start/Stop | No — text/icon button only |

## Working assumptions (flag if wrong)

- **Component file**: `src/components/TranscriptPanel.tsx`. `ui-layout` will create the stub; this slice replaces its body.
- **Speech glue lives inline in the component** via `useRef<SpeechRecognition | null>` — no `useSpeechRecognition` custom hook. The lifecycle is used in exactly one place and abstracting it adds indirection without reuse.
- **Permission-denied error state is local to `TranscriptPanel`** (`useState<string | null>`), not in the Zustand store. The error is a UI concern for this panel and nothing else reads it.
- **Testing env**: Vitest + jsdom + `@testing-library/react`. `app-foundation` installs Vitest but not jsdom or Testing Library; this slice adds them.
- **TypeScript ambient types for `SpeechRecognition`** live in `src/types/speech.d.ts` (project-local `.d.ts` augmenting `window`). The DOM types don't currently ship `SpeechRecognition`.

## Scope

1. Add a project-local ambient declaration for `SpeechRecognition` / `webkitSpeechRecognition` so TS compiles under strict mode.
2. Implement `TranscriptPanel.tsx`: feature detection, Start/Stop button, interim-local/final-to-store split, `onresult`/`onerror`/`onend` handlers, auto-scroll anchor, incompatibility notice, permission-denied persistent error.
3. Install jsdom + `@testing-library/react` + `@testing-library/jest-dom`; configure Vitest to run in `jsdom` environment.
4. Tests under `tests/transcription.test.tsx` — covers the six cases in the spec's Testing Guidelines.

**Out of scope**: LLM calls, suggestion/chat wiring, store schema changes (all fields and actions already exist from `app-foundation`), the 3-column layout frame (owned by `ui-layout`), any server-side work.

## Implementation Steps

### 1. Ambient types

Create `src/types/speech.d.ts`:

```ts
interface SpeechRecognitionAlternative { transcript: string; confidence: number; }
interface SpeechRecognitionResult { readonly length: number; isFinal: boolean; item(i: number): SpeechRecognitionAlternative; [i: number]: SpeechRecognitionAlternative; }
interface SpeechRecognitionResultList { readonly length: number; item(i: number): SpeechRecognitionResult; [i: number]: SpeechRecognitionResult; }
interface SpeechRecognitionEvent extends Event { readonly resultIndex: number; readonly results: SpeechRecognitionResultList; }
interface SpeechRecognitionErrorEvent extends Event { readonly error: 'not-allowed' | 'network' | 'no-speech' | 'audio-capture' | 'aborted' | 'service-not-allowed' | string; readonly message: string; }
interface SpeechRecognition extends EventTarget {
  continuous: boolean; interimResults: boolean; lang: string;
  start(): void; stop(): void; abort(): void;
  onresult: ((this: SpeechRecognition, ev: SpeechRecognitionEvent) => void) | null;
  onerror: ((this: SpeechRecognition, ev: SpeechRecognitionErrorEvent) => void) | null;
  onend: ((this: SpeechRecognition, ev: Event) => void) | null;
}
interface SpeechRecognitionStatic { new (): SpeechRecognition; }
interface Window { SpeechRecognition?: SpeechRecognitionStatic; webkitSpeechRecognition?: SpeechRecognitionStatic; }
```

Include via `tsconfig.json` — `create-next-app@14`'s default `include` (`"**/*.ts", "**/*.tsx"`) covers `src/types/` already. No config change needed.

### 2. `TranscriptPanel.tsx`

State:
- Local: `interimText: string`, `permissionError: string | null`, `unsupported: boolean`.
- From store (via individual selectors, not object): `transcript`, `isRecording`, `appendTranscriptChunk`, `setIsRecording`.
- Refs: `recognitionRef: useRef<SpeechRecognition | null>(null)`, `endRef: useRef<HTMLDivElement | null>(null)`, `restartTimerRef: useRef<ReturnType<typeof setTimeout> | null>(null)`.

Feature detection (in `useEffect` on mount, once):
```ts
const Ctor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
if (!Ctor) { setUnsupported(true); return; }
```

Start handler:
1. If `unsupported` or `permissionError === 'not-allowed'`, do nothing.
2. Construct `new Ctor()`, assign to `recognitionRef.current`.
3. Set `continuous = true; interimResults = true; lang = 'en-US'`.
4. Attach `onresult`, `onerror`, `onend` (below).
5. `useTwinMindStore.getState().setIsRecording(true)` — **before** `.start()` so the `onend` guard sees true.
6. `recognitionRef.current.start()`.

Stop handler (spec Open Question: **finalize pending interim before stopping**):
1. Snapshot `interimText`. If non-empty and trimmed non-empty, call `appendTranscriptChunk(interim.trim())`.
2. Clear local interim: `setInterimText('')`.
3. `useTwinMindStore.getState().setIsRecording(false)` — **before** `.stop()` so `onend` does not auto-restart.
4. Clear `restartTimerRef.current` if set.
5. `recognitionRef.current?.stop()`.

`onresult` (handler):
```ts
let interim = '';
for (let i = event.resultIndex; i < event.results.length; i++) {
  const r = event.results[i];
  if (r.isFinal) {
    const text = r[0].transcript.trim();
    if (text) useTwinMindStore.getState().appendTranscriptChunk(text);
  } else {
    interim += r[0].transcript;
  }
}
setInterimText(interim);
```
Always read the action from `useTwinMindStore.getState()` inside the handler — avoids stale closures and matches the pattern chat-system uses for `sendChatRequest`.

`onerror` (master spec §8.9):
```ts
if (event.error === 'not-allowed') {
  setPermissionError('Microphone access denied. Enable mic access in the browser and reload.');
  useTwinMindStore.getState().setIsRecording(false);
  return;
}
const RECOVERABLE = new Set(['network', 'no-speech', 'audio-capture']);
if (RECOVERABLE.has(event.error)) {
  if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
  restartTimerRef.current = setTimeout(() => {
    if (useTwinMindStore.getState().isRecording) recognitionRef.current?.start();
  }, 1000);
}
// other errors: ignore; onend will either restart or not based on isRecording
```

`onend`:
```ts
if (useTwinMindStore.getState().isRecording) recognitionRef.current?.start();
```

Unmount cleanup (`useEffect` return):
- Clear `restartTimerRef`.
- Detach handlers (set to `null`) to prevent post-unmount fires.
- Call `.abort()` on the instance.
- `setIsRecording(false)` — defensive; leaving it `true` after unmount breaks `ui-layout`'s button state.

Auto-scroll:
```ts
useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [transcript.length]);
```
Anchor the `<div ref={endRef} />` inside the transcript-list container so `scrollIntoView` scrolls only the panel's own scroll container (verify `overflow-y-auto` is set on that container by `ui-layout`).

Rendering:
- If `unsupported`: render a notice ("This browser does not support live speech recognition. Use Chrome or Edge."). No Start button.
- Else: Start/Stop toggle button (single button, label flips on `isRecording`); render `transcript.map(...)` as final list; below it, if `interimText` non-empty, render in muted (Tailwind `text-gray-400 italic`); at the bottom, the scroll anchor `<div ref={endRef} />`.
- If `permissionError`: render the persistent error string above the button, not as a toast.

### 3. Test harness deps

- `npm install -D jsdom @testing-library/react @testing-library/jest-dom`.
- `vitest.config.ts` — add `test.environment: 'jsdom'` and `test.setupFiles: ['./tests/setup.ts']`.
- `tests/setup.ts` — `import '@testing-library/jest-dom/vitest'`.

### 4. `tests/transcription.test.tsx`

Helper: a `MockSpeechRecognition` class with `start`/`stop`/`abort` as `vi.fn()`, plus a way to fire `result`/`error`/`end` events synchronously (set `onresult`, then call it with a fake `SpeechRecognitionEvent`).

Before each: `window.SpeechRecognition = MockSpeechRecognition as any`; reset the Zustand store to its initial state (`useTwinMindStore.setState(initialState, true)`).

Cases:
1. **Interim never reaches store.** Click Start → fire event with `isFinal: false, transcript: 'hello'` → `useTwinMindStore.getState().transcript.length === 0`; the interim text is visible in the rendered DOM.
2. **Final appended once, trimmed.** Fire event with `isFinal: true, transcript: '  hello world  '` → `transcript.length === 1`; `transcript[0].text === 'hello world'`; `lastFinalizedAt > 0`.
3. **Stop finalizes pending interim.** Start → fire interim `'foo'` → click Stop → `transcript[0].text === 'foo'`; `isRecording === false`; `mock.stop` was called once.
4. **`not-allowed` error.** Start → fire error `{ error: 'not-allowed' }` → rendered DOM contains `Microphone access denied`; `isRecording === false`; no restart timer fires (advance timers by 2000ms — `mock.start` call count still 1).
5. **`network` error restarts after 1s.** Start → fire error `{ error: 'network' }` → advance timers 999ms → `mock.start` still 1 → advance 1ms → `mock.start` called a 2nd time. Guard: repeat with `isRecording` already false (simulate Stop before timer fires) → `mock.start` stays at 1.
6. **`onend` auto-restart.** With `isRecording === true`, fire `end` → `mock.start` called again. With `isRecording === false`, fire `end` → no extra `start`.
7. **Feature detection.** `delete window.SpeechRecognition; delete window.webkitSpeechRecognition` → render → incompatibility notice shown; no Start button.
8. **Auto-scroll.** Spy `Element.prototype.scrollIntoView`. Append a final chunk. Assert spy called.

Use `vi.useFakeTimers()` for cases 4 and 5.

## Critical files to create / modify

- [src/types/speech.d.ts](../src/types/speech.d.ts) — ambient `SpeechRecognition` types (new)
- [src/components/TranscriptPanel.tsx](../src/components/TranscriptPanel.tsx) — fill in (stub created by `ui-layout`)
- [vitest.config.ts](../vitest.config.ts) — add `jsdom` env + setup file (modify)
- [tests/setup.ts](../tests/setup.ts) — `@testing-library/jest-dom` matchers (new)
- [tests/transcription.test.tsx](../tests/transcription.test.tsx) — eight cases (new)
- [package.json](../package.json) — add `jsdom`, `@testing-library/react`, `@testing-library/jest-dom` (modify via `npm i -D`)

## Invariants to preserve

1. **Interim text never enters the store.** Only `isFinal` results call `appendTranscriptChunk`. Master spec §8.10 + CLAUDE.md §2.
2. **`TranscriptPanel` is the only writer to `transcript[]` and `isRecording`.** CLAUDE.md §1.
3. **No imports from `SuggestionsPanel`, `ChatPanel`, or any `suggestionsEngine`/`chatEngine` module.** Pipelines decoupled through store only.
4. **No LLM calls and no `process.env.GROQ_API_KEY` reference.** Data-capture only.
5. **`setIsRecording(false)` fires before `.stop()`** on manual Stop so `onend` does not auto-restart.
6. **Pending interim is finalized on Stop**, not discarded (spec Open Question §44).
7. **Handlers read store via `useTwinMindStore.getState()`**, not subscribed values — avoids stale-closure bugs in long-lived recognition callbacks. Matches chat-system's `sendChatRequest` pattern.
8. **Tailwind utilities only** — no `.css` files, no `style=` with literal colors for interim styling.
9. **`lastFinalizedAt` is always `Date.now()` at append time** (already enforced by `appendTranscriptChunk` — confirm no accidental overwrite here). Downstream suggestions read it.

## Verification

In order, after implementing:

1. `npx tsc --noEmit` — passes. Confirms the ambient `SpeechRecognition` types compile.
2. `npm run lint` — clean.
3. `npm test` — all eight cases green.
4. `npm run dev`, open the app in **Chrome or Edge** (not Firefox — Firefox does not support `SpeechRecognition`).
5. Click **Start**, grant mic permission, speak a short sentence. Observe: muted interim text updates live, then resolves into a black final line; interim area clears. Repeat with a second sentence — both visible, auto-scrolled to bottom.
6. Open React DevTools / `useTwinMindStore` inspector: confirm `transcript.length` increments only when a chunk finalizes; `isRecording === true` during speech; `lastFinalizedAt` updates on each finalize.
7. Click **Stop** mid-sentence (while interim text is visible). The interim text is appended as a final chunk (not lost). `isRecording === false`. Speaking more does not produce new chunks.
8. Open again in Firefox (or disable `window.SpeechRecognition` via DevTools) — incompatibility notice renders; no Start button; no crash.
9. Deny microphone permission when the browser prompts. `onerror` fires; the persistent "Microphone access denied" error shows; `isRecording` flips to false; no restart loop in the console.
10. Simulate network dropout: in DevTools → Network → Offline briefly. Speech recognition's `onerror` fires with `network`; after ~1s it resumes when connectivity returns. No tight-loop logs.
11. While recording, switch to another tab for ~30s. On return, recognition should still be active (onend auto-restart keeps it alive).
12. Spec smoke: type `document.querySelectorAll('main > div')` in devtools — scroll behavior is isolated to the transcript panel; suggestions and chat panels do not scroll.

## Stop condition

This slice is **done** when `suggestion-generation` can subscribe to `transcript` and `lastFinalizedAt` and observe them updating live during real speech. Do **not** begin `suggestion-generation` inside this slice — master spec §9 build order is sequential.
