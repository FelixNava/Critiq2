/**
 * Anthropic Claude client for the post-call debrief (Phase 20 — Reporter Mode). A
 * thin fetch wrapper — no SDK — mirroring the Phase 16 scorer / Phase 18 brief so
 * request-building and response-parsing are pure, exported, and unit-tested against
 * sample JSON. Nothing here touches the network at import or build time.
 *
 * Model: claude-sonnet-4-6 (the locked tech-stack choice for coaching/summaries).
 * Uses BOTH stable cache layers (methodology forever + rep profile per rep) via
 * buildCachedSystem; the account summary + the rep's report are volatile and live in
 * the user message.
 */

import {
  buildCachedSystem,
  summarizeCacheUsage,
  type CacheUsageSummary,
  type SystemTextBlock,
} from "@/lib/ai/cache";
import { buildSystemPrompt, buildUserPrompt } from "./prompt";
import {
  OBSERVATION_LENSES,
  type DebriefContext,
  type DebriefGenerator,
  type DebriefObservation,
  type DebriefResult,
  type ObservationLens,
} from "./types";

const ANTHROPIC_MESSAGES_ENDPOINT = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

export const DEBRIEF_MODEL = "claude-sonnet-4-6";
/** Headroom for a recap + a few observations + commitments + open questions, plus adaptive thinking. */
export const DEBRIEF_MAX_TOKENS = 4000;

export interface AnthropicRequest {
  model: string;
  max_tokens: number;
  thinking: { type: "adaptive" };
  system: SystemTextBlock[];
  messages: Array<{ role: "user"; content: string }>;
}

/**
 * Build the Messages API request body. Pure — exported so tests assert the model
 * and the two cached layers (methodology + rep profile) without a call. The rep
 * profile is the second layer ONLY when present (buildCachedSystem drops empty layers).
 */
export function buildDebriefRequest(ctx: DebriefContext): AnthropicRequest {
  return {
    model: DEBRIEF_MODEL,
    max_tokens: DEBRIEF_MAX_TOKENS,
    thinking: { type: "adaptive" },
    system: buildCachedSystem([
      { text: buildSystemPrompt() },
      { text: ctx.repProfile ?? "" },
    ]),
    messages: [{ role: "user", content: buildUserPrompt(ctx) }],
  };
}

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

export class AnthropicDebriefError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "AnthropicDebriefError";
  }
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

const LENS_SET = new Set<string>(OBSERVATION_LENSES);

/** Coerce any lens string to a known lens; unknown / missing → 'general'. */
export function coerceLens(raw: unknown): ObservationLens {
  const v = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  return LENS_SET.has(v) ? (v as ObservationLens) : "general";
}

function coerceObservations(raw: unknown): DebriefObservation[] {
  if (!Array.isArray(raw)) return [];
  const out: DebriefObservation[] = [];
  for (const item of raw) {
    // Tolerate a bare string observation as well as { note, lens }.
    if (typeof item === "string") {
      const note = item.trim();
      if (note) out.push({ note, lens: "general" });
      continue;
    }
    const o = (item ?? {}) as Record<string, unknown>;
    const note = str(o.note);
    if (note) out.push({ note, lens: coerceLens(o.lens) });
  }
  return out;
}

/** Coerce a string[] field, dropping non-strings and empties. */
function coerceStringList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    const s = str(item);
    if (s) out.push(s);
  }
  return out;
}

/**
 * Normalize the parsed JSON into a DebriefResult. Tolerant of missing fields; never
 * throws on a well-formed-but-incomplete object (the generate path decides whether
 * the result is usable).
 */
export function parseDebriefJson(parsed: unknown): DebriefResult {
  const obj = (parsed ?? {}) as Record<string, unknown>;
  return {
    recap: str(obj.recap),
    observations: coerceObservations(obj.observations),
    commitments: coerceStringList(obj.commitments),
    openQuestions: coerceStringList(obj.openQuestions),
    summary: str(obj.summary),
  };
}

/**
 * Pull a JSON object out of the model's text (strip a stray code fence, else fall
 * back to the outermost {...} span). Returns null if nothing parseable is found.
 * Same defense as the Phase 16/18 path.
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
 * Extract the debrief from a Messages API response. With adaptive thinking on, the
 * response carries thinking block(s) then a text block with the JSON. Throws
 * AnthropicDebriefError on a refusal, truncation, empty body, unparseable text, or a
 * debrief with no recap AND no observations (an empty debrief is a failure, never
 * persisted as completed — mirrors the script's empty-output rejection).
 */
export function extractDebriefFromResponse(json: unknown): DebriefResult {
  const resp = (json ?? {}) as AnthropicResponse;
  if (resp.stop_reason === "refusal") {
    throw new AnthropicDebriefError("Model refused to produce a debrief.");
  }
  if (resp.stop_reason === "max_tokens") {
    throw new AnthropicDebriefError(
      "Debrief response was truncated (max_tokens).",
    );
  }
  const text = (resp.content ?? [])
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("")
    .trim();
  if (!text) {
    throw new AnthropicDebriefError(
      `No text content in response (stop_reason=${resp.stop_reason ?? "?"}).`,
    );
  }
  const parsed = extractJsonObject(text);
  if (parsed === null) {
    throw new AnthropicDebriefError("Model output was not valid JSON.");
  }
  const result = parseDebriefJson(parsed);
  if (!result.recap && result.observations.length === 0) {
    throw new AnthropicDebriefError(
      "Debrief had no recap and no observations (empty result).",
    );
  }
  return result;
}

function requireApiKey(): string {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    throw new AnthropicDebriefError("ANTHROPIC_API_KEY is not configured.");
  }
  return key;
}

export interface AnthropicDebriefGeneratorOptions {
  /** Inject a fake `fetch` in tests; defaults to the global. */
  fetchImpl?: typeof fetch;
  /** Called once per real call with that call's cache activity (Phase 17 telemetry). */
  onUsage?: (usage: CacheUsageSummary) => void;
}

/** The real Claude-backed DebriefGenerator. */
export class AnthropicDebriefGenerator implements DebriefGenerator {
  private readonly fetchImpl: typeof fetch;
  private readonly onUsage?: (usage: CacheUsageSummary) => void;

  constructor(opts: AnthropicDebriefGeneratorOptions = {}) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.onUsage = opts.onUsage;
  }

  async generate(context: DebriefContext): Promise<DebriefResult> {
    const apiKey = requireApiKey();
    const body = buildDebriefRequest(context);
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
      throw new AnthropicDebriefError(
        `Anthropic request failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new AnthropicDebriefError(
        `Anthropic returned ${res.status}${detail ? `: ${detail.slice(0, 300)}` : ""}`,
        res.status,
      );
    }
    const json = (await res.json()) as AnthropicResponse;
    if (this.onUsage) {
      try {
        this.onUsage(summarizeCacheUsage(json.usage));
      } catch {
        /* ignore telemetry errors */
      }
    }
    return extractDebriefFromResponse(json);
  }
}
