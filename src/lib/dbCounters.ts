import { neon } from "@neondatabase/serverless";

let _sql: ReturnType<typeof neon> | null = null;

function client() {
  if (!_sql) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    _sql = neon(url, { fetchOptions: { cache: "no-store" } });
  }
  return _sql;
}

/**
 * Atomic fixed-window counter. One row per bucket; on each hit we INSERT or, on
 * conflict, either reset (if the window expired) or increment — all in a single
 * statement so concurrent requests can't race. Returns the post-hit count and
 * the window end.
 */
export async function hitCounter(
  bucketKey: string,
  windowSeconds: number,
): Promise<{ count: number; expiresAt: Date }> {
  const sql = client();
  const rows = (await sql`
    INSERT INTO rate_limit_counters (bucket_key, count, expires_at, updated_at)
    VALUES (${bucketKey}, 1, now() + make_interval(secs => ${windowSeconds}), now())
    ON CONFLICT (bucket_key) DO UPDATE SET
      count = CASE WHEN rate_limit_counters.expires_at <= now()
                   THEN 1 ELSE rate_limit_counters.count + 1 END,
      expires_at = CASE WHEN rate_limit_counters.expires_at <= now()
                        THEN now() + make_interval(secs => ${windowSeconds})
                        ELSE rate_limit_counters.expires_at END,
      updated_at = now()
    RETURNING count, expires_at
  `) as { count: number; expires_at: string }[];

  const row = rows[0];
  return { count: Number(row.count), expiresAt: new Date(row.expires_at) };
}
