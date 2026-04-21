# Spec for Chat System

branch: claude/feature/chat-system
figma_component (if used): N/A — no Figma reference

## Summary

On-demand deep-reasoning chat surface. Triggered two ways: the user types into the chat input, or the user clicks a `SuggestionCard` (which appends a `user` message via `store.injectSuggestionToChat`). The client sends the recent transcript window plus bounded chat history to `/api/chat`; the server trims the history to the token budget and calls the larger Groq model (`llama3-70b-8192`) with `stream: true`. Tokens flow back as a `text/event-stream`; the client reads the `ReadableStream`, decodes chunks, and updates the in-store streaming message progressively. The panel renders a blinking-cursor indicator during streaming and auto-scrolls to the newest tokens.

## Functional Requirements

- `/api/chat` route handler: accepts `{ messages, recentTranscript }`, prepends the `CHAT_SYSTEM_PROMPT` with the transcript context, applies `trimHistoryToTokenBudget` before forwarding to Groq, returns a streamed `ReadableStream` with `Content-Type: text/event-stream`.
- `trimHistoryToTokenBudget` runs server-side, budget ~10,000 tokens, estimated as `Math.ceil(totalChars / 4)`. Drops oldest `user+assistant` pairs (never orphans a role), never drops the system prompt, never drops the latest user message.
- Client `ChatPanel` owns: message list rendering, text input + Send button, streaming reader loop, auto-scroll.
- Streaming reader loop: `ReadableStream` + `TextDecoder`, `updateStreamingMessage(id, delta)` on each chunk, `finalizeStreamingMessage(id)` when the reader reports `done`.
- Blinking cursor (or equivalent indicator) rendered while `msg.isStreaming === true`.
- `injectSuggestionToChat` (from the suggestions slice) appends a `user` message; `ChatPanel` observes the store and fires an outbound call for any unresolved latest user message.
- Error recovery: the reader loop is wrapped in `try/catch`. On any failure, the streaming message is **always** finalized with an appended marker like `"\n\n[Response interrupted — please retry]"` — `isStreaming: true` must never persist on a dropped connection.
- Recent transcript window sent to the chat API = last 30 finalized chunks joined with `\n` (same bound as suggestions).
- Auto-scroll to the newest content as tokens stream in.

## Possible Edge Cases

- **Token overflow on long sessions.** A 45-minute session can reach 80+ message pairs. Without trimming, Groq returns a 400 or silently truncates. `trimHistoryToTokenBudget` runs on every request — no exceptions, no feature-flagged bypass.
- **Stream drops mid-response.** Network hiccup at token 60 of 400. Reader throws. Catch block finalizes the message and appends the interrupted-note — the indicator never hangs forever.
- **Suggestion clicked while a reply is streaming.** A new `user` message lands in the store before the previous assistant message finalizes. Behavior must be defined (see Open Questions): queue, cancel the in-flight stream, or block until finalize.
- **User sends empty input.** No API call fires.
- **Server returns non-200.** Inline error state on the panel, leave prior messages intact, offer retry (manual or automatic — see Open Questions).
- **Streaming but the `readable.close()` never fires.** Guard with a reasonable overall timeout so a hung stream doesn't leave `isStreaming: true` indefinitely.
- **Race with transcript append.** Recent-transcript slice is taken fresh from the store snapshot at request time — no stale closure in the component.
- **Very long single assistant message.** `updateStreamingMessage` appends deltas; the content can grow to many KB. No server-side cap — the model decides when to stop.
- **System prompt gets accidentally dropped by the trimmer.** Invariant: trim pairs, preserve the first system message, preserve the last user message. Dropping any of these is a bug.
- **Suggestion-triggered message ordering.** `triggeredBySuggestion` is set to the suggestion's id so later UI or analytics can distinguish typed vs injected user messages.

## Acceptance Criteria

- Typing a message and hitting Send produces a streamed assistant reply rendered token-by-token, not in a single batch drop.
- Clicking a `SuggestionCard` produces the same streaming flow, with the suggestion's text visible as a `user` message.
- A simulated 80-pair session does **not** produce a Groq context-length error — the trimmer keeps the request within budget.
- A simulated mid-stream disconnect finalizes the message and appends the interrupted marker — the blinking cursor disappears.
- `GROQ_API_KEY` is never visible in the browser (verified in the DevTools Network tab — no `api.groq.com` requests from the client).
- Auto-scroll keeps the newest tokens in view without fighting a user who has manually scrolled up (see Open Questions for the exact policy).
- Panel shows an inline error and does not lose prior messages when the server returns non-200.

## Open Questions

- **In-flight conflict policy.** If a new user message arrives while one is streaming: queue it, cancel the in-flight stream, or block input until finalize? Pick one. - Block input until the current stream finalizes — no queue, no cancel.
- **Retry behavior** on error — manual retry button, automatic retry with backoff, or neither? - No automatic retry — show a manual retry button on error.
- **Streaming indicator design** — blinking cursor, skeleton, or subtle progress bar? - blinking cursor
- **Auto-scroll policy when the user has scrolled up manually** — keep following the bottom, or pause auto-scroll until they return? - Pause auto-scroll when the user scrolls up manually, resume when they scroll back to the bottom
- **Timestamp display** — on every message, on hover, or not shown? - No
- **Explicit overall timeout** on the reader loop, and what value? (30s? 60s? aligned with Vercel function limit?) - 30s
- **Non-200 UX** — surface the error in the chat stream (as a system-style message) or in a separate toast? -Surface non-200 errors as a system-style message inline in the chat — not a toast.

## Testing Guidelines

Create a test file(s) in the ./tests folder for the new feature, and create meaningful tests for the following cases, without going too heavy:

- `trimHistoryToTokenBudget`: drops oldest pairs until under budget, never orphans a role, preserves system prompt and the latest user message, stops exactly at or under the budget.
- Simulated dropped stream: after `reader.read()` throws, the streaming message is finalized with `isStreaming: false` and the interrupted marker.
- End-to-end: clicking a suggestion card leads to a `user` message with `triggeredBySuggestion` set, then an outbound request is fired.
- Recent transcript in the request body is capped at 30 chunks even when the store has hundreds.
- Send button is disabled on empty input.
- Non-200 response leaves prior messages intact and surfaces an inline error.
