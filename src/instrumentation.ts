import * as Sentry from "@sentry/nextjs";

/**
 * Server/edge Sentry init. Inert until SENTRY_DSN (or NEXT_PUBLIC_SENTRY_DSN) is
 * set, so the build and runtime are unaffected before a project DSN exists.
 * Source-map upload (withSentryConfig) is intentionally deferred — add it with
 * the DSN once the Turbopack ↔ Sentry plugin path is validated.
 */
export function register() {
  const dsn = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) return;
  if (
    process.env.NEXT_RUNTIME === "nodejs" ||
    process.env.NEXT_RUNTIME === "edge"
  ) {
    Sentry.init({ dsn, tracesSampleRate: 0.1 });
  }
}

export const onRequestError = Sentry.captureRequestError;
