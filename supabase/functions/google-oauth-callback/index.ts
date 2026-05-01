// Handles the redirect from Google after the user grants consent.
// Exchanges the code for tokens and stores them in user_integrations.
// Then redirects the browser back to the app.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function htmlRedirect(target: string, message: string) {
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><title>${message}</title></head>
<body style="font-family:system-ui;padding:32px;color:#111">
<p>${message}</p>
<script>setTimeout(()=>{window.location.replace(${JSON.stringify(target)})},400)</script>
</body></html>`,
    { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const stateRaw = url.searchParams.get("state");
    const errorParam = url.searchParams.get("error");

    if (errorParam) {
      return htmlRedirect("/", `Google connection cancelled: ${errorParam}`);
    }
    if (!code || !stateRaw) {
      return new Response("Missing code or state", { status: 400 });
    }

    let state: { uid: string; r: string };
    try {
      state = JSON.parse(atob(stateRaw));
    } catch {
      return new Response("Invalid state", { status: 400 });
    }

    const clientId = Deno.env.get("GOOGLE_OAUTH_CLIENT_ID");
    const clientSecret = Deno.env.get("GOOGLE_OAUTH_CLIENT_SECRET");
    if (!clientId || !clientSecret) {
      throw new Error("Google OAuth credentials not configured");
    }

    const redirectUri = `${Deno.env.get("SUPABASE_URL")}/functions/v1/google-oauth-callback`;

    // 1. Exchange code → tokens
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenRes.ok) {
      console.error("Token exchange failed", tokenData);
      return htmlRedirect(state.r || "/", "Google connection failed.");
    }

    const accessToken = tokenData.access_token as string;
    const refreshToken = (tokenData.refresh_token as string | undefined) ?? null;
    const expiresIn = (tokenData.expires_in as number | undefined) ?? 3600;
    const scope = (tokenData.scope as string | undefined) ?? "";
    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

    // 2. Fetch user email
    const userInfoRes = await fetch(
      "https://www.googleapis.com/oauth2/v2/userinfo",
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    const userInfo = await userInfoRes.json();
    const accountEmail = (userInfo.email as string | undefined) ?? null;

    // 3. Persist with service role (the user's session is not in this redirect)
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Upsert: if no new refresh token, keep the existing one.
    const updatePayload: Record<string, unknown> = {
      user_id: state.uid,
      provider: "google",
      account_email: accountEmail,
      access_token: accessToken,
      scopes: scope ? scope.split(" ") : [],
      expires_at: expiresAt,
    };
    if (refreshToken) updatePayload.refresh_token = refreshToken;

    const { error: upsertErr } = await admin
      .from("user_integrations")
      .upsert(updatePayload, { onConflict: "user_id,provider" });
    if (upsertErr) {
      console.error("Upsert failed", upsertErr);
      return htmlRedirect(state.r || "/", "Could not save Google connection.");
    }

    return htmlRedirect(state.r || "/", "Google connected. Redirecting…");
  } catch (err) {
    console.error("google-oauth-callback error", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
