import Link from "next/link";
import { Footer } from "@/components/Footer";

export default function LegalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <header className="mx-auto flex w-full max-w-3xl items-center justify-between px-6 py-5">
        <Link
          href="/"
          className="text-lg font-semibold tracking-tight text-slate-900"
        >
          Critiq
        </Link>
        <Link
          href="/login"
          className="text-sm font-medium text-slate-600 transition hover:text-slate-900"
        >
          Sign in
        </Link>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
        {children}
      </main>
      <Footer />
    </>
  );
}
