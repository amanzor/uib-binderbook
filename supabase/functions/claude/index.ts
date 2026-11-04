// ============================================================
//  UIB Claude AI Proxy — Supabase Edge Function
//  ------------------------------------------------------------
//  Replaces the flaky Google Apps Script proxy.
//  The browser calls this function; it forwards to the Anthropic
//  API using a secret key stored in Supabase (never in the app).
//
//  DEPLOY:
//    Supabase Dashboard ▸ Edge Functions ▸ Deploy a new function
//    name it exactly "claude", paste this file, Deploy.
//  SET THE SECRET (one time):
//    Edge Functions ▸ Manage secrets ▸ add
//      ANTHROPIC_API_KEY = sk-ant-...   (your real key)
// ============================================================

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, "content-type": "application/json" },
  });
}


// ── Caller must be a signed-in Supabase user ───────────────────
// The browser sends the user's access token (uib-auth.js rewrites the
// Authorization header). The public anon key alone is refused, so only
// agents who signed in can reach this function.
async function requireUser(req: Request): Promise<{ id: string; email: string; role: string } | Response> {
  const auth = req.headers.get("authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  if (!token || !url) return json({ error: "Sign in to use this feature." }, 401);
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    if (payload.role !== "authenticated") return json({ error: "Sign in to use this feature." }, 401);
  } catch { return json({ error: "Sign in to use this feature." }, 401); }
  const res = await fetch(`${url}/auth/v1/user`, { headers: { apikey: anon, Authorization: `Bearer ${token}` } });
  if (!res.ok) return json({ error: "Your session expired. Sign in again." }, 401);
  const u = await res.json();
  return { id: String(u.id ?? ""), email: String(u.email ?? ""), role: String(u.app_metadata?.role ?? "agent") };
}

Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const who = await requireUser(req);
  if (who instanceof Response) return who;

  try {
    const key = Deno.env.get("ANTHROPIC_API_KEY");
    if (!key) {
      return json({ error: { type: "config_error", message: "ANTHROPIC_API_KEY secret is not set in Supabase. Add it under Edge Functions ▸ Manage secrets." } }, 500);
    }

    const incoming = await req.json().catch(() => ({}));
    // Accept both the direct shape {model,...} and the legacy {action,body}.
    const p = incoming.body || incoming;

    // Callers opt into streaming with {stream:true}. Streaming forwards
    // Anthropic's server-sent events straight to the browser as they are
    // produced, so bytes keep flowing and Supabase's 150-second idle timeout
    // never fires on long PDF extractions. Non-streaming callers (e.g. the
    // Binder Book app) keep the original buffered-JSON behavior unchanged.
    const wantStream = p.stream === true;

    // Server-side ceiling on spend per call, whatever the browser asks for.
    if (typeof p.max_tokens === "number" && p.max_tokens > 16000) p.max_tokens = 16000;
    const payload: Record<string, unknown> = {
      model: p.model || "claude-sonnet-4-6",
      max_tokens: p.max_tokens || 4096,
      messages: p.messages || [],
    };
    if (p.system) payload.system = p.system;
    if (wantStream) payload.stream = true;

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    // Streaming request that Anthropic accepted → pipe the SSE body through.
    if (wantStream && r.ok && r.body) {
      return new Response(r.body, {
        status: 200,
        headers: { ...CORS, "content-type": "text/event-stream", "cache-control": "no-cache" },
      });
    }

    // Non-streaming callers, and every error response (always JSON), pass
    // straight back to the browser as before.
    const text = await r.text();
    return new Response(text, {
      status: r.status,
      headers: { ...CORS, "content-type": "application/json" },
    });
  } catch (e) {
    return json({ error: { type: "proxy_error", message: String(e) } }, 500);
  }
});
