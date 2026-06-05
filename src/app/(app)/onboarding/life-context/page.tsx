import { redirect } from "next/navigation";
import { auth } from "@/auth";
import {
  getIntakeProgress,
  getLifeContextGate,
  isSession1Complete,
  isSession2Complete,
  isLifeContextComplete,
} from "@/lib/intake";
import LifeContextForm from "@/components/onboarding/LifeContextForm";

export const dynamic = "force-dynamic";

export default async function LifeContextPage() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) redirect("/login");

  const progress = await getIntakeProgress(userId);

  // Earlier sessions must be finished first.
  if (!isSession1Complete(progress)) redirect("/onboarding");
  if (!isSession2Complete(progress)) redirect("/dashboard");

  // Already answered → nothing to do here.
  if (isLifeContextComplete(progress)) redirect("/dashboard");

  // Trust-gate: not available until the account is old enough. Enforced on the
  // server so a locked rep can't reach the form by typing the URL.
  const gate = await getLifeContextGate(userId);
  if (!gate || !gate.unlocked) redirect("/dashboard");

  return <LifeContextForm />;
}
