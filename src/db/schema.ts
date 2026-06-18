import {
  pgTable,
  text,
  timestamp,
  integer,
  boolean,
  jsonb,
  real,
  primaryKey,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Auth.js (NextAuth v5) core tables — column *property* names match what
 * `@auth/drizzle-adapter` expects (emailVerified, userId, sessionToken, …);
 * DB column names are snake_case. Critiq adds `passwordHash` + `role` to users.
 * FKs + indexes from day one (project convention).
 */

export const users = pgTable("users", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name"),
  email: text("email").notNull().unique(),
  emailVerified: timestamp("email_verified", { withTimezone: true }),
  image: text("image"),
  // Critiq additions:
  passwordHash: text("password_hash"),
  role: text("role").notNull().default("rep"), // 'rep' | 'admin'
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const accounts = pgTable(
  "accounts",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (t) => [
    primaryKey({ columns: [t.provider, t.providerAccountId] }),
    index("accounts_user_id_idx").on(t.userId),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    sessionToken: text("session_token").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expires: timestamp("expires", { withTimezone: true }).notNull(),
  },
  (t) => [index("sessions_user_id_idx").on(t.userId)],
);

export const verificationTokens = pgTable(
  "verification_tokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.identifier, t.token] })],
);

/**
 * Postgres-based fixed-window rate limiting (no Upstash). One row per bucket key
 * (e.g. `auth:1.2.3.4`); `expires_at` marks the window end and the counter resets
 * atomically on the next hit after expiry. See src/lib/rateLimit.ts.
 */
export const rateLimitCounters = pgTable(
  "rate_limit_counters",
  {
    bucketKey: text("bucket_key").primaryKey(),
    count: integer("count").notNull().default(0),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("rate_limit_counters_expires_at_idx").on(t.expiresAt)],
);

/**
 * Rep intake assessment — one row per answered question. `answer` is JSON so we
 * can store strings today and richer shapes (arrays/objects) later without a
 * schema change. A rep can only have one answer per question (upsert target).
 */
export const repIntakeResponses = pgTable(
  "rep_intake_responses",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    dimension: text("dimension").notNull(),
    questionKey: text("question_key").notNull(),
    answer: jsonb("answer"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("rep_intake_responses_user_question_key").on(
      t.userId,
      t.questionKey,
    ),
    index("rep_intake_responses_user_id_idx").on(t.userId),
  ],
);

/**
 * Rep intake progress — one row per completed dimension. Drives the dashboard
 * completion meter and gating. `completedAt` is preserved across re-submissions;
 * only `updatedAt` advances.
 */
export const repIntakeProgress = pgTable(
  "rep_intake_progress",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    dimension: text("dimension").notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("rep_intake_progress_user_dimension_key").on(
      t.userId,
      t.dimension,
    ),
    index("rep_intake_progress_user_id_idx").on(t.userId),
  ],
);

/**
 * Accounts — the FIRST-CLASS entity in Critiq. Account intelligence is SHARED
 * across reps (single source-of-truth `summary`), so continuity survives a rep
 * transition (OQ-04 #2 in the locked privacy model). The `summary` is the
 * running account intelligence regenerated by a later phase; it is null at cold
 * start. `createdBy` is provenance only (SET NULL on user delete) — the account
 * itself outlives any individual rep because it is shared. Soft-deleted via
 * `deletedAt` (project convention for user-facing data).
 */
export const accountsTbl = pgTable(
  "account_records",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    name: text("name").notNull(),
    stage: text("stage").notNull().default("prospecting"),
    // Shared running intelligence summary (regenerated in a later phase). Null
    // until enough interactions exist (cold start).
    summary: text("summary"),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("account_records_created_by_idx").on(t.createdBy),
    index("account_records_deleted_at_idx").on(t.deletedAt),
  ],
);

/**
 * Account ↔ rep assignments (many-to-many). A rep sees an account because a row
 * links them here. Rep transitions = reassigning the row(s); the shared account
 * summary stays put, giving the incoming rep full inheritance. `role` lets one
 * account have a primary `owner` plus future `collaborator`s. Composite PK keeps
 * a rep linked to an account at most once.
 */
export const accountRepJoins = pgTable(
  "account_rep_joins",
  {
    accountId: text("account_id")
      .notNull()
      .references(() => accountsTbl.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("owner"), // 'owner' | 'collaborator'
    assignedAt: timestamp("assigned_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.accountId, t.userId] }),
    index("account_rep_joins_user_id_idx").on(t.userId),
    index("account_rep_joins_account_id_idx").on(t.accountId),
  ],
);

/**
 * Contacts at an account (people the rep talks to). Belong to the account, so
 * they are shared across reps like the account itself. Soft-deleted via
 * `deletedAt`. `isPrimary` flags the main point of contact.
 */
export const contacts = pgTable(
  "contacts",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    accountId: text("account_id")
      .notNull()
      .references(() => accountsTbl.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    title: text("title"),
    email: text("email"),
    phone: text("phone"),
    notes: text("notes"),
    isPrimary: boolean("is_primary").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("contacts_account_id_idx").on(t.accountId),
    index("contacts_deleted_at_idx").on(t.deletedAt),
  ],
);

/**
 * Recordings — the episodic raw-capture layer (locked memory architecture: raw
 * interactions stored forever in Postgres + Vercel Blob). One row per capture
 * session. `accountId` is nullable for now: this is a standalone dev/test surface
 * with no real call flow yet, so a recording need not belong to an account (the
 * linkage arrives with the call-flow phases). SET NULL so deleting an account
 * never erases the capture audit trail. Soft-deleted via `deletedAt`.
 */
export const recordings = pgTable(
  "recordings",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: text("account_id").references(() => accountsTbl.id, {
      onDelete: "set null",
    }),
    status: text("status").notNull().default("recording"), // recording | completed | failed | aborted
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    durationMs: integer("duration_ms"),
    chunkCount: integer("chunk_count").notNull().default(0),
    // Capture coverage (Phase 14b). gapMs = ms of audio NOT captured (iOS
    // suspends the mic when a PWA is backgrounded / the screen locks); gapCount =
    // number of such stalls. Null on legacy rows. coverage = (durationMs - gapMs)
    // / durationMs — a holey recording must never be treated as complete.
    gapMs: integer("gap_ms"),
    gapCount: integer("gap_count"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("recordings_user_id_idx").on(t.userId),
    index("recordings_account_id_idx").on(t.accountId),
    index("recordings_deleted_at_idx").on(t.deletedAt),
  ],
);

/**
 * Recording chunks — one row per uploaded audio chunk (Layer 6 persistence
 * metadata; the bytes live in Vercel Blob, this is the index over them). A row is
 * written when the upload is confirmed — by the authenticated client confirm
 * (POST /api/recording/chunk, the reliable writer) and, in production, also by
 * Vercel's best-effort `onUploadCompleted` backup — so a row means "this chunk is
 * durably stored". UNIQUE (recording_id, chunk_index) makes both writers
 * idempotent. `segment_index` groups chunks into ~10-min capture segments.
 */
export const recordingChunks = pgTable(
  "recording_chunks",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    recordingId: text("recording_id")
      .notNull()
      .references(() => recordings.id, { onDelete: "cascade" }),
    chunkIndex: integer("chunk_index").notNull(),
    // Which ~10-min segment this chunk belongs to (Phase 13 auto-segmentation).
    // Lets a later transcription phase group + parallel-process per segment and
    // trim the 2s cutover overlap. Default 0 (single segment / legacy rows).
    segmentIndex: integer("segment_index").notNull().default(0),
    blobPathname: text("blob_pathname").notNull(),
    blobUrl: text("blob_url").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    durationMs: integer("duration_ms"),
    status: text("status").notNull().default("uploaded"), // pending | uploaded | failed
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("recording_chunks_recording_chunk_key").on(
      t.recordingId,
      t.chunkIndex,
    ),
    index("recording_chunks_recording_id_idx").on(t.recordingId),
  ],
);

/**
 * Web Push subscriptions (Phase 14 — interruption notifications). One row per
 * browser/PWA push endpoint a rep has granted, scoped to the rep (cascade on
 * user delete). The server sends a BRANDING-ONLY interruption push to these
 * endpoints; gone (404/410) endpoints are pruned on send. `endpoint` is the
 * natural key (unique) so re-subscribing the same browser updates in place.
 */
export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull(),
    // The two keys from the browser PushSubscription (base64url).
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("push_subscriptions_endpoint_key").on(t.endpoint),
    index("push_subscriptions_user_id_idx").on(t.userId),
  ],
);

/**
 * Recording transcripts (Phase 15 — Deepgram Nova-3). One row per recording: the
 * unified, concatenated transcript across all ~10-min capture segments (memory
 * Option B — parallel transcribe → concat → unified analysis). The episodic raw
 * layer (recordings + recording_chunks) is the source of truth; this is the
 * derived text the scoring + coaching phases read. UNIQUE on recording_id (one
 * transcript per recording) makes the trigger + cron sweeper idempotent.
 * `status`: pending | processing | completed | failed. `text` is null until
 * completed. FK cascades on recording delete (the transcript is derived data).
 */
export const recordingTranscripts = pgTable(
  "recording_transcripts",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    recordingId: text("recording_id")
      .notNull()
      .references(() => recordings.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("pending"), // pending | processing | completed | partial | failed
    provider: text("provider").notNull().default("deepgram"),
    model: text("model").notNull().default("nova-3"),
    // How many times transcription has been attempted. The cron sweeper stops
    // re-picking a recording once this hits the cap, so a permanently-undecodable
    // segment can't loop forever (bounded-retry, like the recorder's upload cap).
    attempts: integer("attempts").notNull().default(0),
    // The unified transcript (segments concatenated in segment order). Null until
    // status = completed.
    text: text("text"),
    wordCount: integer("word_count"),
    durationMs: integer("duration_ms"),
    segmentCount: integer("segment_count").notNull().default(0),
    language: text("language"),
    // The last failure message (for the cron sweeper + the lab surface). Cleared
    // on a successful retry.
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("recording_transcripts_recording_id_key").on(t.recordingId),
    index("recording_transcripts_status_idx").on(t.status),
  ],
);

/**
 * Per-segment transcripts (Phase 15). One row per ~10-min capture segment, so a
 * single failed segment can be retried without re-transcribing the whole
 * recording, and Phase 16+ scoring can read speaker-attributed `words` (Deepgram
 * diarization timestamps) per segment. `confidence` is Deepgram's 0–1 average for
 * the segment. `words` holds the word-level timing/speaker array (jsonb). UNIQUE
 * on (transcript_id, segment_index) is the idempotent upsert target.
 */
export const transcriptSegments = pgTable(
  "transcript_segments",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    transcriptId: text("transcript_id")
      .notNull()
      .references(() => recordingTranscripts.id, { onDelete: "cascade" }),
    recordingId: text("recording_id")
      .notNull()
      .references(() => recordings.id, { onDelete: "cascade" }),
    segmentIndex: integer("segment_index").notNull(),
    status: text("status").notNull().default("pending"), // pending | completed | failed
    text: text("text"),
    // Word-level timestamps + speaker labels from Deepgram (jsonb). Null on a
    // failed/empty segment.
    words: jsonb("words"),
    confidence: real("confidence"),
    durationMs: integer("duration_ms"),
    chunkCount: integer("chunk_count").notNull().default(0),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("transcript_segments_transcript_segment_key").on(
      t.transcriptId,
      t.segmentIndex,
    ),
    index("transcript_segments_transcript_id_idx").on(t.transcriptId),
    index("transcript_segments_recording_id_idx").on(t.recordingId),
  ],
);

/**
 * Call scores (Phase 16 — three-pillar SPIN/Voss/Navarro engine). One row per
 * recording: the derived 100-point evaluation Claude produces from the unified
 * transcript. The transcript (Phase 15) is the input; this is the scored output
 * the debrief + coaching phases read. UNIQUE on recording_id (one score per
 * recording) makes the trigger + cron sweeper idempotent — same lifecycle as
 * recording_transcripts (CAS claim, attempts cap, partial-tolerant).
 *
 * `overall_score` is 0–100 (the sum of the three pillar columns); the pillar
 * columns are bounded by the locked rubric (spin 35, voss 35, navarro 30). The
 * per-sub-dimension detail (score + rationale + verbatim evidence quotes) lives
 * in `dimensions` jsonb — the evidence is the grounding Phase 26's hallucination
 * guard will require. `strengths`/`improvements` are the coaching seeds Phase 21
 * consumes. Scores are null until status = completed. FK cascades on recording
 * delete (the score is derived data).
 */
export const callScores = pgTable(
  "call_scores",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    recordingId: text("recording_id")
      .notNull()
      .references(() => recordings.id, { onDelete: "cascade" }),
    // The transcript this score was derived from (provenance; SET NULL if the
    // transcript row is ever rebuilt). Nullable for defensive cron paths.
    transcriptId: text("transcript_id").references(
      () => recordingTranscripts.id,
      { onDelete: "set null" },
    ),
    status: text("status").notNull().default("pending"), // pending | processing | completed | failed
    provider: text("provider").notNull().default("anthropic"),
    model: text("model").notNull().default("claude-sonnet-4-6"),
    // Bounded-retry, mirroring the transcript sweeper: the cron stops re-picking
    // a recording once attempts hits the cap so a permanently-unscorable
    // transcript can't loop forever. A human can re-trigger past the cap.
    attempts: integer("attempts").notNull().default(0),
    // Aggregates (null until completed). overall = spin + voss + navarro.
    overallScore: integer("overall_score"),
    spinScore: integer("spin_score"),
    vossScore: integer("voss_score"),
    navarroScore: integer("navarro_score"),
    // Per-sub-dimension detail: { <key>: { score, rationale, evidence[] } }.
    dimensions: jsonb("dimensions"),
    // Coaching seeds (string arrays) + a one-paragraph plain-language summary.
    strengths: jsonb("strengths"),
    improvements: jsonb("improvements"),
    summary: text("summary"),
    // True when the model omitted a rubric dimension (engine defaulted it to 0).
    partialJudgement: boolean("partial_judgement").notNull().default(false),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("call_scores_recording_id_key").on(t.recordingId),
    index("call_scores_status_idx").on(t.status),
  ],
);

/**
 * Pre-call briefs (Phase 18 — the interaction loop's prep step). One row per
 * pre-call prep session: the rep narrates account context + call goal (text for
 * beta; voice is a later phase), and Critiq produces a diagnostic brief
 * (`diagnosis` + `approach` + anticipated `objections`) plus, from the third
 * interaction onward, a recommended call `objective`.
 *
 * Objective handoff is a HARD RULE, not AI judgment (locked product mechanic):
 *   - interactions 1–2 → the REP sets the objective (`objectiveSource = 'rep'`);
 *   - interaction 3+   → Critiq recommends (`recommendedObjective`), the rep can
 *     accept it (`objectiveSource = 'signal'`) or override (`overridden = true`,
 *     `objectiveSource = 'rep'` — the deviation is recorded for the learning loop).
 * `interactionNumber` is 1-based and drives the branch (see src/lib/precall).
 *
 * Account intelligence is SHARED, so the interaction count spans all reps on the
 * account; rep narration + the rating stay with the authoring rep. Cascades on
 * both account and user delete (the brief is derived prep data).
 */
export const preCallBriefs = pgTable(
  "pre_call_briefs",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    accountId: text("account_id")
      .notNull()
      .references(() => accountsTbl.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // 1-based: which interaction with this account this prep is for. Drives the
    // objective handoff rule (rep sets on 1–2, Critiq recommends on 3+).
    interactionNumber: integer("interaction_number").notNull().default(1),
    // The rep's free-text narration of account context + call goal (text-only for
    // beta; voice input is a later phase).
    narration: text("narration").notNull(),
    // Who set the in-force objective: 'rep' (interactions 1–2, or a rep override)
    // or 'signal' (Critiq's recommendation, accepted on interaction 3+).
    objectiveSource: text("objective_source").notNull().default("rep"),
    // The FINAL objective in force for the call (null until set/recommended).
    objective: text("objective"),
    // What Critiq recommended (interaction 3+ only; null on 1–2).
    recommendedObjective: text("recommended_objective"),
    // True when the rep overrode Critiq's recommendation (the logged deviation).
    overridden: boolean("overridden").notNull().default(false),
    status: text("status").notNull().default("pending"), // pending | processing | completed | failed
    provider: text("provider").notNull().default("anthropic"),
    model: text("model").notNull().default("claude-sonnet-4-6"),
    attempts: integer("attempts").notNull().default(0),
    // AI brief output (null until status = completed).
    diagnosis: text("diagnosis"), // where the account stands + what's likely to move it
    approach: jsonb("approach"), // [{ focus, why }] strategic prep points
    objections: jsonb("objections"), // [{ objection, response }] anticipated
    summary: text("summary"), // one-line plain-language takeaway
    // The rep's 1–5 usefulness rating (PRD beta metric). Null until rated.
    usefulnessRating: integer("usefulness_rating"),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("pre_call_briefs_account_id_idx").on(t.accountId),
    index("pre_call_briefs_user_id_idx").on(t.userId),
  ],
);

/**
 * Call scripts (Phase 19). A delivery-cued conversation framework generated FROM a
 * completed pre-call brief (Signal PRD Step 04). One row per generation — a rep can
 * regenerate in a different style mode, so a brief may have several scripts; the UI
 * shows the latest. The objective is snapshotted at generation time so a later
 * objective edit on the brief doesn't silently rewrite a script the rep already read.
 * Generated synchronously in the rep's request (like the brief) → no cron/CAS.
 */
export const callScripts = pgTable(
  "call_scripts",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    // The completed brief this script was generated from (objective + approach).
    briefId: text("brief_id")
      .notNull()
      .references(() => preCallBriefs.id, { onDelete: "cascade" }),
    accountId: text("account_id")
      .notNull()
      .references(() => accountsTbl.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // 'assertive' | 'relational' — the chosen style mode for this script (PRD §06).
    styleMode: text("style_mode").notNull().default("relational"),
    // The in-force call objective at generation time (snapshot from the brief).
    objective: text("objective"),
    status: text("status").notNull().default("pending"), // pending | processing | completed | failed
    provider: text("provider").notNull().default("anthropic"),
    model: text("model").notNull().default("claude-sonnet-4-6"),
    attempts: integer("attempts").notNull().default(0),
    // AI script output (null until status = completed).
    opener: text("opener"), // how to open the call
    sections: jsonb("sections"), // [{ label, purpose, lines: [{ say, cues: [{ kind, note }] }] }]
    closing: text("closing"), // how to drive toward the objective + secure the next step
    deliveryNotes: jsonb("delivery_notes"), // string[] of call-level delivery coaching
    // The rep's 1–5 usefulness rating (PRD beta metric: script adoption). Null until rated.
    usefulnessRating: integer("usefulness_rating"),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("call_scripts_brief_id_idx").on(t.briefId),
    index("call_scripts_account_id_idx").on(t.accountId),
    index("call_scripts_user_id_idx").on(t.userId),
  ],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type PushSubscriptionRow = typeof pushSubscriptions.$inferSelect;
export type NewPushSubscriptionRow = typeof pushSubscriptions.$inferInsert;
export type RepIntakeResponse = typeof repIntakeResponses.$inferSelect;
export type NewRepIntakeResponse = typeof repIntakeResponses.$inferInsert;
export type RepIntakeProgress = typeof repIntakeProgress.$inferSelect;
export type NewRepIntakeProgress = typeof repIntakeProgress.$inferInsert;
export type Account = typeof accountsTbl.$inferSelect;
export type NewAccount = typeof accountsTbl.$inferInsert;
export type AccountRepJoin = typeof accountRepJoins.$inferSelect;
export type NewAccountRepJoin = typeof accountRepJoins.$inferInsert;
export type Contact = typeof contacts.$inferSelect;
export type NewContact = typeof contacts.$inferInsert;
export type Recording = typeof recordings.$inferSelect;
export type NewRecording = typeof recordings.$inferInsert;
export type RecordingChunk = typeof recordingChunks.$inferSelect;
export type NewRecordingChunk = typeof recordingChunks.$inferInsert;
export type RecordingTranscript = typeof recordingTranscripts.$inferSelect;
export type NewRecordingTranscript = typeof recordingTranscripts.$inferInsert;
export type TranscriptSegment = typeof transcriptSegments.$inferSelect;
export type NewTranscriptSegment = typeof transcriptSegments.$inferInsert;
export type CallScore = typeof callScores.$inferSelect;
export type NewCallScore = typeof callScores.$inferInsert;
export type PreCallBrief = typeof preCallBriefs.$inferSelect;
export type NewPreCallBrief = typeof preCallBriefs.$inferInsert;
export type CallScript = typeof callScripts.$inferSelect;
export type NewCallScript = typeof callScripts.$inferInsert;
