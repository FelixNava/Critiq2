import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getIntakeProgress, isSession1Complete } from "@/lib/intake";
import { buttonClass, cardClass } from "@/components/onboarding/ui";

export const dynamic = "force-dynamic";

export default async function OnboardingIntroPage() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) redirect("/login");

  const progress = await getIntakeProgress(userId);
  if (isSession1Complete(progress)) redirect("/dashboard");

  return (
    <div className={cardClass}>
      <h1 className="text-2xl font-semibold text-slate-900">
        Let&apos;s get to know you
      </h1>
      <p className="mt-3 text-sm leading-relaxed text-slate-600">
        Before Critiq can coach you, it helps to understand who you are and how
        you sell. This takes about five minutes, and there are no wrong answers
        — the more honest you are, the more useful your coaching becomes.
      </p>
      <p className="mt-3 text-sm leading-relaxed text-slate-600">
        We&apos;ll go one short step at a time, and your progress is saved as
        you go. You can always come back and add more later.
      </p>

      <Link
        href="/onboarding/identity"
        className={buttonClass + " mt-6 inline-block text-center"}
      >
        Let&apos;s go →
      </Link>
    </div>
  );
}
