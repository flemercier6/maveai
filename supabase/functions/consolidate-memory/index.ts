// Memory consolidation: groups a user's memories into themed summaries via Lovable AI.
// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

type Memory = { id: string; content: string; kind: string; created_at: string };

function extractKeywords(text: string): string[] {
  return Array.from(
    new Set(
      text
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, " ")
        .split(/\s+/)
        .filter((w) => w.length > 3),
    ),
  ).slice(0, 12);
}

async function consolidateForUser(userId: string) {
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

  const { data: mems } = await supabase
    .from("user_memories")
    .select("id, content, kind, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });

  const memories = (mems ?? []) as Memory[];

  // Log the run
  const { data: runRow } = await supabase
    .from("memory_consolidation_runs")
    .insert({ user_id: userId, before_count: memories.length, status: "running" })
    .select()
    .single();
  const runId = runRow?.id;

  if (memories.length < 4) {
    await supabase.from("memory_consolidation_runs").update({
      finished_at: new Date().toISOString(),
      after_count: memories.length,
      status: "skipped",
    }).eq("id", runId);
    return { skipped: true, reason: "Not enough memories", before: memories.length, after: memories.length };
  }

  const numbered = memories.map((m, i) => `[${i + 1}] (${m.kind}) ${m.content}`).join("\n");

  const systemPrompt = `You are a memory consolidator. The user has accumulated many small memory entries from past conversations. Group entries that talk about the SAME topic, project, person, or fact, and produce ONE concise summarized entry per group. Keep entries that are unique on their own as-is. Do NOT lose important specific details (names, dates, preferences, numbers).

Return STRICT JSON with this shape:
{
  "groups": [
    {
      "summary": "Concise consolidated memory in one or two sentences, written as a fact about the user.",
      "kind": "fact" | "preference" | "project" | "skill" | "goal",
      "source_indices": [1, 4, 7]
    }
  ]
}

Rules:
- Every input index from 1 to ${memories.length} MUST appear in exactly one group's source_indices.
- A group with a single index = entry kept as-is (you may still rewrite the summary slightly for clarity).
- Prefer fewer, denser entries over many small ones, but never merge unrelated topics.
- Write summaries in English, neutral first-person-about-user style ("The user works on project ABC...").`;

  const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash-lite",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Memories to consolidate:\n\n${numbered}` },
      ],
      response_format: { type: "json_object" },
    }),
  });

  if (!aiResp.ok) {
    const errText = await aiResp.text();
    await supabase.from("memory_consolidation_runs").update({
      finished_at: new Date().toISOString(),
      status: "error",
      error: `AI ${aiResp.status}: ${errText.slice(0, 500)}`,
    }).eq("id", runId);
    throw new Error(`AI gateway ${aiResp.status}: ${errText}`);
  }

  const aiJson = await aiResp.json();
  const raw = aiJson.choices?.[0]?.message?.content ?? "{}";
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    parsed = m ? JSON.parse(m[0]) : { groups: [] };
  }

  const groups = Array.isArray(parsed.groups) ? parsed.groups : [];
  if (groups.length === 0) {
    await supabase.from("memory_consolidation_runs").update({
      finished_at: new Date().toISOString(),
      status: "skipped",
      after_count: memories.length,
    }).eq("id", runId);
    return { skipped: true, reason: "No groups returned", before: memories.length, after: memories.length };
  }

  // Build new rows
  const now = new Date().toISOString();
  const newRows = groups
    .filter((g: any) => typeof g.summary === "string" && g.summary.trim().length > 0)
    .map((g: any) => {
      const sourceCount = Array.isArray(g.source_indices) ? g.source_indices.length : 1;
      const content = String(g.summary).trim();
      return {
        user_id: userId,
        content,
        kind: typeof g.kind === "string" ? g.kind : "fact",
        keywords: extractKeywords(content),
        consolidated_at: now,
        source_count: sourceCount,
      };
    });

  if (newRows.length === 0) {
    await supabase.from("memory_consolidation_runs").update({
      finished_at: new Date().toISOString(),
      status: "error",
      error: "No valid groups after parsing",
    }).eq("id", runId);
    throw new Error("No valid groups");
  }

  // Replace: delete old, insert new (transactional-ish)
  const { error: delErr } = await supabase
    .from("user_memories")
    .delete()
    .eq("user_id", userId);
  if (delErr) throw delErr;

  const { error: insErr } = await supabase.from("user_memories").insert(newRows);
  if (insErr) throw insErr;

  await supabase.from("memory_consolidation_runs").update({
    finished_at: new Date().toISOString(),
    after_count: newRows.length,
    status: "success",
  }).eq("id", runId);

  return { skipped: false, before: memories.length, after: newRows.length };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const url = new URL(req.url);
    const isCron = url.searchParams.get("cron") === "1";

    if (isCron) {
      // Run for all users with at least 4 memories
      const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
      const { data: rows } = await supabase
        .from("user_memories")
        .select("user_id");
      const counts = new Map<string, number>();
      for (const r of (rows ?? []) as { user_id: string }[]) {
        counts.set(r.user_id, (counts.get(r.user_id) ?? 0) + 1);
      }
      const targets = [...counts.entries()].filter(([, c]) => c >= 4).map(([u]) => u);
      // @ts-ignore EdgeRuntime is provided by Supabase
      EdgeRuntime.waitUntil((async () => {
        for (const uid of targets) {
          try {
            await consolidateForUser(uid);
          } catch (e) {
            console.error("cron consolidation error", uid, e);
          }
        }
      })());
      return new Response(JSON.stringify({ queued: targets.length }), {
        status: 202,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // User-triggered: validate JWT
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
    // Run in background so the HTTP response returns immediately (avoid 150s gateway timeout).
    // The UI polls memory_consolidation_runs to know when it's done.
    const userId = userData.user.id;
    // @ts-ignore EdgeRuntime is provided by Supabase
    EdgeRuntime.waitUntil(
      consolidateForUser(userId).catch((e) => console.error("bg consolidation error", e)),
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
