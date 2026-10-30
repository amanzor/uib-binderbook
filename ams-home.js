// ============================================================
//  AMS HOME — production at a glance
//  ------------------------------------------------------------
//  The first screen after sign-in. An agent sees their OWN
//  production (policies where they are the agent or second agent);
//  an administrator sees the whole agency and can narrow it to one
//  agent. Everyone can still open every client from Search.
//
//  The filters are the Binder Book's production filters — Today /
//  This Month / This Year / All Time / Custom range, line of
//  business and office location — so the numbers match what agents
//  already see there.
//
//  The cards are the agent's own: Customize adds, removes, moves and
//  resizes them, and the layout (with the monthly goal) is kept per
//  user on this device.
// ============================================================

(function () {
    'use strict';

    // ── Who is looking ───────────────────────────────────────
    // ams.js declares these with `let`, so they are not on window.
    function me()      { return (typeof amsCurrentUser !== 'undefined' && amsCurrentUser) ? amsCurrentUser : ''; }
    function isAdmin() { return typeof amsIsAdminUser === 'function' ? amsIsAdminUser() : false; }

    function esc(s) {
        return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    var num = function (v) { var n = parseFloat(v); return isFinite(n) ? n : 0; };
    var money = function (v) { return '$' + Math.round(v).toLocaleString('en-US'); };
    var moneyShort = function (v) {
        var a = Math.abs(v);
        if (a >= 1e6) return '$' + (v / 1e6).toFixed(a >= 1e7 ? 0 : 1) + 'M';
        if (a >= 1e4) return '$' + Math.round(v / 1e3) + 'k';
        return money(v);
    };
    function todayStr() { return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }); }
    function addDays(iso, n) { var d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); }
    function mdy(iso) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); return m ? m[2] + '/' + m[3] + '/' + m[1] : (iso || ''); }

    // ── Palette (dataviz reference palette, light mode) ──────
    var SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
    var OTHER = '#9ca3af';

    // ── Saved per user ───────────────────────────────────────
    var CARDS = {};   // filled below
    function prefsKey() { return 'amsHomeLayout:' + (me() || 'user').toLowerCase().replace(/\s+/g, '_'); }
    function defaultLayout() {
        var ids = isAdmin()
            ? [['policies', 's'], ['premium', 's'], ['revenue', 's'], ['goal', 's'],
               ['trend', 'l'], ['leaderboard', 'm'], ['lob', 'm'],
               ['carriers', 'm'], ['renewals', 'm'],
               ['recent', 'm'], ['newClients', 's'], ['cancellations', 's']]
            : [['today', 's'], ['policies', 's'], ['premium', 's'], ['commission', 's'],
               ['trend', 'l'], ['goal', 's'], ['rank', 's'], ['lob', 'm'],
               ['renewals', 'm'], ['recent', 'm']];
        return { cards: ids.map(function (x) { return { id: x[0], size: x[1] }; }),
                 goal: { type: 'premium', value: isAdmin() ? 100000 : 15000 }, period: 'month' };
    }
    function loadPrefs() {
        var p = null;
        try { p = JSON.parse(localStorage.getItem(prefsKey())); } catch (e) {}
        var d = defaultLayout();
        if (!p || !Array.isArray(p.cards)) return d;
        p.cards = p.cards.filter(function (c) { return c && CARDS[c.id] && (!CARDS[c.id].admin || isAdmin()) && (!CARDS[c.id].agent || !isAdmin()); });
        p.goal = Object.assign({}, d.goal, p.goal || {});
        p.period = p.period || 'month';
        return p;
    }
    function savePrefs() {
        try { localStorage.setItem(prefsKey(), JSON.stringify(_prefs)); } catch (e) {}
    }

    // ── State ────────────────────────────────────────────────
    var _prefs = null;
    var _f = { period: 'month', from: '', to: '', lob: '', location: '', agent: '' };
    var _editing = false;
    var _charts = {};
    var _dragId = null;

    // ── Data ─────────────────────────────────────────────────
    function allEntries() {
        var b = [];
        try { b = typeof amsGetBinderData === 'function' ? amsGetBinderData() : JSON.parse(localStorage.getItem('binderData') || '[]'); } catch (e) {}
        return Array.isArray(b) ? b : [];
    }
    function isCancel(e) { return /cancel/i.test(e.policyType || '') || /cancel/i.test(e.policyStatus || ''); }
    function entryDay(e) { return String(e.entryDate || e.effDate || '').slice(0, 10); }

    // Whose production: an agent always their own; an admin the
    // agency, or the agent picked in the filter.
    function owner() { return isAdmin() ? _f.agent : me(); }
    function ownedBy(e, who) { return !who || e.agent === who || e.secondAgent === who; }

    function range(period) {
        var t = todayStr();
        if (period === 'today') return [t, t];
        if (period === 'month') return [t.slice(0, 7) + '-01', t];
        if (period === 'year')  return [t.slice(0, 4) + '-01-01', t];
        if (period === 'custom') return [_f.from || '', _f.to || ''];
        return ['', ''];
    }
    // The same span one step back, for "vs last month" deltas.
    function prevRange(period) {
        var t = todayStr();
        if (period === 'today') { var y = addDays(t, -1); return [y, y]; }
        if (period === 'month') {
            var d = new Date(t.slice(0, 7) + '-01T12:00:00'); d.setMonth(d.getMonth() - 1);
            var start = d.toISOString().slice(0, 10);
            var sameDay = start.slice(0, 8) + t.slice(8, 10);
            return [start, sameDay];
        }
        if (period === 'year') { var py = String(+t.slice(0, 4) - 1); return [py + '-01-01', py + t.slice(4)]; }
        return null;
    }
    // Compared to the same point in the previous period (month to date
    // against last month to the same day), so a partial month is fair.
    var PREV_LABEL = { today: 'yesterday', month: 'last month', year: 'last year' };

    function base(who) {
        return allEntries().filter(function (e) {
            if (!ownedBy(e, who)) return false;
            if (_f.lob && e.lineOfBusiness !== _f.lob) return false;
            if (_f.location && (e.location || '') !== _f.location) return false;
            return true;
        });
    }
    function inRange(list, r) {
        if (!r) return [];
        return list.filter(function (e) {
            var d = entryDay(e);
            if (r[0] && (!d || d < r[0])) return false;
            if (r[1] && (!d || d > r[1])) return false;
            return true;
        });
    }

    // Everything a card might need, computed once per render.
    function context() {
        var who = owner();
        var b = base(who);
        var cur = inRange(b, range(_f.period));
        var pr = prevRange(_f.period);
        var prev = pr ? inRange(b, pr) : null;
        var sales = function (l) { return l.filter(function (e) { return !isCancel(e); }); };
        var commissionOf = function (e) {
            if (isAdmin() && !who) return num(e.agencyCommission) + num(e.agencyFee);
            if (e.secondAgent === who && e.agent !== who) return num(e.secondAgentCommission);
            return num(e.agentCommissionShare);
        };
        return { who: who, base: b, cur: cur, prev: prev, sales: sales(cur), prevSales: prev ? sales(prev) : null,
                 commissionOf: commissionOf, all: allEntries() };
    }
    function sum(list, f) { return list.reduce(function (s, e) { return s + f(e); }, 0); }
    function prem(e) { return num(e.totalPremium) || num(e.basePremium); }

    // ── Cards ────────────────────────────────────────────────
    // kind: kpi | chart | list. render(ctx) returns the body; chart
    // cards also draw(ctx, canvasId).
    function delta(curV, prevV, isMoney) {
        if (prevV == null) return '';
        var diff = curV - prevV;
        if (!diff) return '<span class="ah-delta ah-flat">— same as ' + PREV_LABEL[_f.period] + '</span>';
        var up = diff > 0;
        return '<span class="ah-delta ' + (up ? 'ah-up' : 'ah-down') + '" title="Compared with the same point ' + PREV_LABEL[_f.period] + '">' + (up ? '▲ ' : '▼ ') +
               (isMoney ? moneyShort(Math.abs(diff)) : Math.abs(diff).toLocaleString()) + ' vs ' + PREV_LABEL[_f.period] + '</span>';
    }
    function kpi(value, isMoney, sub, dlt) {
        return '<div class="ah-kpi-val" data-count="' + value + '" data-money="' + (isMoney ? 1 : 0) + '">' +
               (isMoney ? money(value) : Math.round(value).toLocaleString()) + '</div>' +
               (sub ? '<div class="ah-kpi-sub">' + sub + '</div>' : '') + (dlt || '');
    }
    function openClient(name) { return 'onclick="amsHomeOpenClient(\'' + esc(String(name || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'")) + '\')"'; }

    CARDS = {
        today: { title: 'Today', icon: '⚡', kind: 'kpi', accent: '#eb6834',
            render: function (c) {
                var t = todayStr();
                var l = c.base.filter(function (e) { return entryDay(e) === t && !isCancel(e); });
                return kpi(l.length, false, money(sum(l, prem)) + ' premium written today');
            } },
        policies: { title: 'Policies written', icon: '📄', kind: 'kpi', accent: '#2a78d6',
            render: function (c) {
                var n = c.sales.filter(function (e) { return /new|rewrite/i.test(e.policyType || ''); }).length;
                var r = c.sales.filter(function (e) { return /renew/i.test(e.policyType || ''); }).length;
                return kpi(c.sales.length, false, n + ' new · ' + r + ' renewal' + (r === 1 ? '' : 's'),
                           delta(c.sales.length, c.prevSales ? c.prevSales.length : null, false));
            } },
        premium: { title: 'Premium written', icon: '💵', kind: 'kpi', accent: '#1baf7a',
            render: function (c) {
                var v = sum(c.sales, prem);
                return kpi(v, true, 'avg ' + money(c.sales.length ? v / c.sales.length : 0) + ' per policy',
                           delta(v, c.prevSales ? sum(c.prevSales, prem) : null, true));
            } },
        commission: { title: 'My commission', icon: '🏆', kind: 'kpi', accent: '#6250d6', agent: true,
            render: function (c) {
                var v = sum(c.sales, c.commissionOf);
                return kpi(v, true, 'estimated from your entries', delta(v, c.prevSales ? sum(c.prevSales, c.commissionOf) : null, true));
            } },
        revenue: { title: 'Agency revenue', icon: '🏦', kind: 'kpi', accent: '#6250d6', admin: true,
            render: function (c) {
                var fn = c.who ? c.commissionOf : function (e) { return num(e.agencyCommission) + num(e.agencyFee); };
                var v = sum(c.sales, fn);
                return kpi(v, true, c.who ? c.who + '’s commission' : 'commission + agency fees',
                           delta(v, c.prevSales ? sum(c.prevSales, fn) : null, true));
            } },
        fees: { title: 'Agency fees', icon: '🧾', kind: 'kpi', accent: '#eda100',
            render: function (c) {
                var v = sum(c.sales, function (e) { return num(e.agencyFee); });
                return kpi(v, true, c.sales.filter(function (e) { return num(e.agencyFee) > 0; }).length + ' policies with a fee',
                           delta(v, c.prevSales ? sum(c.prevSales, function (e) { return num(e.agencyFee); }) : null, true));
            } },
        avg: { title: 'Average premium', icon: '📊', kind: 'kpi', accent: '#2a78d6',
            render: function (c) {
                var v = c.sales.length ? sum(c.sales, prem) / c.sales.length : 0;
                return kpi(v, true, 'across ' + c.sales.length + ' polic' + (c.sales.length === 1 ? 'y' : 'ies'));
            } },
        newClients: { title: 'New clients', icon: '🤝', kind: 'kpi', accent: '#e87ba4',
            render: function (c) {
                // A client is new in the period when their first entry ever falls in it.
                var first = {};
                c.base.forEach(function (e) {
                    var k = String(e.customerName || '').trim().toUpperCase(), d = entryDay(e);
                    if (k && d && (!first[k] || d < first[k])) first[k] = d;
                });
                var r = range(_f.period);
                var n = Object.keys(first).filter(function (k) { return (!r[0] || first[k] >= r[0]) && (!r[1] || first[k] <= r[1]); }).length;
                return kpi(n, false, 'first policy with us in this period');
            } },
        cancellations: { title: 'Cancellations', icon: '⚠️', kind: 'kpi', accent: '#e34948',
            render: function (c) {
                var l = c.cur.filter(isCancel);
                return kpi(l.length, false, l.length ? money(sum(l, prem)) + ' premium' : 'none — nice work');
            } },
        goal: { title: 'Monthly goal', icon: '🎯', kind: 'kpi', accent: '#008300',
            render: function (c) {
                var g = _prefs.goal;
                var t = todayStr();
                var month = c.base.filter(function (e) { return entryDay(e).slice(0, 7) === t.slice(0, 7) && !isCancel(e); });
                var have = g.type === 'policies' ? month.length : sum(month, prem);
                var pct = g.value > 0 ? Math.min(have / g.value, 1) : 0;
                var R = 34, C = 2 * Math.PI * R;
                var done = have >= g.value && g.value > 0;
                var fmt = function (v) { return g.type === 'policies' ? Math.round(v).toLocaleString() : moneyShort(v); };
                return '<div class="ah-goal">' +
                    '<svg viewBox="0 0 84 84" class="ah-ring" role="img" aria-label="' + Math.round(pct * 100) + '% of goal">' +
                      '<circle cx="42" cy="42" r="' + R + '" class="ah-ring-bg"/>' +
                      '<circle cx="42" cy="42" r="' + R + '" class="ah-ring-fg' + (done ? ' ah-ring-done' : '') + '" stroke-dasharray="' + C.toFixed(1) +
                        '" stroke-dashoffset="' + C.toFixed(1) + '" data-offset="' + (C * (1 - pct)).toFixed(1) + '"/>' +
                      '<text x="42" y="47" text-anchor="middle" class="ah-ring-txt">' + Math.round(pct * 100) + '%</text></svg>' +
                    '<div><div class="ah-goal-have">' + fmt(have) + '</div>' +
                      '<div class="ah-kpi-sub">of ' + fmt(g.value) + (g.type === 'policies' ? ' policies' : ' premium') + ' this month</div>' +
                      (done ? '<div class="ah-delta ah-up">🎉 Goal reached!</div>'
                            : '<div class="ah-kpi-sub">' + fmt(Math.max(g.value - have, 0)) + ' to go</div>') +
                      '<button class="ah-link" onclick="amsHomeSetGoal()">Set goal</button></div></div>';
            } },
        trend: { title: 'Premium by month', icon: '📈', kind: 'chart', note: 'last 12 months',
            render: function () { return '<div class="ah-chart" style="height:220px;"><canvas id="ahc_trend"></canvas></div>'; },
            draw: function (c) {
                var months = [], d = new Date(todayStr().slice(0, 7) + '-01T12:00:00');
                for (var i = 11; i >= 0; i--) {
                    var m = new Date(d); m.setMonth(d.getMonth() - i);
                    months.push(m.toISOString().slice(0, 7));
                }
                var vals = months.map(function (k) {
                    return sum(c.base.filter(function (e) { return entryDay(e).slice(0, 7) === k && !isCancel(e); }), prem);
                });
                var labels = months.map(function (k) { return new Date(k + '-15T12:00:00').toLocaleDateString('en-US', { month: 'short', year: '2-digit' }); });
                chart('trend', { type: 'bar', data: { labels: labels, datasets: [{ data: vals, label: 'Premium',
                    backgroundColor: months.map(function (k, i) { return i === 11 ? '#2a78d6' : '#2a78d6a6'; }),
                    borderRadius: 4, borderSkipped: 'start', maxBarThickness: 34 }] },
                    options: baseOpts({ money: true }) });
            } },
        lob: { title: 'Mix by line of business', icon: '🧩', kind: 'chart',
            render: function (c) { return c.sales.length ? '<div class="ah-chart" style="height:220px;"><canvas id="ahc_lob"></canvas></div>' : empty(); },
            draw: function (c) {
                var t = top(c.sales, function (e) { return e.lineOfBusiness || 'Other'; }, prem, 7);
                chart('lob', { type: 'doughnut', data: { labels: t.labels, datasets: [{ data: t.values,
                    backgroundColor: t.labels.map(function (l, i) { return l === 'Other' ? OTHER : SERIES[i % SERIES.length]; }),
                    borderColor: '#fff', borderWidth: 2 }] },
                    options: { responsive: true, maintainAspectRatio: false, cutout: '62%',
                        plugins: { legend: { position: 'right', labels: { boxWidth: 10, boxHeight: 10, font: { size: 11 }, color: '#334155' } },
                                   tooltip: { callbacks: { label: function (x) { return ' ' + x.label + ': ' + money(x.parsed); } } } } } });
            } },
        carriers: { title: 'Top carriers', icon: '🏢', kind: 'chart',
            render: function (c) { return c.sales.length ? '<div class="ah-chart" style="height:240px;"><canvas id="ahc_carriers"></canvas></div>' : empty(); },
            draw: function (c) { hbar('carriers', top(c.sales, function (e) { return e.company || 'Unknown'; }, prem, 8, true)); } },
        sources: { title: 'Lead sources', icon: '🧲', kind: 'chart',
            render: function (c) { return c.sales.length ? '<div class="ah-chart" style="height:240px;"><canvas id="ahc_sources"></canvas></div>' : empty(); },
            draw: function (c) { hbar('sources', top(c.sales, function (e) { return e.source || 'Not recorded'; }, function () { return 1; }, 8, true), true); } },
        leaderboard: { title: 'Agent leaderboard', icon: '🥇', kind: 'list', admin: true,
            render: function (c) {
                var by = {};
                inRange(base(''), range(_f.period)).filter(function (e) { return !isCancel(e); }).forEach(function (e) {
                    if (!e.agent) return;
                    by[e.agent] = by[e.agent] || { p: 0, n: 0 };
                    by[e.agent].p += prem(e); by[e.agent].n++;
                });
                var rows = Object.keys(by).map(function (a) { return [a, by[a]]; }).sort(function (a, b) { return b[1].p - a[1].p; });
                if (!rows.length) return empty();
                var max = rows[0][1].p || 1;
                return '<div class="ah-board">' + rows.slice(0, 10).map(function (r, i) {
                    return '<div class="ah-board-row' + (r[0] === _f.agent ? ' ah-me' : '') + '" onclick="amsHomeSetAgent(\'' + esc(r[0].replace(/'/g, "\\'")) + '\')" title="Show ' + esc(r[0]) + '">' +
                        '<span class="ah-rank">' + (i < 3 ? ['🥇', '🥈', '🥉'][i] : i + 1) + '</span>' +
                        '<span class="ah-board-name">' + esc(r[0]) + '</span>' +
                        '<span class="ah-board-bar"><i style="width:' + (r[1].p / max * 100).toFixed(1) + '%"></i></span>' +
                        '<span class="ah-board-val">' + moneyShort(r[1].p) + '<small>' + r[1].n + ' pol.</small></span></div>';
                }).join('') + '</div>';
            } },
        rank: { title: 'My rank', icon: '🏅', kind: 'kpi', accent: '#eda100', agent: true,
            render: function () {
                var by = {};
                inRange(base(''), range(_f.period)).filter(function (e) { return !isCancel(e); }).forEach(function (e) {
                    if (e.agent) by[e.agent] = (by[e.agent] || 0) + prem(e);
                });
                var order = Object.keys(by).sort(function (a, b) { return by[b] - by[a]; });
                var i = order.indexOf(me());
                if (i === -1) return kpi(0, false, 'no sales in this period yet — your first one puts you on the board');
                var ahead = i > 0 ? moneyShort(by[order[i - 1]] - by[me()]) + ' behind #' + i : 'top of the agency 🎉';
                return '<div class="ah-kpi-val">#' + (i + 1) + '<small> of ' + order.length + '</small></div><div class="ah-kpi-sub">' + ahead + ' by premium</div>';
            } },
        renewals: { title: 'Renewals coming up', icon: '🔄', kind: 'list', note: 'next 45 days',
            render: function (c) {
                var t = todayStr(), end = addDays(t, 45);
                var seen = {};
                var l = c.base.filter(function (e) {
                    var x = String(e.expirationDate || '').slice(0, 10);
                    if (!x || x < t || x > end || isCancel(e)) return false;
                    var k = (e.policyNumber || e.id) + '';
                    if (seen[k]) return false;
                    seen[k] = true;
                    return true;
                }).sort(function (a, b) { return String(a.expirationDate).localeCompare(String(b.expirationDate)); });
                if (!l.length) return empty('Nothing expiring in the next 45 days.');
                return '<div class="ah-list">' + l.slice(0, 8).map(function (e) {
                    var days = Math.round((new Date(e.expirationDate + 'T12:00:00') - new Date(t + 'T12:00:00')) / 864e5);
                    return '<div class="ah-row" ' + openClient(e.customerName) + '>' +
                        '<span class="ah-pill ' + (days <= 7 ? 'ah-pill-hot' : days <= 21 ? 'ah-pill-warm' : '') + '">' + days + 'd</span>' +
                        '<span class="ah-row-main"><b>' + esc(e.customerName) + '</b><small>' + esc([e.lineOfBusiness, e.company].filter(Boolean).join(' · ')) + '</small></span>' +
                        '<span class="ah-row-end">' + money(prem(e)) + '<small>' + mdy(e.expirationDate) + '</small></span></div>';
                }).join('') + (l.length > 8 ? '<div class="ah-more">+ ' + (l.length - 8) + ' more in Renewals</div>' : '') + '</div>';
            } },
        recent: { title: 'Recent sales', icon: '🧾', kind: 'list',
            render: function (c) {
                var l = c.sales.slice().sort(function (a, b) { return entryDay(b).localeCompare(entryDay(a)) || (num(b.id) - num(a.id)); });
                if (!l.length) return empty('No sales in this period yet.');
                return '<div class="ah-list">' + l.slice(0, 8).map(function (e) {
                    return '<div class="ah-row" ' + openClient(e.customerName) + '>' +
                        '<span class="ah-pill ah-pill-' + (/renew/i.test(e.policyType || '') ? 'renew' : 'new') + '">' + esc((e.policyType || 'New').slice(0, 3)) + '</span>' +
                        '<span class="ah-row-main"><b>' + esc(e.customerName) + '</b><small>' + esc([e.lineOfBusiness, e.company, (isAdmin() && !_f.agent) ? e.agent : ''].filter(Boolean).join(' · ')) + '</small></span>' +
                        '<span class="ah-row-end">' + money(prem(e)) + '<small>' + mdy(entryDay(e)) + '</small></span></div>';
                }).join('') + '</div>';
            } }
    };

    function empty(msg) { return '<div class="ah-empty">' + esc(msg || 'No sales in this period yet.') + '</div>'; }
    function top(list, keyFn, valFn, n, noOther) {
        var m = {};
        list.forEach(function (e) { var k = keyFn(e); m[k] = (m[k] || 0) + valFn(e); });
        var rows = Object.keys(m).map(function (k) { return [k, m[k]]; }).sort(function (a, b) { return b[1] - a[1]; });
        var head = rows.slice(0, n), rest = rows.slice(n);
        if (rest.length && !noOther) head.push(['Other', rest.reduce(function (s, r) { return s + r[1]; }, 0)]);
        return { labels: head.map(function (r) { return r[0]; }), values: head.map(function (r) { return r[1]; }) };
    }

    // ── Charts ───────────────────────────────────────────────
    function baseOpts(o) {
        o = o || {};
        var fmt = o.money ? moneyShort : function (v) { return Math.round(v).toLocaleString(); };
        var opts = { responsive: true, maintainAspectRatio: false, animation: { duration: 700 },
            plugins: { legend: { display: false },
                       tooltip: { backgroundColor: '#0f172a', padding: 10, cornerRadius: 8, displayColors: false,
                                  callbacks: { label: function (x) { return (o.money ? money : fmt)(o.horizontal ? x.parsed.x : x.parsed.y); } } } },
            scales: {} };
        var valueAxis = { beginAtZero: true, grid: { color: '#eef2f7' }, border: { display: false },
                          ticks: { color: '#64748b', font: { size: 10.5 }, callback: function (v) { return fmt(v); } } };
        var catAxis = { grid: { display: false }, border: { color: '#e2e8f0' }, ticks: { color: '#475569', font: { size: 10.5 } } };
        if (o.horizontal) { opts.indexAxis = 'y'; opts.scales.x = valueAxis; opts.scales.y = catAxis; }
        else { opts.scales.y = valueAxis; opts.scales.x = catAxis; }
        return opts;
    }
    function hbar(id, t, count) {
        chart(id, { type: 'bar', data: { labels: t.labels, datasets: [{ data: t.values, backgroundColor: '#2a78d6', borderRadius: 4,
            borderSkipped: 'start', maxBarThickness: 18 }] }, options: baseOpts({ horizontal: true, money: !count }) });
    }
    function chart(id, cfg) {
        if (typeof Chart === 'undefined') return;
        var el = document.getElementById('ahc_' + id);
        if (!el) return;
        if (_charts[id]) { try { _charts[id].destroy(); } catch (e) {} }
        if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) cfg.options.animation = false;
        _charts[id] = new Chart(el, cfg);
    }

    // ── Rendering ────────────────────────────────────────────
    function injectCss() {
        if (document.getElementById('ahStyles')) return;
        var css = '' +
        '.ah{max-width:1320px;margin:0 auto;}' +
        '.ah-hero{position:relative;overflow:hidden;border-radius:18px;padding:24px 28px;color:#fff;margin-bottom:16px;' +
          'background:radial-gradient(1200px 300px at 110% -40%,rgba(103,232,249,.35),transparent 60%),linear-gradient(135deg,#0d1f3c 0%,#1d4ed8 100%);' +
          'box-shadow:0 18px 40px -24px rgba(13,31,60,.7);}' +
        '.ah-hero h1{font-size:24px;font-weight:800;margin:0 0 4px;letter-spacing:-.3px;color:#fff;}' +
        '.ah-hero p{margin:0;font-size:13px;opacity:.85;color:#fff;}' +
        '.ah-hero .ah-hero-line{margin-top:10px;font-size:14px;opacity:1;font-weight:600;}' +
        '.ah-hero-badge{display:inline-block;background:rgba(255,255,255,.16);border:1px solid rgba(255,255,255,.25);border-radius:999px;padding:3px 10px;font-size:11px;font-weight:700;margin-bottom:10px;}' +
        '.ah-bar{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-bottom:16px;}' +
        '.ah-tabs{display:flex;gap:3px;background:#e8edf4;border-radius:10px;padding:3px;max-width:100%;overflow-x:auto;}' +
        '.ah-tabs button{white-space:nowrap;border:none;background:none;padding:7px 13px;border-radius:8px;font-size:12.5px;font-weight:600;color:#475569;cursor:pointer;font-family:inherit;}' +
        '.ah-tabs button.on{background:#fff;color:#0d1f3c;box-shadow:0 1px 3px rgba(15,23,42,.12);}' +
        '.ah-bar select,.ah-bar input[type=date]{padding:7px 10px;border:1px solid #dbe2ea;border-radius:9px;font-size:12.5px;background:#fff;color:#0f172a;font-family:inherit;}' +
        '.ah-grow{flex:1;}' +
        '.ah-btn{padding:8px 14px;border-radius:9px;border:1px solid #dbe2ea;background:#fff;color:#0d1f3c;font-size:12.5px;font-weight:700;cursor:pointer;font-family:inherit;}' +
        '.ah-btn:hover{background:#f1f5f9;}' +
        '.ah-btn-primary{background:linear-gradient(135deg,#0d1f3c,#1d4ed8);color:#fff;border:none;}' +
        '.ah-btn-primary:hover{filter:brightness(1.1);background:linear-gradient(135deg,#0d1f3c,#1d4ed8);}' +
        '.ah-grid{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));gap:14px;}' +
        '.ah-card{position:relative;background:#fff;border:1px solid #e6ebf1;border-radius:16px;padding:16px 18px;min-width:0;' +
          'box-shadow:0 1px 2px rgba(15,23,42,.04),0 10px 28px -22px rgba(13,31,60,.45);transition:transform .2s,box-shadow .2s;' +
          'animation:ahIn .45s ease both;}' +
        '.ah-card:hover{transform:translateY(-2px);box-shadow:0 1px 2px rgba(15,23,42,.05),0 16px 34px -22px rgba(13,31,60,.55);}' +
        '@keyframes ahIn{from{opacity:0;transform:translateY(8px);}to{opacity:1;transform:none;}}' +
        '.ah-s{grid-column:span 3;}.ah-m{grid-column:span 6;}.ah-l{grid-column:span 12;}' +
        '.ah-card-head{display:flex;align-items:center;gap:8px;margin-bottom:10px;}' +
        '.ah-ico{width:30px;height:30px;border-radius:9px;display:flex;align-items:center;justify-content:center;font-size:15px;flex-shrink:0;}' +
        '.ah-card-title{font-size:12px;font-weight:700;color:#334155;text-transform:uppercase;letter-spacing:.5px;flex:1;min-width:0;}' +
        '.ah-card-note{font-size:11px;color:#94a3b8;font-weight:600;}' +
        '.ah-kpi-val{font-size:30px;font-weight:800;color:#0d1f3c;letter-spacing:-.6px;line-height:1.1;font-variant-numeric:tabular-nums;}' +
        '.ah-kpi-val small{font-size:14px;color:#64748b;font-weight:700;letter-spacing:0;}' +
        '.ah-kpi-sub{font-size:12px;color:#64748b;margin-top:4px;}' +
        '.ah-delta{display:inline-block;white-space:nowrap;margin-top:8px;font-size:11.5px;font-weight:700;border-radius:999px;padding:2px 9px;}' +
        '.ah-up{background:#dcfce7;color:#166534;}.ah-down{background:#fee2e2;color:#991b1b;}.ah-flat{background:#f1f5f9;color:#475569;}' +
        '.ah-goal{display:flex;gap:14px;align-items:center;}' +
        '.ah-ring{width:84px;height:84px;flex-shrink:0;transform:rotate(-90deg);}' +
        '.ah-ring-bg{fill:none;stroke:#e8edf4;stroke-width:9;}' +
        '.ah-ring-fg{fill:none;stroke:#1d4ed8;stroke-width:9;stroke-linecap:round;transition:stroke-dashoffset 1.1s cubic-bezier(.2,.8,.2,1);}' +
        '.ah-ring-done{stroke:#16a34a;}' +
        '.ah-ring-txt{font-size:16px;font-weight:800;fill:#0d1f3c;transform:rotate(90deg);transform-origin:42px 42px;}' +
        '.ah-goal-have{font-size:22px;font-weight:800;color:#0d1f3c;font-variant-numeric:tabular-nums;}' +
        '.ah-link{border:none;background:none;color:#1d4ed8;font-size:11.5px;font-weight:700;padding:0;margin-top:6px;cursor:pointer;font-family:inherit;}' +
        '.ah-chart{position:relative;}' +
        '.ah-empty{padding:26px 8px;text-align:center;color:#94a3b8;font-size:12.5px;}' +
        '.ah-list{display:flex;flex-direction:column;gap:2px;}' +
        '.ah-row{display:flex;align-items:center;gap:10px;padding:8px 8px;border-radius:10px;cursor:pointer;}' +
        '.ah-row:hover{background:#f5f8fc;}' +
        '.ah-row-main{flex:1;min-width:0;display:flex;flex-direction:column;}' +
        '.ah-row-main b{font-size:13px;color:#0f172a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}' +
        '.ah-row small{font-size:11px;color:#94a3b8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}' +
        '.ah-row-end{display:flex;flex-direction:column;align-items:flex-end;font-size:12.5px;font-weight:700;color:#0d1f3c;font-variant-numeric:tabular-nums;}' +
        '.ah-pill{min-width:38px;text-align:center;font-size:10.5px;font-weight:800;border-radius:8px;padding:4px 6px;background:#eef2f7;color:#334155;}' +
        '.ah-pill-hot{background:#fee2e2;color:#991b1b;}.ah-pill-warm{background:#fef3c7;color:#92400e;}' +
        '.ah-pill-new{background:#dbeafe;color:#1e40af;}.ah-pill-renew{background:#dcfce7;color:#166534;}' +
        '.ah-more{font-size:11.5px;color:#64748b;padding:6px 8px;}' +
        '.ah-board{display:flex;flex-direction:column;gap:6px;}' +
        '.ah-board-row{display:grid;grid-template-columns:30px minmax(90px,1fr) 2fr 86px;gap:10px;align-items:center;padding:6px;border-radius:10px;cursor:pointer;}' +
        '.ah-board-row:hover,.ah-board-row.ah-me{background:#f5f8fc;}' +
        '.ah-rank{text-align:center;font-weight:800;color:#475569;font-size:13px;}' +
        '.ah-board-name{font-size:12.5px;font-weight:700;color:#0f172a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}' +
        '.ah-board-bar{height:8px;background:#eef2f7;border-radius:4px;overflow:hidden;}' +
        '.ah-board-bar i{display:block;height:100%;background:#2a78d6;border-radius:4px;}' +
        '.ah-board-val{text-align:right;font-size:12.5px;font-weight:800;color:#0d1f3c;display:flex;flex-direction:column;font-variant-numeric:tabular-nums;}' +
        '.ah-board-val small{font-size:10.5px;color:#94a3b8;font-weight:600;}' +
        // Customize mode
        '.ah-editing .ah-card{cursor:grab;outline:2px dashed #bfdbfe;outline-offset:-2px;animation:none;}' +
        '.ah-editing .ah-card:hover{transform:none;}' +
        '.ah-card.ah-drag{opacity:.4;}' +
        '.ah-card.ah-over{outline-color:#1d4ed8;}' +
        '.ah-tools{display:none;gap:4px;}' +
        '.ah-editing .ah-tools{display:flex;}' +
        '.ah-tools button{width:26px;height:26px;border-radius:7px;border:1px solid #dbe2ea;background:#fff;cursor:pointer;font-size:11px;font-weight:800;color:#334155;padding:0;font-family:inherit;}' +
        '.ah-tools button:hover{background:#eff6ff;}' +
        '.ah-tools .ah-x{color:#b91c1c;}' +
        '.ah-add{grid-column:span 3;border:2px dashed #cbd5e1;border-radius:16px;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:4px;' +
          'min-height:120px;color:#64748b;font-weight:700;font-size:13px;cursor:pointer;background:#f8fafc;}' +
        '.ah-add:hover{border-color:#1d4ed8;color:#1d4ed8;background:#eff6ff;}' +
        '.ah-gallery{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px;}' +
        '.ah-gallery button{text-align:left;border:1px solid #e2e8f0;border-radius:12px;background:#fff;padding:12px;cursor:pointer;font-family:inherit;}' +
        '.ah-gallery button:hover{border-color:#1d4ed8;background:#eff6ff;}' +
        '.ah-gallery b{display:block;font-size:13px;color:#0d1f3c;margin-top:4px;}' +
        '.ah-gallery small{font-size:11px;color:#64748b;}' +
        '@media (max-width:1180px){.ah-s{grid-column:span 6;}.ah-m{grid-column:span 12;}.ah-add{grid-column:span 6;}}' +
        '@media (max-width:640px){.ah-s,.ah-m,.ah-l,.ah-add{grid-column:span 12;}.ah-hero{padding:18px;}.ah-hero h1{font-size:20px;}.ah-kpi-val{font-size:26px;}' +
          '.ah-board-row{grid-template-columns:26px 1fr 80px;}.ah-board-bar{display:none;}}' +
        '@media (prefers-reduced-motion:reduce){.ah-card{animation:none;transition:none;}.ah-ring-fg{transition:none;}}';
        var st = document.createElement('style');
        st.id = 'ahStyles';
        st.textContent = css;
        document.head.appendChild(st);
    }

    var CARD_INFO = {
        today: 'What you wrote today', policies: 'Count, new vs renewal, vs last period', premium: 'Total and average premium',
        commission: 'Your estimated commission', revenue: 'Agency commission + fees', fees: 'Agency fees collected',
        avg: 'Average premium per policy', newClients: 'Clients with their first policy', cancellations: 'Cancellations in the period',
        goal: 'Progress ring toward your monthly goal', trend: '12-month premium bars', lob: 'Doughnut by line of business',
        carriers: 'Premium by carrier', sources: 'Policies by lead source', leaderboard: 'Agents ranked by premium',
        rank: 'Where you stand in the agency', renewals: 'Your policies expiring soon', recent: 'Latest sales — click to open the client'
    };

    function periodLabel() {
        return { today: 'today', month: 'this month', year: 'this year', all: 'all time', custom: 'the selected dates' }[_f.period];
    }

    function heroHtml(c) {
        var h = new Date().toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: 'America/New_York' });
        var greet = +h < 12 ? 'Good morning' : +h < 18 ? 'Good afternoon' : 'Good evening';
        var first = (me() || '').split(' ')[0] || 'there';
        var p = sum(c.sales, prem);
        var line;
        if (!c.sales.length) line = 'No sales recorded ' + periodLabel() + ' yet — the board is yours to fill.';
        else {
            line = (isAdmin() && !c.who ? 'The agency has' : c.who && c.who !== me() ? c.who + ' has' : 'You’ve') + ' written ' +
                   c.sales.length + ' polic' + (c.sales.length === 1 ? 'y' : 'ies') + ' and ' + money(p) + ' in premium ' + periodLabel();
            if (c.prevSales && c.prevSales.length) {
                var d = c.sales.length - c.prevSales.length;
                line += d > 0 ? ' — ' + d + ' more than ' + PREV_LABEL[_f.period] + ' 🚀' : d === 0 ? ' — right on pace.' : '.';
            } else line += '.';
        }
        var scope = isAdmin() ? (c.who ? 'Viewing ' + c.who : 'Whole agency') : 'Your production';
        return '<div class="ah-hero"><span class="ah-hero-badge">' + esc(scope) + '</span>' +
            '<h1>' + greet + ', ' + esc(first) + ' 👋</h1>' +
            '<p>' + new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' }) + '</p>' +
            '<p class="ah-hero-line">' + esc(line) + '</p></div>';
    }

    function filterBar(c) {
        var all = allEntries();
        var lobs = {}, locs = {}, agents = {};
        all.forEach(function (e) {
            if (e.lineOfBusiness) lobs[e.lineOfBusiness] = 1;
            if (e.location) locs[e.location] = 1;
            if (e.agent) agents[e.agent] = 1;
        });
        var opt = function (obj, sel, label) {
            return '<option value="">' + label + '</option>' + Object.keys(obj).sort().map(function (v) {
                return '<option value="' + esc(v) + '"' + (v === sel ? ' selected' : '') + '>' + esc(v) + '</option>';
            }).join('');
        };
        var tabs = [['today', 'Today'], ['month', 'This Month'], ['year', 'This Year'], ['all', 'All Time'], ['custom', 'Custom']];
        return '<div class="ah-bar">' +
            '<div class="ah-tabs" role="tablist">' + tabs.map(function (t) {
                return '<button role="tab" aria-selected="' + (_f.period === t[0]) + '" class="' + (_f.period === t[0] ? 'on' : '') + '" onclick="amsHomeSetPeriod(\'' + t[0] + '\')">' + t[1] + '</button>';
            }).join('') + '</div>' +
            (_f.period === 'custom'
                ? '<input type="date" value="' + esc(_f.from) + '" onchange="amsHomeFilter(\'from\',this.value)" aria-label="From"><span style="color:#94a3b8;">→</span>' +
                  '<input type="date" value="' + esc(_f.to) + '" onchange="amsHomeFilter(\'to\',this.value)" aria-label="To">' : '') +
            (isAdmin() ? '<select onchange="amsHomeFilter(\'agent\',this.value)" aria-label="Agent">' + opt(agents, _f.agent, 'Whole agency') + '</select>' : '') +
            '<select onchange="amsHomeFilter(\'lob\',this.value)" aria-label="Line of business">' + opt(lobs, _f.lob, 'All lines') + '</select>' +
            '<select onchange="amsHomeFilter(\'location\',this.value)" aria-label="Location">' + opt(locs, _f.location, 'All locations') + '</select>' +
            '<span class="ah-grow"></span>' +
            (_editing
                ? '<button class="ah-btn" onclick="amsHomeReset()">Reset layout</button><button class="ah-btn ah-btn-primary" onclick="amsHomeCustomize()">✓ Done</button>'
                : '<button class="ah-btn" onclick="amsHomeCustomize()">✎ Customize</button>') +
        '</div>';
    }

    function cardHtml(item, c, i) {
        var def = CARDS[item.id];
        var tint = def.accent || '#2a78d6';
        var body;
        try { body = def.render(c); } catch (e) { console.warn('Home card ' + item.id, e); body = empty('Could not show this card.'); }
        return '<div class="ah-card ah-' + item.size + '" data-id="' + item.id + '" style="animation-delay:' + (i * 35) + 'ms"' +
            (_editing ? ' draggable="true" ondragstart="amsHomeDrag(event,\'' + item.id + '\')" ondragover="amsHomeDragOver(event)" ondragleave="this.classList.remove(\'ah-over\')" ondrop="amsHomeDrop(event,\'' + item.id + '\')" ondragend="amsHomeDragEnd()"' : '') + '>' +
            '<div class="ah-card-head"><span class="ah-ico" style="background:' + tint + '1a;">' + def.icon + '</span>' +
              '<span class="ah-card-title">' + esc(def.title) + '</span>' +
              (def.note ? '<span class="ah-card-note">' + esc(def.note) + '</span>' : '') +
              '<span class="ah-tools">' +
                '<button title="Move left" onclick="amsHomeMove(\'' + item.id + '\',-1)">◀</button>' +
                '<button title="Move right" onclick="amsHomeMove(\'' + item.id + '\',1)">▶</button>' +
                '<button title="Size: small / medium / wide" onclick="amsHomeSize(\'' + item.id + '\')">' + item.size.toUpperCase() + '</button>' +
                '<button class="ah-x" title="Remove card" onclick="amsHomeRemove(\'' + item.id + '\')">✕</button>' +
              '</span></div>' + body + '</div>';
    }

    function render() {
        var host = document.getElementById('amsHomeBody');
        if (!host) return;
        injectCss();
        if (!_prefs) { _prefs = loadPrefs(); _f.period = _prefs.period || 'month'; }
        var c = context();
        var cards = _prefs.cards.filter(function (x) { return CARDS[x.id]; });
        host.innerHTML = '<div class="ah' + (_editing ? ' ah-editing' : '') + '">' + heroHtml(c) + filterBar(c) +
            '<div class="ah-grid">' + cards.map(function (x, i) { return cardHtml(x, c, i); }).join('') +
            (_editing ? '<div class="ah-add" onclick="amsHomeGallery()" role="button" tabindex="0"><span style="font-size:24px;">＋</span>Add a card</div>' : '') +
            (!cards.length && !_editing ? '<div class="ah-card ah-l"><div class="ah-empty">No cards on your home page. Click ✎ Customize to add some.</div></div>' : '') +
            '</div></div>';
        cards.forEach(function (x) { if (CARDS[x.id].draw) { try { CARDS[x.id].draw(c); } catch (e) { console.warn('Home chart ' + x.id, e); } } });
        animate(host);
    }

    // Numbers count up and the goal ring fills — once per render.
    function animate(host) {
        var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        requestAnimationFrame(function () {
            host.querySelectorAll('.ah-ring-fg').forEach(function (r) { r.style.strokeDashoffset = r.getAttribute('data-offset'); });
        });
        if (reduce) return;
        host.querySelectorAll('.ah-kpi-val[data-count]').forEach(function (el) {
            var target = parseFloat(el.getAttribute('data-count')) || 0;
            var isMoney = el.getAttribute('data-money') === '1';
            if (!target) return;
            var t0 = null, dur = 900;
            var step = function (ts) {
                if (!t0) t0 = ts;
                var k = Math.min((ts - t0) / dur, 1), e = 1 - Math.pow(1 - k, 3);
                var v = target * e;
                el.textContent = isMoney ? money(v) : Math.round(v).toLocaleString();
                if (k < 1) requestAnimationFrame(step);
            };
            requestAnimationFrame(step);
        });
    }

    // ── Customizing ──────────────────────────────────────────
    function idx(id) { for (var i = 0; i < _prefs.cards.length; i++) if (_prefs.cards[i].id === id) return i; return -1; }
    function closeGallery() { var m = document.getElementById('ahGallery'); if (m) m.remove(); }

    window.amsHomeRender = render;
    window.amsHomeSetPeriod = function (p) { _f.period = p; _prefs.period = p; savePrefs(); render(); };
    window.amsHomeFilter = function (k, v) { _f[k] = v; render(); };
    window.amsHomeSetAgent = function (a) { if (!isAdmin()) return; _f.agent = _f.agent === a ? '' : a; render(); };
    window.amsHomeCustomize = function () { _editing = !_editing; render(); };
    window.amsHomeReset = function () {
        if (!confirm('Put your home page back to the standard cards?')) return;
        var keepGoal = _prefs.goal;
        _prefs = defaultLayout(); _prefs.goal = keepGoal; _prefs.period = _f.period;
        savePrefs(); render();
    };
    window.amsHomeMove = function (id, d) {
        var i = idx(id), j = i + d;
        if (i < 0 || j < 0 || j >= _prefs.cards.length) return;
        var t = _prefs.cards[i]; _prefs.cards[i] = _prefs.cards[j]; _prefs.cards[j] = t;
        savePrefs(); render();
    };
    window.amsHomeSize = function (id) {
        var i = idx(id); if (i < 0) return;
        var order = ['s', 'm', 'l'];
        _prefs.cards[i].size = order[(order.indexOf(_prefs.cards[i].size) + 1) % 3];
        savePrefs(); render();
    };
    window.amsHomeRemove = function (id) {
        var i = idx(id); if (i < 0) return;
        _prefs.cards.splice(i, 1);
        savePrefs(); render();
    };
    window.amsHomeGallery = function () {
        var have = {};
        _prefs.cards.forEach(function (x) { have[x.id] = 1; });
        var avail = Object.keys(CARDS).filter(function (id) {
            var d = CARDS[id];
            return !have[id] && (!d.admin || isAdmin()) && (!d.agent || !isAdmin());
        });
        var m = document.createElement('div');
        m.id = 'ahGallery';
        m.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.5);z-index:10005;display:flex;align-items:center;justify-content:center;padding:16px;';
        m.onclick = function (e) { if (e.target === m) closeGallery(); };
        m.innerHTML = '<div style="background:#fff;border-radius:16px;max-width:760px;width:100%;max-height:86vh;overflow:auto;padding:20px 22px;box-shadow:0 30px 70px rgba(15,23,42,.35);">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;"><h2 style="font-size:17px;color:#0d1f3c;margin:0;">Add a card</h2>' +
            '<button class="ah-btn" onclick="document.getElementById(\'ahGallery\').remove()">Close</button></div>' +
            (avail.length ? '<div class="ah-gallery">' + avail.map(function (id) {
                return '<button onclick="amsHomeAdd(\'' + id + '\')"><span style="font-size:18px;">' + CARDS[id].icon + '</span><b>' + esc(CARDS[id].title) + '</b><small>' + esc(CARD_INFO[id] || '') + '</small></button>';
            }).join('') + '</div>' : '<p class="ah-empty">Every card is already on your home page.</p>') + '</div>';
        injectCss();
        document.body.appendChild(m);
    };
    window.amsHomeAdd = function (id) {
        if (!CARDS[id]) return;
        _prefs.cards.push({ id: id, size: CARDS[id].kind === 'kpi' ? 's' : CARDS[id].id === 'trend' ? 'l' : 'm' });
        savePrefs(); closeGallery(); render();
    };
    window.amsHomeSetGoal = function () {
        var g = _prefs.goal;
        var type = prompt('Monthly goal — count "premium" dollars or "policies"?', g.type);
        if (type === null) return;
        type = /pol/i.test(type) ? 'policies' : 'premium';
        var v = prompt(type === 'policies' ? 'How many policies this month?' : 'How much premium this month? (dollars)', String(g.type === type ? g.value : (type === 'policies' ? 20 : 15000)));
        if (v === null) return;
        var n = parseFloat(String(v).replace(/[^0-9.]/g, ''));
        if (!(n > 0)) { alert('Enter a number above zero.'); return; }
        _prefs.goal = { type: type, value: n };
        savePrefs(); render();
    };
    window.amsHomeDrag = function (ev, id) {
        _dragId = id;
        ev.dataTransfer.effectAllowed = 'move';
        try { ev.dataTransfer.setData('text/plain', id); } catch (e) {}
        ev.currentTarget.classList.add('ah-drag');
    };
    window.amsHomeDragOver = function (ev) { ev.preventDefault(); ev.currentTarget.classList.add('ah-over'); };
    window.amsHomeDrop = function (ev, target) {
        ev.preventDefault();
        var from = idx(_dragId), to = idx(target);
        if (from < 0 || to < 0 || from === to) return;
        var item = _prefs.cards.splice(from, 1)[0];
        _prefs.cards.splice(to, 0, item);
        savePrefs(); render();
    };
    window.amsHomeDragEnd = function () { _dragId = null; document.querySelectorAll('.ah-card').forEach(function (c) { c.classList.remove('ah-drag', 'ah-over'); }); };
    window.amsHomeOpenClient = function (name) {
        var key = typeof amsClientKey === 'function' ? amsClientKey(name) : String(name || '').trim().toUpperCase();
        if (!key || typeof amsLoadClientDetail !== 'function') return;
        if (typeof amsSidebarNav === 'function') amsSidebarNav('search');
        amsLoadClientDetail(key);
    };
    // A different user signed in on this device gets their own layout.
    window.amsHomeResetUser = function () { _prefs = null; _editing = false; _f = { period: 'month', from: '', to: '', lob: '', location: '', agent: '' }; };
})();
