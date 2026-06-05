# Critiq — Autonomous Decisions Log

Every non-trivial decision made by Full Auto without Felix's input. Read by the end-of-build summary; Felix uses this to confirm or iterate after the build run.

## Format

```
## DEC-NNN — {Decision summary}
Phase: N/{slug}
Date: YYYY-MM-DD HH:MM ET
Type: [trade-off | obvious | conflict-resolution]
Bucket:
  - obvious: established plan applied; no alternatives existed.
  - trade-off: multiple reasonable options; one was chosen.
  - conflict-resolution: source documents disagreed; hierarchy applied.

Context: Why a decision was needed at this moment.

Chosen: What was decided.

Alternatives considered (only required for trade-off + conflict-resolution):
  - Option A: ... (rejected because ...)
  - Option B: ... (CHOSEN because ...)
  - Option C: ... (rejected because ...)

Rationale: Why this choice fit best given established plan + PRD + Brief.

Iterability: How easily this can be reversed if Felix wants different. (low / medium / high)

Trade-off flag: [YES / NO] — does this need Felix's review post-build?
```

## Decisions

## DEC-001 — Repo made public
Phase: 1/foundation-rails
Date: 2026-06-05 02:05 ET
Type: obvious
Context: `/critiq-status` uses anonymous `WebFetch` against raw.githubusercontent.com, which 404s on a private repo — so mobile status checks were broken. Felix explicitly chose "Make Critiq2 public" when asked.
Chosen: `gh repo edit FelixNava/Critiq2 --visibility public`. Verified raw URL returns 200.
Rationale: Repo is just a Next.js scaffold + docs — no secrets committed (`.env*` gitignored). Mobile status now works.
Iterability: high (can re-privatize anytime; if so, `/critiq-status` must switch to authed `gh api`).
Trade-off flag: NO (Felix's explicit choice).

## DEC-002 — Secret sourcing for the build
Phase: 1/foundation-rails
Date: 2026-06-05 02:10 ET
Type: trade-off
Context: Critiq had no secrets anywhere. Felix asked whether secrets could be sourced from sibling projects (drawdown-tracker / apextrust) and gave latitude ("do what you think is right"). Investigated what's reusable.
Chosen:
  - Reused account-wide `ANTHROPIC_API_KEY` + `RESEND_API_KEY` from drawdown-tracker's `.env.local` (Critiq's domain `critiq.firstlap.dev` is already Resend-verified).
  - Generated fresh `AUTH_SECRET` + `CRON_SECRET` (random).
  - Left `DATABASE_URL` unset for Felix — each project must have its own isolated Neon DB.
  All written to `critiq2/.env.local` (gitignored; values never printed to transcript).
Alternatives considered:
  - Dedicated per-project Anthropic/Resend keys (rejected for now: more setup, no functional difference for beta; reuse is reversible).
  - Reuse a sibling `DATABASE_URL` (REJECTED hard: commingles data, violates Critiq's locked privacy model, and the only available connections point at production DBs).
  - Create a Critiq Neon project via `neonctl` (rejected: CLI not authenticated — browser OAuth timed out; needs Felix interactively).
Rationale: Unblocks AI/email/auth autonomously while keeping data isolation intact and leaving the one genuinely-Felix decision (the DB) to him.
Iterability: high for the API keys (rotate to dedicated keys anytime); the DB choice is still open (Felix provisions it).
Trade-off flag: YES — review whether to rotate Critiq onto its own dedicated Anthropic + Resend keys before beta (best practice for revocability/rate-limit isolation).

## DEC-003 — Phase branches cut from review-for-main, not master
Phase: 2/drizzle-neon
Date: 2026-06-05 02:25 ET
Type: conflict-resolution
Context: docs/CLAUDE.md says "branch from master," but master is frozen at the scaffold (Felix promotes it manually) while review-for-main accumulates each merged phase. Branching Phase 3 from master would give it no Phase 2 code, breaking the dependency chain.
Chosen: cut each phase branch from `review-for-main`; PR back into `review-for-main`. master stays Felix's manual-promotion target, untouched.
Alternatives: branch from master (rejected — phases wouldn't contain prior phases' code).
Rationale: review-for-main is this project's integration mainline; the global "branch from master, never from a feature branch" rule is about not stacking on unmerged sibling features — review-for-main is neither. Preserves the build chain.
Iterability: high (purely a branching convention).
Trade-off flag: YES — confirm you're OK with this convention; if you'd rather, promote review-for-main→master between phases so master can be the base.

## DEC-004 — Built Phase 2 directly as orchestrator (no subagent fan-out)
Phase: 2/drizzle-neon
Date: 2026-06-05 02:25 ET
Type: trade-off
Context: /critiq-full-auto specifies a Planner→Architect→Builder→Verifier subagent mesh. That mesh is brand-new and untested. Phase 2 is small + fully specified in the ledger.
Chosen: I (the live session) built Phase 2 directly with full context, verifying via local build + Neon queries + Vercel preview, rather than spinning the untested mesh across the first real phase.
Rationale: lower risk for the first autonomous phase; proves the build/verify/merge loop end-to-end before trusting the agent fan-out. Will reassess using subagents for larger phases (e.g. the recording stack).
Iterability: high (per-phase choice).
Trade-off flag: NO (process choice, easily changed).

---

## End-of-build summary

This section is filled by the master orchestrator at the end of every Full Auto run. It surfaces:

- Total decisions made (by type)
- Trade-off-flagged decisions (Felix's review queue)
- Conflict-resolution decisions (if any)
- Decisions where Iterability=low (highest review priority)

Felix reads this section first when reviewing.
