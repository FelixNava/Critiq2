/**
 * Deepgram Nova-3 client (Phase 15). A thin fetch wrapper — no SDK dependency —
 * so the request-building + response-parsing are pure, exported, and unit-tested
 * against sample JSON. The real round-trip (network + a real audio buffer) is the
 * runtime gate Felix verifies on the preview; nothing here hits the network at
 * import or build time.
 *
 * Why Nova-3: field-noise resilient (warehouses, vehicles, job sites) — beats
 * Whisper for the in-person sales calls Critiq targets (locked stack decision).
 */

import type { Transcriber, TranscriptionOutput, TranscriptWord } from "./types";

const DEEPGRAM_LISTEN_ENDPOINT = "https://api.deepgram.com/v1/listen";

export const DEEPGRAM_MODEL = "nova-3";

export interface DeepgramOptions {
  model?: string;
  /** smart_format: punctuation, casing, paragraphs. */
  smartFormat?: boolean;
  /** diarize: speaker labels (who-said-what for scoring). */
  diarize?: boolean;
  punctuate?: boolean;
  language?: string;
}

const DEFAULT_OPTIONS: Required<Omit<DeepgramOptions, "language">> = {
  model: DEEPGRAM_MODEL,
  smartFormat: true,
  diarize: true,
  punctuate: true,
};

/**
 * Build the Deepgram /listen URL with query params. Pure — exported for unit
 * tests so we can assert the model + flags without a network call.
 */
export function buildListenUrl(opts: DeepgramOptions = {}): string {
  const o = { ...DEFAULT_OPTIONS, ...opts };
  const params = new URLSearchParams();
  params.set("model", o.model);
  params.set("smart_format", String(o.smartFormat));
  params.set("diarize", String(o.diarize));
  params.set("punctuate", String(o.punctuate));
  if (opts.language) params.set("language", opts.language);
  return `${DEEPGRAM_LISTEN_ENDPOINT}?${params.toString()}`;
}

/** The slice of Deepgram's response shape we read. */
interface DeepgramResponse {
  metadata?: { duration?: number };
  results?: {
    channels?: Array<{
      detected_language?: string;
      alternatives?: Array<{
        transcript?: string;
        confidence?: number;
        words?: Array<{
          word?: string;
          start?: number;
          end?: number;
          confidence?: number;
          punctuated_word?: string;
          speaker?: number;
        }>;
      }>;
    }>;
  };
}

/**
 * Parse a Deepgram /listen JSON response into our normalized output. Pure +
 * exported for unit tests. Tolerant of missing fields (a silent clip yields an
 * empty transcript, not a throw).
 */
export function parseDeepgramResponse(json: unknown): TranscriptionOutput {
  const resp = (json ?? {}) as DeepgramResponse;
  const channel = resp.results?.channels?.[0];
  const alt = channel?.alternatives?.[0];
  const words: TranscriptWord[] = (alt?.words ?? []).map((w) => ({
    word: w.word ?? "",
    start: typeof w.start === "number" ? w.start : 0,
    end: typeof w.end === "number" ? w.end : 0,
    confidence: typeof w.confidence === "number" ? w.confidence : 0,
    ...(w.punctuated_word ? { punctuated_word: w.punctuated_word } : {}),
    ...(typeof w.speaker === "number" ? { speaker: w.speaker } : {}),
  }));
  return {
    text: (alt?.transcript ?? "").trim(),
    words,
    confidence: typeof alt?.confidence === "number" ? alt.confidence : 0,
    ...(channel?.detected_language
      ? { language: channel.detected_language }
      : {}),
    ...(typeof resp.metadata?.duration === "number"
      ? { durationSec: resp.metadata.duration }
      : {}),
  };
}

export class DeepgramError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "DeepgramError";
  }
}

/** Reads the Deepgram key at call time (never at import) so build never needs it. */
function requireApiKey(): string {
  const key = process.env.DEEPGRAM_API_KEY;
  if (!key) {
    throw new DeepgramError("DEEPGRAM_API_KEY is not configured.");
  }
  return key;
}

/**
 * The real Deepgram-backed Transcriber. Posts raw audio bytes with the chunk's
 * own content type so Deepgram decodes the container correctly.
 */
export class DeepgramTranscriber implements Transcriber {
  constructor(
    private readonly opts: DeepgramOptions = {},
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async transcribe(
    audio: Uint8Array,
    contentType: string,
  ): Promise<TranscriptionOutput> {
    const apiKey = requireApiKey();
    const url = buildListenUrl(this.opts);
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: "POST",
        headers: {
          Authorization: `Token ${apiKey}`,
          // Forward the stored container/codec; fall back to a generic audio type.
          "Content-Type": contentType || "audio/webm",
        },
        // Uint8Array is a valid BodyInit; cast keeps TS happy across lib targets.
        body: audio as unknown as BodyInit,
      });
    } catch (e) {
      throw new DeepgramError(
        `Deepgram request failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new DeepgramError(
        `Deepgram returned ${res.status}${detail ? `: ${detail.slice(0, 300)}` : ""}`,
        res.status,
      );
    }
    const json = await res.json();
    return parseDeepgramResponse(json);
  }
}
