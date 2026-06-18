/**
 * Anthropic Claude client for the pre-call brief (Phase 18). A thin fetch wrapper
 * — no SDK — mirroring the Phase 16 scorer so request-building and response-parsing
 * are pure, exported, and unit-tested against sample JSON. Nothing here touches the
 * network at import or build time.
 *
 * Model: claude-sonnet-4-6 (the locked tech-stack choice for coaching/summaries).
 * This is the first AI consumer to use BOTH stable cache layers the locked memory
 * architecture describes: the methodology block (forever) + the rep profile (per
 * rep), assembled via buildCachedSystem. The account summary + the rep's narration
 * are volatile and live in the user message (never cached).
 */

import {
  buildCachedSystem,
  summarizeCacheUsage,
  type CacheUsageSummary,
  type SystemTextBlock,
} from "@/lib/ai/cache";
import { buildSystemPrompt, buildUserPrompt } from "./prompt";
import type {
  AnticipatedObjection,
  ApproachPoint,
  BriefContext,
  BriefGenerator,
  BriefResult,
} from "./types";

const ANTHROPIC_MESSAGES_ENDPOINT = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

export const BRIEF_MODEL = "claude-sonnet-4-6";
/** Headroom for a diagnosis + a few approach points + objections + summary, plus adaptive thinking. */
export const BRIEF_MAX_TOKENS = 4000;

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
 * profile is the second layer ONLY when present (cold reps drop it; buildCachedSystem
 * also drops any empty layer).
 */
export function buildBriefRequest(ctx: BriefContext): AnthropicRequest {
  return {
    model: BRIEF_MODEL,
    max_tokens: BRIEF_MAX_TOKENS,
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

export class AnthropicBriefError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "AnthropicBriefError";
  }
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function coerceApproach(raw: unknown): ApproachPoint[] {
  if (!Array.isArray(raw)) return [];
  const out: ApproachPoint[] = [];
  for (const item of raw) {
    const o = (item ?? {}) as Record<string, unknown>;
    const focus = str(o.focus);
    const why = str(o.why);
    if (focus) out.push({ focus, why });
  }
  return out;
}

function coerceObjections(raw: unknown): AnticipatedObjection[] {
  if (!Array.isArray(raw)) return [];
  const out: AnticipatedObjection[] = [];
  for (const item of raw) {
    const o = (item ?? {}) as Record<string, unknown>;
    const objection = str(o.objection);
    const response = str(o.response);
    if (objection) out.push({ objection, response });
  }
  return out;
}

/**
 * Normalize the parsed JSON into a BriefResult. Tolerant of missing fields; never
 * throws on a well-formed-but-incomplete object. A recommendedObjective that is
 * empty / "null" string / not a string normalizes to null (the rep-set case).
 */
export function parseBriefJson(parsed: unknown): BriefResult {
  const obj = (parsed ?? {}) as Record<string, unknown>;
  const recRaw = obj.recommendedObjective;
  const rec = typeof recRaw === "string" ? recRaw.trim() : "";
  const recommendedObjective =
    rec.length > 0 && rec.toLowerCase() !== "null" ? rec : null;
  return {
    diagnosis: str(obj.diagnosis),
    recommendedObjective,
    approach: coerceApproach(obj.approach),
    objections: coerceObjections(obj.objections),
    summary: str(obj.summary),
  };
}

/**
 * Pull a JSON object out of the model's text (strip a stray code fence, else fall
 * back to the outermost {...} span). Returns null if nothing parseable is found.
 * Same defense as the Phase 16 scorer.
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
 * Extract the brief from a Messages API response. With adaptive thinking on, the
 * response carries thinking block(s) then a text block with the JSON. Throws
 * AnthropicBriefError on a refusal, truncation, empty body, or unparseable text.
 */
export function extractBriefFromResponse(json: unknown): BriefResult {
  const resp = (json ?? {}) as AnthropicResponse;
  if (resp.stop_reason === "refusal") {
    throw new AnthropicBriefError("Model refused to produce a brief.");
  }
  if (resp.stop_reason === "max_tokens") {
    throw new AnthropicBriefError("Brief response was truncated (max_tokens).");
  }
  const text = (resp.content ?? [])
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("")
    .trim();
  if (!text) {
    throw new AnthropicBriefError(
      `No text content in response (stop_reason=${resp.stop_reason ?? "?"}).`,
    );
  }
  const parsed = extractJsonObject(text);
  if (parsed === null) {
    throw new AnthropicBriefError("Model output was not valid JSON.");
  }
  return parseBriefJson(parsed);
}

function requireApiKey(): string {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    throw new AnthropicBriefError("ANTHROPIC_API_KEY is not configured.");
  }
  return key;
}

export interface AnthropicBriefGeneratorOptions {
  /** Inject a fake `fetch` in tests; defaults to the global. */
  fetchImpl?: typeof fetch;
  /** Called once per real call with that call's cache activity (Phase 17 telemetry). */
  onUsage?: (usage: CacheUsageSummary) => void;
}

/** The real Claude-backed BriefGenerator. */
export class AnthropicBriefGenerator implements BriefGenerator {
  private readonly fetchImpl: typeof fetch;
  private readonly onUsage?: (usage: CacheUsageSummary) => void;

  constructor(opts: AnthropicBriefGeneratorOptions = {}) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.onUsage = opts.onUsage;
  }

  async generate(context: BriefContext): Promise<BriefResult> {
    const apiKey = requireApiKey();
    const body = buildBriefRequest(context);
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
      throw new AnthropicBriefError(
        `Anthropic request failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new AnthropicBriefError(
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
    return extractBriefFromResponse(json);
  }
}
