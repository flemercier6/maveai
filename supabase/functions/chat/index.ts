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
  "gpt-5.4": { input: 2.5, output: 10 },
  "gpt-4o": { input: 2.5, output: 10 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  // Anthropic
  "claude-opus-4-7": { input: 15, output: 75 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-3-5-haiku-latest": { input: 0.8, output: 4 },
  // Google
  "gemini-2.5-pro": { input: 1.25, output: 10 },
  "gemini-2.5-flash": { input: 0.3, output: 2.5 },
  "gemini-2.5-flash-lite": { input: 0.1, output: 0.4 },
};
function priceFor(model: string): Price {
  if (MODEL_PRICES[model]) return MODEL_PRICES[model];
  // Fuzzy fallbacks for variants/aliases
  const m = model.toLowerCase();
  if (m.includes("opus")) return MODEL_PRICES["claude-opus-4-7"];
  if (m.includes("sonnet")) return MODEL_PRICES["claude-sonnet-4-6"];
  if (m.includes("haiku")) return MODEL_PRICES["claude-3-5-haiku-latest"];
  if (m.includes("flash-lite")) return MODEL_PRICES["gemini-2.5-flash-lite"];
  if (m.includes("flash")) return MODEL_PRICES["gemini-2.5-flash"];
  if (m.includes("gemini")) return MODEL_PRICES["gemini-2.5-pro"];
  if (m.includes("mini")) return MODEL_PRICES["gpt-4o-mini"];
  if (m.includes("gpt")) return MODEL_PRICES["gpt-5.4"];
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
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      stream: true,
      system: system || undefined,
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

// ---------- Web tools (Firecrawl) ----------
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

async function firecrawlScrape(apiKey: string, url: string): Promise<string | null> {
  try {
    const r = await fetch("https://api.firecrawl.dev/v2/scrape", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url,
        formats: ["markdown"],
        onlyMainContent: true,
      }),
    });
    const j = await r.json();
    if (!r.ok) {
      console.error("firecrawl scrape error", r.status, j);
      return null;
    }
    const md: string | undefined = j?.data?.markdown ?? j?.markdown;
    if (!md) return null;
    return md.slice(0, 15000);
  } catch (e) {
    console.error("firecrawl scrape exception", e);
    return null;
  }
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
    const top = textResults.slice(0, 8);
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
      const content = (res.content ?? res.snippet ?? res.description ?? "").toString().slice(0, 2000);
      return `### Source ${i + 1}: ${title}\nURL: ${url}\n\n${content}`;
    });
    return {
      content: blocks.join("\n\n---\n\n").slice(0, 15000),
      sources,
      images,
    };
  } catch (e) {
    console.error("linkup search exception", e);
    return null;
  }
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
}): Promise<ClarifyQuestion[] | null> {
  const { userText, hasHistory } = args;
  if (!userText.trim() || userText.trim().length < 12) return null;

  const prompt = `You are a clarification assistant. Decide whether the user's request below is COMPLEX or AMBIGUOUS enough that asking 1–3 short multiple-choice questions BEFORE answering would meaningfully improve the answer.

Reply STRICTLY in JSON, no surrounding text.

If clarification is NOT useful (simple/clear factual or chit-chat request, code request with enough info, translation, summary of provided text, follow-up that already has context, etc.):
{"needs_clarification": false}

If clarification IS useful:
{
  "needs_clarification": true,
  "questions": [
    {
      "header": "<2-3 word tag, e.g. 'Audience', 'Tone', 'Scope'>",
      "question": "<one clear question ending with '?'>",
      "multi": false,
      "options": [
        {"label": "<short option, 1-5 words>"},
        {"label": "..."},
        {"label": "..."}
      ]
    }
  ]
}

STRICT RULES:
- Maximum 3 questions, only ask what's truly needed.
- 2–4 options per question. Keep options VERY short — ideally 1–3 words, max 24 characters. They render as inline pills, so long sentences break the layout. Make them distinct and mutually exclusive (unless multi=true).
- Do NOT add an "Other" option — the UI handles that automatically.
- Use the SAME LANGUAGE as the user's message.
- Only return needs_clarification=true for genuinely complex/ambiguous requests (planning, creative briefs, multi-step builds, vague analysis requests, design choices, strategy, recommendations with many trade-offs, etc.).
- Conversation already has prior turns: ${hasHistory ? "yes" : "no"}. If yes, only clarify if the new turn opens a NEW complex topic.

User message:
${userText.slice(0, 2000)}`;

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
      return null;
    }
  } catch (e) {
    console.error("decideClarify failed", e);
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
          model: "gpt-4o-mini",
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
    const { data: userData, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const user = { id: userData.user.id };

    const { conversationId, provider, model, messages, skipClarify, writingMode, previousCanvas, forceCanvas } = await req.json() as {
      conversationId: string;
      provider: "openai" | "anthropic" | "google";
      model: string;
      messages: Msg[];
      skipClarify?: boolean;
      writingMode?: boolean;
      previousCanvas?: string | null;
      forceCanvas?: boolean;
    };

    if (!conversationId || !provider || !model || !Array.isArray(messages)) {
      return new Response(JSON.stringify({ error: "Invalid payload" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ---------- Load & inject user memory ----------
    // Two tiers:
    //  1) PROFILE (identity + preference): ALWAYS injected. These are core facts
    //     about the user (name, job, response preferences, etc.) that must
    //     influence every reply — e.g. signing an email with the real name
    //     instead of "[Your name]".
    //  2) CONTEXTUAL (project/context/fact): injected ONLY when keyword-relevant
    //     to the current user message — saves tokens.
    const lastUserMsg = [...(messages as Msg[])].reverse().find((m) => m.role === "user");
    const queryKeywords = new Set(extractKeywords(lastUserMsg?.content ?? "", 20));

    const { data: memRows } = await supabase
      .from("user_memories")
      .select("id,content,kind,keywords")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(100);

    const PROFILE_KINDS = new Set(["identity", "preference"]);
    const profileMems: { content: string; kind: string }[] = [];
    type ScoredMem = { content: string; kind: string; score: number };
    const scored: ScoredMem[] = [];

    for (const m of (memRows ?? []) as Array<{ content: string; kind: string; keywords: string[] | null }>) {
      if (PROFILE_KINDS.has(m.kind)) {
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
    const styleSystem: Msg = {
      role: "system",
      content:
        "Style: airy markdown — short paragraphs, headings, bullets, dividers. Use tables for comparisons. Emojis sparingly. Reply in the user's language.\n" +
        "Diagrams: when a flow/architecture/decision diagram clarifies the answer, output a fenced ```flow block containing JSON: " +
        "{ title?, direction?: 'TB'|'LR'|'RL'|'BT', nodes: [{id,label,kind?: 'default'|'input'|'output'|'decision'|'success'|'warning'|'danger'|'muted'}], edges: [{source,target,label?,animated?,dashed?}] }. " +
        "Short slug ids, ≤6-word labels, no positions, 4–12 nodes. Not Mermaid.",
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
            ? "The user EXPLICITLY invoked the /write command. You MUST produce a canvas document. CANVAS_EDIT: yes is mandatory. Do NOT output CANVAS_EDIT: no under any circumstance. Even for very short requests (e.g. \"hello\", \"test\"), write a minimal but real document matching the request.\n"
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

    // Prepend system messages (style + memory) and drop any previous duplicates from the client.
    const baseSystems: Msg[] = [
      ...(writingMode ? [] : [styleSystem]),
      ...(writingSystem ? [writingSystem] : []),
      ...(memorySystem ? [memorySystem] : []),
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
    const lastUserText = lastUserMsg?.content ?? "";
    const firecrawlKey = Deno.env.get("FIRECRAWL_API_KEY");
    const linkupKey = Deno.env.get("LINKUP_API_KEY");
    let webContext:
      | { kind: "scrape" | "search"; label: string; content: string; sources?: WebSource[]; images?: WebImage[] }
      | null = null;

    const stream = new ReadableStream({
      async start(controller) {
        try {
          // ---------- Auto-generate title on the FIRST user message of the conversation ----------
          // Done early so the sidebar gets a real title even if clarify intercepts the stream.
          const firstUserMessage = messages.filter((m) => m.role === "user").length <= 1;
          if (firstUserMessage && lastUserText) {
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

          // ---------- Clarifying questions (asked BEFORE running anything else) ----------
          if (!skipClarify && lastUserText) {
            const userTurns = messages.filter((m) => m.role === "user").length;
            controller.enqueue(enc({ type: "phase", phase: "analyzing" }));
            const clarify = await decideClarify({
              googleKey: Deno.env.get("GOOGLE_API_KEY"),
              openaiKey: Deno.env.get("OPENAI_API_KEY"),
              anthropicKey: Deno.env.get("ANTHROPIC_API_KEY"),
              userText: lastUserText,
              hasHistory: userTurns > 1,
            });
            if (clarify && clarify.length) {
              controller.enqueue(enc({ type: "clarify", questions: clarify }));
              // Give the title generation a moment to land before closing.
              await new Promise((r) => setTimeout(r, 1200));
              controller.enqueue(enc({ type: "done" }));
              controller.close();
              return;
            }
          }

          // Run web tool detection + fetch (notify client of progress)
          if ((firecrawlKey || linkupKey) && lastUserText) {
            controller.enqueue(enc({ type: "phase", phase: "analyzing" }));
            const decision = await decideWebTool({
              googleKey: Deno.env.get("GOOGLE_API_KEY"),
              openaiKey: Deno.env.get("OPENAI_API_KEY"),
              anthropicKey: Deno.env.get("ANTHROPIC_API_KEY"),
              userText: lastUserText,
            });
            if (decision.action === "scrape" && firecrawlKey) {
              controller.enqueue(enc({ type: "tool", tool: "scrape", label: decision.url, status: "running" }));
              const md = await firecrawlScrape(firecrawlKey, decision.url);
              if (md) {
                webContext = {
                  kind: "scrape",
                  label: decision.url,
                  content: md,
                  sources: [{ title: decision.url, url: decision.url }],
                };
                controller.enqueue(enc({ type: "tool", tool: "scrape", label: decision.url, status: "done" }));
                controller.enqueue(enc({ type: "sources", sources: webContext.sources }));
              } else {
                controller.enqueue(enc({ type: "tool", tool: "scrape", label: decision.url, status: "failed" }));
              }
            } else if (decision.action === "search" && linkupKey) {
              controller.enqueue(enc({ type: "tool", tool: "search", label: decision.query, status: "running" }));
              const res = await linkupSearch(linkupKey, decision.query);
              if (res) {
                webContext = {
                  kind: "search",
                  label: decision.query,
                  content: res.content,
                  sources: res.sources,
                  images: res.images,
                };
                controller.enqueue(enc({ type: "tool", tool: "search", label: decision.query, status: "done" }));
                controller.enqueue(enc({ type: "sources", sources: res.sources }));
              } else {
                controller.enqueue(enc({ type: "tool", tool: "search", label: decision.query, status: "failed" }));
              }
            }
            controller.enqueue(enc({ type: "phase", phase: "generating" }));
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

          // ---------- Emit a META event so the client can show what was actually sent ----------
          // Estimate tokens with a cheap heuristic (~4 chars per token).
          const approxTokens = (s: string) => Math.ceil((s?.length ?? 0) / 4);
          const metaSystems = messagesForLLM
            .filter((m) => m.role === "system")
            .map((m, i) => {
              const c = m.content ?? "";
              let label = `System #${i + 1}`;
              if (c.startsWith("Style:")) label = "Style & format";
              else if (c.startsWith("Relevant user memory")) label = "User memory (filtered)";
              else if (c.startsWith("Content of the requested web page")) label = "Web page content";
              else if (c.startsWith("Web search results")) label = "Web search results";
              return { label, content: c, approxTokens: approxTokens(c) };
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
          controller.enqueue(enc({
            type: "meta",
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
          }));

          let iter: AsyncGenerator<string, Usage | undefined>;
          if (provider === "openai") iter = streamOpenAI(apiKey, model, messagesForLLM);
          else if (provider === "anthropic") iter = streamAnthropic(apiKey, model, messagesForLLM);
          else iter = streamGemini(apiKey, model, messagesForLLM);

          let usage: Usage | undefined;
          while (true) {
            const next = await iter.next();
            if (next.done) {
              usage = next.value;
              break;
            }
            const chunk = next.value;
            assistantText += chunk;
            controller.enqueue(enc({ type: "delta", text: chunk }));
          }

          // Persist assistant message
          const { data: insertedMsg } = await supabase
            .from("messages")
            .insert({
              conversation_id: conversationId,
              user_id: user.id,
              role: "assistant",
              content: assistantText,
              model,
            })
            .select("id")
            .single();
          await supabase
            .from("conversations")
            .update({ updated_at: new Date().toISOString() })
            .eq("id", conversationId);

          // ---------- Persist usage event with computed cost ----------
          console.log("[usage] provider=", provider, "model=", model, "usage=", JSON.stringify(usage));
          if (usage && (usage.input_tokens > 0 || usage.output_tokens > 0)) {
            const price = priceFor(model);
            const inputCost = (usage.input_tokens / 1_000_000) * price.input;
            const outputCost = (usage.output_tokens / 1_000_000) * price.output;
            const { error: usageErr } = await supabase.from("usage_events").insert({
              user_id: user.id,
              conversation_id: conversationId,
              message_id: insertedMsg?.id ?? null,
              provider,
              model,
              input_tokens: usage.input_tokens,
              output_tokens: usage.output_tokens,
              input_cost_usd: inputCost,
              output_cost_usd: outputCost,
              total_cost_usd: inputCost + outputCost,
            });
            if (usageErr) console.error("[usage] insert error:", usageErr);
            else console.log("[usage] inserted ok");
            controller.enqueue(enc({
              type: "usage",
              input_tokens: usage.input_tokens,
              output_tokens: usage.output_tokens,
              input_cost_usd: inputCost,
              output_cost_usd: outputCost,
              cost_usd: inputCost + outputCost,
            }));
          } else {
            console.warn("[usage] skipped — no usage data returned by provider");
          }

          // (Title generation moved to the start of the stream so it runs even on early returns.)
          const lastUser = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";

          // ---------- Extract memorable facts (await so we can notify the client) ----------
          try {
            const memResult = await extractAndSaveMemory({
              supabase,
              userId: user.id,
              openaiKey: Deno.env.get("OPENAI_API_KEY"),
              googleKey: Deno.env.get("GOOGLE_API_KEY"),
              anthropicKey: Deno.env.get("ANTHROPIC_API_KEY"),
              userText: lastUser,
              assistantText,
            });
            if (memResult && (memResult.added > 0 || memResult.updated > 0)) {
              controller.enqueue(enc({ type: "memory", added: memResult.added, updated: memResult.updated }));
            }
          } catch (err) {
            console.error("memory extract failed:", err);
          }

          controller.enqueue(enc({ type: "done" }));
          controller.close();
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
