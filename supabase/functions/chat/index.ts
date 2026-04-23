// Multi-provider streaming chat: OpenAI, Anthropic, Google Gemini
// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

type Msg = { role: "user" | "assistant" | "system"; content: string };

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
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model, messages, stream: true }),
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
      messages: conv.map((m) => ({ role: m.role, content: m.content })),
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
    .map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));
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
      if (txt) yield txt as string;
    } catch { /* partial */ }
  }
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
          "Mémoire persistante de l'utilisateur (faits, préférences, contexte) — utilise-la implicitement pour personnaliser tes réponses, sans la répéter mot pour mot :\n" +
          memoryBlock,
      }
      : null;

    // Prepend memory system message if not already present
    const finalMessages: Msg[] = memorySystem
      ? [memorySystem, ...messages.filter((m) => m.role !== "system" || !m.content.startsWith("Mémoire persistante"))]
      : messages;

    const ENV_KEY: Record<string, string | undefined> = {
      openai: Deno.env.get("OPENAI_API_KEY"),
      anthropic: Deno.env.get("ANTHROPIC_API_KEY"),
      google: Deno.env.get("GOOGLE_API_KEY"),
    };
    const apiKey = ENV_KEY[provider];

    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: `Le fournisseur ${provider} n'est pas activé sur cette instance.` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const enc = sseEncoder();
    let assistantText = "";

    const stream = new ReadableStream({
      async start(controller) {
        try {
          let iter: AsyncGenerator<string>;
          if (provider === "openai") iter = streamOpenAI(apiKey, model, finalMessages);
          else if (provider === "anthropic") iter = streamAnthropic(apiKey, model, finalMessages);
          else iter = streamGemini(apiKey, model, finalMessages);

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
          });
          await supabase
            .from("conversations")
            .update({ updated_at: new Date().toISOString() })
            .eq("id", conversationId);

          controller.enqueue(enc({ type: "done" }));
          controller.close();

          // ---------- Fire-and-forget: extract memorable facts ----------
          const lastUser = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
          extractAndSaveMemory({
            supabase,
            userId: user.id,
            openaiKey: Deno.env.get("OPENAI_API_KEY"),
            googleKey: Deno.env.get("GOOGLE_API_KEY"),
            anthropicKey: Deno.env.get("ANTHROPIC_API_KEY"),
            userText: lastUser,
            assistantText,
          }).catch((err) => console.error("memory extract failed:", err));
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
