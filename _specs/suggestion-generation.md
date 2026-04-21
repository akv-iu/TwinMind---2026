# Spec for Suggestion Generation

branch: claude/feature/suggestion-generation
figma_component (if used): N/A — no Figma reference

## Summary

Every ~30 seconds, read the most recent window of finalized transcript and ask the fast Groq model (`llama3-8b-8192`) for three structured suggestions: one question the speaker could ask next, one talking point worth raising, and one fact to verify. Render the results in `SuggestionsPanel` as a newest-first history of batches, with older batches visually faded. Every card is clickable and injects its text as a user message into the chat (implemented end-to-end once `chat-system` ships). The LLM is called through a server-side Next.js API route — the Groq key never touches the client bundle.

## Functional Requirements

- `/api/suggestions` route handler: accepts `{ recentTranscript: string }`, calls Groq with a strict JSON-only system prompt, strips markdown fences from the response, validates the exact shape (`suggestions: Suggestion[]` length 3), returns `SuggestionsResponse`.
- Client trigger runs at a fixed ~30s cadence via `setInterval` in module scope (not component state).
- Guard chain (in this exact order) runs before every API call:
  1. `shouldRunSuggestions` — at least 30 words in the transcript.
  2. `isTranscriptSettled` — at least 8 seconds since the last finalized chunk.
  3. `isTranscriptFresh` — last finalized chunk no more than 3 minutes ago.
  4. `isRunning` flag — no call currently in flight.
- `isRunning` is a module-level boolean reset in the `finally` block of the async call, so errors never deadlock the engine.
- Recent transcript window sent to the API = last 30 finalized chunks joined with `\n`.
- On success, append a new `SuggestionBatch` to `store.suggestionBatches` with `createdAt`, the 3 suggestions, and the transcript snapshot used.
- `SuggestionsPanel` renders batches newest-first with opacity fading linearly from 1.0 (newest) to a 0.2 floor (oldest).
- `SuggestionCard` shows a colored type label (Question to ask = blue, Talking point = green, Fact check = amber) and is visually clickable.
- Click on a card invokes `store.injectSuggestionToChat(suggestion)` — the card itself contains no business logic.

## Possible Edge Cases

- **< 30 words of transcript.** Timer fires but the user has barely spoken. Skip the call; log the skip reason. Prevents garbage "Tell me more about what you're discussing" suggestions.
- **Active speech mid-sentence.** User is still talking; last finalized chunk was <8s ago. Defer: retry in 5s instead of waiting a full 30s cycle.
- **Stale transcript (> 3 min silence).** User went silent long ago. Suppress the call and flip `suggestionsStatus` to `'idle'` so the panel shows a passive "Listening..." state.
- **Overlapping in-flight calls.** Previous call is slow (Groq under load). Timer fires again. `isRunning` guard rejects the second call — prevents a late response from overwriting a fresh one.
- **Malformed JSON.** Model returns text with prose before the JSON, or wraps it in ```json fences. Strip fences, parse in try/catch, return a structured `PARSE_FAILURE` error — not a 500.
- **Wrong-shape JSON.** Model returns 2 or 4 suggestions, or an object instead of an array. Reject as invalid shape.
- **Network/API failure.** Route responds non-200 or client fetch throws. Flip `suggestionsStatus` to `'error'`; `isRunning` still resets via `finally`.
- **Race with transcript append.** Transcript grows while the API call is in flight. The call used a snapshot taken at call-start — that is correct behavior. INVARIANT 6.2 (immutable updates) guarantees the snapshot is frozen; no locking needed.
- **Unbounded batch history.** Over a long session `suggestionBatches` grows indefinitely — see Open Questions for cap.
- **Rapid interim bursts.** Guards must key off `lastFinalizedAt` (store state), not any interim activity signal, since interim tokens never update the store.

## Acceptance Criteria

- With fewer than 30 words of transcript, no calls to `/api/suggestions` are made.
- While the user is actively speaking (no 8s gap), timer firings are deferred and retried shortly.
- After 3 minutes of silence, calls stop and the panel shows the idle state; they resume once speaking resumes.
- Two timer ticks can never produce two overlapping in-flight API calls.
- Model output wrapped in markdown fences or containing trailing whitespace still parses cleanly.
- Malformed model output never crashes the route — the client receives a structured error.
- On success, a new batch appears at the top of the panel; older batches fade progressively down to ~20% opacity.
- `GROQ_API_KEY` never appears in the client bundle or the browser's Network tab.
- Clicking a card produces a user message in the chat store (wired fully in `chat-system`).

## Open Questions

- Target end-to-end suggestion latency budget (e.g. < 5s)? under 5s
- Pre-first-batch empty state wording — "Listening…", "Generating suggestions…", or something else? Not required.
- Cap `suggestionBatches` to the most recent N (e.g. 10) to bound memory, or let it grow for the session? 10 most recent
- Should the 30s cadence be user-configurable, or fixed? Fixed
- If the guard chain rejects for 3 consecutive cycles, should the panel surface a subtle hint (e.g. "speak for 30+ seconds to get suggestions")? Yes add hint

## Testing Guidelines

Create a test file(s) in the ./tests folder for the new feature, and create meaningful tests for the following cases, without going too heavy:

- Each guard in isolation: `shouldRunSuggestions` (below/above threshold), `isTranscriptSettled` (just spoke vs silent), `isTranscriptFresh` (fresh vs stale).
- `parseSuggestionsResponse`: clean JSON, markdown-fenced JSON, wrong-length array, non-JSON text.
- `isRunning` guard: a second invocation during an in-flight first call is a no-op.
- `isRunning` resets on thrown exceptions (mock a network failure, assert flag is false afterward).
- Snapshot rendering of `SuggestionCard` for all three `SuggestionType` values.
- Fade opacity is monotonically non-increasing from newest to oldest batch.
- Clicking a card dispatches `injectSuggestionToChat` with the correct payload.
