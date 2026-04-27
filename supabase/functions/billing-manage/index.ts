// Manage billing account: upgrade/downgrade plan, change cycle, list/remove
// payment methods, set default. All actions verify auth + business rules.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import Stripe from "https://esm.sh/stripe@17.3.0?target=deno";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

type Cycle = "daily" | "weekly" | "monthly";

function nextBillingFrom(now: Date, cycle: Cycle): Date {
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

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData.user) return json({ error: "Unauthorized" }, 401);
    const user = userData.user;

    const stripe = new Stripe(stripeKey, { apiVersion: "2024-09-30.acacia" });
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = await req.json();
    const action = String(body.action ?? "");

    const { data: account } = await admin
      .from("billing_accounts")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();

    // ---- ACTIVATE PLUS ----
    if (action === "activate_plus") {
      const cycle = (body.cycle ?? "monthly") as Cycle;
      if (!["daily", "weekly", "monthly"].includes(cycle))
        return json({ error: "Invalid cycle" }, 400);
      const paymentMethodId = body.paymentMethodId as string | undefined;
      if (!paymentMethodId)
        return json({ error: "paymentMethodId required" }, 400);
      if (!account?.stripe_customer_id)
        return json({ error: "No Stripe customer" }, 400);

      // Attach the PaymentMethod (idempotent if already attached)
      try {
        await stripe.paymentMethods.attach(paymentMethodId, {
          customer: account.stripe_customer_id,
        });
      } catch (_e) {
        /* ignore if already attached */
      }
      // Set as default for off-session invoices
      await stripe.customers.update(account.stripe_customer_id, {
        invoice_settings: { default_payment_method: paymentMethodId },
      });

      // Persist payment method
      const pm = await stripe.paymentMethods.retrieve(paymentMethodId);
      await admin.from("payment_methods").upsert(
        {
          user_id: user.id,
          stripe_payment_method_id: pm.id,
          brand: pm.card?.brand,
          last4: pm.card?.last4,
          exp_month: pm.card?.exp_month,
          exp_year: pm.card?.exp_year,
          is_default: true,
        },
        { onConflict: "stripe_payment_method_id" },
      );
      // Unset other defaults
      await admin
        .from("payment_methods")
        .update({ is_default: false })
        .eq("user_id", user.id)
        .neq("stripe_payment_method_id", pm.id);

      const now = new Date();
      await admin
        .from("billing_accounts")
        .update({
          plan: "plus",
          billing_cycle: cycle,
          status: "active",
          failed_attempts: 0,
          next_billing_at: nextBillingFrom(now, cycle).toISOString(),
        })
        .eq("user_id", user.id);

      return json({ ok: true });
    }

    // ---- ADD CARD (after SetupIntent confirmed) ----
    if (action === "add_card") {
      const paymentMethodId = body.paymentMethodId as string;
      if (!paymentMethodId) return json({ error: "paymentMethodId required" }, 400);
      if (!account?.stripe_customer_id)
        return json({ error: "No Stripe customer" }, 400);

      try {
        await stripe.paymentMethods.attach(paymentMethodId, {
          customer: account.stripe_customer_id,
        });
      } catch (_e) {
        /* may already be attached */
      }
      const pm = await stripe.paymentMethods.retrieve(paymentMethodId);
      await admin.from("payment_methods").upsert(
        {
          user_id: user.id,
          stripe_payment_method_id: pm.id,
          brand: pm.card?.brand,
          last4: pm.card?.last4,
          exp_month: pm.card?.exp_month,
          exp_year: pm.card?.exp_year,
          is_default: false,
        },
        { onConflict: "stripe_payment_method_id" },
      );
      return json({ ok: true });
    }

    // ---- SET DEFAULT CARD ----
    if (action === "set_default_card") {
      const paymentMethodId = body.paymentMethodId as string;
      if (!paymentMethodId) return json({ error: "paymentMethodId required" }, 400);
      if (!account?.stripe_customer_id)
        return json({ error: "No Stripe customer" }, 400);

      await stripe.customers.update(account.stripe_customer_id, {
        invoice_settings: { default_payment_method: paymentMethodId },
      });
      await admin
        .from("payment_methods")
        .update({ is_default: false })
        .eq("user_id", user.id);
      await admin
        .from("payment_methods")
        .update({ is_default: true })
        .eq("user_id", user.id)
        .eq("stripe_payment_method_id", paymentMethodId);
      return json({ ok: true });
    }

    // ---- REMOVE CARD ----
    if (action === "remove_card") {
      const paymentMethodId = body.paymentMethodId as string;
      if (!paymentMethodId) return json({ error: "paymentMethodId required" }, 400);

      const { data: cards } = await admin
        .from("payment_methods")
        .select("*")
        .eq("user_id", user.id);
      const remaining = (cards ?? []).filter(
        (c) => c.stripe_payment_method_id !== paymentMethodId,
      );
      if (account?.plan === "plus" && remaining.length === 0)
        return json(
          {
            error:
              "Au moins une carte doit rester enregistrée tant que vous êtes sur le plan Plus.",
          },
          400,
        );

      try {
        await stripe.paymentMethods.detach(paymentMethodId);
      } catch (_e) {
        /* ignore */
      }
      await admin
        .from("payment_methods")
        .delete()
        .eq("user_id", user.id)
        .eq("stripe_payment_method_id", paymentMethodId);

      // Reassign default if removed card was default
      const removed = (cards ?? []).find(
        (c) => c.stripe_payment_method_id === paymentMethodId,
      );
      if (removed?.is_default && remaining[0] && account?.stripe_customer_id) {
        const newDefault = remaining[0].stripe_payment_method_id;
        await stripe.customers.update(account.stripe_customer_id, {
          invoice_settings: { default_payment_method: newDefault },
        });
        await admin
          .from("payment_methods")
          .update({ is_default: true })
          .eq("user_id", user.id)
          .eq("stripe_payment_method_id", newDefault);
      }
      return json({ ok: true });
    }

    // ---- CHANGE CYCLE ----
    if (action === "set_cycle") {
      const cycle = body.cycle as Cycle;
      if (!["daily", "weekly", "monthly"].includes(cycle))
        return json({ error: "Invalid cycle" }, 400);
      const now = new Date();
      await admin
        .from("billing_accounts")
        .update({
          billing_cycle: cycle,
          next_billing_at: nextBillingFrom(now, cycle).toISOString(),
        })
        .eq("user_id", user.id);
      return json({ ok: true });
    }

    // ---- DOWNGRADE TO FREE ----
    if (action === "downgrade") {
      // Compute outstanding usage; refuse if > 0 (user must wait for next billing)
      const { data: events } = await admin
        .from("usage_events")
        .select("total_cost_usd, model")
        .eq("user_id", user.id)
        .is("billed_at", null);
      const outstanding = (events ?? []).reduce(
        (s, e) => s + Number(e.total_cost_usd || 0),
        0,
      );
      if (outstanding > 0)
        return json(
          {
            error:
              "Vous avez une consommation en cours non facturée. Patientez jusqu'au prochain prélèvement avant de revenir au plan Free.",
          },
          400,
        );
      await admin
        .from("billing_accounts")
        .update({ plan: "free", next_billing_at: null, status: "active" })
        .eq("user_id", user.id);
      return json({ ok: true });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    console.error("billing-manage error", e);
    return json({ error: (e as Error).message }, 500);
  }
});

function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
