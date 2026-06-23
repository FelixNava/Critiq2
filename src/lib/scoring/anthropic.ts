/**
 * Anthropic Claude client for scoring (Phase 16). A thin fetch wrapper — no SDK
 * dependency — mirroring Phase 15's Deepgram client, so request-building and
 * response-parsing are pure, exported, and unit-tested against sample JSON. The
 * real Claude round-trip is the runtime gate Felix + the expert coach validate;
 * nothing here hits the network at import or build time.
 *
 * Model: claude-opus-4-8 (Phase 38f) — scoring against the 12-dimension rubric is
 * the highest-stakes judgement in the product. The 12-dim + per-dimension evidence
 * grammar is too large for the API's strict structured-output path, so the JSON
 * shape is specified in the prompt and parsed defensively. Raw-JSON output is
 * non-deterministic, so a transient UNPARSEABLE sampling is retried IN-CALL
 * (isRetryableScoringError) before the row is failed — one bad sampling must not
 * kill the assessment, especially on a preview deploy where the cron sweeper that
 * would otherwise retry does not run. Adaptive thinking is on; the locked
 * methodology system block carries a cache_control breakpoint (Phase 17).
 */

import {
  buildCachedSystem,
  summarizeCacheUsage,
  type CacheUsageSummary,
  type SystemTextBlock,
} from "@/lib/ai/cache";
import { buildSystemPrompt, buildUserPrompt } from "./prompt";
import type { DimensionScore, RawScoreResult, ScorableTranscript, Scorer } from "./types";

const ANTHROPIC_MESSAGES_ENDPOINT = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

// Phase 38f: scoring moved to Opus 4.8 (the deepest reasoning tier) — scoring a
// call against the 12-dimension rubric is the highest-stakes judgment in the
// product, and the credibility core a rep sees. Coaching/consolidation stay on
// Sonnet. NOTE (cache): Opus's advisory cacheable floor is 4096 tokens (vs
// Sonnet's observed ~1024); whether the ~1.6k methodology block still caches on
// Opus is verified empirically (a 2-identical-call probe) rather than assumed —
// growing the methodology block is deferred to the expert-coach calibration pass.
export const SCORING_MODEL = "claude-opus-4-8";
/** Generous headroom: ~12 dimensions × (rationale + a few quotes) + summary, plus adaptive thinking. */
export const SCORING_MAX_TOKENS = 8000;

export interface AnthropicRequest {
  model: string;
  max_tokens: number;
  thinking: { type: "adaptive" };
  system: SystemTextBlock[];
  messages: Array<{ role: "user"; content: string }>;
}

/**
 * Build the Messages API request body. Pure — exported so tests assert the model
 * and the cached methodology block without a call.
 *
 * Note: the 12-dimension rubric + per-dimension evidence arrays compile to a
 * grammar too large for the API's strict structured-output (`output_config`)
 * path (it returns "compiled grammar is too large"). So the JSON shape is
 * specified IN the prompt (buildOutputFormatSpec, rubric-derived) and parsed
 * defensively below — the explicit contract returns clean JSON nearly always; a
 * rare unparseable sampling is retried in-call (see AnthropicScorer), and the
 * engine validates every field regardless.
 */
export function buildScoringRequest(
  transcript: ScorableTranscript,
): AnthropicRequest {
  return {
    model: SCORING_MODEL,
    max_tokens: SCORING_MAX_TOKENS,
    thinking: { type: "adaptive" },
    // The methodology block is identical on every scoring call → its own cache
    // breakpoint (Phase 17). It's the only stable system layer scoring needs;
    // coaching/working-memory phases add the rep-intake layer via the same
    // buildCachedSystem([methodology, repIntake]) (locked memory architecture).
    system: buildCachedSystem([{ text: buildSystemPrompt() }]),
    messages: [{ role: "user", content: buildUserPrompt(transcript) }],
  };
}

/** Minimal shape of the Messages API response we read. */
interface AnthropicResponse {
  stop_reason?: string;
  content?: Array<{ type?: string; text?: string }>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
}

function coerceDimension(raw: unknown): DimensionScore {
  const d = (raw ?? {}) as Record<string, unknown>;
  const score = typeof d.score === "number" ? Math.round(d.score) : 0;
  const rationale = typeof d.rationale === "string" ? d.rationale : "";
  const evidence = Array.isArray(d.evidence)
    ? d.evidence.filter((e): e is string => typeof e === "string")
    : [];
  return { score, rationale, evidence };
}

/**
 * Parse the JSON the model returned (already a parsed object) into a normalized
 * RawScoreResult. Tolerant of missing fields (the engine clamps + flags); never
 * throws on a well-formed-but-incomplete object. The model omitting a dimension
 * is handled downstream by the engine (defaults to 0 + partialJudgement).
 */
export function parseScoreJson(parsed: unknown): RawScoreResult {
  const obj = (parsed ?? {}) as Record<string, unknown>;
  const rawDims = (obj.dimensions ?? {}) as Record<string, unknown>;
  const dimensions: Record<string, DimensionScore> = {};
  for (const [key, value] of Object.entries(rawDims)) {
    dimensions[key] = coerceDimension(value);
  }
  const strArray = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : [];
  return {
    dimensions,
    overallStrengths: strArray(obj.overallStrengths),
    overallImprovements: strArray(obj.overallImprovements),
    summary: typeof obj.summary === "string" ? obj.summary : "",
  };
}

/**
 * Pull a JSON object out of the model's text. The prompt asks for raw JSON, but
 * we defend against a stray markdown code fence or leading/trailing prose by
 * stripping fences and falling back to the outermost {...} span. Returns null if
 * nothing parseable is found.
 */
export function extractJsonObject(text: string): unknown | null {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    // Fall back to the first '{' … last '}' span (handles leading/trailing prose).
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

/**
 * Extract the scoring JSON from a Messages API response. With adaptive thinking
 * on, the response carries thinking block(s) then a text block with the JSON; we
 * concatenate text blocks and parse. Throws AnthropicScoringError on a refusal,
 * a truncation (max_tokens), an empty body, or unparseable text (the runner marks
 * the row failed and the cron retries up to the cap).
 */
export function extractScoreFromResponse(json: unknown): RawScoreResult {
  const resp = (json ?? {}) as AnthropicResponse;
  if (resp.stop_reason === "refusal") {
    throw new AnthropicScoringError("Model refused to score this transcript.");
  }
  if (resp.stop_reason === "max_tokens") {
    throw new AnthropicScoringError("Scoring response was truncated (max_tokens).");
  }
  const text = (resp.content ?? [])
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("")
    .trim();
  if (!text) {
    throw new AnthropicScoringError(
      `No text content in response (stop_reason=${resp.stop_reason ?? "?"}).`,
    );
  }
  const parsed = extractJsonObject(text);
  if (parsed === null) {
    throw new AnthropicScoringError("Model output was not valid JSON.");
  }
  return parseScoreJson(parsed);
}

export class AnthropicScoringError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "AnthropicScoringError";
  }
}

/** Reads the Anthropic key at call time (never at import) so build never needs it. */
function requireApiKey(): string {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    throw new AnthropicScoringError("ANTHROPIC_API_KEY is not configured.");
  }
  return key;
}

export interface AnthropicScorerOptions {
  /** Inject a fake `fetch` in tests; defaults to the global. */
  fetchImpl?: typeof fetch;
  /**
   * Called once per real Claude call with that call's cache activity (Phase 17).
   * The runner uses this to log the methodology-block hit rate; tolerant of a
   * missing usage object. Never throws — a callback error is swallowed so it
   * can't fail the score.
   */
  onUsage?: (usage: CacheUsageSummary) => void;
  /**
   * Total attempts including the first (default 3). A transient unparseable
   * response / empty body / truncation / 429 / 5xx is retried in-call — raw-JSON
   * output is non-deterministic, so one bad sampling must not fail the row
   * (especially on preview, where the cron sweeper that would otherwise retry
   * does not run).
   */
  maxAttempts?: number;
  /** Linear backoff base between retries in ms (default 400; ×attempt). */
  backoffMs?: number;
  /** Injectable sleep so tests don't actually wait between retries. */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Whether a scoring failure is worth re-sampling. A transient parse / empty /
 * truncation error (no HTTP status) is retryable EXCEPT a policy refusal
 * (re-sampling won't change a refusal). An HTTP error retries only on 429 / 5xx;
 * a 4xx (auth / bad request) won't change between attempts. A missing API key is
 * thrown before the retry loop, so it never reaches here.
 */
export function isRetryableScoringError(err: unknown): boolean {
  if (!(err instanceof AnthropicScoringError)) return false;
  if (typeof err.status === "number") {
    return err.status === 429 || err.status >= 500;
  }
  return !/refused/i.test(err.message);
}

/** The real Claude-backed Scorer. */
export class AnthropicScorer implements Scorer {
  private readonly fetchImpl: typeof fetch;
  private readonly onUsage?: (usage: CacheUsageSummary) => void;
  private readonly maxAttempts: number;
  private readonly backoffMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(opts: AnthropicScorerOptions = {}) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.onUsage = opts.onUsage;
    this.maxAttempts = Math.max(1, opts.maxAttempts ?? 3);
    this.backoffMs = Math.max(0, opts.backoffMs ?? 400);
    this.sleep =
      opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  }

  async score(transcript: ScorableTranscript): Promise<RawScoreResult> {
    // The key never changes between attempts → a missing one fails fast, not retried.
    const apiKey = requireApiKey();
    const body = buildScoringRequest(transcript);
    let lastErr: unknown;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      try {
        return await this.scoreOnce(apiKey, body);
      } catch (err) {
        lastErr = err;
        if (attempt >= this.maxAttempts || !isRetryableScoringError(err)) {
          throw err;
        }
        await this.sleep(this.backoffMs * attempt);
      }
    }
    // Unreachable (the loop returns or throws), but satisfies the return type.
    throw lastErr;
  }

  /** One Claude round-trip + parse. Throws AnthropicScoringError on any failure. */
  private async scoreOnce(
    apiKey: string,
    body: AnthropicRequest,
  ): Promise<RawScoreResult> {
    let res: Response;
    try {
      res = await this.fetchImpl(ANTHROPIC_MESSAGES_ENDPOINT, {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": ANTHROPIC_VERSION,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      });
    } catch (e) {
      throw new AnthropicScoringError(
        `Anthropic request failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new AnthropicScoringError(
        `Anthropic returned ${res.status}${detail ? `: ${detail.slice(0, 300)}` : ""}`,
        res.status,
      );
    }
    const json = (await res.json()) as AnthropicResponse;
    // Surface cache activity for observability (Phase 17) before parsing — a bad
    // callback must never sink a good score.
    if (this.onUsage) {
      try {
        this.onUsage(summarizeCacheUsage(json.usage));
      } catch {
        /* ignore telemetry errors */
      }
    }
    return extractScoreFromResponse(json);
  }
}
