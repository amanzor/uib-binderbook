// ============================================================
//  CERTIFICATE MASTER — user interface
//  ------------------------------------------------------------
//  The "Certificate Master" tab on a client, laid out the way agents
//  know it from NowCerts:
//    • a search panel and the CERTIFICATES grid (Actions, Name,
//      Certificate Holder, Assigned Policies, User), paged, with the
//      certificates' history underneath;
//    • the Add / Edit Certificate window: a General panel (certificate
//      type, name, policies, holder, blanket additional insured /
//      waiver of subrogation) over the certificate itself, laid out
//      like the ACORD form it prints on;
//    • Send Certificate: e-mail the PDF to the holder and the client,
//      always copying the agency's certificate mailbox.
//
//  Values Claude proposed are highlighted until the agent saves the
//  certificate, so nobody issues a legal document without having
//  looked at what the machine put on it.
// ============================================================

(function () {
    'use strict';

    var A = function (cert) { return window.UIBCert.mapFor(cert || _editing || {}); };
    var C = function () { return window.UIBCert; };
    var I = function () { return window.UIBInterests; };
    var esc = function (s) { return window.UIBCert.esc(s); };
    var escJs = function (s) { return esc(String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")); };

    var _editing = null;   // the certificate open in the editor (a working copy)
    var _isNew   = false;  // true until a brand-new certificate is first saved
    var _before  = '';     // the editor's starting values, to describe what changed

    // ams.js declares amsActiveKey, amsClientIndex and amsCurrentUser with
    // `let`, so they are NOT properties of window — reading them off window
    // yields undefined with no error, which looks exactly like "no client is
    // selected". Read the bindings themselves, guarded in case this file is
    // ever loaded on a page without ams.js.
    function activeKey()   { return (typeof amsActiveKey   !== 'undefined') ? amsActiveKey   : null; }
    function clientIndex() { return (typeof amsClientIndex !== 'undefined') ? amsClientIndex : {}; }
    function currentUser() { return (typeof amsCurrentUser !== 'undefined' && amsCurrentUser) ? amsCurrentUser : ''; }
    function contactOf(key) {
        var all = window.amsGetClientData ? window.amsGetClientData() : {};
        return all[key] || {};
    }
    function flash(msg) { if (window.amsFlashBanner) window.amsFlashBanner(msg); }
    var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    // ── Styles (shared with additional-interests.js) ─────────
    function injectCss() {
        if (document.getElementById('cmStyles')) return;
        var css = '' +
        '.cm-panel{background:#fff;border:1px solid #dfe3e8;border-radius:6px;margin-bottom:14px;}' +
        '.cm-panel-head{display:flex;align-items:center;gap:10px;padding:9px 14px;background:#f5f7fa;border-bottom:1px solid #dfe3e8;border-radius:6px 6px 0 0;font-size:11.5px;font-weight:700;letter-spacing:.4px;text-transform:uppercase;color:#334155;}' +
        '.cm-panel-head .cm-grow{flex:1;}' +
        '.cm-panel-body{padding:12px 14px;}' +
        '.cm-search{display:grid;grid-template-columns:minmax(160px,1.3fr) minmax(220px,1.4fr) minmax(220px,1.4fr) minmax(150px,1fr);gap:10px 14px;align-items:end;}' +
        '.cm-search label,.cm-field{display:flex;flex-direction:column;gap:3px;font-size:10.5px;font-weight:600;color:#64748b;}' +
        '.cm-range{display:flex;gap:4px;align-items:center;}' +
        '.cm-range span{color:#94a3b8;}' +
        '.cm-search input,.cm-search select,.cm-field input,.cm-field select,.cm-field textarea{padding:6px 8px;border:1px solid #cfd6de;border-radius:4px;font-size:12px;font-family:inherit;color:#0f172a;background:#fff;box-sizing:border-box;width:100%;min-width:0;}' +
        '.cm-field input[type=checkbox]{width:14px;height:14px;padding:0;margin:0 6px 0 0;vertical-align:-2px;}' +
        '.cm-btn{padding:5px 11px;border:1px solid #cfd6de;background:#fff;color:#1e293b;border-radius:4px;font-size:11.5px;font-weight:600;cursor:pointer;font-family:inherit;white-space:nowrap;}' +
        '.cm-btn:hover{background:#f1f5f9;}' +
        '.cm-btn:disabled{opacity:.5;cursor:not-allowed;}' +
        '.cm-btn-primary{background:#1d4ed8;border-color:#1d4ed8;color:#fff;}' +
        '.cm-btn-primary:hover{background:#1e40af;}' +
        '.cm-btn-green{background:#15803d;border-color:#15803d;color:#fff;}' +
        '.cm-btn-green:hover{background:#166534;}' +
        '.cm-btn-add{border-color:#86c99a;color:#15803d;padding:2px 8px;font-size:11px;text-transform:none;letter-spacing:0;}' +
        '.cm-btn-danger{color:#b91c1c;}' +
        '.cm-grid-wrap{overflow-x:auto;}' +
        '.cm-grid{width:100%;border-collapse:collapse;font-size:12px;}' +
        '.cm-grid th{text-align:left;font-size:11px;font-weight:600;color:#475569;padding:7px 9px;border-bottom:1px solid #dfe3e8;background:#fafbfc;white-space:nowrap;}' +
        '.cm-grid td{padding:8px 9px;border-bottom:1px solid #eef1f4;vertical-align:top;color:#1e293b;}' +
        '.cm-grid tr:hover td{background:#f8fafc;}' +
        '.cm-grid tr.cm-void td{opacity:.55;}' +
        '.cm-grid a{color:#1d4ed8;text-decoration:none;}' +
        '.cm-grid a:hover{text-decoration:underline;}' +
        '.cm-sub{font-size:10.5px;color:#94a3b8;}' +
        '.cm-pol{display:inline-block;margin:0 6px 2px 0;color:#1d4ed8;cursor:pointer;white-space:nowrap;}' +
        '.cm-pol:before{content:"\\1F4C4";font-size:10px;margin-right:3px;}' +
        '.cm-badge{display:inline-block;border-radius:10px;padding:1px 7px;font-size:9.5px;font-weight:700;margin-left:6px;vertical-align:1px;}' +
        '.cm-pager{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:8px 4px 0;font-size:11.5px;color:#64748b;flex-wrap:wrap;}' +
        '.cm-pager .cm-pages{display:flex;align-items:center;gap:4px;}' +
        '.cm-pager button{min-width:26px;padding:3px 7px;}' +
        '.cm-pager button.cm-on{background:#dbeafe;border-color:#93c5fd;color:#1e3a8a;}' +
        '.cm-menu{position:fixed;z-index:10010;background:#fff;border:1px solid #cfd6de;border-radius:6px;box-shadow:0 8px 24px rgba(15,23,42,.18);min-width:170px;padding:4px 0;}' +
        '.cm-menu button{display:block;width:100%;text-align:left;padding:7px 14px;border:none;background:none;font-size:12px;color:#1e293b;cursor:pointer;font-family:inherit;}' +
        '.cm-menu button:hover{background:#eff6ff;}' +
        '.cm-menu button:disabled{color:#cbd5e1;cursor:not-allowed;background:none;}' +
        '.cm-menu hr{border:none;border-top:1px solid #eef1f4;margin:3px 0;}' +
        '.cm-overlay{position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:10001;display:flex;align-items:flex-start;justify-content:center;padding:18px 12px;overflow-y:auto;}' +
        '.cm-dialog{background:#fff;border-radius:8px;width:100%;margin:auto;display:flex;flex-direction:column;max-height:94vh;box-shadow:0 20px 60px rgba(15,23,42,.35);}' +
        '.cm-dialog-head{padding:14px 18px;border-bottom:1px solid #dfe3e8;display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-shrink:0;}' +
        '.cm-dialog-head h2{font-size:17px;font-weight:400;color:#334155;margin:0;}' +
        '.cm-dialog-head h2 span{color:#1d4ed8;}' +
        '.cm-dialog-head p{font-size:11px;color:#94a3b8;margin:3px 0 0;}' +
        '.cm-dialog-body{padding:14px 18px;overflow-y:auto;flex:1;background:#f8fafc;}' +
        '.cm-dialog-foot{padding:11px 18px;border-top:1px solid #dfe3e8;display:flex;gap:8px;justify-content:space-between;flex-shrink:0;flex-wrap:wrap;}' +
        '.cm-dialog-foot>div{display:flex;gap:8px;flex-wrap:wrap;}' +
        '.cm-x{background:none;border:none;font-size:20px;cursor:pointer;color:#94a3b8;padding:0 4px;}' +
        '.cm-form-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;}' +
        '.cm-form-grid .cm-wide{grid-column:1/-1;}' +
        '.cm-general{display:grid;grid-template-columns:190px 1fr;gap:9px 14px;align-items:center;max-width:860px;}' +
        '.cm-general>label{text-align:right;font-size:11.5px;color:#475569;}' +
        '.cm-general select,.cm-general input:not([type=checkbox]){padding:6px 8px;border:1px solid #cfd6de;border-radius:4px;font-size:12px;font-family:inherit;background:#fff;width:100%;box-sizing:border-box;}' +
        '.cm-pols{border:1px solid #cfd6de;border-radius:4px;background:#fff;max-height:150px;overflow-y:auto;padding:4px 8px;}' +
        '.cm-pols label{display:flex;gap:8px;align-items:flex-start;font-size:12px;padding:3px 0;color:#1e293b;cursor:pointer;text-align:left;}' +
        '.cm-pols input{width:14px;height:14px;flex:0 0 auto;margin:2px 0 0;}' +
        '.cm-pols label>span{flex:1;}' +
        '.cm-pols label.cm-off{color:#94a3b8;cursor:default;}' +
        '.cm-warn{background:#fffbeb;border:1px solid #fde68a;color:#92400e;border-radius:6px;padding:8px 11px;font-size:11.5px;margin-bottom:12px;}' +
        '.cm-voidbar{background:#fee2e2;border:1px solid #fecaca;color:#991b1b;border-radius:6px;padding:8px 11px;font-size:12px;font-weight:700;margin-bottom:12px;}' +
        // The certificate, laid out like the ACORD form.
        '.acf-scroll{overflow-x:auto;}' +
        '.acf{min-width:980px;background:#fff;border:1px solid #1f2937;font-family:Arial,Helvetica,sans-serif;color:#111;font-size:11px;}' +
        '.acf input,.acf select,.acf textarea{font-family:Arial,Helvetica,sans-serif;font-size:11.5px;padding:4px 6px;border:1px solid #cfd6de;border-radius:2px;background:#fff;color:#0f172a;box-sizing:border-box;width:100%;min-width:0;}' +
        '.acf input[type=checkbox]{width:13px;height:13px;padding:0;margin:0;flex-shrink:0;cursor:pointer;}' +
        '.acf .acf-ai input,.acf .acf-ai select,.acf .acf-ai textarea{background:#eff6ff;border-color:#93c5fd;}' +
        '.acf-top{display:grid;grid-template-columns:200px 1fr 200px;align-items:center;padding:8px 10px 6px;border-bottom:1px solid #1f2937;}' +
        '.acf-logo{font-family:Georgia,"Times New Roman",serif;font-style:italic;font-weight:700;font-size:34px;letter-spacing:-1px;color:#111;}' +
        '.acf-logo sup{font-size:12px;font-style:normal;}' +
        '.acf-title{text-align:center;font-size:15px;font-weight:700;letter-spacing:.3px;}' +
        '.acf-date label{display:block;text-align:center;font-size:9px;font-weight:700;margin-bottom:2px;}' +
        '.acf-legal{padding:5px 10px;border-bottom:1px solid #1f2937;font-size:9.5px;line-height:1.35;}' +
        '.acf-legal b{color:#1d4ed8;}' +
        '.acf-two{display:grid;grid-template-columns:1fr 1fr;border-bottom:1px solid #1f2937;}' +
        '.acf-two>div{padding:7px 10px;}' +
        '.acf-two>div+div{border-left:1px solid #1f2937;}' +
        '.acf-lbl{font-size:9px;font-weight:700;text-transform:uppercase;margin-bottom:3px;display:flex;align-items:center;gap:8px;}' +
        '.acf-stack>*{margin-bottom:4px;}' +
        '.acf-csz{display:grid;grid-template-columns:1fr 54px 90px;gap:4px;}' +
        '.acf-kv{display:grid;grid-template-columns:130px 1fr;gap:4px 8px;align-items:center;}' +
        '.acf-kv>span{font-size:9px;font-weight:700;text-transform:uppercase;}' +
        '.acf-ins{display:grid;grid-template-columns:70px 1fr 90px;gap:4px 8px;align-items:center;}' +
        '.acf-ins>span{font-size:9px;font-weight:700;}' +
        '.acf-covhead{display:grid;grid-template-columns:auto 1fr auto 1fr;gap:8px;align-items:center;padding:6px 10px;border-bottom:1px solid #1f2937;}' +
        '.acf-covhead b{font-size:12px;}' +
        '.acf-covhead span{font-size:9px;font-weight:700;white-space:nowrap;}' +
        '.acf-table{width:100%;border-collapse:collapse;table-layout:fixed;}' +
        // uib-theme.css paints every table head navy and marks the hovered
        // row; the certificate must look like the paper form instead.
        '.acf-table thead,.cm-grid thead{background:none;}' +
        '.acf-table tbody tr:hover>td:first-child{box-shadow:none;}' +
        '.acf-table th{font-size:8.5px;font-weight:700;border-bottom:1px solid #1f2937;padding:4px 3px;vertical-align:bottom;text-align:center;color:#111;background:#fff;box-shadow:none;}' +
        '.acf-table td{border-bottom:1px solid #1f2937;padding:5px 4px;vertical-align:top;}' +
        '.acf-table td+td,.acf-table th+th{border-left:1px solid #d1d5db;}' +
        '.acf-chk{display:flex;align-items:center;gap:5px;font-size:10px;margin-bottom:4px;cursor:pointer;}' +
        '.acf-chk b{color:#1d4ed8;font-size:10.5px;}' +
        '.acf-chkrow{display:flex;gap:12px;flex-wrap:wrap;margin-left:18px;}' +
        '.acf-sublbl{font-size:9px;font-weight:700;margin:5px 0 3px;}' +
        '.acf-lim{display:grid;grid-template-columns:1fr 110px;gap:3px 6px;align-items:center;}' +
        '.acf-lim>span{font-size:9px;font-weight:700;text-transform:uppercase;}' +
        '.acf-lim .acf-money{display:flex;align-items:center;gap:3px;}' +
        '.acf-lim .acf-money:before{content:"$";font-size:10px;}' +
        '.acf-na{text-align:center;font-size:9px;font-weight:700;color:#64748b;padding-top:8px;}' +
        '.acf-block{padding:7px 10px;border-bottom:1px solid #1f2937;}' +
        '.acf-cancel{font-size:9.5px;line-height:1.4;margin-bottom:8px;}' +
        '.acf-foot{display:flex;justify-content:space-between;padding:5px 10px;font-size:8.5px;color:#475569;}' +
        '.acf-hint{font-size:9.5px;color:#64748b;font-weight:400;text-transform:none;}' +
        '@media (max-width:900px){.cm-search{grid-template-columns:1fr 1fr;}.cm-general{grid-template-columns:1fr;}.cm-general>label{text-align:left;}.cm-form-grid{grid-template-columns:1fr 1fr;}}' +
        '@media (max-width:560px){.cm-search{grid-template-columns:1fr;}.cm-form-grid{grid-template-columns:1fr;}}';
        var st = document.createElement('style');
        st.id = 'cmStyles';
        st.textContent = css;
        document.head.appendChild(st);
    }

    // ══════════════════════════════════════════════════════════
    //  LIST
    // ══════════════════════════════════════════════════════════
    var _listKey = null;
    var _search = {};
    var _page = 1;
    var _per = 10;
    var _historyShown = false;

    function blankSearch() { return { name: '', cFrom: '', cTo: '', mFrom: '', mTo: '', policy: '', user: '' }; }
    function localDay(iso) {
        if (!iso) return '';
        var d = new Date(iso);
        if (isNaN(d)) return String(iso).slice(0, 10);
        return d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    }
    function stamp(iso) {
        if (!iso) return '';
        var d = new Date(iso);
        return isNaN(d) ? String(iso) : d.toLocaleString('en-US', { timeZone: 'America/New_York', month: '2-digit', day: '2-digit', year: 'numeric', hour: 'numeric', minute: '2-digit' });
    }

    function statusBadge(c) {
        if (c.voided) return '<span class="cm-badge" style="background:#fee2e2;color:#991b1b;">VOID</span>';
        var gaps = C().missing(c);
        if (!gaps.length) return '<span class="cm-badge" style="background:#dcfce7;color:#15803d;">READY</span>';
        return '<span class="cm-badge" style="background:#fef3c7;color:#92400e;" title="Still needed: ' + esc(gaps.join(', ')) + '">' + gaps.length + ' TO FINISH</span>';
    }

    function filtered(list) {
        var s = _search;
        var q = String(s.name || '').trim().toLowerCase();
        return list.filter(function (c) {
            if (q) {
                var hay = [C().displayName(c), c.holdName, c.certNo].join(' ').toLowerCase();
                if (hay.indexOf(q) === -1) return false;
            }
            var made = localDay(c.createdAt), changed = localDay(c.updatedAt || c.createdAt);
            if (s.cFrom && made < s.cFrom) return false;
            if (s.cTo && made > s.cTo) return false;
            if (s.mFrom && changed < s.mFrom) return false;
            if (s.mTo && changed > s.mTo) return false;
            if (s.policy && C().assignedPolicies(c).indexOf(s.policy) === -1) return false;
            if (s.user && (c.createdBy || '') !== s.user) return false;
            return true;
        });
    }

    function renderList() {
        injectCss();
        var el = document.getElementById('certMasterList');
        if (!el) return;
        var key = activeKey();
        updateBadge(key);
        if (!key) { el.innerHTML = '<p style="color:var(--gray-400);font-size:12px;">Select a client first.</p>'; return; }
        if (_listKey !== key) { _listKey = key; _search = blankSearch(); _page = 1; _historyShown = false; }

        var all = C().forClient(key);
        var rows = filtered(all);
        var pages = Math.max(1, Math.ceil(rows.length / _per));
        if (_page > pages) _page = pages;
        var start = (_page - 1) * _per;
        var shown = rows.slice(start, start + _per);

        var policies = [], users = [];
        all.forEach(function (c) {
            C().assignedPolicies(c).forEach(function (p) { if (policies.indexOf(p) === -1) policies.push(p); });
            if (c.createdBy && users.indexOf(c.createdBy) === -1) users.push(c.createdBy);
        });
        policies.sort(); users.sort();
        var opt = function (list, sel) {
            return '<option value="">[Please Choose]</option>' + list.map(function (v) {
                return '<option value="' + esc(v) + '"' + (v === sel ? ' selected' : '') + '>' + esc(v) + '</option>';
            }).join('');
        };
        var s = _search;

        var search =
          '<div class="cm-panel"><div class="cm-panel-head"><span class="cm-grow">Search</span></div>' +
            '<div class="cm-panel-body"><div class="cm-search">' +
              '<label>Name<input id="cmsName" placeholder="Name" value="' + esc(s.name) + '" onkeydown="if(event.key===\'Enter\')certSearch()"></label>' +
              '<label>Create Date<span class="cm-range"><input type="date" id="cmsCFrom" value="' + esc(s.cFrom) + '"><span>–</span><input type="date" id="cmsCTo" value="' + esc(s.cTo) + '"></span></label>' +
              '<label>Change Date<span class="cm-range"><input type="date" id="cmsMFrom" value="' + esc(s.mFrom) + '"><span>–</span><input type="date" id="cmsMTo" value="' + esc(s.mTo) + '"></span></label>' +
              '<label>Policy<select id="cmsPolicy">' + opt(policies, s.policy) + '</select></label>' +
              '<label>User<select id="cmsUser">' + opt(users, s.user) + '</select></label>' +
              '<div style="display:flex;gap:6px;"><button class="cm-btn cm-btn-primary" onclick="certSearch()">Search</button>' +
                '<button class="cm-btn" onclick="certSearchClear()">Clear</button></div>' +
            '</div></div></div>';

        var body;
        if (!all.length) {
            body = '<div style="text-align:center;padding:30px 16px;color:var(--gray-400);">' +
                     '<div style="font-size:28px;margin-bottom:8px;">📜</div>' +
                     '<p style="font-size:13px;margin-bottom:4px;">No certificates for this client yet.</p>' +
                     '<p style="font-size:11px;">A certificate is issued to one holder — click <b>+ Add New</b> to make one per landlord, ' +
                     'general contractor or municipality that asks for proof of coverage.</p></div>';
        } else if (!rows.length) {
            body = '<p style="padding:20px;text-align:center;color:var(--gray-400);font-size:12px;">No certificates match the search.</p>';
        } else {
            body = '<div class="cm-grid-wrap"><table class="cm-grid"><thead><tr>' +
                     '<th style="width:150px;"></th><th>Name</th><th>Certificate Holder</th><th>Assigned Policies</th><th>User</th>' +
                   '</tr></thead><tbody>' +
                   shown.map(function (c) {
                       var pols = C().assignedPolicies(c);
                       return '<tr class="' + (c.voided ? 'cm-void' : '') + '">' +
                         '<td style="white-space:nowrap;">' +
                           '<button class="cm-btn" onclick="certActions(event,\'' + escJs(c.id) + '\')">Actions ▾</button> ' +
                           '<button class="cm-btn" onclick="certOpenEditor(\'' + escJs(c.id) + '\')">' + (c.voided ? 'Open' : '✎ Edit') + '</button>' +
                         '</td>' +
                         '<td><a href="#" onclick="certOpenEditor(\'' + escJs(c.id) + '\');return false;">' + esc(C().displayName(c)) + '</a>' + statusBadge(c) +
                           '<div class="cm-sub">' + esc(c.certNo || '') + (c.lastSentAt ? ' · emailed ' + esc(stamp(c.lastSentAt)) : '') + '</div></td>' +
                         '<td>' + (c.holdName ? esc(c.holdName) + (c.holdEmail ? '<div class="cm-sub">' + esc(c.holdEmail) + '</div>' : '')
                                              : '<span style="color:#b45309;">No holder yet</span>') + '</td>' +
                         '<td>' + (pols.length ? pols.map(function (p) {
                               return '<span class="cm-pol" onclick="certShowPolicy(\'' + escJs(p) + '\')">' + esc(p) + '</span>';
                           }).join('') : '<span class="cm-sub">[None]</span>') + '</td>' +
                         '<td>' + esc(c.createdBy || '—') + '</td>' +
                       '</tr>';
                   }).join('') + '</tbody></table></div>';
        }

        var pager = '';
        if (rows.length) {
            var btns = '', gap = false;
            for (var p = 1; p <= pages; p++) {
                if (pages > 9 && Math.abs(p - _page) > 3 && p !== 1 && p !== pages) {
                    if (!gap) btns += '<span>…</span>';
                    gap = true;
                    continue;
                }
                gap = false;
                btns += '<button class="cm-btn' + (p === _page ? ' cm-on' : '') + '" onclick="certPage(' + p + ')">' + p + '</button>';
            }
            pager = '<div class="cm-pager"><div class="cm-pages">' +
                      '<button class="cm-btn" onclick="certPage(1)"' + (_page === 1 ? ' disabled' : '') + '>|◂</button>' +
                      '<button class="cm-btn" onclick="certPage(' + (_page - 1) + ')"' + (_page === 1 ? ' disabled' : '') + '>◂</button>' + btns +
                      '<button class="cm-btn" onclick="certPage(' + (_page + 1) + ')"' + (_page === pages ? ' disabled' : '') + '>▸</button>' +
                      '<button class="cm-btn" onclick="certPage(' + pages + ')"' + (_page === pages ? ' disabled' : '') + '>▸|</button>' +
                      '<select onchange="certPerPage(this.value)" style="margin-left:8px;padding:3px 5px;border:1px solid #cfd6de;border-radius:4px;font-size:11.5px;">' +
                        [10, 20, 50].map(function (n) { return '<option' + (n === _per ? ' selected' : '') + '>' + n + '</option>'; }).join('') +
                      '</select><span style="margin-left:4px;">items per page</span></div>' +
                      '<span>' + (start + 1) + ' - ' + (start + shown.length) + ' of ' + rows.length + ' items</span></div>';
        }

        var grid =
          '<div class="cm-panel"><div class="cm-panel-head"><span>Certificates</span>' +
              '<button class="cm-btn cm-btn-add" onclick="certNewForClient()">+ Add New</button><span class="cm-grow"></span></div>' +
            '<div class="cm-panel-body">' + body + pager + '</div></div>';

        var hist =
          '<div class="cm-panel"><div class="cm-panel-head"><span>Certificates - History</span>' +
              '<button class="cm-btn cm-btn-add" style="color:#334155;border-color:#cfd6de;" onclick="certToggleHistory()">' + (_historyShown ? 'Hide' : '⟳ Load') + '</button>' +
              '<span class="cm-grow"></span></div>' +
            (_historyShown ? '<div class="cm-panel-body">' + historyTable(all) + '</div>' : '') +
          '</div>';

        el.innerHTML = search + grid + hist;
    }

    function historyTable(list) {
        var rows = [];
        list.forEach(function (c) {
            C().historyOf(c).forEach(function (h) { rows.push({ h: h, c: c }); });
        });
        rows.sort(function (a, b) { return String(b.h.at).localeCompare(String(a.h.at)); });
        if (!rows.length) return '<p class="cm-sub">Nothing recorded yet.</p>';
        return '<div class="cm-grid-wrap"><table class="cm-grid"><thead><tr><th>Date</th><th>Certificate</th><th>Action</th><th>Details</th><th>User</th></tr></thead><tbody>' +
            rows.slice(0, 300).map(function (r) {
                return '<tr><td style="white-space:nowrap;">' + esc(stamp(r.h.at)) + '</td>' +
                       '<td>' + esc(r.c.certNo || '') + '<div class="cm-sub">' + esc(r.c.holdName || '') + '</div></td>' +
                       '<td>' + esc(r.h.action) + '</td><td>' + esc(r.h.detail || '') + '</td><td>' + esc(r.h.by || '—') + '</td></tr>';
            }).join('') + '</tbody></table></div>';
    }

    function readSearch() {
        var v = function (id) { var e = document.getElementById(id); return e ? e.value : ''; };
        _search = { name: v('cmsName'), cFrom: v('cmsCFrom'), cTo: v('cmsCTo'), mFrom: v('cmsMFrom'), mTo: v('cmsMTo'),
                    policy: v('cmsPolicy'), user: v('cmsUser') };
    }

    function updateBadge(key) {
        var b = document.getElementById('certTabBadge');
        if (!b) return;
        var n = key ? C().forClient(key).filter(function (c) { return !c.voided; }).length : 0;
        b.textContent = n;
        b.style.display = n ? 'inline' : 'none';
    }

    // ── Row actions menu ─────────────────────────────────────
    function closeMenu() {
        var m = document.getElementById('cmMenu');
        if (m) m.remove();
        document.removeEventListener('mousedown', menuOutside, true);
        window.removeEventListener('scroll', closeMenu, true);
    }
    function menuOutside(e) {
        var m = document.getElementById('cmMenu');
        if (m && !m.contains(e.target)) closeMenu();
    }
    function actions(ev, id) {
        ev.stopPropagation();
        closeMenu();
        var c = C().get(id);
        if (!c) return;
        var items = c.voided
            ? [['Open', 'certOpenEditor'], ['Copy', 'certCopy']]
            : [['✎ Edit', 'certOpenEditor'], ['View PDF', 'certPreview'], ['Download PDF', 'certDownload'],
               ['✉ Send Certificate', 'certOpenSend'], '-', ['Copy', 'certCopy'], ['Void', 'certVoidById']];
        var m = document.createElement('div');
        m.id = 'cmMenu';
        m.className = 'cm-menu';
        m.innerHTML = items.map(function (it) {
            if (it === '-') return '<hr>';
            return '<button onclick="certMenuPick(\'' + it[1] + '\',\'' + escJs(id) + '\')">' + esc(it[0]) + '</button>';
        }).join('');
        document.body.appendChild(m);
        var r = ev.currentTarget.getBoundingClientRect();
        var top = r.bottom + 2;
        if (top + m.offsetHeight > window.innerHeight - 8) top = Math.max(8, r.top - m.offsetHeight - 2);
        m.style.top = top + 'px';
        m.style.left = Math.min(r.left, window.innerWidth - m.offsetWidth - 8) + 'px';
        setTimeout(function () {
            document.addEventListener('mousedown', menuOutside, true);
            window.addEventListener('scroll', closeMenu, true);
        }, 0);
    }
    function menuPick(fn, id) {
        closeMenu();
        if (typeof window[fn] === 'function') window[fn](id);
    }

    function copyCert(id) {
        var c = C().copy(id);
        if (!c) return;
        renderList();
        flash('Certificate copied — set the new holder ✓');
        openEditor(c.id);
    }

    function voidById(id) {
        var c = C().get(id);
        if (!c) return;
        var why = prompt('Void ' + (c.certNo || 'this certificate') + '?\n\nIt stays on file for the audit trail but can no longer be issued.\n\nReason (optional):');
        if (why === null) return;
        C().voidCert(id, why);
        renderList();
        flash('Certificate voided');
    }

    function showPolicy(num) {
        if (window.amsShowTab) window.amsShowTab('policies');
        setTimeout(function () {
            var cells = document.querySelectorAll('#amsPoliciesBody td');
            for (var i = 0; i < cells.length; i++) {
                if (cells[i].textContent.indexOf(num) !== -1) {
                    var tr = cells[i].closest('tr');
                    if (tr) { tr.scrollIntoView({ block: 'center' }); tr.style.background = '#fef9c3'; setTimeout(function () { tr.style.background = ''; }, 2500); }
                    break;
                }
            }
        }, 60);
    }

    // ══════════════════════════════════════════════════════════
    //  EDITOR
    // ══════════════════════════════════════════════════════════
    function newForClient() {
        var key = activeKey();
        if (!key) { alert('Open a client first.'); return; }
        var name = (clientIndex()[key] && clientIndex()[key].displayName) || key;
        var cert = C().create(key, name, contactOf(key));
        _isNew = true;
        openEditor(null, cert);
    }

    // The client's policies, one per policy number (its latest term).
    function clientPolicies(key) {
        var client = clientIndex()[key];
        var by = {};
        ((client && client.policies) || []).forEach(function (p) {
            var num = String(p.policyNumber || '').trim();
            if (!num) return;
            var when = p.expirationDate || p.effectiveDate || p.effDate || p.entryDate || '';
            if (!by[num] || when > by[num].when) by[num] = { when: when, p: p };
        });
        return Object.keys(by).map(function (num) {
            var p = by[num].p;
            return { num: num, p: p, lob: p.lineOfBusiness || '', company: p.company || '',
                     exp: p.expirationDate || '', band: C().bandLabel(p.lineOfBusiness),
                     status: p.policyStatus || p.status || '' };
        }).sort(function (a, b) {
            if (!!a.band !== !!b.band) return a.band ? -1 : 1;
            return String(b.exp).localeCompare(String(a.exp));
        });
    }

    var BAND_PFX = { gl: 'gl', auto: 'au', umb: 'um', wc: 'wc', other: 'ot' };
    function bandKeys(row) {
        var keys = [];
        (row.fields || []).forEach(function (f) { keys.push(f.k); });
        (row.limits || []).forEach(function (l) { keys.push(l.k); if (l.descK) keys.push(l.descK); });
        (row.checks || []).forEach(function (c) { keys.push(c.k); });
        return keys;
    }

    // id: an existing certificate; draft: a new one not saved yet.
    function openEditor(id, draft) {
        closeMenu();
        injectCss();
        var src = draft || C().get(id);
        if (!src) { alert('That certificate could no longer be found.'); return; }
        if (!draft) _isNew = false;
        _editing = JSON.parse(JSON.stringify(src));
        if (!_editing.formType) _editing.formType = 'acord25';
        _before = JSON.stringify(fieldValues(_editing));

        var t = C().formFor(_editing);
        var gaps = C().missing(_editing);
        var modal = document.createElement('div');
        modal.id = 'certEditorModal';
        modal.className = 'cm-overlay';
        modal.innerHTML =
          '<div class="cm-dialog" style="max-width:1180px;" onclick="event.stopPropagation()">' +
            '<div class="cm-dialog-head"><div>' +
                '<h2>' + (_isNew ? 'Add new' : (_editing.voided ? 'View' : 'Edit')) + ' <span>Certificate</span></h2>' +
                '<p>' + esc(_editing.clientName || '') + ' · ' + esc(_editing.certNo || '') + ' · prints on the official ' + esc(t.code) +
                   (A().EDITION ? ' (' + esc(String(A().EDITION).replace(/^.*\(/, '').replace(/\)$/, '')) + ')' : '') + ' form</p>' +
                '<p id="certGaps" style="color:#b45309;font-weight:600;' + (gaps.length && !_editing.voided ? '' : 'display:none;') + '">' +
                   'Still needed before issuing: ' + esc(gaps.join(', ')) + '</p>' +
              '</div><button class="cm-x" onclick="certCloseEditor()" title="Close">✕</button></div>' +
            '<div class="cm-dialog-body">' +
              (_editing.voided ? '<div class="cm-voidbar">VOID — this certificate was voided' + (_editing.voidReason ? ': ' + esc(_editing.voidReason) : '') +
                                 '. It stays on file but cannot be issued. Use Actions ▸ Copy to issue a new one.</div>' : '') +
              '<div id="certAiNote" class="cm-warn" style="display:none;background:#eff6ff;border-color:#bfdbfe;color:#1e40af;">' +
                 '🤖 Highlighted fields were read from a document by Claude. Check them against the declaration page before you issue this certificate.</div>' +
              '<div class="cm-panel"><div class="cm-panel-head"><span class="cm-grow">General</span></div>' +
                '<div class="cm-panel-body" id="certGeneral">' + generalHtml() + '</div></div>' +
              '<div class="cm-panel"><div class="cm-panel-head"><span>Certificate</span>' +
                  (_editing.voided ? '' : '<button class="cm-btn cm-btn-add" style="color:#334155;border-color:#cfd6de;" onclick="certClearForm()">Clear Form</button>') +
                  '<span class="cm-grow"></span></div>' +
                '<div class="cm-panel-body" style="padding:10px;"><div class="acf-scroll" id="certFormWrap">' + formHtml() + '</div></div></div>' +
            '</div>' +
            '<div class="cm-dialog-foot">' +
              '<div>' +
                (_editing.voided ? '' :
                  '<button class="cm-btn" onclick="certPullFromPolicies()">↻ Pull from client policies</button>' +
                  (_isNew ? '' : '<button class="cm-btn cm-btn-danger" onclick="certVoid()">Void</button>')) +
              '</div><div>' +
                '<button class="cm-btn" onclick="certCloseEditor()">' + (_editing.voided ? 'Close' : 'Cancel') + '</button>' +
                (_editing.voided ? '' :
                  '<button class="cm-btn" onclick="certPreviewEditor()">View PDF</button>' +
                  '<button class="cm-btn cm-btn-primary" onclick="certSaveEditor()">💾 Save</button>' +
                  '<button class="cm-btn cm-btn-green" onclick="certSaveEditor(\'download\')">💾 Save &amp; Download</button>' +
                  '<button class="cm-btn cm-btn-green" onclick="certSaveEditor(\'send\')">✉ Save &amp; Send</button>') +
              '</div>' +
            '</div>' +
          '</div>';
        document.body.appendChild(modal);
        if (_editing.voided) modal.querySelectorAll('input,select,textarea').forEach(function (e) { e.disabled = true; });

        if (_editing.aiFilled && Object.keys(_editing.aiFilled).length) {
            var n = document.getElementById('certAiNote');
            if (n) n.style.display = 'block';
        }
    }

    function closeEditor() {
        var m = document.getElementById('certEditorModal');
        if (m) m.remove();
        _editing = null;
        _isNew = false;
    }

    // ── General panel ────────────────────────────────────────
    function generalHtml() {
        var c = _editing;
        var types = C().FORM_TYPES.map(function (t) {
            var ready = C().isReady(t);
            return '<option value="' + t.id + '"' + (t.id === c.formType ? ' selected' : '') + (ready ? '' : ' disabled') + '>' +
                   esc(t.title + ' (' + t.code + ')') + (ready ? '' : ' — not set up yet') + '</option>';
        }).join('');

        var pols = clientPolicies(c.clientKey);
        var picked = selectedPolicies(c);
        var polHtml = pols.length ? pols.map(function (x) {
            var on = picked.indexOf(x.num) !== -1;
            var cancelled = /cancel/i.test(x.status);
            return '<label class="' + (x.band ? '' : 'cm-off') + '" title="' + (x.band ? 'Prints on the ' + esc(x.band) + ' row'
                        : esc(x.lob || 'This line') + ' has no row on this certificate') + '">' +
                   '<input type="checkbox" data-pol="' + esc(x.num) + '"' + (on ? ' checked' : '') + (x.band ? '' : ' disabled') +
                   ' onchange="certTogglePolicy(this)">' +
                   '<span><b>' + esc(x.num) + '</b> · ' + esc(x.lob || '—') + (x.company ? ' · ' + esc(x.company) : '') +
                   (x.exp ? ' · exp ' + esc(C().mdy(x.exp)) : '') + (cancelled ? ' <span style="color:#b91c1c;">(cancelled)</span>' : '') +
                   (x.band ? '' : ' <span class="cm-sub">— not on this form</span>') + '</span></label>';
        }).join('') : '<span class="cm-sub">This client has no policies in the AMS yet.</span>';

        var interests = I() ? I().forClient(c.clientKey) : [];
        var holderOpts = '<option value="">[Please Select]</option>' + interests.map(function (r) {
            return '<option value="' + esc(r.id) + '"' + (r.id === c.holderInterestId ? ' selected' : '') + '>' +
                   esc(r.name) + (r.type && r.type !== 'Certificate Holder' ? ' (' + esc(r.type) + ')' : '') + '</option>';
        }).join('') + '<option value="__new">➕ Add new additional interest…</option>';

        var yn = function (id, v) {
            return '<select id="' + id + '" onchange="certBlanket(this)">' +
                   '<option value="">[Please Select]</option>' +
                   '<option value="Y"' + (v === 'Y' ? ' selected' : '') + '>Yes — mark every policy row Y</option>' +
                   '<option value="N"' + (v === 'N' ? ' selected' : '') + '>No — mark every policy row N</option></select>';
        };

        return '<div class="cm-general">' +
            '<label for="cfType">Certificate</label><select id="cfType" onchange="certChangeType(this.value)">' + types + '</select>' +
            '<label for="cf_name">Name</label><input id="cf_name" value="' + esc(C().displayName(c)) + '" oninput="this.dataset.touched=1">' +
            '<label style="align-self:start;padding-top:6px;">Policies</label><div class="cm-pols" id="cfPolicies">' + polHtml + '</div>' +
            '<label for="cfHolder">Certificate Holder</label>' +
              '<div style="display:flex;gap:6px;"><select id="cfHolder" onchange="certPickHolder(this.value)">' + holderOpts + '</select>' +
              '<button class="cm-btn" type="button" onclick="certManageInterests()" title="Open the client\'s Additional Interests">Manage</button></div>' +
            '<label for="cfBlanketAI">Blanket Additional Insured</label>' + yn('cfBlanketAI', c.blanketAI) +
            '<label for="cfBlanketWOS">Blanket Waiver of Subrogation</label>' + yn('cfBlanketWOS', c.blanketWOS) +
        '</div>';
    }

    // Policies the certificate carries: those picked, plus any whose
    // number already sits on a coverage row.
    function selectedPolicies(c) {
        var out = (Array.isArray(c.policyKeys) ? c.policyKeys : []).slice();
        C().assignedPolicies(c).forEach(function (n) { if (out.indexOf(n) === -1) out.push(n); });
        return out;
    }

    // ── The certificate form ─────────────────────────────────
    function fieldDef(k) {
        var all = A().allFields();
        for (var i = 0; i < all.length; i++) if (all[i].k === k) return all[i];
        return { k: k, type: 'text' };
    }
    function ai(k) { return _editing.aiFilled && _editing.aiFilled[k] ? ' acf-ai' : ''; }
    function val(k) { var v = _editing[k]; return v == null ? '' : v; }

    function inp(k, opts) {
        opts = opts || {};
        var f = fieldDef(k);
        var v = val(k);
        var extra = (opts.ph ? ' placeholder="' + esc(opts.ph) + '"' : '') + (f.max ? ' maxlength="' + f.max + '"' : '') +
                    (opts.list ? ' list="' + opts.list + '"' : '') + (opts.on ? ' ' + opts.on : '');
        var el;
        if (f.type === 'textarea') {
            el = '<textarea id="cf_' + k + '" rows="' + (opts.rows || 4) + '"' + extra + '>' + esc(v) + '</textarea>';
        } else if (f.type === 'yn') {
            el = '<select id="cf_' + k + '">' + ['', 'Y', 'N'].map(function (o) {
                return '<option value="' + o + '"' + (String(v).toUpperCase() === o ? ' selected' : '') + '>' + (o || '') + '</option>';
            }).join('') + '</select>';
        } else if (opts.letter) {
            el = '<select id="cf_' + k + '">' + [''].concat(A().INSURER_LETTERS).map(function (o) {
                return '<option value="' + o + '"' + (String(v).toUpperCase() === o ? ' selected' : '') + '>' + o + '</option>';
            }).join('') + '</select>';
        } else {
            el = '<input type="' + (f.type === 'date' ? 'date' : 'text') + '" id="cf_' + k + '" value="' + esc(v) + '"' + extra + '>';
        }
        return '<div class="' + ai(k).trim() + '"' + (opts.style ? ' style="' + opts.style + '"' : '') + '>' + el + '</div>';
    }
    function chk(k, label, bold) {
        return '<label class="acf-chk' + ai(k) + '"><input type="checkbox" id="cf_' + k + '"' + (_editing[k] ? ' checked' : '') + '>' +
               (bold ? '<b>' + label + '</b>' : label) + '</label>';
    }
    function chkText(k, tk) {
        return '<div class="acf-chk' + ai(k) + '" style="cursor:default;"><input type="checkbox" id="cf_' + k + '"' + (_editing[k] ? ' checked' : '') + '>' +
               inp(tk, { style: 'flex:1;' }) + '</div>';
    }
    function lim(label, k, descK) {
        return (descK ? inp(descK, { ph: 'other limit' }) : '<span>' + label + '</span>') +
               '<div class="acf-money' + ai(k) + '">' + inp(k).replace(/^<div class="[^"]*">/, '').replace(/<\/div>$/, '') + '</div>';
    }
    function csz(p) {
        return '<div class="acf-csz">' + inp(p + 'City', { ph: 'City' }) + inp(p + 'State', { ph: 'ST' }) + inp(p + 'Zip', { ph: 'ZIP' }) + '</div>';
    }

    function formHtml() {
        if (_editing.formType !== 'acord25') return genericFormHtml();
        var c = _editing;
        var L = A().INSURER_LETTERS;
        var carriers = carrierNames();
        var prof = agencyChoices();

        var top =
          '<div class="acf-top"><div class="acf-logo">ACORD<sup>®</sup></div>' +
            '<div class="acf-title">CERTIFICATE OF LIABILITY INSURANCE</div>' +
            '<div class="acf-date' + ai('certDate') + '"><label>DATE (MM/DD/YYYY)</label>' + inp('certDate', { on: 'onchange="certNameRefresh()"' }) + '</div></div>' +
          '<div class="acf-legal">THIS CERTIFICATE IS ISSUED AS A MATTER OF INFORMATION ONLY AND CONFERS NO RIGHTS UPON THE CERTIFICATE HOLDER. THIS ' +
            'CERTIFICATE DOES NOT AFFIRMATIVELY OR NEGATIVELY AMEND, EXTEND OR ALTER THE COVERAGE AFFORDED BY THE POLICIES BELOW. THIS CERTIFICATE OF ' +
            'INSURANCE DOES NOT CONSTITUTE A CONTRACT BETWEEN THE ISSUING INSURER(S), AUTHORIZED REPRESENTATIVE OR PRODUCER, AND THE CERTIFICATE HOLDER.</div>' +
          '<div class="acf-legal"><b>IMPORTANT:</b> If the certificate holder is an ADDITIONAL INSURED, the policy(ies) must have ADDITIONAL INSURED provisions or be endorsed. ' +
            'If SUBROGATION IS WAIVED, subject to the terms and conditions of the policy, certain policies may require an endorsement. A statement on this certificate does ' +
            'not confer rights to the certificate holder in lieu of such endorsement(s).</div>';

        var producer =
          '<div class="acf-two"><div class="acf-stack">' +
              '<div class="acf-lbl">Producer</div>' +
              '<select id="cfProducerPick" onchange="certPickProducer(this.value)">' +
                prof.map(function (p, i) { return '<option value="' + i + '">' + esc(p.label) + '</option>'; }).join('') + '</select>' +
              inp('prodName', { ph: 'Agency name' }) + inp('prodAddr1', { ph: 'Address' }) + inp('prodAddr2', { ph: 'Address line 2' }) + csz('prod') +
            '</div><div><div class="acf-kv">' +
              '<span>Contact name</span>' + inp('prodContact') +
              '<span>Phone (A/C, No, Ext):</span>' + inp('prodPhone') +
              '<span>Fax (A/C, No):</span>' + inp('prodFax') +
              '<span>E-mail address:</span>' + inp('prodEmail') +
            '</div></div></div>';

        var insurers = L.map(function (x) {
            return '<span>INSURER ' + x + ' :</span>' +
                   inp('insurer' + x + 'Name', { list: 'cfCarrierList', on: 'onchange="certInsurerNaic(\'' + x + '\')"' }) +
                   inp('insurer' + x + 'Naic', { ph: 'NAIC #' });
        }).join('');
        var insured =
          '<div class="acf-two"><div class="acf-stack">' +
              '<div class="acf-lbl">Insured</div>' +
              '<select id="cfInsuredPick" onchange="certPickInsured(this.value)"><option value="">[Type and/or Choose Location]</option>' +
                '<option value="client">Client mailing address</option></select>' +
              inp('insName', { ph: 'Named insured' }) + inp('insAddr1', { ph: 'Address' }) + inp('insAddr2', { ph: 'Address line 2' }) + csz('ins') +
            '</div><div>' +
              '<div class="acf-lbl">Insurer(s) affording coverage <span class="cm-grow" style="flex:1;"></span><span style="width:90px;text-align:left;">NAIC #</span></div>' +
              '<div style="margin:-2px 0 6px;"><button type="button" class="cm-btn cm-btn-primary" style="padding:2px 9px;font-size:10.5px;" onclick="certAddInsurer()">Add new</button></div>' +
              '<div class="acf-ins">' + insurers + '</div>' +
              '<datalist id="cfCarrierList">' + carriers.map(function (n) { return '<option value="' + esc(n) + '">'; }).join('') + '</datalist>' +
            '</div></div>';

        var covHead =
          '<div class="acf-covhead" style="grid-template-columns:auto 1fr auto 230px auto 180px;"><b>COVERAGES</b><span></span>' +
            '<span>CERTIFICATE NUMBER:</span>' + inp('certNo') + '<span>REVISION NUMBER:</span>' + inp('revNo') + '</div>' +
          '<div class="acf-legal">THIS IS TO CERTIFY THAT THE POLICIES OF INSURANCE LISTED BELOW HAVE BEEN ISSUED TO THE INSURED NAMED ABOVE FOR THE POLICY PERIOD INDICATED. ' +
            'NOTWITHSTANDING ANY REQUIREMENT, TERM OR CONDITION OF ANY CONTRACT OR OTHER DOCUMENT WITH RESPECT TO WHICH THIS CERTIFICATE MAY BE ISSUED OR MAY PERTAIN, ' +
            'THE INSURANCE AFFORDED BY THE POLICIES DESCRIBED HEREIN IS SUBJECT TO ALL THE TERMS, EXCLUSIONS AND CONDITIONS OF SUCH POLICIES. *LIMITS SHOWN MAY HAVE BEEN ' +
            'REDUCED BY PAID CLAIMS. LIMITS SHOWN ARE INCLUSIVE OF AMOUNTS REQUESTED BY THE CERTIFICATE HOLDER AND MAY NOT REFLECT POLICY LIMIT AMOUNTS IN EXCESS OF ' +
            'THOSE REQUESTED. *Not Applicable in WY</div>';

        var row = function (p, typeCol, limits, addl) {
            return '<tr><td>' + inp(p + 'Insurer', { letter: true }) + '</td>' +
                   '<td>' + typeCol + '</td>' +
                   '<td>' + (addl === false ? '<div class="acf-na">N/A</div>' : inp(p + 'Addl')) + '</td>' +
                   '<td>' + inp(p + 'Subr') + '</td>' +
                   '<td>' + inp(p + 'PolicyNo') + '</td>' +
                   '<td>' + inp(p + 'Eff') + '</td>' +
                   '<td>' + inp(p + 'Exp') + '</td>' +
                   '<td><div class="acf-lim">' + limits + '</div></td></tr>';
        };

        var gl = row('gl',
            chk('glOn', 'COMMERCIAL GENERAL LIABILITY', true) +
            '<div class="acf-chkrow">' + chk('glClaimsMade', 'CLAIMS-MADE') + chk('glOccur', 'OCCUR') + '</div>' +
            chkText('glOtherCovOn', 'glOtherCovText') + chkText('glOtherCov2On', 'glOtherCov2Text') +
            '<div class="acf-sublbl">GEN\'L AGGREGATE LIMIT APPLIES PER:</div>' +
            '<div class="acf-chkrow" style="margin-left:0;">' + chk('glAggPolicy', 'POLICY') + chk('glAggProject', 'PRO-JECT') + chk('glAggLoc', 'LOC') + '</div>' +
            '<div class="acf-chk' + ai('glAggOther') + '" style="cursor:default;"><input type="checkbox" id="cf_glAggOther"' + (c.glAggOther ? ' checked' : '') + '>OTHER:' +
              inp('glAggOtherText', { style: 'flex:1;' }) + '</div>',
            lim('EACH OCCURRENCE', 'glEachOcc') + lim('DAMAGE TO RENTED PREMISES (Ea occurrence)', 'glRented') +
            lim('MED EXP (Any one person)', 'glMedExp') + lim('PERSONAL &amp; ADV INJURY', 'glPersAdv') +
            lim('GENERAL AGGREGATE', 'glGenAgg') + lim('PRODUCTS - COMP/OP AGG', 'glProdAgg') + lim('', 'glOtherLimit', 'glOtherLimitText'));

        var auto = row('au',
            '<div class="acf-chk"><b>AUTOMOBILE LIABILITY</b></div>' +
            chk('auAny', 'ANY AUTO') +
            '<div class="acf-chkrow" style="margin-left:0;">' + chk('auOwned', 'OWNED AUTOS ONLY') + chk('auScheduled', 'SCHEDULED AUTOS') + '</div>' +
            '<div class="acf-chkrow" style="margin-left:0;">' + chk('auHired', 'HIRED AUTOS ONLY') + chk('auNonOwned', 'NON-OWNED AUTOS ONLY') + '</div>' +
            chkText('auOther1On', 'auOther1Text') + chkText('auOther2On', 'auOther2Text'),
            lim('COMBINED SINGLE LIMIT (Ea accident)', 'auCsl') + lim('BODILY INJURY (Per person)', 'auBiPerson') +
            lim('BODILY INJURY (Per accident)', 'auBiAccident') + lim('PROPERTY DAMAGE (Per accident)', 'auPd') +
            lim('', 'auOtherLimit', 'auOtherLimitText'));

        var umb = row('um',
            '<div class="acf-chkrow" style="margin-left:0;">' + chk('umUmbrella', 'UMBRELLA LIAB', true) + chk('umOccur', 'OCCUR') + '</div>' +
            '<div class="acf-chkrow" style="margin-left:0;">' + chk('umExcess', 'EXCESS LIAB', true) + chk('umClaimsMade', 'CLAIMS-MADE') + '</div>' +
            '<div class="acf-chkrow" style="margin-left:0;align-items:center;">' + chk('umDed', 'DED') + chk('umRetention', 'RETENTION $') +
              inp('umDedAmount', { style: 'width:100px;' }) + '</div>',
            lim('EACH OCCURRENCE', 'umEachOcc') + lim('AGGREGATE', 'umAgg') + lim('', 'umOtherLimit', 'umOtherLimitText'));

        var wc = row('wc',
            '<div class="acf-chk"><b>WORKERS COMPENSATION AND EMPLOYERS\' LIABILITY</b></div>' +
            '<div style="display:grid;grid-template-columns:1fr 64px;gap:6px;align-items:center;font-size:9px;font-weight:700;">' +
              '<span>ANY PROPRIETOR/PARTNER/EXECUTIVE OFFICER/MEMBER EXCLUDED? (Mandatory in NH)</span>' + inp('wcExcluded') + '</div>' +
            '<div class="acf-hint" style="margin-top:3px;">If yes, describe under DESCRIPTION OF OPERATIONS below</div>',
            '<div class="acf-chkrow" style="margin-left:0;grid-column:1/-1;">' + chk('wcPerStatute', 'PER STATUTE') + chk('wcOther', 'OTH-ER') + '</div>' +
            '<div style="grid-column:1/-1;">' + inp('wcOtherText', { ph: 'other (describe)' }) + '</div>' +
            lim('E.L. EACH ACCIDENT', 'wcEachAccident') + lim('E.L. DISEASE - EA EMPLOYEE', 'wcDiseaseEmp') + lim('E.L. DISEASE - POLICY LIMIT', 'wcDiseasePol'),
            false);

        var other = row('ot',
            '<div class="acf-sublbl" style="margin-top:0;">OTHER (type of insurance)</div>' + inp('otDesc', { ph: 'e.g. Inland Marine, Professional Liability' }),
            inp('otType1', { ph: 'coverage' }) + '<div class="acf-money' + ai('otLimit1') + '">' + inp('otLimit1').replace(/^<div class="[^"]*">/, '').replace(/<\/div>$/, '') + '</div>' +
            inp('otType2', { ph: 'coverage' }) + '<div class="acf-money' + ai('otLimit2') + '">' + inp('otLimit2').replace(/^<div class="[^"]*">/, '').replace(/<\/div>$/, '') + '</div>' +
            inp('otType3', { ph: 'coverage' }) + '<div class="acf-money' + ai('otLimit3') + '">' + inp('otLimit3').replace(/^<div class="[^"]*">/, '').replace(/<\/div>$/, '') + '</div>');

        var table =
          '<table class="acf-table"><colgroup><col style="width:52px"><col style="width:27%"><col style="width:52px"><col style="width:52px">' +
            '<col style="width:14%"><col style="width:10.5%"><col style="width:10.5%"><col style="width:27%"></colgroup>' +
          '<thead><tr><th>INSR<br>LTR</th><th style="text-align:left;">TYPE OF INSURANCE</th><th>ADDL<br>INSD</th><th>SUBR<br>WVD</th><th>POLICY NUMBER</th>' +
            '<th>POLICY EFF<br>(MM/DD/YYYY)</th><th>POLICY EXP<br>(MM/DD/YYYY)</th><th>LIMITS</th></tr></thead>' +
          '<tbody>' + gl + auto + umb + wc + other + '</tbody></table>';

        var desc =
          '<div class="acf-block"><div class="acf-lbl">Description of operations / locations / vehicles ' +
            '<span class="acf-hint">(ACORD 101, Additional Remarks Schedule, may be attached if more space is required)</span></div>' +
            inp('description', { rows: 4 }) + '</div>';

        var holder =
          '<div class="acf-two" style="border-bottom:none;"><div class="acf-stack">' +
              '<div class="acf-lbl">Certificate holder</div>' +
              inp('holdName', { ph: 'Holder name' }) + inp('holdAddr1', { ph: 'Address' }) + inp('holdAddr2', { ph: 'Address line 2' }) + csz('hold') +
              '<div style="margin-top:6px;"><div class="acf-lbl" style="margin-bottom:2px;">Holder e-mail <span class="acf-hint">— where Send Certificate mails it; not printed</span></div>' +
                '<input type="email" id="cf_holdEmail" value="' + esc(c.holdEmail || '') + '"></div>' +
            '</div><div>' +
              '<div class="acf-lbl">Cancellation</div>' +
              '<div class="acf-cancel">SHOULD ANY OF THE ABOVE DESCRIBED POLICIES BE CANCELLED BEFORE THE EXPIRATION DATE THEREOF, NOTICE WILL BE DELIVERED IN ' +
                'ACCORDANCE WITH THE POLICY PROVISIONS.</div>' +
              '<div class="acf-lbl">Authorized representative</div>' + inp('authorizedRep', { ph: 'Name of the agent issuing this certificate' }) +
            '</div></div>';

        return '<div class="acf">' + top + producer + insured + covHead + table + desc + holder +
               '<div class="acf-foot" style="border-top:1px solid #1f2937;"><span>' + esc(A().EDITION) + '</span>' +
               '<span>The ACORD name and logo are registered marks of ACORD</span></div></div>';
    }

    // A form that has a map but no hand-made layout yet: its sections in
    // order, so a newly mapped type is usable the day its PDF arrives.
    function genericFormHtml() {
        var M = A();
        var sec = function (s) {
            return '<div class="acf-block"><div class="acf-lbl">' + esc(s.title) + '</div><div class="cm-form-grid">' +
                s.fields.map(function (f) { return '<label class="cm-field' + (f.wide ? ' cm-wide' : '') + '"><span>' + esc(f.label) + '</span>' + inp(f.k) + '</label>'; }).join('') +
                '</div></div>';
        };
        var html = '';
        (M.INFO_SECTIONS || []).forEach(function (s) { html += sec(s); });
        (M.COVERAGE_ROWS || []).forEach(function (r) {
            html += '<div class="acf-block"><div class="acf-lbl">' + esc(r.title) + '</div>' +
                (r.checks || []).map(function (c) { return chk(c.k, esc(c.label)); }).join('') +
                '<div class="cm-form-grid">' + (r.fields || []).map(function (f) {
                    return '<label class="cm-field"><span>' + esc(f.label) + '</span>' + inp(f.k) + '</label>';
                }).join('') + (r.limits || []).map(function (l) {
                    return '<label class="cm-field"><span>' + esc(l.label) + '</span>' + inp(l.k) + '</label>';
                }).join('') + '</div></div>';
        });
        (M.TAIL_SECTIONS || []).forEach(function (s) { html += sec(s); });
        html += '<div class="acf-block"><div class="acf-lbl">Holder e-mail</div><input type="email" id="cf_holdEmail" value="' + esc(_editing.holdEmail || '') + '"></div>';
        return '<div class="acf" style="min-width:0;">' + html + '</div>';
    }

    // Carriers the agency writes with, plus any insurer already typed on
    // a certificate (with its NAIC #, remembered for next time).
    function carrierNames() {
        var names = {};
        try {
            var cm = JSON.parse(localStorage.getItem('carrierMasterData')) || {};
            Object.keys(cm).forEach(function (n) { if (n) names[n] = true; });
        } catch (e) {}
        Object.keys(knownNaic()).forEach(function (n) { names[n] = true; });
        return Object.keys(names).sort(function (a, b) { return a.localeCompare(b); });
    }
    function knownNaic() {
        var out = {};
        var all = C().all();
        Object.keys(all).forEach(function (id) {
            var c = all[id];
            if (!c) return;
            ['A', 'B', 'C', 'D', 'E', 'F'].forEach(function (L) {
                var n = String(c['insurer' + L + 'Name'] || '').trim();
                var code = String(c['insurer' + L + 'Naic'] || '').trim();
                if (n && (code || !out[n])) out[n] = code || out[n] || '';
            });
        });
        return out;
    }

    // [Default] is the agency details kept for certificates; the agency
    // profile and its locations follow when they have an address.
    function agencyChoices() {
        var d = C().producerDefaults();
        var out = [{ label: '[Default]', v: d }];
        var prof = {};
        try { prof = JSON.parse(localStorage.getItem('agencyProfile')) || {}; } catch (e) {}
        if (prof.name && prof.address1) {
            out.push({ label: 'Agency profile — ' + prof.name, v: {
                prodName: prof.name, prodAddr1: prof.address1, prodAddr2: prof.address2 || '', prodCity: prof.city || '',
                prodState: prof.state || '', prodZip: prof.zip || '', prodPhone: prof.phone || '', prodFax: prof.fax || '', prodEmail: prof.email || '' } });
        }
        (Array.isArray(prof.locations) ? prof.locations : []).forEach(function (l) {
            if (!l || !l.address) return;
            out.push({ label: 'Location — ' + (l.name || l.city || l.address), v: {
                prodName: prof.name || d.prodName, prodAddr1: l.address, prodAddr2: '', prodCity: l.city || '',
                prodState: l.state || '', prodZip: l.zip || '', prodPhone: l.phone || '' } });
        });
        return out;
    }

    // ── Reading the editor back ──────────────────────────────
    function fieldValues(c) {
        var out = {};
        A(c).allFields().forEach(function (f) { out[f.k] = c[f.k] == null ? '' : c[f.k]; });
        out.holdEmail = c.holdEmail || '';
        return out;
    }

    function collect(cert) {
        A(cert).allFields().forEach(function (f) {
            var el = document.getElementById('cf_' + f.k);
            if (!el) return;
            cert[f.k] = (f.type === 'check') ? !!el.checked : el.value;
        });
        var he = document.getElementById('cf_holdEmail');
        if (he) cert.holdEmail = String(he.value || '').trim();
        var nm = document.getElementById('cf_name');
        if (nm && nm.dataset.touched) {
            var v = String(nm.value || '').trim();
            cert.nameAuto = !v;
            cert.name = v;
        }
        var ba = document.getElementById('cfBlanketAI');   if (ba) cert.blanketAI = ba.value;
        var bw = document.getElementById('cfBlanketWOS');  if (bw) cert.blanketWOS = bw.value;
        var boxes = document.querySelectorAll('#cfPolicies input[data-pol]');
        if (boxes.length) {
            cert.policyKeys = [];
            boxes.forEach(function (b) { if (b.checked) cert.policyKeys.push(b.getAttribute('data-pol')); });
        }
        return cert;
    }

    function rerenderForm() {
        var wrap = document.getElementById('certFormWrap');
        if (wrap) wrap.innerHTML = formHtml();
        var gen = document.getElementById('certGeneral');
        if (gen) {
            var nm = document.getElementById('cf_name');
            var touched = nm && nm.dataset.touched;
            gen.innerHTML = generalHtml();
            if (touched) { var n2 = document.getElementById('cf_name'); n2.dataset.touched = 1; n2.value = _editing.name || ''; }
        }
        refreshGaps();
    }
    function refreshGaps() {
        var g = document.getElementById('certGaps');
        if (!g || !_editing) return;
        var gaps = C().missing(_editing);
        g.style.display = gaps.length && !_editing.voided ? '' : 'none';
        g.textContent = 'Still needed before issuing: ' + gaps.join(', ');
    }

    // ── Editor actions ───────────────────────────────────────
    function nameRefresh() {
        var nm = document.getElementById('cf_name');
        if (!nm || nm.dataset.touched || !_editing) return;
        var d = document.getElementById('cf_certDate');
        var probe = Object.assign({}, _editing, { certDate: d ? d.value : _editing.certDate,
                                                  formType: (document.getElementById('cfType') || {}).value || _editing.formType });
        nm.value = C().defaultName(probe);
    }

    function changeType(id) {
        var t = C().formType(id);
        if (!t || !C().isReady(t)) { alert('That certificate type is not set up yet — it needs ' + ((t && t.needs) || 'its PDF') + '.'); rerenderForm(); return; }
        collect(_editing);
        _editing.formType = id;
        rerenderForm();
        nameRefresh();
    }

    function togglePolicy(box) {
        collect(_editing);
        var num = box.getAttribute('data-pol');
        var x = clientPolicies(_editing.clientKey).filter(function (p) { return p.num === num; })[0];
        if (!x) return;
        var row = window.ACORD25.rowForLineOfBusiness(x.lob);
        if (box.checked) {
            var res = C().applyPolicy(_editing, x.p, false);
            if (res.skipped) alert((x.lob || 'This line') + ' has no row on this certificate.');
        } else if (row) {
            var pfx = BAND_PFX[row.id];
            if (String(_editing[pfx + 'PolicyNo'] || '').trim() === num) {
                var letter = String(_editing[pfx + 'Insurer'] || '').toUpperCase();
                bandKeys(row).forEach(function (k) { _editing[k] = (typeof _editing[k] === 'boolean') ? false : ''; });
                // Its insurer goes too, unless another row still prints it.
                var stillUsed = ['gl', 'au', 'um', 'wc', 'ot'].some(function (q) { return String(_editing[q + 'Insurer'] || '').toUpperCase() === letter; });
                if (letter && !stillUsed && String(_editing['insurer' + letter + 'Name'] || '').trim().toLowerCase() === String(x.company).trim().toLowerCase()) {
                    _editing['insurer' + letter + 'Name'] = '';
                    _editing['insurer' + letter + 'Naic'] = '';
                }
            }
            _editing.policyKeys = (_editing.policyKeys || []).filter(function (n) { return n !== num; });
        }
        rerenderForm();
    }

    function blanket(sel) {
        var v = sel.value;
        if (!v) return;
        var isAI = sel.id === 'cfBlanketAI';
        ['gl', 'au', 'um', 'wc', 'ot'].forEach(function (p) {
            if (isAI && p === 'wc') return;          // the WC row has no ADDL INSD box
            var pol = document.getElementById('cf_' + p + 'PolicyNo');
            var target = document.getElementById('cf_' + p + (isAI ? 'Addl' : 'Subr'));
            if (pol && target && String(pol.value).trim()) target.value = v;
        });
    }

    function pickHolder(id) {
        if (id === '__new') {
            document.getElementById('cfHolder').value = _editing.holderInterestId || '';
            I().openEditor(null, { clientKey: _editing.clientKey, onSaved: function (rec) {
                collect(_editing);
                applyHolder(rec);
                rerenderForm();
            } });
            return;
        }
        if (!id) return;
        var rec = I().get(id);
        if (!rec) return;
        collect(_editing);
        applyHolder(rec);
        rerenderForm();
    }
    function applyHolder(rec) {
        _editing.holderInterestId = rec.id;
        _editing.holdName  = rec.name || '';
        _editing.holdAddr1 = rec.addr1 || '';
        _editing.holdAddr2 = rec.addr2 || '';
        _editing.holdCity  = rec.city || '';
        _editing.holdState = rec.state || '';
        _editing.holdZip   = rec.zip || '';
        _editing.holdEmail = rec.email || '';
    }

    function manageInterests() {
        if (!confirm('Close this certificate and open the client\'s Additional Interests?' + (_isNew ? '\n\nThis new certificate has not been saved.' : '\n\nUnsaved changes here will be lost.'))) return;
        closeEditor();
        if (window.amsShowTab) window.amsShowTab('interests');
    }

    function pickProducer(i) {
        var choice = agencyChoices()[+i];
        if (!choice) return;
        collect(_editing);
        ['prodName', 'prodAddr1', 'prodAddr2', 'prodCity', 'prodState', 'prodZip', 'prodContact', 'prodPhone', 'prodFax', 'prodEmail'].forEach(function (k) {
            if (choice.v[k] !== undefined) _editing[k] = choice.v[k];
        });
        rerenderForm();
        var sel = document.getElementById('cfProducerPick');
        if (sel) sel.value = String(i);
    }

    function pickInsured(v) {
        if (v !== 'client') return;
        collect(_editing);
        var ct = contactOf(_editing.clientKey);
        _editing.insName  = _editing.insName || _editing.clientName || '';
        _editing.insAddr1 = ct.address || '';
        _editing.insAddr2 = '';
        _editing.insCity  = ct.city || '';
        _editing.insState = ct.state || '';
        _editing.insZip   = ct.zip || '';
        rerenderForm();
    }

    function insurerNaic(L) {
        var name = document.getElementById('cf_insurer' + L + 'Name');
        var naic = document.getElementById('cf_insurer' + L + 'Naic');
        if (!name || !naic || naic.value) return;
        var code = knownNaic()[String(name.value).trim()];
        if (code) naic.value = code;
    }

    function addInsurer() {
        var L = A().INSURER_LETTERS;
        for (var i = 0; i < L.length; i++) {
            var el = document.getElementById('cf_insurer' + L[i] + 'Name');
            if (el && !el.value) { el.focus(); el.scrollIntoView({ block: 'center' }); return; }
        }
        alert('All six insurer slots (A–F) are in use.');
    }

    function clearForm() {
        if (!confirm('Clear the coverages, insurers, description and certificate holder on this certificate?\n\nThe producer, insured, date and certificate number stay.')) return;
        collect(_editing);
        var keep = {};
        ['header', 'producer', 'insured'].forEach(function (id) {
            (A().INFO_SECTIONS || []).forEach(function (s) { if (s.id === id) s.fields.forEach(function (f) { keep[f.k] = true; }); });
        });
        A().allFields().forEach(function (f) {
            if (keep[f.k]) return;
            _editing[f.k] = f.type === 'check' ? false : '';
        });
        _editing.holdEmail = '';
        _editing.holderInterestId = '';
        _editing.policyKeys = [];
        _editing.blanketAI = ''; _editing.blanketWOS = '';
        _editing.aiFilled = {};
        rerenderForm();
    }

    // Persist the working copy. Returns the saved certificate or null.
    function persist() {
        if (!_editing) return null;
        collect(_editing);
        if (_editing.holdEmail && !EMAIL_RE.test(_editing.holdEmail)) { alert('The holder e-mail address does not look right.'); return null; }
        var changed = [];
        var now = fieldValues(_editing), was = {};
        try { was = JSON.parse(_before || '{}'); } catch (e) {}
        A().allFields().concat([{ k: 'holdEmail', label: 'Holder e-mail' }]).forEach(function (f) {
            if (String(now[f.k] == null ? '' : now[f.k]) !== String(was[f.k] == null ? '' : was[f.k])) changed.push(f.label || f.k);
        });
        // Once the agent has saved, the AI flags come off: they have
        // seen the values and taken responsibility for them.
        _editing.aiFilled = {};
        _editing.reviewedBy = currentUser();
        _editing.reviewedAt = new Date().toISOString();
        if (!_isNew && changed.length) {
            C().log(_editing, 'Edited', changed.length + ' field' + (changed.length > 1 ? 's' : '') + ': ' +
                    changed.slice(0, 6).join(', ') + (changed.length > 6 ? '…' : ''));
        }
        var saved = C().save(_editing);
        _isNew = false;
        _before = JSON.stringify(fieldValues(saved));
        return saved;
    }

    function saveEditor(then) {
        var cert = persist();
        if (!cert) return;
        renderList();
        closeEditor();
        flash('Certificate saved ✓');
        if (then === 'download') {
            var gaps = C().missing(cert);
            if (gaps.length && !confirm('This certificate is still missing:\n\n  • ' + gaps.join('\n  • ') + '\n\nDownload it anyway?')) return;
            C().download(cert).then(renderList).catch(function (e) { alert('Could not build the PDF: ' + e.message); });
        } else if (then === 'send') {
            openSend(cert.id);
        }
    }

    function previewEditor() {
        if (!_editing) return;
        var probe = collect(JSON.parse(JSON.stringify(_editing)));
        C().preview(probe).catch(function (e) { alert('Could not build the PDF: ' + e.message); });
    }

    // Re-read the client's policies in the AMS and fill any coverage
    // band they map onto. Only fills what is blank — it never
    // overwrites something the agent typed.
    function pullFromPolicies() {
        if (!_editing) return;
        collect(_editing);
        var pols = clientPolicies(_editing.clientKey).map(function (x) { return x.p; });
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
        rerenderForm();
        var msg = filled ? filled + ' policy row' + (filled > 1 ? 's' : '') + ' filled in.' : 'Nothing new to fill.';
        if (skipped.length) {
            msg += '\n\nNot placed on the certificate (this form has no row for them):\n  • ' +
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
        flash('Certificate voided');
    }

    // ══════════════════════════════════════════════════════════
    //  SEND
    // ══════════════════════════════════════════════════════════
    var _sendId = null;

    function openSend(id) {
        closeMenu();
        injectCss();
        var c = C().get(id);
        if (!c) { alert('That certificate could no longer be found.'); return; }
        if (c.voided) { alert('A voided certificate cannot be sent.'); return; }
        _sendId = id;
        var ct = contactOf(c.clientKey);
        var interest = c.holderInterestId && I() ? I().get(c.holderInterestId) : null;
        var holderEmail = c.holdEmail || (interest && interest.email) || '';
        var cc = C().producerDefaults().certCcEmail || C().AGENCY_CC;
        var gaps = C().missing(c);
        var subject = 'Certificate of Insurance — ' + (c.insName || c.clientName || '') + (c.holdName ? ' — ' + c.holdName : '');
        var text = 'Hello,\n\nAttached is the certificate of insurance for ' + (c.insName || c.clientName || 'our client') +
                   (c.holdName ? ', issued to ' + c.holdName : '') + ' (' + (c.certNo || '') + ').\n\n' +
                   'If you need anything else, reply to this e-mail or write to ' + cc + '.\n\n' +
                   (currentUser() ? currentUser() + '\n' : '') + (c.prodName || 'Universal Insurance Brokers') +
                   (c.prodPhone ? '\n' + c.prodPhone : '');

        var m = document.createElement('div');
        m.id = 'certSendModal';
        m.className = 'cm-overlay';
        m.style.zIndex = '10004';
        m.onclick = function (e) { if (e.target === m) closeSend(); };
        m.innerHTML =
          '<div class="cm-dialog" style="max-width:640px;" onclick="event.stopPropagation()">' +
            '<div class="cm-dialog-head"><div><h2>Send <span>Certificate</span></h2>' +
              '<p>' + esc(C().displayName(c)) + ' · ' + esc(c.certNo || '') + '</p></div>' +
              '<button class="cm-x" onclick="certCloseSend()">✕</button></div>' +
            '<div class="cm-dialog-body" style="background:#fff;">' +
              (gaps.length ? '<div class="cm-warn">Still missing: ' + esc(gaps.join(', ')) + '. You can send it anyway, but check it first.</div>' : '') +
              '<div class="cm-form-grid" style="grid-template-columns:1fr;">' +
                '<label class="cm-field"><span><input type="checkbox" id="csToHolder"' + (holderEmail ? ' checked' : '') + '> Certificate holder' +
                   (c.holdName ? ' — ' + esc(c.holdName) : '') + '</span><input type="email" id="csHolderEmail" value="' + esc(holderEmail) + '" placeholder="holder@example.com" oninput="document.getElementById(\'csToHolder\').checked=!!this.value"></label>' +
                '<label class="cm-field"><span><input type="checkbox" id="csToClient"' + (ct.email ? ' checked' : '') + '> Client — ' + esc(c.clientName || '') +
                   '</span><input type="email" id="csClientEmail" value="' + esc(ct.email || '') + '" placeholder="client@example.com" oninput="document.getElementById(\'csToClient\').checked=!!this.value"></label>' +
                '<label class="cm-field"><span>Other recipients (comma separated)</span><input id="csOther" placeholder="optional"></label>' +
                '<div class="cm-field"><span>CC (always copied)</span><div style="padding:6px 8px;background:#f1f5f9;border-radius:4px;font-size:12px;color:#0f172a;">🔒 ' + esc(cc) + '</div></div>' +
                '<label class="cm-field"><span>Subject</span><input id="csSubject" value="' + esc(subject) + '"></label>' +
                '<label class="cm-field"><span>Message</span><textarea id="csText" rows="8">' + esc(text) + '</textarea></label>' +
                '<div class="cm-sub">Attachment: 📎 ' + esc(C().fileName(c)) + '</div>' +
              '</div>' +
            '</div>' +
            '<div class="cm-dialog-foot"><button class="cm-btn" onclick="certSendViaMailApp()" title="Downloads the PDF and opens your e-mail program">Open in my e-mail app</button>' +
              '<div><button class="cm-btn" onclick="certCloseSend()">Cancel</button>' +
              '<button class="cm-btn cm-btn-primary" id="csSendBtn" onclick="certSendNow()">✉ Send</button></div></div>' +
          '</div>';
        document.body.appendChild(m);
    }

    function closeSend() {
        var m = document.getElementById('certSendModal');
        if (m) m.remove();
        _sendId = null;
    }

    function readSend() {
        var v = function (id) { var e = document.getElementById(id); return e ? String(e.value || '').trim() : ''; };
        var on = function (id) { var e = document.getElementById(id); return !!(e && e.checked); };
        var to = [];
        if (on('csToHolder') && v('csHolderEmail')) to.push(v('csHolderEmail'));
        if (on('csToClient') && v('csClientEmail')) to.push(v('csClientEmail'));
        v('csOther').split(/[,;\s]+/).forEach(function (e) { if (e) to.push(e); });
        var seen = {};
        to = to.filter(function (e) { var k = e.toLowerCase(); if (seen[k]) return false; seen[k] = true; return true; });
        var bad = to.filter(function (e) { return !EMAIL_RE.test(e); });
        var cc = C().producerDefaults().certCcEmail || C().AGENCY_CC;
        return { to: to, bad: bad, cc: [cc], subject: v('csSubject'), text: v('csText') };
    }

    function sendNow() {
        var c = C().get(_sendId);
        if (!c) return;
        var s = readSend();
        if (!s.to.length) { alert('Choose at least one recipient — the certificate holder, the client, or another address.'); return; }
        if (s.bad.length) { alert('These addresses do not look right:\n\n  ' + s.bad.join('\n  ')); return; }
        if (!s.subject) { alert('Enter a subject.'); return; }
        var btn = document.getElementById('csSendBtn');
        if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
        // The holder's address is worth keeping for the next send.
        var he = document.getElementById('csHolderEmail');
        if (he && he.value && !c.holdEmail && EMAIL_RE.test(he.value.trim())) { c.holdEmail = he.value.trim(); C().save(c); }
        C().send(C().get(_sendId), s).then(function () {
            closeSend();
            renderList();
            flash('Certificate e-mailed ✓');
        }).catch(function (e) {
            if (btn) { btn.disabled = false; btn.textContent = '✉ Send'; }
            var msg = e.unavailable
                ? 'E-mail sending is not switched on yet (' + e.message + ').\n\nOpen the message in your e-mail program instead? The PDF downloads so you can attach it.'
                : 'The certificate was not sent: ' + e.message + '\n\nOpen the message in your e-mail program instead? The PDF downloads so you can attach it.';
            if (confirm(msg)) sendViaMailApp();
        });
    }

    function sendViaMailApp() {
        var c = C().get(_sendId);
        if (!c) return;
        var s = readSend();
        if (s.bad.length) { alert('These addresses do not look right:\n\n  ' + s.bad.join('\n  ')); return; }
        C().download(c).then(function () {
            var cur = C().get(c.id);
            if (cur) C().save(C().log(cur, 'E-mail prepared', 'in the mail app, to ' + (s.to.join(', ') || '—')));
            var href = 'mailto:' + s.to.map(encodeURIComponent).join(',') +
                       '?cc=' + encodeURIComponent(s.cc.join(',')) +
                       '&subject=' + encodeURIComponent(s.subject) +
                       '&body=' + encodeURIComponent(s.text + '\n\n(Certificate PDF attached: ' + C().fileName(c) + ')');
            closeSend();
            renderList();
            window.location.href = href;
        }).catch(function (e) { alert('Could not build the PDF: ' + e.message); });
    }

    // The tab's "Send Certificate" button: pick which one.
    function sendPicker() {
        var key = activeKey();
        if (!key) { alert('Open a client first.'); return; }
        var list = C().forClient(key).filter(function (c) { return !c.voided; });
        if (!list.length) { alert('This client has no certificates to send yet. Click + Add New to make one.'); return; }
        if (list.length === 1) { openSend(list[0].id); return; }
        injectCss();
        var m = document.createElement('div');
        m.id = 'certPickModal';
        m.className = 'cm-overlay';
        m.onclick = function (e) { if (e.target === m) m.remove(); };
        m.innerHTML =
          '<div class="cm-dialog" style="max-width:620px;" onclick="event.stopPropagation()">' +
            '<div class="cm-dialog-head"><div><h2>Send <span>Certificate</span></h2><p>Which certificate?</p></div>' +
              '<button class="cm-x" onclick="document.getElementById(\'certPickModal\').remove()">✕</button></div>' +
            '<div class="cm-dialog-body" style="background:#fff;"><table class="cm-grid"><tbody>' +
              list.map(function (c) {
                  return '<tr><td>' + esc(C().displayName(c)) + statusBadge(c) + '<div class="cm-sub">' + esc(c.certNo || '') + ' · ' + esc(c.holdName || 'no holder yet') + '</div></td>' +
                         '<td style="text-align:right;"><button class="cm-btn cm-btn-primary" onclick="document.getElementById(\'certPickModal\').remove();certOpenSend(\'' + escJs(c.id) + '\')">Send</button></td></tr>';
              }).join('') +
            '</tbody></table></div></div>';
        document.body.appendChild(m);
    }

    // ══════════════════════════════════════════════════════════
    //  PROMPTS
    // ══════════════════════════════════════════════════════════
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
            cert = C().create(clientKey, clientName || clientKey, contactOf(clientKey));
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

    // ── Agency details ───────────────────────────────────────
    // The producer block is the same on every certificate the agency
    // issues, so it is kept once and seeded into each new one.
    function editProducer() {
        injectCss();
        var d = C().producerDefaults();
        var spec = window.ACORD25.INFO_SECTIONS.filter(function (s) { return s.id === 'producer'; })[0];
        var fields = spec.fields.concat([{ k: 'certCcEmail', label: 'Copy every e-mailed certificate to', wide: true }]);
        var modal = document.createElement('div');
        modal.id = 'certProducerModal';
        modal.className = 'cm-overlay';
        modal.style.zIndex = '10002';
        modal.onclick = function (e) { if (e.target === modal) modal.remove(); };
        modal.innerHTML =
          '<div class="cm-dialog" style="max-width:620px;" onclick="event.stopPropagation()">' +
            '<div class="cm-dialog-head"><div><h2>Agency <span>details</span></h2>' +
              '<p>The [Default] PRODUCER block on every new certificate.</p></div>' +
              '<button class="cm-x" onclick="document.getElementById(\'certProducerModal\').remove()">✕</button></div>' +
            '<div class="cm-dialog-body" style="background:#fff;"><div class="cm-form-grid" style="grid-template-columns:1fr 1fr;">' +
              fields.map(function (f) {
                  return '<label class="cm-field' + (f.wide ? ' cm-wide' : '') + '"><span>' + esc(f.label) + '</span>' +
                         '<input id="cp_' + f.k + '" value="' + esc(d[f.k] || '') + '"' + (f.max ? ' maxlength="' + f.max + '"' : '') + '></label>';
              }).join('') +
            '</div></div>' +
            '<div class="cm-dialog-foot"><span></span><div>' +
              '<button class="cm-btn" onclick="document.getElementById(\'certProducerModal\').remove()">Cancel</button>' +
              '<button class="cm-btn cm-btn-primary" onclick="certSaveProducer()">Save</button></div></div>' +
          '</div>';
        document.body.appendChild(modal);
    }

    function saveProducer() {
        var spec = window.ACORD25.INFO_SECTIONS.filter(function (s) { return s.id === 'producer'; })[0];
        var out = {};
        spec.fields.concat([{ k: 'certCcEmail' }]).forEach(function (f) {
            var el = document.getElementById('cp_' + f.k);
            if (el) out[f.k] = String(el.value || '').trim();
        });
        if (out.certCcEmail && !EMAIL_RE.test(out.certCcEmail)) { alert('The copy-to e-mail address does not look right.'); return; }
        if (!out.certCcEmail) out.certCcEmail = C().AGENCY_CC;
        C().saveProducerDefaults(out);
        var m = document.getElementById('certProducerModal');
        if (m) m.remove();
        flash('Agency details saved ✓');
    }

    // ── Exports (onclick handlers live on window) ────────────
    window.certEditProducer    = editProducer;
    window.certSaveProducer    = saveProducer;
    window.certRenderList      = renderList;
    window.certSearch          = function () { readSearch(); _page = 1; renderList(); };
    window.certSearchClear     = function () { _search = blankSearch(); _page = 1; renderList(); };
    window.certPage            = function (p) { _page = Math.max(1, p); renderList(); };
    window.certPerPage         = function (n) { _per = +n || 10; _page = 1; renderList(); };
    window.certToggleHistory   = function () { _historyShown = !_historyShown; renderList(); };
    window.certActions         = actions;
    window.certMenuPick        = menuPick;
    window.certCopy            = copyCert;
    window.certVoidById        = voidById;
    window.certShowPolicy      = showPolicy;
    window.certNewForClient    = newForClient;
    window.certOpenEditor      = function (id) { openEditor(id); };
    window.certCloseEditor     = closeEditor;
    window.certSaveEditor      = saveEditor;
    window.certPreviewEditor   = previewEditor;
    window.certPullFromPolicies = pullFromPolicies;
    window.certVoid            = voidCertificate;
    window.certChangeType      = changeType;
    window.certNameRefresh     = nameRefresh;
    window.certTogglePolicy    = togglePolicy;
    window.certBlanket         = blanket;
    window.certPickHolder      = pickHolder;
    window.certManageInterests = manageInterests;
    window.certPickProducer    = pickProducer;
    window.certPickInsured     = pickInsured;
    window.certInsurerNaic     = insurerNaic;
    window.certAddInsurer      = addInsurer;
    window.certClearForm       = clearForm;
    window.certOpenSend        = openSend;
    window.certCloseSend       = closeSend;
    window.certSendNow         = sendNow;
    window.certSendViaMailApp  = sendViaMailApp;
    window.certSendPicker      = sendPicker;
    window.certPreview = function (id) {
        var c = C().get(id);
        if (c) C().preview(c).catch(function (e) { alert('Could not build the PDF: ' + e.message); });
    };
    window.certDownload = function (id) {
        var c = C().get(id);
        if (c) C().download(c).then(renderList).catch(function (e) { alert('Could not build the PDF: ' + e.message); });
    };
    window.UIBCertUI = {
        renderList: renderList,
        updateBadge: updateBadge,
        openEditor: function (id) { openEditor(id); },
        offerAfterSave: offerAfterSave,
        offerFromExtraction: offerFromExtraction
    };
    window.cmInjectCss = injectCss;
})();
