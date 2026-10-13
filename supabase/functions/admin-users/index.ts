// ============================================================
//  UIB Binder Book — agent login management (Supabase Edge Function)
//  ------------------------------------------------------------
//  Lets a signed-in ADMINISTRATOR manage agent accounts from the app's
//  "Manage Login Credentials" page, without touching the Supabase
//  dashboard: list accounts, create one, reset a password, link the agent
//  name, clear 2-step verification, delete.
//
//  Security: the caller's access token is verified with Supabase Auth and
//  must belong to an administrator (app_metadata.role = "admin", or an
//  email in ADMIN_EMAILS). Only then is the service-role key used.
//
//  DEPLOY: Dashboard ▸ Edge Functions ▸ Deploy a new function ▸ name it
//  exactly "admin-users" ▸ paste this file ▸ Deploy. No extra secrets are
//  needed: SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are
//  provided automatically.
// ============================================================

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const ADMIN_EMAILS = ["admin@universalinsurancebroker.com", "amanzor89@gmail.com"];

type Dict = Record<string, unknown>;
function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...CORS, "content-type": "application/json" } });
}

const URL_ = Deno.env.get("SUPABASE_URL") ?? "";
const ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

async function requireAdmin(req: Request): Promise<Response | { id: string; email: string }> {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token || !URL_) return json({ ok: false, error: "Sign in as an administrator first." }, 401);
  const res = await fetch(`${URL_}/auth/v1/user`, { headers: { apikey: ANON, Authorization: `Bearer ${token}` } });
  if (!res.ok) return json({ ok: false, error: "Your session expired. Sign in again." }, 401);
  const u = await res.json();
  const email = String(u.email ?? "").toLowerCase();
  const isAdmin = u.app_metadata?.role === "admin" || ADMIN_EMAILS.includes(email);
  if (!isAdmin) return json({ ok: false, error: "Only administrators can manage logins." }, 403);
  return { id: String(u.id), email };
}

async function admin(method: string, path: string, body?: unknown) {
  const res = await fetch(`${URL_}/auth/v1/admin/${path}`, {
    method, headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "content-type": "application/json" },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(String(data.msg ?? data.message ?? data.error ?? `HTTP ${res.status}`));
  return data;
}

function shape(u: Dict) {
  const meta = (u.user_metadata ?? {}) as Dict; const app = (u.app_metadata ?? {}) as Dict;
  const factors = ((u.factors ?? []) as Dict[]).filter((f) => f.status === "verified");
  return {
    id: u.id, email: u.email, agent_name: meta.agent_name ?? "",
    role: app.role === "admin" || ADMIN_EMAILS.includes(String(u.email ?? "").toLowerCase()) ? "admin" : "agent",
    confirmed: !!u.email_confirmed_at, last_sign_in_at: u.last_sign_in_at ?? null, created_at: u.created_at,
    mfa: factors.length > 0, factor_ids: factors.map((f) => f.id),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "POST only" }, 405);
  if (!SERVICE) return json({ ok: false, error: "SUPABASE_SERVICE_ROLE_KEY is not available to this function." }, 500);
  const who = await requireAdmin(req);
  if (who instanceof Response) return who;

  let body: Dict;
  try { body = await req.json(); } catch { return json({ ok: false, error: "Body must be JSON" }, 400); }
  const action = String(body.action ?? "");

  try {
    if (action === "list") {
      const data = await admin("GET", "users?page=1&per_page=1000");
      const users = ((data.users ?? []) as Dict[]).map(shape).sort((a, b) => String(a.email).localeCompare(String(b.email)));
      return json({ ok: true, users });
    }
    if (action === "create") {
      const email = String(body.email ?? "").trim().toLowerCase();
      const password = String(body.password ?? "");
      const agent_name = String(body.agent_name ?? "").trim();
      const role = body.role === "admin" ? "admin" : "agent";
      if (!email || !password || !agent_name) return json({ ok: false, error: "Email, password and agent name are required." }, 400);
      if (password.length < 10) return json({ ok: false, error: "Use a password of at least 10 characters." }, 400);
      const u = await admin("POST", "users", { email, password, email_confirm: true, user_metadata: { agent_name }, app_metadata: { role } });
      return json({ ok: true, user: shape(u as Dict) });
    }
    const id = String(body.id ?? "");
    if (!id) return json({ ok: false, error: "Missing user id." }, 400);
    if (action === "setPassword") {
      const password = String(body.password ?? "");
      if (password.length < 10) return json({ ok: false, error: "Use a password of at least 10 characters." }, 400);
      const u = await admin("PUT", `users/${id}`, { password, email_confirm: true });
      return json({ ok: true, user: shape(u as Dict) });
    }
    if (action === "setName") {
      const agent_name = String(body.agent_name ?? "").trim();
      const u = await admin("PUT", `users/${id}`, { user_metadata: { agent_name } });
      return json({ ok: true, user: shape(u as Dict) });
    }
    if (action === "setRole") {
      const role = body.role === "admin" ? "admin" : "agent";
      const u = await admin("PUT", `users/${id}`, { app_metadata: { role } });
      return json({ ok: true, user: shape(u as Dict) });
    }
    if (action === "confirm") {
      const u = await admin("PUT", `users/${id}`, { email_confirm: true });
      return json({ ok: true, user: shape(u as Dict) });
    }
    if (action === "clearMfa") {
      const u = await admin("GET", `users/${id}`);
      for (const f of ((u as Dict).factors ?? []) as Dict[]) { await admin("DELETE", `users/${id}/factors/${f.id}`); }
      return json({ ok: true });
    }
    if (action === "delete") {
      if (id === who.id) return json({ ok: false, error: "You cannot delete the account you are signed in with." }, 400);
      await admin("DELETE", `users/${id}`);
      return json({ ok: true });
    }
    return json({ ok: false, error: `Unknown action "${action}".` }, 400);
  } catch (e) {
    return json({ ok: false, error: (e as Error).message || String(e) }, 500);
  }
});
