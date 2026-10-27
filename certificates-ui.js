// ============================================================
//  CERTIFICATE MASTER — user interface
//  ------------------------------------------------------------
//  The "Certificate Master" tab on a client: the list of that
//  client's certificates, the editor, and the two prompts that pull
//  an agent into finishing one (after Claude reads a declaration
//  page, and after a new policy is saved).
//
//  Values Claude proposed are highlighted until the agent saves the
//  certificate, so nobody issues a legal document without having
//  looked at what the machine put on it.
// ============================================================

(function () {
    'use strict';

    var A = function () { return window.ACORD25; };
    var C = function () { return window.UIBCert; };
    var esc = function (s) { return window.UIBCert.esc(s); };

    var _editing = null;   // the certificate currently open in the editor

    // ── List ─────────────────────────────────────────────────
    function renderList() {
        var el = document.getElementById('certMasterList');
        if (!el) return;
        var key = window.amsActiveKey;
        if (!key) { el.innerHTML = '<p style="color:var(--gray-400);font-size:12px;">Select a client first.</p>'; return; }

        var list = C().forClient(key);
        if (!list.length) {
            el.innerHTML =
                '<div style="text-align:center;padding:34px 16px;color:var(--gray-400);">' +
                  '<div style="font-size:30px;margin-bottom:8px;">📜</div>' +
                  '<p style="font-size:13px;margin-bottom:4px;">No certificates for this client yet.</p>' +
                  '<p style="font-size:11px;">A certificate is issued to one holder — create one per landlord, ' +
                  'general contractor or municipality that asks for proof of coverage.</p>' +
                '</div>';
            return;
        }

        el.innerHTML = list.map(function (c) {
            var gaps = C().missing(c);
            var ready = gaps.length === 0;
            var badge = c.voided
                ? '<span style="background:#fee2e2;color:#991b1b;border-radius:10px;padding:2px 8px;font-size:10px;font-weight:700;">VOID</span>'
                : ready
                    ? '<span style="background:#dcfce7;color:#15803d;border-radius:10px;padding:2px 8px;font-size:10px;font-weight:700;">READY</span>'
                    : '<span style="background:#fef3c7;color:#92400e;border-radius:10px;padding:2px 8px;font-size:10px;font-weight:700;">' + gaps.length + ' TO FINISH</span>';
            var bands = ['gl', 'auto', 'umb', 'wc'].filter(function (p) {
                return c[p === 'gl' ? 'glPolicyNo' : p === 'auto' ? 'auPolicyNo' : p === 'umb' ? 'umPolicyNo' : 'wcPolicyNo'];
            }).map(function (p) {
                return ({ gl: 'General Liability', auto: 'Auto', umb: 'Umbrella/Excess', wc: 'Workers Comp' })[p];
            });

            return '' +
            '<div style="border:1px solid var(--gray-200);border-radius:10px;padding:14px 16px;margin-bottom:10px;' +
                 (c.voided ? 'opacity:.6;' : '') + '">' +
              '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;">' +
                '<div style="min-width:0;">' +
                  '<div style="font-weight:700;color:var(--navy);font-size:13px;">' +
                     (c.holdName ? esc(c.holdName) : '<span style="color:#b45309;">No certificate holder yet</span>') +
                     ' &nbsp;' + badge +
                  '</div>' +
                  '<div style="font-size:11px;color:var(--gray-500);margin-top:3px;">' +
                     esc(c.certNo || '') + (c.certDate ? ' · ' + esc(C().mdy(c.certDate)) : '') +
                     (bands.length ? ' · ' + esc(bands.join(', ')) : ' · no policy rows') +
                  '</div>' +
                  (gaps.length && !c.voided
                     ? '<div style="font-size:11px;color:#b45309;margin-top:4px;">Still needed: ' + esc(gaps.join(', ')) + '</div>'
                     : '') +
                '</div>' +
                '<div style="display:flex;gap:6px;flex-shrink:0;flex-wrap:wrap;justify-content:flex-end;">' +
                  '<button onclick="certOpenEditor(\'' + esc(c.id) + '\')" style="' + btn('#fff', 'var(--navy)', true) + '">Open</button>' +
                  (c.voided ? '' :
                    '<button onclick="certPreview(\'' + esc(c.id) + '\')" style="' + btn('var(--navy)', '#fff') + '">View PDF</button>' +
                    '<button onclick="certDownload(\'' + esc(c.id) + '\')" style="' + btn('var(--green)', '#fff') + '">Download</button>') +
                '</div>' +
              '</div>' +
            '</div>';
        }).join('');
    }

    function btn(bg, fg, outline) {
        return 'padding:6px 12px;border-radius:6px;font-size:11px;font-weight:600;cursor:pointer;' +
               'background:' + bg + ';color:' + fg + ';' +
               (outline ? 'border:1px solid var(--gray-200);' : 'border:none;');
    }

    // ── Create ───────────────────────────────────────────────
    function newForClient() {
        var key = window.amsActiveKey;
        if (!key) { alert('Open a client first.'); return; }
        var contacts = window.amsGetClientData ? window.amsGetClientData() : {};
        var contact  = contacts[key] || {};
        var name     = (window.amsClientIndex && window.amsClientIndex[key] && window.amsClientIndex[key].displayName) || key;
        var cert     = C().create(key, name, contact);
        C().save(cert);
        renderList();
        openEditor(cert.id);
    }

    // ── Editor ───────────────────────────────────────────────
    function openEditor(id) {
        var cert = C().get(id);
        if (!cert) { alert('That certificate could no longer be found.'); return; }
        _editing = cert;

        var html = '';
        A().INFO_SECTIONS.forEach(function (s) { html += section(s, cert); });
        html += '<div style="margin:18px 0 8px;font-weight:800;color:var(--navy);font-size:13px;">Coverages</div>';
        A().COVERAGE_ROWS.forEach(function (r) { html += coverageRow(r, cert); });
        A().TAIL_SECTIONS.forEach(function (s) { html += section(s, cert); });

        var gaps = C().missing(cert);
        var modal = document.createElement('div');
        modal.id = 'certEditorModal';
        modal.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:10001;display:flex;' +
                              'align-items:flex-start;justify-content:center;padding:24px 16px;overflow-y:auto;';
        modal.onclick = function (e) { if (e.target === modal) closeEditor(); };
        modal.innerHTML =
          '<div style="background:#fff;border-radius:12px;max-width:940px;width:100%;margin:auto;display:flex;flex-direction:column;max-height:92vh;" onclick="event.stopPropagation()">' +
            '<div style="padding:18px 22px;border-bottom:1px solid var(--gray-200);display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-shrink:0;">' +
              '<div>' +
                '<h2 style="font-size:17px;color:var(--navy);margin:0;">📜 ACORD 25 — Certificate of Liability Insurance</h2>' +
                '<p style="font-size:11px;color:var(--gray-400);margin:4px 0 0;">' +
                   esc(cert.clientName || '') + ' · ' + esc(cert.certNo || '') +
                   ' — prints on the official ACORD 25 (2025/12) form.' +
                '</p>' +
                (gaps.length ? '<p style="font-size:11px;color:#b45309;margin:6px 0 0;font-weight:600;">Still needed before issuing: ' + esc(gaps.join(', ')) + '</p>' : '') +
              '</div>' +
              '<button onclick="certCloseEditor()" style="background:none;border:none;font-size:22px;cursor:pointer;color:var(--gray-400);padding:2px 6px;">✕</button>' +
            '</div>' +
            '<div style="padding:20px 22px;overflow-y:auto;flex:1;">' +
              '<div id="certAiNote" style="display:none;background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:10px 12px;margin-bottom:14px;font-size:11px;color:#1e40af;">' +
                 '🤖 Highlighted fields were read from a document by Claude. Check them against the declaration page before you issue this certificate.' +
              '</div>' +
              html +
            '</div>' +
            '<div style="padding:12px 22px;border-top:1px solid var(--gray-200);display:flex;gap:8px;justify-content:space-between;flex-shrink:0;flex-wrap:wrap;">' +
              '<div style="display:flex;gap:8px;">' +
                '<button onclick="certPullFromPolicies()" style="' + btn('var(--blue-pale)', 'var(--navy)', true) + 'padding:9px 15px;font-size:12px;">↻ Pull from client policies</button>' +
                '<button onclick="certVoid()" style="' + btn('#fff', '#991b1b', true) + 'padding:9px 15px;font-size:12px;">Void</button>' +
              '</div>' +
              '<div style="display:flex;gap:8px;">' +
                '<button onclick="certSaveEditor()" style="' + btn('var(--navy)', '#fff') + 'padding:9px 16px;font-size:12px;">💾 Save</button>' +
                '<button onclick="certSaveEditor(true)" style="' + btn('var(--green)', '#fff') + 'padding:9px 16px;font-size:12px;">💾 Save &amp; download PDF</button>' +
              '</div>' +
            '</div>' +
          '</div>';
        document.body.appendChild(modal);

        if (cert.aiFilled && Object.keys(cert.aiFilled).length) {
            var n = document.getElementById('certAiNote');
            if (n) n.style.display = 'block';
        }
    }

    function closeEditor() {
        var m = document.getElementById('certEditorModal');
        if (m) m.remove();
        _editing = null;
    }

    // ── Rendering pieces ─────────────────────────────────────
    function section(sec, cert) {
        return '<div style="margin-bottom:18px;">' +
            '<h4 style="font-size:12px;color:var(--navy);margin-bottom:9px;padding-bottom:5px;border-bottom:1px solid var(--gray-200);text-transform:uppercase;letter-spacing:.3px;">' +
               esc(sec.title) + '</h4>' +
            '<div style="display:grid;grid-template-columns:repeat(' + (sec.cols || 2) + ',1fr);gap:10px;">' +
               sec.fields.map(function (f) { return input(f, cert); }).join('') +
            '</div></div>';
    }

    function coverageRow(row, cert) {
        var checks = (row.checks || []).map(function (c) {
            return '<label style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--gray-600);cursor:pointer;">' +
                '<input type="checkbox" id="cf_' + c.k + '"' + (cert[c.k] ? ' checked' : '') +
                       ' style="width:14px;height:14px;cursor:pointer;">' + esc(c.label) + '</label>';
        }).join('');

        var limits = (row.limits || []).map(function (l) {
            var descInput = l.descK
                ? '<input type="text" id="cf_' + l.descK + '" value="' + esc(cert[l.descK] || '') +
                  '" placeholder="describe" style="' + inputCss() + 'margin-bottom:4px;">'
                : '';
            return '<div' + aiWrap(cert, l.k) + '>' +
                '<label style="' + labelCss() + '">' + esc(l.label) + aiTag(cert, l.k) + '</label>' +
                descInput +
                '<input type="text" id="cf_' + l.k + '" value="' + esc(cert[l.k] || '') +
                   '" inputmode="numeric" placeholder="$" style="' + inputCss() + '">' +
            '</div>';
        }).join('');

        return '<div style="border:1px solid var(--gray-200);border-radius:9px;padding:13px 15px;margin-bottom:12px;">' +
            '<div style="font-weight:700;color:var(--navy);font-size:12px;margin-bottom:9px;">' + esc(row.title) + '</div>' +
            (checks ? '<div style="display:flex;flex-wrap:wrap;gap:10px 16px;margin-bottom:11px;">' + checks + '</div>' : '') +
            '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:9px;margin-bottom:' + (limits ? '11px' : '0') + ';">' +
               (row.fields || []).map(function (f) { return input(f, cert); }).join('') +
            '</div>' +
            (limits ? '<div style="font-size:10px;font-weight:700;color:var(--gray-500);text-transform:uppercase;margin-bottom:6px;">Limits</div>' +
                      '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:9px;">' + limits + '</div>' : '') +
        '</div>';
    }

    function inputCss() {
        return 'width:100%;padding:7px 9px;border:1px solid var(--gray-200);border-radius:6px;font-size:12px;box-sizing:border-box;';
    }
    function labelCss() {
        return 'font-size:10px;font-weight:600;color:var(--gray-500);display:block;margin-bottom:3px;';
    }
    function aiWrap(cert, k) {
        return (cert.aiFilled && cert.aiFilled[k])
            ? ' style="background:#eff6ff;border-radius:7px;padding:5px 6px;margin:-5px -6px;"' : '';
    }
    function aiTag(cert, k) {
        return (cert.aiFilled && cert.aiFilled[k])
            ? ' <span style="color:#1d4ed8;font-size:9px;font-weight:700;">🤖 from document</span>' : '';
    }

    function input(f, cert) {
        var v = cert[f.k] == null ? '' : cert[f.k];
        var span = f.wide ? ' grid-column:1/-1;' : '';
        var el;
        if (f.type === 'textarea') {
            el = '<textarea id="cf_' + f.k + '" rows="4" style="' + inputCss() + 'resize:vertical;font-family:inherit;">' + esc(v) + '</textarea>';
        } else if (f.type === 'yn') {
            el = '<select id="cf_' + f.k + '" style="' + inputCss() + '">' +
                 ['', 'Y', 'N'].map(function (o) {
                     return '<option value="' + o + '"' + (String(v).toUpperCase() === o ? ' selected' : '') + '>' + (o || '—') + '</option>';
                 }).join('') + '</select>';
        } else {
            el = '<input type="' + (f.type === 'date' ? 'date' : 'text') + '" id="cf_' + f.k + '" value="' + esc(v) + '"' +
                 (f.max ? ' maxlength="' + f.max + '"' : '') + ' style="' + inputCss() + '">';
        }
        return '<div style="' + span + '"' + (aiWrap(cert, f.k) ? ' ' + aiWrap(cert, f.k).slice(7, -1) : '') + '>' +
            '<label style="' + labelCss() + '">' + esc(f.label) + aiTag(cert, f.k) + '</label>' + el + '</div>';
    }

    // ── Collect + save ───────────────────────────────────────
    function collect(cert) {
        A().allFields().forEach(function (f) {
            var el = document.getElementById('cf_' + f.k);
            if (!el) return;
            cert[f.k] = (f.type === 'check') ? !!el.checked : el.value;
        });
        return cert;
    }

    function saveEditor(andDownload) {
        if (!_editing) return;
        collect(_editing);
        // Once the agent has saved, the AI flags come off: they have
        // seen the values and taken responsibility for them.
        _editing.aiFilled = {};
        _editing.reviewedBy = window.amsCurrentUser || '';
        _editing.reviewedAt = new Date().toISOString();
        var cert = C().save(_editing);
        renderList();
        if (andDownload) {
            var gaps = C().missing(cert);
            if (gaps.length && !confirm('This certificate is still missing:\n\n  • ' + gaps.join('\n  • ') +
                                        '\n\nDownload it anyway?')) return;
            C().download(cert).catch(function (e) { alert('Could not build the PDF: ' + e.message); });
        }
        closeEditor();
        if (window.amsFlashBanner) window.amsFlashBanner('Certificate saved ✓');
    }

    // Re-read the client's policies in the AMS and fill any coverage
    // band they map onto. Only fills what is blank — it never
    // overwrites something the agent typed.
    function pullFromPolicies() {
        if (!_editing) return;
        collect(_editing);
        var client = window.amsClientIndex && window.amsClientIndex[_editing.clientKey];
        var pols = (client && client.policies) || [];
        if (!pols.length) { alert('This client has no policies in the AMS yet.'); return; }

        var filled = 0, skipped = [];
        pols.forEach(function (p) {
            var band = C().bandLabel(p.lineOfBusiness);
            if (!band) { if (p.lineOfBusiness) skipped.push(p.lineOfBusiness); return; }
            var before = JSON.stringify(_editing);
            var snapshot = Object.assign({}, _editing);
            var res = C().applyPolicy(_editing, p, false);
            // Keep anything the agent had already entered.
            res.applied.forEach(function (k) { if (snapshot[k]) _editing[k] = snapshot[k]; });
            if (JSON.stringify(_editing) !== before) filled++;
        });

        C().save(_editing);
        closeEditor();
        openEditor(_editing.id);
        var msg = filled ? filled + ' policy row' + (filled > 1 ? 's' : '') + ' filled in.' : 'Nothing new to fill.';
        if (skipped.length) {
            msg += '\n\nNot placed on the certificate (the ACORD 25 has no row for them):\n  • ' +
                   Array.from(new Set(skipped)).join('\n  • ');
        }
        alert(msg);
    }

    function voidCertificate() {
        if (!_editing) return;
        var why = prompt('Void this certificate?\n\nIt stays on file for the audit trail but can no longer be issued.\n\nReason (optional):');
        if (why === null) return;
        C().voidCert(_editing.id, why);
        closeEditor();
        renderList();
        if (window.amsFlashBanner) window.amsFlashBanner('Certificate voided');
    }

    // ── Prompts ──────────────────────────────────────────────
    // After a policy is saved: pull the agent straight into finishing
    // the certificate, which is the thing they would otherwise forget.
    function offerAfterSave(clientKey, policies, clientName) {
        var certLines = (policies || []).filter(function (p) { return C().bandLabel(p.lineOfBusiness); });
        if (!certLines.length) return false;

        var names = Array.from(new Set(certLines.map(function (p) { return C().bandLabel(p.lineOfBusiness); })));
        var existing = C().forClient(clientKey).filter(function (c) { return !c.voided; });
        var question =
            (certLines.length === 1
                ? 'The policy you just saved (' + names[0] + ') is a line that appears on a Certificate of Liability Insurance.'
                : 'The policies you just saved (' + names.join(', ') + ') are lines that appear on a Certificate of Liability Insurance.') +
            '\n\n' +
            (existing.length
                ? 'This client has ' + existing.length + ' certificate' + (existing.length > 1 ? 's' : '') +
                  '. Open the most recent one and add this coverage?'
                : 'Start a certificate for this client now?') +
            '\n\nYou can finish anything the system could not fill.';

        if (!confirm(question)) return false;

        var cert;
        if (existing.length) {
            cert = existing[0];
        } else {
            var contacts = window.amsGetClientData ? window.amsGetClientData() : {};
            cert = C().create(clientKey, clientName || clientKey, contacts[clientKey] || {});
        }
        certLines.forEach(function (p) { C().applyPolicy(cert, p, true); });
        C().save(cert);

        if (window.amsLoadClientDetail) window.amsLoadClientDetail(clientKey);
        if (window.amsShowTab) window.amsShowTab('certificates');
        setTimeout(function () { openEditor(cert.id); }, 150);
        return true;
    }

    // Offered from the AI panel once Claude has read a declaration page.
    function offerFromExtraction(clientKey, clientName, policies) {
        return offerAfterSave(clientKey, policies, clientName);
    }

    // The producer block is the same on every certificate the agency
    // issues, so it is kept once and seeded into each new one.
    function editProducer() {
        var d = C().producerDefaults();
        var spec = A().INFO_SECTIONS.filter(function (s) { return s.id === 'producer'; })[0];
        var modal = document.createElement('div');
        modal.id = 'certProducerModal';
        modal.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:10002;display:flex;' +
                              'align-items:flex-start;justify-content:center;padding:24px 16px;overflow-y:auto;';
        modal.onclick = function (e) { if (e.target === modal) modal.remove(); };
        modal.innerHTML =
          '<div style="background:#fff;border-radius:12px;max-width:620px;width:100%;margin:auto;" onclick="event.stopPropagation()">' +
            '<div style="padding:18px 22px;border-bottom:1px solid var(--gray-200);">' +
              '<h2 style="font-size:16px;color:var(--navy);margin:0;">Agency details</h2>' +
              '<p style="font-size:11px;color:var(--gray-400);margin:4px 0 0;">Used as the PRODUCER block on every new certificate.</p>' +
            '</div>' +
            '<div style="padding:20px 22px;display:grid;grid-template-columns:1fr 1fr;gap:10px;">' +
               spec.fields.map(function (f) { return input(f, d); }).join('') +
            '</div>' +
            '<div style="padding:12px 22px;border-top:1px solid var(--gray-200);display:flex;gap:8px;justify-content:flex-end;">' +
              '<button onclick="document.getElementById(\'certProducerModal\').remove()" style="' + btn('#fff', 'var(--gray-500)', true) + 'padding:9px 15px;font-size:12px;">Cancel</button>' +
              '<button onclick="certSaveProducer()" style="' + btn('var(--navy)', '#fff') + 'padding:9px 16px;font-size:12px;">Save</button>' +
            '</div>' +
          '</div>';
        document.body.appendChild(modal);
    }

    function saveProducer() {
        var spec = A().INFO_SECTIONS.filter(function (s) { return s.id === 'producer'; })[0];
        var out = {};
        spec.fields.forEach(function (f) {
            var el = document.getElementById('cf_' + f.k);
            if (el) out[f.k] = el.value;
        });
        C().saveProducerDefaults(out);
        var m = document.getElementById('certProducerModal');
        if (m) m.remove();
        if (window.amsFlashBanner) window.amsFlashBanner('Agency details saved ✓');
    }

    // ── Exports (onclick handlers live on window) ────────────
    window.certEditProducer = editProducer;
    window.certSaveProducer = saveProducer;
    window.certRenderList      = renderList;
    window.certNewForClient    = newForClient;
    window.certOpenEditor      = openEditor;
    window.certCloseEditor     = closeEditor;
    window.certSaveEditor      = saveEditor;
    window.certPullFromPolicies = pullFromPolicies;
    window.certVoid            = voidCertificate;
    window.certPreview = function (id) {
        var c = C().get(id);
        if (c) C().preview(c).catch(function (e) { alert('Could not build the PDF: ' + e.message); });
    };
    window.certDownload = function (id) {
        var c = C().get(id);
        if (c) C().download(c).catch(function (e) { alert('Could not build the PDF: ' + e.message); });
    };
    window.UIBCertUI = {
        renderList: renderList,
        openEditor: openEditor,
        offerAfterSave: offerAfterSave,
        offerFromExtraction: offerFromExtraction
    };
})();
