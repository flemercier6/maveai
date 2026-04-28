// Generate a structured one-pager (JSON schema) via Lovable AI tool calling.
// Returns: { page: PageSpec, summary: string }
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SYSTEM_PROMPT = `You are an expert at structuring information into clear, scannable one-pager dashboards.

When the user asks a question or makes a request, do not respond in plain prose. Instead, design a structured one-pager that answers their request using the available block types.

Guidelines:
- Pick a clear, descriptive title.
- Add a short subtitle giving context (one line).
- Group content into 1–4 tabs only when it genuinely helps. For simpler answers, use a single tab.
- Inside each tab, mix block types that suit the content: headings, paragraphs, KPI grids, checklists, tables, charts, callouts, or bullet lists.
- Be concrete: real numbers, real items. No filler. No "lorem ipsum".
- Keep prose tight — one or two sentences per paragraph block.
- For charts, only use them when comparing values makes sense, and provide realistic data.
- Always also produce a 1–2 sentence "summary" describing the page (shown in the chat above the page card).
`;

const TOOL = {
  type: "function",
  function: {
    name: "render_one_pager",
    description: "Return a structured one-pager dashboard.",
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
                          enum: [
                            "heading",
                            "paragraph",
                            "callout",
                            "kpis",
                            "checklist",
                            "bullets",
                            "table",
                            "chart",
                          ],
                          description: "Block type discriminator.",
                        },
                        // heading
                        text: { type: "string" },
                        level: { type: "number", enum: [2, 3] },
                        // callout
                        tone: {
                          type: "string",
                          enum: ["info", "success", "warning", "danger"],
                        },
                        title: { type: "string" },
                        body: { type: "string" },
                        // kpis
                        items: {
                          type: "array",
                          items: {
                            type: "object",
                            properties: {
                              label: { type: "string" },
                              value: { type: "string" },
                              hint: { type: "string" },
                              // checklist items also use { label, checked }
                              checked: { type: "boolean" },
                            },
                          },
                        },
                        // bullets
                        bullets: { type: "array", items: { type: "string" } },
                        // table
                        columns: { type: "array", items: { type: "string" } },
                        rows: {
                          type: "array",
                          items: { type: "array", items: { type: "string" } },
                        },
                        // chart
                        chartType: {
                          type: "string",
                          enum: ["bar", "line", "pie"],
                        },
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

serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, { headers: corsHeaders });

  try {
    const { prompt, history } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY)
      return new Response(JSON.stringify({ error: "LOVABLE_API_KEY missing" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });

    const messages = [
      { role: "system", content: SYSTEM_PROMPT },
      ...(Array.isArray(history) ? history : []),
      { role: "user", content: String(prompt ?? "") },
    ];

    const resp = await fetch(
      "https://ai.gateway.lovable.dev/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "openai/gpt-5-mini",
          messages,
          tools: [TOOL],
          tool_choice: {
            type: "function",
            function: { name: "render_one_pager" },
          },
        }),
      },
    );

    if (!resp.ok) {
      const t = await resp.text();
      console.error("AI gateway error:", resp.status, t);
      if (resp.status === 429)
        return new Response(
          JSON.stringify({ error: "Rate limit reached, please retry shortly." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      if (resp.status === 402)
        return new Response(
          JSON.stringify({ error: "Credits exhausted." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      return new Response(JSON.stringify({ error: "AI gateway error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await resp.json();
    const call = data?.choices?.[0]?.message?.tool_calls?.[0];
    const argsRaw = call?.function?.arguments;
    if (!argsRaw)
      return new Response(JSON.stringify({ error: "No structured output" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });

    let parsed: unknown;
    try {
      parsed = typeof argsRaw === "string" ? JSON.parse(argsRaw) : argsRaw;
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON from model" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
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

    // ---------- Build developer breakdown meta ----------
    const approxTokens = (s: string) => Math.ceil((s?.length ?? 0) / 4);
    const PROVIDER = "openai";
    const MODEL = "openai/gpt-5-mini";
    const metaSystems = [
      { label: "/page system prompt", content: SYSTEM_PROMPT, approxTokens: approxTokens(SYSTEM_PROMPT) },
    ];
    const metaHistory = [
      ...(Array.isArray(history) ? history : []).map((m: { role: string; content: string }) => ({
        role: m.role,
        content: m.content ?? "",
        approxTokens: approxTokens(m.content ?? ""),
        attachments: [],
      })),
      {
        role: "user",
        content: String(prompt ?? ""),
        approxTokens: approxTokens(String(prompt ?? "")),
        attachments: [],
      },
    ];
    const approxTotalInputTokens = [...metaSystems, ...metaHistory]
      .reduce((s, x) => s + (x.approxTokens ?? 0), 0);

    // Pull real usage if the gateway returned it; pricing for gpt-5-mini.
    const usage = (data?.usage ?? {}) as {
      prompt_tokens?: number;
      completion_tokens?: number;
      input_tokens?: number;
      output_tokens?: number;
    };
    const inputTokens = Number(usage.input_tokens ?? usage.prompt_tokens ?? 0);
    const outputTokens = Number(usage.output_tokens ?? usage.completion_tokens ?? 0);
    // gpt-5-mini list pricing (USD / 1M tokens).
    const PRICE_IN = 0.25;
    const PRICE_OUT = 2.0;
    const inputCostUsd = (inputTokens / 1_000_000) * PRICE_IN;
    const outputCostUsd = (outputTokens / 1_000_000) * PRICE_OUT;

    const meta = {
      provider: PROVIDER,
      model: MODEL,
      systems: metaSystems,
      history: metaHistory,
      memoryKeywords: [],
      memoryMatches: [],
      webContext: null,
      approxTotalInputTokens,
      cost: {
        inputTokens,
        outputTokens,
        inputCostUsd,
        outputCostUsd,
      },
    };

    const out = (parsed && typeof parsed === "object") ? { ...(parsed as Record<string, unknown>), meta } : { meta };
    return new Response(JSON.stringify(out), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("generate-page error:", e);
    return new Response(
      JSON.stringify({
        error: e instanceof Error ? e.message : "Unknown error",
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
