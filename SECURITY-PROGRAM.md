# Universal Insurance Broker — Written Information Security & Privacy Program

Owner: Alberto Manzor (Security Coordinator) · Reviewed: yearly, and after any incident · Last review: October 2026

This document is the agency's written information security program required by the FTC Safeguards Rule (16 CFR 314, under the Gramm-Leach-Bliley Act) and by Florida insurance privacy rules (F.A.C. 69O-128). It records what the Binder Book does, what the people must do, and who is responsible. It is a working document, not legal advice; have counsel confirm it for the states you are licensed in.

## 1. Laws that apply, and how each is met

| Law | Applies? | Where it is met |
| --- | --- | --- |
| GLBA privacy & Safeguards Rule | Yes, as a licensed insurance agency | Sections 3–11 below; privacy notice (`privacy-notice.html`) |
| Florida insurance privacy (F.A.C. 69O-128) | Yes | Privacy notice, access & correction rights, health-information handling |
| Florida Information Protection Act (Fla. Stat. 501.171) | Yes | Incident response (section 10): notice within 30 days |
| Florida record-keeping (Fla. Stat. 626.748) | Yes | Retention (section 8): 5 years after a policy ends |
| NAIC Insurance Data Security Model Law (#668) | Where adopted by a state you are licensed in | Same controls; 72-hour regulator notice is built into section 10 |
| HIPAA | Only if the agency signs a Business Associate Agreement with a health plan | Health entries are treated as sensitive; sign a BAA before servicing a plan that requires one |
| FCRA | Only if consumer reports (credit, CLUE, MVR) are ordered and used for adverse decisions | The Binder Book orders none; carriers that do must give adverse-action notices |
| TCPA / CAN-SPAM | Only for marketing texts, calls or emails | The Binder Book sends none; add consent tracking before adding marketing |
| State comprehensive privacy laws (CA, TX, …) | Generally exempt for GLBA-covered data | Revisit if the agency serves customers in those states outside insurance |

## 2. Scope and data inventory

Nonpublic personal information held: names, addresses, phone and email, dates of birth, driver license numbers, last 4 of SSN (full SSN only on ACORD claim and employee forms), vehicle and property data, policy and premium data, payment method (never full card numbers), health information on health entries, uploaded client documents.

Where it lives: Supabase project `jgjmobktucyimupelfxd` (Postgres `app_store` and relational tables, Storage bucket `client-files`), the browser's local storage on each agent's device, and the devices and email accounts used to work with customers.

## 3. Access and permissions

- Every person has an individual login. There are no shared accounts.
- Roles: **agent** (own entries and assigned clients; cannot reassign or delete policies) and **administrator** (Alberto, Randy, Amanda only; fixed in `uib-auth.js` and in the `admin-users` function).
- Logins are created, linked, reset and removed from **Manage Login Credentials**. Remove an account the day a person leaves.
- Outside vendors have no logins. The AI assistant (Anthropic API) receives only the fields of the record being worked on, through a function that requires a signed-in user.

## 4. Authentication

- Supabase Auth email + password, minimum 10 characters, temporary passwords changed at first sign-in.
- **2-step verification** (authenticator app) is switched on for the whole agency from Manage Login Credentials; the Safeguards Rule expects it on, so keep it off only while accounts are being set up. Administrators can clear a lost authenticator there.
- Sessions end when the tab closes or after 30 idle minutes.
- Optional human verification (Cloudflare Turnstile) can be switched on with a site key.

## 5. Encryption

- In transit: HTTPS only (Vercel and Supabase), with a Content-Security-Policy, frame denial and nosniff headers.
- At rest: Supabase encrypts database and storage volumes (AES-256). Daily backups are enabled in the Supabase dashboard.
- Devices: every laptop or phone used for the Binder Book must have full-disk encryption (FileVault / BitLocker / iOS / Android default) and a screen lock.
- Full Social Security numbers are collected only on ACORD claim and employee forms and stay on the device that filled them; do not email them.

## 6. Audit logs

The `audit_log` table (append-only) records sign-in and sign-out, every customer record viewed in the AMS, every save, delete, export and file download, retention deletions, credential changes, and each yearly acknowledgment. Administrators review it from **Access Log** in the admin console. Keep 5 years. Review monthly for sign-ins at odd hours, exports, and deletions.

## 7. Customer privacy notices

- Give every new customer the Privacy Notice (`privacy-notice.html`, print or email) when the first policy is bound, and yearly thereafter if sharing practices change.
- Record the delivery date and method on the client's Contact tab in the AMS (**Privacy notice delivered** fields). The Access Log shows who recorded it.
- Access and correction requests: respond within 30 business days; log the request and the response in the client's notes.

## 8. Data sharing, retention and deletion

- Customer data goes only to the carrier or MGA writing the policy, premium finance companies, and the service providers in section 9. No exports to personal email, personal cloud drives or messaging apps.
- Exports (CSV, Excel, PDF) are available to administrators and to agents for their own entries only, and every export is logged.
- The old Google Apps Script mirror and email relay have been removed from the app; archive the Apps Script deployment and clear its spreadsheet.
- Retention: keep policy and transaction records **5 years after the policy ends** (Fla. Stat. 626.748); the Binder Book defaults to 7 years to cover carrier contracts. Prospects that never bound: 2 years. Audit log: 5 years.
- **Retention Review** in the admin console lists entries past the retention period; delete them there unless they are on **legal hold**. Put a record on legal hold the day you learn of a claim dispute, complaint, subpoena or regulator inquiry, and keep it until counsel releases it.
- Customer deletion requests: Florida insurance records must be kept for the retention period even if the customer asks for deletion; explain this and delete after the period.

## 9. Vendor management

| Vendor | What they hold | Safeguards | Review |
| --- | --- | --- | --- |
| Supabase (database, storage, auth, functions) | All customer data | SOC 2 Type II, HIPAA-ready tiers, encryption at rest, row-level security enforced by our SQL | Yearly: confirm plan, backups, and that only Alberto holds the service-role key |
| Vercel (hosting) | Page source only, no customer data | SOC 2, HTTPS, security headers from `vercel.json` | Yearly |
| Anthropic (AI assistant) | Fields of the record being worked on, per request; not used for training under API terms | Called only through the signed-in `claude` function | Yearly |
| Cloudflare Turnstile (optional) | Visitor challenge data | No customer data | When enabled |
| Carriers / MGAs / premium finance | Policy data for policies they write | Governed by producer agreements | Per contract |

Before adding any new vendor or integration: confirm it is needed for the business, what data it receives, that it has a security attestation (SOC 2 or equivalent), and that the contract requires breach notice to the agency. Record it in this table.

## 10. Incident response

An **incident** is any lost or stolen device, phishing success, unknown sign-in, malware, misdirected email containing customer data, or any suspected unauthorized access to Supabase.

1. **Same day — contain.** Report to the Security Coordinator. Sign the affected account out everywhere (Manage Login Credentials ▸ Reset password, Clear 2-step), rotate the Supabase anon key if page source or a device was exposed, and preserve the Access Log.
2. **Within 72 hours — assess.** From the Access Log and Supabase auth logs, determine which records were accessed, how many customers, and whether data left the agency. Write it down: dates, people, systems, records.
3. **Notify.**
   - Affected customers: **within 30 days** of determining a breach (Fla. Stat. 501.171), by mail or email, describing what happened, what data, and what we are doing.
   - Florida Department of Legal Affairs: within 30 days if more than 500 Florida residents are affected.
   - Florida Office of Insurance Regulation and any other state insurance department where the agency is licensed: as that state requires (72 hours under NAIC Model Law states).
   - Carriers whose policyholders are affected: per the producer agreement, usually promptly.
   - Consumer reporting agencies: if more than 1,000 individuals.
   - Cyber insurance carrier: immediately, before engaging outside help, if a policy is in force.
4. **Afterwards — fix and record.** Close the gap that allowed it, update this program, and keep the incident file for 5 years.

## 11. Training

- Every user accepts the **Confidentiality & security acknowledgment** in the app once a year (the app blocks work until it is accepted; administrators see who has accepted in the Access Log page).
- Yearly 30-minute training covers: what counts as customer data, phishing, passwords and 2-step, no exports to personal accounts, device encryption and lock, and how to report an incident. Keep the attendance list with this document.
- New hires: training and acknowledgment before their login is created.

## 12. Risk assessment (yearly)

Review each row in sections 3–11, the Supabase policies (`supabase-auth-lockdown.sql`, `supabase-compliance.sql`), the list of administrators, open vendor contracts, and the past year's Access Log and incidents. Record the date and any changes at the top of this document.
