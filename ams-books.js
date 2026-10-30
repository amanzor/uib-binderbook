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

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
    else install();
})();
