import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import AppHeader from "@/components/AppHeader";
import StageBadge from "@/components/accounts/StageBadge";
import {
  getAccountForUser,
  getLearningProgress,
  type AccountContact,
} from "@/lib/accounts";

export const dynamic = "force-dynamic";

export default async function AccountDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) redirect("/login");

  const { id } = await params;
  const account = await getAccountForUser(userId, id);
  if (!account) notFound();

  const progress = getLearningProgress(account.loggedCalls);

  return (
    <div className="min-h-dvh bg-slate-50">
      <AppHeader backHref="/accounts" backLabel="Accounts" />

      <main className="mx-auto max-w-3xl px-6 py-12">
        {/* Title row */}
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-semibold text-slate-900">
              {account.name}
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              {account.role === "owner"
                ? "You own this account."
                : "You're a collaborator on this account."}
            </p>
          </div>
          <StageBadge stage={account.stage} className="mt-1" />
        </div>

        {/* Primary action — prep for the next call */}
        <Link
          href={`/accounts/${account.id}/pre-call`}
          className="mt-6 flex items-center justify-between gap-4 rounded-2xl border border-slate-900 bg-slate-900 p-5 text-white shadow-sm transition hover:bg-slate-800"
        >
          <span>
            <span className="block text-sm font-semibold">
              Prepare for a call
            </span>
            <span className="mt-0.5 block text-sm text-slate-300">
              Get a quick read on this account and your objective before you dial.
            </span>
          </span>
          <span aria-hidden className="text-lg">
            →
          </span>
        </Link>

        {/* Secondary action — debrief a finished call */}
        <Link
          href={`/accounts/${account.id}/debrief`}
          className="mt-3 flex items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-5 text-slate-900 shadow-sm transition hover:bg-slate-50"
        >
          <span>
            <span className="block text-sm font-semibold">Debrief a call</span>
            <span className="mt-0.5 block text-sm text-slate-500">
              Just got off a call? Tell Critiq what happened and it writes up the
              recap, commitments, and loose ends.
            </span>
          </span>
          <span aria-hidden className="text-lg text-slate-400">
            →
          </span>
        </Link>

        {/* Learning indicator */}
        <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">
              {progress.isWarm ? "Coaching is dialed in" : "Still learning"}
            </h2>
            <span className="text-xs font-medium text-slate-500">
              {progress.loggedCalls} of {progress.target} calls
            </span>
          </div>
          <div
            className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-100"
            role="progressbar"
            aria-valuenow={progress.percent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Account learning progress"
          >
            <div
              className="h-full rounded-full bg-slate-900 transition-all"
              style={{ width: `${progress.percent}%` }}
            />
          </div>
          <p className="mt-3 text-sm text-slate-500">
            {progress.isWarm
              ? "Critiq has enough history on this account to tailor your coaching to it."
              : "Critiq sharpens its coaching as you log calls on this account — it usually takes about ten to really hit its stride."}
          </p>
        </section>

        {/* Account intelligence summary */}
        <Card title="What Critiq knows">
          {account.summary ? (
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
              {account.summary}
            </p>
          ) : (
            <ColdStart>
              Nothing yet. As you log calls, Critiq builds a running picture of
              this account — who they are, what they care about, and where the
              deal stands — and shows it here.
            </ColdStart>
          )}
        </Card>

        {/* Last interaction */}
        <Card title="Last interaction">
          <ColdStart>
            No calls logged here yet. Your most recent conversation with this
            account will land here once you start recording.
          </ColdStart>
        </Card>

        {/* Behavioral profile */}
        <Card title="How they buy">
          <ColdStart>
            Critiq builds a read on this account&apos;s style — how they make
            decisions, what moves them, what stalls them — from your calls. A few
            conversations in, it&apos;ll take shape here.
          </ColdStart>
        </Card>

        {/* Contacts */}
        <Card title="Contacts">
          {account.contacts.length === 0 ? (
            <ColdStart>
              No contacts on this account yet. The people you talk to here will
              show up in this list.
            </ColdStart>
          ) : (
            <ul className="divide-y divide-slate-100">
              {account.contacts.map((c) => (
                <ContactRow key={c.id} contact={c} />
              ))}
            </ul>
          )}
        </Card>
      </main>
    </div>
  );
}

function Card({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function ColdStart({ children }: { children: React.ReactNode }) {
  return <p className="text-sm leading-relaxed text-slate-500">{children}</p>;
}

function ContactRow({ contact }: { contact: AccountContact }) {
  return (
    <li className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <p className="flex items-center gap-2 text-sm font-medium text-slate-900">
          <span className="truncate">{contact.name}</span>
          {contact.isPrimary && (
            <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
              Primary
            </span>
          )}
        </p>
        {contact.title && (
          <p className="mt-0.5 truncate text-sm text-slate-500">
            {contact.title}
          </p>
        )}
      </div>
      <div className="shrink-0 text-right text-sm text-slate-500">
        {contact.email && <p className="truncate">{contact.email}</p>}
        {contact.phone && <p className="truncate">{contact.phone}</p>}
      </div>
    </li>
  );
}
