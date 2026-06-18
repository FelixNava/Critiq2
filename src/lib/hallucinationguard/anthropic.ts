/**
 * The Claude-backed guard VERIFIER (Phase 26). A thin fetch wrapper — no SDK — mirroring the
 * Phase 16/18/20/21 clients so request-building and response-parsing are pure, exported, and
 * unit-tested against sample JSON. Nothing here touches the network at import or build time.
 *
 * Model: claude-sonnet-4-6 (the locked tech-stack choice). The system block (pure guard
 * instructions, no account specifics) is cached forever via buildCachedSystem; the sources +
 * suspects are volatile and live in the user message.
 *
 * The verifier is only ever invoked on the references the deterministic pass could not ground
 * (the suspects), so most guard passes make NO Claude call at all (the cheap, common path).
 */

import {
  buildCachedSystem,
  summarizeCacheUsage,
  type CacheUsageSummary,
  type SystemTextBlock,
} from "@/lib/ai/cache";
import {
  buildVerifierSystemPrompt,
  buildVerifierUserPrompt,
  labelSources,
} from "./prompt";
import type {
  GuardVerifier,
  VerifierRequest,
  VerifierVerdict,
} from "./types";

const ANTHROPIC_MESSAGES_ENDPOINT = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

export const GUARD_VERIFIER_MODEL = "claude-sonnet-4-6";
/** Verdicts are tiny; headroom for a handful of suspects + adaptive thinking. */
export const GUARD_VERIFIER_MAX_TOKENS = 1500;

export interface AnthropicRequest {
  model: string;
  max_tokens: number;
  thinking: { type: "adaptive" };
  system: SystemTextBlock[];
  messages: Array<{ role: "user"; content: string }>;
}

/** Build the Messages API body. Pure — exported so tests assert the model + cached layer. */
export function buildVerifierRequest(
  request: VerifierRequest,
): { body: AnthropicRequest; labelToId: Map<string, string> } {
  const labeled = labelSources(request.sources);
  const labelToId = new Map(labeled.map((l) => [l.label, l.source.id]));
  return {
    body: {
      model: GUARD_VERIFIER_MODEL,
      max_tokens: GUARD_VERIFIER_MAX_TOKENS,
      thinking: { type: "adaptive" },
      system: buildCachedSystem([{ text: buildVerifierSystemPrompt() }]),
      messages: [
        { role: "user", content: buildVerifierUserPrompt(labeled, request.suspects) },
      ],
    },
    labelToId,
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

export class GuardVerifierError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "GuardVerifierError";
  }
}

/** Strip a code fence / pull the outermost {...}. Same defense as the rest of the pipeline. */
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

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/**
 * Normalize the parsed JSON into verdicts, mapping the model's source LABEL ("S2") back to
 * the real source id. A verdict whose `supported` isn't strictly true is treated as
 * unsupported (conservative — the guard's default leans to redaction). A cited label the
 * model invented (not in labelToId) yields a supported=false verdict (can't trust an
 * unknown citation) UNLESS support was already false.
 */
export function parseVerifierVerdicts(
  parsed: unknown,
  labelToId: Map<string, string>,
): VerifierVerdict[] {
  const obj = (parsed ?? {}) as Record<string, unknown>;
  const arr = Array.isArray(obj.verdicts) ? obj.verdicts : [];
  const out: VerifierVerdict[] = [];
  for (const item of arr) {
    const o = (item ?? {}) as Record<string, unknown>;
    const span = str(o.span);
    if (!span) continue;
    const supportedRaw = o.supported === true;
    const label = str(o.source);
    const mappedId = label ? labelToId.get(label) ?? null : null;
    // Supported only if the model said true AND cited a real, known source.
    const supported = supportedRaw && mappedId !== null;
    out.push({
      field: str(o.field),
      span,
      supported,
      sourceId: supported ? mappedId : null,
    });
  }
  return out;
}

/** Pull verdicts from a Messages API response (throws on refusal/truncation/empty/unparseable). */
export function extractVerdictsFromResponse(
  json: unknown,
  labelToId: Map<string, string>,
): VerifierVerdict[] {
  const resp = (json ?? {}) as AnthropicResponse;
  if (resp.stop_reason === "refusal") {
    throw new GuardVerifierError("Model refused to verify.");
  }
  if (resp.stop_reason === "max_tokens") {
    throw new GuardVerifierError("Verifier response was truncated (max_tokens).");
  }
  const text = (resp.content ?? [])
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("")
    .trim();
  if (!text) {
    throw new GuardVerifierError(
      `No text content in response (stop_reason=${resp.stop_reason ?? "?"}).`,
    );
  }
  const parsed = extractJsonObject(text);
  if (parsed === null) {
    throw new GuardVerifierError("Verifier output was not valid JSON.");
  }
  return parseVerifierVerdicts(parsed, labelToId);
}

function requireApiKey(): string {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new GuardVerifierError("ANTHROPIC_API_KEY is not configured.");
  return key;
}

export interface AnthropicGuardVerifierOptions {
  fetchImpl?: typeof fetch;
  onUsage?: (usage: CacheUsageSummary) => void;
}

/** The real Claude-backed GuardVerifier. */
export class AnthropicGuardVerifier implements GuardVerifier {
  private readonly fetchImpl: typeof fetch;
  private readonly onUsage?: (usage: CacheUsageSummary) => void;

  constructor(opts: AnthropicGuardVerifierOptions = {}) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.onUsage = opts.onUsage;
  }

  async verify(request: VerifierRequest): Promise<VerifierVerdict[]> {
    if (request.suspects.length === 0) return [];
    const apiKey = requireApiKey();
    const { body, labelToId } = buildVerifierRequest(request);
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
      throw new GuardVerifierError(
        `Anthropic request failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new GuardVerifierError(
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
    return extractVerdictsFromResponse(json, labelToId);
  }
}
