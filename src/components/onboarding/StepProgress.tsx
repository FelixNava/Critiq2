/**
 * Presentational step indicator for the onboarding flow. Server component —
 * no interactivity. Shows "Step N of M" plus a simple progress bar.
 */
export default function StepProgress({
  current,
  total,
}: {
  current: number;
  total: number;
}) {
  const percent = total > 0 ? Math.round((current / total) * 100) : 0;

  return (
    <div role="group" aria-label="Onboarding progress">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
        Step {current} of {total}
      </p>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
        <div
          className="h-full rounded-full bg-slate-900 transition-all"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
