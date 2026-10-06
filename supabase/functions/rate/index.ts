// ============================================================
//  UIB Auto Rater — carrier rating proxy (Supabase Edge Function)
//  ------------------------------------------------------------
//  The browser never talks to a carrier directly and never sees
//  carrier credentials. It sends { carrier, quote } here; this
//  function:
//    1. loads the carrier's credentials from Supabase secrets
//       (RATER_<PREFIX>_USERNAME / _PASSWORD / _APIKEY / _TOKEN)
//    2. builds the request from the carrier's template
//    3. calls the carrier's rating endpoint
//    4. maps the response to { premium, downPayment, monthly, ... }
//
//  DEPLOY (one time, ~2 minutes):
//    Supabase Dashboard ▸ Edge Functions ▸ Deploy a new function
//    name it exactly "rate", paste this whole file, Deploy.
//    (or: supabase functions deploy rate)
//
//  SECRETS (Edge Functions ▸ Manage secrets):
//    RATER_PROG_USERNAME = agency login        ← one set per carrier,
//    RATER_PROG_PASSWORD = agency password       PREFIX = the "Secret
//    RATER_PROG_APIKEY   = api key (if any)      Prefix" you typed on
//    RATER_PROG_TOKEN    = bearer token (if any) the carrier card
//    RATER_PROG_HEADERS  = {"x-producer-code":"12345"}   (optional extra headers, JSON)
//    RATER_ALLOWED_HOSTS = api.carrier1.com,rating.carrier2.com
//                          (optional but recommended: only these hosts may be called)
// ============================================================

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Dict = Record<string, unknown>;

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...CORS, "content-type": "application/json" } });
}

function getPath(obj: unknown, path: string): unknown {
  if (!path) return undefined;
  return path.split(".").reduce<unknown>((o, k) => (o == null ? undefined : (o as Dict)[k]), obj);
}

function secret(prefix: string, name: string): string {
  if (!prefix) return "";
  return Deno.env.get(`RATER_${prefix}_${name}`) ?? "";
}

function escJson(s: string): string {
  // JSON-escape without the surrounding quotes
  return JSON.stringify(s).slice(1, -1);
}
function escXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c] as string));
}

// Fill {{path}}, {{json:path}}, {{USERNAME}}, {{PASSWORD}}, {{APIKEY}}, {{TOKEN}}
function fillTemplate(tpl: string, quote: Dict, creds: Dict, contentType: string): string {
  const esc = contentType === "xml" ? escXml : contentType === "form" ? encodeURIComponent : escJson;
  return tpl.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_m, key: string) => {
    if (key.startsWith("json:")) {
      const p = key.slice(5).trim();
      const v = p === "quote" ? quote : getPath(quote, p);
      return v === undefined ? "null" : JSON.stringify(v);
    }
    if (/^(USERNAME|PASSWORD|APIKEY|TOKEN|PRODUCER|SUBCODE)$/.test(key)) return esc(String(creds[key] ?? ""));
    const v = getPath(quote, key);
    if (v === undefined || v === null) return "";
    if (typeof v === "object") return esc(JSON.stringify(v));
    return esc(String(v));
  });
}

function extract(body: unknown, rawText: string, path: string): unknown {
  if (!path) return undefined;
  if (path.startsWith("regex:")) {
    try {
      const re = new RegExp(path.slice(6), "i");
      const m = rawText.match(re);
      return m ? (m[1] ?? m[0]) : undefined;
    } catch { return undefined; }
  }
  return getPath(body, path);
}

function toNumber(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ""));
  return isNaN(n) ? null : n;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "POST only" }, 405);

  let body: Dict;
  try { body = await req.json(); } catch { return json({ ok: false, error: "Body must be JSON" }, 400); }

  const carrier = (body.carrier ?? {}) as Dict;
  const quote = (body.quote ?? {}) as Dict;
  const test = body.test === true;

  const name = String(carrier.name ?? "Carrier");
  const method = String(carrier.method ?? "api");
  if (method !== "api") return json({ ok: false, error: `${name} is set to "${method}" rating, not API.` }, 400);

  const prefix = String(carrier.secretPrefix ?? "").toUpperCase().replace(/[^A-Z0-9_]/g, "_");
  // Supabase secrets win; the carrier card's account fields are the fallback
  // so a carrier works as soon as the agency types its login on the card.
  const creds: Dict = {
    USERNAME: secret(prefix, "USERNAME") || String(carrier.username ?? ""),
    PASSWORD: secret(prefix, "PASSWORD") || String(carrier.password ?? ""),
    APIKEY: secret(prefix, "APIKEY"),
    TOKEN: secret(prefix, "TOKEN"),
    PRODUCER: String(carrier.producerCode ?? ""),
    SUBCODE: String(carrier.subCode ?? ""),
  };
  const secretsFound = ["USERNAME", "PASSWORD", "APIKEY", "TOKEN"].filter((k) => secret(prefix, k));
  const cardFound = ["username", "password", "producerCode"].filter((k) => String(carrier[k] ?? ""));

  const endpoint = String(carrier.endpoint ?? "").trim();
  if (!endpoint) return json({ ok: false, error: `${name}: no rating endpoint URL configured.` }, 400);
  let url: URL;
  try { url = new URL(endpoint); } catch { return json({ ok: false, error: `${name}: endpoint is not a valid URL.` }, 400); }
  if (url.protocol !== "https:") return json({ ok: false, error: `${name}: endpoint must use https.` }, 400);

  // Optional allow-list so this function can only ever call carriers you approved.
  const allowed = (Deno.env.get("RATER_ALLOWED_HOSTS") ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (allowed.length && !allowed.includes(url.hostname.toLowerCase())) {
    return json({ ok: false, error: `${name}: host ${url.hostname} is not in RATER_ALLOWED_HOSTS.` }, 403);
  }

  // "Test connection" from the Carriers tab: confirm config + secrets without calling the carrier.
  if (test) {
    return json({ ok: true, test: true, carrier: name, endpoint, secretsFound, cardFound, allowedHosts: allowed });
  }

  const contentType = String(carrier.contentType ?? "json");
  const httpMethod = String(carrier.httpMethod ?? "POST").toUpperCase();
  const authType = String(carrier.authType ?? "none");

  const headers: Record<string, string> = {
    "accept": contentType === "xml" ? "application/xml, text/xml, */*" : "application/json, */*",
  };
  if (contentType === "json") headers["content-type"] = "application/json";
  else if (contentType === "form") headers["content-type"] = "application/x-www-form-urlencoded";
  else if (contentType === "xml") headers["content-type"] = "text/xml; charset=utf-8";

  if (authType === "bearer") headers["authorization"] = `Bearer ${creds.TOKEN}`;
  else if (authType === "basic") headers["authorization"] = "Basic " + btoa(`${creds.USERNAME}:${creds.PASSWORD}`);
  else if (authType === "apikey") headers[String(carrier.apiKeyHeader || "x-api-key")] = String(creds.APIKEY);

  // Optional extra static headers per carrier (JSON object in a secret)
  const extra = secret(prefix, "HEADERS");
  if (extra) { try { Object.assign(headers, JSON.parse(extra)); } catch { /* ignore malformed */ } }

  const tpl = String(carrier.requestTemplate ?? "").trim();
  let reqBody: string | undefined;
  if (httpMethod !== "GET") {
    reqBody = tpl ? fillTemplate(tpl, quote, creds, contentType) : JSON.stringify({ quote, credentials: authType === "none" ? { username: creds.USERNAME, password: creds.PASSWORD, apiKey: creds.APIKEY } : undefined });
  } else if (tpl) {
    // GET: template is treated as a query string
    url.search = (url.search ? url.search + "&" : "?") + fillTemplate(tpl, quote, creds, "form");
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 40000);
  let res: Response;
  try {
    res = await fetch(url.toString(), { method: httpMethod, headers, body: reqBody, signal: ctrl.signal });
  } catch (e) {
    clearTimeout(timer);
    const msg = (e as Error).name === "AbortError" ? "timed out after 40s" : (e as Error).message;
    return json({ ok: false, error: `${name}: could not reach ${url.hostname} (${msg}).` });
  }
  clearTimeout(timer);

  const rawText = await res.text();
  let parsed: unknown = null;
  try { parsed = JSON.parse(rawText); } catch { parsed = null; }

  const map = (carrier.responseMap ?? {}) as Record<string, string>;
  const errMsg = extract(parsed, rawText, map.error);
  if (!res.ok) {
    return json({ ok: false, status: res.status, error: `${name}: HTTP ${res.status}${errMsg ? " – " + String(errMsg) : ""}`, raw: rawText.slice(0, 1500) });
  }

  const premium = toNumber(extract(parsed, rawText, map.premium));
  if (premium == null) {
    return json({
      ok: false, status: res.status,
      error: errMsg ? `${name}: ${String(errMsg)}` : `${name}: no premium at "${map.premium || "(not mapped)"}" — check the response mapping.`,
      raw: rawText.slice(0, 1500),
    });
  }

  return json({
    ok: true,
    carrier: name,
    premium,
    downPayment: toNumber(extract(parsed, rawText, map.downPayment)),
    monthly: toNumber(extract(parsed, rawText, map.monthly)),
    term: extract(parsed, rawText, map.term) ?? (quote.coverages as Dict | undefined)?.term ?? null,
    quoteId: extract(parsed, rawText, map.quoteId) ?? "",
    link: extract(parsed, rawText, map.link) ?? "",
    raw: rawText.slice(0, 1500),
  });
});
