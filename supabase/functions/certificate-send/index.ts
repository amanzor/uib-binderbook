// ============================================================
//  UIB — "Send Certificate" (Supabase Edge Function)
//  ------------------------------------------------------------
//  The AMS Certificate Master calls this to e-mail a certificate of
//  insurance PDF to the certificate holder and/or the client. Sends
//  through Resend (https://resend.com), the same account the
//  "inquiry" and "prospect-notify" functions use.
//
//  WHY THIS IS SAFE TO EXPOSE
//  A certificate goes to whatever address the holder gave, so unlike
//  prospect-notify this function cannot restrict recipients to a
//  roster. Instead:
//    • only a SIGNED-IN agent can call it — the caller's access token
//      is verified with Supabase Auth, the public anon key is refused;
//    • every message is copied to the agency's certificate mailbox
//      (CERT_CC, default coi@universalinsurancebroker.com), whatever the
//      browser sends, so each certificate that leaves is on file;
//    • the attachment must be a PDF, recipients and sizes are capped,
//      and each agent is rate-limited.
//
//  DEPLOY (one time):
//    Supabase Dashboard ▸ Edge Functions ▸ Deploy a new function,
//    name it exactly "certificate-send", paste this file, Deploy.
//    (or: supabase functions deploy certificate-send)
//
//  SECRETS (Edge Functions ▸ Manage secrets):
//    RESEND_API_KEY  = re_...  (already set for prospect-notify / inquiry)
//    CERT_FROM       = Universal Insurance Brokers <coi@universalinsurancebroker.com>
//                      (optional; falls back to PROSPECT_FROM, INQUIRY_FROM,
//                       then onboarding@resend.dev — which only delivers to
//                       the Resend account's own address, so verify the
//                       domain in Resend before relying on this.)
//    CERT_CC         = coi@universalinsurancebroker.com   (optional)
//    CERT_REPLY_TO   = coi@universalinsurancebroker.com   (optional; defaults to CERT_CC)
//  SUPABASE_URL and SUPABASE_ANON_KEY are injected automatically.
// ============================================================

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const DEFAULT_FROM = "Universal Insurance Brokers <onboarding@resend.dev>";
const DEFAULT_CC = "coi@universalinsurancebroker.com";
const EMAIL_RE = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;
const MAX_TO = 10;
const MAX_CC = 5;
const MAX_PDF_BYTES = 6 * 1024 * 1024;

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...CORS, "content-type": "application/json" } });
}

const esc = (v: unknown) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));

// ── Caller must be a signed-in Supabase user ───────────────────
// uib-auth.js swaps the anon key in the Authorization header for the
// user's access token, so an agent's browser sends their token here.
async function requireUser(req: Request): Promise<{ id: string; email: string } | Response> {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  if (!token || !url) return json({ ok: false, error: "Sign in to send certificates." }, 401);
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    if (payload.role !== "authenticated") return json({ ok: false, error: "Sign in to send certificates." }, 401);
  } catch { return json({ ok: false, error: "Sign in to send certificates." }, 401); }
  const res = await fetch(`${url}/auth/v1/user`, { headers: { apikey: anon, Authorization: `Bearer ${token}` } });
  if (!res.ok) return json({ ok: false, error: "Your session expired. Sign in again." }, 401);
  const u = await res.json();
  return { id: String(u.id ?? ""), email: String(u.email ?? "") };
}

// Per-agent cap (per function instance).
const RATE_WINDOW_MS = 60 * 60 * 1000;
const RATE_MAX = 100;
const hits = new Map<string, number[]>();
function rateLimited(who: string): boolean {
  const now = Date.now();
  const arr = (hits.get(who) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (arr.length >= RATE_MAX) { hits.set(who, arr); return true; }
  arr.push(now); hits.set(who, arr); return false;
}

function cleanList(v: unknown): string[] {
  const out: string[] = [];
  for (const raw of Array.isArray(v) ? v : []) {
    const e = String(raw ?? "").trim();
    if (e && !out.some((x) => x.toLowerCase() === e.toLowerCase())) out.push(e);
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "POST only." }, 405);

  const who = await requireUser(req);
  if (who instanceof Response) return who;
  if (rateLimited(who.id || who.email)) return json({ ok: false, error: "Too many certificates sent in the last hour. Try again later." }, 429);

  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) return json({ ok: false, error: "RESEND_API_KEY is not set in Supabase (Edge Functions ▸ Manage secrets)." }, 503);

  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return json({ ok: false, error: "Bad request." }, 400);

  const to = cleanList(body.to);
  const agencyCc = (Deno.env.get("CERT_CC") ?? DEFAULT_CC).trim();
  const cc = cleanList(body.cc).filter((e) => e.toLowerCase() !== agencyCc.toLowerCase());
  cc.unshift(agencyCc);
  const bad = to.concat(cc).filter((e) => !EMAIL_RE.test(e));
  if (!to.length) return json({ ok: false, error: "No recipient." }, 400);
  if (bad.length) return json({ ok: false, error: `Not a valid e-mail address: ${bad.join(", ")}` }, 400);
  if (to.length > MAX_TO || cc.length > MAX_CC) return json({ ok: false, error: "Too many recipients." }, 400);

  const subject = String(body.subject ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, 200);
  const text = String(body.text ?? "").slice(0, 5000);
  if (!subject) return json({ ok: false, error: "No subject." }, 400);

  let filename = String(body.filename ?? "certificate.pdf").replace(/[^\w.\- ]+/g, "").trim() || "certificate.pdf";
  if (!/\.pdf$/i.test(filename)) filename += ".pdf";
  const pdf = String(body.pdfBase64 ?? "").replace(/\s+/g, "");
  if (!pdf || pdf.length > Math.ceil(MAX_PDF_BYTES / 3) * 4) return json({ ok: false, error: "The certificate PDF is missing or too large." }, 400);
  // The attachment must actually be a PDF ("%PDF" base64-encodes to "JVBERi").
  if (!pdf.startsWith("JVBERi")) return json({ ok: false, error: "The attachment is not a PDF." }, 400);

  const certNo = String(body.certNo ?? "").slice(0, 60);
  const footer = `Sent by ${who.email || "an agent"} for Universal Insurance Brokers${certNo ? ` · ${certNo}` : ""}.`;
  const html = `<div style="font-family:system-ui,Segoe UI,Arial,sans-serif;max-width:620px;color:#0f172a;font-size:14px;line-height:1.55;">
  ${esc(text).replace(/\n/g, "<br>")}
  <div style="font-size:12px;color:#94a3b8;margin-top:18px;border-top:1px solid #e2e8f0;padding-top:10px;">📎 ${esc(filename)}<br>${esc(footer)}</div>
</div>`;

  const from = Deno.env.get("CERT_FROM") ?? Deno.env.get("PROSPECT_FROM") ?? Deno.env.get("INQUIRY_FROM") ?? DEFAULT_FROM;
  const replyTo = (Deno.env.get("CERT_REPLY_TO") ?? agencyCc).trim();

  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      from, to, cc, subject, reply_to: replyTo,
      text: `${text}\n\n— ${footer}`, html,
      attachments: [{ filename, content: pdf }],
    }),
  });
  const out = await r.json().catch(() => ({}));
  if (!r.ok) return json({ ok: false, error: `Email service: ${out?.message ?? out?.error ?? ("HTTP " + r.status)}` }, 502);
  return json({ ok: true, id: out.id, to, cc });
});
