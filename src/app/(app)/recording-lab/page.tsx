import { redirect } from "next/navigation";
import { auth } from "@/auth";
import AppHeader from "@/components/AppHeader";
import RecordingLabPanel from "@/components/recording/RecordingLabPanel";

export const dynamic = "force-dynamic";

/**
 * Recording test — a supervised surface for confirming that audio capture +
 * chunked upload + local persistence work on a given device. Not wired into a
 * real rep call flow (consent + the live call UX come in later phases); reachable
 * by URL for device verification, like /recording-check.
 */
export default async function RecordingLabPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  return (
    <div className="min-h-dvh bg-slate-50">
      <AppHeader backHref="/dashboard" backLabel="Dashboard" />

      <main className="mx-auto max-w-2xl px-6 py-16">
        <h1 className="text-2xl font-semibold text-slate-900">Recording test</h1>
        <p className="mt-2 text-slate-500">
          Check that audio capture and saving work on this device before relying
          on it in the field.
        </p>

        <div className="mt-8">
          <RecordingLabPanel />
        </div>
      </main>
    </div>
  );
}
