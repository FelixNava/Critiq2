/**
 * Anthropic Claude client for the Coaching Output Layer (Phase 21). A thin fetch
 * wrapper — no SDK — mirroring the Phase 16 scorer / Phase 18 brief / Phase 20
 * debrief so request-building and response-parsing are pure, exported, and
 * unit-tested against sample JSON. Nothing here touches the network at import or
 * build time.
 *
 * Model: claude-sonnet-4-6 (the locked tech-stack choice for coaching/summaries).
 * Uses BOTH stable cache layers (methodology forever + rep profile per rep) via
 * buildCachedSystem; the account summary + the debrief + the score are volatile and
 * live in the user message.
 */

import {
  buildCachedSystem,
  summarizeCacheUsage,
  type CacheUsageSummary,
  type SystemTextBlock,
} from "@/lib/ai/cache";
import { buildSystemPrompt, buildUserPrompt } from "./prompt";
import {
  COACHING_LENSES,
  type CoachingContext,
  type CoachingGenerator,
  type CoachingLens,
  type CoachingPriority,
  type CoachingReinforcement,
  type CoachingResult,
} from "./types";

const ANTHROPIC_MESSAGES_ENDPOINT = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

export const COACHING_MODEL = "claude-sonnet-4-6";
/** Headroom for a few priorities + reinforcements + a next step, plus adaptive thinking. */
export const COACHING_MAX_TOKENS = 4000;

export interface AnthropicRequest {
  model: string;
  max_tokens: number;
  thinking: { type: "adaptive" };
  system: SystemTextBlock[];
  messages: Array<{ role: "user"; content: string }>;
}

/**
 * Build the Messages API request body. Pure — exported so tests assert the model and
 * the two cached layers (methodology + rep profile) without a call. The rep profile
 * is the second layer ONLY when present (buildCachedSystem drops empty layers).
 */
export function buildCoachingRequest(ctx: CoachingContext): AnthropicRequest {
  return {
    model: COACHING_MODEL,
    max_tokens: COACHING_MAX_TOKENS,
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

export class AnthropicCoachingError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "AnthropicCoachingError";
  }
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

const LENS_SET = new Set<string>(COACHING_LENSES);

/** Coerce any lens string to a known lens; unknown / missing → 'general'. */
export function coerceLens(raw: unknown): CoachingLens {
  const v = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  return LENS_SET.has(v) ? (v as CoachingLens) : "general";
}

function coercePriorities(raw: unknown): CoachingPriority[] {
  if (!Array.isArray(raw)) return [];
  const out: CoachingPriority[] = [];
  for (const item of raw) {
    const o = (item ?? {}) as Record<string, unknown>;
    const focus = str(o.focus);
    const action = str(o.action);
    // A priority is only useful with an actionable instruction; require `action`.
    // Fall back to the action as the focus if the model omitted a label.
    if (!action) continue;
    out.push({ focus: focus || action, lens: coerceLens(o.lens), action });
  }
  return out;
}

function coerceReinforcements(raw: unknown): CoachingReinforcement[] {
  if (!Array.isArray(raw)) return [];
  const out: CoachingReinforcement[] = [];
  for (const item of raw) {
    // Tolerate a bare string ("kept a calm pace") as well as { focus, lens, note }.
    if (typeof item === "string") {
      const note = item.trim();
      if (note) out.push({ focus: note, lens: "general", note });
      continue;
    }
    const o = (item ?? {}) as Record<string, unknown>;
    const note = str(o.note);
    const focus = str(o.focus);
    if (!note && !focus) continue;
    out.push({
      focus: focus || note,
      lens: coerceLens(o.lens),
      note: note || focus,
    });
  }
  return out;
}

/**
 * Normalize the parsed JSON into a CoachingResult. Tolerant of missing fields; never
 * throws on a well-formed-but-incomplete object (the generate path decides whether
 * the result is usable via extractCoachingFromResponse).
 */
export function parseCoachingJson(parsed: unknown): CoachingResult {
  const obj = (parsed ?? {}) as Record<string, unknown>;
  return {
    priorities: coercePriorities(obj.priorities),
    reinforce: coerceReinforcements(obj.reinforce),
    nextStep: str(obj.nextStep),
    summary: str(obj.summary),
  };
}

/**
 * Pull a JSON object out of the model's text (strip a stray code fence, else fall
 * back to the outermost {...} span). Returns null if nothing parseable is found.
 * Same defense as the Phase 16/18/20 path.
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
 * Extract the coaching from a Messages API response. With adaptive thinking on, the
 * response carries thinking block(s) then a text block with the JSON. Throws
 * AnthropicCoachingError on a refusal, truncation, empty body, unparseable text, or
 * coaching with NO priorities AND no next step (empty coaching is a failure, never
 * persisted as completed — mirrors the script/debrief empty-output rejection).
 */
export function extractCoachingFromResponse(json: unknown): CoachingResult {
  const resp = (json ?? {}) as AnthropicResponse;
  if (resp.stop_reason === "refusal") {
    throw new AnthropicCoachingError("Model refused to produce coaching.");
  }
  if (resp.stop_reason === "max_tokens") {
    throw new AnthropicCoachingError(
      "Coaching response was truncated (max_tokens).",
    );
  }
  const text = (resp.content ?? [])
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("")
    .trim();
  if (!text) {
    throw new AnthropicCoachingError(
      `No text content in response (stop_reason=${resp.stop_reason ?? "?"}).`,
    );
  }
  const parsed = extractJsonObject(text);
  if (parsed === null) {
    throw new AnthropicCoachingError("Model output was not valid JSON.");
  }
  const result = parseCoachingJson(parsed);
  if (result.priorities.length === 0 && !result.nextStep) {
    throw new AnthropicCoachingError(
      "Coaching had no priorities and no next step (empty result).",
    );
  }
  return result;
}

function requireApiKey(): string {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    throw new AnthropicCoachingError("ANTHROPIC_API_KEY is not configured.");
  }
  return key;
}

export interface AnthropicCoachingGeneratorOptions {
  /** Inject a fake `fetch` in tests; defaults to the global. */
  fetchImpl?: typeof fetch;
  /** Called once per real call with that call's cache activity (Phase 17 telemetry). */
  onUsage?: (usage: CacheUsageSummary) => void;
}

/** The real Claude-backed CoachingGenerator. */
export class AnthropicCoachingGenerator implements CoachingGenerator {
  private readonly fetchImpl: typeof fetch;
  private readonly onUsage?: (usage: CacheUsageSummary) => void;

  constructor(opts: AnthropicCoachingGeneratorOptions = {}) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.onUsage = opts.onUsage;
  }

  async generate(context: CoachingContext): Promise<CoachingResult> {
    const apiKey = requireApiKey();
    const body = buildCoachingRequest(context);
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
      throw new AnthropicCoachingError(
        `Anthropic request failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new AnthropicCoachingError(
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
    return extractCoachingFromResponse(json);
  }
}
