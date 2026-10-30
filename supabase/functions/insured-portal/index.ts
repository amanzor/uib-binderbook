// ============================================================
//  UIB — Client Portal lookup (Supabase Edge Function)
//  ------------------------------------------------------------
//  The client portal (insured-portal.html) calls this with the last
//  name and a policy or binder number the client typed. It answers
//  with ONLY what a client is meant to see:
//    • their policies — carrier, line, transaction, dates, status,
//      policy number — and never premiums, fees, commissions or
//      payment details;
//    • their agent's name, e-mail and phone;
//    • the documents an agent marked "Client can see" in the AMS
//      (clientSharedDocs), as short-lived download links.
//  Nothing else of the book leaves the server, and a client can never
//  reach another client's data: the name and number must match the
//  same policy entry.
//
//  DEPLOY (one time):
//    Supabase Dashboard ▸ Edge Functions ▸ Deploy a new function,
//    name it exactly "insured-portal", paste this file, Deploy.
//    (or: supabase functions deploy insured-portal --no-verify-jwt)
//    Turn OFF "Verify JWT" for this function: clients have no login.
//  No secrets to add: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are
//  injected automatically.
// ============================================================

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const BUCKET = "client-files";
const LINK_SECONDS = 15 * 60;

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...CORS, "content-type": "application/json" } });
}

// Guessing names and numbers is the attack, so cap attempts per caller.
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX = 20;
const hits = new Map<string, number[]>();
function rateLimited(ip: string): boolean {
  const now = Date.now();
  const arr = (hits.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (arr.length >= RATE_MAX) { hits.set(ip, arr); return true; }
  arr.push(now); hits.set(ip, arr); return false;
}

const URL_ = Deno.env.get("SUPABASE_URL") ?? "";
const SRV = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const H = { apikey: SRV, authorization: `Bearer ${SRV}` };

async function readStore(key: string): Promise<unknown> {
  const r = await fetch(`${URL_}/rest/v1/app_store?select=value&key=eq.${encodeURIComponent(key)}`, { headers: H });
  if (!r.ok) return null;
  const rows = await r.json();
  return rows?.[0]?.value ?? null;
}

const clientKey = (n: unknown) => String(n ?? "").trim().toUpperCase().replace(/\s+/g, " ");
const isCancel = (p: Record<string, unknown>) =>
  /^canc/i.test(String(p.policyType ?? "")) || /^cancell?ed$/i.test(String(p.policyStatus ?? ""));

function txnLabel(t: string): string {
  if (/^new/i.test(t) || /^nbs$/i.test(t)) return "New";
  if (/renew\s*a\s*-?\s*b/i.test(t)) return "Renew A-B";
  if (/^renew/i.test(t)) return "Renew";
  if (/^end/i.test(t)) return "Endorsement";
  if (/^rewrite/i.test(t)) return "Rewrite";
  if (/^misc/i.test(t)) return "Miscellaneous";
  return "";
}

function statusOf(p: Record<string, unknown>): string {
  const today = new Date().toISOString().slice(0, 10);
  if (isCancel(p)) return "Canceled";
  const cd = String(p.cancellationDate ?? "").slice(0, 10);
  if (cd && cd <= today) return "Canceled";
  const st = String(p.policyStatus ?? "");
  if (["Active", "Pending Cancellation", "Expired"].includes(st)) return st;
  const exp = String(p.expirationDate ?? "").slice(0, 10);
  return exp && exp < today ? "Expired" : "Active";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "POST only." }, 405);
  if (!URL_ || !SRV) return json({ ok: false, error: "Portal is not configured." }, 503);

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
  if (rateLimited(ip)) return json({ ok: false, error: "Too many attempts. Please wait a few minutes and try again." }, 429);

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const last = String(body.lastName ?? "").trim().toUpperCase();
  const num = String(body.policyNumber ?? "").trim().toUpperCase();
  if (last.length < 2 || num.length < 3) return json({ ok: false, error: "Enter your last name and policy or binder number." }, 400);

  const raw = await readStore("binderData");
  const book = (Array.isArray(raw) ? raw : (raw && Array.isArray((raw as { value?: unknown }).value) ? (raw as { value: unknown[] }).value : [])) as Record<string, unknown>[];

  const match = book.find((e) => {
    const p = String(e.policyNumber ?? "").toUpperCase(), b = String(e.binderNumber ?? "").toUpperCase();
    if (p !== num && b !== num) return false;
    return clientKey(e.customerName).split(" ").some((w) => w === last);
  });
  // Same answer for "no such number" and "wrong name", so it confirms nothing.
  if (!match) return json({ ok: false, error: "No policy found matching that name and number. Please check your details and try again." }, 404);

  const key = clientKey(match.customerName);
  const mine = book.filter((e) => clientKey(e.customerName) === key);

  // One row per policy number (its latest entry); cancellations mark it canceled.
  const byNum = new Map<string, Record<string, unknown>[]>();
  mine.forEach((e, i) => {
    const k = String(e.policyNumber ?? "").trim().toUpperCase() || "#" + i;
    byNum.set(k, [...(byNum.get(k) ?? []), e]);
  });
  const policies = [...byNum.values()].map((list) => {
    const live = list.filter((e) => !isCancel(e));
    const latest = (live.length ? live : list).slice().sort((a, b) =>
      String(b.expirationDate ?? b.entryDate ?? "").localeCompare(String(a.expirationDate ?? a.entryDate ?? "")))[0];
    const canceled = list.some((e) => statusOf(e) === "Canceled");
    return {
      policyNumber: latest.policyNumber ?? "",
      carrier: latest.company ?? "",
      lineOfBusiness: latest.lineOfBusiness ?? "",
      transaction: txnLabel(String(latest.policyType ?? "")),
      effectiveDate: latest.effectiveDate ?? latest.effDate ?? "",
      expirationDate: latest.expirationDate ?? "",
      term: latest.term ?? "",
      status: canceled ? "Canceled" : statusOf(latest),
      agent: latest.agent ?? "",
    };
  }).sort((a, b) => String(b.effectiveDate).localeCompare(String(a.effectiveDate)));

  // The agent(s) and how to reach them.
  const roster = ((await readStore("agentMasterData")) ?? {}) as Record<string, Record<string, unknown>>;
  const agents = [...new Set(policies.map((p) => String(p.agent)).filter(Boolean))].map((n) => ({
    name: n, email: String(roster[n]?.email ?? ""), phone: String(roster[n]?.phone ?? ""),
  }));

  // Only documents an agent shared with this client.
  const shared = ((await readStore("clientSharedDocs")) ?? {}) as Record<string, Record<string, unknown>>;
  const ids = Object.values(shared).filter((r) => r && r.shared && clientKey(r.clientKey) === key).map((r) => String(r.docId));
  let documents: unknown[] = [];
  if (ids.length) {
    const r = await fetch(`${URL_}/rest/v1/documents?select=id,file_name,category,storage_path,size_bytes,mime_type,uploaded_at,client_key` +
      `&id=in.(${ids.map(encodeURIComponent).join(",")})&client_key=eq.${encodeURIComponent(key)}`, { headers: H });
    const rows = r.ok ? await r.json() as Record<string, unknown>[] : [];
    documents = await Promise.all(rows.map(async (d) => {
      const path = String(d.storage_path ?? "");
      const s = await fetch(`${URL_}/storage/v1/object/sign/${BUCKET}/${path.split("/").map(encodeURIComponent).join("/")}`, {
        method: "POST", headers: { ...H, "content-type": "application/json" }, body: JSON.stringify({ expiresIn: LINK_SECONDS }),
      });
      const signed = s.ok ? await s.json() : {};
      const rel = String(signed.signedURL ?? signed.signedUrl ?? "");
      return {
        id: d.id, name: d.file_name, category: d.category || "Other", size: d.size_bytes || 0,
        type: d.mime_type || "", uploadedAt: d.uploaded_at,
        url: rel ? `${URL_}/storage/v1${rel.startsWith("/") ? "" : "/"}${rel}` : "",
      };
    }));
  }

  return json({ ok: true, displayName: match.customerName, policies, agents, documents });
});
