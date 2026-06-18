/**
 * Anthropic Claude client for the call script (Phase 19). A thin fetch wrapper —
 * no SDK — mirroring the Phase 18 brief client so request-building and
 * response-parsing are pure, exported, and unit-tested against sample JSON. Nothing
 * here touches the network at import or build time.
 *
 * Model: claude-sonnet-4-6 (the locked tech-stack choice for coaching/summaries).
 * Uses BOTH stable cache layers (methodology forever + rep profile per rep) via
 * buildCachedSystem; the account/objective/brief + the chosen style mode are
 * volatile and live in the user message (never cached) — so switching style mode
 * does not invalidate the cached prefix.
 */

import {
  buildCachedSystem,
  summarizeCacheUsage,
  type CacheUsageSummary,
  type SystemTextBlock,
} from "@/lib/ai/cache";
import { buildSystemPrompt, buildUserPrompt } from "./prompt";
import { coerceStyleMode } from "./style";
import {
  CUE_KINDS,
  type CueKind,
  type DeliveryCue,
  type ScriptContext,
  type ScriptGenerator,
  type ScriptLine,
  type ScriptResult,
  type ScriptSection,
} from "./types";

const ANTHROPIC_MESSAGES_ENDPOINT = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

export const SCRIPT_MODEL = "claude-sonnet-4-6";
/** Headroom for a multi-section script with inline cues, plus adaptive thinking. */
export const SCRIPT_MAX_TOKENS = 6000;

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
 * profile is the second layer ONLY when present (buildCachedSystem drops empty
 * layers).
 */
export function buildScriptRequest(ctx: ScriptContext): AnthropicRequest {
  return {
    model: SCRIPT_MODEL,
    max_tokens: SCRIPT_MAX_TOKENS,
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

export class AnthropicScriptError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "AnthropicScriptError";
  }
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function coerceCueKind(v: unknown): CueKind | null {
  if (typeof v !== "string") return null;
  const k = v.trim().toLowerCase();
  return (CUE_KINDS as readonly string[]).includes(k) ? (k as CueKind) : null;
}

function coerceCues(raw: unknown): DeliveryCue[] {
  if (!Array.isArray(raw)) return [];
  const out: DeliveryCue[] = [];
  for (const item of raw) {
    const o = (item ?? {}) as Record<string, unknown>;
    const kind = coerceCueKind(o.kind);
    const note = str(o.note);
    // Drop a cue with an unknown kind or no note — never invent a kind, and never
    // keep an empty cue (a hallucinated kind must not corrupt the rendered script).
    if (kind && note) out.push({ kind, note });
  }
  return out;
}

function coerceLines(raw: unknown): ScriptLine[] {
  if (!Array.isArray(raw)) return [];
  const out: ScriptLine[] = [];
  for (const item of raw) {
    const o = (item ?? {}) as Record<string, unknown>;
    const say = str(o.say);
    if (say) out.push({ say, cues: coerceCues(o.cues) });
  }
  return out;
}

function coerceSections(raw: unknown): ScriptSection[] {
  if (!Array.isArray(raw)) return [];
  const out: ScriptSection[] = [];
  for (const item of raw) {
    const o = (item ?? {}) as Record<string, unknown>;
    const label = str(o.label);
    const lines = coerceLines(o.lines);
    // A section with no usable lines is dropped (nothing to say there).
    if (label && lines.length > 0) {
      out.push({ label, purpose: str(o.purpose), lines });
    }
  }
  return out;
}

function coerceDeliveryNotes(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((n) => str(n)).filter((s) => s.length > 0);
}

/**
 * Normalize the parsed JSON into a ScriptResult. Tolerant of missing fields; never
 * throws on a well-formed-but-incomplete object. The styleMode is taken from the
 * REQUEST context (what we asked for), not the model echo — the rule is ours.
 */
export function parseScriptJson(
  parsed: unknown,
  ctx: ScriptContext,
): ScriptResult {
  const obj = (parsed ?? {}) as Record<string, unknown>;
  return {
    styleMode: ctx.styleMode,
    opener: str(obj.opener),
    sections: coerceSections(obj.sections),
    closing: str(obj.closing),
    deliveryNotes: coerceDeliveryNotes(obj.deliveryNotes),
  };
}

/**
 * Pull a JSON object out of the model's text (strip a stray code fence, else fall
 * back to the outermost {...} span). Returns null if nothing parseable is found.
 * Same defense as the Phase 16/18 parsers.
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
 * Extract the script from a Messages API response. With adaptive thinking on, the
 * response carries thinking block(s) then a text block with the JSON. Throws
 * AnthropicScriptError on a refusal, truncation, empty body, or unparseable text.
 * Also throws when the parsed script has no usable sections (an empty script is a
 * failure, never persisted as completed).
 */
export function extractScriptFromResponse(
  json: unknown,
  ctx: ScriptContext,
): ScriptResult {
  const resp = (json ?? {}) as AnthropicResponse;
  if (resp.stop_reason === "refusal") {
    throw new AnthropicScriptError("Model refused to produce a script.");
  }
  if (resp.stop_reason === "max_tokens") {
    throw new AnthropicScriptError("Script response was truncated (max_tokens).");
  }
  const text = (resp.content ?? [])
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("")
    .trim();
  if (!text) {
    throw new AnthropicScriptError(
      `No text content in response (stop_reason=${resp.stop_reason ?? "?"}).`,
    );
  }
  const parsed = extractJsonObject(text);
  if (parsed === null) {
    throw new AnthropicScriptError("Model output was not valid JSON.");
  }
  const result = parseScriptJson(parsed, ctx);
  if (result.sections.length === 0) {
    throw new AnthropicScriptError("Script had no usable sections.");
  }
  return result;
}

function requireApiKey(): string {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    throw new AnthropicScriptError("ANTHROPIC_API_KEY is not configured.");
  }
  return key;
}

export interface AnthropicScriptGeneratorOptions {
  /** Inject a fake `fetch` in tests; defaults to the global. */
  fetchImpl?: typeof fetch;
  /** Called once per real call with that call's cache activity (Phase 17 telemetry). */
  onUsage?: (usage: CacheUsageSummary) => void;
}

/** The real Claude-backed ScriptGenerator. */
export class AnthropicScriptGenerator implements ScriptGenerator {
  private readonly fetchImpl: typeof fetch;
  private readonly onUsage?: (usage: CacheUsageSummary) => void;

  constructor(opts: AnthropicScriptGeneratorOptions = {}) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.onUsage = opts.onUsage;
  }

  async generate(context: ScriptContext): Promise<ScriptResult> {
    const apiKey = requireApiKey();
    // Defensive: the route validates the mode, but never let a bad mode through.
    const ctx: ScriptContext = {
      ...context,
      styleMode: coerceStyleMode(context.styleMode),
    };
    const body = buildScriptRequest(ctx);
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
      throw new AnthropicScriptError(
        `Anthropic request failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new AnthropicScriptError(
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
    return extractScriptFromResponse(json, ctx);
  }
}
