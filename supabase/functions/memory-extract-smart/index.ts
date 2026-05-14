// Smart memory extraction — experimental.
// 3-stage pipeline:
//   A. Heuristic regex pre-filter (zero cost, <5ms)
//   B. Cheap LLM judge → JSON {shouldStore, category, fact, confidence}
//   C. Embedding-based dedup (cosine > 0.85 → reinforce existing memory)
//
// Designed to be invoked async by the chat function (fire-and-forget),
// so it never blocks the user-visible streaming response.

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";

// ---------- Stage A: heuristic pre-filter ----------
// Cheap signals that the user is sharing something durable about themselves.
// Mix of FR + EN. Anything matching at least once → continue to LLM judge.
const SIGNAL_PATTERNS: RegExp[] = [
  // Identity / role / job — durable self-statements
  /\bje\s+(?:suis|m'appelle|bosse|travaille|vis|habite)\b/i,
  /\bj['e]\s*(?:préfère|déteste|adore|utilise|évite|veux|aime|n'aime|cherche|construis|développe|écris|gère|pilote)\b/i,
  /\bI[' ]?m\s+(?:a|an|the|working|based|from|using|building|writing|trying|currently)\b/i,
  /\bI\s+(?:prefer|like|love|hate|use|avoid|work\s+at|live\s+in|build|run|own|manage|lead)\b/i,
  // Explicit "remember" verbs — FR
  /\b(?:garde|gardes?|gardez)\b.*\b(?:en\s+(?:mémoire|tête|tete)|pour\s+plus\s+tard)\b/i,
  /\b(?:retiens|retenir|retenez|souviens|souvenir|souvenez|mémorise|mémoriser|mémorisez|enregistre|enregistrer|enregistrez|sauvegarde|sauvegarder|stocke|stocker|note|notez|n'oublie|n'oubliez)\b/i,
  // Explicit "remember" verbs — EN
  /\b(?:remember|memorize|memorise|save|store|note|keep\s+in\s+mind|don'?t\s+forget)\b/i,
];

function passesHeuristic(text: string): boolean {
  if (text.length < 10 || text.length > 2000) return false;
  return SIGNAL_PATTERNS.some((re) => re.test(text));
}

// ---------- Stage B: LLM judge ----------
async function llmJudge(userText: string, assistantText: string): Promise<{
  shouldStore: boolean;
  category: "identity" | "preference" | "context";
  fact: string;
  confidence: number;
  tokensUsed: number;
} | null> {
  const prompt =
    `You decide whether a single durable user fact should be stored in long-term memory.\n\n` +
    `Rules:\n` +
    `- Store only DURABLE facts: identity, preferences, professional context, recurring goals.\n` +
    `- Do NOT store one-off questions, tasks, requests, or transient info.\n` +
    `- If the user says "remember X", confidence should be high.\n` +
    `- Output a SINGLE concise third-person fact (max 200 chars).\n\n` +
    `--- USER ---\n${userText}\n\n--- ASSISTANT ---\n${assistantText.slice(0, 800)}\n\n` +
    `Respond STRICT JSON: {"shouldStore":bool,"category":"identity"|"preference"|"context","fact":"string","confidence":0..1}`;

  try {
    const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        max_tokens: 200,
        temperature: 0,
      }),
    });
    if (!r.ok) {
      console.warn("[smart-memory] judge http error", r.status, await r.text());
      return null;
    }
    const j = await r.json();
    const raw = j.choices?.[0]?.message?.content ?? "";
    const tokensUsed = (j.usage?.total_tokens as number | undefined) ?? 0;
    const parsed = JSON.parse(raw);
    if (typeof parsed?.shouldStore !== "boolean") return null;
    return {
      shouldStore: !!parsed.shouldStore,
      category: ["identity", "preference", "context"].includes(parsed.category)
        ? parsed.category
        : "context",
      fact: String(parsed.fact ?? "").slice(0, 500).trim(),
      confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0)),
      tokensUsed,
    };
  } catch (e) {
    console.warn("[smart-memory] judge failed", e);
    return null;
  }
}

// ---------- Stage C: embedding + dedup ----------
async function embed(text: string): Promise<number[] | null> {
  if (!OPENAI_API_KEY) return null;
  try {
    const r = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "text-embedding-3-small",
        input: text.slice(0, 1000),
      }),
    });
    if (!r.ok) return null;
    const j = await r.json();
    return (j.data?.[0]?.embedding as number[] | undefined) ?? null;
  } catch {
    return null;
  }
}

function cosine(a: number[], b: number[]): number {
  if (!a?.length || !b?.length || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function extractKeywords(text: string, max = 12): string[] {
  return Array.from(
    new Set(
      text
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, " ")
        .split(/\s+/)
        .filter((w) => w.length > 3),
    ),
  ).slice(0, max);
}

// ---------- Main pipeline ----------
async function run(
  supabase: any,
  userId: string,
  userText: string,
  assistantText: string,
): Promise<{ outcome: string; tokens: number }> {
  // Rate limit: max 1 extraction / 10s / user
  const { data: lastRuns } = await supabase
    .from("memory_extraction_runs")
    .select("started_at")
    .eq("user_id", userId)
    .order("started_at", { ascending: false })
    .limit(1);
  const lastAt = lastRuns?.[0]?.started_at ? new Date(lastRuns[0].started_at).getTime() : 0;
  if (Date.now() - lastAt < 10_000) {
    return { outcome: "rate_limited", tokens: 0 };
  }

  const { data: runRow } = await supabase
    .from("memory_extraction_runs")
    .insert({ user_id: userId, status: "running" })
    .select()
    .single();
  const runId = runRow?.id;

  const finish = async (status: string, outcome: string, tokens: number, error?: string) => {
    if (!runId) return;
    await supabase
      .from("memory_extraction_runs")
      .update({
        finished_at: new Date().toISOString(),
        status,
        outcome,
        tokens_used: tokens,
        error: error ?? null,
      })
      .eq("id", runId);
  };

  // Stage A
  if (!passesHeuristic(userText)) {
    await finish("skipped", "no_signal", 0);
    return { outcome: "no_signal", tokens: 0 };
  }

  // Stage B
  const judge = await llmJudge(userText, assistantText);
  if (!judge) {
    await finish("error", "judge_failed", 0, "judge returned null");
    return { outcome: "judge_failed", tokens: 0 };
  }
  if (!judge.shouldStore || !judge.fact || judge.confidence < 0.4) {
    await finish("skipped", "judge_rejected", judge.tokensUsed);
    return { outcome: "judge_rejected", tokens: judge.tokensUsed };
  }

  // Stage C: dedup via embedding
  const emb = await embed(judge.fact);

  // Pull recent memories with embeddings (cap to keep cost bounded)
  const { data: existing } = await supabase
    .from("user_memories")
    .select("id, content, embedding, confidence, hit_count")
    .eq("user_id", userId)
    .order("last_seen_at", { ascending: false })
    .limit(200);

  let bestId: string | null = null;
  let bestSim = 0;
  if (emb) {
    for (const m of (existing ?? []) as any[]) {
      if (!Array.isArray(m.embedding) || !m.embedding.length) continue;
      const sim = cosine(emb, m.embedding as number[]);
      if (sim > bestSim) {
        bestSim = sim;
        bestId = m.id;
      }
    }
  }

  if (bestId && bestSim > 0.85) {
    // Reinforce existing memory
    const cur = (existing as any[]).find((m) => m.id === bestId);
    const { error } = await supabase
      .from("user_memories")
      .update({
        last_seen_at: new Date().toISOString(),
        hit_count: (cur?.hit_count ?? 1) + 1,
        confidence: Math.max(Number(cur?.confidence ?? 0), judge.confidence),
        updated_at: new Date().toISOString(),
      })
      .eq("id", bestId)
      .eq("user_id", userId);
    if (error) {
      await finish("error", "update_failed", judge.tokensUsed, error.message);
      return { outcome: "update_failed", tokens: judge.tokensUsed };
    }
    await finish("success", "reinforced", judge.tokensUsed);
    return { outcome: "reinforced", tokens: judge.tokensUsed };
  }

  // Insert new memory
  const { error } = await supabase.from("user_memories").insert({
    user_id: userId,
    content: judge.fact,
    kind: judge.category,
    confidence: judge.confidence,
    keywords: extractKeywords(judge.fact),
    embedding: emb,
    last_seen_at: new Date().toISOString(),
    hit_count: 1,
  });
  if (error) {
    await finish("error", "insert_failed", judge.tokensUsed, error.message);
    return { outcome: "insert_failed", tokens: judge.tokensUsed };
  }
  await finish("success", "added", judge.tokensUsed);
  return { outcome: "added", tokens: judge.tokensUsed };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data: userData, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const userText = String(body?.userText ?? "").trim();
    const assistantText = String(body?.assistantText ?? "").trim();

    if (!userText) {
      return new Response(JSON.stringify({ outcome: "empty_user_text" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userId = userData.user.id;
    // Run in background so the HTTP response returns immediately.
    // @ts-ignore EdgeRuntime is provided by Supabase
    EdgeRuntime.waitUntil(
      run(supabase, userId, userText, assistantText).catch((e) =>
        console.error("[smart-memory] run failed", e),
      ),
    );

    return new Response(JSON.stringify({ queued: true }), {
      status: 202,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
