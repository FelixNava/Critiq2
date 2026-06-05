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

---

## End-of-build summary

This section is filled by the master orchestrator at the end of every Full Auto run. It surfaces:

- Total decisions made (by type)
- Trade-off-flagged decisions (Felix's review queue)
- Conflict-resolution decisions (if any)
- Decisions where Iterability=low (highest review priority)

Felix reads this section first when reviewing.
