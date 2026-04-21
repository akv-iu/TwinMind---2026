# Plan: Deployment

Spec: [_specs/deployment.md](../_specs/deployment.md)
Branch (for future commit work): `claude/feature/deployment`

## Context

`deployment` is **Step 12** of the master spec build order — the final slice. Everything else must be in place before this one lands meaningfully. It is narrow in code footprint but heavy on operational guardrails: the product's single most important security invariant is asserted here — **`GROQ_API_KEY` never appears in the client bundle**. Violation is a key leak, and preview URLs in particular can be shared publicly.

This slice is a mix of **code** (hard to get wrong once written) and **ops** (actions the user takes in external dashboards — Vercel, Groq, GitHub). The plan keeps them separate so execution can proceed without confusion.

Prerequisites (all upstream slices complete):
- `app-foundation` — scaffold + initial `.gitignore` from `create-next-app`.
- `real-time-transcription`, `suggestion-generation`, `chat-system`, `ui-layout` — the two API routes read `process.env.GROQ_API_KEY`; the app works end-to-end locally.

Downstream: none. After this, §9 is complete.

## Working assumptions (flag if wrong)

- **Hosting = Vercel** — locked by master spec §2–3.
- **Repo hosts on GitHub** — required for Vercel Git integration and GitHub secret scanning. If GitLab/Bitbucket, several steps change.
- **One Groq account** controlled by the user.

## Open Questions — decisions

The spec left 7 unanswered. Questions 1–4 were confirmed with the user; 5–7 default as below.

| # | Question | Decision | Source |
|---|---|---|---|
| 1 | Plan tier | **Vercel Hobby (free)** — 10s function cap | User-confirmed |
| 2 | Separate Groq keys per environment | **Single shared key** across Production / Preview / Development | User-confirmed |
| 3 | Preview-deployment access | **Public** — no deployment protection | User-confirmed |
| 4 | Observability | **Vercel Analytics** (free, one-click) | User-confirmed |
| 5 | Custom domain | **No** — use `*.vercel.app` | Default (post-launch concern) |
| 6 | Rate limiting / abuse protection | **No for MVP** | Default |
| 7 | Key-leak monitoring | **GitHub secret scanning on** (free repo setting); gitleaks pre-commit optional | Default |

## Known limitations (accepted tradeoffs of this tier)

The user's answers to Q1–Q3 carry real consequences that the rest of the plan must respect:

- **Streaming chat will truncate at ~10 seconds** (Hobby function-timeout cap). Replies that would take longer are cut off mid-stream, and chat-system's `[Response interrupted — please retry]` marker appears. This is the product's core flow degraded — the user has accepted it as an MVP/demo tradeoff. Upgrade to Pro is documented in the runbook (one env setting + two code constants to flip).
- **Preview URLs are public and use the production Groq key.** Anyone who discovers a preview URL can invoke `/api/chat` and `/api/suggestions`, burning the user's Groq quota until the key is rotated. Accepted risk: rotate the key on any known leak; don't share preview URLs broadly.
- **No secondary auth on preview** — don't assume obscurity protects anything; every preview is effectively public API.

These are accepted, not fixed. The runbook's "Upgrade to Pro" section documents exactly what to flip when the user is ready to lift these limits.

## Scope

**Code changes** (this slice writes/modifies):

1. `vercel.json` — `maxDuration: 10` for both `/api/chat` and `/api/suggestions` (Hobby cap; explicit so intent is captured in the repo).
2. `.gitignore` — confirm `.env*` coverage from create-next-app; add `!.env.example` negation.
3. `.env.example` — documents `GROQ_API_KEY=` with a comment; checked in.
4. Missing-env-var guard at the top of `/api/chat` and `/api/suggestions` route handlers.
5. `.eslintrc.json` override banning `process.env.GROQ_API_KEY` outside `src/app/api/**`.
6. `.github/workflows/bundle-scan.yml` — CI job runs `next build` then greps `.next/static/` for `groq` and fails on any match.
7. Tests: missing-env-var (both routes), `.gitignore` contains `.env*`.
8. `docs/deployment.md` — ops runbook (env vars, key rotation, upgrade-to-Pro path, known limitations).

**Cross-slice note — chat-system client timeout:** the chat-system plan specifies a 55-second `AbortController` timeout in `ChatPanel.tsx`. Under Hobby, Vercel will terminate the function at 10s anyway, so holding the client open longer wastes a render cycle. When the chat-system slice lands, set that constant to **9000 ms** (1 s headroom under the 10 s server cap). The chat-system plan's invariant #8 already anticipates this — "If `deployment` changes the Vercel cap, update this constant."

**Ops checklist** (user executes in dashboards — plan documents exactly what to click):

- Create a Vercel project from the GitHub repo; production branch = `main`.
- (Hobby tier — no upgrade required.)
- Add `GROQ_API_KEY` to all three scopes (Production, Preview, Development) with the **same value** (single shared key, per Q2).
- (No Deployment Protection — previews remain public, per Q3.)
- Enable Vercel Analytics (Vercel → Analytics → Enable).
- Enable GitHub secret scanning (GitHub → Settings → Code security and analysis).
- (Optional) Install `gitleaks` pre-commit hook.

**Out of scope**:

- Custom domain setup.
- Rate limiting / edge middleware.
- Sentry or full error-reporting integration.
- Multi-region edge deployment.

## Implementation Steps

### 1. `.gitignore`

`create-next-app` already ignores `.env*.local`. Append the negation so `.env.example` stays committable:
```
# env
!.env.example
```

### 2. `.env.example`
```
# Groq API key — server-only. Set via the Vercel dashboard for deployed
# environments, or copy this file to .env.local and fill in your dev key.
# DO NOT commit a real key. Do not rename this file to .env.local — .env.local
# is gitignored.
GROQ_API_KEY=
```

### 3. `vercel.json`
```json
{
  "functions": {
    "src/app/api/chat/route.ts": { "maxDuration": 10 },
    "src/app/api/suggestions/route.ts": { "maxDuration": 10 }
  }
}
```
Next.js 14 App Router auto-maps these paths to serverless functions. On Hobby, values above 10 are rejected or clamped; using 10 explicitly documents the cap. When upgrading to Pro, bump chat to 60 and suggestions to 30 (see runbook).

### 4. Missing-env-var guard — `src/app/api/chat/route.ts` and `src/app/api/suggestions/route.ts`

Prepend each handler's body with:
```ts
if (!process.env.GROQ_API_KEY) {
  console.error('[api/chat] missing GROQ_API_KEY — deploy is misconfigured');
  return Response.json({ error: 'SERVER_MISCONFIGURED' }, { status: 500 });
}
```
Use the correct route name in the log prefix for each file.

Response body `{ error: 'SERVER_MISCONFIGURED' }` lets the client render a clean inline error (chat-system already handles non-200 with an inline system-style message + Retry; suggestion-generation flips `suggestionsStatus: 'error'`). No new client-side error plumbing is needed.

### 5. ESLint rule — `.eslintrc.json`
Add override:
```json
{
  "overrides": [{
    "files": ["src/**/*.{ts,tsx}"],
    "excludedFiles": ["src/app/api/**"],
    "rules": {
      "no-restricted-syntax": ["error", {
        "selector": "MemberExpression[object.object.name='process'][object.property.name='env'][property.name='GROQ_API_KEY']",
        "message": "GROQ_API_KEY is server-only. Only /api routes may read it."
      }]
    }
  }]
}
```

Defense in depth:
- **Naming** (`GROQ_API_KEY` with no `NEXT_PUBLIC_` prefix) → Next.js strips it from the client bundle.
- **ESLint** → fails `npm run lint` if anyone tries to read it in client code.
- **CI bundle scan** → final backstop if something still slipped through.

### 6. CI bundle scan — `.github/workflows/bundle-scan.yml`
```yaml
name: bundle-scan
on: [pull_request]
jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm ci
      - run: npm run build
      - name: Assert no Groq reference in client bundle
        run: |
          if grep -riq "groq" .next/static/; then
            echo "::error::Found 'groq' in client bundle — possible key leak"
            grep -ri "groq" .next/static/
            exit 1
          fi
```
Runs on every PR, not just `main` — the point is catching leaks before merge.

### 7. Tests — `tests/deployment/`

- `tests/deployment/missingEnvVar.test.ts`
  - Clear `process.env.GROQ_API_KEY`, invoke each route's `POST` with a minimal body.
  - Assert status 500, body `{ error: 'SERVER_MISCONFIGURED' }`, `console.error` called once with the correct `[api/chat]` / `[api/suggestions]` prefix.
  - Restore env in `afterEach`.
- `tests/deployment/gitignore.test.ts`
  - Read `.gitignore`, assert it contains a rule matching `.env.local`.
  - Assert `.env.example` is NOT matched by the ignore rules (sanity: it's checked in).

The spec also suggests a "function-timeout test." In practice Vercel's `maxDuration` is not enforceable in-process, and the chat route itself does not install any in-route timeout (it relies on the platform). The meaningful test is manual — verification step 6 below confirms short chat replies complete and longer ones terminate cleanly with the interrupted marker, which is the only timeout behavior that matters under Hobby. No Vitest analogue adds value, so skipped.

### 8. Ops runbook — `docs/deployment.md`

One-page runbook. Sections:

- **Initial setup** — Vercel project creation, branch mapping (`main` = prod), env-var scopes (one key across all three), Hobby tier, Vercel Analytics toggle.
- **Environment variables** — the canonical list (just `GROQ_API_KEY` today); same value across Production / Preview / Development.
- **Key rotation** — five-step procedure targeting < 10-minute rotation (single-key version):
  1. Generate new key in Groq dashboard.
  2. Update `GROQ_API_KEY` in all three Vercel scopes to the new value.
  3. Trigger redeploy (Vercel → Deployments → ⋯ → Redeploy).
  4. Confirm via Vercel function logs + Groq dashboard activity that the new key is serving traffic.
  5. Revoke the old key in Groq.
- **Known limitations**
  - Chat replies longer than ~10 seconds are truncated — Hobby function cap. Users see `[Response interrupted — please retry]`.
  - Preview URLs are public and use the same Groq key as production. Rotate the key if any URL leaks publicly.
- **Upgrade-to-Pro path** — one-time procedure if the 10s cap becomes unacceptable:
  1. Upgrade the project's plan tier in Vercel → Settings → Plan.
  2. Edit `vercel.json`: `maxDuration: 60` for `/api/chat`, `30` for `/api/suggestions`. Commit + redeploy.
  3. Edit `src/components/ChatPanel.tsx`: bump the `setTimeout(() => controller.abort(), …)` constant from `9_000` to `55_000` ms.
  4. (Optional but recommended at Pro) provision a separate preview Groq key and enable Deployment Protection password.
- **Custom domain** — one paragraph: add via Vercel → Domains; no code changes required.
- **Monitoring** — Vercel Analytics URL; GitHub secret scanning alert routing.

## Critical files to create / modify

- **Create**: [vercel.json](../vercel.json)
- **Create**: [.env.example](../.env.example)
- **Modify**: [.gitignore](../.gitignore) — add `!.env.example`
- **Modify**: [.eslintrc.json](../.eslintrc.json) — `no-restricted-syntax` override
- **Modify**: [src/app/api/chat/route.ts](../src/app/api/chat/route.ts) — prepend env guard
- **Modify**: [src/app/api/suggestions/route.ts](../src/app/api/suggestions/route.ts) — prepend env guard
- **Create**: [.github/workflows/bundle-scan.yml](../.github/workflows/bundle-scan.yml)
- **Create**: [tests/deployment/missingEnvVar.test.ts](../tests/deployment/missingEnvVar.test.ts)
- **Create**: [tests/deployment/gitignore.test.ts](../tests/deployment/gitignore.test.ts)
- **Create**: [docs/deployment.md](../docs/deployment.md)

## Invariants to preserve

1. **`GROQ_API_KEY` is only ever referenced inside `src/app/api/**`.** Enforced by (a) Next.js naming convention, (b) ESLint rule, (c) CI bundle scan. Any single layer failing is caught by the other two.
2. **`.env.local` is never committed.** `.gitignore` rule + GitHub secret scanning as a post-facto backstop.
3. **Bundle scan runs on every PR, not just `main`.** Catching leaks after merge is too late.
4. **Chat `maxDuration` stays ≥ the chat-system reader's client-side timeout.** Under Hobby: server 10s ≥ client 9s. Under Pro (future): server 60s ≥ client 55s. The two numbers move together — any change here triggers a client-side edit in `ChatPanel.tsx`.
5. **Missing env var produces a clear server log and a structured JSON 500, not a cryptic HTML error page or unhandled exception.** The client renders `SERVER_MISCONFIGURED` as an inline error via chat-system's existing error path.
6. **On key leak, rotate immediately.** One key serves all three scopes, so any leaked preview URL requires full rotation. The runbook's 5-step procedure targets < 10 minutes.

## Verification

After merging this slice, running the ops checklist, and pushing to `main`:

1. `npm run build` locally → succeeds.
2. `grep -ri "groq" .next/static/` locally → zero matches.
3. Deployed prod URL loads without runtime errors.
4. DevTools → Network panel, filter `groq` → zero matches during a full transcript → suggestions → chat flow.
5. Vercel → Functions → Logs show Groq calls from both `/api/suggestions` and `/api/chat`.
6. A streaming chat response under ~8s completes cleanly on the deployed URL. A longer one (force a verbose model response) terminates at ~10s and renders the `[Response interrupted — please retry]` marker — this is the expected Hobby behavior.
7. Temporarily unset `GROQ_API_KEY` in a Preview env, hit `/api/chat` → response is `{ error: 'SERVER_MISCONFIGURED' }` with status 500; Vercel logs show `[api/chat] missing GROQ_API_KEY`.
8. Push a throwaway branch that references `"groq"` in a client component → CI `bundle-scan` job fails. Revert.
9. Attempt to write `process.env.GROQ_API_KEY` inside `src/components/ChatPanel.tsx` → `npm run lint` errors with the ESLint message.
10. Attempt to commit a file containing `GROQ_API_KEY=sk-…` → GitHub secret scanning alert fires.
11. Open a Preview URL in incognito → it loads directly (public preview access, per Q3 decision).

## Stop condition

This slice — and the project — ships when:
- Production URL loads and works end-to-end.
- All 11 verification checks pass.
- `docs/deployment.md` captures the runbook so key rotation and preview-access changes can happen under incident pressure without re-deriving the procedure.

No downstream slices. Master spec §9 is complete.
