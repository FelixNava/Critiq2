import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/auth";
import AppHeader from "@/components/AppHeader";
import RecordingsInbox, {
  type InboxRecording,
} from "@/components/recording/RecordingsInbox";
import { listRecordingsForUser } from "@/lib/recordings";
import { listAccountsForUser } from "@/lib/accounts";

export const dynamic = "force-dynamic";

/**
 * Recordings inbox (Phase 34b) — every capture the rep owns, newest first, with
 * its assigned account and where it is in the transcript/score pipeline. From
 * here the rep assigns an unassigned recording to an account (Phase 34c), which
 * is what turns it into coaching.
 */
export default async function RecordingsPage() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) redirect("/login");

  const [recordings, accounts] = await Promise.all([
    listRecordingsForUser(userId),
    listAccountsForUser(userId),
  ]);

  // Serialize Dates to ISO for the client component (formats them locally).
  const inbox: InboxRecording[] = recordings.map((r) => ({
    ...r,
    startedAt: r.startedAt.toISOString(),
  }));
  const inboxAccounts = accounts.map((a) => ({ id: a.id, name: a.name }));

  return (
    <div className="min-h-dvh bg-slate-50">
      <AppHeader backHref="/dashboard" backLabel="Dashboard" />

      <main className="mx-auto max-w-2xl px-6 py-12">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-2xl font-semibold text-slate-900">
            Your recordings
          </h1>
          <Link
            href="/record"
            className="shrink-0 rounded-lg bg-slate-900 px-3.5 py-1.5 text-sm font-semibold text-white transition hover:bg-slate-700"
          >
            Record a call
          </Link>
        </div>
        <p className="mt-1 text-sm text-slate-500">
          Assign a recording to an account to turn it into coaching.
        </p>

        <div className="mt-8">
          <RecordingsInbox recordings={inbox} accounts={inboxAccounts} />
        </div>
      </main>
    </div>
  );
}
