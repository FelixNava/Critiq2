import Link from "next/link";

export default function VerifyPage() {
  return (
    <div className="text-center">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-2xl">
        ✉️
      </div>
      <h1 className="text-lg font-semibold text-slate-900">Check your email</h1>
      <p className="mt-2 text-sm text-slate-500">
        We sent you a sign-in link. Click it to finish signing in. The link
        expires in 24 hours and works once.
      </p>
      <Link
        href="/login"
        className="mt-6 inline-block text-sm font-medium text-slate-900 underline"
      >
        Back to sign in
      </Link>
    </div>
  );
}
