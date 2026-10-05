// ============================================================
//  UIB Auto Rater — "New Inquiry" email (Supabase Edge Function)
//  ------------------------------------------------------------
//  MAX (the in-app assistant) calls this to email a new inquiry
//  (client, driver's license, VIN, phone, email, photos) to the
//  office inbox. It sends through Resend (https://resend.com).
//
//  DEPLOY (one time):
//    Supabase Dashboard ▸ Edge Functions ▸ Deploy a new function
//    name it exactly "inquiry", paste this file, Deploy.
//    (or: supabase functions deploy inquiry)
//
//  SECRETS (Edge Functions ▸ Manage secrets):
//    RESEND_API_KEY = re_...        from resend.com ▸ API Keys
//    INQUIRY_TO     = quotes@universalinsurancebroker.com   (optional; this is the default)
//    INQUIRY_FROM   = UIB Auto Rater <quotes@universalinsurancebroker.com>
//                     (optional; requires the domain to be verified in Resend.
//                      Without it the default sender onboarding@resend.dev is
//                      used, which can only deliver to the email address the
//                      Resend account was created with — so create the Resend
//                      account with the INQUIRY_TO address.)
// ============================================================

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const DEFAULT_TO = "quotes@universalinsurancebroker.com";
const DEFAULT_FROM = "UIB Auto Rater <onboarding@resend.dev>";
const MAX_ATTACHMENTS = 6;
const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024; // per file, after base64 decoding (~5.4 MB encoded)

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...CORS, "content-type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "POST only" }, 405);

  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) return json({ ok: false, error: "RESEND_API_KEY secret is not set in Supabase (Edge Functions ▸ Manage secrets)." }, 500);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ ok: false, error: "Body must be JSON" }, 400); }

  const subject = String(body.subject ?? "New Inquiry").slice(0, 200);
  const text = String(body.text ?? "");
  const html = body.html ? String(body.html) : undefined;
  if (!text && !html) return json({ ok: false, error: "Nothing to send" }, 400);

  const attachments = (Array.isArray(body.attachments) ? body.attachments : [])
    .slice(0, MAX_ATTACHMENTS)
    .map((a: Record<string, unknown>) => ({ filename: String(a.filename ?? "photo.jpg").replace(/[^\w.-]/g, "_"), content: String(a.content ?? "") }))
    .filter((a) => a.content && (a.content.length * 3) / 4 <= MAX_ATTACHMENT_BYTES);

  const to = (Deno.env.get("INQUIRY_TO") ?? DEFAULT_TO).split(",").map((s) => s.trim()).filter(Boolean);
  const from = Deno.env.get("INQUIRY_FROM") ?? DEFAULT_FROM;
  const replyTo = body.replyTo ? String(body.replyTo) : undefined;

  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "authorization": `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ from, to, subject, text, html, reply_to: replyTo, attachments }),
  });
  const out = await r.json().catch(() => ({}));
  if (!r.ok) return json({ ok: false, error: `Email service: ${out?.message ?? out?.error ?? ("HTTP " + r.status)}` }, 502);
  return json({ ok: true, id: out.id, to });
});
