# Spec for Deployment

branch: claude/feature/deployment
figma_component (if used): N/A — no Figma reference

## Summary

Deploy the application to Vercel with `GROQ_API_KEY` configured as a server-only environment variable. Verify — both manually in DevTools and by grepping the client bundle — that no Groq API requests originate from the browser. Configure Vercel function timeouts so the streaming `/api/chat` route can run long enough for full responses. This slice is narrow but critical: the single most important security invariant in the product (no API-key leak) is asserted here.

## Functional Requirements

- `GROQ_API_KEY` set in Vercel dashboard Environment Variables for every environment (Production, Preview, Development) — never committed to git.
- `.env.local` listed in `.gitignore`; `.env` is not used (since it can be committed by accident).
- `GROQ_API_KEY` is read **only** inside `/api/suggestions` and `/api/chat` route handlers — never inside a client component, hook, or shared util.
- `vercel.json` (if required) configures function timeouts: `/api/chat` 60s, `/api/suggestions` 30s.
- Production deploys from the `main` branch; feature branches auto-produce preview deployments.
- A post-deploy verification procedure is documented: (a) grep built client bundle for "groq", (b) manual smoke test with DevTools Network filter.

## Possible Edge Cases

- **Accidental client-side key reference.** A developer imports `process.env.GROQ_API_KEY` into a client component. Build may succeed but the key could be inlined or leaked. Catch via lint rule and/or review checklist.
- **Hobby-plan function timeout.** Default Vercel hobby plan caps at 10s — a streaming chat response lasting 30s gets terminated mid-stream. Must confirm plan tier supports the configured 60s timeout.
- **`process.env.GROQ_API_KEY` undefined at runtime.** Deploy forgot to set the variable. Route should return a clear 500 with an actionable server log ("missing GROQ_API_KEY"), not a cryptic fetch failure on the client.
- **Preview-deployment key exposure.** Preview URLs can be shared publicly. Using the production key in Preview environments risks abuse via anyone with the URL. Use a separate rate-limited key or password-protect previews.
- **Key rotation.** Rotating the key must not require a redeploy if possible; document the procedure (set new env var, trigger redeploy, revoke old key) so rotation can happen under incident pressure.
- **Committed `.env` by accident.** Ensure `.env*` is in `.gitignore` and a pre-commit check catches additions.
- **Streaming cut off by Vercel edge timeout.** Even with `maxDuration: 60`, the platform may terminate connections earlier under load. Observe real behavior post-deploy and adjust.
- **CORS / Origin concerns.** `/api/*` routes are same-origin with the client by default; make sure no reverse-proxy or custom origin setup breaks this.

## Acceptance Criteria

- App loads at the Vercel production URL without runtime errors.
- DevTools Network panel shows zero requests to `api.groq.com` from the browser during a full transcript → suggestions → chat flow.
- Vercel function logs show Groq API calls emanating from both `/api/suggestions` and `/api/chat`.
- `grep -ri "groq" .next/static/` returns zero matches in the built client bundle.
- Configured function timeouts are respected — a 45s streaming chat response completes.
- `.env.local` is ignored by git; committing it is blocked by `.gitignore`.
- A missing `GROQ_API_KEY` at runtime produces a clear server log and a user-facing error state — not a cryptic silent failure.

## Open Questions

- **Plan tier.** Hobby (10s cap) vs Pro (60s cap) — Pro is almost certainly required for streaming chat; confirm.
- **Custom domain** required or is the default `*.vercel.app` URL sufficient?
- **Rate limiting / abuse protection** at the edge — needed for launch or post-launch?
- **Observability** — Sentry, Vercel Analytics, both, or neither?
- **Preview-deployment access** — public, password-protected, or behind Vercel auth?
- **Separate keys per environment** — is the Groq account/plan provisioned for this?
- **Monitoring for key leaks** — any automated scanner (GitHub secret scanning, git-secrets pre-commit, etc.)?

## Testing Guidelines

Create a test file(s) in the ./tests folder for the new feature, and create meaningful tests for the following cases, without going too heavy:

- Bundle scan: after `next build`, a test or CI script greps the emitted client chunks and fails if "groq" or the API-key pattern is present.
- Runtime smoke test against the deployed URL: POST `/api/suggestions` with a minimal body returns 200; DevTools Network shows no client-side call to `api.groq.com`.
- `.gitignore` test — a CI check that `.env.local` is in `.gitignore`.
- Missing-env-var test: when `GROQ_API_KEY` is unset in a test environment, the route returns a structured 500 with a log line, not an unhandled exception.
- Function-timeout test: a mocked long-running stream completes within the configured `maxDuration`.
