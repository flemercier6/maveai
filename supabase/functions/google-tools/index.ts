// Executes Gmail / Google Calendar actions on behalf of the authenticated user
// using the OAuth tokens stored in `user_integrations`.
// Refreshes the access token automatically when expired.
//
// Body: { action: string, params: Record<string, unknown> }
// Supported actions:
//   gmail.search   { query?: string, maxResults?: number }
//   gmail.get      { id: string }
//   gmail.draft    { to: string, subject: string, body: string, cc?: string, bcc?: string }
//   gmail.send     { to: string, subject: string, body: string, cc?: string, bcc?: string }
//   calendar.list  { timeMin?: string, timeMax?: string, maxResults?: number, q?: string }
//   calendar.create { summary: string, start: string, end: string, description?: string,
//                     location?: string, attendees?: string[], timeZone?: string }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

type Tokens = {
  access_token: string;
  refresh_token: string | null;
  expires_at: string | null;
  scopes: string[];
};

async function getValidAccessToken(
  admin: ReturnType<typeof createClient>,
  userId: string,
): Promise<Tokens> {
  const { data: row, error } = await admin
    .from("user_integrations")
    .select("access_token, refresh_token, expires_at, scopes")
    .eq("user_id", userId)
    .eq("provider", "google")
    .maybeSingle();
  if (error) throw new Error(`DB error: ${error.message}`);
  if (!row) throw new Error("Google account not connected");

  const tokens = row as unknown as Tokens;
  const exp = tokens.expires_at ? new Date(tokens.expires_at).getTime() : 0;
  // Refresh 60s before expiry
  if (exp - 60_000 > Date.now()) return tokens;

  if (!tokens.refresh_token) {
    throw new Error(
      "Access token expired and no refresh token available. Reconnect Google.",
    );
  }
  const clientId = Deno.env.get("GOOGLE_OAUTH_CLIENT_ID");
  const clientSecret = Deno.env.get("GOOGLE_OAUTH_CLIENT_SECRET");
  if (!clientId || !clientSecret) throw new Error("OAuth env not configured");

  const refreshRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: tokens.refresh_token,
    }),
  });
  const refreshData = await refreshRes.json();
  if (!refreshRes.ok) {
    console.error("Refresh failed", refreshData);
    throw new Error(
      `Could not refresh Google token: ${JSON.stringify(refreshData)}`,
    );
  }
  const newAccess = refreshData.access_token as string;
  const newExpiresIn = (refreshData.expires_in as number) ?? 3600;
  const newExpiresAt = new Date(Date.now() + newExpiresIn * 1000).toISOString();

  await admin
    .from("user_integrations")
    .update({ access_token: newAccess, expires_at: newExpiresAt })
    .eq("user_id", userId)
    .eq("provider", "google");

  return { ...tokens, access_token: newAccess, expires_at: newExpiresAt };
}

// ---------- Gmail helpers ----------

function buildRfc2822(opts: {
  to: string;
  subject: string;
  body: string;
  cc?: string;
  bcc?: string;
}): string {
  const headers = [
    `To: ${opts.to}`,
    opts.cc ? `Cc: ${opts.cc}` : "",
    opts.bcc ? `Bcc: ${opts.bcc}` : "",
    `Subject: ${opts.subject}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "MIME-Version: 1.0",
  ].filter(Boolean);
  const raw = headers.join("\r\n") + "\r\n\r\n" + opts.body;
  // base64url
  return btoa(unescape(encodeURIComponent(raw)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function gmailSearch(
  accessToken: string,
  params: { query?: string; maxResults?: number },
) {
  const max = Math.min(Math.max(params.maxResults ?? 10, 1), 25);
  const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
  url.searchParams.set("maxResults", String(max));
  if (params.query) url.searchParams.set("q", params.query);

  const listRes = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const listData = await listRes.json();
  if (!listRes.ok) throw new Error(`Gmail list failed: ${JSON.stringify(listData)}`);

  const ids: string[] = (listData.messages ?? []).map((m: { id: string }) => m.id);
  // Fetch metadata for each (parallel, capped)
  const messages = await Promise.all(
    ids.map(async (id) => {
      const r = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      const d = await r.json();
      const headersArr: { name: string; value: string }[] =
        d.payload?.headers ?? [];
      const get = (n: string) =>
        headersArr.find((h) => h.name.toLowerCase() === n.toLowerCase())?.value ?? "";
      return {
        id,
        threadId: d.threadId,
        snippet: d.snippet,
        from: get("From"),
        to: get("To"),
        subject: get("Subject"),
        date: get("Date"),
        unread: (d.labelIds ?? []).includes("UNREAD"),
      };
    }),
  );
  return { messages };
}

function decodeBase64Url(data: string): string {
  const b64 = data.replace(/-/g, "+").replace(/_/g, "/");
  try {
    return decodeURIComponent(escape(atob(b64)));
  } catch {
    return atob(b64);
  }
}

function extractPlainText(payload: any): string {
  if (!payload) return "";
  if (payload.mimeType?.startsWith("text/plain") && payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }
  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === "text/plain" && part.body?.data) {
        return decodeBase64Url(part.body.data);
      }
    }
    // Fallback to first text/* part
    for (const part of payload.parts) {
      const txt = extractPlainText(part);
      if (txt) return txt;
    }
  }
  return "";
}

async function gmailGet(accessToken: string, params: { id: string }) {
  const r = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${params.id}?format=full`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  const d = await r.json();
  if (!r.ok) throw new Error(`Gmail get failed: ${JSON.stringify(d)}`);
  const headersArr: { name: string; value: string }[] = d.payload?.headers ?? [];
  const get = (n: string) =>
    headersArr.find((h) => h.name.toLowerCase() === n.toLowerCase())?.value ?? "";
  const body = extractPlainText(d.payload).slice(0, 8000);
  return {
    id: d.id,
    threadId: d.threadId,
    from: get("From"),
    to: get("To"),
    cc: get("Cc"),
    subject: get("Subject"),
    date: get("Date"),
    body,
  };
}

async function gmailDraft(
  accessToken: string,
  params: { to: string; subject: string; body: string; cc?: string; bcc?: string },
) {
  const raw = buildRfc2822(params);
  const r = await fetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/drafts",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ message: { raw } }),
    },
  );
  const d = await r.json();
  if (!r.ok) throw new Error(`Gmail draft failed: ${JSON.stringify(d)}`);
  return { draftId: d.id, messageId: d.message?.id };
}

async function gmailSend(
  accessToken: string,
  params: { to: string; subject: string; body: string; cc?: string; bcc?: string },
) {
  const raw = buildRfc2822(params);
  const r = await fetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ raw }),
    },
  );
  const d = await r.json();
  if (!r.ok) throw new Error(`Gmail send failed: ${JSON.stringify(d)}`);
  return { messageId: d.id, threadId: d.threadId };
}

// ---------- Calendar helpers ----------

async function calendarList(
  accessToken: string,
  params: { timeMin?: string; timeMax?: string; maxResults?: number; q?: string },
) {
  const max = Math.min(Math.max(params.maxResults ?? 10, 1), 50);
  const url = new URL(
    "https://www.googleapis.com/calendar/v3/calendars/primary/events",
  );
  url.searchParams.set("singleEvents", "true");
  url.searchParams.set("orderBy", "startTime");
  url.searchParams.set("maxResults", String(max));
  url.searchParams.set("timeMin", params.timeMin ?? new Date().toISOString());
  if (params.timeMax) url.searchParams.set("timeMax", params.timeMax);
  if (params.q) url.searchParams.set("q", params.q);

  const r = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const d = await r.json();
  if (!r.ok) throw new Error(`Calendar list failed: ${JSON.stringify(d)}`);

  const events = (d.items ?? []).map((e: any) => ({
    id: e.id,
    summary: e.summary,
    description: e.description,
    location: e.location,
    start: e.start?.dateTime ?? e.start?.date,
    end: e.end?.dateTime ?? e.end?.date,
    htmlLink: e.htmlLink,
    attendees: (e.attendees ?? []).map((a: any) => ({
      email: a.email,
      responseStatus: a.responseStatus,
    })),
  }));
  return { events };
}

async function calendarCreate(
  accessToken: string,
  params: {
    summary: string;
    start: string;
    end: string;
    description?: string;
    location?: string;
    attendees?: string[];
    timeZone?: string;
  },
) {
  const tz = params.timeZone ?? "UTC";
  const body: Record<string, unknown> = {
    summary: params.summary,
    description: params.description,
    location: params.location,
    start: { dateTime: params.start, timeZone: tz },
    end: { dateTime: params.end, timeZone: tz },
  };
  if (params.attendees?.length) {
    body.attendees = params.attendees.map((email) => ({ email }));
  }
  const r = await fetch(
    "https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=all",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
  const d = await r.json();
  if (!r.ok) throw new Error(`Calendar create failed: ${JSON.stringify(d)}`);
  return {
    id: d.id,
    htmlLink: d.htmlLink,
    summary: d.summary,
    start: d.start?.dateTime ?? d.start?.date,
    end: d.end?.dateTime ?? d.end?.date,
  };
}

// ---------- Server ----------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = userData.user.id;

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { action, params } = (await req.json()) as {
      action: string;
      params: Record<string, unknown>;
    };

    if (!action) {
      return new Response(JSON.stringify({ error: "action required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const tokens = await getValidAccessToken(admin, userId);
    const at = tokens.access_token;
    let result: unknown;

    switch (action) {
      case "gmail.search":
        result = await gmailSearch(at, params as any);
        break;
      case "gmail.get":
        result = await gmailGet(at, params as any);
        break;
      case "gmail.draft":
        result = await gmailDraft(at, params as any);
        break;
      case "gmail.send":
        result = await gmailSend(at, params as any);
        break;
      case "calendar.list":
        result = await calendarList(at, params as any);
        break;
      case "calendar.create":
        result = await calendarCreate(at, params as any);
        break;
      default:
        return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }

    return new Response(JSON.stringify({ ok: true, result }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("google-tools error", err);
    return new Response(
      JSON.stringify({
        error: err instanceof Error ? err.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
