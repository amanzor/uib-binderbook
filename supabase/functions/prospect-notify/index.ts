// ============================================================
//  UIB — "New Prospect" agent notification (Supabase Edge Function)
//  ------------------------------------------------------------
//  The Binder Book calls this when a New Prospect is saved. It emails
//  the prospect's form details to the agent(s) assigned on the form.
//  Sends through Resend (https://resend.com), the same account the
//  "inquiry" function already uses.
//
//  WHY THE BROWSER SENDS NAMES, NOT ADDRESSES
//  The browser only ever sends assigned agent NAMES. This function
//  looks the addresses up itself in the agent roster, so the endpoint
//  can never be used to mail an arbitrary address — it can only reach
//  people who are already registered agents.
//
//  DEPLOY (one time):
//    Supabase Dashboard ▸ Edge Functions ▸ Deploy a new function,
//    name it exactly "prospect-notify", paste this file, Deploy.
//    (or: supabase functions deploy prospect-notify)
//
//  SECRETS (Edge Functions ▸ Manage secrets):
//    RESEND_API_KEY  = re_...   from resend.com ▸ API Keys   (required)
//    PROSPECT_FROM   = UIB Binder Book <prospects@universalinsurancebroker.com>
//                      (optional; falls back to INQUIRY_FROM, then to
//                       onboarding@resend.dev. The resend.dev sender can only
//                       deliver to the address the Resend account was created
//                       with, so verify the domain before relying on this.)
//    PROSPECT_BCC    = manager@universalinsurancebroker.com   (optional)
//  SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically.
// ============================================================

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const DEFAULT_FROM = "UIB Binder Book <onboarding@resend.dev>";

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...CORS, "content-type": "application/json" } });
}

// Abuse guard: this endpoint is reachable with the public anon key, so cap
// how often one caller can fire notifications (per function instance).
const RATE_WINDOW_MS = 60 * 60 * 1000;
const RATE_MAX = 60;
const hits = new Map<string, number[]>();
function rateLimited(ip: string): boolean {
  const now = Date.now();
  const arr = (hits.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (arr.length >= RATE_MAX) { hits.set(ip, arr); return true; }
  arr.push(now); hits.set(ip, arr); return false;
}

const esc = (v: unknown) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Read one app_store row with the service role key.
async function readStore(key: string): Promise<Record<string, unknown> | null> {
  const url = Deno.env.get("SUPABASE_URL");
  const srv = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !srv) return null;
  try {
    const r = await fetch(`${url}/rest/v1/app_store?select=value&key=eq.${encodeURIComponent(key)}`, {
      headers: { apikey: srv, authorization: `Bearer ${srv}` },
    });
    if (!r.ok) return null;
    const rows = await r.json();
    const v = rows?.[0]?.value;
    return v && typeof v === "object" ? v as Record<string, unknown> : null;
  } catch { return null; }
}

// Build "Agent Name" -> email from the roster. agentMasterData is the
// canonical list; agentCredentials fills in anyone missing from it.
async function agentDirectory(): Promise<Record<string, string>> {
  const dir: Record<string, string> = {};
  for (const key of ["agentCredentials", "agentMasterData"]) {
    const rows = await readStore(key);
    if (!rows) continue;
    for (const [name, rec] of Object.entries(rows)) {
      const email = String((rec as Record<string, unknown> | null)?.email ?? "").trim();
      if (email && EMAIL_RE.test(email)) dir[name.trim().toLowerCase()] = email;
    }
  }
  return dir;
}

// Field order shown in the email. Keys match what the Binder Book sends.
const FIELDS: Array<[string, string]> = [
  ["name", "Name"],
  ["businessName", "Business"],
  ["phone", "Phone"],
  ["phone2", "Alternate Phone"],
  ["email", "Email"],
  ["address", "Address"],
  ["currentCoverage", "Current Coverage"],
  ["quotedPremium", "Quoted Premium"],
  ["lob", "Line of Business"],
  ["source", "Source"],
  ["referredBy", "Referred By"],
  ["followUpDate", "Follow-Up Date"],
  ["dateAdded", "Date Added"],
  ["agent", "Assigned Agent(s)"],
  ["notes", "Notes"],
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "POST only" }, 405);

  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() ||
    req.headers.get("cf-connecting-ip") || "unknown";
  if (rateLimited(ip)) return json({ ok: false, error: "Too many requests. Please try again later." }, 429);

  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) {
    return json({ ok: false, error: "RESEND_API_KEY secret is not set in Supabase (Edge Functions ▸ Manage secrets)." }, 500);
  }

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ ok: false, error: "Body must be JSON" }, 400); }

  const p = (body.prospect && typeof body.prospect === "object" ? body.prospect : {}) as Record<string, unknown>;
  const names = (Array.isArray(body.agents) ? body.agents : [])
    .map((n) => String(n ?? "").trim()).filter(Boolean).slice(0, 20);
  if (!names.length) return json({ ok: false, error: "No assigned agent on the prospect — nothing to notify." }, 400);

  // Resolve names to addresses here, never from the request body.
  const dir = await agentDirectory();
  const to: string[] = [];
  const matched: string[] = [];
  const missing: string[] = [];
  for (const n of names) {
    const email = dir[n.toLowerCase()];
    if (email) { if (!to.includes(email)) { to.push(email); matched.push(n); } }
    else missing.push(n);
  }
  if (!to.length) {
    return json({
      ok: false, missing,
      error: `No email address on file for: ${missing.join(", ")}. Add it in Agent Management.`,
    }, 422);
  }

  const first = String(p.firstName ?? "").trim();
  const last = String(p.lastName ?? "").trim();
  const full = [first, last].filter(Boolean).join(" ") || "New prospect";
  const view: Record<string, string> = {
    name: full,
    phone: String(p.phone ?? "").trim(),
    email: String(p.email ?? "").trim(),
    businessName: String(p.businessName ?? "").trim(),
    phone2: String(p.phone2 ?? "").trim(),
    address: [p.address, p.city, [p.state, p.zip].filter(Boolean).join(" ")]
      .map((v) => String(v ?? "").trim()).filter(Boolean).join(", "),
    currentCoverage: [
      String(p.currentCarrier ?? "").trim(),
      p.currentPolicyNumber ? `#${String(p.currentPolicyNumber).trim()}` : "",
      p.policyExpiration ? `expires ${String(p.policyExpiration).trim()}` : "",
      Number(p.currentPremium) ? `$${Number(p.currentPremium).toLocaleString("en-US")}` : "",
    ].filter(Boolean).join(" · "),
    quotedPremium: Number(p.quotedPremium) ? `$${Number(p.quotedPremium).toLocaleString("en-US")}` : "",
    lob: String(p.lob ?? "").trim(),
    source: String(p.source ?? "").trim(),
    referredBy: String(p.referredBy ?? "").trim(),
    followUpDate: String(p.followUpDate ?? "").trim(),
    dateAdded: String(p.dateAdded ?? "").trim(),
    agent: String(p.agent ?? matched.join(", ")).trim(),
    notes: String(p.notes ?? "").trim(),
  };
  const addedBy = String(body.submittedBy ?? "").trim();

  const rows = FIELDS.filter(([k]) => view[k]);
  const text = [
    `New prospect assigned to you${addedBy ? ` by ${addedBy}` : ""}.`,
    "",
    ...rows.map(([k, label]) => `${label}: ${view[k]}`),
    "",
    "— UIB Binder Book",
  ].join("\n");

  const html = `<div style="font-family:system-ui,Segoe UI,Arial,sans-serif;max-width:620px;color:#0f172a;">
  <div style="background:linear-gradient(135deg,#0d1f3c,#1d4ed8);color:#fff;padding:18px 22px;border-radius:12px 12px 0 0;">
    <div style="font-size:18px;font-weight:700;">New Prospect Assigned</div>
    <div style="font-size:13px;opacity:.85;margin-top:3px;">${esc(full)}${addedBy ? ` · added by ${esc(addedBy)}` : ""}</div>
  </div>
  <table style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 12px 12px;">
    ${rows.map(([k, label], i) => `<tr style="background:${i % 2 ? "#f8fafc" : "#fff"};">
      <td style="padding:10px 14px;font-size:13px;color:#64748b;white-space:nowrap;vertical-align:top;width:170px;">${esc(label)}</td>
      <td style="padding:10px 14px;font-size:14px;font-weight:600;">${esc(view[k]).replace(/\n/g, "<br>")}</td>
    </tr>`).join("")}
  </table>
  <div style="font-size:12px;color:#94a3b8;margin-top:14px;">Sent automatically by the UIB Binder Book when the prospect was saved.</div>
</div>`;

  const from = Deno.env.get("PROSPECT_FROM") ?? Deno.env.get("INQUIRY_FROM") ?? DEFAULT_FROM;
  const bcc = (Deno.env.get("PROSPECT_BCC") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  // Replying to the notification reaches the client directly when they gave an address.
  const replyTo = view.email && EMAIL_RE.test(view.email) ? view.email : undefined;

  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      from, to, subject: `New Prospect: ${full}${view.lob ? ` — ${view.lob}` : ""}`,
      text, html, reply_to: replyTo, bcc: bcc.length ? bcc : undefined,
    }),
  });
  const out = await r.json().catch(() => ({}));
  if (!r.ok) {
    return json({ ok: false, error: `Email service: ${out?.message ?? out?.error ?? ("HTTP " + r.status)}`, missing }, 502);
  }
  return json({ ok: true, id: out.id, to, notified: matched, missing });
});
