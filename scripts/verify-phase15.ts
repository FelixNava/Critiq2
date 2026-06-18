/**
 * Phase 15 unit verification — Deepgram multi-segment transcription, against a
 * FAKE transcriber + a fake chunk fetcher (no network, no Blob). Imports the REAL
 * app modules (no re-implementation, per the standing rule). The actual Deepgram
 * round-trip on real audio is the runtime gate Felix verifies on the preview;
 * this proves the request-building, response-parsing, grouping, concatenation,
 * ordering, bounded parallelism, and partial-failure handling deterministically.
 *
 * Run: pnpm tsx scripts/verify-phase15.ts
 */
import {
  buildListenUrl,
  parseDeepgramResponse,
  DEEPGRAM_MODEL,
} from "../src/lib/transcription/deepgram";
import {
  groupChunksBySegment,
  concatBytes,
  transcribeRecording,
} from "../src/lib/transcription/transcribe";
import type {
  ChunkRef,
  SegmentResult,
  Transcriber,
} from "../src/lib/transcription/types";

const fails: string[] = [];
const ok = (cond: boolean, msg: string) => {
  console.log(`${cond ? "✓" : "✗"} ${msg}`);
  if (!cond) fails.push(msg);
};

const enc = new TextEncoder();
const dec = new TextDecoder();

/** A fake transcriber: text = the decoded bytes (so we can assert WHAT it got). */
function fakeTranscriber(opts?: {
  failContentEquals?: string;
  trackConcurrency?: { current: number; max: number };
  delayTicks?: number;
}): Transcriber {
  return {
    async transcribe(audio, _contentType) {
      const track = opts?.trackConcurrency;
      if (track) {
        track.current += 1;
        track.max = Math.max(track.max, track.current);
      }
      // let other queued tasks start (so the concurrency tracker is meaningful)
      await new Promise((r) => setTimeout(r, opts?.delayTicks ?? 0));
      const text = dec.decode(audio).trim();
      if (track) track.current -= 1;
      if (opts?.failContentEquals && text === opts.failContentEquals) {
        throw new Error("fake transcriber boom");
      }
      const words = text
        ? text.split(/\s+/).map((w, i) => ({
            word: w,
            start: i,
            end: i + 1,
            confidence: 0.9,
          }))
        : [];
      return { text, words, confidence: text ? 0.95 : 0, durationSec: 5 };
    },
  };
}

/** A fake chunk fetcher backed by an in-memory url→string map. */
function fakeFetcher(map: Record<string, string>, failUrl?: string) {
  return async (blobUrl: string) => {
    if (failUrl && blobUrl === failUrl) {
      throw new Error("fake blob read failed");
    }
    const s = map[blobUrl];
    if (s === undefined) throw new Error(`no fake chunk for ${blobUrl}`);
    return { bytes: enc.encode(s), contentType: "audio/webm" };
  };
}

async function main() {
  // ---- Deepgram request building ----
  {
    const url = buildListenUrl();
    ok(url.includes(`model=${DEEPGRAM_MODEL}`), `listen URL pins model=${DEEPGRAM_MODEL}`);
    ok(url.includes("smart_format=true"), "listen URL enables smart_format");
    ok(url.includes("diarize=true"), "listen URL enables diarize (speaker labels)");
    ok(url.includes("punctuate=true"), "listen URL enables punctuate");
    const url2 = buildListenUrl({ language: "en" });
    ok(url2.includes("language=en"), "listen URL passes an explicit language");
  }

  // ---- Deepgram response parsing ----
  {
    const sample = {
      metadata: { duration: 12.5 },
      results: {
        channels: [
          {
            detected_language: "en",
            alternatives: [
              {
                transcript: "So what's keeping you up at night?",
                confidence: 0.987,
                words: [
                  { word: "so", start: 0.1, end: 0.3, confidence: 0.99, punctuated_word: "So", speaker: 0 },
                  { word: "what's", start: 0.3, end: 0.6, confidence: 0.98, punctuated_word: "what's", speaker: 0 },
                ],
              },
            ],
          },
        ],
      },
    };
    const out = parseDeepgramResponse(sample);
    ok(out.text === "So what's keeping you up at night?", "parses the transcript text");
    ok(out.words.length === 2, "parses word-level tokens");
    ok(out.words[0].punctuated_word === "So", "carries punctuated_word (smart_format)");
    ok(out.words[0].speaker === 0, "carries speaker label (diarization)");
    ok(Math.abs(out.confidence - 0.987) < 1e-9, "parses average confidence");
    ok(out.language === "en", "parses detected language");
    ok(out.durationSec === 12.5, "parses audio duration");

    const empty = parseDeepgramResponse({});
    ok(empty.text === "" && empty.words.length === 0 && empty.confidence === 0, "tolerates an empty/missing response (no throw)");
    const silent = parseDeepgramResponse({ results: { channels: [{ alternatives: [{ transcript: "" }] }] } });
    ok(silent.text === "" && silent.words.length === 0, "a silent clip yields an empty transcript");
  }

  // ---- grouping + concat ----
  {
    const chunks: ChunkRef[] = [
      { chunkIndex: 3, segmentIndex: 1, blobUrl: "s1c3" },
      { chunkIndex: 0, segmentIndex: 0, blobUrl: "s0c0" },
      { chunkIndex: 2, segmentIndex: 1, blobUrl: "s1c2" },
      { chunkIndex: 1, segmentIndex: 0, blobUrl: "s0c1" },
    ];
    const grouped = groupChunksBySegment(chunks);
    const segKeys = [...grouped.keys()];
    ok(segKeys.join(",") === "0,1", "groups + orders segments by segmentIndex");
    ok(
      grouped.get(0)!.map((c) => c.chunkIndex).join(",") === "0,1",
      "orders chunks within a segment by chunkIndex",
    );
    ok(
      grouped.get(1)!.map((c) => c.chunkIndex).join(",") === "2,3",
      "orders the second segment's chunks too",
    );

    const cat = concatBytes([enc.encode("ab"), enc.encode("cd"), enc.encode("ef")]);
    ok(dec.decode(cat) === "abcdef", "concatBytes preserves order");
    ok(concatBytes([]).length === 0, "concatBytes of nothing is empty");
  }

  // ---- happy path: 2 segments, parallel, unified concat in order ----
  {
    const chunks: ChunkRef[] = [
      { chunkIndex: 0, segmentIndex: 0, blobUrl: "a0", durationMs: 5000 },
      { chunkIndex: 1, segmentIndex: 0, blobUrl: "a1", durationMs: 5000 },
      { chunkIndex: 2, segmentIndex: 1, blobUrl: "b0", durationMs: 5000 },
    ];
    const map = { a0: "hello ", a1: "world ", b0: "second segment " };
    const seen: SegmentResult[] = [];
    const result = await transcribeRecording(chunks, {
      transcriber: fakeTranscriber(),
      fetchChunk: fakeFetcher(map),
      onSegment: (s) => {
        seen.push(s);
      },
    });
    ok(result.segmentCount === 2, "counts both segments");
    ok(result.text === "hello world\nsecond segment", "concatenates segment transcripts in segment order");
    ok(result.partial === false, "no failures → not partial");
    ok(result.wordCount === 4, "sums word count across segments");
    ok(result.durationMs === 15000, "sums duration across segments (3×5s)");
    ok(seen.length === 2, "onSegment fired once per segment (incremental persist)");
    ok(
      result.segments[0].segmentIndex === 0 && result.segments[1].segmentIndex === 1,
      "segment results are in segment order",
    );
  }

  // ---- the transcriber receives the CORRECT concatenated bytes per segment ----
  {
    const received: string[] = [];
    const recordingTranscriber: Transcriber = {
      async transcribe(audio) {
        received.push(dec.decode(audio));
        return { text: dec.decode(audio).trim(), words: [], confidence: 0.9 };
      },
    };
    const chunks: ChunkRef[] = [
      { chunkIndex: 0, segmentIndex: 0, blobUrl: "x0" },
      { chunkIndex: 1, segmentIndex: 0, blobUrl: "x1" },
      { chunkIndex: 2, segmentIndex: 1, blobUrl: "y0" },
    ];
    await transcribeRecording(chunks, {
      transcriber: recordingTranscriber,
      fetchChunk: fakeFetcher({ x0: "AA", x1: "BB", y0: "CC" }),
    });
    ok(received.includes("AABB"), "segment 0 is the concat of its chunks (AA+BB)");
    ok(received.includes("CC"), "segment 1 is its single chunk (CC)");
    ok(!received.includes("AABBCC"), "segments are NOT cross-contaminated");
  }

  // ---- partial failure: one segment fails, the rest survive ----
  {
    const chunks: ChunkRef[] = [
      { chunkIndex: 0, segmentIndex: 0, blobUrl: "g0" },
      { chunkIndex: 1, segmentIndex: 1, blobUrl: "bad" },
      { chunkIndex: 2, segmentIndex: 2, blobUrl: "g2" },
    ];
    const result = await transcribeRecording(chunks, {
      transcriber: fakeTranscriber(),
      fetchChunk: fakeFetcher({ g0: "good one ", g2: "good three " }, "bad"),
    });
    ok(result.partial === true, "a failed segment flags the transcript partial");
    ok(result.text === "good one\ngood three", "the surviving segments still concatenate (no total loss)");
    const failed = result.segments.find((s) => s.segmentIndex === 1)!;
    ok(!!failed.error, "the failed segment carries its error");
    ok(result.segments.filter((s) => s.error).length === 1, "exactly one segment failed");
  }

  // ---- bounded concurrency is respected ----
  {
    const chunks: ChunkRef[] = Array.from({ length: 6 }, (_, i) => ({
      chunkIndex: i,
      segmentIndex: i, // 6 distinct segments
      blobUrl: `c${i}`,
    }));
    const map = Object.fromEntries(chunks.map((c) => [c.blobUrl, `seg${c.segmentIndex} `]));
    const track = { current: 0, max: 0 };
    const result = await transcribeRecording(chunks, {
      transcriber: fakeTranscriber({ trackConcurrency: track, delayTicks: 5 }),
      fetchChunk: fakeFetcher(map),
      concurrency: 2,
    });
    ok(result.segmentCount === 6, "transcribes all 6 segments");
    ok(track.max <= 2, `never exceeds the concurrency cap (peak ${track.max} ≤ 2)`);
    ok(track.max >= 2, "actually runs segments in parallel (peak reached the cap)");
  }

  // ---- empty recording ----
  {
    const result = await transcribeRecording([], {
      transcriber: fakeTranscriber(),
      fetchChunk: fakeFetcher({}),
    });
    ok(result.text === "" && result.segmentCount === 0 && result.wordCount === 0, "an empty recording yields an empty result (no throw)");
  }

  if (fails.length) {
    console.error(`\n✗ ${fails.length} assertion(s) failed.`);
    process.exit(1);
  }
  console.log("\n✓ Phase 15 unit verification PASSED.");
}

main().catch((e) => {
  console.error("PROBE ERROR:", e);
  process.exit(1);
});
