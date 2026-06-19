import { redirect } from "next/navigation";
import { auth } from "@/auth";
import AppHeader from "@/components/AppHeader";
import ContextEditor from "@/components/context/ContextEditor";
import { MAX_REP_CONTEXT, getRepContext } from "@/lib/context";

export const dynamic = "force-dynamic";

/**
 * Profile — Phase 35a. Where the rep tells Critiq, in their own words, how they sell.
 * This is the free-text companion to the structured intake (the onboarding flow): a
 * single block the rep can edit any time. It feeds the working-memory / coaching
 * layers (consumer wiring is Phase 35c) and is treated as grounded truth by the
 * hallucination guard, so a detail the rep adds here can surface in coaching.
 */
export default async function ProfilePage() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) redirect("/login");

  const context = await getRepContext(userId);

  return (
    <div className="min-h-dvh bg-slate-50">
      <AppHeader backHref="/dashboard" backLabel="Dashboard" />

      <main className="mx-auto max-w-2xl px-6 py-12">
        <h1 className="text-2xl font-semibold text-slate-900">Your profile</h1>
        <p className="mt-1 text-sm text-slate-500">
          The more Critiq knows about how you sell, the sharper your coaching gets.
        </p>

        <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <h2 className="text-sm font-semibold text-slate-900">
            How you sell
          </h2>
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

        <section className="mt-6 rounded-2xl border border-dashed border-slate-300 bg-white p-6">
          <h2 className="text-sm font-semibold text-slate-900">
            Your structured profile
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-slate-500">
            Critiq also learns from the intake questions in onboarding. You can
            revisit those any time from your dashboard.
          </p>
        </section>
      </main>
    </div>
  );
}
