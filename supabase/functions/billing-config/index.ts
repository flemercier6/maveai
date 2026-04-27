// Returns the Stripe publishable key (safe to expose client-side).
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve((req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const pk = Deno.env.get("STRIPE_PUBLISHABLE_KEY") ?? null;
  return new Response(JSON.stringify({ publishableKey: pk }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
