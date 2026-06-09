/**
 * Direct-SQL migration runner. Applies the SQL files drizzle-kit generates in
 * ./drizzle, in filename order, tracking applied files in `_critiq_migrations`.
 *
 * NEVER use `drizzle-kit push` (needs a TTY). Run:  pnpm db:migrate
 * Uses the UNPOOLED (direct) connection for DDL.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { neon } from "@neondatabase/serverless";

// Load .env.local for local runs. Vercel/CI inject env directly, so we never
// overwrite an existing value.
if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!url) {
  console.error("✗ No DATABASE_URL_UNPOOLED / DATABASE_URL set.");
  process.exit(1);
}

const sql = neon(url);
const DIR = "drizzle";

async function main() {
  await sql`create table if not exists _critiq_migrations (
    id text primary key,
    applied_at timestamptz not null default now()
  )`;

  const appliedRows = (await sql`select id from _critiq_migrations`) as {
    id: string;
  }[];
  const applied = new Set(appliedRows.map((r) => r.id));

  const files = existsSync(DIR)
    ? readdirSync(DIR)
        .filter((f) => f.endsWith(".sql"))
        .sort()
    : [];

  if (files.length === 0) {
    console.log("No .sql migration files in ./drizzle — nothing to apply.");
    return;
  }

  let appliedCount = 0;
  for (const file of files) {
    if (applied.has(file)) {
      console.log(`• skip (already applied): ${file}`);
      continue;
    }
    const raw = readFileSync(join(DIR, file), "utf8");
    const statements = raw
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter(Boolean);

    console.log(`▶ applying ${file} (${statements.length} statement(s))…`);
    for (const stmt of statements) {
      await sql.query(stmt);
    }
    await sql`insert into _critiq_migrations (id) values (${file})`;
    appliedCount++;
    console.log(`  ✓ ${file}`);
  }

  console.log(
    appliedCount === 0
      ? "✓ Up to date — no new migrations."
      : `✓ Applied ${appliedCount} migration(s).`,
  );
}

main().catch((e) => {
  console.error("✗ MIGRATION FAILED:", e);
  process.exit(1);
});
