"use client";

import { useState } from "react";
import {
  PILLARS,
  dimensionsForPillar,
  type PillarKey,
} from "@/lib/scoring/rubric";

/** One sub-dimension as stored in call_scores.dimensions jsonb. */
type StoredDim = { score?: number; rationale?: string; evidence?: string[] };

export type ScoreCardData = {
  overall: number | null;
  pillars: { spin: number | null; voss: number | null; navarro: number | null };
  dimensions: Record<string, StoredDim> | null;
  strengths: string[];
  improvements: string[];
  summary: string | null;
  partialJudgement: boolean;
};

// Pillar accent colors (docs/CALL_ANALYSIS_APPROACH.md §5c — NOT in rubric.ts,
// which is the scoring source of truth and stays presentation-free).
const PILLAR_COLOR: Record<PillarKey, string> = {
  spin: "#534AB7",
  voss: "#185FA5",
  navarro: "#0F6E56",
};

/**
 * A dimension the model omitted shows as "Not assessed" (never a misleading 0).
 * We treat score 0 with no rationale as not-assessed; a real "skill absent" 0
 * carries a rationale explaining the absence.
 */
function isNotAssessed(d: StoredDim | undefined): boolean {
  return (d?.score ?? 0) === 0 && !(d?.rationale ?? "").trim();
}

export default function ScoreCard({ data }: { data: ScoreCardData }) {
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [refineOpen, setRefineOpen] = useState(false);

  const dims = data.dimensions ?? {};
  const pillarKeys: PillarKey[] = ["spin", "voss", "navarro"];

  // Trust: how many sub-scores cite at least one verbatim quote. Excludes
  // not-assessed dims so the badge never over-claims grounding.
  const assessed = Object.values(PILLARS).flatMap((p) =>
    dimensionsForPillar(p.key),
  );
  const assessedCount = assessed.filter((d) => !isNotAssessed(dims[d.key])).length;
  const groundedCount = assessed.filter(
    (d) => (dims[d.key]?.evidence?.length ?? 0) > 0,
  ).length;

  return (
    <div>
      {/* Overall + refine affordance */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm text-slate-500">Overall</p>
          <p className="text-4xl font-semibold tracking-tight text-slate-900">
            {data.overall ?? "—"}
            <span className="text-xl font-normal text-slate-400">/100</span>
          </p>
        </div>
        <button
          type="button"
          onClick={() => setRefineOpen((v) => !v)}
          className="shrink-0 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2"
          aria-expanded={refineOpen}
        >
          Not quite right?
        </button>
      </div>

      {refineOpen && (
        <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-600" role="status">
          Soon you’ll be able to flag a score or moment that’s off and Critiq will
          factor it in. That’s coming in a later update — for now your feedback
          isn’t saved.
        </p>
      )}

      {/* Trust badge + live evidence counter */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200">
          <span aria-hidden>✓</span> Grounded in your call · {groundedCount}/
          {assessedCount} sub-scores cite evidence
        </span>
        {data.partialJudgement && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700 ring-1 ring-amber-200">
            Some dimensions weren’t assessed
          </span>
        )}
      </div>

      {/* Pillar bars */}
      <div className="mt-5 space-y-3">
        {pillarKeys.map((pk) => {
          const p = PILLARS[pk];
          const score = data.pillars[pk] ?? 0;
          const pct = p.maxPoints > 0 ? (score / p.maxPoints) * 100 : 0;
          return (
            <div key={pk}>
              <div className="flex items-baseline justify-between text-sm">
                <span className="font-medium text-slate-800">{p.name}</span>
                <span className="tabular-nums text-slate-500">
                  {data.pillars[pk] ?? "—"}
                  <span className="text-slate-400">/{p.maxPoints}</span>
                </span>
              </div>
              <div
                className="mt-1 h-2 w-full overflow-hidden rounded-full bg-slate-100"
                role="progressbar"
                aria-valuenow={score}
                aria-valuemin={0}
                aria-valuemax={p.maxPoints}
                aria-label={`${p.name} score`}
              >
                <div
                  className="h-full rounded-full"
                  style={{ width: `${pct}%`, backgroundColor: PILLAR_COLOR[pk] }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* Summary */}
      {data.summary && (
        <p className="mt-5 text-sm leading-relaxed text-slate-700">
          {data.summary}
        </p>
      )}

      {/* Strengths + improvements */}
      {(data.strengths.length > 0 || data.improvements.length > 0) && (
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          {data.strengths.length > 0 && (
            <CoachingList
              title="What worked"
              items={data.strengths}
              marker="✓"
              markerClass="text-emerald-600"
            />
          )}
          {data.improvements.length > 0 && (
            <CoachingList
              title="What to work on"
              items={data.improvements}
              marker="→"
              markerClass="text-slate-400"
            />
          )}
        </div>
      )}

      {/* Full 12-point breakdown (collapsed by default — quick-read first) */}
      <div className="mt-5 border-t border-slate-100 pt-4">
        <button
          type="button"
          onClick={() => setShowBreakdown((v) => !v)}
          className="text-sm font-medium text-slate-700 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2"
          aria-expanded={showBreakdown}
        >
          {showBreakdown ? "Hide the full breakdown" : "Show the full 12-point breakdown"}
        </button>

        {showBreakdown && (
          <div className="mt-4 space-y-6">
            {pillarKeys.map((pk) => (
              <div key={pk}>
                <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {PILLARS[pk].name}
                </h4>
                <ul className="mt-2 space-y-3">
                  {dimensionsForPillar(pk).map((dim) => {
                    const d = dims[dim.key];
                    const notAssessed = isNotAssessed(d);
                    const evidence = d?.evidence ?? [];
                    return (
                      <li
                        key={dim.key}
                        className="rounded-xl border border-slate-200 p-3"
                      >
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="text-sm font-medium text-slate-800">
                            {dim.name}
                          </span>
                          <span className="shrink-0 tabular-nums text-sm text-slate-500">
                            {notAssessed ? (
                              <span className="text-slate-400">Not assessed</span>
                            ) : (
                              <>
                                {d?.score ?? 0}
                                <span className="text-slate-400">
                                  /{dim.maxPoints}
                                </span>
                              </>
                            )}
                          </span>
                        </div>
                        {!notAssessed && (d?.rationale ?? "").trim() && (
                          <p className="mt-1 text-sm leading-relaxed text-slate-600">
                            {d?.rationale}
                          </p>
                        )}
                        {evidence.length > 0 ? (
                          <ul className="mt-2 space-y-1">
                            {evidence.map((q, i) => (
                              <li
                                key={i}
                                className="border-l-2 border-slate-200 pl-2 text-sm italic text-slate-500"
                              >
                                “{q}”
                              </li>
                            ))}
                          </ul>
                        ) : (
                          !notAssessed && (
                            <p className="mt-2 text-xs text-amber-700">
                              No transcript quote cited for this score.
                            </p>
                          )
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function CoachingList({
  title,
  items,
  marker,
  markerClass,
}: {
  title: string;
  items: string[];
  marker: string;
  markerClass: string;
}) {
  return (
    <div>
      <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {title}
      </h4>
      <ul className="mt-2 space-y-1.5">
        {items.map((it, i) => (
          <li key={i} className="flex gap-2 text-sm leading-relaxed text-slate-700">
            <span aria-hidden className={`shrink-0 ${markerClass}`}>
              {marker}
            </span>
            <span>{it}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
