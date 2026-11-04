// ============================================================
//  CERTIFICATE MASTER — Certificates of Insurance
//  ------------------------------------------------------------
//  A client can hold any number of certificates (one per holder:
//  a landlord, a general contractor, a municipality). Each is a
//  record here; printing one fills the real ACORD AcroForm for its
//  certificate type (forms/acord25.pdf for the ACORD 25), so the
//  output is the official form.
//
//  A certificate is a legal statement about coverage in force. Two
//  rules follow from that and are enforced below:
//    • nothing is invented — a field the agent has not filled
//      prints blank, and AI-suggested values are flagged until the
//      agent has looked at them;
//    • the agent, not the AI, issues it — the PDF carries the
//      authorized representative the agent entered.
// ============================================================

(function () {
    'use strict';

    var STORE_KEY   = 'certificateData';
    var PROD_KEY    = 'certProducerDefaults';
    var PDFLIB_URL  = 'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js';
    var AGENCY_CC   = 'coi@universalinsurancebroker.com';

    // ── Certificate types ────────────────────────────────────
    // The types an agent can pick on a certificate. A type is `ready`
    // once its official ACORD PDF is in forms/ and its fields are mapped
    // (acord25-map.js is the pattern); until then it is listed but
    // cannot be chosen, so nobody issues a certificate on a form the
    // system cannot print. Adding one: drop the PDF in forms/ (and list
    // it in .vercelignore's exceptions, or production 404s it), write
    // its map, point `map` at it here.
    var FORM_TYPES = [
        { id: 'acord25',     code: 'ACORD 25',       title: 'CERTIFICATE OF LIABILITY INSURANCE',
          map: function () { return window.ACORD25; } },
        { id: 'acord25_101', code: 'ACORD 25 + 101', title: 'CERTIFICATE OF LIABILITY INSURANCE',
          needs: 'the ACORD 101 (Additional Remarks Schedule) PDF' },
        { id: 'acord24',     code: 'ACORD 24',       title: 'CERTIFICATE OF PROPERTY INSURANCE',
          needs: 'the ACORD 24 PDF' },
        { id: 'acord24_101', code: 'ACORD 24 + 101', title: 'CERTIFICATE OF PROPERTY INSURANCE',
          needs: 'the ACORD 24 and ACORD 101 PDFs' },
        { id: 'acord27',     code: 'ACORD 27',       title: 'EVIDENCE OF PROPERTY INSURANCE',
          needs: 'the ACORD 27 PDF' },
        { id: 'acord27_101', code: 'ACORD 27 + 101', title: 'EVIDENCE OF PROPERTY INSURANCE',
          needs: 'the ACORD 27 and ACORD 101 PDFs' },
        { id: 'acord28',     code: 'ACORD 28',       title: 'EVIDENCE OF COMMERCIAL PROPERTY INSURANCE',
          needs: 'the ACORD 28 PDF' },
        { id: 'acord28_101', code: 'ACORD 28 + 101', title: 'EVIDENCE OF COMMERCIAL PROPERTY INSURANCE',
          needs: 'the ACORD 28 and ACORD 101 PDFs' }
    ];

    function formType(id) {
        for (var i = 0; i < FORM_TYPES.length; i++) if (FORM_TYPES[i].id === id) return FORM_TYPES[i];
        return null;
    }
    function isReady(t) { return !!(t && t.map && t.map()); }
    // Certificates made before types existed are all ACORD 25s.
    function formFor(cert) { return formType((cert && cert.formType) || 'acord25') || FORM_TYPES[0]; }
    function mapFor(cert) { var t = formFor(cert); return (t.map && t.map()) || window.ACORD25; }

    // "CERTIFICATE OF LIABILITY INSURANCE (ACORD 25) (10/30/2026)" — the
    // name NowCerts gives a certificate, which agents already search by.
    function defaultName(cert) {
        var t = formFor(cert);
        return t.title + ' (' + t.code + ')' + (cert.certDate ? ' (' + mdy(cert.certDate) + ')' : '');
    }
    function displayName(cert) { return (cert && cert.name) || defaultName(cert || {}); }

    // ── Storage ──────────────────────────────────────────────
    function all() {
        try {
            var v = JSON.parse(localStorage.getItem(STORE_KEY));
            return (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
        } catch (e) { return {}; }
    }

    function save(cert) {
        var map = all();
        cert.updatedAt = new Date().toISOString();
        if (!cert.formType) cert.formType = 'acord25';
        if (cert.nameAuto !== false || !cert.name) cert.name = defaultName(cert);
        map[cert.id] = cert;
        // Goes through the merge layer like every other shared key, so
        // one device's copy can never replace another's certificates.
        if (window.UIBBinderSync) window.UIBBinderSync.save(STORE_KEY, map);
        else localStorage.setItem(STORE_KEY, JSON.stringify(map));
        return cert;
    }

    function get(id) { return all()[id] || null; }

    // ── History ──────────────────────────────────────────────
    // Who did what to a certificate, kept on the record itself so it
    // travels with it through the merge (newest record wins as a unit).
    function currentUser() {
        // ams.js declares amsCurrentUser with `let`, so it is not on window.
        return (typeof amsCurrentUser !== 'undefined' && amsCurrentUser) ? amsCurrentUser : '';
    }
    function log(cert, action, detail) {
        if (!Array.isArray(cert.history)) cert.history = [];
        cert.history.push({ at: new Date().toISOString(), by: currentUser(), action: action, detail: detail || '' });
        if (cert.history.length > 200) cert.history = cert.history.slice(-200);
        return cert;
    }
    // Certificates saved before the log existed still show when they
    // were made and last reviewed.
    function historyOf(cert) {
        var h = Array.isArray(cert.history) ? cert.history.slice() : [];
        if (!h.some(function (e) { return e.action === 'Created' || e.action === 'Copied'; }) && cert.createdAt) {
            h.unshift({ at: cert.createdAt, by: cert.createdBy || '', action: 'Created', detail: '' });
        }
        if (!cert.history && cert.reviewedAt) h.push({ at: cert.reviewedAt, by: cert.reviewedBy || '', action: 'Saved', detail: '' });
        if (!cert.history && cert.voidedAt) h.push({ at: cert.voidedAt, by: '', action: 'Voided', detail: cert.voidReason || '' });
        return h;
    }

    function forClient(clientKey) {
        var map = all(), out = [];
        Object.keys(map).forEach(function (id) {
            if (map[id] && map[id].clientKey === clientKey) out.push(map[id]);
        });
        return out.sort(function (a, b) { return (b.createdAt || '').localeCompare(a.createdAt || ''); });
    }

    // Certificates are never hard-deleted from the shared map by one
    // device: they are marked void, so a certificate that was issued
    // to a holder stays auditable.
    function voidCert(id, why) {
        var c = get(id);
        if (!c) return null;
        c.voided = true;
        c.voidReason = why || '';
        c.voidedAt = new Date().toISOString();
        log(c, 'Voided', why || '');
        return save(c);
    }

    // A new certificate with the same contents, for the next holder.
    // It gets its own number and history; the original is untouched.
    function copy(id) {
        var src = get(id);
        if (!src) return null;
        var c = JSON.parse(JSON.stringify(src));
        c.id = 'cert_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
        c.certNo = nextCertNumber();
        c.certDate = today();
        c.createdAt = new Date().toISOString();
        c.createdBy = currentUser();
        c.voided = false; delete c.voidReason; delete c.voidedAt;
        delete c.reviewedAt; delete c.reviewedBy; delete c.lastSentAt;
        c.aiFilled = {};
        c.nameAuto = false;
        c.name = displayName(src).replace(/\s*-\s*Copy$/, '') + ' - Copy';
        c.history = [];
        log(c, 'Copied', 'from ' + (src.certNo || src.id));
        return save(c);
    }

    // The policy numbers a certificate actually prints, for the list.
    function assignedPolicies(cert) {
        var out = [];
        ['glPolicyNo', 'auPolicyNo', 'umPolicyNo', 'wcPolicyNo', 'otPolicyNo'].forEach(function (k) {
            var v = String(cert[k] || '').trim();
            if (v && out.indexOf(v) === -1) out.push(v);
        });
        return out;
    }

    // ── Producer (agency) ────────────────────────────────────
    // The producer block comes from the Agency Profile (Agency
    // Management ▸ General), so the agency's name, address, phone and
    // e-mail are kept in one place and every certificate prints them.
    // Details saved by the old "Agency details" dialog only fill what
    // the profile leaves blank.
    var PROD_FIELDS = ['prodName', 'prodAddr1', 'prodAddr2', 'prodCity', 'prodState', 'prodZip',
                       'prodContact', 'prodPhone', 'prodFax', 'prodEmail'];

    function agencyProfile() {
        try { var v = JSON.parse(localStorage.getItem('agencyProfile')); return (v && typeof v === 'object') ? v : {}; }
        catch (e) { return {}; }
    }

    function fromProfile(prof) {
        prof = prof || agencyProfile();
        return {
            prodName: prof.name || '', prodAddr1: prof.address1 || '', prodAddr2: prof.address2 || '',
            prodCity: prof.city || '', prodState: prof.state || '', prodZip: prof.zip || '',
            prodContact: prof.certContact || '', prodPhone: prof.phone || '', prodFax: prof.fax || '', prodEmail: prof.email || ''
        };
    }

    function producerDefaults() {
        var legacy = {};
        try { legacy = JSON.parse(localStorage.getItem(PROD_KEY)) || {}; } catch (e) {}
        var out = Object.assign({
            prodName:    'Universal Insurance Brokers',
            prodAddr1:   '', prodAddr2: '', prodCity: '', prodState: 'FL', prodZip: '',
            prodContact: '', prodPhone: '', prodFax: '', prodEmail: '',
            // Every certificate the agency emails is copied here.
            certCcEmail: AGENCY_CC
        }, legacy);
        var prof = fromProfile();
        PROD_FIELDS.forEach(function (k) { if (prof[k]) out[k] = prof[k]; });
        return out;
    }

    // Puts the agency profile on a certificate. Used when one is made and
    // whenever one is opened, printed or sent, so a change to the profile
    // reaches every certificate without anyone retyping it.
    function applyProducer(cert) {
        var d = producerDefaults();
        PROD_FIELDS.forEach(function (k) { cert[k] = d[k] || ''; });
        return cert;
    }

    function saveProducerDefaults(obj) {
        localStorage.setItem(PROD_KEY, JSON.stringify(obj));
    }

    // ── Helpers ──────────────────────────────────────────────
    function today() {
        return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    }

    function mdy(iso) {
        if (!iso) return '';
        var m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
        return m ? m[2] + '/' + m[3] + '/' + m[1] : String(iso);
    }

    function money(v) {
        if (v == null || v === '') return '';
        var n = Number(String(v).replace(/[^0-9.-]/g, ''));
        if (!isFinite(n) || n === 0) return String(v);
        return n.toLocaleString('en-US');
    }

    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function nextCertNumber() {
        var n = 0;
        var map = all();
        Object.keys(map).forEach(function (id) {
            var m = String((map[id] || {}).certNo || '').match(/(\d+)\s*$/);
            if (m) n = Math.max(n, parseInt(m[1], 10));
        });
        return 'CERT-' + new Date().getFullYear() + '-' + String(n + 1).padStart(4, '0');
    }

    // ── Create ───────────────────────────────────────────────
    // Seeds the producer block from the agency defaults and the insured
    // block from the client record. Everything else starts blank: the
    // certificate says what the agent puts on it.
    function create(clientKey, clientName, contact, type) {
        contact = contact || {};
        var c = Object.assign({
            id:          'cert_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
            formType:    type || 'acord25',
            nameAuto:    true,
            clientKey:   clientKey,
            clientName:  clientName || '',
            certDate:    today(),
            certNo:      nextCertNumber(),
            revNo:       '',
            insName:     clientName || '',
            insAddr1:    contact.address || '',
            insAddr2:    '',
            insCity:     contact.city || '',
            insState:    contact.state || '',
            insZip:      contact.zip || '',
            holdEmail:   '',
            description: '',
            aiFilled:    {},          // key -> true for values Claude proposed
            createdAt:   new Date().toISOString(),
            // ams.js declares amsCurrentUser with `let`, so it is not on window.
            createdBy:   currentUser(),
            voided:      false,
            history:     []
        }, producerDefaults());
        // Agency settings that are not part of the printed form.
        delete c.certCcEmail;
        c.name = defaultName(c);
        log(c, 'Created', '');
        return c;
    }

    // ── Map a policy onto the right coverage band ────────────
    // Returns {row, applied:[keys], skipped:bool}. A line the ACORD 25
    // has no band for is reported rather than forced somewhere.
    function applyPolicy(cert, policy, markAi) {
        var row = window.ACORD25.rowForLineOfBusiness(policy.lineOfBusiness);
        if (!row || row.id === 'other') return { row: null, applied: [], skipped: true };

        var applied = [];
        var put = function (k, v) {
            if (v === '' || v == null) return;
            cert[k] = v;
            applied.push(k);
            if (markAi) { cert.aiFilled = cert.aiFilled || {}; cert.aiFilled[k] = true; }
        };

        var p = row.id;
        var meta = (policy.certificate && typeof policy.certificate === 'object') ? policy.certificate : {};
        var PFX = { gl: 'gl', auto: 'au', umb: 'um', wc: 'wc' }[p];

        put(PFX + 'PolicyNo', policy.policyNumber || '');
        put(PFX + 'Eff', policy.effectiveDate || policy.effDate || '');
        put(PFX + 'Exp', policy.expirationDate || '');

        // The carrier goes in the first insurer slot that is free or
        // already holds it, and that slot's letter goes on the row.
        var letter = assignInsurer(cert, policy.company || '', meta.naic || policy.naic || '');
        if (letter) put(PFX + 'Insurer', letter);

        // Sensible band defaults that are statements of form, not of
        // coverage amounts: a GL policy on this form is occurrence-based
        // unless the agent says otherwise, and WC is per statute.
        var statedAutos = Array.isArray(meta.autoCoveredAutos) && meta.autoCoveredAutos.length;
        if (p === 'gl')   { put('glOn', true); put('glOccur', true); }
        // "Any Auto" is a far broader statement than "hired and non-owned".
        // Only fall back to it when the document named no covered autos at
        // all — otherwise the certificate would claim coverage the policy
        // does not give.
        if (p === 'auto' && !statedAutos) { put('auAny', true); }
        if (p === 'umb')  { put('umUmbrella', true); put('umOccur', true); }
        if (p === 'wc')   { put('wcPerStatute', true); }

        // Limits read off the declaration page. Only values the document
        // actually stated arrive here — anything absent stays blank
        // rather than being guessed, because a limit nobody read is the
        // one that turns a certificate into a liability.
        var LIMIT_MAP = {
            gl:   { eachOccurrence: 'glEachOcc', damageToRentedPremises: 'glRented',
                    medExpAnyOnePerson: 'glMedExp', personalAndAdvInjury: 'glPersAdv',
                    generalAggregate: 'glGenAgg', productsCompOpAgg: 'glProdAgg' },
            auto: { combinedSingleLimit: 'auCsl', bodilyInjuryPerPerson: 'auBiPerson',
                    bodilyInjuryPerAccident: 'auBiAccident', propertyDamagePerAccident: 'auPd' },
            umb:  { umbrellaEachOccurrence: 'umEachOcc', umbrellaAggregate: 'umAgg',
                    umbrellaDeductibleOrRetention: 'umDedAmount' },
            wc:   { elEachAccident: 'wcEachAccident', elDiseaseEachEmployee: 'wcDiseaseEmp',
                    elDiseasePolicyLimit: 'wcDiseasePol' }
        }[p] || {};

        var limits = meta.limits || {};
        Object.keys(LIMIT_MAP).forEach(function (src) {
            var v = limits[src];
            if (v !== undefined && v !== null && String(v).trim() !== '') put(LIMIT_MAP[src], String(v).trim());
        });

        // Form-shape answers, but only where the document stated them.
        var cm = String(meta.occurrenceOrClaimsMade || '').toLowerCase();
        if (cm && (p === 'gl' || p === 'umb')) {
            var isClaims = cm.indexOf('claims') !== -1;
            if (p === 'gl') { cert.glClaimsMade = isClaims; cert.glOccur = !isClaims; applied.push('glClaimsMade', 'glOccur'); }
            else            { cert.umClaimsMade = isClaims; cert.umOccur = !isClaims; applied.push('umClaimsMade', 'umOccur'); }
        }

        var agg = String(meta.aggregateAppliesPer || '').toLowerCase();
        if (p === 'gl' && agg) {
            if (agg.indexOf('project') !== -1)    put('glAggProject', true);
            else if (agg.indexOf('loc') !== -1)   put('glAggLoc', true);
            else if (agg.indexOf('other') !== -1) put('glAggOther', true);
            else                                  put('glAggPolicy', true);
        }

        if (p === 'auto' && Array.isArray(meta.autoCoveredAutos)) {
            var AU = [['any auto', 'auAny'], ['non-owned', 'auNonOwned'], ['owned', 'auOwned'],
                      ['scheduled', 'auScheduled'], ['hired', 'auHired']];
            meta.autoCoveredAutos.forEach(function (label) {
                var s = String(label || '').toLowerCase();
                for (var i = 0; i < AU.length; i++) {
                    // "non-owned" must win over "owned", which it contains.
                    if (s.indexOf(AU[i][0]) !== -1) { put(AU[i][1], true); break; }
                }
            });
        }

        return { row: row, applied: applied, skipped: false };
    }

    function assignInsurer(cert, name, naic) {
        if (!name) return '';
        var L = window.ACORD25.INSURER_LETTERS;
        for (var i = 0; i < L.length; i++) {
            var cur = (cert['insurer' + L[i] + 'Name'] || '').trim();
            if (cur && cur.toLowerCase() === name.trim().toLowerCase()) return L[i];
        }
        for (var j = 0; j < L.length; j++) {
            if (!(cert['insurer' + L[j] + 'Name'] || '').trim()) {
                cert['insurer' + L[j] + 'Name'] = name;
                if (naic) cert['insurer' + L[j] + 'Naic'] = naic;
                return L[j];
            }
        }
        return '';
    }

    // Which of the certificate's own lines does this policy belong to?
    // Used to ask the agent the question the way they think about it.
    function bandLabel(lob) {
        var row = window.ACORD25.rowForLineOfBusiness(lob);
        return row && row.id !== 'other' ? row.title : null;
    }

    // ── What is still missing ────────────────────────────────
    // The short list an agent must look at before a certificate goes
    // out. Deliberately narrow: the things whose absence makes the
    // certificate wrong or unusable, not every blank field.
    function missing(cert) {
        var A = mapFor(cert);
        var out = [];
        if (!cert.holdName)  out.push('Certificate holder');
        if (!cert.insName)   out.push('Named insured');
        if (!cert.prodName)  out.push('Producer (agency)');
        if (!cert.authorizedRep) out.push('Authorized representative');
        var anyBand = ['gl', 'auto', 'umb', 'wc'].some(function (p) {
            return cert[p === 'gl' ? 'glPolicyNo' : p === 'auto' ? 'auPolicyNo' : p === 'umb' ? 'umPolicyNo' : 'wcPolicyNo'];
        });
        if (!anyBand) out.push('At least one policy row');
        var hasInsurer = A.INSURER_LETTERS.some(function (L) { return cert['insurer' + L + 'Name']; });
        if (!hasInsurer) out.push('Insurer affording coverage');
        return out;
    }

    // ── PDF ──────────────────────────────────────────────────
    function loadPdfLib() {
        if (window.PDFLib) return Promise.resolve(window.PDFLib);
        return new Promise(function (resolve, reject) {
            var s = document.createElement('script');
            s.src = PDFLIB_URL;
            s.onload = function () {
                window.PDFLib ? resolve(window.PDFLib)
                              : reject(new Error('pdf-lib loaded but did not register'));
            };
            s.onerror = function () { reject(new Error('Could not load the PDF library — check your connection.')); };
            document.head.appendChild(s);
        });
    }

    // Fills the genuine ACORD AcroForm. Every value comes from the
    // certificate record; nothing is derived at print time except
    // formatting (dates to MM/DD/YYYY, amounts with separators).
    function buildPdf(cert) {
        cert = applyProducer(Object.assign({}, cert));
        var t = formFor(cert);
        if (!isReady(t)) return Promise.reject(new Error(t.code + ' is not set up yet — it needs ' + (t.needs || 'its PDF') + '.'));
        var A = mapFor(cert);
        return loadPdfLib().then(function (PDFLib) {
            return fetch(A.PDF_URL).then(function (r) {
                if (!r.ok) throw new Error('Could not load the ' + t.code + ' form (HTTP ' + r.status + ')');
                return r.arrayBuffer();
            }).then(function (bytes) {
                return PDFLib.PDFDocument.load(bytes);
            }).then(function (doc) {
                var form = doc.getForm();
                var fields = A.allFields();

                fields.forEach(function (f) {
                    var v = cert[f.k];
                    if (v === undefined || v === null || v === '') return;
                    try {
                        if (f.type === 'check') {
                            if (v) form.getCheckBox(f.pdf).check();
                            return;
                        }
                        var text = String(v);
                        if (f.mdy)   text = mdy(v);
                        if (f.money) text = money(v);
                        if (f.type === 'yn') text = String(v).toUpperCase().slice(0, 1);
                        form.getTextField(f.pdf).setText(text);
                    } catch (e) {
                        // A field the form does not have must never stop a
                        // certificate from printing.
                        console.warn(t.code + ': could not set ' + f.pdf, e);
                    }
                });

                try { form.getTextField(A.EDITION_FIELD).setText(A.EDITION); } catch (e) {}
                return doc.save();
            });
        });
    }

    function fileName(cert) {
        var who = (cert.insName || cert.clientName || 'certificate').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-');
        return formFor(cert).code.replace(/\W+/g, '') + '-' + who + '-' + (cert.certNo || cert.id) + '.pdf';
    }

    function download(cert) {
        return buildPdf(cert).then(function (bytes) {
            var c = get(cert.id);
            if (c) save(log(c, 'Downloaded', fileName(cert)));
            var blob = new Blob([bytes], { type: 'application/pdf' });
            var url  = URL.createObjectURL(blob);
            var a    = document.createElement('a');
            a.href = url; a.download = fileName(cert);
            document.body.appendChild(a); a.click(); a.remove();
            setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
            return true;
        });
    }

    function preview(cert) {
        return buildPdf(cert).then(function (bytes) {
            var blob = new Blob([bytes], { type: 'application/pdf' });
            var url  = URL.createObjectURL(blob);
            window.open(url, '_blank');
            setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
            return true;
        });
    }

    // ── Email ────────────────────────────────────────────────
    // Sent by the certificate-send Supabase function (Resend), which
    // accepts signed-in staff only and always copies the agency mailbox.
    function sendUrl() {
        var base = (typeof AMS_SB_URL !== 'undefined' && AMS_SB_URL) || (window.UIB_CONFIG || {}).SUPABASE_URL || '';
        return base + '/functions/v1/certificate-send';
    }
    function anonKey() {
        return (typeof AMS_SB_KEY !== 'undefined' && AMS_SB_KEY) || (window.UIB_CONFIG || {}).SUPABASE_ANON || '';
    }
    function toBase64(bytes) {
        var out = '', CH = 0x8000;
        for (var i = 0; i < bytes.length; i += CH) out += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
        return btoa(out);
    }

    // opts: { to:[], cc:[], subject, text }. Resolves {ok:true} or
    // rejects with an Error whose `unavailable` flag means the email
    // function is not deployed / reachable (offer the mail-app route).
    function send(cert, opts) {
        if (cert.voided) return Promise.reject(new Error('A voided certificate cannot be sent.'));
        return buildPdf(cert).then(function (bytes) {
            var key = anonKey();
            return fetch(sendUrl(), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'apikey': key, 'Authorization': 'Bearer ' + key },
                body: JSON.stringify({
                    to: opts.to, cc: opts.cc || [], subject: opts.subject, text: opts.text,
                    filename: fileName(cert), pdfBase64: toBase64(bytes),
                    certId: cert.id, certNo: cert.certNo || ''
                })
            }).catch(function () {
                var e = new Error('Could not reach the email service.'); e.unavailable = true; throw e;
            }).then(function (r) {
                return r.json().catch(function () { return {}; }).then(function (out) {
                    if (r.ok && out.ok) return out;
                    var e = new Error(out.error || ('Email service answered HTTP ' + r.status));
                    e.unavailable = r.status === 404 || r.status === 503 || /RESEND_API_KEY/.test(out.error || '');
                    throw e;
                });
            });
        }).then(function (out) {
            var c = get(cert.id) || cert;
            c.lastSentAt = new Date().toISOString();
            log(c, 'Emailed', 'to ' + opts.to.join(', ') + (opts.cc && opts.cc.length ? ' · cc ' + opts.cc.join(', ') : ''));
            save(c);
            return out;
        });
    }

    window.UIBCert = {
        STORE_KEY: STORE_KEY, AGENCY_CC: AGENCY_CC, FORM_TYPES: FORM_TYPES,
        all: all, get: get, save: save, forClient: forClient, voidCert: voidCert, copy: copy,
        create: create, applyPolicy: applyPolicy, assignInsurer: assignInsurer,
        bandLabel: bandLabel, missing: missing, assignedPolicies: assignedPolicies,
        formType: formType, formFor: formFor, mapFor: mapFor, isReady: isReady,
        defaultName: defaultName, displayName: displayName, log: log, historyOf: historyOf,
        producerDefaults: producerDefaults, saveProducerDefaults: saveProducerDefaults,
        applyProducer: applyProducer, agencyProfile: agencyProfile, PROD_FIELDS: PROD_FIELDS,
        buildPdf: buildPdf, download: download, preview: preview, fileName: fileName, send: send,
        mdy: mdy, money: money, esc: esc, today: today, nextCertNumber: nextCertNumber
    };
})();
