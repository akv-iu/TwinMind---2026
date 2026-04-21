# Plan: UI Layout

Spec: [_specs/ui-layout.md](../_specs/ui-layout.md)
Branch (for future commit work): `claude/feature/ui-layout`

## Context

The `ui-layout` slice is Step 4 in the master-spec build order (§9) — the **visual skeleton** that every downstream slice plugs into. It delivers the three-column CSS Grid shell with independently-scrolling `TranscriptPanel` / `SuggestionsPanel` / `ChatPanel` placeholders. No business logic ships here; the panels are empty components that just accept a `className` so the grid parent can size and border them. The outcome is a page that a developer can open in a browser at 1280px+ and visually verify: three equal columns, border dividers, scroll isolation, no page scroll.

Prerequisite: `app-foundation` ([_plans/app-foundation.md](app-foundation.md)) must be merged first — this slice depends on the Next.js 14 App Router scaffold, Tailwind, the Zustand store, and `src/types.ts`. None of those exist yet (repo is pre-implementation: no `package.json`, no `src/`). This slice does **not** scaffold Next.js; if `app-foundation` isn't done, stop and finish it first.

All four Open Questions in [_specs/ui-layout.md](../_specs/ui-layout.md) are answered:

| Question | Decision |
|---|---|
| Minimum supported viewport width | **1280px** (matches Tailwind's default `xl` breakpoint — no config change) |
| Behavior below minimum | Show a "please use a wider window" notice |
| Header/footer outside the grid | None — grid takes the full viewport |
| Column widths | Equal — `grid-cols-3` |

## Working assumptions (flag if wrong)

- **Component location**: `src/components/TranscriptPanel.tsx`, `SuggestionsPanel.tsx`, `ChatPanel.tsx`. `real-time-transcription` and the two LLM slices will replace each panel's body later — matches the path assumed by [_plans/real-time-transcription.md](real-time-transcription.md).
- **Grid owner**: `src/app/page.tsx` is the sole place the grid is expressed. `src/app/layout.tsx` is responsible only for `<html>`/`<body>` baseline styles (font, no page scroll).
- **Test harness additions live here**: this is the first slice that renders React, so it adds `jsdom` + `@testing-library/react` + `@testing-library/jest-dom` and switches Vitest's environment to `jsdom`. [_plans/real-time-transcription.md](real-time-transcription.md) currently claims it installs those — reconcile by moving that setup into this slice and leaving real-time-transcription to reuse it.
- **Scrollbar gutter**: use Tailwind arbitrary value `[scrollbar-gutter:stable]` on each column to prevent horizontal shift when one panel's scrollbar appears (spec §Possible Edge Cases). Modern Chrome/Edge only — acceptable per the desktop-only target.
- **No `className` merging lib** (`clsx`/`classnames`). Panels accept an optional `className` and forward it verbatim to their root element. Over-engineering for this slice.

## Scope

1. Create three placeholder components that accept `className` and render a semantic `<section>` with an `aria-label`. No store access, no effects, no business logic.
2. Implement the three-column grid in `src/app/page.tsx` using `grid-cols-3` + per-column `overflow-y-auto` + border dividers on the first two columns.
3. In `src/app/layout.tsx`, set `<body>` to `overflow-hidden h-screen` so the outer page never scrolls.
4. Below the 1280px breakpoint, hide the grid and render a centered "desktop only" notice using `xl:hidden` / `hidden xl:grid`.
5. Add `jsdom` + `@testing-library/react` + `@testing-library/jest-dom`; configure Vitest with `environment: 'jsdom'` and a setup file that imports the matchers.
6. Write tests under `tests/ui-layout.test.tsx` covering the four cases in the spec's Testing Guidelines.

**Out of scope**: any `SpeechRecognition` / mic work (→ real-time-transcription), any Groq calls (→ suggestion-generation, chat-system), any store subscription inside the panels (→ each feature slice), mobile responsiveness beyond the below-1280px notice, visual-regression snapshot tooling (the spec mentions screenshot tests but no tool is chosen — cover visually via manual verification at 1280px and 1920px, and cover the grid DOM shape via render tests).

## Implementation Steps

### 1. Placeholder components

Create three nearly-identical files. Example — `src/components/TranscriptPanel.tsx`:

```tsx
interface TranscriptPanelProps {
  className?: string;
}

export function TranscriptPanel({ className }: TranscriptPanelProps) {
  return <section aria-label="Transcript" className={className} />;
}
```

Same pattern for `SuggestionsPanel.tsx` (`aria-label="Suggestions"`) and `ChatPanel.tsx` (`aria-label="Chat"`). No default export — named exports match the import style used elsewhere.

Do **not** subscribe to the Zustand store in any panel here. That happens in the downstream slices.

### 2. `src/app/layout.tsx`

Modify the scaffolded layout so `<body>` prevents page scroll and fills the viewport:

```tsx
<body className="h-screen overflow-hidden bg-white text-gray-900 antialiased">
  {children}
</body>
```

Keep `<html lang="en">` and whatever font setup create-next-app produced. Do not add any grid classes to `<body>` — the grid lives in `page.tsx` so future route siblings (if ever added) aren't forced into the same shape.

### 3. `src/app/page.tsx`

Replace the scaffold's placeholder content with:

```tsx
import { TranscriptPanel } from '@/components/TranscriptPanel';
import { SuggestionsPanel } from '@/components/SuggestionsPanel';
import { ChatPanel } from '@/components/ChatPanel';

export default function Page() {
  return (
    <>
      <main className="hidden xl:grid h-screen grid-cols-3">
        <TranscriptPanel className="h-screen overflow-y-auto border-r border-gray-200 [scrollbar-gutter:stable]" />
        <SuggestionsPanel className="h-screen overflow-y-auto border-r border-gray-200 [scrollbar-gutter:stable]" />
        <ChatPanel className="h-screen overflow-y-auto [scrollbar-gutter:stable]" />
      </main>
      <div
        className="xl:hidden flex h-screen items-center justify-center p-8 text-center text-gray-600"
        role="status"
      >
        TwinMind is desktop-only. Please open this app in a window at least 1280&nbsp;px wide.
      </div>
    </>
  );
}
```

Notes:
- `hidden xl:grid` / `xl:hidden` is Tailwind's built-in gate at 1280px — no custom breakpoint, no config change.
- Each column sets its own `h-screen` (so `overflow-y-auto` has a bounded height to scroll against) and its own scroll container. The grid parent is `h-screen` too; this is intentional belt-and-braces and matches `<body>`'s `h-screen`.
- The border-dividers land on the first two panels only. The third has no right border.
- `[scrollbar-gutter:stable]` is a Tailwind arbitrary-value utility — no plugin.

### 4. Test harness

Extend the Vitest setup that `app-foundation` laid down:

- `npm install -D jsdom @testing-library/react @testing-library/jest-dom @types/react @types/react-dom` (the `@types/*` packages likely already come from create-next-app — confirm and skip if so).
- Modify [vitest.config.ts](../vitest.config.ts):
  ```ts
  import { defineConfig } from 'vitest/config';
  export default defineConfig({
    test: {
      environment: 'jsdom',
      setupFiles: ['./tests/setup.ts'],
      globals: true,
    },
  });
  ```
- Create [tests/setup.ts](../tests/setup.ts):
  ```ts
  import '@testing-library/jest-dom/vitest';
  ```
- Update [_plans/real-time-transcription.md](real-time-transcription.md) to note that jsdom + Testing Library are already installed by `ui-layout` (avoid a duplicate-install step when that slice begins).

### 5. Tests — `tests/ui-layout.test.tsx`

Cover the four spec cases:

1. **All three panels mount without error.** Render `<Page />`; query by `aria-label` for `Transcript`, `Suggestions`, `Chat`; assert all three are in the document.
2. **Grid structure at desktop.** Render `<Page />`; assert `main` has classes `grid-cols-3` and `xl:grid`; assert the first two children have `border-r` in their class list and the third does not.
3. **Scroll isolation.** Render `<Page />`; manually set `scrollTop` on the Transcript section (via its DOM node from `getByLabelText('Transcript')`); assert the Suggestions and Chat sections still have `scrollTop === 0`. jsdom doesn't do layout, but `scrollTop` is settable/readable on elements and a simple property check is enough to prove no shared scroll state.
4. **Body has `overflow-hidden`.** Render the layout (extract its body-className into a small helper or render the layout component directly); assert `document.body.className` (or the wrapper's className) includes `overflow-hidden` and `h-screen`.

These tests do not need `act` wrapping or async handling — the components are pure/synchronous.

## Critical files to create / modify

- [src/components/TranscriptPanel.tsx](../src/components/TranscriptPanel.tsx) — new, placeholder
- [src/components/SuggestionsPanel.tsx](../src/components/SuggestionsPanel.tsx) — new, placeholder
- [src/components/ChatPanel.tsx](../src/components/ChatPanel.tsx) — new, placeholder
- [src/app/page.tsx](../src/app/page.tsx) — replace scaffold content with the 3-column grid + below-xl notice
- [src/app/layout.tsx](../src/app/layout.tsx) — add `h-screen overflow-hidden` to `<body>`
- [vitest.config.ts](../vitest.config.ts) — add `environment: 'jsdom'` + `setupFiles`
- [tests/setup.ts](../tests/setup.ts) — new, `@testing-library/jest-dom/vitest` import
- [tests/ui-layout.test.tsx](../tests/ui-layout.test.tsx) — new, four cases above
- [package.json](../package.json) — add `jsdom`, `@testing-library/react`, `@testing-library/jest-dom` via `npm i -D`
- [_plans/real-time-transcription.md](real-time-transcription.md) — small edit to reference ui-layout's test-harness install

## Invariants to preserve (from [CLAUDE.md](../CLAUDE.md) + master spec)

1. **Tailwind utilities only** — no `.css` modules, no global stylesheet beyond what create-next-app ships, no `style={{ ... }}` for literal colors/sizes.
2. **Panels are pure placeholders in this slice.** No store imports, no effects, no event handlers. Each is a `<section>` with an `aria-label` and a passed-through `className`. This is load-bearing — the downstream slices are the only places the panels grow logic.
3. **No cross-panel imports.** `SuggestionsPanel` must not import from `TranscriptPanel`, and so on. Even though nothing exists to import yet, the file boundaries are set now. CLAUDE.md §1.
4. **Only the panels scroll.** `<body>` is `overflow-hidden`; the `<main>` grid has no `overflow-y-auto`; each column does. If a future change adds scroll at `<body>` or `<main>`, it breaks the invariant.
5. **Grid is desktop-only.** No `md:`, `lg:`, or mobile breakpoints. The page is either a 3-column grid (≥1280px) or a centered notice (<1280px). No in-between.
6. **Border dividers on the first two columns only.** Adding `border-r` to the third creates an extra vertical line at the viewport edge.
7. **No `className` merging logic.** Panels forward `className` verbatim. If a future slice needs to add panel-local classes, it can do so via template literals at that time.

## Verification

After implementing, in order:

1. `npx tsc --noEmit` — passes under `strict: true`.
2. `npm run lint` — clean.
3. `npm test` — all four cases green.
4. `npm run dev`, open `http://localhost:3000` in Chrome/Edge at **1920px** width. Visually confirm: three equal columns, two thin gray vertical borders between them, no page scrollbar. DevTools → Elements → `<body>` has `overflow: hidden; height: 100vh`.
5. Resize the window to **1280px** exactly. Layout remains the 3-column grid (this is the breakpoint — `xl` is inclusive).
6. Resize to **1200px** (below `xl`). The grid disappears and the "desktop only" notice is centered in the viewport. No horizontal scrollbar.
7. Back at ≥1280px: in DevTools → Elements, grab the Transcript `<section>` and run `$0.scrollTop = 500` in the console (after temporarily filling it with enough content to make it scroll, e.g. paste a tall `<div style="height:2000px">` via Elements). Confirm Suggestions and Chat panels' `scrollTop` remain `0`. Remove the temporary content.
8. DevTools → Network tab: page load generates zero requests to external hosts (no Google Fonts, no Groq — this slice imports nothing server-side or cross-origin). Matches the `deployment` security invariant even though it isn't enforced yet.
9. Tab through the page with Keyboard: landmarks are `main` (the grid) plus three `<section aria-label>`s — screen readers can jump between them.

## Stop condition

This slice is **done** when:

- All three panels render empty inside the grid at ≥1280px, with independent scroll.
- The below-xl notice renders at <1280px.
- The four tests pass.
- `real-time-transcription` can open `TranscriptPanel.tsx`, replace its body with the speech-recognition implementation, and not need to touch the grid, the layout root, or the other two panels.

Do **not** begin any downstream slice inside this one. Master spec §9 is sequential; each step closes out before the next begins. When this slice lands, summarize what shipped and wait for the user to say continue before starting `real-time-transcription`.
