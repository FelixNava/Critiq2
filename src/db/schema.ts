import {
  pgTable,
  text,
  timestamp,
  integer,
  primaryKey,
  index,
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

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
