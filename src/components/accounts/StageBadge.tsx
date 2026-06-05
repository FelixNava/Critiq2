import { stageLabel, type AccountStage } from "@/lib/accounts";

const DEFAULT_BADGE = "bg-slate-100 text-slate-700";

/**
 * The pill that shows an account's pipeline stage. One source of truth for the
 * stage→color mapping, shared by the accounts list and the per-account view.
 * `satisfies Record<AccountStage, string>` makes this exhaustive: adding a stage
 * to ACCOUNT_STAGES without a color here is a compile error, not a silent
 * fall-through to the default pill.
 */
const STAGE_BADGE = {
  prospecting: "bg-slate-100 text-slate-700",
  active: "bg-emerald-100 text-emerald-700",
  at_risk: "bg-amber-100 text-amber-700",
  won: "bg-blue-100 text-blue-700",
  dormant: "bg-slate-100 text-slate-500",
} satisfies Record<AccountStage, string>;

// `stage` is free-text at the DB level, so index permissively and fall back.
function badgeClass(stage: string): string {
  return (STAGE_BADGE as Record<string, string>)[stage] ?? DEFAULT_BADGE;
}

export default function StageBadge({
  stage,
  className = "",
}: {
  stage: string;
  className?: string;
}) {
  return (
    <span
      className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium ${badgeClass(
        stage,
      )} ${className}`}
    >
      {stageLabel(stage)}
    </span>
  );
}
