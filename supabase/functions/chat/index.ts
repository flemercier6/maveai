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
async function* streamOpenAI(apiKey: string, model: string, messages: Msg[]) {
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
    body: JSON.stringify({ model, messages: oaiMessages, stream: true }),
  });
  if (!r.ok || !r.body) {
    const t = await r.text();
    throw new Error(`OpenAI ${r.status}: ${t}`);
  }
  for await (const line of parseSSELines(r.body.getReader())) {
    if (!line.startsWith("data: ")) continue;
    const data = line.slice(6).trim();
    if (data === "[DONE]") return;
    try {
      const j = JSON.parse(data);
      const delta = j.choices?.[0]?.delta?.content;
      if (delta) yield delta as string;
    } catch { /* partial */ }
  }
}

// ---------- Anthropic ----------
async function* streamAnthropic(apiKey: string, model: string, messages: Msg[]) {
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
  for await (const line of parseSSELines(r.body.getReader())) {
    if (!line.startsWith("data: ")) continue;
    const data = line.slice(6).trim();
    try {
      const j = JSON.parse(data);
      if (j.type === "content_block_delta" && j.delta?.type === "text_delta") {
        yield j.delta.text as string;
      }
    } catch { /* partial */ }
  }
}

// ---------- Google Gemini (SSE) ----------
async function* streamGemini(apiKey: string, model: string, messages: Msg[]) {
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
    } catch { /* partial */ }
  }
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

async function linkupSearch(
  apiKey: string,
  query: string,
): Promise<{ content: string; sources: WebSource[] } | null> {
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
        includeImages: false,
      }),
    });
    const j = await r.json();
    if (!r.ok) {
      console.error("linkup search error", r.status, j);
      return null;
    }
    const results: any[] = j?.results ?? [];
    if (!Array.isArray(results) || !results.length) return null;
    const top = results.slice(0, 8);
    const sources: WebSource[] = top.map((res) => ({
      title: (res.name ?? res.title ?? "Untitled").toString(),
      url: (res.url ?? "").toString(),
    }));
    const blocks = top.map((res, i) => {
      const title = sources[i].title;
      const url = sources[i].url;
      const content = (res.content ?? res.snippet ?? res.description ?? "").toString().slice(0, 2000);
      return `### Source ${i + 1}: ${title}\nURL: ${url}\n\n${content}`;
    });
    return {
      content: blocks.join("\n\n---\n\n").slice(0, 15000),
      sources,
    };
  } catch (e) {
    console.error("linkup search exception", e);
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

  const prompt = `Generate a VERY short title (3 to 6 words maximum) summarizing the topic of this message. No quotes, no ending punctuation, no emoji. Reply with the title only.

Message:
${userText.slice(0, 1000)}`;

  try {
    if (args.googleKey) {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${args.googleKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
          }),
        },
      );
      const j = await r.json();
      const t = j.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join("") ?? "";
      return cleanTitle(t);
    } else if (args.openaiKey) {
      const r = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${args.openaiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "gpt-5-nano",
          messages: [{ role: "user", content: prompt }],
        }),
      });
      const j = await r.json();
      return cleanTitle(j.choices?.[0]?.message?.content ?? "");
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
          max_tokens: 32,
          messages: [{ role: "user", content: prompt }],
        }),
      });
      const j = await r.json();
      return cleanTitle(j.content?.[0]?.text ?? "");
    }
  } catch (e) {
    console.error("title gen failed", e);
  }
  return null;
}

function cleanTitle(s: string): string | null {
  const t = s.replace(/^["'`]+|["'`]+$/g, "").replace(/[.!?]+$/g, "").trim();
  if (!t) return null;
  return t.slice(0, 60);
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

  const toInsert: { user_id: string; content: string; kind: string }[] = [];
  const toUpdate: { id: string; content: string; kind: string }[] = [];

  for (const a of actions.slice(0, 10)) {
    if (!a?.content || typeof a.content !== "string") continue;
    const content = a.content.slice(0, 500).trim();
    if (!content) continue;
    const kind = validKinds.includes(a.kind) ? a.kind : "fact";

    if (a.op === "update" && a.id && existingById.has(a.id)) {
      const prev = existingById.get(a.id)!;
      if (norm(prev.content) === norm(content)) continue; // no-op
      toUpdate.push({ id: a.id, content, kind });
      existingContents.delete(norm(prev.content));
      existingContents.add(norm(content));
    } else if (a.op === "add") {
      if (existingContents.has(norm(content))) continue; // dedup
      toInsert.push({ user_id: userId, content, kind });
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
      .update({ content: u.content, kind: u.kind, updated_at: new Date().toISOString() })
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

    const { conversationId, provider, model, messages } = await req.json() as {
      conversationId: string;
      provider: "openai" | "anthropic" | "google";
      model: string;
      messages: Msg[];
    };

    if (!conversationId || !provider || !model || !Array.isArray(messages)) {
      return new Response(JSON.stringify({ error: "Invalid payload" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ---------- Load cross-provider user memory ----------
    const { data: memRows } = await supabase
      .from("user_memories")
      .select("content,kind,created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(100);

    const memoryBlock = (memRows ?? [])
      .map((m: any) => `- (${m.kind}) ${m.content}`)
      .join("\n");

    const memorySystem: Msg | null = memoryBlock
      ? {
        role: "system",
        content:
          "Persistent user memory (facts, preferences, context) — use it implicitly to personalize your responses, without repeating it verbatim:\n" +
          memoryBlock,
      }
      : null;

    const styleSystem: Msg = {
      role: "system",
      content:
        "Format your responses for excellent readability:\n" +
        "- Use generous whitespace, short paragraphs (2–4 sentences max), and frequent line breaks.\n" +
        "- Structure longer answers with markdown headings (##, ###) and bullet lists.\n" +
        "- Use horizontal dividers (---) to separate distinct sections or topics in long answers.\n" +
        "- Avoid dense walls of text. Prefer airy, scannable layouts.\n" +
        "- You may use emojis when relevant; one well-placed emoji beats ten.\n" +
        "- Always respond in the same language as the user's last message.",
    };

    // Prepend system messages (style + memory) and drop any previous duplicates from the client
    const baseSystems: Msg[] = [styleSystem, ...(memorySystem ? [memorySystem] : [])];
    const finalMessages: Msg[] = [
      ...baseSystems,
      ...messages.filter(
        (m) =>
          m.role !== "system" ||
          (!m.content.startsWith("Persistent user memory") && !m.content.startsWith("You may use emojis") && !m.content.startsWith("Format your responses")),
      ),
    ];

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
    const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
    const lastUserText = lastUserMsg?.content ?? "";
    const firecrawlKey = Deno.env.get("FIRECRAWL_API_KEY");
    const linkupKey = Deno.env.get("LINKUP_API_KEY");
    let webContext:
      | { kind: "scrape" | "search"; label: string; content: string; sources?: WebSource[] }
      | null = null;

    const stream = new ReadableStream({
      async start(controller) {
        try {
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
            const webSystem: Msg = {
              role: "system",
              content: `${header}${citationRule}\n\n${webContext.content}`,
            };
            messagesForLLM = [webSystem, ...finalMessages];
          }

          let iter: AsyncGenerator<string>;
          if (provider === "openai") iter = streamOpenAI(apiKey, model, messagesForLLM);
          else if (provider === "anthropic") iter = streamAnthropic(apiKey, model, messagesForLLM);
          else iter = streamGemini(apiKey, model, messagesForLLM);

          for await (const chunk of iter) {
            assistantText += chunk;
            controller.enqueue(enc({ type: "delta", text: chunk }));
          }

          // Persist assistant message
          await supabase.from("messages").insert({
            conversation_id: conversationId,
            user_id: user.id,
            role: "assistant",
            content: assistantText,
            model,
          });
          await supabase
            .from("conversations")
            .update({ updated_at: new Date().toISOString() })
            .eq("id", conversationId);

          // ---------- Auto-generate title if this is the first user message ----------
          const userMessagesCount = messages.filter((m) => m.role === "user").length;
          const lastUser = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
          if (userMessagesCount <= 1 && lastUser) {
            try {
              const title = await generateTitle({
                openaiKey: Deno.env.get("OPENAI_API_KEY"),
                googleKey: Deno.env.get("GOOGLE_API_KEY"),
                anthropicKey: Deno.env.get("ANTHROPIC_API_KEY"),
                userText: lastUser,
              });
              if (title) {
                await supabase
                  .from("conversations")
                  .update({ title })
                  .eq("id", conversationId);
                controller.enqueue(enc({ type: "title", title }));
              }
            } catch (err) {
              console.error("title update failed:", err);
            }
          }

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
