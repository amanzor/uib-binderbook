// ============================================================
//  CERTIFICATE MASTER — ACORD 25 Certificates of Liability
//  ------------------------------------------------------------
//  A client can hold any number of certificates (one per holder:
//  a landlord, a general contractor, a municipality). Each is a
//  record here; printing one fills the real ACORD 25 AcroForm in
//  forms/acord25.pdf, so the output is the official form.
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
        map[cert.id] = cert;
        // Goes through the merge layer like every other shared key, so
        // one device's copy can never replace another's certificates.
        if (window.UIBBinderSync) window.UIBBinderSync.save(STORE_KEY, map);
        else localStorage.setItem(STORE_KEY, JSON.stringify(map));
        return cert;
    }

    function get(id) { return all()[id] || null; }

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
        return save(c);
    }

    // ── Producer (agency) defaults ───────────────────────────
    function producerDefaults() {
        var d = {};
        try { d = JSON.parse(localStorage.getItem(PROD_KEY)) || {}; } catch (e) {}
        return Object.assign({
            prodName:    'Universal Insurance Brokers',
            prodAddr1:   '', prodAddr2: '', prodCity: '', prodState: 'FL', prodZip: '',
            prodContact: '', prodPhone: '', prodFax: '', prodEmail: ''
        }, d);
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
    function create(clientKey, clientName, contact) {
        contact = contact || {};
        var c = Object.assign({
            id:          'cert_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
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
            description: '',
            aiFilled:    {},          // key -> true for values Claude proposed
            createdAt:   new Date().toISOString(),
            createdBy:   (window.amsCurrentUser || ''),
            voided:      false
        }, producerDefaults());
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
        var out = [];
        if (!cert.holdName)  out.push('Certificate holder');
        if (!cert.insName)   out.push('Named insured');
        if (!cert.prodName)  out.push('Producer (agency)');
        if (!cert.authorizedRep) out.push('Authorized representative');
        var anyBand = ['gl', 'auto', 'umb', 'wc'].some(function (p) {
            return cert[p === 'gl' ? 'glPolicyNo' : p === 'auto' ? 'auPolicyNo' : p === 'umb' ? 'umPolicyNo' : 'wcPolicyNo'];
        });
        if (!anyBand) out.push('At least one policy row');
        var hasInsurer = window.ACORD25.INSURER_LETTERS.some(function (L) { return cert['insurer' + L + 'Name']; });
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
        return loadPdfLib().then(function (PDFLib) {
            return fetch(window.ACORD25.PDF_URL).then(function (r) {
                if (!r.ok) throw new Error('Could not load the ACORD 25 form (HTTP ' + r.status + ')');
                return r.arrayBuffer();
            }).then(function (bytes) {
                return PDFLib.PDFDocument.load(bytes);
            }).then(function (doc) {
                var form = doc.getForm();
                var fields = window.ACORD25.allFields();

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
                        console.warn('ACORD 25: could not set ' + f.pdf, e);
                    }
                });

                try { form.getTextField(window.ACORD25.EDITION_FIELD).setText(window.ACORD25.EDITION); } catch (e) {}
                return doc.save();
            });
        });
    }

    function fileName(cert) {
        var who = (cert.insName || cert.clientName || 'certificate').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-');
        return 'ACORD25-' + who + '-' + (cert.certNo || cert.id) + '.pdf';
    }

    function download(cert) {
        return buildPdf(cert).then(function (bytes) {
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

    window.UIBCert = {
        STORE_KEY: STORE_KEY,
        all: all, get: get, save: save, forClient: forClient, voidCert: voidCert,
        create: create, applyPolicy: applyPolicy, assignInsurer: assignInsurer,
        bandLabel: bandLabel, missing: missing,
        producerDefaults: producerDefaults, saveProducerDefaults: saveProducerDefaults,
        buildPdf: buildPdf, download: download, preview: preview, fileName: fileName,
        mdy: mdy, money: money, esc: esc, today: today, nextCertNumber: nextCertNumber
    };
})();
