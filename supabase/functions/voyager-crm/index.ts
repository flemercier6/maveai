// Voyager CRM proxy + per-user key management.
//
// Body shapes:
//   { action: "connect", apiKey: string }       -> validates & stores user's key
//   { action: "disconnect" }                    -> removes user's key
//   { action: "status" }                        -> { connected: boolean }
//   { resource, method, id?, query?, payload? } -> proxies to Voyager API
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const VOYAGER_BASE =
  "https://wwwmbexbddrvyqpnwpwa.supabase.co/functions/v1/api-v1";
const PROVIDER = "voyager";

const ALLOWED_RESOURCES = new Set(["contacts", "companies", "deals"]);
const ALLOWED_METHODS = new Set(["GET", "POST", "PATCH", "DELETE"]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json({ error: "Unauthorized" }, 401);
    }
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userErr } =
      await supabase.auth.getUser(token);
    if (userErr || !userData?.user) {
      return json({ error: "Unauthorized" }, 401);
    }
    const userId = userData.user.id;

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const action = typeof body.action === "string" ? body.action : null;

    // ---- key management ----
    if (action === "status") {
      const { data } = await admin
        .from("user_integrations")
        .select("id")
        .eq("user_id", userId)
        .eq("provider", PROVIDER)
        .maybeSingle();
      return json({ connected: !!data });
    }

    if (action === "disconnect") {
      const { error } = await admin
        .from("user_integrations")
        .delete()
        .eq("user_id", userId)
        .eq("provider", PROVIDER);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }

    if (action === "connect") {
      const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
      if (!apiKey.startsWith("vyg_")) {
        return json({ error: "Invalid Voyager API key format" }, 400);
      }
      // Validate by calling a lightweight endpoint.
      const test = await fetch(`${VOYAGER_BASE}/contacts?limit=1`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!test.ok) {
        const txt = await test.text();
        return json(
          {
            error: `Key rejected by Voyager (${test.status}): ${txt.slice(0, 200)}`,
          },
          400,
        );
      }
      // Upsert the integration row. We reuse `access_token` to store the key.
      const { error } = await admin.from("user_integrations").upsert(
        {
          user_id: userId,
          provider: PROVIDER,
          access_token: apiKey,
          scopes: [],
        },
        { onConflict: "user_id,provider" },
      );
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }

    // ---- proxy ----
    const resource = String(body.resource ?? "").toLowerCase();
    const method = String(body.method ?? "GET").toUpperCase();
    if (!ALLOWED_RESOURCES.has(resource)) {
      return json({ error: `Unknown resource: ${resource}` }, 400);
    }
    if (!ALLOWED_METHODS.has(method)) {
      return json({ error: `Method not allowed: ${method}` }, 405);
    }

    const { data: row, error: rowErr } = await admin
      .from("user_integrations")
      .select("access_token")
      .eq("user_id", userId)
      .eq("provider", PROVIDER)
      .maybeSingle();
    if (rowErr) return json({ error: rowErr.message }, 500);
    if (!row) return json({ error: "Voyager not connected" }, 400);
    const apiKey = (row as { access_token: string }).access_token;

    let path = `/${resource}`;
    if (typeof body.id === "string" && body.id) {
      path += `/${encodeURIComponent(body.id)}`;
    }
    const url = new URL(VOYAGER_BASE + path);
    const query = body.query as Record<string, string | number> | undefined;
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        url.searchParams.set(k, String(v));
      }
    }
    const init: RequestInit = {
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
    };
    if (method !== "GET" && method !== "DELETE" && body.payload) {
      init.body = JSON.stringify(body.payload);
    }
    const r = await fetch(url.toString(), init);
    const text = await r.text();
    let data: unknown;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw: text };
    }
    return json({ ok: r.ok, status: r.status, data }, r.ok ? 200 : r.status);
  } catch (err) {
    console.error("voyager-crm error", err);
    return json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      500,
    );
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
