/**
 * Phase 19 unit verification — call-script generation, pure logic only (no network,
 * no DB). Imports the REAL app modules (no re-implementation, per the standing
 * rule). The real Claude round-trip + the script QUALITY are the runtime gate
 * Felix + the expert coach validate; the real-Postgres store/generate path is a
 * throwaway probe. This proves deterministically: the style-mode rule, the prompt +
 * output contract (incl. the delivery-cue kinds + both style modes), request
 * construction (the two cache layers), and response parsing/normalization (sections,
 * lines, cue-kind coercion, empty-script rejection, style mode taken from the rule).
 *
 * Run: pnpm tsx scripts/verify-phase19.ts
 */
import {
  STYLE_MODES,
  DEFAULT_STYLE_MODE,
  STYLE_MODE_LABELS,
  coerceStyleMode,
  isStyleMode,
  resolveBaselineStyleMode,
} from "../src/lib/script/style";
import {
  buildOutputFormatSpec,
  buildStyleModeSpec,
  buildSystemPrompt,
  buildUserPrompt,
} from "../src/lib/script/prompt";
import {
  SCRIPT_MODEL,
  buildScriptRequest,
  extractJsonObject,
  extractScriptFromResponse,
  parseScriptJson,
} from "../src/lib/script/anthropic";
import { CUE_KINDS } from "../src/lib/script/types";
import type { ScriptContext } from "../src/lib/script/types";

const fails: string[] = [];
const ok = (cond: boolean, msg: string) => {
  console.log(`${cond ? "✓" : "✗"} ${msg}`);
  if (!cond) fails.push(msg);
};

function ctx(over: Partial<ScriptContext> = {}): ScriptContext {
  return {
    accountName: "Riverside Contractors",
    accountStage: "active",
    accountSummary: "Repeat buyer; price-sensitive; values durability.",
    objective: "Lock in a walkthrough date next week",
    diagnosis: "Warm repeat account stalled on price; durability resonates.",
    approach: [
      { focus: "Lead with the durability win", why: "It's what they value" },
    ],
    objections: [
      { objection: "Price is high", response: "Reframe on lifetime cost" },
    ],
    styleMode: "relational",
    repProfile: null,
    ...over,
  };
}

// ---------- The style-mode rule ----------
{
  ok(STYLE_MODES.length === 2, "exactly two style modes (binary spectrum)");
  ok(
    STYLE_MODES.includes("assertive") && STYLE_MODES.includes("relational"),
    "modes are assertive + relational",
  );
  ok(DEFAULT_STYLE_MODE === "relational", "default style mode is relational");
  ok(isStyleMode("assertive") && isStyleMode("relational"), "isStyleMode accepts valid");
  ok(!isStyleMode("aggressive") && !isStyleMode(""), "isStyleMode rejects invalid");
  ok(!isStyleMode(undefined) && !isStyleMode(3), "isStyleMode rejects non-strings");
  ok(coerceStyleMode("assertive") === "assertive", "coerce keeps a valid mode");
  ok(coerceStyleMode("nonsense") === "relational", "coerce falls back to default");
  ok(
    coerceStyleMode(undefined, "assertive") === "assertive",
    "coerce honors an explicit fallback",
  );
  ok(
    resolveBaselineStyleMode(null) === DEFAULT_STYLE_MODE,
    "baseline seam returns the default (no script intake question yet)",
  );
  ok(
    resolveBaselineStyleMode("THE REP YOU ARE COACHING: ...") === DEFAULT_STYLE_MODE,
    "baseline seam ignores the profile for now (documented)",
  );
  ok(
    STYLE_MODE_LABELS.assertive === "Assertive" &&
      STYLE_MODE_LABELS.relational === "Relational",
    "style labels are rep-facing",
  );
}

// ---------- The system prompt + contract ----------
{
  const sys = buildSystemPrompt();
  ok(/SPIN/.test(sys) && /Voss/.test(sys) && /Navarro/.test(sys), "system names all three pillars");
  ok(/CONVERSATION FRAMEWORK/i.test(sys), "system frames a conversation framework, not a monologue");
  for (const kind of CUE_KINDS) {
    ok(sys.includes(kind), `system defines the '${kind}' cue kind`);
  }
  ok(/HONESTY RULES/.test(sys), "system carries the honesty rules");
  ok(/own voice/i.test(sys), "system says lines are the rep's own voice (suggestions)");

  const styleSpec = buildStyleModeSpec();
  ok(/Assertive/.test(styleSpec) && /Relational/.test(styleSpec), "style spec defines both modes");
  ok(/pressure tool/i.test(styleSpec) && /space tool/i.test(styleSpec), "style spec contrasts silence use");
  ok(sys.includes(styleSpec), "style spec is embedded in the cached system block");

  const fmt = buildOutputFormatSpec();
  ok(/"sections"/.test(fmt) && /"lines"/.test(fmt) && /"cues"/.test(fmt), "format spec defines nested shape");
  ok(/"opener"/.test(fmt) && /"closing"/.test(fmt) && /"deliveryNotes"/.test(fmt), "format spec names all top-level fields");
  ok(/emphasis\|pace\|pause\|register\|silence/.test(fmt), "format spec constrains cue kinds");
}

// ---------- The user prompt ----------
{
  const u = buildUserPrompt(ctx());
  ok(u.includes("Lock in a walkthrough date next week"), "user prompt includes the objective");
  ok(u.includes("Relational"), "user prompt names the chosen style mode");
  ok(u.includes("Riverside Contractors"), "user prompt includes the account");
  ok(u.includes("durability resonates"), "user prompt includes the brief diagnosis");
  ok(u.includes("Lead with the durability win"), "user prompt includes the approach");
  ok(u.includes("Price is high"), "user prompt includes anticipated objections");

  const cold = buildUserPrompt(
    ctx({ accountSummary: null, diagnosis: null, approach: [], objections: [] }),
  );
  ok(/cold-start/i.test(cold), "cold account → user prompt says cold-start");
  ok(cold.includes("(none provided)"), "no approach → '(none provided)'");
  ok(cold.includes("(none anticipated)"), "no objections → '(none anticipated)'");

  const assertive = buildUserPrompt(ctx({ styleMode: "assertive" }));
  ok(assertive.includes("Assertive"), "assertive context names Assertive mode");
}

// ---------- Request construction (cache layers) ----------
{
  const reqNoProfile = buildScriptRequest(ctx({ repProfile: null }));
  ok(reqNoProfile.model === SCRIPT_MODEL, "request uses the locked model");
  ok(reqNoProfile.model === "claude-sonnet-4-6", "model is claude-sonnet-4-6");
  ok(reqNoProfile.thinking.type === "adaptive", "adaptive thinking is on");
  ok(reqNoProfile.system.length === 1, "no rep profile → one cached system layer (methodology)");
  ok(
    reqNoProfile.system[0].cache_control?.type === "ephemeral",
    "methodology layer carries the ephemeral cache breakpoint",
  );
  ok(
    reqNoProfile.messages.length === 1 && reqNoProfile.messages[0].role === "user",
    "exactly one user message",
  );

  const reqWithProfile = buildScriptRequest(
    ctx({ repProfile: "THE REP YOU ARE COACHING: prefers discovery." }),
  );
  ok(reqWithProfile.system.length === 2, "rep profile present → two cached layers");
  ok(
    reqWithProfile.system[1].cache_control?.type === "ephemeral",
    "rep-profile layer carries its own cache breakpoint",
  );
  ok(
    reqWithProfile.system[1].text.includes("prefers discovery"),
    "second layer is the rep profile",
  );
}

// ---------- JSON extraction ----------
{
  ok(
    JSON.stringify(extractJsonObject('{"opener":"hi"}')) === '{"opener":"hi"}',
    "extracts a bare JSON object",
  );
  ok(
    (extractJsonObject('```json\n{"opener":"hi"}\n```') as { opener: string })
      .opener === "hi",
    "strips a json code fence",
  );
  ok(
    (extractJsonObject('Here:\n{"opener":"hi"}\nthanks') as { opener: string })
      .opener === "hi",
    "falls back to the outermost {...} span",
  );
  ok(extractJsonObject("not json at all") === null, "unparseable → null");
}

// ---------- parseScriptJson normalization ----------
{
  const parsed = parseScriptJson(
    {
      styleMode: "assertive", // model echo — must be IGNORED in favor of the rule
      opener: "  Open warm  ",
      sections: [
        {
          label: "Surface the problem",
          purpose: "find the pain",
          lines: [
            {
              say: "What's driving the repaint timeline?",
              cues: [
                { kind: "PAUSE", note: "let it land" }, // upper-case kind → coerced
                { kind: "telepathy", note: "invalid kind dropped" }, // unknown → dropped
                { kind: "emphasis", note: "" }, // empty note → dropped
              ],
            },
            { say: "", cues: [] }, // empty say → line dropped
          ],
        },
        { label: "", lines: [{ say: "x", cues: [] }] }, // no label → section dropped
        { label: "Empty section", lines: [] }, // no lines → section dropped
      ],
      closing: "Lock the date",
      deliveryNotes: ["Slow down", "", "Lean on silence"],
    },
    ctx({ styleMode: "relational" }),
  );
  ok(parsed.styleMode === "relational", "styleMode comes from the rule, not the model echo");
  ok(parsed.opener === "Open warm", "opener trimmed");
  ok(parsed.sections.length === 1, "sections without a label or usable lines are dropped");
  ok(parsed.sections[0].lines.length === 1, "lines with no `say` are dropped");
  ok(parsed.sections[0].lines[0].cues.length === 1, "only the valid cue survives");
  ok(parsed.sections[0].lines[0].cues[0].kind === "pause", "cue kind lower-cased/coerced");
  ok(parsed.closing === "Lock the date", "closing kept");
  ok(parsed.deliveryNotes.length === 2, "empty delivery notes dropped");

  const empty = parseScriptJson({}, ctx());
  ok(empty.sections.length === 0 && empty.opener === "", "missing fields → safe empties");
}

// ---------- extractScriptFromResponse (refusal / truncation / empty / valid) ----------
{
  const good = {
    stop_reason: "end_turn",
    content: [
      { type: "thinking", text: "…" },
      {
        type: "text",
        text: JSON.stringify({
          opener: "Open warm",
          sections: [
            {
              label: "Discovery",
              purpose: "learn",
              lines: [{ say: "How's the season going?", cues: [] }],
            },
          ],
          closing: "Set the next date",
          deliveryNotes: ["Keep it warm"],
        }),
      },
    ],
  };
  const res = extractScriptFromResponse(good, ctx());
  ok(res.sections.length === 1 && res.opener === "Open warm", "valid response parses");

  let threw = false;
  try {
    extractScriptFromResponse({ stop_reason: "refusal", content: [] }, ctx());
  } catch {
    threw = true;
  }
  ok(threw, "refusal throws");

  threw = false;
  try {
    extractScriptFromResponse(
      { stop_reason: "max_tokens", content: [{ type: "text", text: "{" }] },
      ctx(),
    );
  } catch {
    threw = true;
  }
  ok(threw, "max_tokens truncation throws");

  threw = false;
  try {
    extractScriptFromResponse({ stop_reason: "end_turn", content: [] }, ctx());
  } catch {
    threw = true;
  }
  ok(threw, "empty content throws");

  threw = false;
  try {
    // valid JSON but zero usable sections → an empty script is a failure
    extractScriptFromResponse(
      {
        stop_reason: "end_turn",
        content: [
          { type: "text", text: JSON.stringify({ opener: "hi", sections: [] }) },
        ],
      },
      ctx(),
    );
  } catch {
    threw = true;
  }
  ok(threw, "a script with no usable sections is rejected");
}

// ---------- Summary ----------
console.log("");
if (fails.length === 0) {
  console.log("✅ Phase 19 verification PASSED (all assertions).");
} else {
  console.log(`❌ Phase 19 verification FAILED — ${fails.length} assertion(s):`);
  for (const f of fails) console.log(`   - ${f}`);
  process.exit(1);
}
