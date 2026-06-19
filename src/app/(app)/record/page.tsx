import { redirect } from "next/navigation";
import { auth } from "@/auth";
import AppHeader from "@/components/AppHeader";
import RecordingPanel from "@/components/recording/RecordingPanel";

export const dynamic = "force-dynamic";

/**
 * Quick-record (Phase 34a) — the rep-facing capture surface. Starts an
 * unassigned recording; the rep assigns it to an account afterward from their
 * recordings. Reachable from the dashboard "Record now" action.
 */
export default async function RecordPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  return (
    <div className="min-h-dvh bg-slate-50">
      <AppHeader backHref="/dashboard" backLabel="Dashboard" />

      <main className="mx-auto max-w-2xl px-6 py-12">
        <h1 className="text-2xl font-semibold text-slate-900">Record a call</h1>
        <p className="mt-2 text-slate-500">
          Hit record, have your conversation, and Critiq turns it into coaching.
          You can assign the recording to an account once it&apos;s saved.
        </p>

        <div className="mt-8">
          <RecordingPanel />
        </div>
      </main>
    </div>
  );
}
