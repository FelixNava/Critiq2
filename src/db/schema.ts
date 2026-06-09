import {
  pgTable,
  text,
  timestamp,
  integer,
  boolean,
  jsonb,
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
