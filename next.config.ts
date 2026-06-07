import type { NextConfig } from "next";

// Beta CSP. `unsafe-inline`/`unsafe-eval` are present because we don't yet emit
// per-request nonces; tighten to a nonce-based policy before public launch
// (tracked as a hardening item). connect-src allows Sentry + Vercel insights +
// Vercel Blob: the @vercel/blob CLIENT upload() posts chunk bytes to the Blob
// API at https://vercel.com/api/blob (verified in the installed SDK —
// defaultVercelBlobApiUrl), and public blob URLs are read from
// *.public.blob.vercel-storage.com. media-src allows blob: for
// the Layer-2 silent keep-alive audio, which plays a runtime-built WAV via a
// createObjectURL() blob: URL (Recording stack); without it the audio source is
// rejected by CSP ("Media load rejected by URL safety check") and the lock-screen
// presence never appears. NOTE: CSP only applies on deployed responses, not the
// dev server — so a missing host here is a preview-only failure, invisible to
// local verification.
const csp = [
  "default-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "font-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "connect-src 'self' https://*.sentry.io https://*.ingest.sentry.io https://*.vercel-insights.com https://vercel.com https://*.public.blob.vercel-storage.com",
].join("; ");

const securityHeaders = [
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Microphone + screen-wake-lock allowed for same-origin (call recording +
  // session keep-alive); others off.
  {
    key: "Permissions-Policy",
    value: "camera=(), geolocation=(), microphone=(self), screen-wake-lock=(self)",
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
