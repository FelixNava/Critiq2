import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/db";
import { users } from "@/db/schema";
import AppHeader from "@/components/AppHeader";
import ContextEditor from "@/components/context/ContextEditor";
import DeleteAccountSection from "@/components/account/DeleteAccountSection";
import { MAX_REP_CONTEXT, getRepContext } from "@/lib/context";
import {
  getIntakeProgress,
  INTAKE_DIMENSIONS,
  type IntakeDimension,
} from "@/lib/intake";
import { getRepSummary } from "@/lib/repconsolidation/store";

export const dynamic = "force-dynamic";

/**
 * Profile — the rep's home for who they are, what Critiq has learned about how
 * they sell, and (Phase 37c) control over their data.
 *
 * Sections:
 *  - Account basics (name / email / role / member since)
 *  - "How you sell" — the rep's own free-text context (Phase 35a), editable
 *  - "What Critiq has learned" — the read-only consolidated rep model
 *    (rep_summaries, Phase 24), so a rep can see and trust the profile that
 *    drives their coaching (previously stored-but-invisible)
 *  - "Your intake" — structured-intake completion status
 *  - Danger zone — permanently delete the account (rep only; admin is manual)
 */

const DIMENSION_LABELS: Record<IntakeDimension, string> = {
  identity: "Identity",
  relationships: "Relationships",
  sales_psychology: "Sales psychology",
  operational_habits: "Operational habits",
  market_intelligence: "Market intelligence",
  life_context: "Life context",
};

/** Defensively pull trait sentences out of the jsonb traits array. */
function coerceTraitTexts(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    const t = (item ?? {}) as Record<string, unknown>;
    const text = typeof t.text === "string" ? t.text.trim() : "";
    if (text) out.push(text);
  }
  return out;
}

export default async function ProfilePage() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) redirect("/login");

  const [user] = await db
    .select({
      name: users.name,
      email: users.email,
      role: users.role,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user) redirect("/login");

  const context = await getRepContext(userId);
  const progress = await getIntakeProgress(userId);
  const repSummary = await getRepSummary(userId);

  const hasModel =
    repSummary?.status === "completed" &&
    typeof repSummary.narrative === "string" &&
    repSummary.narrative.trim().length > 0;
  const traitTexts = hasModel ? coerceTraitTexts(repSummary?.traits) : [];

  const memberSince = user.createdAt.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  return (
    <div className="min-h-dvh bg-slate-50">
      <AppHeader />

      <main className="mx-auto max-w-2xl px-6 py-12">
        <h1 className="text-2xl font-semibold text-slate-900">Your profile</h1>
        <p className="mt-1 text-sm text-slate-500">
          Who you are, what Critiq has learned about how you sell, and control
          over your data.
        </p>

        {/* Account basics */}
        <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <h2 className="text-sm font-semibold text-slate-900">Account</h2>
          <dl className="mt-4 space-y-3 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">Name</dt>
              <dd className="text-right text-slate-900">{user.name ?? "—"}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">Email</dt>
              <dd className="text-right break-all text-slate-900">
                {user.email}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">Role</dt>
              <dd className="text-right capitalize text-slate-900">
                {user.role}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">Member since</dt>
              <dd className="text-right text-slate-900">{memberSince}</dd>
            </div>
          </dl>
        </section>

        {/* How you sell — the rep's own words (Phase 35a, editable) */}
        <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <h2 className="text-sm font-semibold text-slate-900">How you sell</h2>
          <p className="mt-1 mb-4 text-sm leading-relaxed text-slate-500">
            Tell Critiq anything that helps it coach you — your strengths, what
            you&apos;re working on, the kinds of accounts you handle, how you like
            to run a call. Write it however you want; you can update it any time.
          </p>
          <ContextEditor
            endpoint="/api/profile/context"
            initialContext={context}
            max={MAX_REP_CONTEXT}
            label="How you sell"
            emptyHint="Nothing here yet. Add a few notes on how you sell and Critiq will factor them into your coaching."
            placeholder="e.g. I sell commercial paint to contractors and property managers. I'm strong at building rapport but I tend to rush past discovery when I sense a deal is close. I want to get better at slowing down and surfacing the real budget."
            ctaLabel="Add context"
            editLabel="Edit"
          />
        </section>

        {/* What Critiq has learned — read-only consolidated model (rep_summaries) */}
        <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold text-slate-900">
              What Critiq has learned about how you sell
            </h2>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">
              Read-only
            </span>
          </div>
          {hasModel ? (
            <>
              {repSummary?.headline && (
                <p className="mt-3 text-base font-medium text-slate-900">
                  {repSummary.headline}
                </p>
              )}
              <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-slate-600">
                {repSummary?.narrative}
              </p>
              {traitTexts.length > 0 && (
                <div className="mt-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                    Patterns Critiq has noticed
                  </p>
                  <ul className="mt-2 space-y-1.5">
                    {traitTexts.map((t, i) => (
                      <li
                        key={i}
                        className="flex gap-2 text-sm leading-relaxed text-slate-600"
                      >
                        <span
                          aria-hidden
                          className="mt-2 h-1 w-1 shrink-0 rounded-full bg-slate-400"
                        />
                        <span>{t}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <p className="mt-4 text-xs text-slate-500">
                Drawn only from your own call debriefs, and private to you.
              </p>
            </>
          ) : (
            <p className="mt-3 text-sm leading-relaxed text-slate-500">
              Critiq builds this from your call debriefs — it comes into focus
              around your tenth call. Keep debriefing and it gets sharper every
              time.
            </p>
          )}
        </section>

        {/* Your intake — structured-intake completion status */}
        <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">Your intake</h2>
            <span className="text-sm text-slate-500">
              {progress.percent}% complete
            </span>
          </div>
          <p className="mt-1 text-sm leading-relaxed text-slate-500">
            The questions you answered in onboarding. These shape your coaching
            alongside everything above.
          </p>
          <ul className="mt-4 space-y-2">
            {INTAKE_DIMENSIONS.map((dim) => {
              const done = progress.dimensions[dim];
              return (
                <li
                  key={dim}
                  className="flex items-center justify-between text-sm"
                >
                  <span className="text-slate-700">{DIMENSION_LABELS[dim]}</span>
                  {done ? (
                    <span className="font-medium text-emerald-600">Done</span>
                  ) : (
                    <span className="text-slate-600">Not yet</span>
                  )}
                </li>
              );
            })}
          </ul>
        </section>

        {/* Danger zone — permanent account deletion (rep only). */}
        {user.role === "admin" ? (
          <section className="mt-6 rounded-2xl border border-dashed border-slate-300 bg-white p-6">
            <h2 className="text-sm font-semibold text-slate-900">
              Delete your account
            </h2>
            <p className="mt-1 text-sm leading-relaxed text-slate-500">
              Admin accounts are managed manually during the beta.
            </p>
          </section>
        ) : (
          <DeleteAccountSection email={user.email} />
        )}
      </main>
    </div>
  );
}
