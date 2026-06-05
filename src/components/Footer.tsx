import Link from "next/link";

export function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer className="border-t border-slate-200 bg-white">
      <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-3 px-6 py-8 text-sm text-slate-500 sm:flex-row">
        <p>© {year} First Lap LLC. All rights reserved.</p>
        <nav className="flex items-center gap-5">
          <Link href="/terms" className="transition hover:text-slate-900">
            Terms
          </Link>
          <Link href="/privacy" className="transition hover:text-slate-900">
            Privacy
          </Link>
          <a
            href="mailto:hello@critiq.firstlap.dev"
            className="transition hover:text-slate-900"
          >
            Contact
          </a>
        </nav>
      </div>
    </footer>
  );
}
