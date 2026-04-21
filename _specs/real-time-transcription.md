# Spec for Real-Time Transcription

branch: claude/feature/real-time-transcription
figma_component (if used): N/A — no Figma reference

## Summary

Capture live microphone input via the browser-native Web Speech API (`SpeechRecognition`), surface unstable interim tokens in a muted style, and append stable finalized chunks to the Zustand `transcript[]`. Auto-scroll the panel to the newest chunk. Detect browser incompatibility gracefully and recover automatically from transient recognition errors. This is a pure data-capture pipeline — it never calls any LLM and never imports from the suggestions or chat engines.

## Functional Requirements

- A visible Start / Stop recording control on `TranscriptPanel` that toggles `store.isRecording`.
- `SpeechRecognition` configured with `continuous: true`, `interimResults: true`, `lang: 'en-US'`.
- Interim results rendered in muted style, held exclusively in React local state (`useState`) — **never** written to the Zustand store.
- Finalized results appended to the store via `appendTranscriptChunk`, which also updates `lastFinalizedAt`.
- Panel auto-scrolls to the bottom on every new final chunk (managed via `useRef` + `scrollIntoView`).
- On app entry, feature-detect `window.SpeechRecognition || window.webkitSpeechRecognition` and render a clear incompatibility notice when absent — do not crash.
- `onerror` handler: route `not-allowed` to a persistent "Microphone access denied" state (stop recording); treat `network`, `no-speech`, `audio-capture` as recoverable and restart after ~1s.
- `onend` handler: if `store.isRecording` is still true, restart recognition (handles unsolicited stops from the browser).

## Possible Edge Cases

- **Interim/final contamination.** Writing interim tokens to the store causes the same words to appear multiple times and triggers a re-render on every token (5–10 Hz). Interim lives in local state; store only receives finalized text. Hard invariant.
- **Recognition stops unsolicited.** Browser tabs losing focus, long silences, or network blips can end recognition. `onend` must auto-restart while `isRecording` is true.
- **Permission denied mid-session.** User revokes mic permission from the browser chrome. `onerror` fires with `not-allowed` — stop recording, show actionable error, do not auto-retry in a tight loop.
- **Non-Chromium browsers.** Firefox and Safari (on some platforms) lack `SpeechRecognition` entirely. Check at entry, render a clear notice, do not attempt to construct the object.
- **Silence during interim pause.** The Web Speech API will finalize a chunk after ~4s of silence even mid-sentence. Downstream pipelines (suggestions) debounce on `lastFinalizedAt` — this slice simply updates it faithfully.
- **Rapid restart loop.** A `network` error that immediately recurs could cause a tight restart loop. Include a short delay (~1s) and log so the user sees the pattern.
- **Manual Stop while interim text is pending.** Decide: finalize the pending interim text or discard it (see Open Questions).

## Acceptance Criteria

- Spoken words appear first in muted interim style, then solidify into the finalized list when the Speech API marks them final.
- The store's `transcript[]` contains only finalized text, each entry with `id`, `text`, `timestamp`.
- `lastFinalizedAt` updates on every appended chunk.
- In a non-supporting browser (e.g. Firefox), the app renders the incompatibility notice instead of crashing.
- Denied microphone permission produces a clear, persistent error — not a silent failure.
- A simulated transient `network` error recovers automatically without user action.
- Panel auto-scrolls to the newest chunk without dragging other panels along.

## Open Questions

- Hard-code `lang: 'en-US'` or expose a language selector later? - hard Code
- On manual Stop, finalize the pending interim text or discard it? - Finalize and append pending text
- Is there any session persistence requirement (refresh the page → lose transcript, or preserve?)? Master spec is silent; default to no persistence. - No persistence
- Should the Start/Stop control also surface current mic level / VAD activity as a user affordance? No

## Testing Guidelines

Create a test file(s) in the ./tests folder for the new feature, and create meaningful tests for the following cases, without going too heavy:

- Interim tokens never reach the store (subscribe to `transcript[]`, speak a fake interim result, assert length unchanged).
- `appendTranscriptChunk` is invoked exactly once per final chunk with the trimmed text.
- `onerror` branches: `not-allowed` stops recording and surfaces the permission-denied state; `network` triggers a delayed restart.
- `onend` restarts recognition iff `isRecording === true`.
- Feature-detection path renders the incompatibility notice when `SpeechRecognition` is undefined.
- Auto-scroll: after appending a final chunk, the scroll anchor's `scrollIntoView` is called.
