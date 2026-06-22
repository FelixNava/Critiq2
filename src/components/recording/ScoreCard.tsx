"use client";

import { useId, useState } from "react";
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
 * A dimension the model OMITTED shows as "Not assessed" (never a misleading 0).
 * Only a fully-empty dimension counts: no points, no rationale, AND no quote. A
 * real "skill absent" 0 carries a rationale (and legitimately no quote), and a 0
 * that still cites a quote is clearly assessed — both stay real scores, not
 * "Not assessed". (Keeping evidence in the test also stops the trust counter from
 * ever exceeding its denominator.)
 */
function isNotAssessed(d: StoredDim | undefined): boolean {
  return (
    (d?.score ?? 0) === 0 &&
    !(d?.rationale ?? "").trim() &&
    (d?.evidence?.length ?? 0) === 0
  );
}

export default function ScoreCard({ data }: { data: ScoreCardData }) {
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [refineOpen, setRefineOpen] = useState(false);
  const refineId = useId();
  const breakdownId = useId();

  const dims = data.dimensions ?? {};
  const pillarKeys: PillarKey[] = ["spin", "voss", "navarro"];

  // Trust: of the sub-scores that AWARDED points, how many cite a verbatim
  // quote? A positive score with no quote is a real grounding gap; a 0 (skill
  // absent) legitimately has no quote, so it stays out of the denominator. This
  // keeps groundedCount ≤ scoredCount by construction.
  const allDims = Object.values(PILLARS).flatMap((p) =>
    dimensionsForPillar(p.key),
  );
  const scoredCount = allDims.filter((d) => (dims[d.key]?.score ?? 0) > 0).length;
  const groundedCount = allDims.filter(
    (d) => (dims[d.key]?.score ?? 0) > 0 && (dims[d.key]?.evidence?.length ?? 0) > 0,
  ).length;
  const fullyGrounded = scoredCount > 0 && groundedCount === scoredCount;

  return (
    <div>
      {/* Overall + refine affordance */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm text-slate-500">Overall</p>
          <p className="text-4xl font-semibold tracking-tight text-slate-900">
            {data.overall ?? "—"}
            <span className="text-xl font-normal text-slate-500">/100</span>
          </p>
        </div>
        <button
          type="button"
          onClick={() => setRefineOpen((v) => !v)}
          className="inline-flex min-h-[44px] shrink-0 items-center rounded-lg border border-slate-200 px-3 text-xs font-medium text-slate-600 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2"
          aria-expanded={refineOpen}
          aria-controls={refineId}
        >
          Not quite right?
        </button>
      </div>

      {refineOpen && (
        <p
          id={refineId}
          className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-600"
        >
          Soon you’ll be able to flag a score or moment that’s off and Critiq will
          factor it in. That’s coming in a later update — for now your feedback
          isn’t saved.
        </p>
      )}

      {/* Trust badge + live evidence counter */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {scoredCount === 0 ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600 ring-1 ring-slate-200">
            Grounded in your call once scored
          </span>
        ) : (
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${
              fullyGrounded
                ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                : "bg-amber-50 text-amber-700 ring-amber-200"
            }`}
          >
            {/* Verdict carried in text (not color/glyph alone) for SR + colorblind users. */}
            <span className="sr-only">
              {fullyGrounded ? "Fully grounded: " : "Partly grounded: "}
            </span>
            <span aria-hidden>{fullyGrounded ? "✓" : "⚠"}</span> Grounded in your
            call · {groundedCount} of {scoredCount} scored areas cite evidence
          </span>
        )}
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
          const raw = data.pillars[pk];
          const score = raw ?? 0;
          const pct = p.maxPoints > 0 ? (score / p.maxPoints) * 100 : 0;
          // Floor a real (>0) score's fill so a small score is never an
          // invisible sliver mistaken for zero.
          const fillPct = score > 0 ? Math.max(pct, 4) : 0;
          return (
            <div key={pk}>
              <div className="flex items-baseline justify-between text-sm">
                <span className="font-medium text-slate-800">{p.name}</span>
                <span className="tabular-nums text-slate-500">
                  {raw ?? "—"}
                  <span className="text-slate-500">/{p.maxPoints}</span>
                </span>
              </div>
              <div
                className="mt-1 h-2 w-full overflow-hidden rounded-full bg-slate-100"
                role="progressbar"
                aria-valuenow={score}
                aria-valuemin={0}
                aria-valuemax={p.maxPoints}
                aria-valuetext={raw == null ? "Not scored" : undefined}
                aria-label={`${p.name} score`}
              >
                <div
                  className="h-full rounded-full"
                  style={{ width: `${fillPct}%`, backgroundColor: PILLAR_COLOR[pk] }}
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
              markerClass="text-slate-500"
            />
          )}
        </div>
      )}

      {/* Full 12-point breakdown (collapsed by default — quick-read first) */}
      <div className="mt-5 border-t border-slate-100 pt-4">
        <button
          type="button"
          onClick={() => setShowBreakdown((v) => !v)}
          className="inline-flex min-h-[44px] items-center gap-1.5 text-sm font-medium text-slate-700 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2"
          aria-expanded={showBreakdown}
          aria-controls={breakdownId}
        >
          <span aria-hidden className="text-slate-500">
            {showBreakdown ? "▾" : "▸"}
          </span>
          {showBreakdown ? "Hide the full breakdown" : "Show the full 12-point breakdown"}
        </button>

        {showBreakdown && (
          <div id={breakdownId} className="mt-4 space-y-6">
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
                              <span className="text-slate-500">Not assessed</span>
                            ) : (
                              <>
                                {d?.score ?? 0}
                                <span className="text-slate-500">
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
                                className="border-l-2 border-slate-200 pl-2 text-sm italic text-slate-600"
                              >
                                “{q}”
                              </li>
                            ))}
                          </ul>
                        ) : (
                          // A positive score with no quote is the real grounding
                          // gap; a 0 (skill absent) legitimately has no quote.
                          (d?.score ?? 0) > 0 && (
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
