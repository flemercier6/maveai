// Cron entry-point: scans Plus accounts whose next_billing_at <= now() OR
// past_due accounts (daily retry), and charges them off-session.
// Threshold: 1 EUR. Below threshold → defer (events stay unbilled).
// 3 consecutive failures → suspend.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import Stripe from "https://esm.sh/stripe@17.3.0?target=deno";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const PRICES: Record<string, { input: number; output: number }> = {
  "gpt-5.5": { input: 2.5, output: 10 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "claude-opus-4-7": { input: 15, output: 75 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "gemini-2.5-pro": { input: 1.25, output: 10 },
  "gemini-3.5-flash": { input: 0.3, output: 2.5 },
  "mistral-large-latest": { input: 2, output: 6 },
  "mistral-small-latest": { input: 0.2, output: 0.6 },
};
const REFERENCE_BLENDED = 2.0;
function multiplier(model: string): number {
  const p = PRICES[model];
  if (!p) return 3;
  const blended = p.input * 0.75 + p.output * 0.25;
  if (blended <= 0) return 3;
  const raw = (REFERENCE_BLENDED / blended) * 3;
  return Math.min(6, Math.max(1.5, raw));
}
const USD_TO_EUR = 0.92;
const MIN_THRESHOLD_EUR = 1.0;
const MAX_FAILURES = 3;

function nextBillingFrom(now: Date, cycle: string): Date {
  const d = new Date(now);
  if (cycle === "daily") d.setUTCDate(d.getUTCDate() + 1);
  else if (cycle === "weekly") d.setUTCDate(d.getUTCDate() + 7);
  else d.setUTCMonth(d.getUTCMonth() + 1);
  return d;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) throw new Error("STRIPE_SECRET_KEY not configured");
    const stripe = new Stripe(stripeKey, { apiVersion: "2024-09-30.acacia" });
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const now = new Date();
    // Eligible: plus, not suspended, due
    const { data: due } = await admin
      .from("billing_accounts")
      .select("*")
      .eq("plan", "plus")
      .neq("status", "suspended")
      .lte("next_billing_at", now.toISOString());

    const results: unknown[] = [];
    for (const acc of due ?? []) {
      try {
        const periodStart = acc.last_failure_at ?? acc.updated_at ?? acc.created_at;
        const { data: events } = await admin
          .from("usage_events")
          .select("id, total_cost_usd, model")
          .eq("user_id", acc.user_id)
          .is("billed_at", null);

        let amountEur = 0;
        for (const e of events ?? []) {
          amountEur +=
            Number(e.total_cost_usd || 0) * multiplier(String(e.model ?? "")) * USD_TO_EUR;
        }
        amountEur = Math.round(amountEur * 100) / 100;

        if (amountEur < MIN_THRESHOLD_EUR) {
          // Defer: do NOT mark events billed_at, just push next_billing_at
          await admin.from("billing_invoices").insert({
            user_id: acc.user_id,
            period_start: periodStart,
            period_end: now.toISOString(),
            amount_eur: amountEur,
            status: "skipped_below_threshold",
          });
          await admin
            .from("billing_accounts")
            .update({
              next_billing_at: nextBillingFrom(now, acc.billing_cycle).toISOString(),
              failed_attempts: 0,
              status: "active",
            })
            .eq("user_id", acc.user_id);
          results.push({ user_id: acc.user_id, status: "skipped" });
          continue;
        }

        if (!acc.stripe_customer_id) {
          results.push({ user_id: acc.user_id, status: "no_customer" });
          continue;
        }

        // Get default card
        const { data: defaultCard } = await admin
          .from("payment_methods")
          .select("*")
          .eq("user_id", acc.user_id)
          .eq("is_default", true)
          .maybeSingle();
        if (!defaultCard) {
          results.push({ user_id: acc.user_id, status: "no_card" });
          continue;
        }

        // Create invoice row first (pending)
        const { data: invoice } = await admin
          .from("billing_invoices")
          .insert({
            user_id: acc.user_id,
            period_start: periodStart,
            period_end: now.toISOString(),
            amount_eur: amountEur,
            status: "pending",
            attempts: (acc.failed_attempts ?? 0) + 1,
            last_attempt_at: now.toISOString(),
          })
          .select()
          .single();

        try {
          const pi = await stripe.paymentIntents.create({
            amount: Math.round(amountEur * 100),
            currency: "eur",
            customer: acc.stripe_customer_id,
            payment_method: defaultCard.stripe_payment_method_id,
            off_session: true,
            confirm: true,
            description: `ExplorAI usage ${periodStart} → ${now.toISOString()}`,
            metadata: { user_id: acc.user_id, invoice_id: invoice!.id },
          });

          // Mark events billed
          const ids = (events ?? []).map((e) => e.id);
          if (ids.length) {
            await admin
              .from("usage_events")
              .update({ billed_at: now.toISOString() })
              .in("id", ids);
          }
          await admin
            .from("billing_invoices")
            .update({ status: "paid", stripe_payment_intent_id: pi.id })
            .eq("id", invoice!.id);
          await admin
            .from("billing_accounts")
            .update({
              status: "active",
              failed_attempts: 0,
              last_failure_at: null,
              next_billing_at: nextBillingFrom(now, acc.billing_cycle).toISOString(),
            })
            .eq("user_id", acc.user_id);
          results.push({ user_id: acc.user_id, status: "paid", amount: amountEur });
        } catch (chargeErr) {
          const reason = (chargeErr as Error).message;
          const failed = (acc.failed_attempts ?? 0) + 1;
          const newStatus = failed >= MAX_FAILURES ? "suspended" : "past_due";
          await admin
            .from("billing_invoices")
            .update({ status: "failed", failure_reason: reason })
            .eq("id", invoice!.id);
          await admin
            .from("billing_accounts")
            .update({
              status: newStatus,
              failed_attempts: failed,
              last_failure_at: now.toISOString(),
              // Retry tomorrow
              next_billing_at: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
            })
            .eq("user_id", acc.user_id);
          results.push({
            user_id: acc.user_id,
            status: "failed",
            attempts: failed,
            reason,
          });
        }
      } catch (e) {
        console.error("billing-charge per-account error", e);
        results.push({ user_id: acc.user_id, status: "error", error: (e as Error).message });
      }
    }

    return json({ processed: results.length, results });
  } catch (e) {
    console.error("billing-charge error", e);
    return json({ error: (e as Error).message }, 500);
  }
});

function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
