# Spec for App Foundation

branch: claude/feature/app-foundation
figma_component (if used): N/A — no Figma reference

## Summary

Scaffold the Next.js application with TypeScript (strict), Tailwind CSS (utility-only), and a Zustand store, plus the shared TypeScript data contracts that every other slice consumes. Create empty `/api/suggestions` and `/api/chat` route stubs that respond 200 so later slices can wire onto them incrementally. This slice is the substrate — no user-visible functionality yet, but nothing else ships without it.

## Functional Requirements

- Next.js project with TypeScript strict mode enabled and Tailwind CSS configured.
- No Redux, no Context API for shared state — Zustand only.
- A `types.ts` containing the canonical data contracts: `TranscriptChunk`, `SuggestionType`, `Suggestion`, `SuggestionBatch`, `MessageRole`, `ChatMessage`, plus `SuggestionsRequest`/`SuggestionsResponse` and `ChatRequest`.
- A Zustand store (`useTwinMindStore`) with the full field set (`transcript`, `isRecording`, `lastFinalizedAt`, `suggestionBatches`, `suggestionsStatus`, `chatMessages`, `chatStatus`) and every action signature (`appendTranscriptChunk`, `setIsRecording`, `appendSuggestionBatch`, `setSuggestionsStatus`, `appendChatMessage`, `updateStreamingMessage`, `finalizeStreamingMessage`, `injectSuggestionToChat`).
- All store array updates use spread syntax — never `.push()`, `.splice()`, or other mutating methods.
- Empty `/api/suggestions` and `/api/chat` route handlers that return HTTP 200.
- `uuid` library (or `crypto.randomUUID()` — see Open Questions) available for id generation.

## Possible Edge Cases

- A future action mutates a store array in place. Zustand relies on reference equality for change detection, so a mutation leaves subscribers reading stale state silently. Immutable updates are a hard invariant, enforced by convention in this slice and checked by unit tests.
- `updateStreamingMessage` must produce a new `chatMessages` array **and** a new message object per delta, otherwise the component subscribed to the streaming message will not re-render.
- `injectSuggestionToChat` must not call into `ChatPanel` directly — it appends to the store, and `ChatPanel` observes. Direct function calls across pipelines create a coupling that breaks the decoupled-pipelines invariant.
- The API stubs must not import any server-side secrets yet — do not even reference `process.env.GROQ_API_KEY` until the downstream slices need it.

## Acceptance Criteria

- `npm run dev` serves the scaffold at localhost and renders a blank page without TypeScript errors.
- `POST /api/suggestions` and `POST /api/chat` both return HTTP 200.
- A smoke test confirms `appendTranscriptChunk` produces a **new** array reference (old `!==` new).
- The store exposes every listed action, all typed against the shared `types.ts`.
- `tsc --noEmit` passes under strict mode.
- Tailwind utility classes render correctly on a sample element; no custom CSS files are introduced.

## Open Questions

- Pin a Next.js major version (13 App Router vs 14+) and corresponding Node version. -Next.js 14 App Router, Node 20 LTS
- Is `crypto.randomUUID()` acceptable in place of the `uuid` npm package? (Browser support is fine for modern Chrome/Edge, which is our target.) - Use crypto.randomUUID() — no npm package needed.
- Should the store live at `src/store/useTwinMindStore.ts` or colocated under `src/state/`? (Pick a convention now — later slices will import heavily.) - Store lives at src/store/useTwinMindStore.ts
- Is there a preferred linter/formatter setup (ESLint + Prettier) to lock in at scaffold time? - ESLint + Prettier, lock both in at scaffold time with a .eslintrc and .prettierrc committed to the repo.

## Testing Guidelines

Create a test file(s) in the ./tests folder for the new feature, and create meaningful tests for the following cases, without going too heavy:

- Every store action that mutates an array produces a new array reference.
- `updateStreamingMessage` produces a new message object (not just a new array).
- `injectSuggestionToChat` appends a `user` role message whose `content` equals the suggestion text and whose `triggeredBySuggestion` equals the suggestion id.
- Both empty API routes respond 200 to a minimal POST.
- `types.ts` type-checks under strict mode with the exact shapes from the master spec §4.
