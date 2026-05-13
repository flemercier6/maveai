// Proxy authenticated requests from the app to the Voyager CRM REST API.
// The Voyager API key is stored as VOYAGER_API_KEY (workspace-wide).
//
// Body: { resource: "contacts" | "companies" | "deals",
//         method: "GET" | "POST" | "PATCH" | "DELETE",
//         id?: string,
//         query?: Record<string, string | number>,
//         payload?: Record<string, unknown> }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const VOYAGER_BASE =
  "https://wwwmbexbddrvyqpnwpwa.supabase.co/functions/v1/api-v1";

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

    const apiKey = Deno.env.get("VOYAGER_API_KEY");
    if (!apiKey) return json({ error: "VOYAGER_API_KEY not configured" }, 500);

    const body = (await req.json().catch(() => ({}))) as {
      resource?: string;
      method?: string;
      id?: string;
      query?: Record<string, string | number>;
      payload?: Record<string, unknown>;
    };

    const resource = (body.resource ?? "").toLowerCase();
    const method = (body.method ?? "GET").toUpperCase();

    if (!ALLOWED_RESOURCES.has(resource)) {
      return json({ error: `Unknown resource: ${resource}` }, 400);
    }
    if (!ALLOWED_METHODS.has(method)) {
      return json({ error: `Method not allowed: ${method}` }, 405);
    }

    let path = `/${resource}`;
    if (body.id) path += `/${encodeURIComponent(body.id)}`;
    const url = new URL(VOYAGER_BASE + path);
    if (body.query) {
      for (const [k, v] of Object.entries(body.query)) {
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
