import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import * as schema from "./schema";

type DB = ReturnType<typeof drizzle<typeof schema>>;

let _db: DB | null = null;

// cache: "no-store" is REQUIRED — without it Next.js Data Cache memoizes DB
// reads indefinitely and deleted rows can reappear (project convention).
function build(url: string): DB {
  return drizzle(neon(url, { fetchOptions: { cache: "no-store" } }), { schema });
}

/**
 * Build-time fallback. `next build` collects page data by importing route
 * modules (including the Auth.js Drizzle adapter, which inspects the instance at
 * construction). DATABASE_URL may be absent in that build step — return a
 * non-cached placeholder so dialect detection succeeds. No query ever runs at
 * build; at request time the real env is present and a real instance is cached.
 */
const PLACEHOLDER_URL =
  "postgresql://placeholder:placeholder@127.0.0.1:5432/placeholder";

/**
 * Returns the real (non-proxied) Drizzle instance. Use this where a consumer
 * inspects the instance synchronously — e.g. `@auth/drizzle-adapter`, which
 * detects the SQL dialect from the object and chokes on a Proxy.
 */
export function getDb(): DB {
  const url = process.env.DATABASE_URL ?? process.env.DATABASE_URL_UNPOOLED;
  if (!url) return build(PLACEHOLDER_URL); // ephemeral, not cached
  if (!_db) _db = build(url);
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
