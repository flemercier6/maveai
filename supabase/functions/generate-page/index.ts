// Multi-model one-pager generation.
//
// Pipeline (when skipClarify=false):
//   Phase 1 — Planner (anthropic/claude-sonnet-4-6): reasons about the request
//     and either asks 1–2 clarifying questions OR produces a structural plan.
//   Phase 2 — Content writer (openai/gpt-5-mini): fills in concrete content
//     for each block following the plan, returns final PageSpec via tool call.
//
// Aggregated usage is reported per-model in meta.models, with the totals also
// summed into meta.cost so existing UI keeps working.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

// Models used in the pipeline. We pick a strong-reasoning model for the
// planning step and a cheap/fast model for the bulk content step.
const PLANNER_MODEL_DEFAULT = "claude-sonnet-4-6";
const CONTENT_MODEL_DEFAULT = "gpt-5-mini";

// Public list prices (USD per 1M tokens). Keep aligned with src/lib/pricing.ts.
const PRICES: Record<string, { input: number; output: number }> = {
  "gpt-5.5": { input: 2.5, output: 10 },
  "gpt-5-mini": { input: 0.25, output: 2 },
  "gpt-5-nano": { input: 0.15, output: 0.6 },
  "claude-opus-4-7": { input: 15, output: 75 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-haiku-4-5": { input: 1, output: 5 },
  "gemini-2.5-pro": { input: 1.25, output: 10 },
  "gemini-3.5-flash": { input: 0.3, output: 2.5 },
  "mistral-large-latest": { input: 2, output: 6 },
  "mistral-small-latest": { input: 0.2, output: 0.6 },
};

function providerOf(modelBare: string): "openai" | "anthropic" | "google" | "mistral" {
  if (modelBare.startsWith("gemini")) return "google";
  if (modelBare.startsWith("claude")) return "anthropic";
  if (modelBare.startsWith("mistral")) return "mistral";
  return "openai";
}
function gatewayId(modelBare: string): string {
  const p = modelBare.startsWith("gemini") ? "google"
    : modelBare.startsWith("claude") ? "anthropic"
    : modelBare.startsWith("mistral") ? "mistralai"
    : "openai";
  return `${p}/${modelBare}`;
}

function pickAllowed(modelBare: string, blacklisted: Set<string>, fallbacks: string[]): string {
  if (!blacklisted.has(modelBare)) return modelBare;
  for (const m of fallbacks) if (!blacklisted.has(m)) return m;
  return modelBare;
}

const approxTokens = (s: string) => Math.ceil((s?.length ?? 0) / 4);

// ---------- Phase 1 schema ----------
const PLANNER_SYSTEM_BASE = `You are the planning brain for a one-pager dashboard generator.

Your job has TWO branches. Choose exactly one.

BRANCH A — Ask 1–2 clarifying questions (only if truly needed):
  Use this only when the user's request is genuinely ambiguous AND a question
  would unblock a materially different answer. Never clarify for short,
  conversational, factual, or already-detailed requests.

BRANCH B — Produce a structural plan:
  Decide title, short subtitle, 1–4 tab(s), and the ordered list of blocks for
  each tab. For each block, provide a single-line "brief" telling the content
  writer what to put there. The content writer is a separate, cheaper model —
  briefs must be concrete and actionable.

  Available block kinds: "heading", "paragraph", "callout", "kpis",
  "checklist", "bullets", "table", "chart".

You MUST output a single JSON object with this exact shape:
{
  "needsClarify": boolean,
  "questions"?: [
    {
      "header": "2-3 word tag",
      "question": "one clear question ending with ?",
      "multi": false,
      "options": [{"label": "1-5 words"}, {"label": "..."}]
    }
  ],
  "plan"?: {
    "title": "string",
    "subtitle": "string (one line)",
    "tabs": [
      {
        "label": "tab name",
        "blocks": [
          {"kind": "heading|paragraph|callout|kpis|checklist|bullets|table|chart", "brief": "one-line direction"}
        ]
      }
    ]
  }
}

Rules:
- If needsClarify=true: include "questions" (1–2 items, 2–4 options each, options ≤24 chars), omit "plan".
- If needsClarify=false: include "plan", omit "questions".
- Reply with the language of the user's message.
- Output ONLY the JSON object — no prose, no code fences.`;

const PLANNER_SYSTEM_FORCE_PLAN = `${PLANNER_SYSTEM_BASE}

IMPORTANT: The user has already answered clarifying questions. ALWAYS choose
BRANCH B — never ask further questions. Set needsClarify=false.`;

// ---------- Phase 2 tool (final renderer) ----------
const RENDER_TOOL = {
  type: "function",
  function: {
    name: "render_one_pager",
    description: "Return a structured one-pager dashboard, following the plan.",
    parameters: {
      type: "object",
      properties: {
        summary: {
          type: "string",
          description: "1–2 sentence summary of the page, shown in the chat.",
        },
        page: {
          type: "object",
          properties: {
            title: { type: "string" },
            subtitle: { type: "string" },
            tabs: {
              type: "array",
              minItems: 1,
              maxItems: 4,
              items: {
                type: "object",
                properties: {
                  label: { type: "string" },
                  blocks: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        kind: {
                          type: "string",
                          enum: ["heading", "paragraph", "callout", "kpis", "checklist", "bullets", "table", "chart"],
                        },
                        text: { type: "string" },
                        level: { type: "number", enum: [2, 3] },
                        tone: { type: "string", enum: ["info", "success", "warning", "danger"] },
                        title: { type: "string" },
                        body: { type: "string" },
                        items: {
                          type: "array",
                          items: {
                            type: "object",
                            properties: {
                              label: { type: "string" },
                              value: { type: "string" },
                              hint: { type: "string" },
                              checked: { type: "boolean" },
                            },
                          },
                        },
                        bullets: { type: "array", items: { type: "string" } },
                        columns: { type: "array", items: { type: "string" } },
                        rows: { type: "array", items: { type: "array", items: { type: "string" } } },
                        chartType: { type: "string", enum: ["bar", "line", "pie"] },
                        data: {
                          type: "array",
                          items: {
                            type: "object",
                            properties: {
                              name: { type: "string" },
                              value: { type: "number" },
                            },
                            required: ["name", "value"],
                          },
                        },
                      },
                      required: ["kind"],
                    },
                  },
                },
                required: ["label", "blocks"],
              },
            },
          },
          required: ["title", "tabs"],
        },
      },
      required: ["page", "summary"],
    },
  },
};

type Usage = { input_tokens?: number; output_tokens?: number; prompt_tokens?: number; completion_tokens?: number };

function readUsage(u: Usage | undefined) {
  const inputTokens = Number(u?.input_tokens ?? u?.prompt_tokens ?? 0);
  const outputTokens = Number(u?.output_tokens ?? u?.completion_tokens ?? 0);
  return { inputTokens, outputTokens };
}

function modelCost(modelBare: string, inputTokens: number, outputTokens: number) {
  const p = PRICES[modelBare] ?? { input: 0, output: 0 };
  return {
    inputCostUsd: (inputTokens / 1_000_000) * p.input,
    outputCostUsd: (outputTokens / 1_000_000) * p.output,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { prompt, history, aiPrefs, skipClarify } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: "LOVABLE_API_KEY missing" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const blacklisted = new Set<string>(aiPrefs?.blacklistedModels ?? []);
    const favorites: string[] = aiPrefs?.favoriteModels ?? [];

    // Pick planner + content models, honouring blacklist with sensible fallbacks.
    const plannerFallbacks = [
      ...favorites,
      "claude-sonnet-4-6", "gemini-2.5-pro", "gpt-5.5", "gpt-5-mini",
    ];
    const contentFallbacks = [
      ...favorites,
      "gpt-5-mini", "gemini-3.5-flash", "gpt-5-nano", "gemini-2.5-pro",
    ];
    const plannerBare = pickAllowed(PLANNER_MODEL_DEFAULT, blacklisted, plannerFallbacks);
    const contentBare = pickAllowed(CONTENT_MODEL_DEFAULT, blacklisted, contentFallbacks);

    const hist = Array.isArray(history) ? history : [];

    // ---------- Phase 1: planner / clarify decider ----------
    const plannerSystem = skipClarify ? PLANNER_SYSTEM_FORCE_PLAN : PLANNER_SYSTEM_BASE;
    const plannerMessages = [
      { role: "system", content: plannerSystem },
      ...hist,
      { role: "user", content: String(prompt ?? "") },
    ];

    const plannerResp = await fetch(GATEWAY_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: gatewayId(plannerBare),
        messages: plannerMessages,
        response_format: { type: "json_object" },
      }),
    });

    if (!plannerResp.ok) {
      const t = await plannerResp.text();
      console.error("planner gateway error:", plannerResp.status, t);
      if (plannerResp.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit reached, please retry shortly." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (plannerResp.status === 402) {
        return new Response(JSON.stringify({ error: "Credits exhausted." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: "AI gateway error (planner)" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const plannerData = await plannerResp.json();
    const plannerRaw: string = plannerData?.choices?.[0]?.message?.content ?? "";
    const plannerUsage = readUsage(plannerData?.usage);
    const plannerCost = modelCost(plannerBare, plannerUsage.inputTokens, plannerUsage.outputTokens);

    let planObj: { needsClarify?: boolean; questions?: unknown[]; plan?: Record<string, unknown> } = {};
    try {
      const cleaned = plannerRaw.replace(/```json|```/g, "").trim();
      planObj = JSON.parse(cleaned);
    } catch {
      planObj = {};
    }

    // If the planner asked for clarification, return that now — no Phase 2.
    if (!skipClarify && planObj?.needsClarify && Array.isArray(planObj.questions) && planObj.questions.length > 0) {
      const meta = {
        provider: providerOf(plannerBare),
        model: plannerBare,
        systems: [{ label: "/page planner", content: plannerSystem, approxTokens: approxTokens(plannerSystem) }],
        history: hist.map((m: { role: string; content: string }) => ({
          role: m.role, content: m.content ?? "", approxTokens: approxTokens(m.content ?? ""), attachments: [],
        })).concat([{
          role: "user", content: String(prompt ?? ""), approxTokens: approxTokens(String(prompt ?? "")), attachments: [],
        }]),
        memoryKeywords: [],
        memoryMatches: [],
        webContext: null,
        approxTotalInputTokens: approxTokens(plannerSystem) + hist.reduce((s: number, m: { content?: string }) => s + approxTokens(m.content ?? ""), 0) + approxTokens(String(prompt ?? "")),
        cost: {
          inputTokens: plannerUsage.inputTokens,
          outputTokens: plannerUsage.outputTokens,
          inputCostUsd: plannerCost.inputCostUsd,
          outputCostUsd: plannerCost.outputCostUsd,
        },
        models: [{
          provider: providerOf(plannerBare),
          model: plannerBare,
          role: "planner",
          inputTokens: plannerUsage.inputTokens,
          outputTokens: plannerUsage.outputTokens,
          inputCostUsd: plannerCost.inputCostUsd,
          outputCostUsd: plannerCost.outputCostUsd,
        }],
      };
      return new Response(JSON.stringify({ type: "clarify", questions: planObj.questions, meta }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ---------- Phase 2: content writer ----------
    const plan = planObj?.plan ?? null;
    const contentSystem = `You are a content writer filling in a pre-planned one-pager. A reasoning model has already designed the structure (title, subtitle, tabs, ordered blocks with briefs). Your job is to fill in concrete, real content for each block, exactly following the plan.

Rules:
- Use the same title, subtitle, tabs and block ordering as the plan.
- For each block, generate content based on its "brief" and "kind". Be concrete and accurate.
- Real numbers, real items, no filler.
- Reply with the language of the user's original message.

Plan (authoritative structure to follow):
${plan ? JSON.stringify(plan) : "(no plan available — derive a sensible structure yourself)"}

Always also produce a 1–2 sentence "summary" describing the page (shown in the chat above the page card).
Return the result by calling the render_one_pager tool.`;

    const contentMessages = [
      { role: "system", content: contentSystem },
      ...hist,
      { role: "user", content: String(prompt ?? "") },
    ];

    const contentResp = await fetch(GATEWAY_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: gatewayId(contentBare),
        messages: contentMessages,
        tools: [RENDER_TOOL],
        tool_choice: { type: "function", function: { name: "render_one_pager" } },
      }),
    });

    if (!contentResp.ok) {
      const t = await contentResp.text();
      console.error("content gateway error:", contentResp.status, t);
      if (contentResp.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit reached, please retry shortly." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (contentResp.status === 402) {
        return new Response(JSON.stringify({ error: "Credits exhausted." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: "AI gateway error (content)" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const contentData = await contentResp.json();
    const call = contentData?.choices?.[0]?.message?.tool_calls?.[0];
    const argsRaw = call?.function?.arguments;
    if (!argsRaw) {
      return new Response(JSON.stringify({ error: "No structured output" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let parsed: unknown;
    try {
      parsed = typeof argsRaw === "string" ? JSON.parse(argsRaw) : argsRaw;
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON from model" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Normalize: rename `kind` -> `type` for the frontend renderer.
    try {
      const p = parsed as { page?: { tabs?: Array<{ blocks?: Array<Record<string, unknown>> }> } };
      const tabs = p?.page?.tabs ?? [];
      for (const tab of tabs) {
        for (const b of tab.blocks ?? []) {
          if (b && typeof b === "object" && "kind" in b && !("type" in b)) {
            (b as Record<string, unknown>).type = (b as Record<string, unknown>).kind;
            delete (b as Record<string, unknown>).kind;
          }
        }
      }
    } catch (_) { /* ignore */ }

    // ---------- Aggregate usage across both models ----------
    const contentUsage = readUsage(contentData?.usage);
    const contentCost = modelCost(contentBare, contentUsage.inputTokens, contentUsage.outputTokens);

    const models = [
      {
        provider: providerOf(plannerBare),
        model: plannerBare,
        role: "planner",
        inputTokens: plannerUsage.inputTokens,
        outputTokens: plannerUsage.outputTokens,
        inputCostUsd: plannerCost.inputCostUsd,
        outputCostUsd: plannerCost.outputCostUsd,
      },
      {
        provider: providerOf(contentBare),
        model: contentBare,
        role: "content",
        inputTokens: contentUsage.inputTokens,
        outputTokens: contentUsage.outputTokens,
        inputCostUsd: contentCost.inputCostUsd,
        outputCostUsd: contentCost.outputCostUsd,
      },
    ];

    const totalInput = models.reduce((s, m) => s + m.inputTokens, 0);
    const totalOutput = models.reduce((s, m) => s + m.outputTokens, 0);
    const totalInputCostUsd = models.reduce((s, m) => s + m.inputCostUsd, 0);
    const totalOutputCostUsd = models.reduce((s, m) => s + m.outputCostUsd, 0);

    const metaSystems = [
      { label: "/page planner", content: plannerSystem, approxTokens: approxTokens(plannerSystem) },
      { label: "/page content", content: contentSystem, approxTokens: approxTokens(contentSystem) },
    ];
    const metaHistory = [
      ...hist.map((m: { role: string; content: string }) => ({
        role: m.role, content: m.content ?? "", approxTokens: approxTokens(m.content ?? ""), attachments: [],
      })),
      { role: "user", content: String(prompt ?? ""), approxTokens: approxTokens(String(prompt ?? "")), attachments: [] },
    ];

    const meta = {
      // Aggregate "primary" identifier: report the content writer model since
      // that's the bulk of the work and what shaped the final output.
      provider: providerOf(contentBare),
      model: contentBare,
      systems: metaSystems,
      history: metaHistory,
      memoryKeywords: [],
      memoryMatches: [],
      webContext: null,
      approxTotalInputTokens: metaSystems.reduce((s, x) => s + x.approxTokens, 0) + metaHistory.reduce((s, x) => s + x.approxTokens, 0),
      cost: {
        inputTokens: totalInput,
        outputTokens: totalOutput,
        inputCostUsd: totalInputCostUsd,
        outputCostUsd: totalOutputCostUsd,
      },
      models,
    };

    const out = (parsed && typeof parsed === "object")
      ? { ...(parsed as Record<string, unknown>), meta }
      : { meta };
    return new Response(JSON.stringify(out), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("generate-page error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
