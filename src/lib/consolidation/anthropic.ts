/**
 * Anthropic Claude client for account consolidation (Phase 23). A thin fetch wrapper
 * — no SDK — mirroring the Phase 16 scorer / Phase 20 debrief / Phase 21 coaching so
 * request-building and response-parsing are pure, exported, and unit-tested against
 * sample JSON. Nothing here touches the network at import or build time.
 *
 * Model: claude-sonnet-4-6 (the locked tech-stack choice for summaries). Uses ONE
 * cached system layer (the consolidation methodology, forever) — there is no rep
 * layer, because the account summary is shared and rep-agnostic.
 *
 * SOURCE-ATTRIBUTION GUARDRAIL: the model attributes each fact to a debrief LABEL
 * ("D1", "D2", …) shown in the prompt. parseConsolidationJson is given the set of
 * valid labels and DROPS any fact whose sourceDebriefId isn't one of them — a fact
 * Critiq can't ground in a real interaction never reaches the summary (the same
 * "don't trust the model's shape" guard as the scorer's clamp / the coaching
 * empty-rejection). The runner maps the surviving labels back to real debrief ids.
 */

import {
  buildCachedSystem,
  summarizeCacheUsage,
  type CacheUsageSummary,
  type SystemTextBlock,
} from "@/lib/ai/cache";
import { buildSystemPrompt, buildUserPrompt } from "./prompt";
import {
  ACCOUNT_FACT_LENSES,
  type AccountFact,
  type AccountFactLens,
  type ConsolidationContext,
  type ConsolidationGenerator,
  type ConsolidationResult,
} from "./types";

const ANTHROPIC_MESSAGES_ENDPOINT = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

export const CONSOLIDATION_MODEL = "claude-sonnet-4-6";
/** Headroom for a headline + a few sentences + an attributed fact list, plus thinking. */
export const CONSOLIDATION_MAX_TOKENS = 4000;

export interface AnthropicRequest {
  model: string;
  max_tokens: number;
  thinking: { type: "adaptive" };
  system: SystemTextBlock[];
  messages: Array<{ role: "user"; content: string }>;
}

/**
 * Build the Messages API request body. Pure — exported so tests assert the model and
 * the single cached methodology layer without a call.
 */
export function buildConsolidationRequest(
  ctx: ConsolidationContext,
): AnthropicRequest {
  return {
    model: CONSOLIDATION_MODEL,
    max_tokens: CONSOLIDATION_MAX_TOKENS,
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

export class AnthropicConsolidationError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "AnthropicConsolidationError";
  }
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

const LENS_SET = new Set<string>(ACCOUNT_FACT_LENSES);

/** Coerce any lens string to a known lens; unknown / missing → 'general'. */
export function coerceLens(raw: unknown): AccountFactLens {
  const v = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  return LENS_SET.has(v) ? (v as AccountFactLens) : "general";
}

/**
 * Coerce the raw facts array, keeping only facts that (a) have text and (b) cite a
 * sourceDebriefId present in `validLabels`. The validity check is the attribution
 * guardrail — an un-attributable fact is dropped, not stored. The surviving
 * sourceDebriefId is a LABEL (e.g. "D1"); the runner maps it to the real debrief id.
 */
export function coerceFacts(
  raw: unknown,
  validLabels: Set<string>,
): AccountFact[] {
  if (!Array.isArray(raw)) return [];
  const out: AccountFact[] = [];
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
 * Normalize the parsed JSON into a ConsolidationResult. `validLabels` is the set of
 * debrief labels shown to the model; facts attributed outside it are dropped. Never
 * throws on a well-formed-but-incomplete object (extractConsolidationFromResponse
 * decides usability).
 */
export function parseConsolidationJson(
  parsed: unknown,
  validLabels: Set<string>,
): ConsolidationResult {
  const obj = (parsed ?? {}) as Record<string, unknown>;
  return {
    headline: str(obj.headline),
    narrative: str(obj.narrative),
    facts: coerceFacts(obj.facts, validLabels),
  };
}

/**
 * Pull a JSON object out of the model's text (strip a stray code fence, else fall back
 * to the outermost {...} span). Returns null if nothing parseable is found. Same
 * defense as the Phase 16/20/21 path.
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
 * Extract the consolidation from a Messages API response. With adaptive thinking on,
 * the response carries thinking block(s) then a text block with the JSON. Throws
 * AnthropicConsolidationError on a refusal, truncation, empty body, unparseable text,
 * or an EMPTY result (no narrative AND no facts — never persisted as completed, like
 * the coaching/script empty-output rejection).
 */
export function extractConsolidationFromResponse(
  json: unknown,
  validLabels: Set<string>,
): ConsolidationResult {
  const resp = (json ?? {}) as AnthropicResponse;
  if (resp.stop_reason === "refusal") {
    throw new AnthropicConsolidationError(
      "Model refused to produce a summary.",
    );
  }
  if (resp.stop_reason === "max_tokens") {
    throw new AnthropicConsolidationError(
      "Consolidation response was truncated (max_tokens).",
    );
  }
  const text = (resp.content ?? [])
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("")
    .trim();
  if (!text) {
    throw new AnthropicConsolidationError(
      `No text content in response (stop_reason=${resp.stop_reason ?? "?"}).`,
    );
  }
  const parsed = extractJsonObject(text);
  if (parsed === null) {
    throw new AnthropicConsolidationError("Model output was not valid JSON.");
  }
  const result = parseConsolidationJson(parsed, validLabels);
  if (!result.narrative && result.facts.length === 0) {
    throw new AnthropicConsolidationError(
      "Consolidation produced no narrative and no attributed facts (empty result).",
    );
  }
  return result;
}

function requireApiKey(): string {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    throw new AnthropicConsolidationError("ANTHROPIC_API_KEY is not configured.");
  }
  return key;
}

export interface AnthropicConsolidationGeneratorOptions {
  /** Inject a fake `fetch` in tests; defaults to the global. */
  fetchImpl?: typeof fetch;
  /** Called once per real call with that call's cache activity (Phase 17 telemetry). */
  onUsage?: (usage: CacheUsageSummary) => void;
}

/** The real Claude-backed ConsolidationGenerator. */
export class AnthropicConsolidationGenerator
  implements ConsolidationGenerator
{
  private readonly fetchImpl: typeof fetch;
  private readonly onUsage?: (usage: CacheUsageSummary) => void;

  constructor(opts: AnthropicConsolidationGeneratorOptions = {}) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.onUsage = opts.onUsage;
  }

  async generate(context: ConsolidationContext): Promise<ConsolidationResult> {
    const apiKey = requireApiKey();
    const validLabels = new Set(context.debriefs.map((d) => d.label));
    const body = buildConsolidationRequest(context);
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
      throw new AnthropicConsolidationError(
        `Anthropic request failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new AnthropicConsolidationError(
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
    return extractConsolidationFromResponse(json, validLabels);
  }
}
