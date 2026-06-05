import type { NextConfig } from "next";

// Beta CSP. `unsafe-inline`/`unsafe-eval` are present because we don't yet emit
// per-request nonces; tighten to a nonce-based policy before public launch
// (tracked as a hardening item). connect-src allows Sentry + Vercel insights.
const csp = [
  "default-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "connect-src 'self' https://*.sentry.io https://*.ingest.sentry.io https://*.vercel-insights.com",
].join("; ");

const securityHeaders = [
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Microphone allowed for same-origin (call recording, later phases); others off.
  {
    key: "Permissions-Policy",
    value: "camera=(), geolocation=(), microphone=(self)",
  },
  { key: "Content-Security-Policy", value: csp },
];

const nextConfig: NextConfig = {
  // A stray parent lockfile makes Next infer the wrong workspace root; pin it to
  // this project so .env.local + output tracing resolve correctly.
  turbopack: {
    root: __dirname,
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
