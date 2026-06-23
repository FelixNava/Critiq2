import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import AppHeader from "@/components/AppHeader";
import RecordingStatusPoller from "@/components/recording/RecordingStatusPoller";
import {
  pipelineState,
  toneClass,
  fmtDuration,
  fmtRecordingDate,
  recordingLabel,
  coveragePct,
} from "@/components/recording/recordingUi";
import { getRecordingForUser, getAudioChunkRefs } from "@/lib/recordings";
import { buildAudioPlan } from "@/lib/recording/audioPlan";
import { getTranscriptForRecording } from "@/lib/transcription/store";
import { getScoreForRecording } from "@/lib/scoring/store";
import { getAccountNameById } from "@/lib/accounts";
import ScoreCard, { type ScoreCardData } from "@/components/recording/ScoreCard";
import TranscriptView from "@/components/recording/TranscriptView";
import RecordingAudioPlayer from "@/components/recording/RecordingAudioPlayer";

export const dynamic = "force-dynamic";

/**
 * Recording Analysis Page (Phase 38b skeleton). The first surface for the
 * already-built capture → transcript → score pipeline. Owner-scoped (the rep
 * owns the recording = the access boundary). This skeleton stands up the page,
 * the access boundary, and HONEST pipeline states; the rich renders land next:
 *   - audio playback (Zone C) — Phase 38c (single-segment live; multi-segment +
 *     iOS pending the device gate)
 *   - synced transcript (Zone D) — Phase 38d
 *   - full assessment + coachable moments (Zones A/B) — Phase 38e / 39
 * No fabricated content in any pending/failed state.
 */
export default async function RecordingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) redirect("/login");

  const { id } = await params;
  const recording = await getRecordingForUser(userId, id);
  // Ownership is the access boundary; a soft-deleted recording reads as gone.
  if (!recording || recording.deletedAt) notFound();

  const [transcriptRow, score, account, audioRefs] = await Promise.all([
    getTranscriptForRecording(id),
    getScoreForRecording(id),
    recording.accountId
      ? getAccountNameById(recording.accountId)
      : Promise.resolve(null),
    getAudioChunkRefs(id),
  ]);
  // Server-side playback availability (metadata only — no bytes fetched). Gates
  // whether the player renders so the rep never sees a dead control.
  const audioPlan = buildAudioPlan(audioRefs);

  const transcriptStatus = transcriptRow?.transcript.status ?? null;
  const scoreStatus = score?.status ?? null;
  const wordCount = transcriptRow?.transcript.wordCount ?? null;
  const transcriptText = transcriptRow?.transcript.text?.trim()
    ? transcriptRow.transcript.text
    : "";

  const state = pipelineState({
    status: recording.status,
    transcriptStatus,
    scoreStatus,
    overallScore: score?.overallScore ?? null,
  });

  const isRecording = recording.status === "recording";
  const transcriptReady =
    transcriptStatus === "completed" || transcriptStatus === "partial";
  const transcriptInProgress =
    transcriptStatus === "pending" || transcriptStatus === "processing";
  const transcriptFailed = transcriptStatus === "failed";
  const scoreInProgress = scoreStatus === "pending" || scoreStatus === "processing";
  const scoreReady = scoreStatus === "completed";
  const scoreFailed = scoreStatus === "failed";

  // The full scorecard data (Phase 38e), coerced from the call_scores jsonb.
  const scoreCardData: ScoreCardData | null =
    score && scoreReady
      ? {
          overall: score.overallScore,
          pillars: {
            spin: score.spinScore,
            voss: score.vossScore,
            navarro: score.navarroScore,
          },
          dimensions:
            score.dimensions &&
            typeof score.dimensions === "object" &&
            !Array.isArray(score.dimensions)
              ? (score.dimensions as ScoreCardData["dimensions"])
              : null,
          strengths: Array.isArray(score.strengths)
            ? (score.strengths as string[])
            : [],
          improvements: Array.isArray(score.improvements)
            ? (score.improvements as string[])
            : [],
          summary: score.summary,
          partialJudgement: score.partialJudgement,
        }
      : null;

  // "No scorable audio": the transcript finished but found essentially no speech.
  const noScorableAudio = transcriptReady && (wordCount ?? 0) === 0;
  // Some audio was lost during capture (gap recovery). Honest, not a fake 100%.
  const hasGaps = (recording.gapCount ?? 0) > 0;
  const coverage = coveragePct(recording.durationMs, recording.gapMs);

  // Poll only while the pipeline is genuinely expected to advance. For an
  // unassigned recording nothing runs until it's assigned, so we don't spin.
  const pipelineActive =
    isRecording ||
    transcriptInProgress ||
    scoreInProgress ||
    (recording.accountId != null &&
      recording.status === "completed" &&
      (transcriptStatus === null || (transcriptReady && scoreStatus === null)));

  const startedIso = recording.startedAt.toISOString();

  return (
    <div className="min-h-dvh bg-slate-50">
      <AppHeader backHref="/recordings" backLabel="Recordings" />
      <RecordingStatusPoller active={pipelineActive} />

      <main className="mx-auto max-w-6xl px-6 py-10">
        {/* Title + meta + pipeline state */}
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-semibold text-slate-900">
              {recordingLabel({ title: recording.title, startedAt: startedIso })}
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              {fmtRecordingDate(startedIso)} · {fmtDuration(recording.durationMs)}
              {hasGaps && coverage != null && (
                <span className="text-amber-700"> · {coverage}% captured</span>
              )}
            </p>
          </div>
          <span
            className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${toneClass[state.tone]}`}
          >
            {state.label}
          </span>
        </div>

        {/* Account chip / assign prompt */}
        <div className="mt-4">
          {account ? (
            <Link
              href={`/accounts/${account.id}`}
              className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-sm font-medium text-slate-700 transition hover:bg-slate-200"
            >
              {account.name}
            </Link>
          ) : (
            <span className="inline-flex flex-wrap items-center gap-2 rounded-full bg-amber-50 px-3 py-1 text-sm font-medium text-amber-800 ring-1 ring-amber-200">
              <span
                aria-hidden
                className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500"
              />
              Unassigned
              <Link
                href="/recordings"
                className="font-semibold underline underline-offset-2 hover:text-amber-900"
              >
                Assign it to an account
              </Link>
            </span>
          )}
        </div>

        {/* Two-column on desktop; single column on mobile. The right column
            (player + transcript) sticks on desktop. Player-first mobile order +
            the sticky mini-player land with the real player in Phase 38c. */}
        <div className="mt-8 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(340px,400px)] lg:items-start lg:gap-8">
          <div className="space-y-6">
            <Zone title="Your assessment">
              {isRecording ? (
                <Muted>This call is still recording. The assessment runs once it’s saved.</Muted>
              ) : scoreReady && scoreCardData ? (
                <ScoreCard data={scoreCardData} />
              ) : scoreInProgress ? (
                <Skeleton lines={3} label="Scoring this call…" />
              ) : scoreFailed ? (
                <Muted>
                  Critiq couldn’t finish assessing this call. You can re-run it
                  once playback and the assessment view land.
                </Muted>
              ) : noScorableAudio ? (
                <Muted>
                  No speech was detected in this recording, so there’s nothing to
                  assess.
                </Muted>
              ) : transcriptReady ? (
                <Skeleton lines={2} label="Preparing the assessment…" />
              ) : transcriptFailed ? (
                <Muted>
                  Transcription didn’t complete, so this call can’t be assessed
                  yet.
                </Muted>
              ) : (
                <Muted>The assessment runs after the transcript is ready.</Muted>
              )}
            </Zone>

            <Zone title="Coachable moments">
              <Muted>
                The key moments from this call — what to keep doing and what to
                try instead — land here next.
              </Muted>
            </Zone>
          </div>

          <div className="mt-6 space-y-6 lg:mt-0 lg:sticky lg:top-6">
            <Zone title="Playback">
              {isRecording ? (
                <Muted>Audio playback appears once the recording is saved.</Muted>
              ) : audioPlan.status === "ready" ? (
                <RecordingAudioPlayer
                  recordingId={id}
                  durationLabel={
                    recording.durationMs
                      ? fmtDuration(recording.durationMs)
                      : null
                  }
                  hasGaps={hasGaps}
                  coveragePct={coverage}
                />
              ) : audioPlan.status === "multisegment" ? (
                <Muted>
                  This call was recorded in multiple parts. Combined playback is
                  coming soon — the transcript and assessment are complete below.
                </Muted>
              ) : audioPlan.status === "incomplete" ? (
                <Muted>
                  Some audio didn’t finish uploading
                  {coverage != null ? ` (${coverage}% captured)` : ""}, so
                  playback isn’t available for this call.
                </Muted>
              ) : (
                <Muted>No audio is stored for this call.</Muted>
              )}
            </Zone>

            <Zone title="Transcript">
              {isRecording ? (
                <Muted>The transcript appears once the recording is saved.</Muted>
              ) : transcriptReady ? (
                transcriptText ? (
                  <TranscriptView text={transcriptText} wordCount={wordCount} />
                ) : (
                  <Muted>No speech was detected in this recording.</Muted>
                )
              ) : transcriptInProgress ? (
                <Skeleton lines={4} label="Transcribing this call…" />
              ) : transcriptFailed ? (
                <Muted>
                  Transcription didn’t complete for this recording.
                </Muted>
              ) : recording.accountId == null ? (
                <Muted>
                  Assign this recording to an account to transcribe and score it.
                </Muted>
              ) : (
                <Skeleton lines={3} label="Queued for transcription…" />
              )}
            </Zone>
          </div>
        </div>
      </main>
    </div>
  );
}

function Zone({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Muted({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <p className={`text-sm leading-relaxed text-slate-600 ${className}`}>
      {children}
    </p>
  );
}

/** Honest "work in progress" placeholder — shimmer bars + a status label. */
function Skeleton({ lines, label }: { lines: number; label: string }) {
  return (
    <div>
      <div className="space-y-2" aria-hidden>
        {Array.from({ length: lines }).map((_, i) => (
          <div
            key={i}
            className="h-3 animate-pulse rounded bg-slate-100"
            style={{ width: `${100 - i * 12}%` }}
          />
        ))}
      </div>
      <p className="mt-3 text-sm text-slate-500" role="status">
        {label}
      </p>
    </div>
  );
}
