import { defineConfig } from "drizzle-kit";

// `generate` does not need a live DB connection; `studio`/`pull` do.
const url =
  process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL || "";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url },
  strict: true,
  verbose: true,
});
