# Critiq — Development Guide

Project-level conventions and locked patterns. Every Claude session entering this project reads this file.

## Project Overview

Critiq is an AI sales coach that learns the rep, not just the role. Built on the **Signal** product spec authored by Alex Navarro (Sherwin-Williams commercial paint rep). Felix is the development partner.

**Beta target:** 5-10 reps, 60-90 days, NY+NJ only. Sales reps record meetings → transcribed → scored against three-pillar rubric (SPIN/Voss/Navarro) → coaching delivered with adaptation that compounds over time.

## Stack

- **Framework:** Next.js 16 App Router + TypeScript 5.9 + Tailwind 4
- **DB:** Neon Postgres + Drizzle ORM
- **Auth:** NextAuth v5 (email/password + magic links via Resend)
- **Storage:** Vercel Blob (audio chunks via presigned URLs)
- **LLM:** Anthropic Claude Sonnet 4.x (with prompt caching)
- **Transcription:** Deepgram Nova-3 (field-noise resilient, beats Whisper for warehouses/job sites/vehicles)
- **Email:** Resend (`notifications@critiq.firstlap.dev`)
- **Errors:** Sentry
- **Session replay:** LogRocket (post-launch)
- **Rate limiting:** Postgres-based counters (DT Phase 38b pattern, no Upstash)
- **Hosting:** Vercel

## Critical Patterns

### DB

- **Lazy DB connection:** `src/db/index.ts` uses ES Proxy to defer `neon()` until first query. Never call `neon()` at import time.
- **`fetchOptions: { cache: "no-store" }`** on `neon()` init. Without this, Next.js Data Cache memoizes DB queries indefinitely (DT Phase 28b lesson). Without this, deleted rows can reappear.
- **`force-dynamic`** on every API route that hits the DB: `export const dynamic = "force-dynamic"`.
- **No `drizzle-kit push` ever** — requires TTY. Always direct SQL via `@neondatabase/serverless` (`scripts/migrate.ts` pattern).
- **FKs + indexes from day one.** No "we'll add them later."
- **Soft-delete on user-facing data** by default. Hard delete only via explicit "purge" cron.

### Public API Cache-Control

All **public (unauthenticated) API routes** must return via `noStoreJson()` from `src/lib/apiResponse.ts` with `Cache-Control: no-store`. Without this, Vercel's edge CDN can cache responses and serve stale data site-wide (DT Phase 28a lesson). Authenticated routes are session-gated by cookies and don't need this.

### Env Vars

- `DATABASE_URL` — Neon pooled connection
- `DATABASE_URL_UNPOOLED` — Neon direct (for migrations)
- `NEXTAUTH_SECRET` — NextAuth signing secret
- `NEXTAUTH_URL` — canonical URL
- `RESEND_API_KEY` — email sending
- `ANTHROPIC_API_KEY` — LLM (later phases)
- `DEEPGRAM_API_KEY` — transcription (later phases)
- `BLOB_READ_WRITE_TOKEN` — Vercel Blob (later phases)
- `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` — error monitoring

Must be set in **all Vercel environments** (preview, production, development).

### Branching

- Feature branches always from `master`, never from other feature branches.
- Branch naming: `phase-N/{slug}` (e.g. `phase-3/auth-and-resend`).
- PRs from phase branches into **`review-for-main`**, NEVER directly into `master`.
- `review-for-main` is the staging branch. Felix reviews + merges to `master` manually.
- Full Auto NEVER touches `master`.

### Recording Reliability (later phases)

When recording is built (Phases 11-14), maintain the layer-by-layer architecture per `critiq-context` skill. Zero-failures principles:

- 10-min auto-segmentation with 2s overlap (no audio gap)
- 5s chunks within each segment
- Triple persistence per chunk (IndexedDB + Vercel Blob + retry queue)
- Heartbeat verification every 5s
- Tiered failure recovery (Tier 1-4)
- Conservative hallucination guard in coaching output (per Felix's beta decision)

### AI Pipeline (later phases)

- Prompt caching for the locked methodology block (SPIN/Voss/Navarro definitions + rubric)
- Working memory = rep profile + this account profile + last 3 raw interactions + rubric
- Hallucination guard: never surface personal details unless source-tagged with originating interaction ID
- Multi-segment Option B: parallel transcription → concatenation → unified analysis

### Memory Architecture

- 3 tiers: Episodic (raw, forever) → Semantic (running summaries) → Working (in-prompt)
- Consolidation policy: Option B (event-based after every debrief, with rep-profile consolidation every 10 debriefs)
- Account intelligence is SHARED across reps (single source-of-truth summary per account)
- Rep-side data is ISOLATED per rep
- Full inheritance on account rep-transitions

## Roles

- **Rep** — sales rep (the primary user). Has accounts, runs intake, gets coaching.
- **Admin** — Felix + future operations roles. Sees everything (audit, debug, support).
- **Manager** — added later when partnering with enterprise customers. Sees team-aggregate data only, not personal rep intake.

(No `manager` role in beta. Only `rep` + `admin`.)

## Privacy

Per Felix's locked decisions (OQ-04):

1. Beta data access: rep + admin only.
2. Account intelligence shared across reps (single summary, continuity when accounts change hands).
3. Rep-side data stays per-rep isolated.
4. Retention: forever.
5. Users can delete their own data.
6. Enterprise partners get NO historical data without explicit negotiation.
7. Privacy Policy + Terms drafted at end of build (Phase 30).
8. Compliance posture: CCPA awareness from day one, SOC 2 when enterprise asks.

## Recording Consent

- Beta scope: NY + NJ only (both one-party consent states).
- Rep self-attestation flow before first recording (Phase 28).
- Audit log of attestations.

## Development Workflow

1. `git checkout master && git pull`
2. `git checkout -b phase-N/slug`
3. Make changes
4. `pnpm build` — verify no errors before committing
5. If schema changed: write SQL migration in `drizzle/` directory, apply via `scripts/migrate.ts`
6. `git add <specific files>` — never `git add -A`
7. `git commit` with Co-Authored-By trailer (when Claude-assisted)
8. `git push -u origin phase-N/slug`
9. Verify Vercel preview deployment
10. `gh pr create --base review-for-main` (NOT master)
11. Update `docs/PHASE_LEDGER.md` entry: mark phase ✅ done + PR URL

## Full Auto Mode

When Felix says "Full Auto on":

- `/critiq-full-auto` master skill orchestrates planning → designing → building → verifying → merging
- Skill reads `docs/PHASE_LEDGER.md` for next phase
- Spawns sub-agents (Planner, UI Architect, Backend Architect, Builder, Verifier) per phase
- Logs autonomous decisions to `docs/DECISIONS_LOG.md`
- Sends phase summary email + comments on merged PR
- Stops cleanly on budget hit, kill switch, blocker, or all phases done

Kill switch: edit `.critiq-full-auto-state` set `STOP=true`. Editable from any device via GitHub web/mobile.

Kill switch URL: https://github.com/FelixNava/Critiq2/edit/review-for-main/.critiq-full-auto-state

## Anti-patterns

- ❌ `drizzle-kit push`
- ❌ Merging anything to `master` autonomously
- ❌ Adding personal details to coaching output without source tagging
- ❌ Calling `neon()` at import time
- ❌ Skipping `Cache-Control: no-store` on public API routes
- ❌ Skipping `force-dynamic` on DB-touching API routes
- ❌ Committing secrets to the repo
- ❌ Hallucinating phase decisions not in `docs/PHASE_LEDGER.md` or `critiq-context` skill
- ❌ Modifying Felix's locked plans without a `DECISION` log entry

## Conflict Resolution

If `docs/PHASE_LEDGER.md`, the Signal PRD, the Signal Brief, and the `critiq-context` skill conflict on any detail:

1. `critiq-context` skill wins (established plan)
2. Signal PRD second
3. Signal Brief third

Log conflicts in `docs/DECISIONS_LOG.md` and flag in phase email.

## Feedback Rules

Felix's standing rules apply:

- No dev jargon in client-facing copy (no phase numbers, sentry tags, table names in UI)
- All user-explicit selections persist via localStorage (filters, sorts, view tabs)
- Demo/test data goes on dedicated test accounts only, never real client data
- Verify before claiming: name the environment when reporting state
- Never merge unverified branches to `master` (Felix-only manual review)
- Trace AI data path (prompt → tokens → timeout → parsing) before coding new AI features
- Audit ALL branches in a modified function on bug fixes — siblings often share failure modes
