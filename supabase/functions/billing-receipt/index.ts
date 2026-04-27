// Returns the hosted Stripe receipt URL for a given paid invoice.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import Stripe from "https://esm.sh/stripe@17.3.0?target=deno";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

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

    const body = await req.json().catch(() => ({}));
    const invoiceId = String(body?.invoice_id ?? "");
    if (!invoiceId) return json({ error: "invoice_id required" }, 400);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: invoice } = await admin
      .from("billing_invoices")
      .select("*")
      .eq("id", invoiceId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (!invoice) return json({ error: "Not found" }, 404);
    if (invoice.status !== "paid" || !invoice.stripe_payment_intent_id) {
      return json({ error: "No receipt available" }, 400);
    }

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) return json({ error: "Stripe not configured" }, 500);
    const stripe = new Stripe(stripeKey, { apiVersion: "2024-09-30.acacia" });

    const pi = await stripe.paymentIntents.retrieve(invoice.stripe_payment_intent_id, {
      expand: ["latest_charge"],
    });
    const charge = (pi as any).latest_charge as any;
    const receiptUrl: string | null = charge?.receipt_url ?? null;
    if (!receiptUrl) return json({ error: "Receipt not yet available" }, 404);

    return json({ url: receiptUrl });
  } catch (e) {
    console.error("billing-receipt error", e);
    return json({ error: (e as Error).message }, 500);
  }
});

function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
