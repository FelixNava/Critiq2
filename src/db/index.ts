import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import * as schema from "./schema";

type DB = ReturnType<typeof drizzle<typeof schema>>;

let _db: DB | null = null;

function init(): DB {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Add it to .env.local (local) or the Vercel project env (deployed).",
    );
  }
  // cache: "no-store" is REQUIRED — without it Next.js Data Cache memoizes DB
  // reads indefinitely and deleted rows can reappear (project convention).
  const sql = neon(url, { fetchOptions: { cache: "no-store" } });
  return drizzle(sql, { schema });
}

/**
 * Returns the real (non-proxied) Drizzle instance. Use this where a consumer
 * inspects the instance synchronously — e.g. `@auth/drizzle-adapter`, which
 * detects the SQL dialect from the object and chokes on a Proxy.
 */
export function getDb(): DB {
  if (!_db) _db = init();
  return _db;
}

/**
 * Lazy DB handle. `neon()` is deferred until the first query via a Proxy, so
 * importing this module never opens a connection at build time. Always use
 * `export const dynamic = "force-dynamic"` on routes that touch the DB.
 */
export const db = new Proxy({} as DB, {
  get(_target, prop) {
    const real = getDb();
    const value = real[prop as keyof DB];
    return typeof value === "function" ? value.bind(real) : value;
  },
});

export { schema };
