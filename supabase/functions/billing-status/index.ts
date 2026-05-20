// Returns current billing state for the signed-in user:
// account, default card, list of cards, outstanding amount in EUR, next charge.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Pricing tables — kept in sync with src/lib/pricing.ts
const PRICES: Record<string, { input: number; output: number }> = {
  "gpt-5.5": { input: 2.5, output: 10 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "claude-opus-4-7": { input: 15, output: 75 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-haiku-4-5": { input: 1, output: 5 },
  "gemini-2.5-pro": { input: 1.25, output: 10 },
  "gemini-3.5-flash": { input: 0.3, output: 2.5 },
  "mistral-large-latest": { input: 2, output: 6 },
  "mistral-small-latest": { input: 0.2, output: 0.6 },
};
const REFERENCE_BLENDED = 2.0;
const MIN_MULT = 1.5;
const MAX_MULT = 6;
const FALLBACK = 3;
const MULTIPLIER_OVERRIDES: Record<string, number> = {
  "claude-haiku-4-5": 12,
};
function multiplier(model: string): number {
  if (model in MULTIPLIER_OVERRIDES) return MULTIPLIER_OVERRIDES[model];
  const p = PRICES[model];
  if (!p) return FALLBACK;
  const blended = p.input * 0.75 + p.output * 0.25;
  if (blended <= 0) return FALLBACK;
  const raw = (REFERENCE_BLENDED / blended) * FALLBACK;
  return Math.min(MAX_MULT, Math.max(MIN_MULT, raw));
}

// Approx USD→EUR; for production, use a real FX feed.
const USD_TO_EUR = 0.92;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return json({ error: "Unauthorized" }, 401);
    const user = userData.user;

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const [{ data: account }, { data: cards }, { data: events }, { data: invoices }] =
      await Promise.all([
        admin.from("billing_accounts").select("*").eq("user_id", user.id).maybeSingle(),
        admin.from("payment_methods").select("*").eq("user_id", user.id).order("created_at", { ascending: false }),
        admin.from("usage_events").select("total_cost_usd, model").eq("user_id", user.id).is("billed_at", null),
        admin.from("billing_invoices").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(20),
      ]);

    let outstandingEur = 0;
    for (const e of events ?? []) {
      const cost = Number(e.total_cost_usd || 0) * multiplier(String(e.model ?? ""));
      outstandingEur += cost * USD_TO_EUR;
    }

    return json({
      account: account ?? { plan: "free", billing_cycle: "monthly", status: "active" },
      cards: cards ?? [],
      outstandingEur: Math.round(outstandingEur * 100) / 100,
      invoices: invoices ?? [],
    });
  } catch (e) {
    console.error("billing-status error", e);
    return json({ error: (e as Error).message }, 500);
  }
});

function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
