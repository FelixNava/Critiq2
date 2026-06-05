# Critiq — Phase Ledger

Single source of truth for what's been built, what's in flight, what's next.

**Read this before starting any work.** Every Full Auto session reads this file first. Manual sessions should too.

## Format

Each phase has a status indicator:

- ☐ **Planned** — not started
- ⏳ **In flight** — picked up by a session, mid-build
- 🔬 **Verifying** — code complete, in verification
- 🚦 **Blocked** — needs human input or external action
- ✅ **Done** — merged to `review-for-main`, awaiting Felix's review for master
- 🟢 **Shipped** — merged to `master` (Felix's manual review complete)

## Rules

- Phases are worked in order unless explicitly blocked or marked parallel.
- Each phase ships its own branch + PR into `review-for-main`.
- Never merge to `master` autonomously. Felix reviews `review-for-main` periodically and merges to `master`.
- If a phase exceeds 800k tokens in a single session, the session commits WIP, marks phase status as `⏳ in flight (paused)`, and exits. The next cron resumes.
- If a phase's verification fails after 3 fix attempts, mark `🚦 blocked` with `BLOCKER_REASON` in state file, email Felix, exit.

---

## Status snapshot (auto-updated by Full Auto)

- Last updated: 2026-06-05 ~02:10am ET
- Current phase: none (Full Auto NOT armed — Path B)
- Last completed: Phase 1 — Foundation Rails (docs + all 4 skills + state + secrets pre-staged)
- Next phase: Phase 2 — Drizzle + Neon. 🚦 **BLOCKED** on `DATABASE_URL` (Felix to provision a dedicated Critiq Neon DB).
- Cron: **UNARMED**. Rails are built; arming is deliberate and deferred until DB is provisioned + a dry-run passes.

---

## Phase 0 — Scaffold + Deploy ✅ Done (manual, pre-Full-Auto)

Scaffolded with `create-next-app`. Live on Vercel.

**Stack confirmed working:** Next.js 16.2.6 App Router · React 19.2.4 · TypeScript 5.9 · Tailwind 4 · Turbopack · pnpm 10.4.1

**Deploy URL (initial):** https://critiq2-2xb0gjsy8-fnavarro9289-4367s-projects.vercel.app

---

## Phase 1 — Foundation Rails ✅ Done (manual, pre-Full-Auto)

The Full Auto control plane.

**Built (manual + Path B rails session 2026-06-05 ~02:10 ET):**
- `docs/PHASE_LEDGER.md` (this file)
- `docs/CLAUDE.md`
- `docs/DECISIONS_LOG.md`
- `.critiq-full-auto-state`
- `~/.claude/skills/critiq-context/SKILL.md` ✅
- `~/.claude/skills/critiq-status/SKILL.md` ✅
- `~/.claude/skills/critiq-full-auto/SKILL.md` ✅ (written this session — master orchestrator, incl. env-readiness gate)
- `~/.claude/skills/critiq-merge/SKILL.md` ✅ (written this session — merge ceremony, review-for-main only)
- `review-for-main` branch
- `.claude/settings.json` already expanded for Full Auto permissions ✅
- Repo made **public** ✅ (so `/critiq-status` works anonymously from mobile)
- Secrets **pre-staged** in `.env.local` ✅ (Anthropic + Resend reused account-wide; AUTH_SECRET + CRON_SECRET fresh) — see DEC-002

**NOT done (deliberate, Path B):**
- ❌ Cron NOT armed (was planned for 3–6am ET; deferred until DB provisioned + dry-run)
- ❌ `DATABASE_URL` not provisioned — Felix's one task (blocks Phase 2+)

---

## Phase 2 — Drizzle + Neon + First Migration 🚦 Blocked (needs DATABASE_URL)

> **Unblock:** Felix creates a dedicated Critiq Neon project at console.neon.tech and pastes the pooled connection string into `.env.local` (line `DATABASE_URL=`) and Vercel env (`vercel env add DATABASE_URL`). Do NOT reuse a sibling DB. Once set, this phase is ready — the env-readiness gate in `/critiq-full-auto` re-checks live.

**Goal:** Database foundation. NextAuth-compatible schema. Lazy connection pattern. FKs + indexes from day one.

**Acceptance criteria:**
1. `pnpm add drizzle-orm @neondatabase/serverless drizzle-kit @types/pg`
2. `src/db/index.ts` — lazy ES proxy connection (mirrors DT pattern); `neon()` initialized with `fetchOptions: { cache: "no-store" }`
3. `src/db/schema.ts` — NextAuth v5 tables: `users`, `accounts`, `sessions`, `verification_tokens` (per the official `@auth/drizzle-adapter` schema)
4. `drizzle.config.ts` configured
5. `scripts/migrate.ts` — direct SQL migration runner via `@neondatabase/serverless` (NEVER `drizzle-kit push`)
6. README section documents env vars needed: `DATABASE_URL`, `DATABASE_URL_UNPOOLED`
7. `pnpm build` clean, `pnpm tsc --noEmit` clean
8. **Verification:** schema applies to a Neon dev branch successfully (verifier runs the migration script against a temporary branch)

**Notes:**
- Use Neon as the DB. Felix has an account.
- Phase 2 does NOT need to apply migrations to production. It only writes the schema + migration files. Application happens at deploy time.
- Critical pattern: `force-dynamic` on every API route that hits the DB. Document this in CLAUDE.md.

**Risk:** Phase 2 needs `DATABASE_URL` env var set in Vercel for preview deploy to actually build. If unset, preview build will fail. Mitigation: write code defensively so build succeeds even without DB connection (use proxy + lazy init).

**Depends on:** Phase 1

---

## Phase 3 — NextAuth v5 + Resend + Auth Pages ☐ Planned

**Goal:** Working auth flow. Email/password + magic link sign-in via Resend. `/login`, `/signup`, `/verify` pages. Sender from `notifications@critiq.firstlap.dev`.

**Acceptance criteria:**
1. `pnpm add next-auth@5 @auth/drizzle-adapter resend bcryptjs @types/bcryptjs`
2. `auth.ts` (root) — NextAuth v5 config with Drizzle adapter, email + credentials providers
3. `src/lib/email.ts` — Resend client with lazy init, `sendMagicLink()` function
4. `src/app/(auth)/login/page.tsx` — login form (email/password OR magic link)
5. `src/app/(auth)/signup/page.tsx` — signup form (name, email, password)
6. `src/app/(auth)/verify/page.tsx` — magic link verification landing
7. `src/app/api/auth/[...nextauth]/route.ts` — NextAuth route handlers
8. `middleware.ts` — protect non-public routes
9. `pnpm build` clean, `pnpm tsc --noEmit` clean
10. **Verification:** sign up with felix@firstlap.dev on preview → receive magic link email → click → land on dashboard placeholder. Verifier drives this end-to-end via Preview MCP.

**Notes:**
- Sender: `Critiq <notifications@critiq.firstlap.dev>` (domain verified in Resend tonight)
- Initial dashboard placeholder is just `<h1>Welcome, {name}</h1>` — real dashboard comes later
- Add Resend domain swap is NOT needed (verified pre-arming)

**Risk:** Resend rate limits on free tier. Mitigation: log + retry once on 429.

**Depends on:** Phase 2

---

## Phase 4 — Marketing Landing + Footer + Stub Legal ☐ Planned

**Goal:** Public-facing `/` page. Footer with stub Terms + Privacy links. Beta CTA. Sentry wired.

**Acceptance criteria:**
1. `src/app/page.tsx` — landing page with: headline ("AI sales coach that learns the rep"), 3-paragraph what-it-does explainer, "Join the beta" CTA → `/signup`
2. Footer: First Lap LLC copyright, Terms (stub) + Privacy (stub) + email contact
3. `src/app/(legal)/terms/page.tsx` — placeholder with "Coming soon" + email contact (full draft in Phase 30)
4. `src/app/(legal)/privacy/page.tsx` — same placeholder pattern
5. `pnpm add @sentry/nextjs` + Sentry setup with `next.config.mjs` wrapping
6. `instrumentation.ts` + `sentry.server.config.ts` + `sentry.edge.config.ts`
7. Global `src/app/error.tsx` + `src/app/global-error.tsx` with SW-style error UI
8. `pnpm build` clean, `pnpm tsc --noEmit` clean
9. **Verification:** preview URL `/` loads, looks professional, footer links work; throwing a test error captures to Sentry

**Notes:**
- Visual: clean, minimal, beta-vibe. Use shadcn `Button`, `Card`. Tailwind 4.
- Sentry DSN env var: `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`
- Defer Sentry source-map upload to a later phase

**Depends on:** Phase 3

---

## Phase 5 — Rate Limiting + Security Headers ☐ Planned

**Goal:** Postgres-based rate limiting (DT Phase 38b pattern). CSP, HSTS, security headers. Guards against abuse before any AI endpoint exists.

**Acceptance criteria:**
1. `src/lib/dbCounters.ts` — atomic INSERT...ON CONFLICT...RETURNING for counters (DT pattern)
2. `src/lib/rateLimit.ts` — `getAuthRateLimiter()` (5/min/IP), `getSignupRateLimiter()` (3/min/IP). Stub `getAiRateLimiter()` (20/min/user) for later phases.
3. Schema: `rate_limit_counters` table (bucket_key TEXT PK, count INTEGER, expires_at TIMESTAMP, updated_at TIMESTAMP) + index on expires_at
4. Migration applied
5. `next.config.mjs` headers: HSTS, CSP, X-Frame-Options DENY, X-Content-Type-Options, Referrer-Policy, Permissions-Policy (microphone self for later recording)
6. `src/app/api/auth/[...]/route.ts` — wrap signup + login routes with rate limit check
7. Rate-limited responses return 429 with `retryAfter` seconds
8. `pnpm build` clean, `pnpm tsc --noEmit` clean
9. **Verification:** preview — submit signup form 4 times in <60s → 4th attempt returns 429. Verifier scripts this.

**Notes:**
- Pattern: DT's Phase 38b (Postgres counters, no Upstash). Direct port.
- CSP allows: `connect-src` for Sentry, Vercel Analytics, Resend's tracking domain

**Depends on:** Phase 4

---

## Phase 6 — Rep Intake Assessment: Session 1 UI ☐ Planned

**Goal:** Progressive 6-dimension intake. Session 1 covers Identity & Motivation + Relationship Style. Schema, persistence, UI, navigation flow.

**Acceptance criteria:**
1. Schema: `rep_intake_responses` table (id, user_id FK, dimension TEXT, question_key TEXT, answer JSONB, created_at TIMESTAMP, updated_at TIMESTAMP) + unique index on (user_id, question_key)
2. Schema: `rep_intake_progress` table tracks % complete per dimension
3. Migration applied
4. `src/app/(app)/onboarding/page.tsx` — Session 1 intake intro: "Before Critiq can coach you, we need to know who you are. ~5 minutes."
5. `src/app/(app)/onboarding/identity/page.tsx` — Identity & Motivation questions (per PRD § 4): motivator-priority (radio: money/winning/freedom/recognition/impact/growth), legacy text
6. `src/app/(app)/onboarding/relationships/page.tsx` — Relationship Style questions: lead-or-listen (radio), second-meeting text
7. Submit → POST `/api/intake/session1` → persists to DB → redirects to dashboard
8. `src/app/(app)/dashboard/page.tsx` — placeholder: "Welcome, {firstName}. Your intake is 33% complete (2 of 6 dimensions)."
9. Authenticated users with incomplete intake redirected to `/onboarding`; completed users go to `/dashboard`
10. `pnpm build` clean, `pnpm tsc --noEmit` clean
11. **Verification:** sign up → intake intro → complete 2 dimensions → land on dashboard showing 33%. Verifier drives this end-to-end.

**Notes:**
- This is the morning test for Felix. By 6am he can: sign up via magic link, complete Session 1 intake, see his progress on the dashboard. Real working flow.
- Use shadcn `Form`, `RadioGroup`, `Textarea`, `Button`, `Progress`.
- Form validation: react-hook-form + zod (`pnpm add react-hook-form @hookform/resolvers zod`)
- DO NOT surface Life Context (Dimension 6) — that's delayed past week 1 per PRD assumption A-03

**Risk:** Form UX needs to feel like a conversation, not paperwork (per PRD § 9 ADOPTION risk). Use generous whitespace + warm copy.

**Depends on:** Phase 5

---

# === The phases below are scoped but NOT in tonight's test ===

## Phase 7 — Rep Intake: Extended Dimensions ☐ Planned

Sales Psychology + Operational Habits + Market Intelligence. Surfaced contextually after Session 1.

## Phase 8 — Rep Intake: Life Context (Delayed) ☐ Planned

After 1 week of use, surface Life Context dimension. Trust-gating logic.

## Phase 9 — Account Domain Model ☐ Planned

`accounts` table (shared single summary per Felix decision OQ-04 #2). `account_rep_joins`. `contacts`. `/accounts` list page (basic).

## Phase 10 — Account Intelligence Card UI ☐ Planned

Per-account view: behavioral profile, last interaction summary, current stage, cold-start learning indicator.

## Phase 11 — Recording Infrastructure: Layers 1-3 ☐ Planned

Wake Lock + Silent Audio + Media Session (branding-only metadata, NO "recording" text).

## Phase 12 — Recording Infrastructure: Layers 4-6 ☐ Planned

Chunked MediaRecorder + presigned Vercel Blob upload + IndexedDB triple persistence + page visibility.

## Phase 13 — Auto-Segmentation + Heartbeat + Tiered Recovery ☐ Planned

10-min rotation, 2s overlap, 5s chunks, heartbeat verification, tier 1-4 recovery.

## Phase 14 — Interruption Detection + Multi-Channel Notification ☐ Planned

`track.onended` + chime + tab title + Web Push (PWA-installed only) + in-app banner. Branding-only.

## Phase 15 — Deepgram Nova-3 Integration ☐ Planned

Multi-segment parallel transcription, concatenation, store transcripts.

## Phase 16 — Three-Pillar Scoring Engine ☐ Planned

SPIN/Voss/Navarro definitions in code, locked methodology block (cached prompt), Zod schemas, scoring prompt.

## Phase 17 — Anthropic Prompt Caching Wiring ☐ Planned

Cache locked methodology + rep intake. Verify hit rate.

## Phase 18 — Pre-Call Brief Flow ☐ Planned

`/accounts/[id]/pre-call`, rep narrates context, objective setting logic (rep-set 1-2 / Signal-recommended 3+).

## Phase 19 — Script Generation with Delivery Cues ☐ Planned

Pre-call script generation, inline emphasis/pacing/silence cues, style mode selection.

## Phase 20 — Post-Call Debrief: Reporter Mode ☐ Planned

`/calls/[id]/debrief` with guided observational prompts, text + voice input.

## Phase 21 — Coaching Output Layer ☐ Planned

Post-debrief coaching delivery, three-pillar score display, next-step recommendation.

## Phase 22 — Email Drafting ☐ Planned

Account-aware email draft generation, copy-to-clipboard + Send via Resend.

## Phase 23 — Semantic Memory: Account Consolidation ☐ Planned

Background job after every debrief, regenerates account running summary. Source attribution per fact.

## Phase 24 — Semantic Memory: Rep Consolidation ☐ Planned

Runs every 10 debriefs, regenerates rep running summary.

## Phase 25 — Working Memory Assembly ☐ Planned

Prompt builder loads rep + account + last 3 raw + rubric. Token budget enforcement per call.

## Phase 26 — Hallucination Guard ☐ Planned

Pre-output validator strips unsourced personal references. Conservative-mode defaults locked.

## Phase 27 — Cold-Start UX ☐ Planned

Per-account learning progress indicator. Onboarding expectation-setting ("~10 calls to personalize").

## Phase 28 — NY/NJ Consent Attestation ☐ Planned

Self-attestation flow before first recording. Audit log.

## Phase 29 — LogRocket + Sentry Hardening ☐ Planned

Session replay (Critiq excludes felix + bugs + demo accounts). Sentry alert rules for critical paths.

## Phase 30 — Privacy Policy + Terms of Service ☐ Planned

Drafted under First Lap LLC. Footer + signup acknowledgment. Beta-appropriate language.

## Phase 31 — Beta Sign-Up + Onboarding Email Sequence ☐ Planned

Public `/beta` sign-up form, manual approval queue, onboarding email sequence via Resend.

## Phase 32 — Pre-Launch Verification Sweep ☐ Planned

Drive every flow end-to-end. Document known limitations. Final test pass.

---

# What actually happened on 2026-06-05 (Path B)

The original plan was to arm cron firings at 3/4/5/6am ET to autobuild Phases 2–6.
During pre-flight, diligence found a hard blocker: **no Neon DB and no secrets existed
anywhere** (local, Vercel, or GitHub). An armed cron would have failed Phase 2 on the
first firing and produced zero phases. Felix chose **Path B**: build the rails, leave the
cron unarmed, provision the DB in the morning.

**Done this session:** repo public · `/critiq-full-auto` + `/critiq-merge` skills written ·
secrets pre-staged (Anthropic + Resend reused; AUTH_SECRET + CRON_SECRET generated) ·
umbrella PR opened · ledger/state corrected.

**To arm the real run (AM):**
1. Create a dedicated Critiq Neon project → paste `DATABASE_URL` into `.env.local` + Vercel.
2. (Recommended) `/critiq-full-auto` dry-run of Phase 2, supervised, to verify orchestration.
3. Arm the cron via `/schedule` (caveat: remote firings lack local Preview/Chrome MCP — the
   Verifier falls back to build+type+test+curl; confirm secrets reach the firing environment).

Phases 2–6 remain the foundation target. If a phase exceeds the 800k token cap it pauses and
the next session resumes.
