# Call Analysis Experience — Deep-Dive Approach (Phases 38–44)

> **Status:** APPROVED direction (2026-06-20) — **awaiting Felix's go to build.** This is the canonical reference for the call-analysis epic; the phase roadmap + full-auto map live in `docs/PHASE_LEDGER.md` (Phases 38–44). **Read this before building any analysis phase.**
>
> Scoped by the `robust-call-analysis-approach` multi-agent workflow (8 agents: user-research · Gong/Chorus benchmark · codebase audit · the recovered Manus original · experience design · connectivity architecture · adversarial design-critique · phased plan). Felix's directive: *"the call analysis is the bread and butter of this app — make it THE most robust part of the experience; connect everything downstream so call context feeds everything."*

---

## 0. The core finding — the engine exists, but it's stranded

The objective pipeline is **already built and runs**: capture → Deepgram transcript → 3-pillar SPIN/Voss/Navarro score (overall /100 + 12 sub-dimensions + verbatim evidence quotes), all persisted. The problem is it's a **dead end with no surface and no feedback loop:**

- **No detail page** — `/recordings/[id]` does not exist; `GET /api/recording/[id]/transcript` + `…/score` have **zero production consumers** (only the dev-only `/recording-lab` renders a transcript).
- **No playback** — chunk blobs are read only by the transcription fetcher; nothing concatenates/serves audio.
- **The rich score is invisible** — the per-dimension rationale + evidence quotes (`call_scores.dimensions` jsonb) are computed + stored, then **never rendered**. At most a rep sees an overall number on a coaching card — and only after writing a debrief AND attaching the recording.
- **The score is a MEMORY DEAD-END** — account/rep/working memory read `call_debriefs` only. Scoring ignores memory **IN** (`buildScoringRequest` takes only the transcript); the score never feeds memory **OUT**. So "call context feeds everything" holds for the *subjective debrief* but NOT the *objective graded call*.

**Implication:** the work is **surface it richly + close the loop both ways** — most of the hard AI work already exists.

---

## 1. AI model decision (Felix owns; recommended)

Everything is **`claude-sonnet-4-6`** today (`src/lib/*/anthropic.ts`); transcription is Deepgram nova-3.

| Task | Recommend | Why |
|---|---|---|
| **Scoring** | **Opus 4.8** (`claude-opus-4-8`) | The credibility core — every point must trace to a moment. Runs async (cron) so its ~84s latency is hidden. |
| **Coaching** | **Opus 4.8** | The "what to say instead" rewrite is the headline wow + hardest reasoning; output is short. |
| Consolidation, brief, script, debrief | **Keep Sonnet 4.6** | Summarize / organize-not-judge on crons; Opus adds little. |

**Implementation:** every AI table already has a per-row `model` column → one-line default change per runner, plus bump the cached methodology layer past Opus's **4096-token** cacheable floor (`src/lib/ai/cache.ts` `MIN_CACHEABLE_TOKENS` opus=4096; sonnet caches at ~1024). Apply in Phase 38 (scoring) + 43/44 (coaching).

---

## 2. What reps value (user research, JTBD)

Top jobs-to-be-done, ranked:
1. "Tell me the **2–3 things I got wrong on THIS call**, with the exact moment, while it's fresh" — fast, timestamped triage.
2. "Show me the **moment I lost/stalled the deal and the line I should have used**" — pinpoint + a concrete better line, not generic advice.
3. "**Did I run my process or wing it?**" — methodology adherence (SPIN/Voss/Navarro) is the documented #1 separator of top vs bottom reps.
4. "**Am I getting better at the ONE thing I'm working on?**" — a single named skill trended across calls (deliberate-practice feedback loop).
5. "**Catch me up on this account before I dial.**"
6. (Manager/owner) "Coach all 5–10 reps without listening to every call" + "ramp new reps faster."

**Highest-value outputs (ranked):** P0 = evidence-cited diagnosis (3–5 coachable moments w/ quotes+timestamps) · the "what to say instead" rewrite · methodology-adherence scoring. P1 = behavioral metrics vs a personalized benchmark · per-rep skill trend over time · per-account memory synthesis · confirmed-next-step detection. P2 = 5-minute review digest · manager coaching queue.

**Wow moments:** "it quoted me back to myself" · "it gave me the line I should have used" · "I can see myself getting better" (the trend) · "it was fair" (every point links to evidence).

**Anti-patterns (avoid):** opaque/black-box scores (the #1 trust-killer — only ~2% of sales pros fully trust AI output → NEVER show a score point that can't link to a transcript moment); generic team-wide advice; mis-attributed evidence (inverts the whole advantage); a 25-point teardown (overwhelm); raw vanity metrics framed as surveillance; slow turnaround (kills voluntary review).

**Beginner vs experienced:** beginners need scaffolding (what a good discovery question even IS); veterans need the subtle thing they missed + benchmarking against their own best, and will abandon a tool that states the obvious.

---

## 3. The Manus original — replicate + exceed

The original Critiq (leadership tool, recovered from the packfile) was loved for: **tabbed single-screen** analysis · **strict-JSON** AI output (no prose walls) · scorecard + per-dimension suggestion + Top Strength/Improvement · **every output a finished artifact** (copy-paste recap, action items) · week-over-week carried-forward memory.

**It never had** transcript timestamps, audio playback, or grounding, and it silently truncated long transcripts. **Exceed it on:** (1) keep Deepgram word-segments → clickable transcript synced to an `<audio>` player + jump-to-moment from any cited claim; (2) the sales rubric + objective signals (talk ratio, monologue length, question count) computed from segments; (3) grounding — tie every claim to a timestamp/quote (Phase 26 guard); (4) real chunked/map-reduce for long calls (no silent slice); (5) stream the analysis instead of spinner-then-dump; (6) a corpus-aware coach (feed it real call summaries/scores via the memory tiers); (7) talk-time-per-speaker visualization.

---

## 4. Benchmark — MVP must-haves (Gong/Chorus/Fathom gold standard)

Synced transcript↔audio (current line auto-highlights + click-to-seek) · player w/ scrub, ±15s, 0.5–2× speed · speaker-labeled transcript w/ consistent per-speaker color · three-pillar scorecard + 12-sub-dim breakdown (never a lone number) · **EVIDENCE LINKING** (every sub-score cites the exact quote+timestamp; clicking it seeks the audio — the "prove it" trust feature) · talk-to-listen ratio + benchmark · AI summary + next steps rail · timeline moment markers · fast turnaround with a clean processing state.

---

## 5. The designed experience

### 5a. Flows
- **Record → analysis:** `/record` → on stop, recording saved (unassigned) → a "Saved" confirmation with a primary **"See your analysis"** deep-link to `/recordings/[id]`. The page is reachable BEFORE assignment (assignment encouraged inline, not gating) and **upgrades section-by-section** as transcript→score→coaching land (poll while pending; each zone swaps skeleton→content).
- **Re-entry via the call pill:** anywhere a call appears, a scored pill shows a score chip + an **Analysis button** → `/recordings/[id]#assessment`.
- **Review (in-page):** verdict → coachable moments (left) → sticky player + synced transcript (right) → metrics → methodology → next steps.
- **Refine:** inline "Fair / This isn't right" on moments, sub-dimensions, AND the overall score → feeds per-rep calibration.
- **Cold-start/degraded:** first-scored-call coachmark; honest failure/partial-capture states; never a fabricated score.

### 5b. The call pill + Analysis button (Felix's explicit ask)
One shared component (inbox rows, account "Calls" list, dashboard, debrief attachment): left = `recordingLabel` + meta (date · duration · optional amber "NN% captured"); right = state from the existing `pipelineState()` helper. **Scored** = success score chip "Scored · NN" + an explicit **Analysis button** (→ `#assessment`); the pill body navigates to the page. **Unscored** = pipeline-state chip + the Analysis button disabled with a tooltip ("Available once scoring finishes"). Reuses data already on the inbox row — no new query shape.

### 5c. The analysis page IA (`/recordings/[id]`, `max-w-6xl` desktop / single-column mobile)
- **Zone A — Verdict:** overall "NN /100" (40px) decomposed into 3 pillar bars (SPIN purple `#534AB7` /35 · Voss blue `#185FA5` /35 · Navarro teal `#0F6E56` /30) + a one-paragraph summary leading with the 2 highest-leverage fixes + an honest trust badge + **a score-level refine row**.
- **Zone B — Coachable moments (left, the headline):** 3–5 ranked cards (Pivotal coral / Missed amber / Strength teal), each = tag + timestamp + evidence quote (tinted left-border, jump-to-MM:SS) + "why it matters" + a grounded **"try this instead"** block (methodology-labeled; shown only when produced). Hard cap 5.
- **Zone C — Player + timeline (right, sticky):** play/pause, ±15s, 0.5–2×, draggable playhead, color-coded moment markers (single source of timestamps shared with Zone B).
- **Zone D — Synced transcript (right):** speaker-labeled, current line auto-highlights + auto-scrolls, click-to-seek, evidence lines pinned, **inline-editable speaker labels**.
- **Zone E — Behavioral metrics vs baseline:** talk/listen, discovery-question count, longest monologue, focus-skill — EACH vs the rep's own baseline (never a naked vanity number).
- **Zone F — Methodology breakdown:** 3 pillar accordions, 12 sub-dimensions (score/max + rationale + evidence jump-links), collapsed by default; zero-evidence dims marked as grounding gaps.
- **Zone G — Next steps + coaching:** Phase 21 coaching (priorities + reinforce + nextStep) + confirmed-next-step detector.
- **Zone H — Account linkage + provenance footer.**

### 5d. Transcript↔playback sync
Bidirectional, single clock off `transcript_segments.words` start times: playback→transcript (highlight + follow-along scroll), transcript→playback (click line/MM:SS to seek), moment→both. Sticky player; keyboard (space, ←/→ ±15s); auto-scroll yields to manual scroll with a "jump to playing line" affordance.

### 5e. Evidence linking
Every `DimensionScore.evidence[]` quote + each derived moment resolves to a transcript line/word-offset → a jump-to-MM:SS link, a colored timeline marker, and an inline tag on the evidence line. Quotes rendered verbatim (no paraphrase); any score point lacking a resolvable anchor is visibly flagged ungrounded (operationalizes the Phase 26 guard in the UI). Speaker labels editable (mis-attribution is the credibility-inverting risk).

### 5f. The refine loop (where Felix refines AI feedback)
Inline "Fair / This isn't right" on every moment, every sub-dimension, AND the overall score. "This isn't right" opens an inline panel (no modal): reason chips (Wrong quote / Misattributed speaker / Out of context / Too harsh / Missed the point / Score too high|low) + free-text + an optional corrected-score nudge. Writes a feedback row keyed to `(scoreId, target, repId)`; tags the item "You flagged this"; routes to per-rep calibration. Owner gets the same + an authoritative, non-erasing "override" + an aggregate "flagged by reps" view. Optimistic + non-blocking (mirrors the existing `usefulnessRating` resilience).

### 5g. States
transcribing · scoring · scored · partial-transcript (capture gaps; flagged, affected regions greyed) · partial-judgement ("Not assessed", not a misleading 0) · transcription-failed · scoring-failed (degrade, don't blank) · cold-start (coachmark + research benchmarks) · unassigned (inline AssignControl) · empty · refine-submitted.

### 5h. Look & feel
Inherits Critiq's language verbatim: slate palette, white `rounded-2xl` cards + `border-slate-200` + `shadow-sm`, status pills, premium-through-restraint. Two-column reading grid (`max-w-6xl`) collapsing to single-column on mobile (player first). Minimal functional motion (one-time ~400ms score count-up; smooth transcript auto-scroll; skeleton→content cross-fade). No gradients/glow.

---

## 6. Architecture — the "smart site" connectivity

### 6a. Already wired (do NOT rebuild)
The 4 conversational consumers (pre-call 18, script 19, debrief 20, coaching 21) pull memory via `buildConsumerWorkingMemory` (`src/lib/workingmemory/forConsumer.ts`); debrief completion fires account (every debrief) + rep (every 10) consolidation via `after()`; coaching joins debrief + the linked `call_score` and snapshots it. Source-attribution per fact/trait honors the Phase 26 guard.

### 6b. The gaps to close (the loop, both ways)
- **GAP A (memory INTO scoring):** scoring is the only AI consumer that ignores memory — `buildScoringRequest` (`src/lib/scoring/anthropic.ts:51`) takes only the transcript. Pass account summary + rep profile + context so the score is context-aware (the antidote to over-penalizing question count). Read account/rep context only when `recording.accountId` is set (cold-start safe).
- **GAP B (score OUT to memory):** a `call_score` is read only by coaching. After a score completes, contribute it to `account_summaries` + `rep_summaries` (source-tagged `call-score:<scoreId>`), so every NEXT brief/script/debrief/coaching is smarter because of the graded call. Gate with `call_scores.fed_to_memory_at` for idempotency; crons sweep the rest.
- **GAP C (recording↔debrief auto-link):** `debrief.recordingId` is set only if the client passes it. Add server-side auto-association (suggest/link the rep's most recent scored recording for the account in a time window) so the score reliably reaches coaching.
- **GAP D (skill trend):** derive a per-sub-dimension trend from the rep's last-N `call_scores` for the "I can see myself getting better" moment + the manager queue.

### 6c. Audio playback approach
Chunks are MediaRecorder WebM/Opus fragments grouped into ~10-min segments (`SEGMENT_MS=10min`, `OVERLAP_MS=2s`, `segmentedRecorder.ts`). **Within a segment**, chunks in `chunkIndex` order concatenate into a decodable WebM (only the first chunk carries the EBML header — `transcribe.ts` already relies on this) → a naive per-chunk playlist breaks. **Across segments**, each is its own stream → byte-appending is NOT valid. **Approach:** new `GET /api/recording/[id]/audio` (auth via `getRecordingForUser`): single-segment = live ordered-concat with HTTP Range/206 (seek), zero re-encode; multi-segment = lightweight server remux to one seekable container on first play, cached to Blob keyed by `recordingId+chunkCount`. **Sync:** convert per-segment Deepgram word times to GLOBAL playback time (sum prior segment durations, minus the 2s overlap already trimmed); emit words-with-global-time. **Partial captures:** moment/marker timestamps must be in AUDIO time, gaps rendered as explicit non-seekable regions. **Spike + lock this contract BEFORE building the player** (critique P0).

### 6d. Assessment reliability
Already reliable via cron (both transcribe + score sweepers select with no account filter → unassigned recordings are processed; idempotent CAS-claim + attempts-cap-3 + 15-min stale reclaim; `partial` transcripts still scorable). Two hardenings: (1) add an `after()` pre-warm in `recording/complete/route.ts` (`processRecordingForScore`) so an unassigned completed recording transcribes+scores in seconds not ~20 min; (2) surface score status in the recordings inbox for ANY recording.

### 6e. Schema changes (additive only)
`call_scores.fed_to_memory_at` (high-water for the score→memory loop) · `account_summaries`/`rep_summaries` score signal (or fold into `facts[]`/traits with a `call-score:<id>` source tag — no new column) · optional `rep_summaries.skill_trend` (or compute on read) · `recordings.playback_blob_url` + `playback_status` (cache the multi-segment remux). NO schema change needed to wire memory into scoring (prompt-construction only) or to switch models (per-row `model` column exists).

### 6f. New routes
`GET /api/recording/[id]/audio` (the missing playback primitive) · transcript-words-with-global-time (extend `…/transcript`) · (`POST /api/recording/[id]/score` already exists — the human re-trigger) · score→memory runs inside `finishScore`/`after()`/the consolidate crons (no new HTTP route).

### 6g. Wiring tasks
Wire memory into scoring (`buildScoringRequest` + `runScoringForRecording`) · wire score into memory (after `finishScore`, gated by `fed_to_memory_at`) · pre-warm on complete · auto-link recording→debrief · surface score status in the inbox · build the analysis page · bump scoring/coaching `model` defaults to Opus + extend the cached layer.

---

## 7. Design-critique must-fixes (baked into the phases)

P0s from the adversarial `/design-critique`:
1. **Refine affordance on the OVERALL score**, not just sub-dimensions (the number reps most viscerally reject).
2. **Design mobile first-class** — single column + a sticky bottom mini-player; phones are the primary rep context (the desktop two-column "wow" is impossible at 375px).
3. **Make the trust badge literally true** — "grounded in your call" + a live evidence counter that drops when a grounding gap exists (an over-claimed "every point cited" badge next to one uncited point inverts credibility).
4. **Spike + lock the audio contract before build** — audio-time not wall-clock; non-seekable gap regions for partial captures.
Plus: resolve speaker-relabel vs score consistency (re-score or display-only, never silently disagree); a **Quick-read default** (verdict + top 3 moments above the fold; collapse metrics/coaching too); polling backoff + hard timeout + tab-blur pause; reframe owner-override as transparent/non-erasing (consider deferring).

---

## 8. The phased plan + full-auto map (see `docs/PHASE_LEDGER.md` for the entries)

| # | Phase | Full-auto |
|---|---|---|
| 38 | Recording Analysis Page (keystone): assign-flow fix + `/recordings/[id]` playback + transcript + assessment (audio spike first) | auto-build + interactive-verify; **Felix: audio device-gate** |
| 39 | Coachable Moments (evidence cards + "try this instead" + transcript jump) | auto-build + interactive-verify |
| 40 | Synced Playback Polish (auto-highlight, markers, editable speakers) | auto-build + interactive-verify; **Felix: scrub device-gate** |
| 41 | Behavioral Metrics + 12-dim Methodology + Next Steps | auto-build + interactive-verify |
| 42 | Shared Call Pill + Analysis button (+ kills account-card placeholders) | auto-build + interactive-verify |
| 43 | AI-Feedback Refine Loop + per-rep calibration | 43a plumbing auto · **43b calibration = Felix + expert coach** |
| 44 | Close the score→memory loop (objective call feeds account/rep/working memory) | plumbing auto behind a flag · **what enters memory = Felix + expert coach** |

**5 of 7 are full-auto-able** (38–42: auto-build + interactive MCP verify + mandatory `/design-critique`). **Felix personally owns:** the **audio device-gate** (38/40), and the **AI-feedback calibration** (43b/44 — what a "this isn't right" flag does to the score/memory; what objective signal enters shared memory + its weight). **Sequencing:** 38 first + alone (keystone, de-risks the pipeline); 2/4 parallel-safe after, 3 after 2; 42 any time after 38; 43 before 44. Every phase: branch off `review-for-main` → PR into `review-for-main`, never master, never auto-merge to prod.

---

## 9. References
- Roadmap + per-phase entries: `docs/PHASE_LEDGER.md` (Phases 38–44 + the epic intro).
- The model/hard-delete decisions: `docs/DECISIONS_LOG.md`.
- Full raw workflow output (8-agent results): the `robust-call-analysis-approach` run (task `wriyilgdr`) — ephemeral temp file; this doc is the durable distillation.
- Recording bugs found via dogfooding (2026-06-20): assign-flow drops the rep after inline new-account (recording is SAFE + unassigned in `/recordings`); no playback/transcript/assessment view (Phase 38 closes); live in-call transcript NOT planned (batch-only by design — net-new Deepgram streaming if ever wanted).
