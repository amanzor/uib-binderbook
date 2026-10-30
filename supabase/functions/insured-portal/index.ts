// ============================================================
//  UIB — Client Portal (Supabase Edge Function)
//  ------------------------------------------------------------
//  insured-portal.html talks only to this function. Two ways in:
//
//  • Personal lines — last name + a policy or binder number.
//  • Commercial clients — e-mail + password, set by an agent on the
//    client's "Insured Login" tab in the AMS (insuredPortalAccounts).
//    The password is stored as a PBKDF2 hash made in the agent's
//    browser; it is checked here and a signed session token comes
//    back. The token is re-checked on every call against the account
//    as it is NOW, so turning a login off or changing the password
//    ends every open session.
//
//  What a client gets is decided here, never by the page:
//    • policies — carrier, line, dates, status, limits, vehicles,
//      locations — and never premiums, fees, commissions or payments;
//    • their agent's name, e-mail and phone;
//    • documents an agent marked "Client can see", and the files the
//      client uploaded themselves;
//  and, for a commercial login, only what its permissions allow:
//    • uploads — straight into the client's Documents, category
//      "Client Uploads";
//    • the Certificate Master — the client's certificates from
//      certificateData, viewed as the real ACORD 25 PDF built here;
//    • certificate holders — additionalInterestData records they can
//      add and edit (including the holder's certificate description);
//    • sending a certificate to a holder — a new certificate record
//      for that holder (numbered like the AMS's), e-mailed through
//      Resend with the agency mailbox copied, and logged on the
//      record so the AMS shows exactly what went out.
//
//  A client can never reach another client's data: every lookup is
//  keyed by the client the name+number or the session belongs to.
//
//  DEPLOY:
//    Supabase Dashboard ▸ Edge Functions ▸ insured-portal ▸ paste this
//    file ▸ Deploy.  (or: supabase functions deploy insured-portal --no-verify-jwt)
//    Keep "Verify JWT" OFF: clients have no Supabase login.
//  SECRETS (Edge Functions ▸ Manage secrets):
//    RESEND_API_KEY        — already set for certificate-send (needed to send certificates)
//    CERT_FROM / CERT_CC / CERT_REPLY_TO — optional, same as certificate-send
//    PORTAL_SESSION_SECRET — optional; signs portal sessions (falls back
//                            to the service role key)
//    PORTAL_SITE           — optional; where forms/acord25.pdf is served
//                            (default https://uib-ams.vercel.app)
//  SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically.
//
//  The ACORD 25 field list below is generated from acord25-map.js:
//    node scripts/portal-acord-fields.js
// ============================================================

import { PDFDocument } from "npm:pdf-lib@1.17.1";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const BUCKET = "client-files";
const LINK_SECONDS = 15 * 60;
const SESSION_SECONDS = 8 * 60 * 60;
const UPLOAD_CATEGORY = "Client Uploads";
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const DEFAULT_FROM = "Universal Insurance Brokers <onboarding@resend.dev>";
const DEFAULT_CC = "coi@universalinsurancebroker.com";
const EMAIL_RE = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;
const PERM_KEYS = ["policies", "documents", "uploads", "certificates", "sendCertificates", "holders", "agent"];

type Rec = Record<string, unknown>;

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...CORS, "content-type": "application/json" } });
}
const esc = (v: unknown) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));

// ── Rate limits (per function instance) ─────────────────────────
// Guessing names, numbers and passwords is the attack, so cap attempts.
const buckets = new Map<string, number[]>();
function limited(id: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const arr = (buckets.get(id) ?? []).filter((t) => now - t < windowMs);
  if (arr.length >= max) { buckets.set(id, arr); return true; }
  arr.push(now); buckets.set(id, arr); return false;
}

// ── Store access ────────────────────────────────────────────────
const URL_ = Deno.env.get("SUPABASE_URL") ?? "";
const SRV = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const H = { apikey: SRV, authorization: `Bearer ${SRV}` };

async function readStore(key: string): Promise<unknown> {
  const r = await fetch(`${URL_}/rest/v1/app_store?select=value&key=eq.${encodeURIComponent(key)}`, { headers: H });
  if (!r.ok) throw new Error(`Could not read ${key} (HTTP ${r.status})`);
  const rows = await r.json();
  let v = rows?.[0]?.value ?? null;
  if (v && !Array.isArray(v) && typeof v === "object" && Array.isArray((v as { value?: unknown }).value)) v = (v as { value: unknown }).value;
  return v;
}
async function readMap(key: string): Promise<Record<string, Rec>> {
  const v = await readStore(key);
  return (v && typeof v === "object" && !Array.isArray(v)) ? v as Record<string, Rec> : {};
}
async function readBook(): Promise<Rec[]> {
  const v = await readStore("binderData");
  return Array.isArray(v) ? v as Rec[] : [];
}
// One record into a {id: record} map. The AMS merges these maps record by
// record on its next pull (newest updatedAt wins), so writing the fresh
// map back with this record stamped now is the same thing an agent's save does.
async function putRecord(key: string, id: string, rec: Rec): Promise<void> {
  const map = await readMap(key);
  rec.updatedAt = new Date().toISOString();
  map[id] = rec;
  const r = await fetch(`${URL_}/rest/v1/app_store`, {
    method: "POST",
    headers: { ...H, "content-type": "application/json", Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify([{ key, value: map, updated_at: new Date().toISOString() }]),
  });
  if (!r.ok) throw new Error(`Could not save (HTTP ${r.status})`);
}

const clientKey = (n: unknown) => String(n ?? "").trim().toUpperCase().replace(/\s+/g, " ");
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
const str = (v: unknown, max = 500) => String(v ?? "").trim().slice(0, max);

// ── Commercial or personal (same rules as the AMS's ams-books.js) ──
const COMMERCIAL = ["bop", "builders risk", "business owner", "commercial auto", "commercial property", "garage keepers",
  "general liability", "inland marine", "non-trucking liability", "pollution liability", "professional liability",
  "surety bond", "trucking", "workers comp", "workers compensation", "commercial umbrella", "liquor liability",
  "cargo", "motor truck cargo", "physical damage", "occupational accident", "cyber", "errors and omissions", "e&o"];
const PERSONAL = ["boat", "classic collectors", "home owners dp1", "home owners dp2", "home owners dp3", "home owners h3",
  "home owners h4", "home owners h6", "home owners h8", "motorcycle/atv", "personal auto", "renters", "condo",
  "flood", "mobile home", "personal umbrella", "rv"];
const BUSINESS_NAME = /\b(llc|l\.l\.c|inc|inc\.|corp|corp\.|corporation|company|co\.|enterprises?|services?|group|holdings?|dba|d\/b\/a|trucking|transport|logistics|construction|contractors?|restaurant|realty|properties)\b/i;
function bookOf(e: Rec): string {
  const t = String(e.lineType ?? "").toLowerCase();
  if (t === "personal" || t === "commercial") return t;
  const lob = String(e.lineOfBusiness ?? "").toLowerCase().trim();
  if (lob) {
    if (COMMERCIAL.includes(lob) || /commercial|business|liability|workers|trucking|cargo|bond/.test(lob)) return "commercial";
    if (PERSONAL.includes(lob)) return "personal";
  }
  return BUSINESS_NAME.test(String(e.customerName ?? "")) ? "commercial" : "personal";
}

// ── Policies, as a client may see them ──────────────────────────
const isCancel = (p: Rec) =>
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
function statusOf(p: Rec): string {
  const t = today();
  if (isCancel(p)) return "Canceled";
  const cd = String(p.cancellationDate ?? "").slice(0, 10);
  if (cd && cd <= t) return "Canceled";
  const st = String(p.policyStatus ?? "");
  if (["Active", "Pending Cancellation", "Expired"].includes(st)) return st;
  const exp = String(p.expirationDate ?? "").slice(0, 10);
  return exp && exp < t ? "Expired" : "Active";
}
// Coverage limits read off the declarations (policy.certificate.limits),
// labelled the way the certificate prints them. No money other than limits.
const LIMIT_LABELS: Record<string, string> = {
  eachOccurrence: "Each occurrence", damageToRentedPremises: "Damage to rented premises", medExpAnyOnePerson: "Med exp (any one person)",
  personalAndAdvInjury: "Personal & adv injury", generalAggregate: "General aggregate", productsCompOpAgg: "Products - comp/op agg",
  combinedSingleLimit: "Combined single limit", bodilyInjuryPerPerson: "Bodily injury (per person)", bodilyInjuryPerAccident: "Bodily injury (per accident)",
  propertyDamagePerAccident: "Property damage (per accident)", umbrellaEachOccurrence: "Umbrella each occurrence", umbrellaAggregate: "Umbrella aggregate",
  elEachAccident: "E.L. each accident", elDiseaseEachEmployee: "E.L. disease - each employee", elDiseasePolicyLimit: "E.L. disease - policy limit",
};
function clientPolicies(mine: Rec[], detailed: boolean) {
  const byNum = new Map<string, Rec[]>();
  mine.forEach((e, i) => {
    const k = String(e.policyNumber ?? "").trim().toUpperCase() || "#" + i;
    byNum.set(k, [...(byNum.get(k) ?? []), e]);
  });
  return [...byNum.values()].map((list) => {
    const live = list.filter((e) => !isCancel(e));
    const latest = (live.length ? live : list).slice().sort((a, b) =>
      String(b.expirationDate ?? b.entryDate ?? "").localeCompare(String(a.expirationDate ?? a.entryDate ?? "")))[0];
    const canceled = list.some((e) => statusOf(e) === "Canceled");
    const out: Rec = {
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
    if (detailed) {
      const meta = (latest.certificate && typeof latest.certificate === "object") ? latest.certificate as Rec : {};
      const lim = (meta.limits && typeof meta.limits === "object") ? meta.limits as Rec : {};
      out.binderNumber = latest.binderNumber ?? "";
      out.naic = meta.naic ?? latest.naic ?? "";
      out.mga = latest.mga ?? "";
      out.propertyAddress = latest.propertyAddress ?? "";
      out.occurrenceOrClaimsMade = meta.occurrenceOrClaimsMade ?? "";
      out.limits = Object.keys(LIMIT_LABELS).filter((k) => str(lim[k])).map((k) => ({ label: LIMIT_LABELS[k], value: str(lim[k], 40) }));
      out.vehicles = Array.isArray(latest.vehicles) ? (latest.vehicles as Rec[]).map((v) => ({
        year: str(v.year, 4), make: str(v.make, 40), model: str(v.model, 40), vin: str(v.vin, 20).toUpperCase() })) : [];
      out.drivers = Array.isArray(latest.drivers) ? (latest.drivers as Rec[]).map((d) =>
        [str(d.firstName, 40), str(d.lastName, 40)].filter(Boolean).join(" ")).filter(Boolean) : [];
    }
    return out;
  }).sort((a, b) => String(b.effectiveDate).localeCompare(String(a.effectiveDate)));
}

// ── Documents ───────────────────────────────────────────────────
async function signUrl(path: string): Promise<string> {
  const s = await fetch(`${URL_}/storage/v1/object/sign/${BUCKET}/${path.split("/").map(encodeURIComponent).join("/")}`, {
    method: "POST", headers: { ...H, "content-type": "application/json" }, body: JSON.stringify({ expiresIn: LINK_SECONDS }),
  });
  const signed = s.ok ? await s.json() : {};
  const rel = String(signed.signedURL ?? signed.signedUrl ?? "");
  return rel ? `${URL_}/storage/v1${rel.startsWith("/") ? "" : "/"}${rel}` : "";
}
function docShape(d: Rec, url: string) {
  return { id: d.id, name: d.file_name, category: d.category || "Other", size: d.size_bytes || 0,
           type: d.mime_type || "", uploadedAt: d.uploaded_at, url };
}
async function sharedDocuments(key: string) {
  const shared = await readMap("clientSharedDocs");
  const ids = Object.values(shared).filter((r) => r && r.shared && clientKey(r.clientKey) === key).map((r) => String(r.docId));
  if (!ids.length) return [];
  const r = await fetch(`${URL_}/rest/v1/documents?select=id,file_name,category,storage_path,size_bytes,mime_type,uploaded_at,client_key` +
    `&id=in.(${ids.map(encodeURIComponent).join(",")})&client_key=eq.${encodeURIComponent(key)}`, { headers: H });
  const rows = r.ok ? await r.json() as Rec[] : [];
  return Promise.all(rows.map(async (d) => docShape(d, await signUrl(String(d.storage_path ?? "")))));
}
async function clientUploads(key: string) {
  const r = await fetch(`${URL_}/rest/v1/documents?select=id,file_name,category,storage_path,size_bytes,mime_type,uploaded_at,uploaded_by` +
    `&client_key=eq.${encodeURIComponent(key)}&category=eq.${encodeURIComponent(UPLOAD_CATEGORY)}&order=uploaded_at.desc&limit=200`, { headers: H });
  const rows = r.ok ? await r.json() as Rec[] : [];
  return Promise.all(rows.filter((d) => /^Client portal/.test(String(d.uploaded_by ?? "")))
    .map(async (d) => docShape(d, await signUrl(String(d.storage_path ?? "")))));
}
// Same folder the AMS uploads into (amsCloudUpload).
const storageFolder = (key: string) => key.replace(/[^\w\- ]/g, "_");

// ── Passwords and sessions ──────────────────────────────────────
const enc = new TextEncoder();
const b64 = (bytes: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const b64url = (bytes: ArrayBuffer | Uint8Array) => b64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64url = (s: string) => unb64(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));

async function verifyPassword(password: string, pw: Rec | undefined): Promise<boolean> {
  if (!pw || !pw.hash || !pw.salt) return false;
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: unb64(String(pw.salt)),
    iterations: Math.min(Number(pw.iter) || 100000, 600000) }, key, 256);
  const a = new Uint8Array(bits), b = unb64(String(pw.hash));
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

const SECRET = Deno.env.get("PORTAL_SESSION_SECRET") || SRV;
async function hmac(data: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", enc.encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", k, enc.encode(data)));
}
async function makeToken(acct: Rec): Promise<string> {
  const body = b64url(enc.encode(JSON.stringify({
    ck: acct.clientKey, em: acct.email, ps: (acct.pw as Rec)?.setAt ?? "", exp: Math.floor(Date.now() / 1000) + SESSION_SECONDS,
  })));
  return body + "." + await hmac(body);
}
// The account the token belongs to, as it stands now — or null.
async function sessionAccount(token: unknown): Promise<Rec | null> {
  const [body, sig] = String(token ?? "").split(".");
  if (!body || !sig || await hmac(body) !== sig) return null;
  let p: Rec;
  try { p = JSON.parse(new TextDecoder().decode(unb64url(body))); } catch { return null; }
  if (!p.ck || Number(p.exp) < Date.now() / 1000) return null;
  const acct = (await readMap("insuredPortalAccounts"))[String(p.ck)];
  if (!acct || !acct.enabled || String(acct.email ?? "").toLowerCase() !== String(p.em ?? "").toLowerCase()) return null;
  if (String((acct.pw as Rec)?.setAt ?? "") !== String(p.ps ?? "")) return null;
  return acct;
}
function permsOf(acct: Rec | null): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  const p = (acct?.perms && typeof acct.perms === "object") ? acct.perms as Rec : {};
  PERM_KEYS.forEach((k) => { out[k] = acct ? p[k] !== false : true; });
  if (!acct) { out.uploads = false; out.certificates = false; out.sendCertificates = false; out.holders = false; }
  if (out.sendCertificates) out.certificates = true;
  return out;
}

// ── Certificates ────────────────────────────────────────────────
// BEGIN ACORD25 FIELDS (generated by scripts/portal-acord-fields.js — do not edit by hand)
const ACORD25 = {"edition":"ACORD 25 (2025/12)","editionField":"Form_EditionIdentifier_A","fields":[{"k":"certDate","pdf":"Form_CompletionDate_A","t":"t","mdy":1},{"k":"certNo","pdf":"CertificateOfInsurance_CertificateNumberIdentifier_A","t":"t"},{"k":"revNo","pdf":"CertificateOfInsurance_RevisionNumberIdentifier_A","t":"t"},{"k":"prodName","pdf":"Producer_FullName_A","t":"t"},{"k":"prodAddr1","pdf":"Producer_MailingAddress_LineOne_A","t":"t"},{"k":"prodAddr2","pdf":"Producer_MailingAddress_LineTwo_A","t":"t"},{"k":"prodCity","pdf":"Producer_MailingAddress_CityName_A","t":"t"},{"k":"prodState","pdf":"Producer_MailingAddress_StateOrProvinceCode_A","t":"t"},{"k":"prodZip","pdf":"Producer_MailingAddress_PostalCode_A","t":"t"},{"k":"prodContact","pdf":"Producer_ContactPerson_FullName_A","t":"t"},{"k":"prodPhone","pdf":"Producer_ContactPerson_PhoneNumber_A","t":"t"},{"k":"prodFax","pdf":"Producer_FaxNumber_A","t":"t"},{"k":"prodEmail","pdf":"Producer_ContactPerson_EmailAddress_A","t":"t"},{"k":"insName","pdf":"NamedInsured_FullName_A","t":"t"},{"k":"insAddr1","pdf":"NamedInsured_MailingAddress_LineOne_A","t":"t"},{"k":"insAddr2","pdf":"NamedInsured_MailingAddress_LineTwo_A","t":"t"},{"k":"insCity","pdf":"NamedInsured_MailingAddress_CityName_A","t":"t"},{"k":"insState","pdf":"NamedInsured_MailingAddress_StateOrProvinceCode_A","t":"t"},{"k":"insZip","pdf":"NamedInsured_MailingAddress_PostalCode_A","t":"t"},{"k":"insurerAName","pdf":"Insurer_FullName_A","t":"t"},{"k":"insurerANaic","pdf":"Insurer_NAICCode_A","t":"t"},{"k":"insurerBName","pdf":"Insurer_FullName_B","t":"t"},{"k":"insurerBNaic","pdf":"Insurer_NAICCode_B","t":"t"},{"k":"insurerCName","pdf":"Insurer_FullName_C","t":"t"},{"k":"insurerCNaic","pdf":"Insurer_NAICCode_C","t":"t"},{"k":"insurerDName","pdf":"Insurer_FullName_D","t":"t"},{"k":"insurerDNaic","pdf":"Insurer_NAICCode_D","t":"t"},{"k":"insurerEName","pdf":"Insurer_FullName_E","t":"t"},{"k":"insurerENaic","pdf":"Insurer_NAICCode_E","t":"t"},{"k":"insurerFName","pdf":"Insurer_FullName_F","t":"t"},{"k":"insurerFNaic","pdf":"Insurer_NAICCode_F","t":"t"},{"k":"description","pdf":"CertificateOfLiabilityInsurance_ACORDForm_RemarkText_A","t":"t"},{"k":"holdName","pdf":"CertificateHolder_FullName_A","t":"t"},{"k":"holdAddr1","pdf":"CertificateHolder_MailingAddress_LineOne_A","t":"t"},{"k":"holdAddr2","pdf":"CertificateHolder_MailingAddress_LineTwo_A","t":"t"},{"k":"holdCity","pdf":"CertificateHolder_MailingAddress_CityName_A","t":"t"},{"k":"holdState","pdf":"CertificateHolder_MailingAddress_StateOrProvinceCode_A","t":"t"},{"k":"holdZip","pdf":"CertificateHolder_MailingAddress_PostalCode_A","t":"t"},{"k":"authorizedRep","pdf":"Producer_AuthorizedRepresentative_Signature_A","t":"t"},{"k":"glInsurer","pdf":"GeneralLiability_InsurerLetterCode_A","t":"t"},{"k":"glAddl","pdf":"CertificateOfInsurance_GeneralLiability_AdditionalInsuredCode_A","t":"y"},{"k":"glSubr","pdf":"Policy_GeneralLiability_SubrogationWaivedCode_A","t":"y"},{"k":"glPolicyNo","pdf":"Policy_GeneralLiability_PolicyNumberIdentifier_A","t":"t"},{"k":"glEff","pdf":"Policy_GeneralLiability_EffectiveDate_A","t":"t","mdy":1},{"k":"glExp","pdf":"Policy_GeneralLiability_ExpirationDate_A","t":"t","mdy":1},{"k":"glAggOtherText","pdf":"GeneralLiability_GeneralAggregate_LimitAppliesToCode_A","t":"t"},{"k":"glOtherCovText","pdf":"GeneralLiability_OtherCoverageDescription_A","t":"t"},{"k":"glOtherCov2Text","pdf":"GeneralLiability_OtherCoverageDescription_B","t":"t"},{"k":"glEachOcc","pdf":"GeneralLiability_EachOccurrence_LimitAmount_A","t":"t","money":1},{"k":"glRented","pdf":"GeneralLiability_FireDamageRentedPremises_EachOccurrenceLimitAmount_A","t":"t","money":1},{"k":"glMedExp","pdf":"GeneralLiability_MedicalExpense_EachPersonLimitAmount_A","t":"t","money":1},{"k":"glPersAdv","pdf":"GeneralLiability_PersonalAndAdvertisingInjury_LimitAmount_A","t":"t","money":1},{"k":"glGenAgg","pdf":"GeneralLiability_GeneralAggregate_LimitAmount_A","t":"t","money":1},{"k":"glProdAgg","pdf":"GeneralLiability_ProductsAndCompletedOperations_AggregateLimitAmount_A","t":"t","money":1},{"k":"glOtherLimit","pdf":"GeneralLiability_OtherCoverageLimitAmount_A","t":"t","money":1},{"k":"glOtherLimitText","pdf":"GeneralLiability_OtherCoverageLimitDescription_A","t":"t"},{"k":"glOn","pdf":"GeneralLiability_CoverageIndicator_A","t":"c"},{"k":"glClaimsMade","pdf":"GeneralLiability_ClaimsMadeIndicator_A","t":"c"},{"k":"glOccur","pdf":"GeneralLiability_OccurrenceIndicator_A","t":"c"},{"k":"glAggPolicy","pdf":"GeneralLiability_GeneralAggregate_LimitAppliesPerPolicyIndicator_A","t":"c"},{"k":"glAggProject","pdf":"GeneralLiability_GeneralAggregate_LimitAppliesPerProjectIndicator_A","t":"c"},{"k":"glAggLoc","pdf":"GeneralLiability_GeneralAggregate_LimitAppliesPerLocationIndicator_A","t":"c"},{"k":"glAggOther","pdf":"GeneralLiability_GeneralAggregate_LimitAppliesToOtherIndicator_A","t":"c"},{"k":"glOtherCovOn","pdf":"GeneralLiability_OtherCoverageIndicator_A","t":"c"},{"k":"glOtherCov2On","pdf":"GeneralLiability_OtherCoverageIndicator_B","t":"c"},{"k":"auInsurer","pdf":"Vehicle_InsurerLetterCode_A","t":"t"},{"k":"auAddl","pdf":"CertificateOfInsurance_AutomobileLiability_AdditionalInsuredCode_A","t":"y"},{"k":"auSubr","pdf":"Policy_AutomobileLiability_SubrogationWaivedCode_A","t":"y"},{"k":"auPolicyNo","pdf":"Policy_AutomobileLiability_PolicyNumberIdentifier_A","t":"t"},{"k":"auEff","pdf":"Policy_AutomobileLiability_EffectiveDate_A","t":"t","mdy":1},{"k":"auExp","pdf":"Policy_AutomobileLiability_ExpirationDate_A","t":"t","mdy":1},{"k":"auOther1Text","pdf":"Vehicle_OtherCoveredAutoDescription_A","t":"t"},{"k":"auOther2Text","pdf":"Vehicle_OtherCoveredAutoDescription_B","t":"t"},{"k":"auCsl","pdf":"Vehicle_CombinedSingleLimit_EachAccidentAmount_A","t":"t","money":1},{"k":"auBiPerson","pdf":"Vehicle_BodilyInjury_PerPersonLimitAmount_A","t":"t","money":1},{"k":"auBiAccident","pdf":"Vehicle_BodilyInjury_PerAccidentLimitAmount_A","t":"t","money":1},{"k":"auPd","pdf":"Vehicle_PropertyDamage_PerAccidentLimitAmount_A","t":"t","money":1},{"k":"auOtherLimit","pdf":"Vehicle_OtherCoverage_LimitAmount_A","t":"t","money":1},{"k":"auOtherLimitText","pdf":"Vehicle_OtherCoverage_CoverageDescription_A","t":"t"},{"k":"auAny","pdf":"Vehicle_AnyAutoIndicator_A","t":"c"},{"k":"auOwned","pdf":"Vehicle_AllOwnedAutosIndicator_A","t":"c"},{"k":"auScheduled","pdf":"Vehicle_ScheduledAutosIndicator_A","t":"c"},{"k":"auHired","pdf":"Vehicle_HiredAutosIndicator_A","t":"c"},{"k":"auNonOwned","pdf":"Vehicle_NonOwnedAutosIndicator_A","t":"c"},{"k":"auOther1On","pdf":"Vehicle_OtherCoveredAutoIndicator_A","t":"c"},{"k":"auOther2On","pdf":"Vehicle_OtherCoveredAutoIndicator_B","t":"c"},{"k":"umInsurer","pdf":"ExcessUmbrella_InsurerLetterCode_A","t":"t"},{"k":"umAddl","pdf":"CertificateOfInsurance_ExcessLiability_AdditionalInsuredCode_A","t":"y"},{"k":"umSubr","pdf":"Policy_ExcessLiability_SubrogationWaivedCode_A","t":"y"},{"k":"umPolicyNo","pdf":"Policy_ExcessLiability_PolicyNumberIdentifier_A","t":"t"},{"k":"umEff","pdf":"Policy_ExcessLiability_EffectiveDate_A","t":"t","mdy":1},{"k":"umExp","pdf":"Policy_ExcessLiability_ExpirationDate_A","t":"t","mdy":1},{"k":"umDedAmount","pdf":"ExcessUmbrella_Umbrella_DeductibleOrRetentionAmount_A","t":"t","money":1},{"k":"umEachOcc","pdf":"ExcessUmbrella_Umbrella_EachOccurrenceAmount_A","t":"t","money":1},{"k":"umAgg","pdf":"ExcessUmbrella_Umbrella_AggregateAmount_A","t":"t","money":1},{"k":"umOtherLimit","pdf":"ExcessUmbrella_OtherCoverageLimitAmount_A","t":"t","money":1},{"k":"umOtherLimitText","pdf":"ExcessUmbrella_OtherCoverageDescription_A","t":"t"},{"k":"umUmbrella","pdf":"Policy_PolicyType_UmbrellaIndicator_A","t":"c"},{"k":"umExcess","pdf":"Policy_PolicyType_ExcessIndicator_A","t":"c"},{"k":"umOccur","pdf":"ExcessUmbrella_OccurrenceIndicator_A","t":"c"},{"k":"umClaimsMade","pdf":"ExcessUmbrella_ClaimsMadeIndicator_A","t":"c"},{"k":"umDed","pdf":"ExcessUmbrella_DeductibleIndicator_A","t":"c"},{"k":"umRetention","pdf":"ExcessUmbrella_RetentionIndicator_A","t":"c"},{"k":"wcInsurer","pdf":"WorkersCompensationEmployersLiability_InsurerLetterCode_A","t":"t"},{"k":"wcExcluded","pdf":"WorkersCompensationEmployersLiability_AnyPersonsExcludedIndicator_A","t":"y"},{"k":"wcSubr","pdf":"Policy_WorkersCompensation_SubrogationWaivedCode_A","t":"y"},{"k":"wcPolicyNo","pdf":"Policy_WorkersCompensationAndEmployersLiability_PolicyNumberIdentifier_A","t":"t"},{"k":"wcEff","pdf":"Policy_WorkersCompensationAndEmployersLiability_EffectiveDate_A","t":"t","mdy":1},{"k":"wcExp","pdf":"Policy_WorkersCompensationAndEmployersLiability_ExpirationDate_A","t":"t","mdy":1},{"k":"wcOtherText","pdf":"WorkersCompensationEmployersLiability_OtherCoverageDescription_A","t":"t"},{"k":"wcEachAccident","pdf":"WorkersCompensationEmployersLiability_EmployersLiability_EachAccidentLimitAmount_A","t":"t","money":1},{"k":"wcDiseaseEmp","pdf":"WorkersCompensationEmployersLiability_EmployersLiability_DiseaseEachEmployeeLimitAmount_A","t":"t","money":1},{"k":"wcDiseasePol","pdf":"WorkersCompensationEmployersLiability_EmployersLiability_DiseasePolicyLimitAmount_A","t":"t","money":1},{"k":"wcPerStatute","pdf":"WorkersCompensationEmployersLiability_WorkersCompensationStatutoryLimitIndicator_A","t":"c"},{"k":"wcOther","pdf":"WorkersCompensationEmployersLiability_OtherCoverageIndicator_A","t":"c"},{"k":"otInsurer","pdf":"OtherPolicy_InsurerLetterCode_A","t":"t"},{"k":"otAddl","pdf":"CertificateOfInsurance_OtherPolicy_AdditionalInsuredCode_A","t":"y"},{"k":"otSubr","pdf":"OtherPolicy_SubrogationWaivedCode_A","t":"y"},{"k":"otPolicyNo","pdf":"OtherPolicy_PolicyNumberIdentifier_A","t":"t"},{"k":"otEff","pdf":"OtherPolicy_PolicyEffectiveDate_A","t":"t","mdy":1},{"k":"otExp","pdf":"OtherPolicy_PolicyExpirationDate_A","t":"t","mdy":1},{"k":"otType1","pdf":"OtherPolicy_CoverageCode_A","t":"t"},{"k":"otLimit1","pdf":"OtherPolicy_CoverageLimitAmount_A","t":"t","money":1},{"k":"otType2","pdf":"OtherPolicy_CoverageCode_B","t":"t"},{"k":"otLimit2","pdf":"OtherPolicy_CoverageLimitAmount_B","t":"t","money":1},{"k":"otType3","pdf":"OtherPolicy_CoverageCode_C","t":"t"},{"k":"otLimit3","pdf":"OtherPolicy_CoverageLimitAmount_C","t":"t","money":1},{"k":"otDesc","pdf":"OtherPolicy_OtherPolicyDescription_A","t":"t"}]};
// END ACORD25 FIELDS

const POLICY_KEYS = ["glPolicyNo", "auPolicyNo", "umPolicyNo", "wcPolicyNo", "otPolicyNo"];
const EXP_KEYS = ["glExp", "auExp", "umExp", "wcExp", "otExp"];
const PROD_MAP: Record<string, string> = {
  prodName: "name", prodAddr1: "address1", prodAddr2: "address2", prodCity: "city", prodState: "state",
  prodZip: "zip", prodContact: "certContact", prodPhone: "phone", prodFax: "fax", prodEmail: "email",
};
const HOLDER_FIELDS = ["name", "type", "reference", "addr1", "addr2", "city", "state", "zip", "email", "phone", "fax", "contact", "description"];
const HOLDER_TYPES = ["Certificate Holder", "Additional Insured", "Loss Payee", "Mortgagee", "Lienholder", "Lender", "Additional Interest"];

const mdy = (iso: unknown) => {
  const m = String(iso ?? "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[2]}/${m[3]}/${m[1]}` : String(iso ?? "");
};
const money = (v: unknown) => {
  if (v == null || v === "") return "";
  const n = Number(String(v).replace(/[^0-9.-]/g, ""));
  return !isFinite(n) || n === 0 ? String(v) : n.toLocaleString("en-US");
};
const isAcord25 = (c: Rec) => !c.formType || c.formType === "acord25";
const certPolicies = (c: Rec) => [...new Set(POLICY_KEYS.map((k) => str(c[k])).filter(Boolean))];
const defaultCertName = (c: Rec) =>
  "CERTIFICATE OF LIABILITY INSURANCE (ACORD 25)" + (c.certDate ? ` (${mdy(c.certDate)})` : "");

// The producer block is the Agency Profile, as on every AMS certificate.
function withProducer(cert: Rec, profile: Rec): Rec {
  const out = { ...cert };
  Object.entries(PROD_MAP).forEach(([k, p]) => { if (str(profile[p])) out[k] = str(profile[p]); });
  return out;
}
// Why a certificate cannot go out from the portal, or "" if it can.
function notReady(c: Rec): string {
  if (c.voided) return "This certificate was voided.";
  if (!isAcord25(c)) return "This certificate type can only be sent by your agent.";
  if (!certPolicies(c).length || !str(c.insName) || !str(c.authorizedRep)) return "This certificate is not finished yet — please contact your agent.";
  const exps = EXP_KEYS.map((k) => str(c[k]).slice(0, 10)).filter(Boolean);
  if (exps.length && exps.every((d) => d < today())) return "The policies on this certificate have expired — please contact your agent for a current one.";
  return "";
}
function certShape(c: Rec) {
  return {
    id: c.id, certNo: c.certNo ?? "", name: c.name || defaultCertName(c), certDate: c.certDate ?? "",
    formType: c.formType || "acord25", holderInterestId: c.holderInterestId ?? "",
    holdName: c.holdName ?? "", holdEmail: c.holdEmail ?? "",
    holdAddress: [c.holdAddr1, c.holdAddr2, c.holdCity, [c.holdState, c.holdZip].filter(Boolean).join(" ")].map((x) => str(x)).filter(Boolean).join(", "),
    description: c.description ?? "", policies: certPolicies(c), lastSentAt: c.lastSentAt ?? "",
    createdAt: c.createdAt ?? "", fromPortal: !!c.portalIssued, canSend: !notReady(c), blocked: notReady(c),
  };
}
function holderShape(r: Rec) {
  const o: Rec = { id: r.id };
  HOLDER_FIELDS.forEach((k) => { o[k] = r[k] ?? ""; });
  return o;
}

let formBytes: Uint8Array | null = null;
async function buildPdf(cert: Rec): Promise<Uint8Array> {
  if (!formBytes) {
    const site = (Deno.env.get("PORTAL_SITE") || "https://uib-ams.vercel.app").replace(/\/+$/, "");
    const r = await fetch(`${site}/forms/acord25.pdf`);
    if (!r.ok) throw new Error(`Could not load the ACORD 25 form (HTTP ${r.status}).`);
    formBytes = new Uint8Array(await r.arrayBuffer());
  }
  const doc = await PDFDocument.load(formBytes);
  const form = doc.getForm();
  for (const f of ACORD25.fields) {
    const v = cert[f.k];
    if (v === undefined || v === null || v === "" || v === false) continue;
    try {
      if (f.t === "c") { form.getCheckBox(f.pdf).check(); continue; }
      let text = String(v);
      if (f.mdy) text = mdy(v);
      if (f.money) text = money(v);
      if (f.t === "y") text = text.toUpperCase().slice(0, 1);
      form.getTextField(f.pdf).setText(text);
    } catch { /* a field the form lacks never stops a certificate */ }
  }
  try { form.getTextField(ACORD25.editionField).setText(ACORD25.edition); } catch { /* optional */ }
  return await doc.save();
}
const pdfName = (c: Rec) =>
  "ACORD25-" + String(c.insName || c.clientName || "certificate").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-") + "-" + (c.certNo || c.id) + ".pdf";

function nextCertNumber(all: Record<string, Rec>): string {
  let n = 0;
  Object.values(all).forEach((c) => {
    const m = String(c?.certNo ?? "").match(/(\d+)\s*$/);
    if (m) n = Math.max(n, parseInt(m[1], 10));
  });
  return `CERT-${new Date().getFullYear()}-${String(n + 1).padStart(4, "0")}`;
}
function logOn(c: Rec, by: string, action: string, detail: string) {
  const h = Array.isArray(c.history) ? c.history as Rec[] : [];
  h.push({ at: new Date().toISOString(), by, action, detail });
  c.history = h.slice(-200);
}

async function sendMail(opts: { to: string[]; cc: string[]; subject: string; text: string; filename: string; pdf: Uint8Array; footer: string }) {
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) throw new Error("Sending is not set up yet — please contact your agent.");
  const from = Deno.env.get("CERT_FROM") ?? Deno.env.get("PROSPECT_FROM") ?? Deno.env.get("INQUIRY_FROM") ?? DEFAULT_FROM;
  const agencyCc = (Deno.env.get("CERT_CC") ?? DEFAULT_CC).trim();
  const replyTo = (Deno.env.get("CERT_REPLY_TO") ?? agencyCc).trim();
  const html = `<div style="font-family:system-ui,Segoe UI,Arial,sans-serif;max-width:620px;color:#0f172a;font-size:14px;line-height:1.55;">
  ${esc(opts.text).replace(/\n/g, "<br>")}
  <div style="font-size:12px;color:#94a3b8;margin-top:18px;border-top:1px solid #e2e8f0;padding-top:10px;">📎 ${esc(opts.filename)}<br>${esc(opts.footer)}</div>
</div>`;
  let bin = "";
  for (let i = 0; i < opts.pdf.length; i += 0x8000) bin += String.fromCharCode(...opts.pdf.subarray(i, i + 0x8000));
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ from, to: opts.to, cc: [agencyCc, ...opts.cc.filter((e) => e.toLowerCase() !== agencyCc.toLowerCase())],
      subject: opts.subject, reply_to: replyTo, text: `${opts.text}\n\n— ${opts.footer}`, html,
      attachments: [{ filename: opts.filename, content: btoa(bin) }] }),
  });
  const out = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Email service: ${out?.message ?? out?.error ?? ("HTTP " + r.status)}`);
}

// ── What the portal shows ───────────────────────────────────────
async function payload(key: string, acct: Rec | null, displayHint: string) {
  const perms = permsOf(acct);
  const book = await readBook();
  const mine = book.filter((e) => clientKey(e.customerName) === key);
  const commercial = !!acct || mine.some((e) => bookOf(e) === "commercial");
  const contacts = await readMap("amsClientData");
  const contact = contacts[key] || {};
  const displayName = String(mine[0]?.customerName ?? acct?.displayName ?? displayHint ?? key);

  const policies = perms.policies ? clientPolicies(mine, commercial) : [];
  const roster = await readMap("agentMasterData");
  const agentNames = [...new Set([...clientPolicies(mine, false).map((p) => String(p.agent)), String(contact.assignedAgent ?? "")].filter(Boolean))];
  const agents = perms.agent ? agentNames.map((n) => ({ name: n, email: String(roster[n]?.email ?? ""), phone: String(roster[n]?.phone ?? "") })) : [];

  const out: Rec = {
    ok: true, displayName, commercial, perms, policies, agents,
    csrName: perms.agent ? String(contact.csrName ?? "") : "",
    documents: perms.documents ? await sharedDocuments(key) : [],
  };
  if (acct) {
    out.email = acct.email;
    out.uploads = perms.uploads ? await clientUploads(key) : [];
    if (perms.certificates) {
      const certs = Object.values(await readMap("certificateData")).filter((c) => c && c.clientKey === key && !c.voided);
      out.certificates = certs.sort((a, b) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? ""))).map(certShape);
    }
    if (perms.certificates || perms.holders) {
      out.holders = Object.values(await readMap("additionalInterestData"))
        .filter((r) => r && r.clientKey === key && !r.removed)
        .sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? ""))).map(holderShape);
      out.holderTypes = HOLDER_TYPES;
    }
  }
  return out;
}

// ── Actions ─────────────────────────────────────────────────────
async function legacyLogin(body: Rec) {
  const last = String(body.lastName ?? "").trim().toUpperCase();
  const num = String(body.policyNumber ?? "").trim().toUpperCase();
  if (last.length < 2 || num.length < 3) return json({ ok: false, error: "Enter your last name and policy or binder number." }, 400);
  const book = await readBook();
  const match = book.find((e) => {
    const p = String(e.policyNumber ?? "").toUpperCase(), b = String(e.binderNumber ?? "").toUpperCase();
    if (p !== num && b !== num) return false;
    return clientKey(e.customerName).split(" ").some((w) => w === last);
  });
  // Same answer for "no such number" and "wrong name", so it confirms nothing.
  if (!match) return json({ ok: false, error: "No policy found matching that name and number. Please check your details and try again." }, 404);
  const key = clientKey(match.customerName);
  const acct = (await readMap("insuredPortalAccounts"))[key];
  if (acct && acct.enabled) return json({ ok: false, error: "This business signs in with its e-mail and password — use the Business sign-in." }, 403);
  return json(await payload(key, null, String(match.customerName)));
}

async function emailLogin(body: Rec) {
  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  if (!EMAIL_RE.test(email) || !password) return json({ ok: false, error: "Enter your e-mail and password." }, 400);
  if (limited("em:" + email, 10, 15 * 60 * 1000)) return json({ ok: false, error: "Too many attempts. Please wait a few minutes and try again." }, 429);
  const accounts = Object.values(await readMap("insuredPortalAccounts"))
    .filter((a) => a && a.enabled && String(a.email ?? "").toLowerCase() === email);
  const ok: Rec[] = [];
  for (const a of accounts) if (await verifyPassword(password, a.pw as Rec)) ok.push(a);
  if (!ok.length) return json({ ok: false, error: "That e-mail and password do not match. Check them, or contact your agent to reset your password." }, 401);
  // One owner, several companies: ask which one to open.
  const want = String(body.clientKey ?? "");
  const acct = ok.length === 1 ? ok[0] : ok.find((a) => a.clientKey === want);
  if (!acct) return json({ ok: true, choose: ok.map((a) => ({ clientKey: a.clientKey, displayName: a.displayName || a.clientKey })) });
  const out = await payload(String(acct.clientKey), acct, String(acct.displayName ?? ""));
  out.token = await makeToken(acct);
  return json(out);
}

async function saveHolder(acct: Rec, body: Rec) {
  const key = String(acct.clientKey);
  const by = "Client portal";
  const h = (body.holder && typeof body.holder === "object") ? body.holder as Rec : {};
  const id = str(h.id, 80);
  const map = await readMap("additionalInterestData");
  let rec: Rec;
  if (id) {
    rec = map[id];
    if (!rec || rec.clientKey !== key || rec.removed) return json({ ok: false, error: "That certificate holder could not be found." }, 404);
    rec = { ...rec };
  } else {
    rec = { id: "ai_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7), clientKey: key,
            createdAt: new Date().toISOString(), createdBy: by };
  }
  HOLDER_FIELDS.forEach((k) => { if (k in h) rec[k] = str(h[k], k === "description" ? 4000 : 200); });
  if (!str(rec.name)) return json({ ok: false, error: "Enter the holder's name." }, 400);
  if (rec.email && !EMAIL_RE.test(String(rec.email))) return json({ ok: false, error: "That e-mail address does not look right." }, 400);
  if (!HOLDER_TYPES.includes(String(rec.type))) rec.type = "Certificate Holder";
  rec.state = String(rec.state ?? "").toUpperCase().slice(0, 2);
  rec.updatedBy = by;
  rec.portalEditedBy = acct.email;
  await putRecord("additionalInterestData", String(rec.id), rec);
  return json({ ok: true, holder: holderShape(rec) });
}

async function certPdf(acct: Rec, body: Rec) {
  const key = String(acct.clientKey);
  const c = (await readMap("certificateData"))[str(body.certId, 80)];
  if (!c || c.clientKey !== key || c.voided) return json({ ok: false, error: "That certificate could not be found." }, 404);
  if (!isAcord25(c)) return json({ ok: false, error: "This certificate type is available from your agent." }, 400);
  const bytes = await buildPdf(withProducer(c, (await readStore("agencyProfile") ?? {}) as Rec));
  return new Response(bytes as unknown as BodyInit, { headers: { ...CORS, "content-type": "application/pdf",
    "content-disposition": `inline; filename="${pdfName(c)}"` } });
}

async function sendCertificate(acct: Rec, body: Rec) {
  const key = String(acct.clientKey);
  const who = String(acct.email);
  if (limited("send:" + key, 30, 60 * 60 * 1000)) return json({ ok: false, error: "Too many certificates sent in the last hour. Please try again later." }, 429);
  const all = await readMap("certificateData");
  const src = all[str(body.certId, 80)];
  if (!src || src.clientKey !== key) return json({ ok: false, error: "That certificate could not be found." }, 404);
  const why = notReady(src);
  if (why) return json({ ok: false, error: why }, 400);
  const holder = (await readMap("additionalInterestData"))[str(body.holderId, 80)];
  if (!holder || holder.clientKey !== key || holder.removed) return json({ ok: false, error: "Choose a certificate holder." }, 400);

  // Recipients: the holder, any extra addresses, and a copy to the client.
  const to: string[] = [];
  const add = (list: string[], e: unknown) => { const s = str(e, 200); if (s && !list.some((x) => x.toLowerCase() === s.toLowerCase())) list.push(s); };
  if (body.toHolder !== false) add(to, holder.email);
  (Array.isArray(body.extra) ? body.extra : []).slice(0, 5).forEach((e) => add(to, e));
  if (!to.length) return json({ ok: false, error: "This holder has no e-mail on file — add one, or type an address to send to." }, 400);
  const bad = to.filter((e) => !EMAIL_RE.test(e));
  if (bad.length) return json({ ok: false, error: `Not a valid e-mail address: ${bad.join(", ")}` }, 400);
  const cc: string[] = [];
  if (body.copyMe !== false) add(cc, who);

  // The certificate this holder receives. Same holder → the same record,
  // re-sent. A new holder → a new certificate, numbered and logged like one
  // made in the AMS, so the Certificate Master shows exactly what went out.
  const holderDesc = str(holder.description, 4000);
  const by = `Client portal (${who})`;
  const sameHolder = src.holderInterestId === holder.id;
  let cert: Rec;
  if (sameHolder) {
    cert = { ...src };
    if (holderDesc) cert.description = holderDesc;
  } else {
    cert = JSON.parse(JSON.stringify(src));
    cert.id = "cert_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7);
    cert.certNo = nextCertNumber(all);
    cert.certDate = today();
    cert.createdAt = new Date().toISOString();
    cert.createdBy = by;
    cert.voided = false; delete cert.voidReason; delete cert.voidedAt;
    delete cert.reviewedAt; delete cert.reviewedBy; delete cert.lastSentAt;
    cert.aiFilled = {};
    cert.history = [];
    cert.portalIssued = true;
    cert.nameAuto = true;
    logOn(cert, by, "Created", `for ${holder.name} in the Client Portal, from ${src.certNo || src.id}`);
  }
  cert.holderInterestId = holder.id;
  cert.holdName = holder.name ?? ""; cert.holdAddr1 = holder.addr1 ?? ""; cert.holdAddr2 = holder.addr2 ?? "";
  cert.holdCity = holder.city ?? ""; cert.holdState = holder.state ?? ""; cert.holdZip = holder.zip ?? "";
  cert.holdEmail = holder.email ?? "";
  if (holderDesc) cert.description = holderDesc;
  cert = withProducer(cert, (await readStore("agencyProfile") ?? {}) as Rec);
  if (cert.nameAuto !== false) cert.name = defaultCertName(cert);

  const pdf = await buildPdf(cert);
  const insured = str(cert.insName || cert.clientName, 120);
  const subject = str(body.subject, 200).replace(/[\r\n]+/g, " ") || `Certificate of Insurance — ${insured} — ${cert.holdName}`;
  const text = str(body.message, 3000) ||
    `Hello,\n\nAttached is the certificate of insurance for ${insured}, issued to ${cert.holdName} (${cert.certNo}).\n\nThank you,\n${insured}`;
  await sendMail({ to, cc, subject, text, filename: pdfName(cert), pdf,
    footer: `Sent by ${insured} through the Universal Insurance Brokers Client Portal · ${cert.certNo}.` });

  cert.lastSentAt = new Date().toISOString();
  logOn(cert, by, "Emailed", "to " + to.join(", ") + (cc.length ? " · cc " + cc.join(", ") : ""));
  await putRecord("certificateData", String(cert.id), cert);
  return json({ ok: true, certificate: certShape(cert), to, cc, created: !sameHolder });
}

async function uploadUrl(acct: Rec, body: Rec) {
  const key = String(acct.clientKey);
  if (limited("up:" + key, 60, 60 * 60 * 1000)) return json({ ok: false, error: "Too many uploads in the last hour. Please try again later." }, 429);
  const name = str(body.fileName, 180);
  const size = Number(body.size) || 0;
  if (!name) return json({ ok: false, error: "No file name." }, 400);
  if (size > MAX_UPLOAD_BYTES) return json({ ok: false, error: `Files can be up to ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.` }, 400);
  if (/\.(exe|bat|cmd|com|msi|scr|js|vbs|ps1|sh|jar|html?|svg|php)$/i.test(name)) return json({ ok: false, error: "That type of file cannot be uploaded." }, 400);
  const path = `${storageFolder(key)}/portal_${Date.now()}_${name.replace(/[^\w.\- ()]/g, "_")}`;
  const r = await fetch(`${URL_}/storage/v1/object/upload/sign/${BUCKET}/${path.split("/").map(encodeURIComponent).join("/")}`,
    { method: "POST", headers: { ...H, "content-type": "application/json" }, body: "{}" });
  const out = await r.json().catch(() => ({}));
  const rel = String(out.url ?? out.signedURL ?? out.signedUrl ?? "");
  if (!r.ok || !rel) return json({ ok: false, error: "Uploads are not available right now." }, 502);
  return json({ ok: true, path, uploadUrl: `${URL_}/storage/v1${rel.startsWith("/") ? "" : "/"}${rel}` });
}

async function uploadDone(acct: Rec, body: Rec) {
  const key = String(acct.clientKey);
  const path = str(body.path, 400);
  const folder = storageFolder(key) + "/";
  const base = path.slice(folder.length);
  if (!path.startsWith(folder) || !/^portal_\d+_/.test(base) || base.includes("/")) return json({ ok: false, error: "Bad upload." }, 400);
  // The file must really be there before it is listed in Documents.
  const l = await fetch(`${URL_}/storage/v1/object/list/${BUCKET}`, {
    method: "POST", headers: { ...H, "content-type": "application/json" },
    body: JSON.stringify({ prefix: storageFolder(key), search: base, limit: 5 }),
  });
  const found = l.ok ? (await l.json() as Rec[]).find((o) => o.name === base) : null;
  if (!found) return json({ ok: false, error: "The upload did not finish. Please try again." }, 400);
  const meta = (found.metadata ?? {}) as Rec;
  const row = {
    client_key: key, file_name: str(body.fileName, 180) || base.replace(/^portal_\d+_/, ""), category: UPLOAD_CATEGORY,
    storage_path: path, size_bytes: Number(meta.size ?? body.size) || 0,
    mime_type: String(meta.mimetype ?? body.mimeType ?? "application/octet-stream"),
    uploaded_by: `Client portal (${acct.email})`,
  };
  const r = await fetch(`${URL_}/rest/v1/documents`, {
    method: "POST", headers: { ...H, "content-type": "application/json", Prefer: "return=representation" }, body: JSON.stringify([row]),
  });
  if (!r.ok) return json({ ok: false, error: "The file was uploaded but could not be filed. Please tell your agent." }, 502);
  const [doc] = await r.json() as Rec[];
  return json({ ok: true, document: docShape(doc ?? row, await signUrl(path)) });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "POST only." }, 405);
  if (!URL_ || !SRV) return json({ ok: false, error: "Portal is not configured." }, 503);

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
  const body = await req.json().catch(() => ({})) as Rec;
  const action = String(body.action ?? (body.lastName ? "lookup" : ""));

  try {
    if (action === "lookup" || action === "login") {
      if (limited("ip:" + ip, 20, 10 * 60 * 1000)) return json({ ok: false, error: "Too many attempts. Please wait a few minutes and try again." }, 429);
      return action === "login" ? await emailLogin(body) : await legacyLogin(body);
    }

    // Everything else needs a business session.
    const acct = await sessionAccount(body.token);
    if (!acct) return json({ ok: false, error: "Your session has ended. Please sign in again.", signedOut: true }, 401);
    const perms = permsOf(acct);
    const deny = () => json({ ok: false, error: "Your portal access does not include this. Please contact your agent." }, 403);

    switch (action) {
      case "session": {
        const out = await payload(String(acct.clientKey), acct, String(acct.displayName ?? ""));
        out.token = await makeToken(acct);
        return json(out);
      }
      case "saveHolder":      return perms.holders ? await saveHolder(acct, body) : deny();
      case "certPdf":         return perms.certificates ? await certPdf(acct, body) : deny();
      case "sendCertificate": return perms.sendCertificates ? await sendCertificate(acct, body) : deny();
      case "uploadUrl":       return perms.uploads ? await uploadUrl(acct, body) : deny();
      case "uploadDone":      return perms.uploads ? await uploadDone(acct, body) : deny();
      default:                return json({ ok: false, error: "Unknown request." }, 400);
    }
  } catch (e) {
    console.error(e);
    return json({ ok: false, error: e instanceof Error ? e.message : "Something went wrong." }, 500);
  }
});
