import { stageLabel } from "@/lib/accounts";

/**
 * The pill that shows an account's pipeline stage. One source of truth for the
 * stage→color mapping, shared by the accounts list and the per-account view.
 */
const STAGE_BADGE: Record<string, string> = {
  prospecting: "bg-slate-100 text-slate-700",
  active: "bg-emerald-100 text-emerald-700",
  at_risk: "bg-amber-100 text-amber-700",
  won: "bg-blue-100 text-blue-700",
  dormant: "bg-slate-100 text-slate-500",
};

export default function StageBadge({
  stage,
  className = "",
}: {
  stage: string;
  className?: string;
}) {
  return (
    <span
      className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium ${
        STAGE_BADGE[stage] ?? "bg-slate-100 text-slate-700"
      } ${className}`}
    >
      {stageLabel(stage)}
    </span>
  );
}
