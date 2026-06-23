import type { ReactNode } from "react";

/**
 * Titled card section + muted helper for the recording analysis page. Shared by
 * the page (server) and SyncedPlayback (client) so the card chrome can't drift
 * between them. Plain presentational components — no "use client" so either side
 * can import them.
 */
export function Zone({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

export function Muted({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <p className={`text-sm leading-relaxed text-slate-600 ${className}`}>
      {children}
    </p>
  );
}
