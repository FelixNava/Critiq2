"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";

const inputClass =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-900 focus:ring-1 focus:ring-slate-900";
const buttonClass =
  "w-full rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:opacity-50";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"password" | "magic">("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onPasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const res = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });
    if (res?.error) {
      setError("Invalid email or password.");
      setLoading(false);
      return;
    }
    router.push("/dashboard");
    router.refresh();
  }

  async function onMagicSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    await signIn("resend", { email, redirectTo: "/dashboard" });
    // Auth.js redirects to /verify (verifyRequest) on success.
  }

  return (
    <div>
      <h1 className="text-lg font-semibold text-slate-900">Sign in</h1>
      <p className="mt-1 text-sm text-slate-500">Welcome back to Critiq.</p>

      {error && (
        <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      {mode === "password" ? (
        <form onSubmit={onPasswordSubmit} className="mt-5 space-y-3">
          <input
            type="email"
            required
            autoComplete="email"
            placeholder="you@company.com"
            className={inputClass}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <input
            type="password"
            required
            autoComplete="current-password"
            placeholder="Password"
            className={inputClass}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button type="submit" disabled={loading} className={buttonClass}>
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>
      ) : (
        <form onSubmit={onMagicSubmit} className="mt-5 space-y-3">
          <input
            type="email"
            required
            autoComplete="email"
            placeholder="you@company.com"
            className={inputClass}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <button type="submit" disabled={loading} className={buttonClass}>
            {loading ? "Sending…" : "Email me a sign-in link"}
          </button>
        </form>
      )}

      <button
        type="button"
        onClick={() => {
          setMode(mode === "password" ? "magic" : "password");
          setError(null);
        }}
        className="mt-4 w-full text-center text-sm text-slate-500 hover:text-slate-900"
      >
        {mode === "password"
          ? "Use a magic link instead"
          : "Use a password instead"}
      </button>

      <p className="mt-6 text-center text-sm text-slate-500">
        New to Critiq?{" "}
        <Link href="/signup" className="font-medium text-slate-900 underline">
          Create an account
        </Link>
      </p>
    </div>
  );
}
