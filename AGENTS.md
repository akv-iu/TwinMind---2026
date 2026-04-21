# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Repository status

This repo is **pre-implementation**. It currently contains only planning documents and an empty `README.md` — no `package.json`, no source code, no tests. The first coding task is Step 1 of the build order in the master spec (scaffold a Next.js app). Do not invent build/test/lint commands until the scaffold exists.

## Authoritative specification

`TwinMind_Master_Spec.docx` is the **canonical engineering contract** for this project. It is explicitly written to be consumed by an LLM acting as the implementer. Before writing or modifying any code, read the relevant section:

- **§1** — what the system is (real-time mic → transcript + AI suggestions + on-demand chat)
- **§2–3** — three-pipeline architecture and the exact tech stack (no substitutions without approval)
- **§4** — canonical TypeScript interfaces (`TranscriptChunk`, `Suggestion`, `SuggestionBatch`, `ChatMessage`, API request/response shapes)
- **§5** — per-component contracts (what each panel owns, reads, writes, and MUST NOT do)
- **§6** — Zustand store shape and immutability rules
- **§7** — LLM prompts, context budgets, streaming implementation
- **§8** — every edge case with the exact guard function to write
- **§9** — the ordered build sequence (do not skip ahead)
- **§12** — final checklist of every guard that must exist in the codebase

`Understanding document.docx` contains additional context; `Requirement- twin mind.pdf` is the original brief. When spec sections conflict, the master spec wins.

To read the DOCX files, extract `word/document.xml` via `zipfile` (no native tools for `.docx` are installed here).

## High-level architecture

The system is three **decoupled pipelines** coordinated only through a shared Zustand store. The decoupling is load-bearing — violating it is the most likely way to introduce silent bugs:

```
  SpeechRecognition ──► TranscriptPanel ──WRITE──► Zustand store ◄──READ── SuggestionsPanel ──► /api/suggestions ──► Groq (llama3-8b-8192)
                                                        ▲                                                ▲
                                                        │                                                │ click injects user msg
                                                        └──────READ── ChatPanel ──► /api/chat ──────────┘
                                                                                     └──► Groq (llama3-70b-8192, streamed)
```

Key rules that are NOT derivable from reading code alone:

1. **Writer uniqueness.** `TranscriptPanel` is the *only* writer to `transcript[]`. `SuggestionsPanel` and `ChatPanel` are pure readers. Suggestions/Chat must never import from each other or from TranscriptPanel.
2. **Interim vs final separation.** Interim speech recognition results live in React `useState` only. Only finalized chunks are written to the Zustand store. Writing interim tokens to the store causes duplicate text and a re-render storm (§8.2).
3. **Immutable store updates.** All array updates use spread syntax. `.push()`/`.splice()` on store arrays will silently break Zustand change detection (§6.2).
4. **Guard-before-API-call is mandatory.** Every LLM call is preceded by a chain of guards. For suggestions: `shouldRunSuggestions` (≥30 words), `isTranscriptSettled` (≥8s silence), `isTranscriptFresh` (≤3 min old), plus a module-level `isRunning` flag reset in `finally` (not `then`). See §8.1, §8.3, §8.4, §8.5.
5. **Guards live at the trigger function**, not in components and not in the store. The trigger is the boundary between timer and API call — that is the correct place for pre-call assertions.
6. **Token budget trimming runs server-side** in `/api/chat`, not in the client component. The client sends full history; the route trims via `trimHistoryToTokenBudget` before forwarding to Groq (§8.6).
7. **Chat streaming error recovery.** Wrap the `ReadableStream` reader in try/catch and always call `finalizeStreamingMessage` in the catch — otherwise a dropped connection leaves `isStreaming: true` forever (§8.10).

## Security invariant (non-negotiable)

`GROQ_API_KEY` is **server-only**. It must appear exclusively in `/api/suggestions` and `/api/chat` Next.js route handlers. The client calls those routes, never `api.groq.com` directly. Verification: after deploy, DevTools → Network filter for `groq` must show zero browser requests (§11.2).

## Build order

Implement §9 steps in order. Do not start suggestions before the store is done; do not start chat before the transcript engine works. When beginning each step, state which step you're on; when finishing, summarize what was implemented and what the user should verify before the next step. Wait for the user to say continue.

## Tech stack (fixed — no substitutions)

React 18 (strict TS) · Next.js API routes · Zustand (no Redux/Context for shared state) · Tailwind utility classes (no custom CSS) · Web Speech API (browser native, no SDK) · Groq API (`llama3-8b-8192` for suggestions, `llama3-70b-8192` for chat) · `ReadableStream` + `TextDecoder` for streaming · Vercel deployment.
