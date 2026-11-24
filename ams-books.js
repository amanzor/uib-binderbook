// ============================================================
//  BOOKS — Personal / Commercial / Health
//  ------------------------------------------------------------
//  The tabs along the top of the AMS: Home, then the three books.
//  Home is the production page and spans every book. The left pane picks WHAT to
//  look at (Home, Clients, Dashboard, Reports, Renewals, …); the
//  book tab picks WHICH book of business it shows:
//    • Personal and Commercial filter the policies every section
//      reads, so Renewals shows only personal (or commercial)
//      renewals, and so do Home, the Dashboard and the Reports;
//    • Health opens each section's Health Book version — Renewals
//      becomes the health plans renewing next year, Reports the
//      Health Insurance report, Accounting the Health Commissions.
//
//  A policy's book is the line type the Binder Book saved on it
//  (lineType), else its line of business, else the insured's name
//  (an LLC or Inc reads as commercial) — the same rules the Binder
//  Book uses when Claude fills an entry in.
// ============================================================

(function () {
    'use strict';

    var KEY = 'amsBook';
    var BOOKS = [
        { id: 'personal',   label: 'Personal',   icon: 'user' },
        { id: 'commercial', label: 'Commercial', icon: 'building-2' },
        { id: 'health',     label: 'Health',     icon: 'heart-pulse' }
    ];

    var COMMERCIAL = ['bop', 'builders risk', 'business owner', 'commercial auto', 'commercial property', 'garage keepers',
        'general liability', 'inland marine', 'non-trucking liability', 'pollution liability', 'professional liability',
        'surety bond', 'trucking', 'workers comp', 'workers compensation', 'commercial umbrella', 'liquor liability',
        'cargo', 'motor truck cargo', 'physical damage', 'occupational accident', 'cyber', 'errors and omissions', 'e&o'];
    var PERSONAL = ['boat', 'classic collectors', 'home owners dp1', 'home owners dp2', 'home owners dp3', 'home owners h3',
        'home owners h4', 'home owners h6', 'home owners h8', 'motorcycle/atv', 'personal auto', 'renters', 'condo',
        'flood', 'mobile home', 'personal umbrella', 'rv'];
    var BUSINESS_NAME = /\b(llc|l\.l\.c|inc|inc\.|corp|corp\.|corporation|company|co\.|enterprises?|services?|group|holdings?|dba|d\/b\/a|trucking|transport|logistics|construction|contractors?|restaurant|realty|properties)\b/i;

    var _book = 'personal';
    try { var saved = localStorage.getItem(KEY); if (saved && /^(personal|commercial|health)$/.test(saved)) _book = saved; } catch (e) {}

    function bookOf(entry) {
        var t = String((entry && entry.lineType) || '').toLowerCase();
        if (t === 'personal' || t === 'commercial') return t;
        var lob = String((entry && entry.lineOfBusiness) || '').toLowerCase().trim();
        if (lob) {
            if (COMMERCIAL.indexOf(lob) !== -1 || /commercial|business|liability|workers|trucking|cargo|bond/.test(lob)) return 'commercial';
            if (PERSONAL.indexOf(lob) !== -1) return 'personal';
        }
        return BUSINESS_NAME.test(String((entry && entry.customerName) || '')) ? 'commercial' : 'personal';
    }
    function current() { return _book; }
    // Does this policy belong in the book on screen? (Health shows no P&C policies.)
    function matches(entry) { return _book !== 'health' && bookOf(entry) === _book; }
    function filter(list) { return (Array.isArray(list) ? list : []).filter(matches); }

    // ── The tabs ─────────────────────────────────────────────
    function renderTabs() {
        var host = document.getElementById('amsBookTabs');
        if (!host) return;
        var onHome = _section === 'home';
        var tab = function (cls, on, click, icon, label) {
            return '<button type="button" role="tab" class="ams-book-tab ' + cls + (on ? ' active' : '') + '"' +
                ' aria-selected="' + on + '" onclick="' + click + '">' +
                '<i data-lucide="' + icon + '" style="width:15px;height:15px;"></i> ' + label + '</button>';
        };
        host.innerHTML = tab('ams-book-home', onHome, "amsSidebarNav('home')", 'home', 'Home') +
            '<span class="ams-book-sep" aria-hidden="true"></span>' +
            BOOKS.map(function (b) {
                return tab('ams-book-' + b.id, !onHome && b.id === _book, "amsSetBook('" + b.id + "')", b.icon, b.label);
            }).join('');
        document.body.setAttribute('data-book', _book);
        if (window.lucide) try { lucide.createIcons(); } catch (e) {}
    }

    // ── Sections in the Health book ──────────────────────────
    // What each left-pane section opens when the Health tab is on.
    var HEALTH_VIEW = { clients: 'clients', search: 'clients', dashboard: 'report',
                        reports: 'report', renewals: 'renewals', accounting: 'commissions' };

    var _section = 'home';
    var _lastSection = 'search';   // where a book tab goes from Home
    var _origNav = null;

    function nav(section) {
        if (section === 'clients') section = 'search';
        // Agency Management is for the managers; everyone else gets their own profile.
        if (section === 'agency' && typeof window.amsCanManageAgency === 'function' && !window.amsCanManageAgency()) {
            if (typeof window.amsOpenMyProfile === 'function') window.amsOpenMyProfile();
            return;
        }
        _section = section;
        if (section !== 'home') _lastSection = section;
        renderTabs();
        if (_book === 'health' && HEALTH_VIEW[section] && (section !== 'search' || !(typeof amsActiveKey !== 'undefined' && amsActiveKey))) {
            _origNav('health');
            markActive(section);
            if (typeof healthTab === 'function') healthTab(HEALTH_VIEW[section]);
            return;
        }
        _origNav(section);
        markActive(section);
        showClientsPanel(section === 'search' && !_opening);
    }

    // ── Clients: list in the main area, recent clients in the left pane ──
    var _opening = false;   // true while a client is being opened
    function showClientsPanel(on) {
        var panel = document.getElementById('amsClientsPanel');
        if (!panel) return;
        panel.style.display = on ? '' : 'none';
        if (on) {
            // The list follows the book tab from the first look, not only after a switch.
            if (typeof amsApplyFilters === 'function') try { amsApplyFilters(); } catch (e) {}
            var d = document.getElementById('amsClientDetail'), w = document.getElementById('amsWelcome');
            if (d) d.style.display = 'none';
            if (w) w.style.display = 'none';
        }
    }

    function me() { return (typeof amsCurrentUser !== 'undefined' && amsCurrentUser) ? amsCurrentUser : 'user'; }
    function recentKey() { return 'amsRecentClients:' + me().toLowerCase().replace(/\s+/g, '_'); }
    function recent() { try { var r = JSON.parse(localStorage.getItem(recentKey())); return Array.isArray(r) ? r : []; } catch (e) { return []; } }
    function remember(key) {
        var r = recent().filter(function (k) { return k !== key; });
        r.unshift(key);
        try { localStorage.setItem(recentKey(), JSON.stringify(r.slice(0, 12))); } catch (e) {}
        renderRecent();
    }
    function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
    function renderRecent() {
        var el = document.getElementById('amsRecentClients');
        if (!el) return;
        var idx = (typeof amsClientIndex !== 'undefined') ? amsClientIndex : {};
        var active = (typeof amsActiveKey !== 'undefined') ? amsActiveKey : null;
        var rows = recent().filter(function (k) { return idx[k]; }).slice(0, 10);
        if (!rows.length) { el.innerHTML = '<div class="ams-recent-title">Recent clients</div><div style="font-size:11.5px;color:var(--gray-400);padding:0 6px;">Clients you open show up here.</div>'; return; }
        el.innerHTML = '<div class="ams-recent-title">Recent clients</div>' + rows.map(function (k) {
            var c = idx[k];
            var name = c.displayName || k;
            var ini = String(name).split(/\s+/).map(function (w) { return w[0] || ''; }).join('').slice(0, 2).toUpperCase();
            var st = c.isHealth ? 'Health' : (typeof amsClientStatusOf === 'function' ? amsClientStatusOf(c) : '');
            var n = (c.policies || []).length;
            return '<button type="button" class="ams-recent-row' + (k === active ? ' active' : '') + '" data-key="' + esc(k) + '" onclick="amsOpenRecent(this.getAttribute(\'data-key\'))">' +
                '<span class="av"' + (c.isHealth ? ' style="background:linear-gradient(135deg,#e11d48,#be123c);"' : '') + '>' + esc(ini) + '</span>' +
                '<span style="min-width:0;flex:1;"><b>' + esc(name) + '</b><small>' + esc(st) + (n ? ' · ' + n + ' polic' + (n === 1 ? 'y' : 'ies') : '') + '</small></span></button>';
        }).join('');
    }
    function openRecent(key) {
        var idx = (typeof amsClientIndex !== 'undefined') ? amsClientIndex : {};
        var c = idx[key];
        if (!c) return;
        // The book tab follows the client, so it opens in its own book.
        if (c.isHealth && _book !== 'health') { _book = 'health'; try { localStorage.setItem(KEY, _book); } catch (e) {} renderTabs(); }
        else if (!c.isHealth && _book === 'health') { _book = (c.policies || []).some(function (p) { return bookOf(p) === 'commercial'; }) ? 'commercial' : 'personal'; try { localStorage.setItem(KEY, _book); } catch (e) {} renderTabs(); }
        if (typeof amsLoadClientDetail === 'function') {
            if (!c.isHealth) nav('search');
            amsLoadClientDetail(key);
        }
    }

    // The left pane highlights the section asked for, even when the
    // Health book is answering it from the Health panel.
    function markActive(section) {
        var id = section === 'search' ? 'clients' : section;
        document.querySelectorAll('.ams-sidenav .ams-tab-btn').forEach(function (b) {
            b.classList.toggle('active', b.getAttribute('data-section') === id);
        });
    }

    function setBook(b) {
        if (!/^(personal|commercial|health)$/.test(b)) return;
        // From Home, a book tab opens the last section used, in that book.
        if (_section === 'home') {
            _book = b;
            try { localStorage.setItem(KEY, b); } catch (e) {}
            if (typeof amsApplyFilters === 'function') try { amsApplyFilters(); } catch (e) {}
            nav(_lastSection);
            return;
        }
        if (b === _book) { renderTabs(); return; }
        _book = b;
        try { localStorage.setItem(KEY, b); } catch (e) {}
        renderTabs();
        // The client list follows the book too.
        if (typeof amsApplyFilters === 'function') try { amsApplyFilters(); } catch (e) {}
        // A client open in the wrong book makes no sense to keep on screen.
        var sec = _section;
        if (sec === 'search' && typeof amsActiveKey !== 'undefined' && amsActiveKey) {
            var c = (typeof amsClientIndex !== 'undefined' ? amsClientIndex : {})[amsActiveKey];
            var fits = c && (b === 'health' ? c.isHealth : !c.isHealth);
            if (!fits) sec = 'clients';
        }
        nav(sec);
    }

    function install() {
        if (_origNav || typeof window.amsSidebarNav !== 'function') return;
        _origNav = window.amsSidebarNav;
        // 'clients' is the client list (the old 'search' view).
        window.amsSidebarNav = nav;

        // Opening a client: the detail replaces the list, and it joins the
        // recent clients.
        if (typeof window.amsLoadClientDetail === 'function') {
            var origLoad = window.amsLoadClientDetail;
            window.amsLoadClientDetail = function (key) {
                _opening = true;
                try { var r = origLoad.apply(this, arguments); } finally { _opening = false; }
                if (key) {
                    showClientsPanel(false);
                    var d = document.getElementById('amsClientDetail');
                    if (d && !/^HEALTH::/.test(key)) {
                        d.style.display = 'block';
                        if (!document.getElementById('amsBackToClients')) {
                            var b = document.createElement('button');
                            b.type = 'button'; b.id = 'amsBackToClients'; b.className = 'ams-back-clients';
                            b.innerHTML = '← All clients';
                            b.onclick = function () { nav('search'); };
                            d.insertBefore(b, d.firstChild);
                        }
                    }
                    remember(key);
                }
                return r;
            };
        }
        // Health opens a client through healthOpenClient; remember those too.
        if (typeof window.healthOpenClient === 'function') {
            var origHealth = window.healthOpenClient;
            window.healthOpenClient = function (key) { var r = origHealth.apply(this, arguments); if (key) remember(key); return r; };
        }
        renderRecent();

        // Reports and Renewals read policies through _rptBinder.
        if (typeof window._rptBinder === 'function') {
            var orig = window._rptBinder;
            window._rptBinder = function () { return filter(orig.apply(this, arguments)); };
        }
        renderTabs();
    }

    window.amsBookOf = bookOf;
    window.amsBook = current;
    window.amsBookMatch = matches;
    window.amsBookFilter = filter;
    window.amsSetBook = setBook;
    window.amsBooksInstall = install;
    window.amsBookSection = function () { return _section; };
    window.amsOpenRecent = openRecent;
    window.amsRenderRecent = renderRecent;

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
    else install();
})();
