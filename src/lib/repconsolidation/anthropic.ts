/**
 * Anthropic Claude client for rep consolidation (Phase 24). A thin fetch wrapper — no
 * SDK — mirroring the Phase 16 scorer / Phase 20 debrief / Phase 21 coaching / Phase 23
 * account consolidation so request-building and response-parsing are pure, exported, and
 * unit-tested against sample JSON. Nothing here touches the network at import or build
 * time.
 *
 * Model: claude-sonnet-4-6 (the locked tech-stack choice for summaries). Uses ONE cached
 * system layer (the rep-consolidation methodology, forever) — there is no static-intake
 * layer, because this phase BUILDS the learned rep profile from debriefs.
 *
 * SOURCE-ATTRIBUTION GUARDRAIL: the model attributes each trait to a debrief LABEL ("D1",
 * "D2", …) shown in the prompt. parseRepConsolidationJson is given the set of valid
 * labels and DROPS any trait whose sourceDebriefId isn't one of them — a pattern Critiq
 * can't ground in a real interaction never reaches the profile (the same "don't trust the
 * model's shape" guard as the scorer's clamp / the account consolidator's drop). The
 * runner maps the surviving labels back to real debrief ids.
 */

import {
  buildCachedSystem,
  summarizeCacheUsage,
  type CacheUsageSummary,
  type SystemTextBlock,
} from "@/lib/ai/cache";
import { buildSystemPrompt, buildUserPrompt } from "./prompt";
import {
  REP_TRAIT_LENSES,
  type RepConsolidationContext,
  type RepConsolidationGenerator,
  type RepConsolidationResult,
  type RepTrait,
  type RepTraitLens,
} from "./types";

const ANTHROPIC_MESSAGES_ENDPOINT = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

export const REP_CONSOLIDATION_MODEL = "claude-sonnet-4-6";
/** Headroom for a headline + a few sentences + an attributed trait list, plus thinking. */
export const REP_CONSOLIDATION_MAX_TOKENS = 4000;

export interface AnthropicRequest {
  model: string;
  max_tokens: number;
  thinking: { type: "adaptive" };
  system: SystemTextBlock[];
  messages: Array<{ role: "user"; content: string }>;
}

/**
 * Build the Messages API request body. Pure — exported so tests assert the model and the
 * single cached methodology layer without a call.
 */
export function buildRepConsolidationRequest(
  ctx: RepConsolidationContext,
): AnthropicRequest {
  return {
    model: REP_CONSOLIDATION_MODEL,
    max_tokens: REP_CONSOLIDATION_MAX_TOKENS,
    thinking: { type: "adaptive" },
    system: buildCachedSystem([{ text: buildSystemPrompt() }]),
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

export class AnthropicRepConsolidationError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "AnthropicRepConsolidationError";
  }
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

const LENS_SET = new Set<string>(REP_TRAIT_LENSES);

/** Coerce any lens string to a known lens; unknown / missing → 'general'. */
export function coerceLens(raw: unknown): RepTraitLens {
  const v = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  return LENS_SET.has(v) ? (v as RepTraitLens) : "general";
}

/**
 * Coerce the raw traits array, keeping only traits that (a) have text and (b) cite a
 * sourceDebriefId present in `validLabels`. The validity check is the attribution
 * guardrail — an un-attributable trait is dropped, not stored. The surviving
 * sourceDebriefId is a LABEL (e.g. "D1"); the runner maps it to the real debrief id.
 */
export function coerceTraits(
  raw: unknown,
  validLabels: Set<string>,
): RepTrait[] {
  if (!Array.isArray(raw)) return [];
  const out: RepTrait[] = [];
  for (const item of raw) {
    const o = (item ?? {}) as Record<string, unknown>;
    const text = str(o.text);
    const sourceDebriefId = str(o.sourceDebriefId);
    if (!text) continue;
    if (!validLabels.has(sourceDebriefId)) continue; // un-attributable → drop
    out.push({ text, lens: coerceLens(o.lens), sourceDebriefId });
  }
  return out;
}

/**
 * Normalize the parsed JSON into a RepConsolidationResult. `validLabels` is the set of
 * debrief labels shown to the model; traits attributed outside it are dropped. Never
 * throws on a well-formed-but-incomplete object (extractRepConsolidationFromResponse
 * decides usability).
 */
export function parseRepConsolidationJson(
  parsed: unknown,
  validLabels: Set<string>,
): RepConsolidationResult {
  const obj = (parsed ?? {}) as Record<string, unknown>;
  return {
    headline: str(obj.headline),
    narrative: str(obj.narrative),
    traits: coerceTraits(obj.traits, validLabels),
  };
}

/**
 * Pull a JSON object out of the model's text (strip a stray code fence, else fall back to
 * the outermost {...} span). Returns null if nothing parseable is found. Same defense as
 * the Phase 16/20/21/23 path.
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
 * Extract the rep profile from a Messages API response. With adaptive thinking on, the
 * response carries thinking block(s) then a text block with the JSON. Throws
 * AnthropicRepConsolidationError on a refusal, truncation, empty body, unparseable text,
 * or an EMPTY result (no narrative AND no traits — never persisted as completed, like the
 * account consolidator's empty-result rejection).
 */
export function extractRepConsolidationFromResponse(
  json: unknown,
  validLabels: Set<string>,
): RepConsolidationResult {
  const resp = (json ?? {}) as AnthropicResponse;
  if (resp.stop_reason === "refusal") {
    throw new AnthropicRepConsolidationError(
      "Model refused to produce a rep profile.",
    );
  }
  if (resp.stop_reason === "max_tokens") {
    throw new AnthropicRepConsolidationError(
      "Rep consolidation response was truncated (max_tokens).",
    );
  }
  const text = (resp.content ?? [])
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("")
    .trim();
  if (!text) {
    throw new AnthropicRepConsolidationError(
      `No text content in response (stop_reason=${resp.stop_reason ?? "?"}).`,
    );
  }
  const parsed = extractJsonObject(text);
  if (parsed === null) {
    throw new AnthropicRepConsolidationError("Model output was not valid JSON.");
  }
  const result = parseRepConsolidationJson(parsed, validLabels);
  if (!result.narrative && result.traits.length === 0) {
    throw new AnthropicRepConsolidationError(
      "Rep consolidation produced no narrative and no attributed traits (empty result).",
    );
  }
  return result;
}

function requireApiKey(): string {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    throw new AnthropicRepConsolidationError(
      "ANTHROPIC_API_KEY is not configured.",
    );
  }
  return key;
}

export interface AnthropicRepConsolidationGeneratorOptions {
  /** Inject a fake `fetch` in tests; defaults to the global. */
  fetchImpl?: typeof fetch;
  /** Called once per real call with that call's cache activity (Phase 17 telemetry). */
  onUsage?: (usage: CacheUsageSummary) => void;
}

/** The real Claude-backed RepConsolidationGenerator. */
export class AnthropicRepConsolidationGenerator
  implements RepConsolidationGenerator
{
  private readonly fetchImpl: typeof fetch;
  private readonly onUsage?: (usage: CacheUsageSummary) => void;

  constructor(opts: AnthropicRepConsolidationGeneratorOptions = {}) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.onUsage = opts.onUsage;
  }

  async generate(
    context: RepConsolidationContext,
  ): Promise<RepConsolidationResult> {
    const apiKey = requireApiKey();
    const validLabels = new Set(context.debriefs.map((d) => d.label));
    const body = buildRepConsolidationRequest(context);
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
      throw new AnthropicRepConsolidationError(
        `Anthropic request failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new AnthropicRepConsolidationError(
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
    return extractRepConsolidationFromResponse(json, validLabels);
  }
}
