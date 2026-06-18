import Link from "next/link";
import { Footer } from "@/components/Footer";

const pillars = [
  {
    title: "Call structure",
    body: "Critiq listens for how you uncover needs and build urgency — situation, problem, implication, payoff — and shows you where conversations stall.",
  },
  {
    title: "Communication craft",
    body: "It tracks the mechanics that move deals: how you mirror, label, ask calibrated questions, and use silence under pressure.",
  },
  {
    title: "Relationship depth",
    body: "It learns your accounts as relationships, not transactions — so coaching reflects the long game in your territory, not generic scripts.",
  },
];

export default function Home() {
  return (
    <>
      {process.env.VERCEL_ENV !== "production" && (
        <Link
          href="/recording-lab"
          className="block bg-indigo-600 px-6 py-3 text-center text-sm font-semibold text-white transition hover:bg-indigo-700"
        >
          🎙️ Recording Lab — device-test surface →
        </Link>
      )}
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-5">
        <span className="text-lg font-semibold tracking-tight text-slate-900">
          Critiq
        </span>
        <nav className="flex items-center gap-3 text-sm">
          <Link
            href="/login"
            className="font-medium text-slate-600 transition hover:text-slate-900"
          >
            Sign in
          </Link>
          <Link
            href="/signup"
            className="rounded-lg bg-slate-900 px-3.5 py-2 font-semibold text-white transition hover:bg-slate-700"
          >
            Join the beta
          </Link>
        </nav>
      </header>

      <main className="flex-1">
        <section className="mx-auto max-w-3xl px-6 pb-16 pt-12 text-center sm:pt-20">
          <h1 className="text-balance text-4xl font-semibold tracking-tight text-slate-900 sm:text-5xl">
            The AI sales coach that learns the rep, not just the role.
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-lg leading-relaxed text-slate-600">
            Most sales tools grade everyone against the same rubric. Critiq
            builds a model of how <em>you</em> sell, and coaches from there.
          </p>
          <div className="mt-8 flex items-center justify-center gap-3">
            <Link
              href="/signup"
              className="rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-700"
            >
              Join the beta
            </Link>
            <Link
              href="/login"
              className="rounded-lg border border-slate-300 px-5 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
            >
              Sign in
            </Link>
          </div>
        </section>

        <section className="mx-auto max-w-3xl space-y-5 px-6 text-base leading-relaxed text-slate-600">
          <p>
            Record your sales conversations — over video or in person, best from
            your laptop — and Critiq turns each one into a clear, honest debrief:
            what worked, what slipped, and the one change most likely to move the
            next call.
          </p>
          <p>
            It scores every conversation against the frameworks top reps actually
            use, then layers in the judgment that separates good from great:
            curiosity, restraint, and a real read on the relationship.
          </p>
          <p>
            And it compounds. Critiq remembers your reps and your accounts, so
            the coaching gets sharper the more you use it — noticeably personal
            by your tenth call, and genuinely yours well before fifty.
          </p>
        </section>

        <section className="mx-auto mt-14 grid max-w-5xl gap-4 px-6 sm:grid-cols-3">
          {pillars.map((p) => (
            <div
              key={p.title}
              className="rounded-2xl border border-slate-200 bg-white p-5"
            >
              <h3 className="text-sm font-semibold text-slate-900">{p.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">
                {p.body}
              </p>
            </div>
          ))}
        </section>

        <section className="mx-auto my-16 max-w-3xl px-6 text-center">
          <p className="text-lg font-medium text-slate-900">
            Now in private beta for field sales teams.
          </p>
          <Link
            href="/signup"
            className="mt-5 inline-block rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-700"
          >
            Request access
          </Link>
        </section>
      </main>

      <Footer />
    </>
  );
}
