// Returns the Mapbox public token to authenticated clients.
// Restrict the token by URL in Mapbox account settings for safety.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve((req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const token = Deno.env.get("MAPBOX_PUBLIC_TOKEN");
  if (!token) {
    return new Response(JSON.stringify({ error: "MAPBOX_PUBLIC_TOKEN not configured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  return new Response(JSON.stringify({ token }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "private, max-age=300" },
  });
});
