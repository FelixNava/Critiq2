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

- Last updated: 2026-06-09 ~00:35 ET (🟢 master merged — Phases 2–13 shipped to prod, verified live)
- Mode: Phases 2–5 **supervised (direct)**; Phase 6 **via /critiq-full-auto orchestrator (Gate-1 ✅)**; Phase 7 **autonomously via the scheduled-task cron (Gate-2 ✅)**; Phase 8 **live/supervised in-session**; Phases 9, 10 & 11 **autonomously via the hourly cron (`critiq-fullauto-9-10-11`)**; Phase 11a **interactive/supervised via /critiq-full-auto (Felix ran the device gate)**.
- Done: Phase 2 (DB) ✅, Phase 3 (auth) ✅, Phase 4 (landing) ✅, Phase 5 (rate-limit) ✅, Phase 6 (intake S1) ✅, Phase 7 (intake S2) ✅, Phase 8 (Life Context) ✅, Phase 9 (account domain) ✅, Phase 10 (account intelligence card) ✅, Phase 11 (recording layers 1-3) ✅, **Phase 11a (lock-screen audio fix) ✅** — recording stack **promoted `recording-staging` → `review-for-main`** (PR #13, merge d3060e5), **device-verified** (neutral "Critiq" lock-screen widget confirmed on iPhone 2026-06-06).
- Current phase: none. **🟢 Phases 2–13 SHIPPED to `master`** (PR #1, merge `3c2e198`, 2026-06-09, Felix's explicit command) — first real production deploy; **prod VERIFIED HEALTHY at `critiq2.vercel.app`** (200s on landing/login/signup, `/dashboard` 307 = auth runs, zero prod runtime errors). Prod fully provisioned (Felix added the Blob token; Claude added a fresh AUTH_SECRET + RESEND/AUTH_RESEND/EMAIL_FROM/ANTHROPIC/CRON). **Phase 14 ✅ BUILT by the headless cron → OPEN PR #18** (`recording-staging`), NOT merged — awaits Felix's iPhone device gate + VAPID keys to Vercel (DEC-028). ⚠️ Prod shares ONE Neon DB + Blob store with dev/preview → SEPARATE prod DB/store before real beta reps (memory `project_critiq_prelaunch_checks`; DEC-029).
- Next: **Phase 14 iPhone device gate** (Felix — chime / tab-flash / Web-Push / in-app banner on a real mic-grab, then recover-clears-all) → merge PR #18 to `recording-staging` → promote to `review-for-main` → `master`. Then Phase 15 (Deepgram — needs `DEEPGRAM_API_KEY`) + the waitlist (Phase 31).

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

## Phase 2 — Drizzle + Neon + First Migration ✅ Done (PR #2, merged to review-for-main 2026-06-05)

> Built + verified in a live supervised session. DB provisioned by Felix (dedicated Critiq Neon project). Schema applied + confirmed in Neon. PR: https://github.com/FelixNava/Critiq2/pull/2

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

## Phase 3 — NextAuth v5 + Resend + Auth Pages ✅ Done (PR #3, merged to review-for-main 2026-06-05)

> Verified locally vs real Neon + real Resend: credentials signup→login→protected dashboard, magic-link send→callback→session, middleware redirect. Vercel build green. PR: https://github.com/FelixNava/Critiq2/pull/3
> Note: NextAuth v5 runs on Next 16 via split edge/node config. `middleware.ts` → `proxy.ts` (Next 16). Preview deployments are Vercel-auth-protected (anon 401).

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

## Phase 4 — Marketing Landing + Footer + Stub Legal ✅ Done (PR #4, merged to review-for-main 2026-06-05)

> Landing + footer + legal stubs + branded error boundaries + Sentry (inert until DSN). Verified: build clean, pages render, preview green. Sentry source-map upload deferred (DEC-005). PR: https://github.com/FelixNava/Critiq2/pull/4

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

## Phase 5 — Rate Limiting + Security Headers ✅ Done (PR #5, merged to review-for-main 2026-06-05)

> Postgres counters (auth 5/min, signup 3/min, ai 20/min stub) + security headers (HSTS/CSP/frame/etc). Verified: 4th signup→429, headers present, build clean, preview green. CSP hardening (nonce) flagged for pre-launch. PR: https://github.com/FelixNava/Critiq2/pull/5

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

## Phase 6 — Rep Intake Assessment: Session 1 UI ✅ Done (PR #6, merged to review-for-main 2026-06-05)

> Built via /critiq-full-auto orchestrator (Gate-1). Identity + Relationship intake, /api/intake/session1, onboarding flow, dashboard 33% + gate. Verified end-to-end vs real Neon. PR: https://github.com/FelixNava/Critiq2/pull/6

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

## Phase 7 — Rep Intake: Extended Dimensions ✅ Done (PR #7, merged to review-for-main 2026-06-05, squash e93bce1)

> Built **autonomously via the scheduled-task cron (Gate-2)** — fresh session, orchestrator built directly (DEC-004 pattern: small, fully-specified phase) and verified independently by driving the app. Additive only — no migration, zero data-loss risk. Verified vs real Neon dev DB: 401 unauth, 400 (bad enum / missing field / oversized text), 200 valid → 83% (5/6), idempotent re-submit (5 dims / 10 rows, upsert in place), dashboard CTA present at 33% / hidden at 83%, S2 page renders. 2 P2 cleanup findings deferred (DEC-008). PR: https://github.com/FelixNava/Critiq2/pull/7

**Goal:** Session 2 of intake — extend the Phase 6 pattern to 3 more dimensions: **Sales Psychology**, **Operational Habits**, **Market Intelligence**. Reuse the existing intake infrastructure (do NOT rebuild it).

**Reuse from Phase 6 (do not duplicate):**
- `rep_intake_responses` + `rep_intake_progress` tables (no schema change needed — `dimension`/`question_key` are free text).
- `src/components/onboarding/RadioCardGroup.tsx`, `StepProgress.tsx`, `ui.ts`.
- `src/lib/intake.ts` (`INTAKE_DIMENSIONS` already includes `sales_psychology`, `operational_habits`, `market_intelligence`, `life_context`).
- The `/api/intake/session1` route as the pattern.

**Acceptance criteria:**
1. New API route `src/app/api/intake/session2/route.ts` (or generalize to `/api/intake/[session]`) — auth-gated, `force-dynamic`, enum + ≤2000-char validation, idempotent upserts into `rep_intake_responses` (ON CONFLICT (user_id, question_key)), and marks `rep_intake_progress` for the 3 dimensions. Mirror session1's validation + error shapes exactly.
2. Onboarding Session-2 pages under `src/app/(app)/onboarding/` — one screen per dimension (sales-psychology, operational-habits, market-intelligence), each with 1 radio (RadioCardGroup) + 1 optional textarea. Reuse the localStorage draft pattern (`critiq:intake:v1:s2:*`). Conversational copy, no dev jargon, no "Life Context" surfaced.
   - Sales Psychology: e.g. "When a deal stalls, what's your instinct?" (push / pause / diagnose) + a free-text.
   - Operational Habits: e.g. "How do you run your pipeline?" (crm-religiously / memory-and-notes / hybrid) + free-text.
   - Market Intelligence: e.g. "How do you keep an edge on your accounts' world?" (news-alerts / relationships / vendor-intel) + free-text. (Builder/Architect may refine the exact questions — keep them on-domain and rep-friendly.)
3. Entry point: from `/dashboard`, when Session 1 is complete but Session 2 isn't, show a "Continue your profile" CTA → Session 2 flow. (Don't force-redirect; Session 2 is optional/contextual per the spec.)
4. `src/lib/intake.ts`: add `isSession2Complete(progress)` (the 3 dims done). Dashboard progress now reflects up to 5 of 6 (83%) once Session 2 is done — keep the existing `getIntakeProgress` math (it already counts all completed dimensions / 6).
5. Dashboard copy updates to reflect current `progress.percent` dynamically (already dynamic from Phase 6 — just ensure the CTA appears/disappears correctly).
6. `pnpm build` + `pnpm typecheck` clean. No new dependencies (match Phase 6: plain Tailwind, plain validation).
7. **Verification:** complete a fresh account through Session 1 then Session 2 → dashboard shows 83% (5 of 6); `rep_intake_responses` has the new rows; idempotent on re-submit. (Cron/headless: build + typecheck + curl the API for 401/400/200; if MCP available, drive the flow.)

**Notes:** life_context (6th dimension) remains NOT surfaced (Phase 8, trust-gated). Additive only — zero data-loss risk.

**Depends on:** Phase 6.

## Phase 8 — Rep Intake: Life Context (Delayed) ✅ Done (PR #8, merged to review-for-main 2026-06-05, squash 4c57c25)

> Built live/supervised in-session; Felix-approved merge. Adds the 6th intake dimension behind a time-based trust-gate. Verified end-to-end via Chrome/Preview MCP vs real Neon dev DB. Additive — zero schema change, zero data-loss risk. PR: https://github.com/FelixNava/Critiq2/pull/8

**Built:**
- Trust-gate in `src/lib/intake.ts`: Life Context unlocks `LIFE_CONTEXT_GATE_DAYS` (default 7, env-overridable, fail-safe to 7 on blank/garbage) days after `users.createdAt`. No call/debrief "use" events exist yet (Phases 18–22), so the gate keys off account age; structured so a later phase can swap the anchor to real activity without changing callers (DEC-010).
- Enforced server-side: `/onboarding/life-context` (server page) redirects when locked / out-of-sequence; `/api/intake/life-context` returns 403 (locked) / 409 (Session 1–2 incomplete). The API is the real boundary, not just the UI.
- New: `/api/intake/life-context`, `src/components/onboarding/LifeContextForm.tsx`, `src/app/(app)/onboarding/life-context/page.tsx`.
- Dashboard: locked ("One last piece, a little later" + unlock date) / unlocked ("One more thing") / complete (6/6) states.
- Cleanup: hoisted shared `freeText` into `src/lib/intake.ts` (resolves DEC-008 P2-a; session1/session2/life-context share one copy → DEC-011).
- Code review (3 finder agents): F1 (blank-env fail-safe), F2 (API session-order 409 guard), F4 (dedupe unlock check) fixed + re-verified; F3 (server-TZ date label) deferred (DEC-012).

**Verified (live, Chrome/Preview MCP vs real Neon dev DB):** locked → 403 + redirect + dashboard card w/ correct date; backdate `created_at` → unlocked → form → 100%; idempotent re-submit (no dup rows); out-of-order → 409; freeText hoist regression (400/200). Vercel preview READY (auth-protected).

**Depends on:** Phase 7.

## Phase 9 — Account Domain Model ✅ Done (PR #9, merged to review-for-main 2026-06-05, squash eaa72e9)

> Built autonomously via the hourly cron (`critiq-fullauto-9-10-11`). Additive — zero data-loss risk. **UI NOT driven via Chrome MCP (headless cron) → `UI_VERIFY_PENDING=9`**; verified at build/typecheck/data-layer/HTTP-boundary level only.

**Built:**
- Schema (migration 0003, applied to Neon — additive):
  - `account_records` (export `accountsTbl`) — the SHARED, first-class account: `name`, `stage`, shared `summary` (null until later AI intelligence phase, per OQ-04 #2), `createdBy` (provenance, SET NULL on user delete — account outlives any rep because it's shared), soft-deleted via `deletedAt`. Named `account_records` to avoid colliding with the existing NextAuth `accounts` table (DEC-015).
  - `account_rep_joins` — M:N rep↔account assignment (composite PK `(account_id,user_id)`, `role` owner/collaborator). The reassignment surface for **full inheritance on rep transitions** — the shared account summary stays put.
  - `contacts` — account-scoped people (name/title/email/phone/notes/isPrimary), soft-deleted.
- `src/lib/accounts.ts` — `ACCOUNT_STAGES` (prospecting/active/at_risk/won/dormant, DEC-016), `listAccountsForUser` (joins via assignments, counts non-deleted contacts, omits large `summary`), `createAccountForUser` (atomic via `db.batch` — neon-http has no interactive transaction).
- `/accounts` list page (basic, empty state + stage badges) + `/accounts/new` create form + `/api/accounts` POST (auth-gated, validated). Account creation added even though the ledger only named the list — the list is unusable/unverifiable without a way to create accounts and no earlier phase adds it (DEC-014).
- `AppHeader` shared signed-in header; dashboard refactored to consume it (removed duplicated inline header) + links to `/accounts`.
- Code review (medium, 2 finder agents + verify): the known Drizzle bare-column correlated-subquery gotcha was verified NOT to apply (table-qualified in drizzle 0.45.2). Fixed: non-atomic create → `db.batch`; header duplication → consume `AppHeader`; list select pulled unused `summary` → trimmed; swallowed create error → logged.

**Verified:** `pnpm build` + `tsc --noEmit` clean. `scripts/verify-phase9.ts` drives the REAL helpers vs Neon dev DB (empty→create 2→owner role+stage+contactCount 0→join rows→soft-delete excluded→cleanup, all ✓). HTTP: unauth POST `/api/accounts`→401, unauth GET `/accounts`→307→login. Vercel preview READY. **NOT human/MCP UI-driven (headless) — `UI_VERIFY_PENDING=9`.**

**Depends on:** Phase 8.

## Phase 10 — Account Intelligence Card UI ✅ Done (PR #10, merged to review-for-main 2026-06-05, squash c3b7b6f)

> Built autonomously via the hourly cron (`critiq-fullauto-9-10-11`). Additive — zero schema change, zero data-loss risk. **UI NOT driven via Chrome MCP (headless cron) → `UI_VERIFY_PENDING=9,10`**; verified at build/typecheck/data-layer/HTTP-boundary level only.

Per-account view: behavioral profile, last interaction summary, current stage, cold-start learning indicator.

**Built:**
- `src/lib/accounts.ts`: `getAccountForUser(userId, accountId)` — fetches one account **only if the rep is assigned** to it (inner join on `account_rep_joins` is the access boundary; a guessed/foreign id → null). Excludes soft-deleted accounts; returns the shared `summary` + non-deleted contacts (primary first, then alphabetical). `getLearningProgress(loggedCalls)` cold-start model (~10-call target, clamped 0–100, NaN/negatives fail safe to 0); `loggedCalls` is `0` at this build stage (no interaction data until the recording/debrief phases) — taken as an argument so a later phase wires the real count without touching callers (DEC-018).
- `src/app/(app)/accounts/[id]/page.tsx` — the intelligence card: title + `StageBadge`, learning progress bar (a11y `role=progressbar`), "What Critiq knows" (summary or cold-start), "Last interaction" + "How they buy" cold-start placeholders, contacts list (or empty state).
- `src/app/(app)/accounts/[id]/not-found.tsx` — in-app empty state for missing/deleted/unassigned accounts (instead of Next's bare default 404).
- `src/components/accounts/StageBadge.tsx` — shared stage pill extracted from the list page; color map `satisfies Record<AccountStage,string>` (a new stage without a color is a compile error). Accounts-list rows now `Link` into the detail view.
- Code review (high effort, 2 finder agents + verify): **no P0/P1**. Applied 2 P2 hardenings (exhaustive badge map; styled not-found). Frozen-at-0% progress bar is the documented intentional cold-start state, not a regression.

**Verified:** `pnpm build` + `tsc --noEmit` clean. `scripts/verify-phase10.ts` drives the REAL helpers vs Neon dev DB — **14/14**: detail fetch, **access boundary** (unassigned rep → null), unknown id → null, contact ordering, cold-start model (0/5/12/NaN), soft-delete exclusion. HTTP: unauth `GET /accounts/[id]` → 307 → /login. Vercel preview READY (anon 401 = expected auth gate). **NOT human/MCP UI-driven (headless) — `UI_VERIFY_PENDING=9,10`.**

**Depends on:** Phase 9.

## Phase 11 — Recording Infrastructure: Layers 1-3 ✅ Done + device-verified, promoted to `review-for-main` (PR #11 → recording-staging; promoted via PR #13, merge d3060e5, 2026-06-06)

> Built autonomously via the hourly cron (`critiq-fullauto-9-10-11`) — its terminal phase. **Merged to the `recording-staging` epic branch, NOT `review-for-main`** (recording stack is promoted to review-for-main later as ONE human-reviewed PR after on-device verification). Client-side only — no DB, no Blob, no new env; additive, zero data-loss risk. **UI NOT driven (headless cron, browser-media) → `UI_VERIFY_PENDING=11`** — Wake Lock / audio keep-alive / lock-screen branding only manifest on a real device.

Wake Lock + Silent Audio + Media Session (branding-only metadata, NO "recording" text).

**Built:**
- Session keep-alive seam over three independent, feature-detected layers a later recorder phase (12) turns on/off around capture. **No audio capture here** — only keeps the page/session alive around it.
  - **L1 `WakeLockController`** (`src/lib/recording/wakeLock.ts`) — screen wake lock; re-acquires on `visibilitychange` (platform auto-releases when hidden). Releases an orphaned sentinel if `stop()` races an in-flight `request()` (no unreleasable lock / battery drain); `stop()` preserves an `error` status so the device check can reveal a device that can't hold a lock.
  - **L2 `SilentAudioController`** (`src/lib/recording/silentAudio.ts`) — zero-gain oscillator through an `AudioContext` to resist background-tab throttling; `onstatechange` reflects OS suspend/resume so status can't go stale. (Active re-resume + heartbeat recovery is Phase 13.) **→ SUPERSEDED by Phase 11a:** the oscillator surfaced no iOS lock-screen widget and suspended on lock; L2 was rebuilt as a looping silent `<audio>` element (see Phase 11a below).
  - **L3 `MediaSessionController`** (`src/lib/recording/mediaSession.ts`) — **BRANDING ONLY** lock-screen presence; deliberately no "recording"/"call"/"capture" language (locked privacy decision); reports `error` honestly if metadata never applied.
  - **`SessionKeepAlive`** unifies them behind one `start()`/`stop()`; `active` + per-layer health flow through a single push channel (no second source of truth). `useSessionKeepAlive()` hook mirrors it + tears down on unmount.
- `/recording-check` — gated device-check surface for supervised on-device verification (not wired into the main flow yet; reachable by URL).
- `Permissions-Policy` gains `screen-wake-lock=(self)`; `/recording-check` added to middleware `PROTECTED_PREFIXES`.
- Code review (high effort, 2 finder agents + verify): fixed wake-lock start/stop leak, `stop()` erasing `error`, MediaSession false-`active`-on-failure, silent-audio stale-status + null-deref race, `active` folded into the single state channel. No outstanding P0/P1 (DEC-019/020).

**Verified (headless — honest scope):** `pnpm build` + `tsc --noEmit` clean (`/recording-check` registered dynamic `ƒ`). HTTP boundary: unauth `GET /recording-check` → 307 → /login. `Permissions-Policy: … screen-wake-lock=(self)` present; `/` still 200. **NOT driven via Chrome/Preview MCP (headless) — `UI_VERIFY_PENDING=11`; the on-device drive is the joint-verification gate before the recording stack is promoted to review-for-main.**

**Depends on:** Phase 10.

## Phase 11a — Lock-screen audio fix (L2 → looping `<audio>`) ✅ Done + device-verified (promoted to `review-for-main` via PR #13, 2026-06-06)

> The Phase 11 on-device gate (2/3) found L3's neutral "Critiq" lock-screen branding never appeared on iPhone. Root cause: L2's Web Audio oscillator — iOS doesn't treat Web Audio as media, so it surfaces no Now-Playing widget and suspends on lock. L2 rebuilt + a preview-only CSP blocker fixed. PR #12 → `recording-staging` (squash 596b6ac), then `recording-staging` promoted → `review-for-main` (PR #13, merge d3060e5). **Device-verified on iPhone — the neutral "Critiq" widget is present.** DEC-021/022.

**Built:**
- `src/lib/recording/silentAudio.ts` rewritten: L2 now drives a looping, **non-muted**, fully-silent `<audio>` element (runtime 16-bit PCM WAV via `DataView` → `Blob` → `createObjectURL`) instead of the zero-gain oscillator. A real media element → iOS surfaces the neutral "Critiq" lock-screen widget (L3 attaches to it) AND a sturdier locked-screen background audio session. **SAME public interface** (`SilentAudioStatus` / `isSilentAudioSupported` / `SilentAudioController.start/stop/getStatus`) → `sessionKeepAlive` / `useSessionKeepAlive` / `DeviceCheckPanel` untouched. Element attached to the DOM while live (iOS elects in-document media for the widget) + removed on `stop()`; status mapped from media events; `play()` failures classified `NotAllowedError`→`suspended` (recoverable) vs everything else→`error` (terminal), and a paused element that has an `error` reports `error` not `suspended`. `mediaSession.ts` (L3) unchanged.
- `next.config.ts`: added `media-src 'self' blob:` to the CSP. The blob audio was rejected by the `default-src 'self'` fallback (MediaError 4, "Media load rejected by URL safety check") — a **preview-only** bug invisible to local verification (CSP response headers don't apply to the dev server), caught by driving `/recording-check` on the real preview via Chrome MCP.
- Code review (high effort, 3 finder agents): DOM-attach for iOS reliability, terminal-vs-recoverable status classification, single-predicate cleanup — all applied; `playsInline` (video-only) and the pre-existing inert-retry correctly scoped out.

**Verified:** `pnpm typecheck` + `pnpm build` clean (re-confirmed on `review-for-main` post-promotion). Desktop drive (Chrome MCP, real preview, signed in): `<audio>` created/in-DOM/non-muted/`loop`/blob, `play()` accepted (user-activation OK), **CSP error gone (`errorCode` 4 → null)**, media session "Critiq"/playing, clean teardown (element removed, session cleared), no app-origin console errors. (Sustained playback itself is unobservable in the hidden MCP tab — Chrome throttles media when `visibilityState: hidden`, the same artifact that makes Wake Lock read "Off".) **🎉 iPhone device gate PASSED:** neutral "Critiq" lock-screen widget present; keep-alive held green across app switches.

**Known follow-up (pre-existing, NOT introduced here):** on `/recording-check`, a `suspended` status shows "Tap start again" while the panel is in its `Stop check` state — the retry is inert until Stop→Start (`SessionKeepAlive.start()` early-returns while active). Pre-existing Phase 11 `DeviceCheckPanel` behavior; low priority, flagged for whoever touches that panel next.

**Depends on:** Phase 11.

## Phase 12 — Recording Infrastructure: Layers 4-6 ✅ Done — built + DEVICE-VERIFIED + merged to `recording-staging` (PR #14, c7cb620) + PROMOTED to `review-for-main` (PR #15, merge 1503a6f, 2026-06-08)

> **✅ SHIPPED 2026-06-07 (interactive `/critiq-full-auto` + `/critiq-merge`).** Built per the spec below; migration 0004 applied to dev Neon. High-effort 5-finder review — two preview-only blockers fixed + verified against the installed `@vercel/blob` source: CSP upload host `https://vercel.com` (the client uploads to `vercel.com/api/blob`, NOT `*.vercel-storage.com`) and `audio/*` content-type (Vercel rejects `audio/webm;codecs=opus` vs a bare `audio/webm`). **Device gate PASSED on iPhone** — capture, keep-alive across app switches, and offline-capture-then-recover-on-reconnect (no stranded clips). Two device-gate fixes: **`access:private`** (`critiq2-blob` is a Private store — DEC-024) and **iOS offline recovery** (drain on every chunk + visibilitychange — DEC-025); plus the authenticated **client-confirm** chunk-row writer (DEC-023). **Merged to `recording-staging`; promotion to `review-for-main` is the open follow-up PR (Felix-reviewed, like PR #13 for 11/11a).** Original plan (still the spec of record) below.

**Goal:** Turn the Phase 11 keep-alive seam into an actual recorder — capture audio, chunk it, triple-persist each chunk (IndexedDB + Vercel Blob + retry queue) with metadata. This is the episodic-memory raw-capture layer (locked memory architecture: raw interactions stored forever in Postgres + Vercel Blob).

**Scope — IN (Layers 4-6):**
- L4: chunked `MediaRecorder` (getUserMedia(audio) → timeslice ≈ 5s chunks).
- L5: presigned **Vercel Blob** upload — `@vercel/blob` client `upload()` + a server `handleUpload` route (presigned client upload, NOT server-proxied `put()` — bypasses the Vercel ~4.5MB function-body limit + the function hop).
- L6: **IndexedDB triple-persistence** + retry queue (chunk → IndexedDB first → Blob upload → confirm/evict; failures retry from IndexedDB).
- Page-visibility handling; tie the recorder lifetime to the Phase 11 `SessionKeepAlive`.
- A **dev surface** (`/recording-lab`) to exercise it (Start/Stop, live chunk count + per-chunk status).

**Scope — EXPLICITLY DEFERRED (do NOT build here):** 10-min rotation + 2s overlap + heartbeat + Tier 1-4 recovery → **Phase 13**. Interruption detection + chime/tab-flash/Web Push/banner → **Phase 14**. Real rep call UX → **Phases 18-22**. NY/NJ consent attestation → **Phase 28** (so Phase 12 is a dev/test surface ONLY — never wired into a real rep call flow before 28).

**Locked decisions (Felix-approved 2026-06-06):**
- D1 — single continuous segment, 5s chunks (timeslice); rotation/overlap is Phase 13.
- D2 — add the two metadata tables now (episodic model + FKs-from-day-one).
- D3 — new `/recording-lab` dev page; keep `/recording-check` as the pure keep-alive device check.
- D4 — use the `idb` wrapper for IndexedDB.
- D5 — dev surface only, no real reps (consent is Phase 28).
- D6 — keep a chunk in IndexedDB until its Blob upload is confirmed, then evict; retry queue = the un-confirmed set.
- D7 — `account_id` nullable for now (standalone dev recordings); real linkage in the call-flow phases.

**Schema (migration 0004, additive, direct SQL via `@neondatabase/serverless` — NEVER `drizzle-kit push`):**
- `recordings`: id, user_id FK→users, account_id FK→account_records (nullable, SET NULL), status (recording|completed|failed|aborted), started_at, ended_at (null), duration_ms (null), chunk_count (int default 0), deleted_at (soft-delete), created_at, updated_at. Index on user_id.
- `recording_chunks`: id, recording_id FK→recordings (cascade), chunk_index (int), blob_pathname (text), blob_url (text), size_bytes (int), duration_ms (int null), status (pending|uploaded|failed), uploaded_at (null), created_at. UNIQUE (recording_id, chunk_index); index on recording_id.

**API routes (auth-gated, `force-dynamic`):**
- `POST /api/recording/start` → create a `recordings` row (status=recording) → `{ recordingId }`.
- `POST /api/recording/blob-upload` → `@vercel/blob` `handleUpload`: auth-gate; scope the client token to `recordings/{userId}/{recordingId}/`; `onUploadCompleted` → upsert the `recording_chunks` row (status=uploaded). (NOTE: `onUploadCompleted` fires only on a deployed preview, not localhost.)
- `POST /api/recording/complete` → mark `recordings` completed (+ ended_at, duration_ms, chunk_count).

**Client modules (`src/lib/recording/`):** `recorder.ts` (MediaRecorder wrapper; codec feature-detect — webm/opus Chrome, mp4/aac Safari), `chunkStore.ts` (IndexedDB via `idb`: put / mark-uploaded / evict-on-confirm / list-pending), `uploader.ts` (persist→`upload()`→confirm/evict; retry pending on failure/reconnect). Reuse `SessionKeepAlive` (start on record-start, stop on record-stop).

**UI:** `src/app/(app)/recording-lab/page.tsx` + a client panel — gated like `/recording-check`; mic-permission prompt; Start/Stop; live chunk count + per-chunk upload status; clear "test surface, not a real call" framing (no dev jargon in copy).

**Deps:** `pnpm add @vercel/blob idb`.

**Acceptance criteria:**
1. `pnpm build` + `tsc --noEmit` clean; new deps install.
2. Migration 0004 applied to Neon (additive; zero data-loss risk).
3. Unit tests for `chunkStore` + `uploader` retry logic using SYNTHETIC blobs — import the REAL functions, never re-implement.
4. **On the preview** (token present): record a short clip → chunks appear in the blob store (verify via the Blob API) + `recording_chunks` rows in Neon (status=uploaded) + IndexedDB holds-then-evicts + a forced-upload-failure retries and recovers. Unauth routes → 401/redirect.
5. Client interactions verified on the **preview** (not `127.0.0.1`).

**Verification caveats (honest):** actual mic capture can't be fully automated via Chrome MCP (needs real mic input + a permission grant) → real-capture verification is an **on-device gate (Felix)**, like Phase 11; the assistant verifies the upload/persistence/retry plumbing + DB/Blob/IndexedDB results. `onUploadCompleted` only fires on deployed previews.

**Pre-launch reminders (NOT this phase):** add **Production** scope to `BLOB_READ_WRITE_TOKEN` + a **separate preview blob store** (or strict path prefix) before beta launch, so test recordings don't mix with real prod audio.

**Branch/target:** `phase-12/recording-layers-4-6` OFF `recording-staging` → PR `--base recording-staging`. Promotion to review-for-main later (after the device gate).

**Depends on:** Phase 11 + 11a (keep-alive) + `BLOB_READ_WRITE_TOKEN` (provisioned ✅).

## Phase 13 — Auto-Segmentation + Heartbeat + Tiered Recovery ✅ Done — device-verified + merged to `recording-staging` (PR #16) + promoted to `review-for-main` (PR #17, merge 0fa2d78), 2026-06-08

10-min rotation, 2s overlap, 5s chunks, heartbeat verification, tier 1-4 recovery.

> **DONE + DEVICE-VERIFIED 2026-06-08 (interactive `/critiq-full-auto`).** Built on `phase-13/...` → PR #16 (squash 905d35f) into `recording-staging`, then promoted to `review-for-main` via PR #17 (merge 0fa2d78). `review-for-main` now holds Phases 2–13. `master` untouched (paused on prod provisioning).
>
> **What shipped:**
> - `src/lib/recording/segmentedRecorder.ts` — `SegmentedRecorder`: ONE shared mic stream + rotating MediaRecorders; a new segment starts `OVERLAP_MS` (2s) before the previous stops → zero audio gap; 5s heartbeat; Tier 1-4 recovery (restart recorder → re-acquire stream → re-prompt mic → notify+save+stop); 75-min hard cap. Timers + media engine injectable.
> - `segment_index` persisted: migration **0005** (additive, `ADD COLUMN segment_index integer DEFAULT 0 NOT NULL`, applied to dev Neon) + threaded chunk → IndexedDB (`chunkStore`) → confirm route → `recordChunkUploaded`, and through the Blob `onUploadCompleted` token (so the prod backup writer can't clobber it to 0).
> - `src/lib/recording/recovery.ts` — resume-after-tab-kill: on mount drain orphaned IndexedDB chunks; only finalize on a full drain; `MAX_UPLOAD_ATTEMPTS` cap so a permanently-failing chunk can't loop forever.
> - `useRecorder` rewired to `SegmentedRecorder` (+ segment/heartbeat/recovery state, orphan-recovery on mount, autoStop finalize). `RecordingLabPanel` surfaces segment / capture heartbeat / recovery tier+events / recovered note. `AudioRecorder` removed (superseded).
>
> **Verified (no device):** `pnpm build` + `tsc` clean · `pnpm tsx scripts/verify-phase13.ts` **31/31** (fake clock + fake media: rotation/overlap/tagging, hard cap, heartbeat fault detection, full Tier 1→4 escalation + recovery, orphan recovery) · verify-phase12 17/17 · preview READY · high-effort code review (4 finder angles) → 7 correctness fixes (recovery races, prod-only segment_index clobber, orphan loop) + 2 trivial. DEC-027.
>
> **✅ Device gate PASSED (Felix, desktop + iPhone) 2026-06-08.** Session `8eb5e643` DB-verified: 112/112 chunks `uploaded`, contiguous 0–111, **`segment_index` {0:111, 1:1}** = a real ~10-min recording that crossed the rotation boundary into Part 2 with zero audio loss; `recordings.status=completed`, `chunk_count` (112) matches the rows. Segmentation proven end-to-end (not just in the UI).
>
> **Deferred (logged):** panel↔DeviceCheckPanel badge dedup (next panel phase); a late chunk from a stopped recorder can mask a stall one beat; stop-during-start no-op; per-chunk IndexedDB scan micro-opt.

## Phase 14 — Interruption Detection + Notification + Capture-Coverage Integrity ✅ DONE (device-verified 2026-06-18; PR #18 squash c517ce7 → recording-staging → review-for-main)

> **Added this session (interactive, 2026-06-18), beyond the original cron build — see DEC-030:** **capture-coverage integrity** (the device gate found iOS silently drops audio when a PWA backgrounds/locks — `gap_ms`/`gap_count` + migration 0007 + the "only X% captured" warning), **honest phone repositioning** (foreground+screen-on only; lock-screen push reframed best-effort), and the **Tier-4 lost-mic prompt** (keep/discard, never auto-kill, auto-resume). Coverage device-verified on session `b47ea693` (~91%).

`track.onended` + chime + tab title + Web Push (PWA-installed only) + in-app banner. Branding-only.

**BUILT 2026-06-08 (headless Full Auto cron) → OPEN PR [#18](https://github.com/FelixNava/Critiq2/pull/18) (base `recording-staging`). NOT merged — awaits Felix's iPhone device gate (recording phase; never auto-merged).**

**What shipped:**
- `src/lib/recording/interruption.ts` — pure `deriveInterrupted()` predicate + injectable `InterruptionMonitor` state machine (armed-after-recording; `trackEnded` latch bridges the ≤5s heartbeat gap; idempotent raise/clear). Derives "interrupted" from Phase 13 signals: status `error`, or `recovering` with `heartbeat.trackLive===false` (a live-track Tier-1 hiccup is intentionally NOT alerted).
- `SegmentedRecorder` gained an OPTIONAL `onTrackEnded` callback + `MicStream.onEnded?` seam (wired in `start()` + the Tier-2/3 re-acquire) for immediate detection. Optional ⇒ Phase 13 fake-engine tests untouched; the heartbeat stays the reliable fallback.
- Four channels: **chime** (`chime.ts`, Web Audio, singleton AudioContext unlocked in the Start gesture), **tab-title flash** (`tabTitle.ts`, `⚠ Critiq needs you`, BRANDING-ONLY), **Web Push** (`public/sw.js` SW + VAPID + `push_subscriptions` table mig 0006 + routes `vapid`/`subscribe`/`unsubscribe`/`notify` + `lib/push/{webpush,subscriptions}.ts`, BRANDING-ONLY payload), **in-app banner** (`RecordingLabPanel` + `usePushAlerts` opt-in).
- PWA install: `manifest.webmanifest` + PNG icons + apple-touch-icon + layout metadata (unlocks iOS Web Push).
- **Privacy contract met:** every lock-screen/notification surface is branding-only — never "recording", never call content (unit-asserted).

**Verification (headless = baseline only):** `pnpm build` + `tsc` clean; `scripts/verify-phase14.ts` 32/32; `verify-phase13.ts` still green; mig 0006 applied to dev Neon (additive). `/code-review` high-effort run — P1s fixed (chime gesture-unlock+leak, push hot-path gate, VAPID rotation-safety, `/notify` cross-site guard), P2s deferred (trackEnded re-edge flap ≤5s self-correcting; lock-screen notification lingers after auto-recovery; tab-title stale-original on concurrent title change).

**Felix to do:** add VAPID keys to Vercel (PR #18 body); run the iPhone device gate; then merge → `recording-staging` → promote to `review-for-main`. See DEC-028.

## Phase 15 — Deepgram Nova-3 Integration ✅ DONE (review-for-main, PR #20, squash 0dfa45d)

Multi-segment parallel transcription, concatenation, store transcripts.

**Built 2026-06-18 (aggressive-auto, relaxed gate).** Tables `recording_transcripts` (one/recording, the unified transcript) + `transcript_segments` (one/~10-min segment, `words` jsonb = Deepgram word timestamps + speaker labels) — migrations 0008 (tables) + 0009 (attempts cap), additive, applied to dev Neon. Fetch-based Deepgram client (no SDK; `nova-3` + `smart_format` + `diarize` + `punctuate`; pure `buildListenUrl`/`parseDeepgramResponse`). Pure orchestration (Option B): group chunks by segment → concat each segment's chunks → bounded-parallel transcribe → concat segment transcripts in segment order; partial-failure tolerant. Store: idempotent **compare-and-swap claim**, per-segment upsert, finalize/fail, cron work-list with **attempts cap (3)**; `partial` is a distinct status from `failed`. Routes: `POST /api/recording/[id]/transcribe` (auth+owner, sync), `GET …/transcript`, `POST /api/cron/transcribe` (CRON_SECRET, `*/10` in vercel.json — reliability net). Lab UI transcript affordance (flagged).

**Verification (relaxed gate, all green):** build + tsc clean; `scripts/verify-phase15.ts` 37/37 (URL/parse/grouping/concat/ordering/bounded-parallel/partial/empty); real-Postgres integration probe 12/12 (CAS claim, jsonb persist, attempts, idempotent skip, cron in/exclusion, throwaway user cascade-cleaned). High-effort `/code-review` → P1s fixed in-branch (infinite re-transcribe loop, claim race, partial contradiction).

**FLAGGED for Felix (runtime/quality, not blocking staging):** (1) real Deepgram round-trip + private-Blob byte read needs a preview run (probes fake both); (2) transcription QUALITY on field-noise audio + diarization usefulness — validate before Phase 16 depends on it; (3) overlap (~2s seam) not text-deduped for beta; only `uploaded` chunks transcribed (gap/coverage already discloses holey captures); (4) lab UI is dev-surface. See DEC-030.

## Phase 16 — Three-Pillar Scoring Engine ✅ DONE (review-for-main, PR #21, squash f1fc1ac)

The value engine's second half: a completed/partial transcript (Phase 15) → a bounded, evidence-grounded 100-point evaluation. First Anthropic-API phase (fetch-based, **no SDK** — mirrors the Phase 15 Deepgram client).

**The locked rubric (`src/lib/scoring/rubric.ts` — SINGLE SOURCE OF TRUTH for prompt + schema + math + DB):** SPIN 35 · Voss 35 · Navarro 30 = 100. 12 sub-dimensions:
- SPIN: Situation 5 · Problem 10 · Implication 10 · Need-Payoff 10
- Voss: Mirroring 7 · Labeling 7 · Calibrated Questions 8 · Tactical Empathy 7 · Silence & Pacing 6
- Navarro: Genuine Curiosity 10 · Long-Term Orientation 10 · Territory Command 10
- `assertRubricIntegrity()` runs at import → a bad weight is a build/test failure, not a skewed score.

**Engine (pure, dependency-injected like Phase 15):** `prompt.ts` (locked methodology system block + per-call user transcript + rubric-derived JSON output contract), `anthropic.ts` (fetch `AnthropicScorer`, `claude-sonnet-4-6`, adaptive thinking, `cache_control` breakpoint on the methodology block, defensive JSON extraction), `score.ts` (`aggregateRawScore`: **clamps every sub-dimension to [0, max]** so a hallucinated 99/10 can't corrupt the stored number, then sums pillars + overall; flags `partialJudgement` if the model omits a dimension). `store.ts` + `runner.ts` mirror the transcription store/runner exactly (CAS claim, attempts cap 3, partial-tolerant, cron sweeper).

**Evidence grounding (sets up Phase 26):** every sub-dimension carries verbatim transcript quotes; the prompt forbids evidence-free credit ("the cardinal sin"). Absent skill → score 0 + empty evidence array, never a fabricated quote.

**DB:** `call_scores` (one/recording, UNIQUE recording_id; overall + pillar columns + `dimensions` jsonb + strengths/improvements/summary + partial_judgement) — **migration 0010**, additive, applied to dev Neon. FK cascades on recording delete.

**Routes:** `POST /api/recording/[id]/score` (auth+owner, sync, maxDuration 300), `GET …/score`, `POST /api/cron/score` (CRON_SECRET, `2-59/10` in vercel.json — offset 2 min after the transcribe sweeper so scoring runs once the transcript lands).

**Model note:** `claude-sonnet-4-6` per the locked tech-stack ("Anthropic Claude Sonnet 4.x" for scoring/coaching/summaries) — the established plan governs over the generic opus default. **No structured outputs:** the 12-dim + evidence schema overflows the API's strict-grammar limit ("compiled grammar is too large"), so the JSON shape is specified in the prompt (rubric-derived) and parsed defensively; Sonnet 4.6 + the explicit contract returned clean JSON on every probe run.

**Verify (relaxed gate, all green):** build + tsc clean; `verify-phase16.ts` 60/60 (rubric integrity, prompt/schema, refusal/truncation/fence-tolerant parsing, clamp/aggregate/partial math, end-to-end with a fake scorer); throwaway real-Postgres + **real Claude** probe 16/16 (CAS, work-list in/exclusion, persistence, cascade cleanup, AND a real `claude-sonnet-4-6` round-trip on a realistic SW-rep↔contractor transcript → discriminating, fully evidence-cited 58/100). See DEC-031.

**NO UI** this phase (engine + API only) → no /design-critique pass needed; the score-display surface is Phase 20/21 (debrief reporter + coaching output).

**FLAGGED for Felix + the expert coach (quality, not blocking the relaxed gate):** (1) the RUBRIC weights/sub-dimensions + the scoring PROMPT need expert validation before reps see scores; (2) scoring QUALITY/calibration on real field audio (the sample is strong but is one short transcript); (3) text-only transcripts can't verify true silence/pacing — Voss "Silence & Pacing" is structurally under-evidenced (the model self-flags this); (4) per-call cost/latency at scale (~84s with adaptive thinking) — Phase 17 caching + a possible effort dial-down are the levers. See DEC-031.

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
