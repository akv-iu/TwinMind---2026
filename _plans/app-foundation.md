# Plan: App Foundation

Spec: [_specs/app-foundation.md](../_specs/app-foundation.md)
Branch (for future commit work): `claude/feature/app-foundation`

## Context

The repo is currently pre-implementation — it contains only planning documents (`TwinMind_Master_Spec.docx`, `Understanding document.docx`, `Requirement- twin mind.pdf`), the feature specs in [_specs/](../_specs/), and `CLAUDE.md`. There is no `package.json`, no source code, no tests.

`app-foundation` is the substrate slice: it ships no user-visible functionality, but every downstream slice (`ui-layout`, `real-time-transcription`, `suggestion-generation`, `chat-system`, `deployment`) depends on the scaffold, the canonical TypeScript contracts in `types.ts`, and the Zustand store created here. This plan maps to **Steps 1–3** of the master spec build order (§9) — project setup, interfaces, store.

All four Open Questions in the spec have been answered, so no design ambiguity remains:

| Question | Decision |
|---|---|
| Next.js version + Node | Next.js **14** (App Router) on **Node 20 LTS** |
| UUID generation | `crypto.randomUUID()` — no `uuid` npm dependency (overrides master spec §9 wording) |
| Store location | `src/store/useTwinMindStore.ts` |
| Lint/format | ESLint + Prettier, both committed to the repo (`.eslintrc.json` + `.prettierrc`) |

## Working assumptions (flag if wrong)

- **Package manager: npm** (default; no preference stated in the specs).
- **Test runner: Vitest** (faster, zero-config for pure TS; store + API-handler tests here don't need a browser or Next server).

## Scope

1. Scaffold Next.js 14 (App Router) + TypeScript strict + Tailwind + ESLint in the repo root.
2. Install Zustand and Prettier; wire Prettier into ESLint.
3. Create `src/types.ts` with every interface from master spec §4 verbatim.
4. Create `src/store/useTwinMindStore.ts` implementing the full store shape (§6.1) with every action — immutable updates only (§6.2), `updateStreamingMessage` produces new message objects (§6.3), `injectSuggestionToChat` appends a `user` message (§6.4).
5. Create empty `/api/suggestions` and `/api/chat` route handlers that return HTTP 200 — no Groq import, no env-var reference.
6. Add `tests/` with store + route-stub tests.

**Out of scope**: 3-column layout (→ `ui-layout`), `SpeechRecognition` (→ `real-time-transcription`), any Groq call (→ `suggestion-generation`, `chat-system`), any env-var usage (→ `deployment`).

## Implementation Steps

### 1. Scaffold
- Run `npx create-next-app@14 . --typescript --tailwind --app --eslint --src-dir --import-alias "@/*"` at the repo root.
  - Caveat: the directory is non-empty (`.git`, `_specs/`, `_plans/`, `CLAUDE.md`, docs). If the CLI refuses, scaffold in a temp dir and copy `package.json`, `tsconfig.json`, `next.config.*`, `tailwind.config.*`, `postcss.config.*`, `src/`, `public/`, `.eslintrc.json`, `.gitignore` into the repo.
- Confirm `tsconfig.json` has `"strict": true` (create-next-app default — keep it).
- Confirm `.gitignore` already ignores `node_modules/`, `.next/`, `.env*`.

### 2. Install deps
- `npm install zustand`
- `npm install -D prettier eslint-config-prettier vitest @vitest/ui`

### 3. Prettier + ESLint
- Add `.prettierrc` with explicit keys: `{ "printWidth": 100, "singleQuote": true, "trailingComma": "all", "semi": true }`.
- Extend the generated `.eslintrc.json` to include `"prettier"` in `extends` (turns off rules that conflict with Prettier).
- Add scripts to `package.json`: `"format": "prettier --write ."`, `"test": "vitest run"`.

### 4. `src/types.ts` (master spec §4)
Exact shapes, no extras:
- `TranscriptChunk` — `id`, `text`, `timestamp`
- `SuggestionType` — `'question' | 'talking_point' | 'fact_check'`
- `Suggestion` — `id`, `type`, `text`
- `SuggestionBatch` — `id`, `createdAt`, `suggestions: Suggestion[]`, `transcriptSnapshot: string`
- `MessageRole` — `'user' | 'assistant'`
- `ChatMessage` — `id`, `role`, `content`, `isStreaming`, `triggeredBySuggestion?`, `timestamp`
- `SuggestionsRequest` — `{ recentTranscript: string }`
- `SuggestionsResponse` — `{ suggestions: Suggestion[] }`
- `ChatRequest` — `{ messages: { role: MessageRole; content: string }[]; recentTranscript: string }`

### 5. `src/store/useTwinMindStore.ts` (master spec §6)
Store fields:
- `transcript: TranscriptChunk[]`
- `isRecording: boolean`
- `lastFinalizedAt: number`
- `suggestionBatches: SuggestionBatch[]`
- `suggestionsStatus: 'idle' | 'loading' | 'error'`
- `chatMessages: ChatMessage[]`
- `chatStatus: 'idle' | 'loading' | 'error'`

Actions (every one, typed against `types.ts`):
- `appendTranscriptChunk(text)` — spreads `transcript`, also sets `lastFinalizedAt = Date.now()`.
- `setIsRecording(val)`.
- `appendSuggestionBatch(batch)` — spread.
- `setSuggestionsStatus(s)`.
- `appendChatMessage(msg)` — spread.
- `updateStreamingMessage(id, delta)` — `chatMessages.map(...)` producing a **new** message object on match (§6.3).
- `finalizeStreamingMessage(id)` — same map pattern, flips `isStreaming: false`.
- `injectSuggestionToChat(suggestion)` — appends a new `user` `ChatMessage` with `triggeredBySuggestion = suggestion.id` (§6.4).

All ids via `crypto.randomUUID()`.

### 6. API route stubs
- `src/app/api/suggestions/route.ts`:
  ```ts
  export async function POST() { return new Response(null, { status: 200 }); }
  ```
- `src/app/api/chat/route.ts` — same.
- **Do not** import `process.env.GROQ_API_KEY`, Groq SDK, or anything server-secret. `deployment` introduces that concern.

### 7. Tests — `tests/`
- `tests/store.test.ts`:
  - `appendTranscriptChunk` → `old.transcript !== new.transcript`.
  - `appendSuggestionBatch` → new array reference.
  - `appendChatMessage` → new array reference.
  - `updateStreamingMessage` → the targeted message is a **new object**, and unrelated messages retain their original reference.
  - `finalizeStreamingMessage` → `isStreaming === false`, and message object is new.
  - `injectSuggestionToChat` → last message has `role === 'user'`, `content === suggestion.text`, `triggeredBySuggestion === suggestion.id`.
- `tests/api.test.ts`: invoke each route's `POST` handler directly and assert `status === 200`.

## Critical files to create

- [src/types.ts](../src/types.ts) — canonical interfaces
- [src/store/useTwinMindStore.ts](../src/store/useTwinMindStore.ts) — Zustand store
- [src/app/api/suggestions/route.ts](../src/app/api/suggestions/route.ts) — 200 stub
- [src/app/api/chat/route.ts](../src/app/api/chat/route.ts) — 200 stub
- [.prettierrc](../.prettierrc)
- [.eslintrc.json](../.eslintrc.json) — extended with `"prettier"`
- [tests/store.test.ts](../tests/store.test.ts)
- [tests/api.test.ts](../tests/api.test.ts)
- [vitest.config.ts](../vitest.config.ts)

## Invariants to preserve (from `CLAUDE.md` + master spec)

1. **No mutating array methods** on any store field. Always spread.
2. **`updateStreamingMessage` returns a new message object**, not just a new array — otherwise streaming subscribers don't re-render.
3. **API stubs contain zero secrets or Groq references** — the server-only key belongs to `deployment` and the two real route implementations.
4. **No cross-pipeline imports.** The store is the sole shared surface; `injectSuggestionToChat` mutates state, it does **not** call `ChatPanel`.
5. **Tailwind utilities only** — no `.css` modules, no global stylesheet beyond what create-next-app ships.

## Verification

After implementing, in order:

1. `npm run dev` — page loads at `http://localhost:3000` with no console or TS errors.
2. `npx tsc --noEmit` — passes under `strict: true`.
3. `npm run lint` — clean.
4. `curl -X POST http://localhost:3000/api/suggestions -i` → `HTTP/1.1 200`.
5. `curl -X POST http://localhost:3000/api/chat -i` → `HTTP/1.1 200`.
6. `npm test` — all tests green.
7. Tailwind sanity: drop `<div className="bg-red-500 p-4">hi</div>` into `src/app/page.tsx`; confirm red background renders.
8. Store sanity (one-off, can be a throwaway console.log in `page.tsx` while verifying, removed after): call `appendTranscriptChunk('hello')` twice and assert the two transcript snapshots do not share references.

## Stop condition

This slice is **done** when `ui-layout` can import from `@/store/useTwinMindStore` and `@/types` with no additional scaffolding required. Do **not** begin `ui-layout` inside this slice — the master spec build order is sequential (§9) and each step closes out before the next begins.
