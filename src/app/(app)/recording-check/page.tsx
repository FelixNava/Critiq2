import { redirect } from "next/navigation";
import { auth } from "@/auth";
import AppHeader from "@/components/AppHeader";
import DeviceCheckPanel from "@/components/recording/DeviceCheckPanel";

export const dynamic = "force-dynamic";

/**
 * Device check — the surface for confirming a device can hold a live session
 * (Recording Infrastructure Layers 1-3) before reps rely on it in the field.
 * Not yet wired into the main flow; reachable by URL for supervised device
 * verification until the recorder lands.
 */
export default async function RecordingCheckPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  return (
    <div className="min-h-dvh bg-slate-50">
      <AppHeader backHref="/dashboard" backLabel="Dashboard" />

      <main className="mx-auto max-w-2xl px-6 py-16">
        <h1 className="text-2xl font-semibold text-slate-900">Device check</h1>
        <p className="mt-2 text-slate-500">
          Make sure this device can hold a live session before you rely on it in
          the field.
        </p>

        <div className="mt-8">
          <DeviceCheckPanel />
        </div>
      </main>
    </div>
  );
}
