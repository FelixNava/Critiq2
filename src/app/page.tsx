import Link from "next/link";
import { LandingPage } from "@/components/landing/LandingPage";

// Phase 33 — Marketing Landing Redesign. The public `/` route is the cinematic
// landing (ported from docs/design/landing-prototype.html). The dev/preview-only
// recording-lab affordance is preserved above it (hidden in production).
export default function Home() {
  return (
    <>
      {process.env.VERCEL_ENV !== "production" && (
        <Link
          href="/recording-lab"
          className="block bg-indigo-600 px-6 py-3 text-center text-sm font-semibold text-white transition hover:bg-indigo-700"
        >
          🎙️ Recording Lab — device-test surface →
        </Link>
      )}
      <LandingPage />
    </>
  );
}
