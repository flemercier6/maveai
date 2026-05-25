// Multi-provider streaming chat: OpenAI, Anthropic, Google Gemini
// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

type Attachment =
  | { kind: "image"; name: string; mime: string; dataUrl: string }
  | { kind: "text"; name: string; mime: string; text: string };

type Msg = {
  role: "user" | "assistant" | "system";
  content: string;
  attachments?: Attachment[];
};

// Strip data URL prefix → return [mediaType, base64]
function splitDataUrl(dataUrl: string): { mediaType: string; base64: string } {
  const m = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (!m) return { mediaType: "image/png", base64: "" };
  return { mediaType: m[1], base64: m[2] };
}

// Fetch with hard timeout — used to cap classifier calls so a slow/503 upstream
// (Gemini Flash Lite occasionally takes 5–10s on 503) cannot block the user's response.
async function fetchWithTimeout(
  input: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(id);
  }
}

// Inline text-only attachments (PDF text, .md, etc.) directly into the textual content.
function mergeTextAttachments(content: string, atts: Attachment[] | undefined): string {
  if (!atts?.length) return content;
  const textParts = atts
    .filter((a): a is Extract<Attachment, { kind: "text" }> => a.kind === "text")
    .map((a) => `\n\n--- Attached file: ${a.name} (${a.mime}) ---\n${a.text}\n--- end ${a.name} ---`);
  return content + textParts.join("");
}

// ---------- Pricing (USD per 1M tokens) ----------
// Keep in sync with src/lib/models.ts. Values are public list prices.
type Price = { input: number; output: number };
const MODEL_PRICES: Record<string, Price> = {
  // OpenAI
  "gpt-5.5": { input: 2.5, output: 10 },
  "gpt-4o": { input: 2.5, output: 10 },
  "gpt-5-nano": { input: 0.05, output: 0.4 },
  // Anthropic
  "claude-opus-4-7": { input: 15, output: 75 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-haiku-4-5": { input: 1, output: 5 },
  "claude-3-5-haiku-latest": { input: 0.8, output: 4 },
  // Google
  "gemini-2.5-pro": { input: 1.25, output: 10 },
  "gemini-3.5-flash": { input: 0.3, output: 2.5 },
  "gemini-2.5-flash-lite": { input: 0.1, output: 0.4 },
  // Mistral
  "mistral-large-latest": { input: 2, output: 6 },
  "mistral-small-latest": { input: 0.2, output: 0.6 },
};

// ---------- Linkup web search pricing ----------
// Linkup standard depth: $0.006 per search request. Billed as passthrough on
// top of model token cost so the user pays for the web tool when it's used.
// (Deep depth would be $0.05/search — we only use standard, see linkupSearch.)
const LINKUP_SEARCH_COST_USD = 0.006;

// Web search is always billed at the floor multiplier (the same as the most
// expensive models). We achieve that by pre-scaling the raw Linkup cost so
// that after the downstream pipeline multiplies total_cost_usd by the model
// multiplier, the effective markup on the web-search portion lands exactly
// on WEB_SEARCH_MULTIPLIER.
const WEB_SEARCH_MULTIPLIER = 1.5;

// Mirror of src/lib/pricing.ts billingMultiplier(). Keep in sync.
function modelBillingMultiplier(model: string): number {
  const p = priceFor(model);
  const blended = p.input * 0.75 + p.output * 0.25;
  if (blended <= 0) return 3;
  const raw = (2.0 / blended) * 3;
  const clamped = Math.min(6, Math.max(1.5, raw));
  return Math.round(clamped * 10) / 10;
}
function priceFor(model: string): Price {
  if (MODEL_PRICES[model]) return MODEL_PRICES[model];
  // Fuzzy fallbacks for variants/aliases
  const m = model.toLowerCase();
  if (m.includes("opus")) return MODEL_PRICES["claude-opus-4-7"];
  if (m.includes("sonnet")) return MODEL_PRICES["claude-sonnet-4-6"];
  if (m.includes("haiku-4")) return MODEL_PRICES["claude-haiku-4-5"];
  if (m.includes("haiku")) return MODEL_PRICES["claude-3-5-haiku-latest"];
  if (m.includes("flash-lite")) return MODEL_PRICES["gemini-2.5-flash-lite"];
  if (m.includes("flash")) return MODEL_PRICES["gemini-3.5-flash"];
  if (m.includes("gemini")) return MODEL_PRICES["gemini-2.5-pro"];
  if (m.startsWith("mistral-large")) return MODEL_PRICES["mistral-large-latest"];
  if (m.startsWith("mistral")) return MODEL_PRICES["mistral-small-latest"];
  if (m.includes("mini")) return MODEL_PRICES["gpt-5-nano"];
  if (m.includes("gpt")) return MODEL_PRICES["gpt-5.5"];
  return { input: 0, output: 0 };
}

// ---------- Keyword extraction (no LLM, free) ----------
// Used both when persisting memories (so we can index them) and when matching
// memories against the current user message at chat time.
const STOPWORDS = new Set<string>([
  // English
  "the","a","an","and","or","but","if","then","else","of","in","on","at","to","for","with","from","by",
  "is","are","was","were","be","been","being","am","do","does","did","done","doing","have","has","had",
  "having","i","you","he","she","it","we","they","me","him","her","us","them","my","your","his","its",
  "our","their","this","that","these","those","there","here","what","which","who","whom","whose","when",
  "where","why","how","not","no","yes","ok","okay","so","than","too","very","just","also","as","than",
  "can","could","should","would","may","might","must","will","shall","want","need","like","know","get",
  "got","let","make","made","go","goes","went","come","came","take","took","see","saw","look","one","two",
  // French
  "le","la","les","un","une","des","de","du","et","ou","mais","si","alors","sinon","dans","sur","au","aux",
  "pour","avec","sans","par","est","sont","était","étaient","être","fait","faire","ai","as","a","avons",
  "avez","ont","avoir","je","tu","il","elle","on","nous","vous","ils","elles","me","te","se","mon","ton",
  "son","ma","ta","sa","mes","tes","ses","notre","votre","leur","nos","vos","leurs","ce","cet","cette",
  "ces","ça","celui","celle","ceux","celles","qui","que","quoi","dont","où","quand","comment","pourquoi",
  "pas","ne","non","oui","plus","moins","très","trop","aussi","encore","déjà","peu","beaucoup","tout",
  "tous","toute","toutes","peut","peux","pouvoir","veux","veut","vouloir","dois","doit","devoir","fait",
  "vais","va","aller","sais","sait","savoir","comme","car","donc","puis","aux","cela","ceci",
]);

/** Extract a normalized set of topical keywords from arbitrary text. */
function extractKeywords(text: string, max = 12): string[] {
  if (!text) return [];
  // Lowercase, strip diacritics, keep letters/digits as token boundaries.
  const norm = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  const tokens = norm.match(/[a-z0-9]{3,}/g) ?? [];
  const counts = new Map<string, number>();
  for (const t of tokens) {
    if (STOPWORDS.has(t)) continue;
    if (/^\d+$/.test(t)) continue; // pure numbers aren't useful keywords
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  // Sort by frequency, then alpha for stability.
  return Array.from(counts.entries())
    .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))
    .slice(0, max)
    .map(([t]) => t);
}

/** Score a memory's relevance to a user message via keyword overlap. */
function memoryRelevance(memKeywords: string[], queryKeywords: Set<string>): number {
  if (!memKeywords.length || !queryKeywords.size) return 0;
  let hits = 0;
  for (const k of memKeywords) if (queryKeywords.has(k)) hits++;
  // Normalize by memory length so 2/3 beats 2/12 — favors focused memories.
  return hits / Math.sqrt(memKeywords.length);
}

function sseEncoder() {
  const encoder = new TextEncoder();
  return (obj: unknown) => encoder.encode(`data: ${JSON.stringify(obj)}\n\n`);
}

async function* parseSSELines(reader: ReadableStreamDefaultReader<Uint8Array>) {
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, idx).replace(/\r$/, "");
      buf = buf.slice(idx + 1);
      if (line) yield line;
    }
  }
  if (buf.trim()) yield buf;
}

// ---------- OpenAI ----------
type Usage = { input_tokens: number; output_tokens: number };

async function* streamOpenAI(apiKey: string, model: string, messages: Msg[]): AsyncGenerator<string, Usage | undefined> {
  const oaiMessages = messages.map((m) => {
    const text = mergeTextAttachments(m.content, m.attachments);
    const images = (m.attachments ?? []).filter((a) => a.kind === "image") as Extract<Attachment, { kind: "image" }>[];
    if (m.role === "user" && images.length) {
      return {
        role: "user",
        content: [
          { type: "text", text },
          ...images.map((img) => ({ type: "image_url", image_url: { url: img.dataUrl } })),
        ],
      };
    }
    return { role: m.role, content: text };
  });
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: oaiMessages,
      stream: true,
      stream_options: { include_usage: true },
    }),
  });
  if (!r.ok || !r.body) {
    const t = await r.text();
    throw new Error(`OpenAI ${r.status}: ${t}`);
  }
  let usage: Usage | undefined;
  for await (const line of parseSSELines(r.body.getReader())) {
    if (!line.startsWith("data: ")) continue;
    const data = line.slice(6).trim();
    if (data === "[DONE]") break;
    try {
      const j = JSON.parse(data);
      const delta = j.choices?.[0]?.delta?.content;
      if (delta) yield delta as string;
      if (j.usage) {
        usage = {
          input_tokens: Number(j.usage.prompt_tokens ?? 0),
          output_tokens: Number(j.usage.completion_tokens ?? 0),
        };
      }
    } catch { /* partial */ }
  }
  return usage;
}

// ---------- Anthropic ----------
async function* streamAnthropic(apiKey: string, model: string, messages: Msg[]): AsyncGenerator<string, Usage | undefined> {
  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const conv = messages.filter((m) => m.role !== "system");
  // Prompt caching: marks the system prompt as cacheable (5 min ephemeral cache).
  // Cuts TTFT by 50-80% on subsequent requests with the same system prompt — huge
  // win for Opus 4.7 which otherwise has 1-2 s TTFT.
  const systemPayload = system
    ? [{ type: "text" as const, text: system, cache_control: { type: "ephemeral" as const } }]
    : undefined;
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "prompt-caching-2024-07-31",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 8000,
      stream: true,
      system: systemPayload,
      messages: conv.map((m) => {
        const text = mergeTextAttachments(m.content, m.attachments);
        const images = (m.attachments ?? []).filter((a) => a.kind === "image") as Extract<Attachment, { kind: "image" }>[];
        if (m.role === "user" && images.length) {
          return {
            role: "user",
            content: [
              ...images.map((img) => {
                const { mediaType, base64 } = splitDataUrl(img.dataUrl);
                return { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } };
              }),
              { type: "text", text },
            ],
          };
        }
        return { role: m.role, content: text };
      }),
    }),
  });
  if (!r.ok || !r.body) {
    const t = await r.text();
    throw new Error(`Anthropic ${r.status}: ${t}`);
  }
  let inputTok = 0;
  let outputTok = 0;
  for await (const line of parseSSELines(r.body.getReader())) {
    if (!line.startsWith("data: ")) continue;
    const data = line.slice(6).trim();
    try {
      const j = JSON.parse(data);
      if (j.type === "content_block_delta" && j.delta?.type === "text_delta") {
        yield j.delta.text as string;
      }
      if (j.type === "message_start" && j.message?.usage) {
        inputTok = Number(j.message.usage.input_tokens ?? 0);
        outputTok = Number(j.message.usage.output_tokens ?? 0);
      }
      if (j.type === "message_delta" && j.usage) {
        if (typeof j.usage.input_tokens === "number") inputTok = j.usage.input_tokens;
        if (typeof j.usage.output_tokens === "number") outputTok = j.usage.output_tokens;
      }
    } catch { /* partial */ }
  }
  return { input_tokens: inputTok, output_tokens: outputTok };
}

// ---------- Google Gemini (SSE) ----------
async function* streamGemini(apiKey: string, model: string, messages: Msg[]): AsyncGenerator<string, Usage | undefined> {
  const sys = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const contents = messages
    .filter((m) => m.role !== "system")
    .map((m) => {
      const text = mergeTextAttachments(m.content, m.attachments);
      const images = (m.attachments ?? []).filter((a) => a.kind === "image") as Extract<Attachment, { kind: "image" }>[];
      const parts: any[] = [];
      if (text) parts.push({ text });
      for (const img of images) {
        const { mediaType, base64 } = splitDataUrl(img.dataUrl);
        parts.push({ inlineData: { mimeType: mediaType, data: base64 } });
      }
      if (!parts.length) parts.push({ text: "" });
      return {
        role: m.role === "assistant" ? "model" : "user",
        parts,
      };
    });
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${apiKey}`;
  const body: any = { contents };
  if (sys) body.systemInstruction = { parts: [{ text: sys }] };
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok || !r.body) {
    const t = await r.text();
    throw new Error(`Gemini ${r.status}: ${t}`);
  }
  let usage: Usage | undefined;
  for await (const line of parseSSELines(r.body.getReader())) {
    if (!line.startsWith("data: ")) continue;
    const data = line.slice(6).trim();
    try {
      const j = JSON.parse(data);
      const txt = j.candidates?.[0]?.content?.parts?.map((p: any) => p.text).filter(Boolean).join("");
      if (txt) {
        // Gemini often delivers large chunks at once which kills the streaming feel.
        // Split into smaller word-sized pieces so the client sees a steady flow.
        const pieces = txt.match(/\S+\s*|\s+/g) ?? [txt];
        for (const piece of pieces) {
          yield piece as string;
        }
      }
      if (j.usageMetadata) {
        usage = {
          input_tokens: Number(j.usageMetadata.promptTokenCount ?? 0),
          output_tokens: Number(
            j.usageMetadata.candidatesTokenCount ?? j.usageMetadata.totalTokenCount ?? 0,
          ),
        };
      }
    } catch { /* partial */ }
  }
  return usage;
}

// ---------- Planner: stream short reasoning steps with Gemini Flash ----------
// Used as a "thinking" preamble for advanced models so the user sees the AI
// reason out loud (Claude-style) before the main answer is generated.
//
// Streams plain text where each step starts with "- " on a new line. The
// caller parses completed lines and forwards them as `thinking` SSE events.
async function* streamPlannerSteps(
  googleKey: string,
  userText: string,
  contextHints: string,
): AsyncGenerator<string> {
  const sys =
    `You are the inner monologue of an advanced AI assistant. The user just sent a message. ` +
    `Before the main model answers, you write 3 to 5 SHORT reasoning steps that show how you ` +
    `are approaching the problem — like Claude's "thinking" panel.\n\n` +
    `STRICT FORMAT: output ONLY a plain bulleted list. One step per line, each line starts with ` +
    `"- " (dash + space). 6 to 14 words per step. No headings, no numbering, no JSON, no preamble, ` +
    `no closing remark, no markdown bold.\n\n` +
    `Tone: first person, present tense, concise, decisive. Sound like you are working through it ` +
    `live. Examples of good steps:\n` +
    `- Breaking the question into its main components\n` +
    `- Recalling what I know about French tax law on freelancers\n` +
    `- Checking the attached PDF for the actual job requirements\n` +
    `- Drafting a structured answer with concrete next steps\n\n` +
    `Steps must be SPECIFIC to the user's request, not generic filler.`;
  const prompt = contextHints
    ? `User message:\n"""${userText}"""\n\nContext:\n${contextHints}\n\nWrite the steps now.`
    : `User message:\n"""${userText}"""\n\nWrite the steps now.`;
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:streamGenerateContent?alt=sse&key=${googleKey}`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      systemInstruction: { parts: [{ text: sys }] },
      generationConfig: { temperature: 0.6, maxOutputTokens: 220 },
    }),
  });
  if (!r.ok || !r.body) {
    const t = await r.text().catch(() => "");
    throw new Error(`Planner ${r.status}: ${t}`);
  }
  for await (const line of parseSSELines(r.body.getReader())) {
    if (!line.startsWith("data: ")) continue;
    const data = line.slice(6).trim();
    try {
      const j = JSON.parse(data);
      const txt = j.candidates?.[0]?.content?.parts?.map((p: any) => p.text).filter(Boolean).join("");
      if (txt) yield txt as string;
    } catch { /* partial */ }
  }
}

// Models that should trigger the visible "thinking" preamble.
function isAdvancedModel(model: string): boolean {
  if (!model) return false;
  const m = model.toLowerCase();
  if (m.startsWith("gpt-5")) return true;
  if (m.startsWith("claude-opus") || m.startsWith("claude-sonnet")) return true;
  if (m === "gemini-2.5-pro") return true;
  if (m === "mistral-large-latest") return true;
  return false;
}

// ---------- Mistral (OpenAI-compatible SSE) ----------
async function* streamMistral(apiKey: string, model: string, messages: Msg[]): AsyncGenerator<string, Usage | undefined> {
  // Mistral's chat-completions API mirrors OpenAI's. Images aren't supported on
  // text models, so we inline text attachments and ignore image attachments.
  const mistralMessages = messages.map((m) => ({
    role: m.role,
    content: mergeTextAttachments(m.content, m.attachments),
  }));
  const r = await fetch("https://api.mistral.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify({
      model,
      messages: mistralMessages,
      stream: true,
    }),
  });
  if (!r.ok || !r.body) {
    const t = await r.text();
    throw new Error(`Mistral ${r.status}: ${t}`);
  }
  let usage: Usage | undefined;
  for await (const line of parseSSELines(r.body.getReader())) {
    if (!line.startsWith("data: ")) continue;
    const data = line.slice(6).trim();
    if (data === "[DONE]") break;
    try {
      const j = JSON.parse(data);
      const delta = j.choices?.[0]?.delta?.content;
      if (delta) yield delta as string;
      if (j.usage) {
        usage = {
          input_tokens: Number(j.usage.prompt_tokens ?? 0),
          output_tokens: Number(j.usage.completion_tokens ?? 0),
        };
      }
    } catch { /* partial */ }
  }
  return usage;
}

// ---------- Web tools (Linkup) ----------

type WebDecision =
  | { action: "none" }
  | { action: "scrape"; url: string }
  | { action: "search"; query: string };

async function decideWebTool(args: {
  googleKey?: string;
  openaiKey?: string;
  anthropicKey?: string;
  userText: string;
}): Promise<WebDecision> {
  const { userText } = args;
  if (!userText.trim()) return { action: "none" };

  // Quick heuristic: explicit URL → scrape
  const urlMatch = userText.match(/https?:\/\/[^\s<>"']+/);
  if (urlMatch) return { action: "scrape", url: urlMatch[0] };

  const prompt = `Decide whether answering this message correctly requires consulting the web.

Reply ONLY in JSON, no surrounding text, in one of these formats:
{"action":"none"}                          → general knowledge is enough
{"action":"search","query":"..."}          → fresh / factual / news / prices / results / people / events info is needed
{"action":"scrape","url":"https://..."}    → the user explicitly cites a website/URL to read

Rules:
- "none" for: chat, code, reasoning, creativity, rewriting, translation, math, opinion.
- "search" ONLY if the answer depends on up-to-date or web-verifiable factual info.
- Keep the query short (≤ 12 words), in the user's own language.

Message:
${userText.slice(0, 1500)}`;

  let raw = "";
  try {
    if (args.googleKey) {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${args.googleKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: { responseMimeType: "application/json" },
          }),
        },
      );
      const j = await r.json();
      raw = j.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join("") ?? "";
    } else if (args.openaiKey) {
      const r = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${args.openaiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "gpt-5-nano",
          messages: [{ role: "user", content: prompt }],
          response_format: { type: "json_object" },
        }),
      });
      const j = await r.json();
      raw = j.choices?.[0]?.message?.content ?? "";
    } else {
      return { action: "none" };
    }
    const cleaned = raw.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(cleaned);
    if (parsed?.action === "search" && typeof parsed.query === "string" && parsed.query.trim()) {
      return { action: "search", query: parsed.query.trim() };
    }
    if (parsed?.action === "scrape" && typeof parsed.url === "string" && /^https?:\/\//.test(parsed.url)) {
      return { action: "scrape", url: parsed.url };
    }
  } catch (e) {
    console.error("decideWebTool failed", e);
  }
  return { action: "none" };
}

async function linkupFetch(apiKey: string, url: string): Promise<string | null> {
  // Try fast path first (no JS rendering), then retry with renderJs on failure
  // since many modern sites return empty/blocked content without JS execution.
  for (const renderJs of [false, true]) {
    try {
      const r = await fetch("https://api.linkup.so/v1/fetch", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          url,
          extractImages: false,
          includeRawHtml: false,
          renderJs,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        console.error("linkup fetch error", r.status, "renderJs=", renderJs, j);
        continue;
      }
      const md: string | undefined = j?.markdown ?? j?.content;
      if (md && md.trim().length > 0) return md.slice(0, 15000);
    } catch (e) {
      console.error("linkup fetch exception renderJs=", renderJs, e);
    }
  }
  return null;
}

type WebSource = { title: string; url: string };
type WebImage = { url: string; title?: string; sourceUrl?: string };

async function linkupSearch(
  apiKey: string,
  query: string,
): Promise<{ content: string; sources: WebSource[]; images: WebImage[] } | null> {
  try {
    const r = await fetch("https://api.linkup.so/v1/search", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        q: query,
        depth: "standard",
        outputType: "searchResults",
        includeImages: true,
      }),
    });
    const j = await r.json();
    if (!r.ok) {
      console.error("linkup search error", r.status, j);
      return null;
    }
    const results: any[] = j?.results ?? [];
    if (!Array.isArray(results) || !results.length) return null;
    // Linkup mixes text and image entries; separate them.
    const textResults = results.filter((res) => {
      const t = (res.type ?? "").toString().toLowerCase();
      return t !== "image" && (res.content || res.snippet || res.description);
    });
    const imageResults = results.filter((res) => {
      const t = (res.type ?? "").toString().toLowerCase();
      return t === "image" || /\.(jpe?g|png|gif|webp|avif)(\?|$)/i.test(res.url ?? "");
    });
    // Keep more sources for Reflexion mode (no artificial 5-source cap), and trim each snippet
    // a bit so the total prompt size stays reasonable.
    const top = textResults.slice(0, 12);
    const sources: WebSource[] = top.map((res) => ({
      title: (res.name ?? res.title ?? "Untitled").toString(),
      url: (res.url ?? "").toString(),
    }));
    const images: WebImage[] = imageResults.slice(0, 6).map((res) => ({
      url: (res.url ?? "").toString(),
      title: (res.name ?? res.title ?? "").toString() || undefined,
      sourceUrl: (res.sourceUrl ?? res.referrer ?? undefined) as string | undefined,
    })).filter((im) => /^https?:\/\//.test(im.url));
    const blocks = top.map((res, i) => {
      const title = sources[i].title;
      const url = sources[i].url;
      const content = (res.content ?? res.snippet ?? res.description ?? "").toString().slice(0, 700);
      return `### Source ${i + 1}: ${title}\nURL: ${url}\n\n${content}`;
    });
    return {
      content: blocks.join("\n\n---\n\n").slice(0, 10000),
      sources,
      images,
    };
  } catch (e) {
    console.error("linkup search exception", e);
    return null;
  }
}

// ---------- Agentic multi-step plan ----------
// For complex queries, we ask a small/cheap model to draft an ordered plan of
// 2–4 steps, where each step is either an "analyze" (pure reasoning, no tool),
// a "search" (linkup web search) or a "scrape" (linkup URL fetch). Between every
// action we stream a short narrative "ok I just did X, now I'm moving to Y"
// directly into the assistant message via `delta` events, so the user sees
// the agent thinking in real time, inline.
type AgenticStep =
  | { kind: "analyze"; intent: string }
  | { kind: "search"; query: string; intent: string }
  | { kind: "scrape"; url: string; intent: string }
  | { kind: "memory"; query: string; intent: string }
  | { kind: "plan"; intent: string }
  | { kind: "hypothesis"; intent: string }
  | { kind: "challenge"; intent: string }
  | { kind: "compare"; intent: string }
  | { kind: "synthesize"; intent: string };

type AgenticPlan = {
  complex: boolean;
  // Short label of what the user is really asking, in their own language.
  goal: string;
  steps: AgenticStep[];
};

// Reflexion plan: multi-step ReAct loop driven by user (not auto-detected).
// Step count is bounded by the user-selected effort: low=3, medium=5, high=8.
async function decideReflexionPlan(args: {
  googleKey?: string;
  userText: string;
  hasWebSearch: boolean;
  hasScrape: boolean;
  hasMemory: boolean;
  maxSteps: number;
}): Promise<AgenticPlan> {
  const empty: AgenticPlan = { complex: false, goal: "", steps: [] };
  const { userText, googleKey, maxSteps } = args;
  if (!googleKey || !userText.trim()) return empty;

  const minSteps = Math.min(3, maxSteps);

  const dataKinds = [
    args.hasMemory ? `{"kind":"memory","query":"<short phrase>","intent":"what to recall from the user's memory (≤12 words)"}` : null,
    args.hasWebSearch ? `{"kind":"search","query":"<short web query ≤12 words>","intent":"what fact to verify (≤12 words)"}` : null,
    args.hasScrape ? `{"kind":"scrape","url":"https://...","intent":"why read this specific URL (≤12 words)"}` : null,
  ].filter(Boolean).join("\n");

  const prompt = `You are the planner of a deep Reflexion reasoning loop. The user EXPLICITLY wants a multi-step reasoning process with genuine intellectual depth — not just search + answer.

Design a reasoning journey that surfaces the AI's thinking clearly. Use these step kinds:

REASONING STEPS (no tool call — the AI reasons out loud):
{"kind":"plan","intent":"What angles you'll explore and your initial hypothesis (specific to this question)"}
{"kind":"hypothesis","intent":"Your working assumption before gathering evidence"}
{"kind":"challenge","intent":"Which assumption or finding you're questioning and why"}
{"kind":"compare","intent":"What two perspectives or conclusions you're weighing"}
{"kind":"synthesize","intent":"What threads you're pulling together into a conclusion"}
{"kind":"analyze","intent":"What specific aspect you're reasoning through"}

DATA GATHERING STEPS (call a tool):
${dataKinds || '(no data tools available — use reasoning steps only)'}

RULES:
1. ALWAYS start with {"kind":"plan",...} — it shows the user your approach upfront.
2. Use "hypothesis" before searching when you have a prior expectation to test.
3. After gathering data: ALWAYS include at least one of challenge/compare/synthesize to show the reasoning.
4. For conflicting evidence: use "compare" to weigh perspectives explicitly.
5. For assumptions that might be wrong: use "challenge" to question them.
6. End with "synthesize" when multiple angles were explored (medium/high effort).
7. Intents MUST be SPECIFIC to the user's actual question — reference the real topic.
8. Total steps: ${minSteps} to ${maxSteps}. NEVER fewer than ${minSteps}.
9. Search queries: in the user's language, ≤12 words, concrete and targeted.
10. DO NOT end with a plain "analyze" step — use "synthesize" instead for the final reasoning.

Good plan examples:
- Low effort (3 steps): [plan, search, challenge]
- Medium effort (5 steps): [plan, hypothesis, search, challenge, synthesize]
- High effort (7+ steps): [plan, hypothesis, memory, search, search(2nd angle), challenge, compare, synthesize]

Reply ONLY with strict JSON — no prose, no markdown:
{"goal":"<one short sentence in the user's language>","steps":[...]}

User message:
"""${userText.slice(0, 2000)}"""`;

  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${googleKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: "application/json", temperature: 0.4 },
        }),
      },
    );
    if (!r.ok) {
      const t = await r.text().catch(() => "");
      console.error("decideReflexionPlan HTTP", r.status, t.slice(0, 300));
      return empty;
    }
    const j = await r.json();
    const raw = j.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join("") ?? "";
    const cleaned = raw.replace(/```json|```/g, "").trim();
    if (!cleaned) {
      console.error("decideReflexionPlan empty response", JSON.stringify(j).slice(0, 300));
      return empty;
    }
    const parsed = JSON.parse(cleaned);
    const rawSteps: any[] = Array.isArray(parsed.steps) ? parsed.steps : [];
    const REASONING_KINDS = new Set(["plan", "hypothesis", "challenge", "compare", "synthesize", "analyze"]);
    const steps: AgenticStep[] = [];
    for (const s of rawSteps) {
      if (steps.length >= maxSteps) break;
      const intent = (s?.intent ?? "").toString().slice(0, 140).trim();
      if (!intent) continue;
      if (REASONING_KINDS.has(s?.kind)) {
        steps.push({ kind: s.kind as AgenticStep["kind"], intent } as AgenticStep);
      } else if (s?.kind === "search" && args.hasWebSearch && typeof s.query === "string" && s.query.trim()) {
        steps.push({ kind: "search", query: s.query.trim().slice(0, 120), intent });
      } else if (s?.kind === "scrape" && args.hasScrape && typeof s.url === "string" && /^https?:\/\//.test(s.url)) {
        steps.push({ kind: "scrape", url: s.url, intent });
      } else if (s?.kind === "memory" && args.hasMemory && typeof s.query === "string" && s.query.trim()) {
        steps.push({ kind: "memory", query: s.query.trim().slice(0, 120), intent });
      }
    }
    if (steps.length < 2) {
      return {
        complex: true,
        goal: (parsed.goal ?? userText.slice(0, 100)).toString().slice(0, 200),
        steps: [
          { kind: "plan", intent: "outline the approach and key angles to explore" },
          ...(args.hasWebSearch ? [{ kind: "search" as const, query: userText.slice(0, 80), intent: "gather relevant facts" }] : []),
          { kind: "synthesize", intent: "weigh the findings and form a conclusion" },
        ].slice(0, maxSteps),
      };
    }
    return {
      complex: true,
      goal: (parsed.goal ?? "").toString().slice(0, 200),
      steps,
    };
  } catch (e) {
    console.error("decideReflexionPlan failed", e);
    return empty;
  }
}

async function decideAgenticPlan(args: {
  googleKey?: string;
  userText: string;
  hasWebSearch: boolean;
  hasScrape: boolean;
}): Promise<AgenticPlan> {
  const empty: AgenticPlan = { complex: false, goal: "", steps: [] };
  const { userText, googleKey } = args;
  if (!googleKey || !userText.trim()) return empty;
  if (!args.hasWebSearch && !args.hasScrape) return empty;

  const allowed = [
    args.hasScrape ? `{"kind":"scrape","url":"https://...","intent":"why we read this page (≤10 words)"}` : null,
    args.hasWebSearch ? `{"kind":"search","query":"<short web query>","intent":"what we want to learn (≤10 words)"}` : null,
    `{"kind":"analyze","intent":"what we are reasoning about (≤10 words)"}`,
  ].filter(Boolean).join("\n");

  const prompt = `You are a planner for an agentic AI assistant.

Decide whether the user's message is COMPLEX enough to warrant a multi-step research process.

Mark it COMPLEX only if at least one of these is true:
- The answer requires combining facts about TWO OR MORE distinct concepts/entities/aspects.
- The answer depends on RECENT or VERIFIABLE web facts AND requires comparison or synthesis.
- The user explicitly asks for research, investigation, deep analysis, comparison, or "find out".
- The question covers a broad topic that benefits from breaking down into sub-questions.

Mark it SIMPLE for: chitchat, single-fact lookup, code, math, rewriting, translation, opinion, simple how-to, quick definitions.

If COMPLEX, draft an ordered plan of 2 to 4 steps. Each step is one of:
${allowed}

Rules for steps:
- KEEP PLANS SHORT. Prefer 2 steps over 3; prefer 3 over 4.
- "analyze" steps are pure reasoning — no web tool is called. Use them to break down a problem or consolidate findings.
- Web searches: use 0, 1, or at most 2 total.
  - 0 searches: when the question only needs reasoning/synthesis, not fresh web data.
  - 1 search: sufficient for most research questions — PREFER THIS.
  - 2 searches: ONLY when you need two truly DIFFERENT angles that one query cannot cover (e.g., one about concept A, one about concept B). NEVER search twice for the same or overlapping topic.
- Search queries must be short (≤ 12 words) and in the user's language.
- Every "intent" must be CONCRETE and tied to the user's question, not generic.

Good plan examples:
- Simple research (most cases): [{"kind":"search","query":"...","intent":"find key facts"}, {"kind":"analyze","intent":"synthesize findings into answer"}]
- Reasoning only (no fresh data needed): [{"kind":"analyze","intent":"break down the problem"}, {"kind":"analyze","intent":"draw conclusions"}]
- Two-angle research (rare): [{"kind":"search","query":"angle A","intent":"..."}, {"kind":"search","query":"angle B","intent":"..."}, {"kind":"analyze","intent":"compare both angles"}]

Reply ONLY with strict JSON:
{"complex": true|false, "goal": "<one short sentence describing what the user wants>", "steps": [...]}

If SIMPLE, reply: {"complex": false, "goal": "", "steps": []}

User message:
"""${userText.slice(0, 2000)}"""`;

  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${googleKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: "application/json", temperature: 0.3 },
        }),
      },
    );
    const j = await r.json();
    const raw = j.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join("") ?? "";
    const cleaned = raw.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(cleaned);
    if (!parsed?.complex) return empty;
    const rawSteps: any[] = Array.isArray(parsed.steps) ? parsed.steps : [];
    const steps: AgenticStep[] = [];
    for (const s of rawSteps) {
      if (steps.length >= 6) break;
      const intent = (s?.intent ?? "").toString().slice(0, 120).trim();
      if (s?.kind === "analyze" && intent) {
        steps.push({ kind: "analyze", intent });
      } else if (s?.kind === "search" && args.hasWebSearch && typeof s.query === "string" && s.query.trim()) {
        steps.push({ kind: "search", query: s.query.trim().slice(0, 120), intent });
      } else if (s?.kind === "scrape" && args.hasScrape && typeof s.url === "string" && /^https?:\/\//.test(s.url)) {
        steps.push({ kind: "scrape", url: s.url, intent });
      }
    }
    if (steps.length < 2) return empty;
    return {
      complex: true,
      goal: (parsed.goal ?? "").toString().slice(0, 200),
      steps,
    };
  } catch (e) {
    console.error("decideAgenticPlan failed", e);
    return empty;
  }
}

// Stream narration for an agentic step, using Gemini Flash.
// Two modes:
//   - "reasoning" steps (plan/hypothesis/challenge/compare/synthesize): the narration IS the
//     content of the step — 2-4 sentences of actual substantive reasoning.
//   - "transition" steps (search/memory/scrape completed): short 1-2 sentence narration
//     of what was found + what comes next.
const REFLEXION_REASONING_KINDS = new Set(["plan", "hypothesis", "challenge", "compare", "synthesize"]);

async function* streamAgenticNarration(
  googleKey: string,
  args: {
    userLang: string;
    userText: string;
    goal: string;
    phase: "intro" | "between" | "outro";
    justDid?: { kind: "search" | "scrape" | "memory"; label: string; foundCount: number; intent: string };
    currentStep?: AgenticStep;
    nextStep?: AgenticStep;
    isFinal?: boolean;
    observations?: string[];
  },
): AsyncGenerator<string> {
  const isReasoningStep = args.currentStep && REFLEXION_REASONING_KINDS.has(args.currentStep.kind);

  let sys: string;
  let task: string;
  let maxTokens: number;

  if (isReasoningStep && args.currentStep) {
    // Reasoning step: the narration IS the visible reasoning content.
    // It should perform actual intellectual work, not just announce what will happen.
    const kind = args.currentStep.kind;
    const intent = args.currentStep.intent;
    const obsBlock = (args.observations ?? []).length > 0
      ? `\n\nContext gathered so far:\n${(args.observations ?? []).map((o, i) => `${i + 1}. ${o}`).join("\n")}`
      : "";
    const reasoningGuide: Record<string, string> = {
      plan:
        `Describe your approach to this question. Mention the key angles you'll explore, what you already suspect, and why a careful multi-step analysis is warranted. Be concrete about the specific topic.`,
      hypothesis:
        `State your working hypothesis before gathering evidence. What do you currently expect the answer to be? What prior knowledge or reasoning leads you there? Acknowledge what could make you wrong.`,
      challenge:
        `Question your current understanding. Identify the weakest assumption in what you've found or reasoned so far. Name a specific counterargument or gap. What would need to be true for your current thinking to be wrong?`,
      compare:
        `Name the two (or more) competing perspectives and walk through the key dimensions. Where do they agree? Where do they diverge and why? Make a preliminary judgment about which evidence is stronger.`,
      synthesize:
        `Weave the key threads together. What does the combined evidence point to? Name any remaining tensions or uncertainties. State your emerging conclusion and what it's based on.`,
    };
    sys =
      `You are an AI reasoning out loud in front of the user, in the user's language. ` +
      `This is a deep reasoning step — you are NOT announcing a transition, you are DOING actual intellectual work. ` +
      `Write 2-4 sentences (70-120 words). First person, present tense, flowing prose. ` +
      `No headings, no markdown, no bullets, no quotes. Write in the user's exact language.`;
    task =
      `Reasoning step type: "${kind}"\nStep intent: "${intent}"${obsBlock}\n\n` +
      `${reasoningGuide[kind] ?? `Reason through: ${intent}`}\n\n` +
      `Be SPECIFIC to the user's actual question. DO NOT say "I will now do X" — ACTUALLY DO the reasoning.`;
    maxTokens = 500;
  } else if (args.phase === "intro") {
    sys =
      `You are an AI assistant THINKING OUT LOUD in front of the user, in the user's language. ` +
      `Write 1 to 2 SHORT sentences (max ~35 words total). First person, present tense, casual but precise. ` +
      `No headings, no markdown, no bullets. Match the user's language exactly.`;
    task = `The user asked a question that requires research. Write a short opener saying you'll start by ${describeStep(args.nextStep!)}.`;
    maxTokens = 300;
  } else if (args.phase === "between") {
    sys =
      `You are an AI assistant THINKING OUT LOUD in front of the user, in the user's language. ` +
      `Write 1 to 3 SHORT sentences (max ~60 words total). First person, present tense, casual but precise. ` +
      `No headings, no markdown, no bullets. Match the user's language exactly.`;
    if (args.justDid) {
      const did = args.justDid;
      const verb = did.kind === "search"
        ? `searched the web for "${did.label}"`
        : did.kind === "scrape"
          ? `read the page ${did.label}`
          : `looked through your memory for "${did.label}"`;
      const found = did.foundCount > 0
        ? (did.kind === "memory"
            ? `found ${did.foundCount} relevant ${did.foundCount > 1 ? "memories" : "memory"}`
            : `found ${did.foundCount} relevant source${did.foundCount > 1 ? "s" : ""}`)
        : `didn't find much`;
      const obsNote = (args.observations ?? []).length > 1
        ? ` (previous findings: ${(args.observations ?? []).slice(0, -1).join("; ")})`
        : "";
      if (args.isFinal) {
        task = `You just ${verb} (${found}, intent: ${did.intent})${obsNote}. Say in 1-2 sentences what you understood from this step and that you now have enough to answer.`;
      } else {
        task = `You just ${verb} (${found}, intent: ${did.intent})${obsNote}. Briefly say what you learned or confirmed, then announce the next step: ${describeStep(args.nextStep!)}.`;
      }
    } else {
      task = args.isFinal
        ? `You have finished the research steps. Say in 1 sentence that you now have everything needed to write a thorough answer.`
        : `Briefly announce you're moving to the next step: ${args.nextStep ? describeStep(args.nextStep) : "the final answer"}.`;
    }
    maxTokens = 350;
  } else {
    sys =
      `You are an AI assistant THINKING OUT LOUD in front of the user, in the user's language. ` +
      `Write 1 SHORT sentence. Match the user's language.`;
    task = `Wrap up: say you have gathered enough and are now writing the final answer.`;
    maxTokens = 200;
  }

  const prompt = `User goal: ${args.goal || args.userText.slice(0, 120)}\nUser's original message (for language detection):\n"""${args.userText.slice(0, 400)}"""\n\nTask: ${task}`;
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:streamGenerateContent?alt=sse&key=${googleKey}`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      systemInstruction: { parts: [{ text: sys }] },
      generationConfig: { temperature: isReasoningStep ? 0.8 : 0.7, maxOutputTokens: maxTokens },
    }),
  });
  if (!r.ok || !r.body) {
    const t = await r.text().catch(() => "");
    throw new Error(`Narrator ${r.status}: ${t}`);
  }
  for await (const line of parseSSELines(r.body.getReader())) {
    if (!line.startsWith("data: ")) continue;
    const data = line.slice(6).trim();
    try {
      const j = JSON.parse(data);
      const txt = j.candidates?.[0]?.content?.parts?.map((p: any) => p.text).filter(Boolean).join("");
      if (txt) yield txt as string;
    } catch { /* partial */ }
  }
}

function describeStep(s: AgenticStep): string {
  if (s.kind === "search") return `searching the web for "${s.query}"`;
  if (s.kind === "scrape") return `reading the page ${s.url}`;
  if (s.kind === "memory") return `looking through your memory for "${s.query}"`;
  if (s.kind === "plan") return `outlining the exploration plan`;
  if (s.kind === "hypothesis") return `forming a working hypothesis`;
  if (s.kind === "challenge") return `questioning current conclusions`;
  if (s.kind === "compare") return `comparing and weighing perspectives`;
  if (s.kind === "synthesize") return `synthesizing the findings`;
  return `analyzing: ${s.intent}`;
}

// ============================================================================
// DYNAMIC REACT LOOP — used by Reflexion mode.
//
// True ReAct: at each iteration the orchestrator decides what to do next based
// on what it has learned. No pre-defined plan. Bounded by a token budget
// (low/medium/high) with a hard iteration cap as a safety net.
// ============================================================================
type ReactToolName = "web_search" | "web_fetch" | "memory_recall" | "finish";
type ReactObservation = { ok: boolean; summary: string; foundCount?: number };

type ReactCallbacks = {
  onStepStart: (idx: number, kind: string, label: string, intent: string) => void;
  onStepDone: (idx: number, kind: string, label: string, intent: string, foundCount?: number, failed?: boolean, stepSources?: WebSource[]) => void;
  onThoughtChunk: (idx: number, text: string) => void;
  onThoughtDone: (idx: number) => void;
  onSources: (sources: WebSource[]) => void;
};

async function runReactLoop(opts: {
  googleKey: string;
  userText: string;
  effort: "low" | "medium" | "high";
  linkupKey?: string;
  memRows: Array<{ content: string; kind: string; keywords?: string[] }>;
  callbacks: ReactCallbacks;
}): Promise<{
  contextBlocks: string[];
  sources: WebSource[];
  images: WebImage[];
  iterations: number;
  searchCount: number;
  perStepNarration: Map<number, string>;
  combinedNarration: string;
  collectedSteps: Array<{ index: number; kind: string; label: string; intent: string; status: string; foundCount?: number; narration?: string }>;
}> {
  const BUDGET = opts.effort === "low" ? 3000 : opts.effort === "high" ? 40000 : 12000;
  const MAX_ITER = opts.effort === "low" ? 6 : opts.effort === "high" ? 30 : 15;
  // Minimum tool calls (search/fetch/memory) before the agent is allowed to finish.
  // Forces real deep-dive instead of the orchestrator bailing out after one thought.
  const MIN_TOOL_CALLS = opts.effort === "low" ? 1 : opts.effort === "high" ? 8 : 4;

  const history: Array<{ thought: string; action: any; observation: ReactObservation }> = [];
  const contextBlocks: string[] = [];
  const sources: WebSource[] = [];
  const images: WebImage[] = [];
  const perStepNarration = new Map<number, string>();
  const collectedSteps: Array<{ index: number; kind: string; label: string; intent: string; status: string; foundCount?: number; narration?: string }> = [];
  let tokensUsed = 0;
  let stepIndex = 0;
  let consecutiveFailures = 0;
  let searchCount = 0;
  let toolCallCount = 0;
  let combinedNarration = "";

  const hasSearch = !!opts.linkupKey;
  const hasFetch = !!opts.linkupKey;
  const hasMemory = opts.memRows.length > 0;

  const availableTools: string[] = [];
  if (hasSearch) availableTools.push(`{"tool":"web_search","args":{"query":"<short query in user's language, ≤12 words>"}}  // search the web for fresh facts`);
  if (hasFetch) availableTools.push(`{"tool":"web_fetch","args":{"url":"https://..."}}  // read a specific webpage`);
  if (hasMemory) availableTools.push(`{"tool":"memory_recall","args":{"query":"<short phrase>"}}  // search the user's personal memory`);
  availableTools.push(`{"tool":"finish","args":{}}  // call when you have enough to answer`);

  const renderHistory = () => history.length === 0
    ? "(no actions yet — write your opening thought and choose the first action)"
    : history.map((h, i) =>
        `### Iteration ${i + 1}\nThought: ${h.thought}\nAction: ${JSON.stringify(h.action)}\nObservation: ${h.observation.summary}`,
      ).join("\n\n");

  for (let iter = 0; iter < MAX_ITER; iter++) {
    if (tokensUsed >= BUDGET) break;

    // ---- 1. Stream the thought ----
    const thoughtIdx = stepIndex++;
    opts.callbacks.onStepStart(thoughtIdx, "thought", "", "");

    const thoughtSys =
      `You are a ReAct agent. Write your next reasoning step in the USER's exact language. ` +
      `Format STRICTLY as:\n` +
      `TOPIC: <≤6 words naming what you're thinking about right now>\n` +
      `<one short sentence about what you just learned from the last observation (skip if no prior step)>\n` +
      `<one short sentence about what you'll do next and why>\n\n` +
      `Hard limits: max 2 sentences after the TOPIC line, max 40 words total in the sentences. ` +
      `No markdown, no bullets, no headings, no quotes. First person, present tense.`;
    const thoughtPrompt =
      `User question:\n"""${opts.userText.slice(0, 800)}"""\n\n` +
      `History so far:\n${renderHistory()}\n\n` +
      `Budget left: ${BUDGET - tokensUsed} tokens, ${MAX_ITER - iter} iterations.\n` +
      `Write your next reasoning step now (TOPIC line + 1-2 short sentences).`;

    let thoughtText = "";
    let topicBuf = "";
    let topicEmitted = false;
    let narrationBuf = ""; // buffered until topic line is complete
    const emitNarrationChunk = (txt: string) => {
      perStepNarration.set(thoughtIdx, (perStepNarration.get(thoughtIdx) ?? "") + txt);
      combinedNarration += txt;
      opts.callbacks.onThoughtChunk(thoughtIdx, txt);
    };
    const handleStreamText = (txt: string) => {
      thoughtText += txt;
      if (topicEmitted) {
        emitNarrationChunk(txt);
        return;
      }
      topicBuf += txt;
      const nl = topicBuf.indexOf("\n");
      if (nl === -1) return; // wait for the full topic line
      const firstLine = topicBuf.slice(0, nl);
      const rest = topicBuf.slice(nl + 1);
      const m = firstLine.match(/^\s*TOPIC\s*[:\-]\s*(.+?)\s*$/i);
      const topic = (m ? m[1] : firstLine).trim().slice(0, 80);
      // Emit the topic as the step's label by re-sending the running event with a label.
      opts.callbacks.onStepStart(thoughtIdx, "thought", topic, "");
      topicEmitted = true;
      topicBuf = "";
      const trimmed = rest.replace(/^\s+/, "");
      if (trimmed) emitNarrationChunk(trimmed);
    };

    try {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:streamGenerateContent?alt=sse&key=${opts.googleKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: thoughtPrompt }] }],
            systemInstruction: { parts: [{ text: thoughtSys }] },
            generationConfig: { temperature: 0.7, maxOutputTokens: 220 },
          }),
        },
      );
      if (r.ok && r.body) {
        for await (const line of parseSSELines(r.body.getReader())) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          try {
            const j = JSON.parse(data);
            const txt = j.candidates?.[0]?.content?.parts?.map((p: any) => p.text).filter(Boolean).join("");
            if (txt) handleStreamText(txt);
          } catch { /* partial JSON */ }
        }
      }
    } catch (e) {
      console.error("[react] thought stream failed", e);
    }
    // Flush: if no newline ever arrived, treat the buffer as the topic.
    if (!topicEmitted && topicBuf.trim()) {
      const m = topicBuf.match(/^\s*TOPIC\s*[:\-]\s*(.+?)\s*$/i);
      const topic = (m ? m[1] : topicBuf).trim().slice(0, 80);
      opts.callbacks.onStepStart(thoughtIdx, "thought", topic, "");
      topicEmitted = true;
    }
    // Strip the TOPIC line from the persisted narration so the trace shows only the prose.
    const cleanNarration = thoughtText.replace(/^\s*TOPIC\s*[:\-][^\n]*\n?/i, "").trim();
    const finalTopic = (() => {
      const m = thoughtText.match(/^\s*TOPIC\s*[:\-]\s*(.+?)\s*$/im);
      return m ? m[1].trim().slice(0, 80) : "";
    })();
    opts.callbacks.onThoughtDone(thoughtIdx);
    opts.callbacks.onStepDone(thoughtIdx, "thought", finalTopic, "");
    collectedSteps.push({
      index: thoughtIdx, kind: "thought", label: finalTopic, intent: "",
      status: "done", narration: cleanNarration,
    });
    tokensUsed += Math.ceil((thoughtPrompt.length + thoughtText.length) / 4);

    if (tokensUsed >= BUDGET) {
      const finishIdx = stepIndex++;
      opts.callbacks.onStepStart(finishIdx, "finish", "", "");
      opts.callbacks.onStepDone(finishIdx, "finish", "", "");
      collectedSteps.push({ index: finishIdx, kind: "finish", label: "", intent: "", status: "done" });
      break;
    }

    // ---- 2. Decide action (strict JSON via responseSchema) ----
    const toolsRemaining = Math.max(0, MIN_TOOL_CALLS - toolCallCount);
    const canFinish = toolCallCount >= MIN_TOOL_CALLS;
    const actionSys = `You decide the NEXT action of a ReAct agent. Reply with STRICT JSON only — no prose, no markdown, no preamble. Just the JSON object.`;
    const actionPrompt =
      `User question:\n"""${opts.userText.slice(0, 600)}"""\n\n` +
      `History:\n${renderHistory()}\n\n` +
      `Your latest thought: ${thoughtText}\n\n` +
      `Available actions:\n${availableTools.join("\n")}\n\n` +
      `Progress: ${toolCallCount} tool calls done so far. Minimum required: ${MIN_TOOL_CALLS}. Remaining iterations: ${MAX_ITER - iter - 1}.\n\n` +
      `Rules:\n` +
      (canFinish
        ? `- You MAY return {"tool":"finish","args":{}} only if you genuinely have enough deep, verified information to write a thorough answer.\n`
        : `- You MUST NOT finish yet — you still need at least ${toolsRemaining} more tool call(s) to satisfy the user's effort level. Pick a tool (web_search / web_fetch / memory_recall).\n`) +
      `- NEVER repeat an action with identical args (check history).\n` +
      `- Vary angles: different queries, sub-topics, counter-arguments, primary sources, recent dates. Don't just rephrase the same query.\n` +
      `- Prefer web_search for fresh facts; web_fetch only when you have a specific URL worth reading in full.\n` +
      `- Match the search query to the user's language.\n\n` +
      `Reply with STRICT JSON ONLY: {"tool":"web_search|web_fetch|memory_recall|finish","args":{...}}`;

    // Build allowed tools enum for responseSchema
    const allowedTools = ["finish"];
    if (hasSearch) allowedTools.unshift("web_search");
    if (hasFetch) allowedTools.push("web_fetch");
    if (hasMemory) allowedTools.push("memory_recall");

    let action: any = null;
    try {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${opts.googleKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: actionPrompt }] }],
            systemInstruction: { parts: [{ text: actionSys }] },
            generationConfig: {
              responseMimeType: "application/json",
              responseSchema: {
                type: "object",
                properties: {
                  tool: { type: "string", enum: allowedTools },
                  args: {
                    type: "object",
                    properties: {
                      query: { type: "string" },
                      url: { type: "string" },
                    },
                  },
                },
                required: ["tool"],
              },
              temperature: 0.4,
              maxOutputTokens: 500,
            },
          }),
        },
      );
      const j = await r.json();
      const raw = j.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join("") ?? "";
      // Robust extraction: strip code fences, find first {...} block if there's any prose leak
      let cleaned = raw.replace(/```json|```/g, "").trim();
      const braceMatch = cleaned.match(/\{[\s\S]*\}/);
      if (braceMatch) cleaned = braceMatch[0];
      action = JSON.parse(cleaned);
      tokensUsed += Math.ceil((actionPrompt.length + raw.length) / 4);
    } catch (e) {
      console.error("[react] action parse failed", e, "— falling back to web_search");
      consecutiveFailures++;
      // Fallback: if we can search, force a search using the user's question rather than aborting
      if (hasSearch && consecutiveFailures < 4) {
        action = { tool: "web_search", args: { query: opts.userText.slice(0, 120) } };
      } else if (consecutiveFailures >= 4) {
        break;
      } else {
        continue;
      }
    }
    if (action) consecutiveFailures = 0;

    // Block premature finish: if model tries to finish before minimum, force a search instead
    if (action?.tool === "finish" && !canFinish && hasSearch) {
      console.log(`[react] blocking premature finish (${toolCallCount}/${MIN_TOOL_CALLS} tool calls) — forcing search`);
      action = { tool: "web_search", args: { query: `${opts.userText.slice(0, 80)} — angle ${toolCallCount + 1}` } };
    }

    if (!action || action.tool === "finish") {
      const finishIdx = stepIndex++;
      opts.callbacks.onStepStart(finishIdx, "finish", "", "");
      opts.callbacks.onStepDone(finishIdx, "finish", "", "");
      collectedSteps.push({ index: finishIdx, kind: "finish", label: "", intent: "", status: "done" });
      history.push({ thought: thoughtText, action: { tool: "finish" }, observation: { ok: true, summary: "ending loop" } });
      break;
    }

    // ---- 3. Execute action ----
    const tool: ReactToolName = action.tool;
    let observation: ReactObservation = { ok: false, summary: "unknown tool" };

    if (tool === "web_search" && opts.linkupKey && typeof action.args?.query === "string") {
      const query = String(action.args.query).slice(0, 150).trim();
      const actionIdx = stepIndex++;
      opts.callbacks.onStepStart(actionIdx, "search", query, "");
      const res = await linkupSearch(opts.linkupKey, query);
      if (res) {
        searchCount += 1;
        const stepSources: WebSource[] = res.sources.slice();
        for (const s of res.sources) if (!sources.find((x) => x.url === s.url)) sources.push(s);
        for (const im of res.images) if (!images.find((x) => x.url === im.url)) images.push(im);
        contextBlocks.push(`## Web search — "${query}"\n\n${res.content}`);
        observation = {
          ok: true,
          summary: `Found ${res.sources.length} sources. Top titles: ${res.sources.slice(0, 3).map((s) => s.title).join(" | ")}`,
          foundCount: res.sources.length,
        };
        opts.callbacks.onStepDone(actionIdx, "search", query, "", res.sources.length, false, stepSources);
        opts.callbacks.onSources(sources);
        collectedSteps.push({ index: actionIdx, kind: "search", label: query, intent: "", status: "done", foundCount: res.sources.length, sources: stepSources } as any);
      } else {
        observation = { ok: false, summary: `No results for "${query}"` };
        opts.callbacks.onStepDone(actionIdx, "search", query, "", 0, true);
        collectedSteps.push({ index: actionIdx, kind: "search", label: query, intent: "", status: "failed" });
      }
    } else if (tool === "web_fetch" && opts.linkupKey && typeof action.args?.url === "string" && /^https?:\/\//.test(action.args.url)) {
      const url = String(action.args.url);
      const actionIdx = stepIndex++;
      opts.callbacks.onStepStart(actionIdx, "scrape", url, "");
      const md = await linkupFetch(opts.linkupKey, url);
      if (md) {
        const stepSources: WebSource[] = [{ title: url, url }];
        if (!sources.find((x) => x.url === url)) sources.push({ title: url, url });
        contextBlocks.push(`## Page fetch — ${url}\n\n${md}`);
        observation = { ok: true, summary: `Retrieved page (${md.length} chars).`, foundCount: 1 };
        opts.callbacks.onStepDone(actionIdx, "scrape", url, "", 1, false, stepSources);
        opts.callbacks.onSources(sources);
        collectedSteps.push({ index: actionIdx, kind: "scrape", label: url, intent: "", status: "done", foundCount: 1, sources: stepSources } as any);
      } else {
        observation = { ok: false, summary: `Fetch failed for ${url} (blocked or empty).` };
        opts.callbacks.onStepDone(actionIdx, "scrape", url, "", 0, true);
        collectedSteps.push({ index: actionIdx, kind: "scrape", label: url, intent: "", status: "failed" });
      }
    } else if (tool === "memory_recall" && typeof action.args?.query === "string") {
      const query = String(action.args.query).slice(0, 150).trim();
      const actionIdx = stepIndex++;
      opts.callbacks.onStepStart(actionIdx, "memory", query, "");
      const qKw = new Set(extractKeywords(query, 12));
      type Scored = { content: string; kind: string; score: number };
      const matches: Scored[] = [];
      for (const m of opts.memRows) {
        const kws = (m.keywords && m.keywords.length) ? m.keywords : extractKeywords(m.content, 12);
        const score = memoryRelevance(kws, qKw);
        if (score > 0) matches.push({ content: m.content, kind: m.kind, score });
      }
      matches.sort((a, b) => b.score - a.score);
      const top = matches.slice(0, 8);
      if (top.length) {
        contextBlocks.push(`## Memory recall — "${query}"\n\n` + top.map((m) => `- (${m.kind}) ${m.content}`).join("\n"));
        observation = { ok: true, summary: `Found ${top.length} relevant memories.`, foundCount: top.length };
      } else {
        observation = { ok: false, summary: `No relevant memories for "${query}".` };
      }
      opts.callbacks.onStepDone(actionIdx, "memory", query, "", top.length);
      collectedSteps.push({ index: actionIdx, kind: "memory", label: query, intent: "", status: "done", foundCount: top.length });
    } else {
      observation = { ok: false, summary: `Unavailable tool: ${JSON.stringify(action)}` };
      consecutiveFailures++;
      if (consecutiveFailures >= 2) break;
    }

    if (observation.ok) toolCallCount++;
    history.push({ thought: thoughtText, action, observation });
    tokensUsed += Math.ceil(observation.summary.length / 4);
  }

  return {
    contextBlocks,
    sources,
    images,
    iterations: history.length,
    searchCount,
    perStepNarration,
    combinedNarration,
    collectedSteps,
  };
}

// ---------- Clarifying questions ----------
type ClarifyQuestion = {
  question: string;
  header?: string;
  multi?: boolean;
  options: { label: string }[];
};

async function decideClarify(args: {
  googleKey?: string;
  openaiKey?: string;
  anthropicKey?: string;
  userText: string;
  hasHistory: boolean;
  forceClarify?: boolean;
}): Promise<ClarifyQuestion[] | null> {
  const { userText, hasHistory, forceClarify } = args;
  const trimmed = userText.trim();
  if (!forceClarify) {
    if (trimmed.length < 40) return null;
    // Skip when the user already asks a direct question or gives a clear write/code instruction.
    const lower = trimmed.toLowerCase();
    const quickSkipPrefixes = [
      "écris", "ecris", "rédige", "redige", "compose", "traduis", "résume", "resume",
      "explique", "définis", "definis", "donne-moi", "donne moi", "fais", "calcule",
      "code", "corrige", "améliore", "ameliore", "réécris", "reecris",
      "write", "draft", "compose", "translate", "summarize", "explain", "define",
      "give me", "make", "fix", "improve", "rewrite", "list", "show",
    ];
    if (trimmed.endsWith("?") || trimmed.includes("?\n")) return null;
    if (quickSkipPrefixes.some((p) => lower.startsWith(p))) return null;
  }

  const prompt = forceClarify
    ? `The user has manually requested that you ask clarifying questions before answering. Your job is to generate 1–2 useful clarifying questions that would help you produce a better answer.

Reply STRICTLY in JSON, no surrounding text:
{
  "needs_clarification": true,
  "questions": [
    {
      "header": "<2-3 word tag, e.g. 'Audience', 'Tone', 'Scope', 'Objectif'>",
      "question": "<one clear question ending with '?'>",
      "multi": false,
      "options": [
        {"label": "<short, 1-5 words>"},
        {"label": "..."},
        {"label": "..."}
      ]
    }
  ]
}

Rules:
- Maximum 2 questions, prefer 1. Focus on what would most change your answer.
- 2–4 options per question. Keep options VERY short — 1–3 words, max 24 characters.
- Do NOT add an "Other" option — the UI handles that automatically.
- Use the SAME LANGUAGE as the user's message.
- Even short or simple messages deserve clarifying questions when this mode is active.

User message:
${userText.slice(0, 2000)}`
    : `You are a clarification gatekeeper. Your DEFAULT answer is ALWAYS {"needs_clarification": false}.
Only return true in rare cases where an answer CANNOT be reasonably attempted without knowing one specific missing piece of information that would fundamentally change the output.

Reply STRICTLY in JSON, no surrounding text.

Default (>95% of cases):
{"needs_clarification": false}

Exception (rare — genuinely blocking ambiguity):
{
  "needs_clarification": true,
  "questions": [
    {
      "header": "<2-3 word tag, e.g. 'Audience', 'Tone', 'Scope'>",
      "question": "<one clear question ending with '?'>",
      "multi": false,
      "options": [
        {"label": "<short, 1-5 words>"},
        {"label": "..."},
        {"label": "..."}
      ]
    }
  ]
}

NEVER clarify for:
- Any writing task where the user gave enough intent (email, note, post, article, summary, translation, rewrite, tone change). Just make reasonable assumptions.
- Code requests, debugging, explanations, definitions, how-to questions.
- Factual questions, research, recommendations, comparisons.
- Opinion, chit-chat, greetings, follow-ups.
- Anything under 40 characters.
- Requests that can be answered by picking one sensible default and proceeding.

ONLY clarify when ALL of these are true:
- The request is genuinely complex (large project scope, strategic plan, multi-month roadmap, architecture with many trade-offs).
- Picking a default would likely produce the WRONG output for the user's real need.
- A single clarifying question would unblock a materially different answer.

Rules when you DO clarify:
- Maximum 2 questions, prefer 1. Only what's truly blocking.
- 2–4 options per question. Keep options VERY short — ideally 1–3 words, max 24 characters (they render as inline pills).
- Do NOT add an "Other" option — the UI handles that automatically.
- Use the SAME LANGUAGE as the user's message.
- Conversation already has prior turns: ${hasHistory ? "yes" : "no"}. If yes, almost never clarify — only if the new turn opens a brand-new complex topic.

When in doubt → {"needs_clarification": false}.

User message:
${userText.slice(0, 2000)}`;

  let raw = "";
  try {
    if (args.googleKey) {
      const r = await fetchWithTimeout(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${args.googleKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: {
              responseMimeType: "application/json",
              thinkingConfig: { thinkingBudget: 0 },
            },
          }),
        },
        800,
      );
      const j = await r.json();
      raw = j.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join("") ?? "";
    } else if (args.openaiKey) {
      const r = await fetchWithTimeout("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${args.openaiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "gpt-5-nano",
          messages: [{ role: "user", content: prompt }],
          response_format: { type: "json_object" },
        }),
      }, 800);
      const j = await r.json();
      raw = j.choices?.[0]?.message?.content ?? "";
    } else {
      return null;
    }
  } catch (e) {
    // Timeout or network error → skip clarify silently (safe default).
    console.warn("decideClarify timed out or failed, skipping", e instanceof Error ? e.message : e);
    return null;
  }

  try {
    const cleaned = raw.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(cleaned);
    if (!parsed?.needs_clarification) return null;
    const qs = Array.isArray(parsed.questions) ? parsed.questions : [];
    const out: ClarifyQuestion[] = [];
    for (const q of qs.slice(0, 3)) {
      if (!q || typeof q.question !== "string") continue;
      const opts = Array.isArray(q.options) ? q.options : [];
      const cleanedOpts = opts
        .map((o: any) => ({ label: String(o?.label ?? "").trim() }))
        .filter((o: { label: string }) => o.label.length > 0)
        .slice(0, 4);
      if (cleanedOpts.length < 2) continue;
      out.push({
        question: q.question.trim(),
        header: typeof q.header === "string" ? q.header.trim().slice(0, 24) : undefined,
        multi: !!q.multi,
        options: cleanedOpts,
      });
    }
    return out.length ? out : null;
  } catch (e) {
    console.error("decideClarify parse failed", e);
    return null;
  }
}

// ---------- Title generation (short summary from first user message) ----------
async function generateTitle(args: {
  openaiKey?: string;
  googleKey?: string;
  anthropicKey?: string;
  userText: string;
}): Promise<string | null> {
  const { userText } = args;
  if (!userText.trim()) return null;

  const prompt = `You generate VERY short conversation titles. Return a 3 to 6 word title that captures the TOPIC of the user's message (a noun phrase, no verbs starting with "I"). No quotes, no ending punctuation, no emoji, no markdown. Reply with the title only — nothing else.

User message:
${userText.slice(0, 1500)}`;

  // Try providers in fallback order. Use the smallest/fastest model of each.
  const attempts: Array<() => Promise<string | null>> = [];

  if (args.googleKey) {
    attempts.push(async () => {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${args.googleKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.2, maxOutputTokens: 32 },
          }),
        },
      );
      if (!r.ok) return null;
      const j = await r.json();
      const t = j.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join("") ?? "";
      return cleanTitle(t);
    });
  }

  if (args.openaiKey) {
    attempts.push(async () => {
      const r = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${args.openaiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "gpt-5-nano",
          messages: [{ role: "user", content: prompt }],
          temperature: 0.2,
          max_tokens: 32,
        }),
      });
      if (!r.ok) return null;
      const j = await r.json();
      return cleanTitle(j.choices?.[0]?.message?.content ?? "");
    });
  }

  if (args.anthropicKey) {
    attempts.push(async () => {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": args.anthropicKey,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "claude-3-5-haiku-latest",
          max_tokens: 32,
          messages: [{ role: "user", content: prompt }],
        }),
      });
      if (!r.ok) return null;
      const j = await r.json();
      return cleanTitle(j.content?.[0]?.text ?? "");
    });
  }

  for (const attempt of attempts) {
    try {
      const t = await attempt();
      if (t && t.length >= 2) return t;
    } catch (e) {
      console.error("title gen attempt failed", e);
    }
  }

  // Final fallback: derive a clean topic from the user text itself.
  return fallbackTitleFromText(userText);
}

function cleanTitle(s: string): string | null {
  // Strip surrounding quotes, trailing punctuation, leading "Title:" labels, and any newline noise.
  let t = (s ?? "")
    .replace(/^\s*(title|titre)\s*[:\-]\s*/i, "")
    .replace(/^["'`«»“”]+|["'`«»“”]+$/g, "")
    .replace(/[.!?]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return null;
  // Take first line only.
  t = t.split("\n")[0].trim();
  if (!t) return null;
  return t.slice(0, 60);
}

function fallbackTitleFromText(raw: string): string {
  const cleaned = raw
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const words = cleaned.split(" ").filter(Boolean).slice(0, 6);
  const title = words.join(" ").replace(/[.!?,;:]+$/g, "").trim();
  return (title || "New conversation").slice(0, 60);
}

// ---------- Memory extraction (uses cheapest available provider) ----------
async function extractAndSaveMemory(args: {
  supabase: any;
  userId: string;
  openaiKey?: string;
  googleKey?: string;
  anthropicKey?: string;
  userText: string;
  assistantText: string;
}) {
  const { supabase, userId, userText, assistantText } = args;
  if (!userText.trim()) return { added: 0, updated: 0 };

  // Load existing memories first so the extractor can decide skip/update/add.
  const { data: existingRows } = await supabase
    .from("user_memories")
    .select("id,content,kind")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(200);
  const existing = (existingRows ?? []) as { id: string; content: string; kind: string }[];

  const existingBlock = existing.length
    ? existing.map((m, i) => `${i + 1}. [id=${m.id}] (${m.kind}) ${m.content}`).join("\n")
    : "(no existing memory)";

  const prompt =
    `You are a user memory manager. Analyze the exchange and decide, for every durable and personal fact (preferences, identity, projects, recurring context), whether to:
- "add"    : add a NEW memory (info absent from existing memory)
- "update" : REPLACE an existing memory (same subject but different, more precise or contradictory info) — provide the "id" of the memory to replace
- "skip"   : do nothing (already present identically or not relevant)

Strict rules:
- Compare semantically, not just word-for-word. "I'm a dev" and "The user is a developer" = duplicate → skip.
- If a new fact CONTRADICTS or REFINES an existing fact on the same subject → update (with the concerned id).
- Ignore one-off questions and ephemeral requests.
- Reply STRICTLY in JSON, no surrounding text:
{"actions":[{"op":"add|update|skip","id":"<uuid if update>","kind":"preference|identity|project|context","content":"..."}]}
If nothing: {"actions":[]}.

--- EXISTING MEMORY ---
${existingBlock}

--- USER ---
${userText}

--- ASSISTANT ---
${assistantText.slice(0, 2000)}`;

  let raw = "";
  try {
    if (args.googleKey) {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${args.googleKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: { responseMimeType: "application/json" },
          }),
        },
      );
      const j = await r.json();
      raw = j.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join("") ?? "";
    } else if (args.openaiKey) {
      const r = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${args.openaiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "gpt-5-nano",
          messages: [{ role: "user", content: prompt }],
          response_format: { type: "json_object" },
        }),
      });
      const j = await r.json();
      raw = j.choices?.[0]?.message?.content ?? "";
    } else if (args.anthropicKey) {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": args.anthropicKey,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "claude-3-5-haiku-latest",
          max_tokens: 512,
          messages: [{ role: "user", content: prompt + "\n\nReply with JSON only." }],
        }),
      });
      const j = await r.json();
      raw = j.content?.[0]?.text ?? "";
    } else {
      return { added: 0, updated: 0 };
    }
  } catch (e) {
    console.error("extract call failed", e);
    return { added: 0, updated: 0 };
  }

  let parsed: any;
  try {
    const cleaned = raw.replace(/```json|```/g, "").trim();
    parsed = JSON.parse(cleaned);
  } catch {
    return { added: 0, updated: 0 };
  }
  const actions = Array.isArray(parsed?.actions) ? parsed.actions : [];
  if (!actions.length) return { added: 0, updated: 0 };

  const existingById = new Map(existing.map((e) => [e.id, e]));
  const existingContents = new Set(existing.map((e) => e.content.toLowerCase().trim()));
  const validKinds = ["preference", "identity", "project", "context", "fact"];
  const norm = (s: string) => s.toLowerCase().trim();

  const toInsert: { user_id: string; content: string; kind: string; keywords: string[] }[] = [];
  const toUpdate: { id: string; content: string; kind: string; keywords: string[] }[] = [];

  for (const a of actions.slice(0, 10)) {
    if (!a?.content || typeof a.content !== "string") continue;
    const content = a.content.slice(0, 500).trim();
    if (!content) continue;
    const kind = validKinds.includes(a.kind) ? a.kind : "fact";
    // Derive keywords from the memory content (no extra LLM call).
    const keywords = extractKeywords(content, 12);

    if (a.op === "update" && a.id && existingById.has(a.id)) {
      const prev = existingById.get(a.id)!;
      if (norm(prev.content) === norm(content)) continue; // no-op
      toUpdate.push({ id: a.id, content, kind, keywords });
      existingContents.delete(norm(prev.content));
      existingContents.add(norm(content));
    } else if (a.op === "add") {
      if (existingContents.has(norm(content))) continue; // dedup
      toInsert.push({ user_id: userId, content, kind, keywords });
      existingContents.add(norm(content));
    }
    // "skip" → nothing
  }

  let inserted = 0;
  let updated = 0;
  if (toInsert.length) {
    const { error } = await supabase.from("user_memories").insert(toInsert);
    if (!error) inserted = toInsert.length;
  }
  for (const u of toUpdate) {
    const { error } = await supabase
      .from("user_memories")
      .update({ content: u.content, kind: u.kind, keywords: u.keywords, updated_at: new Date().toISOString() })
      .eq("id", u.id)
      .eq("user_id", userId);
    if (!error) updated += 1;
  }
  return { added: inserted, updated };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing auth" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const token = authHeader.replace("Bearer ", "");
    // Fire auth.getUser + req.json() in parallel — both block the same critical
    // path and have no dependency on each other (~50-100 ms saved).
    const [authPromise, payload] = await Promise.all([
      supabase.auth.getUser(token),
      req.json() as Promise<{
        conversationId: string | null;
        provider: "openai" | "anthropic" | "google" | "mistral";
        model: string;
        messages: Msg[];
        skipClarify?: boolean;
        forceClarify?: boolean;
        writingMode?: boolean;
        previousCanvas?: string | null;
        forceCanvas?: boolean;
        aiPrefs?: {
          disabledModes?: string[];
          blacklistedModels?: string[];
          favoriteModels?: string[];
          responseLength?: "short" | "default" | "comprehensive";
        };
        googleService?: "gmail" | "calendar" | "drive" | null;
        voyagerService?: boolean;
        reflexionMode?: boolean;
        reflexionEffort?: "low" | "medium" | "high";
      }>,
    ]);
    const { data: userData, error: userErr } = authPromise;
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const user = { id: userData.user.id };

    const { conversationId, provider, model: requestedModel, messages, skipClarify, forceClarify, writingMode, previousCanvas, forceCanvas, aiPrefs, googleService, voyagerService, reflexionMode, reflexionEffort } = payload;

    // ---- Apply user AI preferences: blacklist fallback ----
    const blacklisted = new Set(aiPrefs?.blacklistedModels ?? []);
    const favorites = aiPrefs?.favoriteModels ?? [];
    const disabledModes = new Set(aiPrefs?.disabledModes ?? []);
    const responseLength = aiPrefs?.responseLength ?? "default";
    let model = requestedModel;
    if (blacklisted.has(model)) {
      const fallbackOrder = [
        ...favorites,
        "gemini-3.5-flash", "gpt-5.5", "gpt-5-nano", "gemini-2.5-pro",
        "claude-sonnet-4-6", "claude-opus-4-7",
        "mistral-large-latest", "mistral-small-latest",
      ];
      const replacement = fallbackOrder.find((m) => !blacklisted.has(m));
      if (replacement) model = replacement;
    }
    const webDisabled = disabledModes.has("web");
    const mapDisabled = disabledModes.has("map");
    // When conversationId is null, we are in "branch/ephemeral" mode: stream
    // a reply but skip all persistence (messages, usage, memory, title).
    const ephemeral = !conversationId;

    if (!provider || !model || !Array.isArray(messages)) {
      return new Response(JSON.stringify({ error: "Invalid payload" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ---------- Free-tier enforcement ----------
    const FREE_DAILY_LIMIT = 5;
    const PREMIUM_MODELS = new Set([
      "gpt-5.5", "claude-opus-4-7", "gemini-2.5-pro", "mistral-large-latest",
    ]);

    // Pure message computations (no DB) — done before any await.
    const lastUserMsg = [...(messages as Msg[])].reverse().find((m) => m.role === "user");
    const lastUserText = lastUserMsg?.content ?? "";
    const queryKeywords = new Set(extractKeywords(lastUserText, 20));
    const isFirstTurn = (messages as Msg[]).filter((m) => m.role === "assistant").length === 0;

    // ========= STEP 5: Pre-launch the Clarify classifier in parallel with DB reads =========
    // Clarify only needs lastUserText + payload flags (all known here). Firing it BEFORE
    // the DB Promise.all overlaps the ~200-500 ms classifier call with the ~200-400 ms DB
    // batch instead of running it after. Net saving: typically 200-400 ms.
    const userTurnsEarly = (messages as Msg[]).filter((m) => m.role === "user").length;
    // Only skip the clarify gatekeeper when there's clearly nothing to clarify:
    // either the user is already in a back-and-forth (>1 user turn) or the
    // message is trivially short. The gatekeeper LLM itself is strict and
    // returns needs_clarification=false in the vast majority of cases.
    const fastNoClarifyEarly =
      userTurnsEarly > 1 ||
      lastUserText.trim().length < 40;
    const willClarifyEarly =
      !ephemeral && !skipClarify && !writingMode && !!lastUserText && (!fastNoClarifyEarly || !!forceClarify);
    const earlyClarifyPromise: Promise<ClarifyQuestion[] | null> = willClarifyEarly
      ? decideClarify({
          googleKey: Deno.env.get("GOOGLE_API_KEY"),
          openaiKey: Deno.env.get("OPENAI_API_KEY"),
          anthropicKey: Deno.env.get("ANTHROPIC_API_KEY"),
          userText: lastUserText,
          hasHistory: userTurnsEarly > 1,
          forceClarify,
        }).catch((e) => { console.warn("early clarify failed", e); return null; })
      : Promise.resolve(null);


    // Fire all DB queries in parallel instead of sequentially (~400–600 ms saved).
    // user_integrations fetches both google & voyager in one round-trip.
    // user_memories is pre-fetched with confidence-ordered fields for both modes;
    // we post-filter to the appropriate subset after the batch resolves.
    const [
      planResult,
      convResult,
      memPrefResult,
      integrationsResult,
      memResult,
      countResult,
    ] = await Promise.all([
      supabase.rpc("get_user_plan", { _user_id: user.id }),
      conversationId
        ? supabase.from("conversations").select("folder_id").eq("id", conversationId).maybeSingle()
        : Promise.resolve({ data: null as null, error: null }),
      supabase.from("ai_preferences").select("memory_mode").eq("user_id", user.id).maybeSingle(),
      supabase.from("user_integrations")
        .select("provider,account_email")
        .eq("user_id", user.id)
        .in("provider", ["google", "voyager"]),
      supabase.from("user_memories")
        .select("id,content,kind,keywords,folder_id,confidence,last_seen_at")
        .eq("user_id", user.id)
        .order("confidence", { ascending: false })
        .order("last_seen_at", { ascending: false })
        .limit(50),
      supabase.rpc("count_today_requests", { _user_id: user.id }),
    ]);

    // Process plan & enforce free-tier limits.
    const userPlan = typeof planResult.data === "string" ? planResult.data : "free";
    const isFreeUser = userPlan === "free";

    if (isFreeUser) {
      if (PREMIUM_MODELS.has(model)) {
        return new Response(
          JSON.stringify({ error: "premium_model", message: "This model requires the Plus plan." }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      const todayCount = typeof countResult.data === "number" ? countResult.data : 0;
      if (todayCount >= FREE_DAILY_LIMIT) {
        return new Response(
          JSON.stringify({ error: "daily_limit", message: "Daily free limit reached (5 messages)." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    // Process integrations — google & voyager from the same pre-fetched row set.
    const integrationRows = (integrationsResult.data ?? []) as Array<{ provider: string; account_email: string | null }>;
    const googleIntegration = integrationRows.find((r) => r.provider === "google") ?? null;
    const voyagerIntegration = integrationRows.find((r) => r.provider === "voyager") ?? null;
    let googleConnected = !!googleIntegration;
    let googleAccountEmail: string | null = googleIntegration?.account_email ?? null;
    let voyagerConnected = !!voyagerIntegration;

    // Folder lookup: only needed when the conversation belongs to a folder (uncommon).
    let folderRow: { id: string; name: string; instructions: string | null } | null = null;
    const folderId = (convResult.data as { folder_id?: string | null } | null)?.folder_id;
    if (folderId) {
      const { data: f } = await supabase
        .from("folders")
        .select("id,name,instructions")
        .eq("id", folderId)
        .maybeSingle();
      if (f) folderRow = f as typeof folderRow;
    }

    // Process memory mode (server-side, not client-trusted).
    const memoryMode: "classic" | "smart" =
      (memPrefResult.data as { memory_mode?: string } | null)?.memory_mode === "smart" ? "smart" : "classic";
    const skipMemoryInjection = memoryMode === "smart" && !isFirstTurn;

    // Post-filter pre-fetched memory rows to the mode-appropriate subset.
    const allFetchedMemRows = (memResult.data ?? []) as Array<{
      id: string; content: string; kind: string; keywords: string[] | null;
      folder_id: string | null; confidence?: number; last_seen_at?: string;
    }>;
    const memRows = (isFreeUser || skipMemoryInjection)
      ? []
      : (memoryMode === "smart" ? allFetchedMemRows.slice(0, 15) : allFetchedMemRows);


    const PROFILE_KINDS = new Set(["identity", "preference"]);
    const profileMems: { content: string; kind: string }[] = [];
    type ScoredMem = { content: string; kind: string; score: number };
    const scored: ScoredMem[] = [];

    for (const m of (memRows ?? []) as Array<{ content: string; kind: string; keywords: string[] | null }>) {
      // In smart mode the rows are already top-N by confidence — promote all to profile.
      if (memoryMode === "smart" || PROFILE_KINDS.has(m.kind)) {
        profileMems.push({ content: m.content, kind: m.kind });
        continue;
      }
      const kws = (m.keywords && m.keywords.length) ? m.keywords : extractKeywords(m.content, 12);
      const score = memoryRelevance(kws, queryKeywords);
      if (score > 0) scored.push({ content: m.content, kind: m.kind, score });
    }
    scored.sort((a, b) => b.score - a.score);

    // Build profile block (always on, generous budget since it's high-value).
    const PROFILE_MAX_ITEMS = 20;
    const PROFILE_CHAR_BUDGET = 1500;
    let profileBlock = "";
    for (const m of profileMems.slice(0, PROFILE_MAX_ITEMS)) {
      const line = `- (${m.kind}) ${m.content}`;
      if (profileBlock.length + line.length + 1 > PROFILE_CHAR_BUDGET) break;
      profileBlock += (profileBlock ? "\n" : "") + line;
    }

    // Build contextual block (keyword-matched only).
    const MEMORY_MAX_ITEMS = 8;
    const MEMORY_CHAR_BUDGET = 1200;
    let memoryBlock = "";
    for (const m of scored.slice(0, MEMORY_MAX_ITEMS)) {
      const line = `- (${m.kind}) ${m.content}`;
      if (memoryBlock.length + line.length + 1 > MEMORY_CHAR_BUDGET) break;
      memoryBlock += (memoryBlock ? "\n" : "") + line;
    }

    const memorySystem: Msg | null = (profileBlock || memoryBlock)
      ? {
        role: "system",
        content:
          (profileBlock
            ? "USER PROFILE (authoritative facts about the user — ALWAYS honor these). " +
              "Use them proactively: sign messages/emails with the user's real name, tailor tone to stated preferences, " +
              "respect their role/job context. NEVER write placeholders like \"[Your name]\", \"[Your role]\", \"[Your company]\" " +
              "when the information is available below — fill it in directly. Do not recite this block back to the user.\n" +
              profileBlock
            : "") +
          (profileBlock && memoryBlock ? "\n\n" : "") +
          (memoryBlock
            ? "Additional relevant context (use implicitly, don't repeat verbatim):\n" + memoryBlock
            : ""),
      }
      : null;

    // Compact style/system prompt — same intent, ~70% fewer tokens.
    const mapInstruction = mapDisabled
      ? "Maps: DISABLED by user preferences — do NOT emit any ```map block under any circumstance."
      : "Maps: use ONLY when the user asks about a specific real-world place, address, neighborhood, route, or list of locations where seeing them on a map materially helps (e.g. 'where is the Eiffel Tower', 'best ramen in Tokyo', 'route from Lyon to Marseille', 'cafés near Union Square'). " +
        "DO NOT emit a map for: general geography questions, country-level facts, history, or any question that doesn't reference a specific place the user wants to visualize. When in doubt, do NOT emit a map. " +
        "Format when used: a fenced ```map block containing JSON: { title?: string, center?: {lat:number,lng:number}, zoom?: number (1-20), markers: [{ lat:number, lng:number, label?: string, description?: string }], route?: { profile?: 'driving'|'walking'|'cycling'|'driving-traffic', waypoints: [{ lat:number, lng:number }, ...] } }. " +
        "Use `route` when the user asks for an itinerary / directions between 2 or more places (the polyline + distance + duration are computed automatically via Mapbox Directions). Always include matching `markers` for the start, intermediate stops and end so they're visible. " +
        "Provide accurate lat/lng coordinates yourself (you know them). Include 1 to 8 markers. Place the ```map block AFTER your textual answer, on its own. Do not mention the map block in prose.";

    const lengthInstruction =
      responseLength === "short"
        ? "LENGTH: SHORT mode — give the briefest useful answer. Aim for ≤ 100 words. 1–3 short paragraphs or a tight bullet list. No headings unless strictly necessary. Cut every non-essential word. Never recap the question."
        : responseLength === "comprehensive"
          ? "LENGTH: COMPREHENSIVE mode — go deep. Provide thorough explanations with context, nuances, examples, edge cases and structured sections (headings, bullets, tables when helpful). Aim for 500–900 words when the topic warrants it, but stay focused and avoid filler."
          : "LENGTH: be CONCISE. Aim for the SHORTEST useful answer. Default ≤ 250 words. Only go longer when the user explicitly asks for depth, a tutorial, or a long-form draft. No filler, no recap of the question, no closing pleasantries.";

    const styleSystem: Msg = {
      role: "system",
      content:
        "Style: airy markdown — short paragraphs, headings, bullets, dividers. Use tables for comparisons. Emojis sparingly. Reply in the user's language.\n" +
        lengthInstruction + "\n" +
        "Charts: use when numeric data, trends, comparisons, distributions or proportions would be clearer as a visual than as prose or a small table (e.g. evolution over time, market share, survey results, benchmark scores, before/after). " +
        "DO NOT use charts for: a single number, vague qualitative info, or when you'd have to invent data you don't actually know. When in doubt, do NOT emit a chart. " +
        "Format when used: fenced ```chart block containing JSON: { type: 'bar'|'line'|'area'|'pie', title?: string, xKey?: string (default 'name'), series?: [{key:string,label?:string,color?:string}], data: [{ [xKey]: string|number, [seriesKey]: number, ... }], stacked?: boolean, unit?: string }. " +
        "Pick the right type: line/area for time series & trends, bar for category comparisons, pie for parts of a whole (≤6 slices). Keep ≤ 12 data points and ≤ 4 series. Place the ```chart block AFTER your textual answer, on its own. Do not mention the chart block in prose.\n" +
        mapInstruction,
    };

    // Writing-canvas mode. Output format (STRICT):
    //   Line 1: CANVAS_EDIT: yes|no
    //   Line 2: CANVAS_TITLE: <short title, 2-5 words> (only when CANVAS_EDIT: yes)
    //   Then one short sentence, then ```canvas ... ``` block (only when CANVAS_EDIT: yes).
    //   When CANVAS_EDIT: no → respond normally as a regular chat reply (no canvas block).
    const writingSystem: Msg | null = writingMode
      ? {
        role: "system",
        content:
          "WRITING CANVAS MODE.\n" +
          "The user is drafting a document (email, report, article, note, etc.).\n" +
          (forceCanvas
            ? "The user EXPLICITLY invoked the /note command. You MUST produce a canvas document. CANVAS_EDIT: yes is mandatory. Do NOT output CANVAS_EDIT: no under any circumstance. Even for very short requests (e.g. \"hello\", \"test\"), write a minimal but real document matching the request.\n"
            : previousCanvas
              ? "A previous version of the document exists (shown below).\n" +
                "FIRST, decide: is the user's NEW message a request to MODIFY that document, or a totally different question/topic?\n" +
                "- If it's a modification (edit, rewrite, translate, shorten, change tone, add a paragraph…): CANVAS_EDIT: yes\n" +
                "- If it's a NEW unrelated question or chit-chat: CANVAS_EDIT: no → answer normally, no canvas.\n"
              : "This is a new drafting request: CANVAS_EDIT: yes.\n") +
          "\nResponse format (STRICT):\n" +
          "Line 1 must be exactly: CANVAS_EDIT: yes    OR    CANVAS_EDIT: no\n" +
          (forceCanvas ? "" : "\nIf CANVAS_EDIT: no → after line 1, just answer the user normally. Do NOT output a canvas block.\n") +
          "\nIf CANVAS_EDIT: yes:\n" +
          "  Line 2: CANVAS_TITLE: <2 to 5 words, in the user's language, describing the document topic — no quotes, no punctuation>\n" +
          "  Line 3: ONE short sentence (≤20 words) in the user's language describing what you did.\n" +
          "  Then output the ENTIRE updated document inside a fenced block opened with ```canvas and closed with ```.\n" +
          "  Do NOT write anything after the closing ```.\n" +
          "  The canvas block must contain plain prose only (no wrapping quotes).\n" +
          (previousCanvas
            ? "\nWhen editing, output the FULL updated document — keep everything that wasn't asked to change.\n\nPREVIOUS DOCUMENT:\n" + previousCanvas
            : ""),
      }
      : null;

    const voyagerEnabled = voyagerService || voyagerConnected;

    // Hard guardrail: the model never executes CRM ops itself.
    const voyagerGuardSystem: Msg = {
      role: "system",
      content:
        "VOYAGER CRM RULES (strict):\n" +
        (voyagerEnabled
          ? "- The user has Voyager CRM connected. The server handles all CRM calls: read ops (GET) are executed server-side and their result is injected into your context; write ops (POST/PATCH/DELETE) are emitted as a confirmation card and NEVER executed by you. You MUST NOT pretend an action was already performed — wait for the user's confirmation card.\n"
          : "- The user has NOT connected Voyager CRM. You CANNOT read, create, modify or delete any contact/company/deal. If asked, tell them briefly to connect Voyager CRM in Settings → Integrations.\n") +
        "- Any modification (create, update, delete) ALWAYS requires the user to explicitly confirm via the in-chat confirmation card. Never claim success without that confirmation.",
    };

    // Hard guardrail: tell the model the truth about the Google connection so it
    // never hallucinates "I'm not connected" when the user actually is.
    const googleGuardSystem: Msg = {
      role: "system",
      content:
        "GOOGLE INTEGRATION RULES (strict):\n" +
        (googleConnected
          ? `- The user HAS connected their Google account${googleAccountEmail ? ` (${googleAccountEmail})` : ""}. Gmail, Google Calendar and Google Drive are AVAILABLE. NEVER say you are not connected, never ask the user to connect — they already did.\n- The server routes Gmail/Calendar actions: read ops run server-side and their result is injected into your context; write ops (gmail.draft, gmail.send, calendar.create) are surfaced as an in-chat confirmation card that you MUST NOT execute or fake.\n- If the user asks you to write/send an email or create an event, do NOT refuse — the server will open the correct card. Just acknowledge briefly and let the card appear.\n`
          : "- The user has NOT connected Google. You cannot read Gmail, send emails, or create calendar events. If asked, tell them briefly to connect Google in Settings → Integrations.\n") +
        "- Never claim a Google action was performed without an explicit user confirmation through the card.",
    };

    // Prepend system messages (style + memory) and drop any previous duplicates from the client.
    const baseSystems: Msg[] = [
      ...(writingMode ? [] : [styleSystem]),
      ...(writingSystem ? [writingSystem] : []),
      ...(memorySystem ? [memorySystem] : []),
      voyagerGuardSystem,
      googleGuardSystem,
    ];
    const cleanedClientMessages = messages.filter(
      (m) =>
        m.role !== "system" ||
        (!m.content.startsWith("Persistent user memory") &&
          !m.content.startsWith("User memory") &&
          !m.content.startsWith("You may use emojis") &&
          !m.content.startsWith("Format your responses") &&
          !m.content.startsWith("Style:")),
    );

    // Trim history: keep at most the last N turns within a char budget, but always keep the last user message intact.
    const HISTORY_MAX_MSGS = 3;
    const HISTORY_CHAR_BUDGET = 12000;
    const trimmedHistory: Msg[] = (() => {
      const recent = cleanedClientMessages.slice(-HISTORY_MAX_MSGS);
      let total = 0;
      const kept: Msg[] = [];
      // Walk from newest to oldest, stop when budget exceeded (always keep at least the last 2 messages).
      for (let i = recent.length - 1; i >= 0; i--) {
        const m = recent[i];
        const len = (m.content ?? "").length;
        if (kept.length >= 2 && total + len > HISTORY_CHAR_BUDGET) break;
        kept.unshift(m);
        total += len;
      }
      return kept;
    })();

    const finalMessages: Msg[] = [...baseSystems, ...trimmedHistory];

    const ENV_KEY: Record<string, string | undefined> = {
      openai: Deno.env.get("OPENAI_API_KEY"),
      anthropic: Deno.env.get("ANTHROPIC_API_KEY"),
      google: Deno.env.get("GOOGLE_API_KEY"),
      mistral: Deno.env.get("MISTRAL_API_KEY"),
    };
    const apiKey = ENV_KEY[provider];

    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: `Provider ${provider} is not enabled on this instance.` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const enc = sseEncoder();
    let assistantText = "";

    // ---------- Web tools: detect & fetch BEFORE streaming ----------
    type VoyagerRouterDecision = {
      resource: string;
      method?: string;
      id?: string;
      query?: Record<string, unknown>;
      payload?: Record<string, unknown>;
    };
    const fallbackVoyagerIntent = (text: string): VoyagerRouterDecision | null => {
      const emailMatch = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
      const wantsContactEmailUpdate =
        !!emailMatch &&
        /\b(email|e-mail|mail|adresse email|adresse e-mail)\b/i.test(text) &&
        /\b(change|changer|modifie|modifier|met\s+à\s+jour|mettre\s+à\s+jour|update|remplace|remplacer)\b/i.test(text);

      if (wantsContactEmailUpdate) {
        const beforeEmail = text.slice(0, emailMatch.index).replace(/\b(par|en|à|a|avec|vers|pour)\s*$/i, "").trim();
        const nameMatch = beforeEmail.match(/(?:^|\s)(?:de|du|d'|pour)\s+([^,.;:]+)$/i);
        const contactSearch = (nameMatch?.[1] ?? "")
          .replace(/^contact\s+/i, "")
          .trim();
        return {
          resource: "contacts",
          method: "PATCH",
          query: contactSearch ? { search: contactSearch } : undefined,
          payload: { email: emailMatch[0] },
        };
      }

      return null;
    };
    const normalizeVoyagerDecision = (decision: VoyagerRouterDecision): VoyagerRouterDecision => {
      const resourceMap: Record<string, string> = {
        contact: "contacts",
        contacts: "contacts",
        company: "companies",
        companies: "companies",
        societe: "companies",
        société: "companies",
        deal: "deals",
        deals: "deals",
        opportunite: "deals",
        opportunité: "deals",
        none: "none",
      };
      const methodMap: Record<string, string> = {
        CREATE: "POST",
        ADD: "POST",
        POST: "POST",
        UPDATE: "PATCH",
        MODIFY: "PATCH",
        CHANGE: "PATCH",
        PUT: "PATCH",
        PATCH: "PATCH",
        DELETE: "DELETE",
        REMOVE: "DELETE",
        GET: "GET",
      };
      const resource = resourceMap[String(decision.resource ?? "none").toLowerCase()] ?? decision.resource;
      const method = methodMap[String(decision.method ?? "GET").toUpperCase()] ?? decision.method;
      return { ...decision, resource, method };
    };
    const inferVoyagerSearchTerm = (text: string, payload?: Record<string, unknown>): string => {
      const withoutEmail = text.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig, " ");
      const match = withoutEmail.match(/(?:^|\s)(?:de|du|d'|pour)\s+([^,.;:]+?)(?:\s+(?:par|en|à|a|avec|vers|pour)\b|$)/i);
      const fromText = (match?.[1] ?? "").replace(/^contact\s+/i, "").trim();
      if (fromText) return fromText;
      for (const key of ["name", "full_name", "fullName", "email"] as const) {
        const value = payload?.[key];
        if (typeof value === "string" && value.trim()) return value.trim();
      }
      return "";
    };
    const pendingVoyagerWriteFromHistory = (): VoyagerRouterDecision | null => {
      const currentFallback = fallbackVoyagerIntent(lastUserText);
      if (currentFallback) return currentFallback;
      const previousUser = [...trimmedHistory.slice(0, -1)].reverse().find((m) => m.role === "user")?.content ?? "";
      const previousWrite = fallbackVoyagerIntent(previousUser);
      if (!previousWrite || !previousWrite.payload) return null;
      const previousAssistant = [...trimmedHistory.slice(0, -1)].reverse().find((m) => m.role === "assistant")?.content ?? "";
      const wasChoosingContact = /Plusieurs résultats correspondent|Précise lequel je dois mettre à jour/i.test(previousAssistant);
      if (!wasChoosingContact) return null;
      const selectedEmail = lastUserText.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0];
      const selectedName = lastUserText
        .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig, " ")
        .replace(/[()]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      const search = selectedEmail || selectedName;
      return search ? { ...previousWrite, id: undefined, query: { search } } : null;
    };
    const normalizeVoyagerText = (value: unknown): string =>
      String(value ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9@.]+/g, " ").trim();
    const pickExactVoyagerMatch = (items: any[], searchTerm: string): any | null => {
      if (items.length === 1) return items[0];
      const term = normalizeVoyagerText(searchTerm);
      if (!term) return null;
      const email = searchTerm.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0]?.toLowerCase();
      if (email) {
        const byEmail = items.find((x) => String(x?.email ?? "").toLowerCase() === email);
        if (byEmail) return byEmail;
      }
      return items.find((x) => normalizeVoyagerText(`${x?.first_name ?? ""} ${x?.last_name ?? ""}`) === term) ?? null;
    };
    const linkupKey = Deno.env.get("LINKUP_API_KEY");
    let webContext:
      | { kind: "scrape" | "search"; label: string; content: string; sources?: WebSource[]; images?: WebImage[] }
      | null = null;
    // Aggregated sources from the agentic loop (multiple searches/scrapes).
    let agenticUsed = false;
    let agenticNarration = "";
    // Count of successful Linkup web searches performed for this request.
    // Used to passthrough-bill the Linkup API cost to the user (it's not free).
    // Standard depth pricing: $0.006 per search (see LINKUP_SEARCH_COST_USD).
    let webSearchCount = 0;
    const agenticSources: WebSource[] = [];
    const agenticImages: WebImage[] = [];
    const agenticContextBlocks: string[] = [];
    // Collected for persistence so steps survive conversation reload.
    const collectedAgentSteps: Array<{ index: number; kind: string; label: string; intent: string; status: string; foundCount?: number; narration?: string }> = [];
    const perStepNarration: Map<number, string> = new Map();
    const collectedThinkingSteps: Array<{ index: number; text: string }> = [];

    // ---------- Google router (Gemini Flash) ----------
    // Decides if the last user message wants a Google action.
    // Returns one of:
    //   { action: "none" }
    //   { action: "gmail.search" | "gmail.get" | "calendar.list", params }  -> read, executed server-side
    //   { action: "gmail.draft" | "gmail.send" | "calendar.create", params } -> proposal, requires user confirmation
    type GoogleRouterDecision =
      | { action: "none" }
      | {
          action:
            | "gmail.search"
            | "gmail.get"
            | "gmail.draft"
            | "gmail.send"
            | "calendar.list"
            | "calendar.create";
          params: Record<string, unknown>;
          rationale?: string;
        };

    function fallbackGoogleIntent(userText: string): GoogleRouterDecision | null {
      const normalized = userText
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
      const mentionsMail = /\b(gmail|e-?mail|mail|courriel|inbox|boite mail|message?s? recus?)\b/.test(normalized);
      const wantsUnread = /\b(non lus?|unread)\b/.test(normalized);
      const wantsLatest = /\b(dernier(?:s|es)?|recent(?:s|es)?|nouveau(?:x|lles)?|recus?|inbox|boite mail|check|verifie|montre|liste|lis|regarde)\b/.test(normalized);
      const isComposing = /\b(ecris|redige|compose|brouillon|draft|reponds|reply|write|prepare|prepar)\b/.test(normalized);
      const isSending = /\b(envoie|envoyer|send)\b/.test(normalized);

      // Composing/drafting an email — surface a draft card pre-filled with whatever recipient we can detect.
      if ((googleService === "gmail" && isComposing) || (mentionsMail && isComposing)) {
        // Extract first email address mentioned in the user text, if any.
        const emailMatch = userText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
        const to = emailMatch ? emailMatch[0] : "";
        return {
          action: isSending ? "gmail.send" : "gmail.draft",
          params: { to, subject: "", body: "" },
          rationale: "deterministic compose fallback",
        };
      }

      if (googleService === "gmail" && !isComposing && userText.trim()) {
        return {
          action: "gmail.search",
          params: { query: wantsUnread ? "is:unread" : "in:inbox", maxResults: wantsLatest ? 10 : 5 },
          rationale: "deterministic /gmail fallback",
        };
      }
      if (mentionsMail && (wantsUnread || wantsLatest) && !isComposing) {
        return {
          action: "gmail.search",
          params: { query: wantsUnread ? "is:unread" : "in:inbox", maxResults: wantsLatest ? 10 : 5 },
          rationale: "deterministic Gmail read fallback",
        };
      }

      // Calendar fallbacks when user explicitly invoked /calendar.
      const mentionsCalendar = /\b(calendar|calendrier|agenda|meeting|reunion|rendez-?vous|rdv|event|evenement|creneau|slot)\b/.test(normalized);
      const isCreating = /\b(cree|creer|ajoute|ajouter|planifie|planifier|schedule|create|add|book|bloque|bloquer|reserve|reserver|organise|organiser|nouveau|new|set up)\b/.test(normalized);
      if (googleService === "calendar" && isCreating) {
        return {
          action: "calendar.create",
          params: { summary: "", start: "", end: "" },
          rationale: "deterministic /calendar create fallback",
        };
      }
      if (googleService === "calendar" && userText.trim()) {
        return {
          action: "calendar.list",
          params: { maxResults: 10 },
          rationale: "deterministic /calendar list fallback",
        };
      }
      if (mentionsCalendar && isCreating) {
        return {
          action: "calendar.create",
          params: { summary: "", start: "", end: "" },
          rationale: "deterministic calendar create fallback",
        };
      }
      return null;
    }

    async function classifyGoogleIntent(
      googleApiKey: string,
      userText: string,
      historyTail: { role: string; content: string }[],
    ): Promise<GoogleRouterDecision> {
      const scopeHint = googleService === "gmail"
        ? `\nThe user explicitly invoked /gmail — they want a Gmail action. Choose ONLY from gmail.* actions. Never return "none" unless the message is completely empty.`
        : googleService === "calendar"
          ? `\nThe user explicitly invoked /calendar — they want a Calendar action. Choose ONLY from calendar.* actions. Never return "none" unless the message is completely empty.`
          : googleService === "drive"
            ? `\nThe user explicitly invoked /drive — they want a Drive action. Drive support is not yet implemented; return {"action":"none"}.`
            : "";
      const sys =
        `You decide if the last user message wants the assistant to call a Google action ` +
        `on the user's connected Google account. The user's email is ${googleAccountEmail ?? "unknown"}. ` +
        `Today is ${new Date().toISOString()}.\n\n` +
        `Available actions:\n` +
        `- gmail.search { query?: string (Gmail search syntax, e.g. "from:alice is:unread"), maxResults?: number<=25 }\n` +
        `- gmail.get { id: string } (only if the user references a specific email already shown)\n` +
        `- gmail.draft { to, subject, body, cc?, bcc? } (compose a draft, do NOT send)\n` +
        `- gmail.send { to, subject, body, cc?, bcc? } (send immediately on user confirmation)\n` +
        `- calendar.list { timeMin?: ISO, timeMax?: ISO, q?: string, maxResults?: number<=50 }\n` +
        `- calendar.create { summary, start: ISO, end: ISO, description?, location?, attendees?: email[], timeZone? }\n\n` +
        `Rules:\n` +
        `- If the message is general chat or unrelated to Gmail/Calendar, return {"action":"none"}.\n` +
        `- ANY mention of "email", "mail", "courriel", "boîte mail", "inbox", "Gmail", "messages reçus", "dernier email", "nouveaux emails", or asking about who wrote/sent something → use gmail.search.\n` +
        `- For "mon dernier email" / "derniers emails reçus" → gmail.search with query "in:inbox" and maxResults 5-10, sorted by recency (Gmail default).\n` +
        `- For "emails non lus" / "unread" → gmail.search with query "is:unread".\n` +
        `- For "email de X" / "from X" → gmail.search with query "from:X".\n` +
        `- Resolve relative dates ("tomorrow 3pm", "next monday") to ISO 8601 in UTC.\n` +
        `- COMPOSING: When the user asks to write/draft/compose/redact an email ("écris un email", "rédige un mail", "compose un email", "draft an email", "write an email about X", "envoie un email à Y disant Z") → use gmail.draft (NOT gmail.send unless they explicitly say "send" / "envoie maintenant" with a recipient).\n` +
        `- WRITE THE FULL BODY YOURSELF: For gmail.draft and gmail.send, you MUST write a complete, ready-to-send email body in the same language as the user's request, based on what the user described. Do NOT leave body empty just because the user didn't dictate the exact words — infer a polite, well-structured message from their intent. Same for subject: write a concise, relevant subject line.\n` +
        `- Only leave "to" empty if the user did not specify any recipient (name, email, or "à X"). If they gave a name without an email, put the name in "to" so the user can complete it.\n` +
        `- Prefer gmail.search with a Gmail-style query when the user asks to find/check emails.\n` +
        `- Always reply with a single JSON object, no prose.` +
        scopeHint;

      const body = {
        contents: [
          ...historyTail.slice(-4).map((m) => ({
            role: m.role === "assistant" ? "model" : "user",
            parts: [{ text: m.content.slice(0, 2000) }],
          })),
          { role: "user", parts: [{ text: userText.slice(0, 4000) }] },
        ],
        systemInstruction: { role: "user", parts: [{ text: sys }] },
        generationConfig: {
          temperature: 0,
          responseMimeType: "application/json",
          thinkingConfig: { thinkingBudget: 0 },
        },
      };
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${googleApiKey}`;
      let r: Response;
      try {
        r = await fetchWithTimeout(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }, 800);
      } catch (e) {
        // Timeout/network → safe default. Local fallbackGoogleIntent will still run upstream.
        console.warn("google router classify timed out, falling back to none", e instanceof Error ? e.message : e);
        return { action: "none" };
      }
      const d = await r.json();
      if (!r.ok) {
        console.warn("google router classify failed", d);
        return { action: "none" };
      }
      const text: string =
        d?.candidates?.[0]?.content?.parts?.[0]?.text ?? '{"action":"none"}';
      try {
        const parsed = JSON.parse(text);
        if (
          typeof parsed?.action === "string" &&
          [
            "none",
            "gmail.search",
            "gmail.get",
            "gmail.draft",
            "gmail.send",
            "calendar.list",
            "calendar.create",
          ].includes(parsed.action)
        ) {
          return parsed as GoogleRouterDecision;
        }
      } catch (e) {
        console.warn("google router parse failed", e, text);
      }
      return { action: "none" };
    }

    async function draftEmailContent(
      googleApiKey: string,
      userText: string,
      historyTail: { role: string; content: string }[],
      current: { to: string; subject: string; body: string },
    ): Promise<{ to: string; subject: string; body: string }> {
      const sys =
        `You are drafting an email on behalf of the user (${googleAccountEmail ?? "unknown"}).\n` +
        `Today is ${new Date().toISOString()}.\n\n` +
        `From the user's request and the recent conversation, fill in the email fields:\n` +
        `- "to": Extract the recipient's email address if the user mentioned one (e.g. "envoie à john@acme.com" → "john@acme.com"). If the user gave only a name without email (e.g. "écris à Marie"), put the name as-is so the user can complete it. If no recipient was specified at all, leave it as an empty string.\n` +
        `- Detect the language of the user's request and write the email in that same language.\n` +
        `- "subject": short, specific, no quotes.\n` +
        `- "body": polite greeting, well-structured paragraphs, clear sign-off. Do NOT include the recipient address or "From:" headers — only the message text.\n` +
        `- Sign with the user's first name if known from context, otherwise leave the sign-off generic ("Bien à vous,") without inventing a name.\n` +
        `- Do NOT use placeholders like [Your Name] or [Recipient]. If a fact is unknown, omit it gracefully rather than inserting a placeholder.\n` +
        `- Reply with a single JSON object: {"to": "...", "subject": "...", "body": "..."}.` +
        (current.to ? `\nKeep this recipient if reasonable: "${current.to}".` : "") +
        (current.subject ? `\nKeep this subject if reasonable: "${current.subject}".` : "") +
        (current.body ? `\nUse this body as a starting point and improve it: "${current.body.slice(0, 500)}".` : "");

      const body = {
        contents: [
          ...historyTail.slice(-6).map((m) => ({
            role: m.role === "assistant" ? "model" : "user",
            parts: [{ text: m.content.slice(0, 2000) }],
          })),
          { role: "user", parts: [{ text: userText.slice(0, 4000) }] },
        ],
        systemInstruction: { role: "user", parts: [{ text: sys }] },
        generationConfig: {
          temperature: 0.5,
          responseMimeType: "application/json",
        },
      };
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${googleApiKey}`;
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(`drafter failed: ${JSON.stringify(d)}`);
      const text: string = d?.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
      const parsed = JSON.parse(text);
      return {
        to: typeof parsed?.to === "string" ? parsed.to : current.to,
        subject: typeof parsed?.subject === "string" ? parsed.subject : current.subject,
        body: typeof parsed?.body === "string" ? parsed.body : current.body,
      };
    }

    async function draftCalendarEvent(
      googleApiKey: string,
      userText: string,
      historyTail: { role: string; content: string }[],
      current: { summary: string; start: string; end: string },
    ): Promise<{ summary: string; start: string; end: string; description?: string; location?: string; attendees?: string[] }> {
      const sys =
        `You are creating a Google Calendar event on behalf of the user (${googleAccountEmail ?? "unknown"}).\n` +
        `Today is ${new Date().toISOString()}.\n\n` +
        `From the user's request and the recent conversation, fill in the event fields:\n` +
        `- "summary": short event title.\n` +
        `- "start": ISO 8601 datetime. Resolve relative dates ("tomorrow 3pm", "next monday 10h") to absolute dates. Default to the next business day at 09:00 if unspecified.\n` +
        `- "end": ISO 8601 datetime. If duration not specified, default to 30 minutes after start.\n` +
        `- "description": optional event description if the user provided context.\n` +
        `- "location": optional location if mentioned.\n` +
        `- "attendees": optional array of email addresses if the user mentioned participants.\n` +
        `- Reply with a single JSON object: {"summary":"...","start":"...","end":"...","description":"...","location":"...","attendees":["..."]}.\n` +
        `- Omit optional fields if not relevant.` +
        (current.summary ? `\nKeep this title if reasonable: "${current.summary}".` : "") +
        (current.start ? `\nKeep this start if reasonable: "${current.start}".` : "") +
        (current.end ? `\nKeep this end if reasonable: "${current.end}".` : "");

      const body = {
        contents: [
          ...historyTail.slice(-6).map((m) => ({
            role: m.role === "assistant" ? "model" : "user",
            parts: [{ text: m.content.slice(0, 2000) }],
          })),
          { role: "user", parts: [{ text: userText.slice(0, 4000) }] },
        ],
        systemInstruction: { role: "user", parts: [{ text: sys }] },
        generationConfig: {
          temperature: 0.5,
          responseMimeType: "application/json",
        },
      };
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${googleApiKey}`;
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(`calendar drafter failed: ${JSON.stringify(d)}`);
      const text: string = d?.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
      const parsed = JSON.parse(text);
      return {
        summary: typeof parsed?.summary === "string" ? parsed.summary : current.summary,
        start: typeof parsed?.start === "string" ? parsed.start : current.start,
        end: typeof parsed?.end === "string" ? parsed.end : current.end,
        ...(typeof parsed?.description === "string" && parsed.description ? { description: parsed.description } : {}),
        ...(typeof parsed?.location === "string" && parsed.location ? { location: parsed.location } : {}),
        ...(Array.isArray(parsed?.attendees) && parsed.attendees.length ? { attendees: parsed.attendees } : {}),
      };
    }

    async function execGoogleReadAction(
      authHeader: string,
      action: string,
      params: Record<string, unknown>,
    ): Promise<unknown> {
      const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/google-tools`;
      const r = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: authHeader,
          "Content-Type": "application/json",
          apikey: Deno.env.get("SUPABASE_ANON_KEY") ?? "",
        },
        body: JSON.stringify({ action, params }),
      });
      const d = await r.json();
      if (!r.ok || d.error) {
        throw new Error(d.error ?? `google-tools failed (${r.status})`);
      }
      return d.result;
    }


    const stream = new ReadableStream({
      async start(controller) {
        try {
          // ---------- Auto-generate title on the FIRST user message of the conversation ----------
          // Done early so the sidebar gets a real title even if clarify intercepts the stream.
          const firstUserMessage = messages.filter((m) => m.role === "user").length <= 1;
          if (!ephemeral && firstUserMessage && lastUserText) {
            // Fire and forward — don't block the response on it for too long.
            generateTitle({
              openaiKey: Deno.env.get("OPENAI_API_KEY"),
              googleKey: Deno.env.get("GOOGLE_API_KEY"),
              anthropicKey: Deno.env.get("ANTHROPIC_API_KEY"),
              userText: lastUserText,
            })
              .then(async (title) => {
                if (!title) return;
                try {
                  await supabase.from("conversations").update({ title }).eq("id", conversationId);
                  controller.enqueue(enc({ type: "title", title }));
                } catch (e) {
                  console.error("title enqueue/update failed", e);
                }
              })
              .catch((e) => console.error("title gen failed", e));
          }

          // ============================================================
          // PARALLEL CLASSIFIER LAUNCH (Step 4 of latency optimization).
          // Previously: Clarify → Google → Voyager ran SEQUENTIALLY, so the
          // total pre-LLM wait was the SUM of all 3 classifier latencies
          // (often 1-2s when several gates open). They now fire in parallel
          // here; each downstream block just awaits its pre-launched promise,
          // so total ≈ max() instead of sum(). Fast-filters still gate which
          // ones actually hit the network — a no-op message stays free.
          // ============================================================
          const userTurns = messages.filter((m) => m.role === "user").length;
          const fastNoClarify =
            userTurns > 1 ||
            lastUserText.trim().length < 40;


          const googleApiKey = Deno.env.get("GOOGLE_API_KEY");
          const fastNoGoogle = (() => {
            if (googleService) return false; // explicit /gmail or /calendar invocation
            const t = lastUserText.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
            return !/\b(gmail|e-?mail|mail|courriel|inbox|brouillon|draft|envoie|envoyer|send|reponds|reply|write to|ecris a|redige|compose|prepare|calendar|calendrier|agenda|meeting|reunion|rendez-?vous|rdv|event|evenement|slot|creneau|drive|document|doc|sheet|spreadsheet|tableur|google )\b/.test(t);
          })();

          const forcedVoyagerDecision = pendingVoyagerWriteFromHistory();
          const fastNoVoyager = (() => {
            if (voyagerService || forcedVoyagerDecision) return false;
            const t = lastUserText.toLowerCase();
            return !/\b(crm|voyager|contact|contacts|company|companies|deal|deals|client|prospect|lead|opportunit|entreprise|societe|pipeline|account|customer|fiche|interlocuteur)\b/.test(t);
          })();

          const willClarify = !ephemeral && !skipClarify && !writingMode && !!lastUserText && !googleService && (!fastNoClarify || !!forceClarify);
          const willGoogle = !writingMode && !!lastUserText && !fastNoGoogle;
          const canGoogle = googleConnected && !!googleApiKey;
          const willVoyager = voyagerEnabled && !!lastUserText && !fastNoVoyager && (!writingMode || !!forcedVoyagerDecision);

          // Clarify was pre-launched BEFORE DB reads (see earlyClarifyPromise above) so its
          // network latency overlaps with the DB batch. Reuse the in-flight promise here.
          const clarifyPromise: Promise<ClarifyQuestion[] | null> = willClarify
            ? earlyClarifyPromise
            : Promise.resolve(null);


          const googleDecisionPromise: Promise<GoogleRouterDecision> = (willGoogle && canGoogle)
            ? classifyGoogleIntent(
                googleApiKey!,
                lastUserText,
                trimmedHistory.map((m) => ({ role: m.role, content: m.content ?? "" })),
              ).catch((e) => { console.warn("google classify promise failed", e); return { action: "none" } as GoogleRouterDecision; })
            : Promise.resolve({ action: "none" } as GoogleRouterDecision);

          const voyagerDecisionPromise: Promise<VoyagerRouterDecision> = (() => {
            if (!willVoyager || !googleApiKey) return Promise.resolve({ resource: "none" } as VoyagerRouterDecision);
            const sys =
              `You decide how to call the Voyager CRM API on behalf of the user. ` +
              `Today: ${new Date().toISOString()}.\n\n` +
              `Available resources: contacts, companies, deals.\n` +
              `Methods:\n` +
              `- GET (list or get one) — query params like { limit?: number, search?: string }, optional id for single fetch\n` +
              `- POST (create) — payload with the new entity fields\n` +
              `- PATCH (update) — id required + payload with fields to change\n` +
              `- DELETE — id required\n\n` +
              `Rules:\n` +
              `- Reply with a single JSON object: {"resource":"contacts|companies|deals","method":"GET|POST|PATCH|DELETE","id"?:string,"query"?:object,"payload"?:object}\n` +
              `- If the request is unclear or unrelated to the CRM, return {"resource":"none"}.\n` +
              `- For "liste/affiche/cherche/montre" → GET. For "ajoute/crée/nouveau" → POST. For "modifie/met à jour" → PATCH. For "supprime/efface" → DELETE.\n` +
              `- Default GET limit to 20 unless user specifies.`;
            return fetchWithTimeout(
              `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${googleApiKey}`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  contents: [{ role: "user", parts: [{ text: lastUserText.slice(0, 4000) }] }],
                  systemInstruction: { role: "user", parts: [{ text: sys }] },
                  generationConfig: {
                    temperature: 0,
                    responseMimeType: "application/json",
                    thinkingConfig: { thinkingBudget: 0 },
                  },
                }),
              },
              800,
            ).then(async (r) => {
              const d = await r.json();
              const text: string = d?.candidates?.[0]?.content?.parts?.[0]?.text ?? '{"resource":"none"}';
              try { return JSON.parse(text) as VoyagerRouterDecision; } catch { return { resource: "none" } as VoyagerRouterDecision; }
            }).catch((e) => { console.warn("voyager classify promise failed", e); return { resource: "none" } as VoyagerRouterDecision; });
          })();

          // ---------- Clarifying questions ----------
          if (willClarify) {
            controller.enqueue(enc({ type: "phase", phase: "analyzing" }));
            const clarify = await clarifyPromise;
            if (clarify && clarify.length) {
              controller.enqueue(enc({ type: "clarify", questions: clarify }));
              await new Promise((r) => setTimeout(r, 50));
              controller.enqueue(enc({ type: "done" }));
              controller.close();
              return;
            }
          }

          // ---------- Google integration router ----------
          if (willGoogle) {
            if (!canGoogle) {
              if (googleService) {
                const svc = googleService === "gmail" ? "Gmail" : googleService === "calendar" ? "Google Calendar" : "Google Drive";
                const msg = `Pour utiliser ${svc}, connecte ton compte Google dans les paramètres (onglet Intégrations).`;
                controller.enqueue(enc({ type: "delta", text: msg }));
                assistantText += msg;
                if (!ephemeral && conversationId) {
                  try { await supabase.from("messages").insert({ conversation_id: conversationId, user_id: user.id, role: "assistant", content: assistantText, model }); } catch (_) { /* ignore */ }
                }
                controller.enqueue(enc({ type: "done" }));
                controller.close();
                return;
              }
            } else {
            try {
              let decision = await googleDecisionPromise;
              if (decision.action === "none") {
                decision = fallbackGoogleIntent(lastUserText) ?? decision;
              }
              console.log("[google router] decision=", JSON.stringify(decision), "googleService=", googleService, "userText=", lastUserText.slice(0, 200));

              if (decision.action !== "none") {
                const isWrite =
                  decision.action === "gmail.draft" ||
                  decision.action === "gmail.send" ||
                  decision.action === "calendar.create";

                if (isWrite) {
                  // For email composition, ensure body & subject are filled — call the LLM
                  // again to write a complete draft when the router left them empty.
                  if (decision.action === "gmail.draft" || decision.action === "gmail.send") {
                    const params = (decision.params ?? {}) as Record<string, unknown>;
                    const currentTo = String(params.to ?? "").trim();
                    const currentBody = String(params.body ?? "").trim();
                    const currentSubject = String(params.subject ?? "").trim();
                    const needsDrafting = !currentTo || !currentBody || !currentSubject;

                    // Emit the card IMMEDIATELY (with a loading flag if we still need to draft).
                    // This way the user sees the email shell appear before any text streams.
                    controller.enqueue(
                      enc({
                        type: "google_action",
                        mode: "proposal",
                        action: decision.action,
                        params: decision.params,
                        loading: needsDrafting,
                      }),
                    );

                    if (needsDrafting) {
                      try {
                        const drafted = await draftEmailContent(
                          googleApiKey,
                          lastUserText,
                          trimmedHistory.map((m) => ({ role: m.role, content: m.content ?? "" })),
                          { to: currentTo, subject: currentSubject, body: currentBody },
                        );
                        decision = {
                          ...decision,
                          params: {
                            ...params,
                            to: drafted.to || currentTo,
                            subject: drafted.subject || currentSubject,
                            body: drafted.body || currentBody,
                          },
                        };
                        // Update the card with drafted content.
                        controller.enqueue(
                          enc({
                            type: "google_action",
                            mode: "proposal",
                            action: decision.action,
                            params: decision.params,
                            loading: false,
                          }),
                        );
                      } catch (e) {
                        console.warn("draftEmailContent failed", e);
                        // Clear the loading state even on failure.
                        controller.enqueue(
                          enc({
                            type: "google_action",
                            mode: "proposal",
                            action: decision.action,
                            params: decision.params,
                            loading: false,
                          }),
                        );
                      }
                    }
                  } else if (decision.action === "calendar.create") {
                    const params = (decision.params ?? {}) as Record<string, unknown>;
                    const currentSummary = String(params.summary ?? "").trim();
                    const currentStart = String(params.start ?? "").trim();
                    const currentEnd = String(params.end ?? "").trim();
                    const needsDrafting = !currentSummary || !currentStart || !currentEnd;

                    controller.enqueue(
                      enc({
                        type: "google_action",
                        mode: "proposal",
                        action: decision.action,
                        params: decision.params,
                        loading: needsDrafting,
                      }),
                    );

                    if (needsDrafting) {
                      try {
                        const drafted = await draftCalendarEvent(
                          googleApiKey,
                          lastUserText,
                          trimmedHistory.map((m) => ({ role: m.role, content: m.content ?? "" })),
                          { summary: currentSummary, start: currentStart, end: currentEnd },
                        );
                        decision = {
                          ...decision,
                          params: { ...params, ...drafted },
                        };
                        controller.enqueue(
                          enc({
                            type: "google_action",
                            mode: "proposal",
                            action: decision.action,
                            params: decision.params,
                            loading: false,
                          }),
                        );
                      } catch (e) {
                        console.warn("draftCalendarEvent failed", e);
                        controller.enqueue(
                          enc({
                            type: "google_action",
                            mode: "proposal",
                            action: decision.action,
                            params: decision.params,
                            loading: false,
                          }),
                        );
                      }
                    }
                  } else {
                    controller.enqueue(
                      enc({
                        type: "google_action",
                        mode: "proposal",
                        action: decision.action,
                        params: decision.params,
                        loading: false,
                      }),
                    );
                  }
                  const intros: Record<string, string> = {
                    "gmail.draft": "Voici un brouillon d'email à valider :",
                    "gmail.send": "Prêt à envoyer cet email — confirme pour partir :",
                    "calendar.create": "Voici l'événement proposé — confirme pour le créer :",
                  };
                  const intro = intros[decision.action] ?? "Action proposée :";
                  controller.enqueue(enc({ type: "delta", text: intro }));
                  assistantText += intro;
                  if (!ephemeral && conversationId) {
                    try {
                      await supabase.from("messages").insert({
                        conversation_id: conversationId,
                        user_id: user.id,
                        role: "assistant",
                        content: assistantText,
                        model,
                        meta: {
                          google_action: {
                            mode: "proposal",
                            action: decision.action,
                            params: decision.params,
                          },
                        },
                      });
                    } catch (e) {
                      console.error("persist google proposal failed", e);
                    }
                  }
                  controller.enqueue(enc({ type: "done" }));
                  controller.close();
                  return;
                }

                // READ action — execute now and inject result into the LLM context.
                // NOTE: we intentionally do NOT emit `tool` events here — the Google
                // service badge is already shown via the message's `googleService`
                // field, and emitting a `tool` event would render a misleading
                // "Web search: ..." tag in the UI.
                try {
                  const result = await execGoogleReadAction(
                    authHeader,
                    decision.action,
                    decision.params ?? {},
                  );
                  controller.enqueue(
                    enc({
                      type: "google_action",
                      mode: "result",
                      action: decision.action,
                      params: decision.params,
                      result,
                    }),
                  );
                  finalMessages.push({
                    role: "system",
                    content:
                      `[Google ${decision.action} result for the user — summarize naturally in your reply, ` +
                      `do NOT dump JSON]:\n${JSON.stringify(result).slice(0, 12000)}`,
                  });
                } catch (e) {
                  console.error("google read action failed", e);
                  finalMessages.push({
                    role: "system",
                    content: `[Google ${decision.action} failed: ${
                      e instanceof Error ? e.message : "unknown"
                    }. Tell the user briefly and suggest reconnecting Google if relevant.]`,
                  });
                }
              }
            } catch (e) {
              console.warn("google router skipped", e);
            }
            }
          }

          // ---------- Voyager CRM router ----------
          // Decision was pre-launched in parallel above (see voyagerDecisionPromise).
          if (willVoyager) {
            try {
              let decision: VoyagerRouterDecision = await voyagerDecisionPromise;
              const fallbackDecision = forcedVoyagerDecision ?? fallbackVoyagerIntent(lastUserText);
              if (fallbackDecision && fallbackDecision.method && ["POST", "PATCH", "DELETE"].includes(fallbackDecision.method)) {
                decision = fallbackDecision;
              } else if (decision.resource === "none") {
                decision = fallbackDecision ?? decision;
              }
              decision = normalizeVoyagerDecision(decision);
              console.log("[voyager router] decision=", JSON.stringify(decision), "voyagerService=", voyagerService, "voyagerConnected=", voyagerConnected, "userText=", lastUserText.slice(0, 200));
              const validRes = ["contacts", "companies", "deals"].includes(decision.resource);
              const method = (decision.method ?? "GET").toUpperCase();
              if (validRes) {
                // Helper to call voyager-crm proxy
                const voyagerCall = (payload: Record<string, unknown>) =>
                  fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/voyager-crm`, {
                    method: "POST",
                    headers: {
                      Authorization: authHeader,
                      "Content-Type": "application/json",
                      apikey: Deno.env.get("SUPABASE_ANON_KEY") ?? "",
                    },
                    body: JSON.stringify(payload),
                  }).then(async (r) => ({ ok: r.ok, status: r.status, json: await r.json().catch(() => ({})) }));

                const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
                // For PATCH/DELETE: if id is missing or not a UUID, try to resolve by searching.
                if (["PATCH", "DELETE"].includes(method) && (!decision.id || !UUID_RE.test(decision.id))) {
                  const searchTerm = (decision.id && String(decision.id)) ||
                    (decision.query?.search as string | undefined) ||
                    inferVoyagerSearchTerm(lastUserText, decision.payload) ||
                    "";
                  if (searchTerm) {
                    try {
                      const sr = await voyagerCall({
                        resource: decision.resource,
                        method: "GET",
                        query: { search: searchTerm, limit: 5 },
                      });
                      const arr: any[] = Array.isArray(sr.json?.data)
                        ? sr.json.data
                        : Array.isArray(sr.json?.data?.items)
                          ? sr.json.data.items
                          : Array.isArray(sr.json?.data?.results)
                            ? sr.json.data.results
                            : Array.isArray(sr.json?.data?.data)
                              ? sr.json.data.data
                              : [];
                      const exact = pickExactVoyagerMatch(arr, searchTerm);
                      if (exact && typeof exact.id === "string") {
                        decision.id = exact.id;
                        decision.query = undefined;
                      } else if (arr.length > 1) {
                        // Ambiguous — ask user via assistant text instead of proposing a broken action.
                        const names = arr.slice(0, 5).map((x: any) =>
                          `- ${x.first_name ?? ""} ${x.last_name ?? ""} ${x.email ? `(${x.email})` : ""}`.trim()
                        ).join("\n");
                        const ask = `Plusieurs résultats correspondent à « ${searchTerm} » :\n${names}\n\nPrécise lequel je dois mettre à jour.`;
                        controller.enqueue(enc({ type: "delta", text: ask }));
                        assistantText += ask;
                        if (!ephemeral && conversationId) {
                          try {
                            await supabase.from("messages").insert({
                              conversation_id: conversationId, user_id: user.id, role: "assistant",
                              content: assistantText, model,
                            });
                          } catch (_) { /* ignore */ }
                        }
                        controller.enqueue(enc({ type: "done" }));
                        controller.close();
                        return;
                      } else {
                        const msg = `Je n'ai trouvé aucun ${decision.resource === "contacts" ? "contact" : decision.resource === "companies" ? "société" : "deal"} correspondant à « ${searchTerm} » dans Voyager CRM.`;
                        controller.enqueue(enc({ type: "delta", text: msg }));
                        assistantText += msg;
                        if (!ephemeral && conversationId) {
                          try {
                            await supabase.from("messages").insert({
                              conversation_id: conversationId, user_id: user.id, role: "assistant",
                              content: assistantText, model,
                            });
                          } catch (_) { /* ignore */ }
                        }
                        controller.enqueue(enc({ type: "done" }));
                        controller.close();
                        return;
                      }
                    } catch (e) {
                      console.warn("voyager name resolution failed", e);
                    }
                  }
                }

                if (method === "GET") {
                  // Execute server-side and inject result.
                  const sr = await voyagerCall({
                    resource: decision.resource,
                    method: "GET",
                    id: decision.id,
                    query: decision.query,
                  });
                  if (sr.ok && !sr.json?.error) {
                    finalMessages.push({
                      role: "system",
                      content: `[Voyager CRM ${decision.resource} GET result — summarize naturally, do NOT dump JSON]:\n${JSON.stringify(sr.json?.data).slice(0, 12000)}`,
                    });
                  } else {
                    finalMessages.push({
                      role: "system",
                      content: `[Voyager CRM call failed: ${sr.json?.error ?? sr.status}. Tell the user briefly and suggest checking the API key in Settings → Integrations.]`,
                    });
                  }
                } else if (["POST", "PATCH", "DELETE"].includes(method)) {
                  // Write — emit proposal card, halt streaming text.
                  controller.enqueue(enc({
                    type: "voyager_action",
                    resource: decision.resource,
                    method,
                    id: decision.id,
                    payload: decision.payload,
                  }));
                  const intro = `Voici l'action Voyager CRM proposée — confirme pour l'exécuter :`;
                  controller.enqueue(enc({ type: "delta", text: intro }));
                  assistantText += intro;
                  if (!ephemeral && conversationId) {
                    try {
                      await supabase.from("messages").insert({
                        conversation_id: conversationId,
                        user_id: user.id,
                        role: "assistant",
                        content: assistantText,
                        model,
                        meta: { voyager_action: { resource: decision.resource, method, id: decision.id, payload: decision.payload } },
                      });
                    } catch (e) { console.error("persist voyager proposal failed", e); }
                  }
                  controller.enqueue(enc({ type: "done" }));
                  controller.close();
                  return;
                }
              }
            } catch (e) {
              console.warn("voyager router skipped", e);
            }
          }

          // Run web tool detection + fetch (notify client of progress)
          const googleKeyForAgent = Deno.env.get("GOOGLE_API_KEY");
          // Reflexion mode: TRUE ReAct loop — model decides each step dynamically.
          // Bounded by token budget (low=3k, medium=12k, high=40k) with hard iter cap.
          const reflexionEnabled = reflexionMode === true && !!googleKeyForAgent;

          if (reflexionEnabled) {
            agenticUsed = true;
            controller.enqueue(enc({ type: "phase", phase: "analyzing" }));
            controller.enqueue(enc({ type: "phase", phase: "generating" }));

            const reactResult = await runReactLoop({
              googleKey: googleKeyForAgent!,
              userText: lastUserText,
              effort: (reflexionEffort ?? "medium") as "low" | "medium" | "high",
              linkupKey,
              memRows: allFetchedMemRows,
              callbacks: {
                onStepStart: (idx, kind, label, intent) => {
                  controller.enqueue(enc({
                    type: "agent_step", index: idx, kind, label, intent, status: "running",
                  }));
                },
                onStepDone: (idx, kind, label, intent, foundCount, failed, stepSources) => {
                  controller.enqueue(enc({
                    type: "agent_step", index: idx, kind, label, intent,
                    status: failed ? "failed" : "done",
                    ...(typeof foundCount === "number" ? { foundCount } : {}),
                    ...(stepSources && stepSources.length ? { stepSources } : {}),
                  }));
                },
                onThoughtChunk: (idx, text) => {
                  agenticNarration += text;
                  perStepNarration.set(idx, (perStepNarration.get(idx) ?? "") + text);
                  controller.enqueue(enc({ type: "agent_narration", index: idx, text }));
                },
                onThoughtDone: (idx) => {
                  controller.enqueue(enc({ type: "agent_narration", index: idx, done: true }));
                },
                onSources: (srcs) => {
                  controller.enqueue(enc({ type: "sources", sources: srcs }));
                },
              },
            });

            // Merge into outer state used by the final-answer phase.
            for (const s of reactResult.sources) {
              if (!agenticSources.find((x) => x.url === s.url)) agenticSources.push(s);
            }
            for (const im of reactResult.images) {
              if (!agenticImages.find((x) => x.url === im.url)) agenticImages.push(im);
            }
            for (const b of reactResult.contextBlocks) agenticContextBlocks.push(b);
            webSearchCount += reactResult.searchCount;
            for (const cs of reactResult.collectedSteps) collectedAgentSteps.push(cs);

            // Emit the full list of models used (orchestrator + main model).
            {
              const orchestratorModel = { provider: "google", model: "gemini-3.5-flash" };
              const answerModel = { provider, model };
              const seen = new Set<string>();
              const uniq: Array<{ provider: string; model: string }> = [];
              for (const m of [orchestratorModel, answerModel]) {
                if (!seen.has(m.model)) { seen.add(m.model); uniq.push(m); }
              }
              controller.enqueue(enc({ type: "models_used", models: uniq }));
            }

            if (agenticContextBlocks.length) {
              const flat = agenticContextBlocks.join("\n\n---\n\n").slice(0, 12000);
              webContext = {
                kind: "search",
                label: lastUserText.slice(0, 60),
                content: flat,
                sources: agenticSources,
                images: agenticImages,
              };
            }
          } else if (!webDisabled && !googleService && !voyagerService && linkupKey && lastUserText) {

            // Fast local pre-filter: skip the agentic plan API call for obviously
            // simple queries. The call costs ~300-600 ms; most short or conversational
            // messages will never trigger a multi-step plan anyway.
            // Reflexion mode disables this short-circuit — user requested it explicitly.
            const fastNoAgentic = reflexionEnabled ? false : (
              writingMode ||
              lastUserText.length < 80 ||
              /^(write|create|make|build|code|fix|debug|translate|convert|summarize|rewrite|check|review|format|correct|improve)/i.test(lastUserText.trim()) ||
              lastUserText.trim().endsWith("?")
            );

            if (!fastNoAgentic) {
              controller.enqueue(enc({ type: "phase", phase: "analyzing" }));
            }

            // Reflexion mode → richer plan (memory + search + scrape + analyze,
            // up to N steps based on effort). Otherwise → auto-detected agentic.
            let plan: AgenticPlan = reflexionEnabled
              ? await decideReflexionPlan({
                googleKey: googleKeyForAgent,
                userText: lastUserText,
                hasWebSearch: !!linkupKey,
                hasScrape: !!linkupKey,
                hasMemory: allFetchedMemRows.length > 0,
                maxSteps: reflexionMaxSteps,
              }).catch((e) => {
                console.error("decideReflexionPlan threw", e);
                return { complex: false, goal: "", steps: [] as AgenticStep[] };
              })
              : !fastNoAgentic
                ? await decideAgenticPlan({
                  googleKey: googleKeyForAgent,
                  userText: lastUserText,
                  hasWebSearch: !!linkupKey,
                  hasScrape: !!linkupKey,
                })
                : { complex: false, goal: "", steps: [] as AgenticStep[] };

            // Reflexion is user-opt-in: ALWAYS run a multi-step loop, even if
            // the orchestrator failed or returned nothing.
            if (reflexionEnabled && (!plan.complex || plan.steps.length < 2)) {
              console.warn("[reflexion] planner returned empty, using fallback plan");
              const fallbackSteps: AgenticStep[] = [
                { kind: "plan", intent: "outline the approach and what angles to explore" },
              ];
              if (linkupKey) {
                fallbackSteps.push({
                  kind: "search",
                  query: lastUserText.slice(0, 100),
                  intent: "gather relevant evidence from the web",
                });
              }
              if (allFetchedMemRows.length > 0) {
                fallbackSteps.push({
                  kind: "memory",
                  query: lastUserText.slice(0, 100),
                  intent: "recall relevant personal context",
                });
              }
              fallbackSteps.push({ kind: "challenge", intent: "question the assumptions in the evidence found" });
              fallbackSteps.push({ kind: "synthesize", intent: "weigh findings and form a clear conclusion" });
              plan = {
                complex: true,
                goal: lastUserText.slice(0, 120),
                steps: fallbackSteps.slice(0, reflexionMaxSteps),
              };
            }

            if (plan.complex && plan.steps.length >= 2 && googleKeyForAgent) {
              // ---------- AGENTIC LOOP ----------
              agenticUsed = true;
              controller.enqueue(enc({ type: "phase", phase: "generating" }));

              // For Reflexion: keep reasoning kinds at the end (they're meaningful, not redundant).
              // Only filter trailing plain "analyze" steps (which duplicate the final answer).
              const actionableSteps = plan.steps.filter((s, i, arr) => {
                if (s.kind !== "analyze") return true;
                return i !== arr.length - 1;
              });

              // Track observations accumulated across steps so reasoning steps
              // can reference earlier findings for genuine chain-of-thought.
              const stepObservations: string[] = [];

              const streamNarrationForStep = async (
                stepIdx: number,
                phase: "intro" | "between",
                opts: {
                  justDid?: { kind: "search" | "scrape" | "memory"; label: string; foundCount: number; intent: string };
                  currentStep?: AgenticStep;
                  nextStep?: AgenticStep;
                  isFinal?: boolean;
                  observations?: string[];
                },
              ) => {
                try {
                  for await (const chunk of streamAgenticNarration(googleKeyForAgent!, {
                    userLang: lastUserText,
                    userText: lastUserText,
                    goal: plan.goal,
                    phase,
                    justDid: opts.justDid,
                    currentStep: opts.currentStep,
                    nextStep: opts.nextStep,
                    isFinal: opts.isFinal,
                    observations: opts.observations,
                  })) {
                    agenticNarration += chunk;
                    perStepNarration.set(stepIdx, (perStepNarration.get(stepIdx) ?? "") + chunk);
                    controller.enqueue(enc({
                      type: "agent_narration",
                      index: stepIdx,
                      text: chunk,
                    }));
                  }
                  controller.enqueue(enc({
                    type: "agent_narration",
                    index: stepIdx,
                    done: true,
                  }));
                } catch (e) {
                  console.error("agentic narration failed", e);
                  controller.enqueue(enc({
                    type: "agent_narration",
                    index: stepIdx,
                    done: true,
                  }));
                }
              };

              const DATA_TOOL_KINDS = new Set(["search", "scrape", "memory"]);

              for (let i = 0; i < actionableSteps.length; i++) {
                const step = actionableSteps[i];
                const isLastAction = i === actionableSteps.length - 1;
                const nextStep = actionableSteps[i + 1];
                const isDataStep = DATA_TOOL_KINDS.has(step.kind);
                const isReasoningStep = REFLEXION_REASONING_KINDS.has(step.kind);

                // 1. Announce this step with a structured card.
                const stepLabel =
                  step.kind === "search" ? step.query :
                  step.kind === "scrape" ? step.url :
                  step.kind === "memory" ? step.query :
                  step.intent;
                controller.enqueue(enc({
                  type: "agent_step",
                  index: i,
                  kind: step.kind,
                  label: stepLabel,
                  intent: step.intent,
                  status: isDataStep ? "running" : "done",
                }));

                // 2. Run the actual tool (if any).
                let foundCount = 0;
                if (step.kind === "search") {
                  const res = await linkupSearch(linkupKey!, step.query);
                  if (res) {
                    webSearchCount += 1;
                    foundCount = res.sources.length;
                    for (const s of res.sources) {
                      if (!agenticSources.find((x) => x.url === s.url)) agenticSources.push(s);
                    }
                    for (const im of res.images) {
                      if (!agenticImages.find((x) => x.url === im.url)) agenticImages.push(im);
                    }
                    agenticContextBlocks.push(
                      `## Step ${i + 1} — Web search: "${step.query}"\nIntent: ${step.intent}\n\n${res.content}`,
                    );
                    stepObservations.push(`web search "${step.query}": found ${foundCount} sources covering ${step.intent}`);
                    controller.enqueue(enc({
                      type: "agent_step",
                      index: i,
                      kind: "search",
                      label: step.query,
                      intent: step.intent,
                      status: "done",
                      foundCount,
                    }));
                    controller.enqueue(enc({ type: "sources", sources: agenticSources }));
                  } else {
                    stepObservations.push(`web search "${step.query}": no results found`);
                    controller.enqueue(enc({
                      type: "agent_step",
                      index: i,
                      kind: "search",
                      label: step.query,
                      intent: step.intent,
                      status: "failed",
                    }));
                  }
                } else if (step.kind === "scrape") {
                  const md = await linkupFetch(linkupKey!, step.url);
                  if (md) {
                    foundCount = 1;
                    if (!agenticSources.find((x) => x.url === step.url)) {
                      agenticSources.push({ title: step.url, url: step.url });
                    }
                    agenticContextBlocks.push(
                      `## Step ${i + 1} — Page read: ${step.url}\nIntent: ${step.intent}\n\n${md}`,
                    );
                    stepObservations.push(`read page ${step.url}: content retrieved for ${step.intent}`);
                    controller.enqueue(enc({
                      type: "agent_step",
                      index: i,
                      kind: "scrape",
                      label: step.url,
                      intent: step.intent,
                      status: "done",
                      foundCount,
                    }));
                    controller.enqueue(enc({ type: "sources", sources: agenticSources }));
                  } else {
                    stepObservations.push(`read page ${step.url}: failed to retrieve`);
                    controller.enqueue(enc({
                      type: "agent_step",
                      index: i,
                      kind: "scrape",
                      label: step.url,
                      intent: step.intent,
                      status: "failed",
                    }));
                  }
                } else if (step.kind === "memory") {
                  const qKw = new Set(extractKeywords(step.query, 12));
                  type Scored = { content: string; kind: string; score: number };
                  const matches: Scored[] = [];
                  for (const m of allFetchedMemRows) {
                    const kws = (m.keywords && m.keywords.length) ? m.keywords : extractKeywords(m.content, 12);
                    const score = memoryRelevance(kws, qKw);
                    if (score > 0) matches.push({ content: m.content, kind: m.kind, score });
                  }
                  matches.sort((a, b) => b.score - a.score);
                  const top = matches.slice(0, 8);
                  foundCount = top.length;
                  if (top.length) {
                    agenticContextBlocks.push(
                      `## Step ${i + 1} — Memory recall: "${step.query}"\nIntent: ${step.intent}\n\n` +
                      top.map((m) => `- (${m.kind}) ${m.content}`).join("\n"),
                    );
                    stepObservations.push(`memory recall "${step.query}": found ${foundCount} relevant ${foundCount > 1 ? "memories" : "memory"}`);
                  } else {
                    stepObservations.push(`memory recall "${step.query}": no relevant memories`);
                  }
                  controller.enqueue(enc({
                    type: "agent_step",
                    index: i,
                    kind: "memory",
                    label: step.query,
                    intent: step.intent,
                    status: "done",
                    foundCount,
                  }));
                } else {
                  // Reasoning step (plan/hypothesis/challenge/compare/synthesize/analyze): no tool call.
                  // The narration will perform the actual reasoning for this step.
                  stepObservations.push(`${step.kind} step: ${step.intent}`);
                }

                // 3. Stream narration: for reasoning steps, this IS the content; for
                //    data steps, it's a transition narrating findings and what comes next.
                const narrationPhase: "intro" | "between" = i === 0 ? "intro" : "between";
                await streamNarrationForStep(i, narrationPhase, {
                  justDid: isDataStep ? {
                    kind: step.kind as "search" | "scrape" | "memory",
                    label: stepLabel,
                    foundCount,
                    intent: step.intent,
                  } : undefined,
                  currentStep: isReasoningStep ? step : undefined,
                  nextStep,
                  isFinal: isLastAction,
                  observations: stepObservations.slice(),
                });
              }

              // Collect finalized agent steps for persistence.
              for (let i = 0; i < actionableSteps.length; i++) {
                const s = actionableSteps[i];
                const label =
                  s.kind === "search" ? s.query :
                  s.kind === "scrape" ? s.url :
                  s.kind === "memory" ? s.query :
                  s.intent;
                collectedAgentSteps.push({
                  index: i,
                  kind: s.kind,
                  label,
                  intent: s.intent,
                  status: "done",
                  narration: perStepNarration.get(i),
                });
              }

              // Reflexion: emit the full list of models used (orchestrator + main model)
              // so the UI badge can show "Claude +1" with a dropdown listing both.
              if (reflexionEnabled) {
                const orchestratorModel = { provider: "google", model: "gemini-3.5-flash" };
                const answerModel = { provider, model };
                const seen = new Set<string>();
                const uniq: Array<{ provider: string; model: string }> = [];
                for (const m of [orchestratorModel, answerModel]) {
                  if (!seen.has(m.model)) {
                    seen.add(m.model);
                    uniq.push(m);
                  }
                }
                controller.enqueue(enc({ type: "models_used", models: uniq }));
              }

              // Synthesize all collected web context into a single system message
              // so the main model can write the final answer with everything.
              if (agenticContextBlocks.length) {
                const flat = agenticContextBlocks.join("\n\n---\n\n").slice(0, 12000);
                webContext = {
                  kind: "search",
                  label: plan.goal || lastUserText.slice(0, 60),
                  content: flat,
                  sources: agenticSources,
                  images: agenticImages,
                };
              }
            } else {
              // ---------- LEGACY single-shot web call ----------
              // Runs for both fastNoAgentic queries AND non-complex agentic plans.
              // decideWebTool is a fast (~300-600ms) single LLM call that returns
              // "search" / "scrape" / "none" — cheap enough to always check so that
              // questions like "qui a gagné hier ?" actually trigger a web search.
              const decision = await decideWebTool({
                googleKey: googleKeyForAgent,
                openaiKey: Deno.env.get("OPENAI_API_KEY"),
                anthropicKey: Deno.env.get("ANTHROPIC_API_KEY"),
                userText: lastUserText,
              });
              if (decision.action === "scrape" && linkupKey) {
                controller.enqueue(enc({ type: "tool", tool: "scrape", label: decision.url, status: "running" }));
                const md = await linkupFetch(linkupKey, decision.url);
                if (md) {
                  webContext = {
                    kind: "scrape",
                    label: decision.url,
                    content: md,
                    sources: [{ title: decision.url, url: decision.url }],
                  };
                  controller.enqueue(enc({ type: "tool", tool: "scrape", label: decision.url, status: "done" }));
                  controller.enqueue(enc({ type: "sources", sources: webContext.sources }));
                  collectedAgentSteps.push({ index: 0, kind: "scrape", label: decision.url, intent: decision.url, status: "done", foundCount: 1 });
                } else {
                  webContext = {
                    kind: "scrape",
                    label: decision.url,
                    content: `The page at ${decision.url} could not be fetched (the site blocked the request, requires authentication, or returned no readable content). Tell the user the page could not be retrieved and suggest they paste the relevant content or try another URL. Do NOT claim you lack internet access — you do have web fetching capability, this specific URL just failed.`,
                    sources: [{ title: decision.url, url: decision.url }],
                  };
                  controller.enqueue(enc({ type: "tool", tool: "scrape", label: decision.url, status: "failed" }));
                  collectedAgentSteps.push({ index: 0, kind: "scrape", label: decision.url, intent: decision.url, status: "failed" });
                }
              } else if (decision.action === "search" && linkupKey) {
                controller.enqueue(enc({ type: "tool", tool: "search", label: decision.query, status: "running" }));
                const res = await linkupSearch(linkupKey, decision.query);
                if (res) {
                  webSearchCount += 1;
                  webContext = {
                    kind: "search",
                    label: decision.query,
                    content: res.content,
                    sources: res.sources,
                    images: res.images,
                  };
                  controller.enqueue(enc({ type: "tool", tool: "search", label: decision.query, status: "done" }));
                  controller.enqueue(enc({ type: "sources", sources: res.sources }));
                  collectedAgentSteps.push({ index: 0, kind: "search", label: decision.query, intent: decision.query, status: "done", foundCount: res.sources.length });
                } else {
                  controller.enqueue(enc({ type: "tool", tool: "search", label: decision.query, status: "failed" }));
                  collectedAgentSteps.push({ index: 0, kind: "search", label: decision.query, intent: decision.query, status: "failed" });
                }
              }
              controller.enqueue(enc({ type: "phase", phase: "generating" }));
            }
          }


          let messagesForLLM = finalMessages;
          if (webContext) {
            const header = webContext.kind === "scrape"
              ? `Content of the requested web page (${webContext.label}). Use it as the primary source.`
              : `Web search results for "${webContext.label}". Use these sources to answer.`;
            const citationRule = webContext.sources && webContext.sources.length
              ? `\n\nCITATION RULES — IMPORTANT:\n` +
                `- The sources are numbered 1..${webContext.sources.length} (matching the "Source N:" blocks below).\n` +
                `- Whenever you state a fact taken from the sources, append an inline citation marker in the form [source:N] (or [source:N,M] for multiple) RIGHT AFTER the relevant sentence or claim.\n` +
                `- Do NOT invent source numbers. Only cite numbers that exist (1..${webContext.sources.length}).\n` +
                `- Do NOT add a "Sources" list at the end — markers alone are enough; the UI renders them.\n` +
                `- Place markers naturally in the flow, e.g. "Paris is the capital of France [source:1]."`
              : "";
            const imagesBlock = webContext.images && webContext.images.length
              ? `\n\nAVAILABLE IMAGES (from the web search) — use them WHEN VISUALLY RELEVANT:\n` +
                webContext.images.map((im, i) => `${i + 1}. ${im.url}${im.title ? ` — ${im.title}` : ""}`).join("\n") +
                `\n\nIMAGE RULES:\n` +
                `- If — and only if — an image meaningfully illustrates the topic (a person, place, product, artwork, diagram, event, etc.), embed it inline with standard Markdown: ![short alt](https://exact-url).\n` +
                `- Use ONLY URLs from the list above, copied EXACTLY. Never invent or modify image URLs.\n` +
                `- Maximum 2–3 images per answer. Place each image near the paragraph it illustrates.\n` +
                `- For purely conversational, code, math, or abstract answers: do NOT include any image.\n` +
                `- Never wrap the image in a link, never add a caption line — the alt text is enough.`
              : "";
            const webSystem: Msg = {
              role: "system",
              content: `${header}${citationRule}${imagesBlock}\n\n${webContext.content}`,
            };
            messagesForLLM = [webSystem, ...finalMessages];
          }

          // When the agentic loop ran, tell the main model what was done so it can
          // write a final answer that builds on the reasoning steps already shown.
          if (agenticUsed && agenticNarration.trim()) {
            const isReflexionFinal = reflexionEnabled;
            const agentSystem: Msg = {
              role: "system",
              content: isReflexionFinal
                ? `REFLEXION MODE — FINAL SYNTHESIS:\n` +
                  `You have just completed a multi-step reasoning process. The steps (plan, hypothesis, ` +
                  `evidence gathering, challenge, comparison, synthesis) have already been shown to the user ` +
                  `as visible reasoning cards. The web/memory context above is the evidence gathered.\n\n` +
                  `Your final answer MUST:\n` +
                  `1. Deliver a clear, well-reasoned conclusion — not just a summary of steps.\n` +
                  `2. Acknowledge tensions or competing perspectives that came up during reasoning.\n` +
                  `3. State your confidence level where relevant ("the evidence strongly suggests...", "it's less clear whether...").\n` +
                  `4. Be substantive: ${responseLength === "short" ? "150-250" : responseLength === "comprehensive" ? "400-700" : "250-400"} words.\n` +
                  `5. NOT say "I searched...", "I found...", "In step 3..." — the user already saw those cards.\n` +
                  `6. Start directly with the answer. No intro like "Based on my research..."\n` +
                  `7. Use [source:N] markers when citing web results.\n\n` +
                  `User's original question: ${lastUserText.slice(0, 400)}`
                : `IMPORTANT — AGENTIC CONTEXT:\n` +
                  `Before this turn, a narration has ALREADY been streamed describing the research process ` +
                  `step-by-step. The web context above is the result of that research.\n\n` +
                  `RULES:\n` +
                  `- Do NOT repeat the narration or describe your process ("I searched...", "I found...", "Now let me...").\n` +
                  `- Start directly with the substantive answer. No "## Answer" heading.\n` +
                  `- Use the web context and cite with [source:N] markers.\n` +
                  `- Be CONCISE (target ≤ 300 words). Lead with the answer.\n\n` +
                  `User's original goal: ${lastUserText.slice(0, 300)}`,
            };
            messagesForLLM = [agentSystem, ...messagesForLLM];
          }

          // ---------- Emit a META event so the client can show what was actually sent ----------
          // Estimate tokens with a cheap heuristic (~4 chars per token).
          const approxTokens = (s: string) => Math.ceil((s?.length ?? 0) / 4);
          const labelSystem = (c: string, i: number): { label: string; description: string } => {
            if (c.startsWith("Style:"))
              return {
                label: "Style & format rules",
                description:
                  "Tells the model how to format its reply (markdown, length target, when to emit ```flow / ```chart / ```map blocks, language matching).",
              };
            if (c.startsWith("WRITING CANVAS MODE"))
              return {
                label: "Writing canvas mode",
                description:
                  "Active when the user is drafting a document. Forces the strict CANVAS_EDIT: yes/no protocol and includes the previous canvas if any.",
              };
            if (c.startsWith("USER PROFILE") || c.startsWith("Additional relevant context"))
              return {
                label: "User profile & memory",
                description:
                  "Authoritative facts about the user (name, role, preferences) plus relevant memory snippets filtered by the current message keywords.",
              };
            if (c.startsWith("VOYAGER CRM RULES"))
              return {
                label: "Voyager CRM guardrail",
                description:
                  "Hard rule preventing the model from pretending it executed CRM writes. Server handles reads; writes require a user-confirmed card.",
              };
            if (c.startsWith("[Google "))
              return {
                label: "Google action result",
                description:
                  "Result of a Google read action (Gmail/Calendar/Drive) executed server-side, injected so the model can summarize it naturally.",
              };
            if (c.startsWith("[Voyager CRM "))
              return {
                label: "Voyager CRM result",
                description:
                  "Result of a Voyager CRM GET executed server-side, or an error message if the call failed.",
              };
            if (c.startsWith("Content of the requested web page"))
              return {
                label: "Web page content (scrape)",
                description:
                  "Full text of the page the user (or the agent) asked to scrape, plus citation rules so the model uses [source:N] markers.",
              };
            if (c.startsWith("Web search results"))
              return {
                label: "Web search results",
                description:
                  "Top web search results (titles + snippets + URLs) gathered by the agent, with citation rules and optional embeddable images.",
              };
            if (c.startsWith("IMPORTANT — AGENTIC CONTEXT"))
              return {
                label: "Agent finalization brief",
                description:
                  "Added at the end of an agentic loop. Tells the main model that narration was already streamed — write only the final answer, cite sources, stay concise.",
              };
            return {
              label: `System #${i + 1}`,
              description: "Unrecognized system message — contains the model's core identity / behavior rules.",
            };
          };
          const metaSystems = messagesForLLM
            .filter((m) => m.role === "system")
            .map((m, i) => {
              const c = m.content ?? "";
              const { label, description } = labelSystem(c, i);
              return { label, description, content: c, approxTokens: approxTokens(c) };
            });
          const metaHistory = messagesForLLM
            .filter((m) => m.role !== "system")
            .map((m) => ({
              role: m.role,
              content: m.content ?? "",
              approxTokens: approxTokens(m.content ?? ""),
              attachments: (m.attachments ?? []).map((a) => ({
                kind: a.kind,
                name: a.name,
                mime: a.mime,
              })),
            }));
          const metaTotalTokens = [...metaSystems, ...metaHistory]
            .reduce((s, x) => s + (x.approxTokens ?? 0), 0);
          const metaPayload = {
            provider,
            model,
            systems: metaSystems,
            history: metaHistory,
            memoryKeywords: Array.from(queryKeywords),
            memoryMatches: scored.slice(0, MEMORY_MAX_ITEMS).map((m) => ({
              kind: m.kind,
              content: m.content,
              score: Math.round(m.score * 100) / 100,
            })),
            webContext: webContext
              ? { kind: webContext.kind, label: webContext.label, approxTokens: approxTokens(webContext.content) }
              : null,
            approxTotalInputTokens: metaTotalTokens,
            sources: webContext?.sources ?? [],
            ...(collectedAgentSteps.length ? { agent_steps: collectedAgentSteps } : {}),
            ...(collectedThinkingSteps.length ? { thinking_steps: collectedThinkingSteps } : {}),
          };
          controller.enqueue(enc({ type: "meta", ...metaPayload }));

          // ---------- Visible "thinking" preamble for advanced models ----------
          // Streams 3-5 short reasoning steps (Claude-style) BEFORE the main model
          // starts answering. Uses Gemini Flash as a cheap, fast planner.
          //
          // Skip this preamble entirely for basic queries — short messages, greetings,
          // and simple Q&A don't benefit from a visible reasoning chain, and it costs
          // ~700-1400 ms of latency before the actual answer can start streaming.
          const googleKeyForPlanner = Deno.env.get("GOOGLE_API_KEY");
          const isBasicQuery =
            lastUserText.length < 300 ||
            /^(hi|hello|hey|bonjour|salut|coucou|yo|cc|hola|merci|thanks|thank you|ok|sure|yes|no|oui|non|kthx|nope|yep|yup)\b/i.test(lastUserText.trim()) ||
            /^(what|what's|who|who's|when|where|which|tell me|give me|show me|define|list|name|c'est quoi|qu'est-ce|qui est|quand|où|donne[ -]moi|montre[ -]moi|liste|nomme|comment dire|how (?:do|to) say|translate|traduis|résume|summarize)\b/i.test(lastUserText.trim());
          const shouldThink = isAdvancedModel(model) && !!googleKeyForPlanner && !!lastUserText && !writingMode && !agenticUsed && !isBasicQuery;

          // Pick the main LLM iterator NOW so we can kick off the network request in
          // parallel with the thinking preamble below. Async generators don't start
          // their body until iterated, so we trigger the first .next() right away —
          // that fires the HTTP request to the LLM. While the thinking preamble streams
          // its steps, the main model is already producing its first tokens in the
          // background, so by the time we start draining the main iterator we usually
          // have tokens immediately available (saves ~500-1500 ms of LLM TTFT).
          let iter: AsyncGenerator<string, Usage | undefined>;
          if (provider === "openai") iter = streamOpenAI(apiKey, model, messagesForLLM);
          else if (provider === "anthropic") iter = streamAnthropic(apiKey, model, messagesForLLM);
          else if (provider === "mistral") iter = streamMistral(apiKey, model, messagesForLLM);
          else iter = streamGemini(apiKey, model, messagesForLLM);
          const firstNextPromise = iter.next();

          if (shouldThink) {
            const thinkingStartedAt = Date.now();
            try {
              const ctxHints: string[] = [];
              if (webContext) {
                ctxHints.push(
                  webContext.kind === "scrape"
                    ? `A web page was fetched: ${webContext.label}. The model will read its content.`
                    : `A web search was run: "${webContext.label}". The model will read the results.`,
                );
              }
              const attCount = lastUserMsg?.attachments?.length ?? 0;
              if (attCount > 0) ctxHints.push(`${attCount} attachment(s) were sent with the message.`);

              let buf = "";
              let stepIndex = 0;
              const flushCompleteLines = (force = false) => {
                // Split on newlines; keep the trailing partial in buf unless force.
                const parts = buf.split(/\r?\n/);
                const tail = force ? "" : (parts.pop() ?? "");
                for (const raw of parts) {
                  const line = raw.trim();
                  if (!line) continue;
                  // Accept "- step", "* step", "1. step", "1) step" — strip the marker.
                  const m = line.match(/^(?:[-*•]|\d+[.)])\s+(.+)$/);
                  const text = (m ? m[1] : line).trim();
                  if (!text) continue;
                  stepIndex += 1;
                  collectedThinkingSteps.push({ index: stepIndex, text });
                  controller.enqueue(enc({ type: "thinking", action: "step", index: stepIndex, text }));
                }
                buf = tail;
              };

              for await (const chunk of streamPlannerSteps(googleKeyForPlanner!, lastUserText, ctxHints.join(" "))) {
                buf += chunk;
                flushCompleteLines(false);
              }
              flushCompleteLines(true);
              controller.enqueue(enc({
                type: "thinking",
                action: "done",
                durationMs: Date.now() - thinkingStartedAt,
              }));
            } catch (e) {
              console.error("planner thinking failed", e);
              // Non-fatal — just continue to the main model without the preamble.
              controller.enqueue(enc({
                type: "thinking",
                action: "done",
                durationMs: Date.now() - thinkingStartedAt,
              }));
            }
          }

          // Drain the main iterator, starting with the token we already requested
          // before/during the thinking phase.
          let usage: Usage | undefined;
          let next = await firstNextPromise;
          while (true) {
            if (next.done) {
              usage = next.value;
              break;
            }
            const chunk = next.value;
            assistantText += chunk;
            controller.enqueue(enc({ type: "delta", text: chunk }));
            next = await iter.next();
          }

          // Persist assistant message (skip entirely in ephemeral/branch mode)
          // Re-inject agent_steps and thinking_steps now that all phases are done,
          // since metaPayload was constructed before the thinking/streaming phases.
          if (collectedAgentSteps.length) {
            (metaPayload as any).agent_steps = collectedAgentSteps;
          }
          if (collectedThinkingSteps.length) {
            (metaPayload as any).thinking_steps = collectedThinkingSteps;
          }

          // ---------- Compute cost up-front so it can be included in the insert ----------
          let inputCost = 0;
          let outputCost = 0;
          // Passthrough Linkup cost: $0.006 × successful searches (standard depth).
          // Pre-scaled so the downstream markup brings it to WEB_SEARCH_MULTIPLIER
          // regardless of the model used (cheap models would otherwise inflate it).
          const rawWebSearchCost = webSearchCount * LINKUP_SEARCH_COST_USD;
          const modelMult = modelBillingMultiplier(model);
          const webSearchCostBilled = modelMult > 0
            ? rawWebSearchCost * (WEB_SEARCH_MULTIPLIER / modelMult)
            : rawWebSearchCost;
          if (usage && (usage.input_tokens > 0 || usage.output_tokens > 0)) {
            const price = priceFor(model);
            inputCost = (usage.input_tokens / 1_000_000) * price.input;
            outputCost = (usage.output_tokens / 1_000_000) * price.output;
            controller.enqueue(enc({
              type: "usage",
              input_tokens: usage.input_tokens,
              output_tokens: usage.output_tokens,
              input_cost_usd: inputCost,
              output_cost_usd: outputCost,
              web_search_count: webSearchCount,
              web_search_cost_usd: rawWebSearchCost,
              cost_usd: inputCost + outputCost + webSearchCostBilled,
            }));
            (metaPayload as any).cost = {
              inputTokens: usage.input_tokens,
              outputTokens: usage.output_tokens,
              inputCostUsd: inputCost,
              outputCostUsd: outputCost,
              webSearchCount,
              webSearchCostUsd: rawWebSearchCost,
            };
          } else if (!ephemeral) {
            console.warn("[usage] skipped — no usage data returned by provider");
          }


          // ---------- Emit `done` IMMEDIATELY ----------
          // Everything below (DB writes + memory extraction) runs AFTER the
          // client has received `done` via EdgeRuntime.waitUntil. This saves
          // 1–3 seconds of perceived latency on every turn (previously the
          // stream was held open while we did 4–5 sequential DB ops + memory).
          controller.enqueue(enc({ type: "done" }));
          controller.close();

          const lastUser = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";

          const persistTail = async () => {
            let insertedMsgId: string | null = null;
            if (!ephemeral) {
              try {
                const { data } = await supabase
                  .from("messages")
                  .insert({
                    conversation_id: conversationId,
                    user_id: user.id,
                    role: "assistant",
                    content: assistantText,
                    model,
                    meta: metaPayload,
                  })
                  .select("id")
                  .single();
                insertedMsgId = data?.id ?? null;
              } catch (e) {
                console.error("persist assistant message failed", e);
              }

              // Fire conv update + usage event in parallel.
              await Promise.all([
                supabase
                  .from("conversations")
                  .update({ updated_at: new Date().toISOString() })
                  .eq("id", conversationId)
                  .then(({ error }) => { if (error) console.error("conv update failed", error); }),
                (usage && (usage.input_tokens > 0 || usage.output_tokens > 0)) || webSearchCount > 0
                  ? supabase.from("usage_events").insert({
                      user_id: user.id,
                      conversation_id: conversationId,
                      message_id: insertedMsgId,
                      provider,
                      model,
                      input_tokens: usage?.input_tokens ?? 0,
                      output_tokens: usage?.output_tokens ?? 0,
                      input_cost_usd: inputCost,
                      output_cost_usd: outputCost,
                      // total_cost_usd includes the pre-scaled Linkup cost so the
                      // pipeline (modelMult × FX) lands web search at WEB_SEARCH_MULTIPLIER.
                      total_cost_usd: inputCost + outputCost + webSearchCostBilled,
                    }).then(({ error }) => { if (error) console.error("[usage] insert error:", error); })
                  : Promise.resolve(),
              ]);
            }

            // ---------- Extract memorable facts ----------
            if (!ephemeral && !isFreeUser) {
              if (memoryMode === "smart") {
                try {
                  const fnUrl = `${supabaseUrl}/functions/v1/memory-extract-smart`;
                  await fetch(fnUrl, {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/json",
                      Authorization: authHeader,
                      apikey: anonKey,
                    },
                    body: JSON.stringify({ userText: lastUser, assistantText }),
                  });
                } catch (err) {
                  console.error("smart memory dispatch failed:", err);
                }
              } else {
                try {
                  await extractAndSaveMemory({
                    supabase,
                    userId: user.id,
                    openaiKey: Deno.env.get("OPENAI_API_KEY"),
                    googleKey: Deno.env.get("GOOGLE_API_KEY"),
                    anthropicKey: Deno.env.get("ANTHROPIC_API_KEY"),
                    userText: lastUser,
                    assistantText,
                  });
                } catch (err) {
                  console.error("memory extract failed:", err);
                }
              }
            }
          };

          // Run persistence after the response has been delivered to the client.
          // EdgeRuntime.waitUntil keeps the worker alive without blocking the
          // response. Falls back to a void promise locally where it's undefined.
          try {
            // @ts-ignore — EdgeRuntime is provided by the Supabase Edge runtime
            if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
              // @ts-ignore
              EdgeRuntime.waitUntil(persistTail().catch((e) => console.error("persistTail failed", e)));
            } else {
              void persistTail().catch((e) => console.error("persistTail failed", e));
            }
          } catch (e) {
            console.error("scheduling persistTail failed", e);
          }

        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          controller.enqueue(enc({ type: "error", error: msg }));
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        ...corsHeaders,
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
