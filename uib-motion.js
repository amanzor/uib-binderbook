// ============================================================
// UIB BINDER BOOK — "Aurora Navy" motion layer
// ------------------------------------------------------------
// Additive, dependency-light. Works with or without the Motion
// engine (motion@12, the vanilla build of the Framer Motion
// engine). Without it the CSS in uib-theme.css still gives
// hover/press/focus states; with it we add spring presses,
// hover lift, magnetic CTAs, color-matched glows, spotlight
// cards, staggered reveals and the aurora decoration.
//
// Rules this file keeps (see uib-theme.css header):
//  - never repaints a button's background (reads it to derive a glow)
//  - never leaves a transform on ancestors of fixed/sticky elements
//    (reveals animate containers only, via x/y keys → end at `none`)
//  - never throws: every feature is guarded
//  - one rAF-coalesced MutationObserver enhances re-rendered DOM
//    (tables, cards, modals) idempotently via data-uib-* flags
// ============================================================
(function () {
  'use strict';
  if (window.UIBTheme) return;

  const html = document.documentElement;
  const M = window.Motion || null;
  const can = (fn) => !!(M && typeof M[fn] === 'function');
  const reduceMQ = window.matchMedia ? matchMedia('(prefers-reduced-motion: reduce)') : { matches: false, addEventListener() {} };
  let reduce = reduceMQ.matches;
  const motionOK = () => can('animate') && !reduce;
  const EASE = [0.22, 1, 0.36, 1];
  const spring = (stiffness, damping) => ({ type: 'spring', stiffness, damping });
  const safe = (fn) => { try { return fn(); } catch (e) { /* never break the app */ } };

  html.classList.toggle('uib-has-motion', can('animate') && !reduce);
  html.classList.toggle('uib-reduce', reduce);
  safe(() => reduceMQ.addEventListener('change', (e) => {
    reduce = e.matches;
    html.classList.toggle('uib-has-motion', can('animate') && !reduce);
    html.classList.toggle('uib-reduce', reduce);
  }));

  // ── Selectors ──────────────────────────────────────────────
  const AURORA_HOSTS = [
    'body > .container > header', '.app-header', '.ams-header', '.portal-header', '.portal-hero',
    '#amsLoginScreen', '#loginScreen', '#loginSection > div[style*="position:fixed"]',
    'div[style*="background:linear-gradient(135deg,#0d1f3c 0%,#1d4ed8 100%)"]',
  ].join(',');
  const SKIP = '#uibCloudPanel,#uibOutdatedBanner,#uibStorageWarn,#syncBanner,#amsSyncBanner,#rnwToast,.lob-dropdown,.m-ripple,#amsPolicyActionMenu,canvas,select,option,[data-uib-skip]';
  const BTN_NO_LIFT = '.prod-tab,.uw-tab,.uw-line-tab,.ams-tab-btn,.ams-tab,.portal-tab,.report-tab,.acct-tab,.cat-chip,.lob-multiselect-btn,[onmouseover],[onmouseout],[disabled],#uibCloudBtn,#aiBubbleBtn,button[style*="transform"]';
  const BTN_NO_PRESS = '.lob-multiselect-btn,[onmouseover],[onmouseout],[disabled],button[style*="transform"]';
  const MAGNETIC = '.footer-buttons button:not(.btn-sm), .form-actions .btn-success, .form-actions .btn-primary, .modal-actions .btn-primary, .modal-actions .btn-success, #claudeInlineSendBtn, #claudeAdminSendBtn, .login-btn';
  const SPOT = '.stats-grid .stat-card, .dash-kpi, .rpt-kpi, #prodStatsRow > div, #apd_statsRow > div, #pdash_statsRow > div, #vldash_statsRow > div, #uw_statsRow > div, .stat-row .stat-card';
  const REVEAL = '.form-section, .filter-section, .table-container, .chart-container, .footer-buttons, .stats-grid, .dash-kpi, .dash-chart-card, .rpt-kpi, .file-card, .doc-card, .client-card, .section-card, .client-header, #underwritingList > div, #prodStatsRow > div, #apd_statsRow > div, #uw_statsRow > div, #agentSection div[style*="background:linear-gradient(135deg,#f0f9ff,#e0f2fe)"], #claudeInlineSection, .page-body div[style*="border-radius:10px"][style*="border:1.5px solid"]';
  const NAV = '.user-info, .footer-buttons, .ams-tabbar';

  // ── Aurora decoration ─────────────────────────────────────
  function addAurora(root) {
    const hosts = root.matches && root.matches(AURORA_HOSTS) ? [root] : [];
    root.querySelectorAll && root.querySelectorAll(AURORA_HOSTS).forEach(h => hosts.push(h));
    for (const host of hosts) {
      if (host.querySelector(':scope > .uib-aurora')) continue;
      const a = document.createElement('span');
      a.className = 'uib-aurora'; a.setAttribute('aria-hidden', 'true'); a.setAttribute('data-uib-decor', '1');
      a.innerHTML = '<i></i><i></i><i></i>';
      host.insertBefore(a, host.firstChild);
    }
  }

  // ── Buttons: classify + glow color derived from its OWN background ──
  function parseFirstColors(src) {
    const cols = (src || '').match(/rgba?\([^)]+\)/g) || [];
    return cols.map(c => { const m = c.match(/[\d.]+/g) || []; return { r: +m[0] || 0, g: +m[1] || 0, b: +m[2] || 0, a: m.length > 3 ? +m[3] : 1 }; });
  }
  // Classification is split into a READ phase (computed styles) and a WRITE phase (attributes /
  // custom properties) so a big re-render (hundreds of table buttons) never thrashes style recalc,
  // and large batches are chunked across frames to keep every task well under 50ms.
  function classify(btn) {
    const cs = getComputedStyle(btn);
    const grad = cs.backgroundImage && cs.backgroundImage !== 'none';
    const cols = parseFirstColors(grad ? cs.backgroundImage : cs.backgroundColor).filter(c => c.a > 0.05);
    if (!cols.length) return { btn, kind: 'flat', glow: null };
    const c = cols[Math.min(cols.length - 1, Math.floor(cols.length / 2))];
    const lum = (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255;
    if (grad || lum < 0.85) return { btn, kind: 'fill', glow: lum > 0.8 ? 'rgba(15,23,42,.28)' : `rgba(${c.r},${c.g},${c.b},.55)` };
    return { btn, kind: 'flat', glow: null };
  }
  const CHUNK = 120;
  function tagButtons(list) {
    const todo = list.filter(b => !b.dataset.uibBtn && b.isConnected);
    if (!todo.length) return;
    const slice = todo.slice(0, CHUNK);
    const reads = slice.map(classify);               // reads only
    for (const r of reads) {                          // then writes only
      if (r.glow) r.btn.style.setProperty('--uib-glow', r.glow);
      r.btn.dataset.uibBtn = r.kind;
    }
    if (todo.length > CHUNK) requestAnimationFrame(() => tagButtons(todo.slice(CHUNK)));
  }
  function tagButton(btn) { tagButtons([btn]); }

  // ── Enhance (idempotent) ──────────────────────────────────
  function enhance(root) {
    if (!(root instanceof Element) && root !== document.body) return;
    if (root.closest && root.closest(SKIP)) return;
    safe(() => addAurora(root));
    safe(() => {
      const list = root.matches && root.matches('button') ? [root] : [];
      root.querySelectorAll('button:not([data-uib-btn])').forEach(b => list.push(b));
      tagButtons(list);
    });
    safe(() => revealIn(root));
    safe(() => navStagger(root));
  }

  function revealIn(root) {
    if (!motionOK() || !can('inView')) return;
    const list = root.matches && root.matches(REVEAL) ? [root] : [];
    root.querySelectorAll(REVEAL).forEach(el => list.push(el));
    for (const el of list) {
      if (el.dataset.uibRevealed || el.style.opacity !== '' || el.closest('.modal, .ams-modal, ' + SKIP)) continue;
      el.dataset.uibRevealed = '1';
      M.inView(el, () => { M.animate(el, { opacity: [0, 1], y: [10, 0] }, { duration: .4, ease: EASE }); }, { amount: 0.15, margin: '0px 0px -6% 0px' });
    }
  }

  function navStagger(root) {
    if (!motionOK() || !can('stagger')) return;
    const bars = root.matches && root.matches(NAV) ? [root] : [];
    root.querySelectorAll(NAV).forEach(b => bars.push(b));
    for (const bar of bars) {
      if (bar.dataset.uibNav || bar.closest('.modal')) continue;
      const btns = [...bar.querySelectorAll(':scope > button, :scope > .ams-tab-btn')].filter(b => b.style.opacity === '');
      bar.dataset.uibNav = '1';
      if (!btns.length) continue;
      M.animate(btns, { opacity: [0, 1], y: [6, 0] }, { duration: .35, delay: M.stagger(0.035), ease: EASE });
    }
  }

  // ── Delegated hover / press / magnetic (works for re-rendered buttons too) ──
  const btnOf = (t) => t && t.closest ? t.closest('button') : null;
  function onOver(e) {
    const b = btnOf(e.target); if (!b || e.pointerType === 'touch' || !motionOK()) return;
    if (b.contains(e.relatedTarget)) return;
    if (b.matches(BTN_NO_LIFT)) return;
    if (b.matches(MAGNETIC)) return; // magnetic handles its own lift
    M.animate(b, { y: -2 }, spring(500, 28));
  }
  function onOut(e) {
    const b = btnOf(e.target); if (!b || e.pointerType === 'touch' || !can('animate')) return;
    if (b.contains(e.relatedTarget)) return;
    if (b.matches(BTN_NO_LIFT) || b.matches(MAGNETIC)) return;
    M.animate(b, { y: 0 }, spring(400, 26));
  }
  let pressed = null;
  function onDown(e) {
    const b = btnOf(e.target); if (!b || !motionOK() || e.button > 0) return;
    if (b.matches(BTN_NO_PRESS)) return;
    pressed = b;
    M.animate(b, { scale: .95 }, spring(700, 32));
  }
  function onUp() {
    if (!pressed || !can('animate')) { pressed = null; return; }
    M.animate(pressed, { scale: 1 }, spring(450, 18));
    pressed = null;
  }
  let magRAF = 0;
  function onMove(e) {
    if (e.pointerType === 'touch') return;
    const t = e.target;
    const card = t && t.closest ? t.closest(SPOT) : null;
    const mag = motionOK() && t && t.closest ? t.closest(MAGNETIC) : null;
    if (!card && !mag) return;
    const x = e.clientX, y = e.clientY;
    if (magRAF) return;
    magRAF = requestAnimationFrame(() => {
      magRAF = 0;
      if (card) {
        const r = card.getBoundingClientRect();
        card.style.setProperty('--uib-mx', ((x - r.left) / r.width * 100).toFixed(1) + '%');
        card.style.setProperty('--uib-my', ((y - r.top) / r.height * 100).toFixed(1) + '%');
      }
      if (mag && !mag.matches(BTN_NO_LIFT)) {
        const r = mag.getBoundingClientRect();
        const dx = (x - (r.left + r.width / 2)) / r.width, dy = (y - (r.top + r.height / 2)) / r.height;
        M.animate(mag, { x: dx * 8, y: dy * 6 - 2 }, { duration: .25, ease: EASE });
      }
    });
  }
  function onLeaveMag(e) {
    const mag = e.target && e.target.closest ? e.target.closest(MAGNETIC) : null;
    if (!mag || mag.contains(e.relatedTarget) || !can('animate')) return;
    M.animate(mag, { x: 0, y: 0 }, spring(300, 18));
  }

  // ── Observer: one instance, rAF-coalesced, ignores icon/ripple/text churn ──
  let queue = new Set(), scheduled = false;
  const IGNORE_TARGET = 'button, h3, h4, .number, select, .lob-dropdown, #claudeChatMessages, #claudeInlineMessages, #claudeAdminMessages, #claudeRenewalMessages, #aiChatMessages, #amsRnwMessages, #commAiMessages, .uib-aurora';
  const IGNORE_NODE = 'svg, .m-ripple, option, .uib-aurora, .uib-progress';
  const mo = new MutationObserver(records => {
    for (const r of records) {
      if (r.type !== 'childList' || !r.addedNodes.length) continue;
      const t = r.target;
      if (!t || t.nodeType !== 1 || t.matches(IGNORE_TARGET)) continue;
      let real = false;
      for (const n of r.addedNodes) { if (n.nodeType === 1 && !n.matches(IGNORE_NODE)) { real = true; break; } }
      if (real) queue.add(t);
    }
    if (queue.size && !scheduled) { scheduled = true; requestAnimationFrame(flush); }
  });
  function flush() {
    scheduled = false;
    const roots = [...queue]; queue.clear();
    for (const r of roots) { if (!r.isConnected) continue; if (roots.some(o => o !== r && o.contains(r))) continue; enhance(r); }
  }

  // ── Page-load hairline + aurora pause when hidden ─────────
  function progress() {
    if (reduce || document.querySelector('.uib-progress')) return;
    const p = document.createElement('div'); p.className = 'uib-progress'; p.setAttribute('aria-hidden', 'true'); p.setAttribute('data-uib-decor', '1');
    document.body.appendChild(p);
    setTimeout(() => p.remove(), 1200);
  }
  function onVisibility() { html.classList.toggle('uib-paused', document.hidden); }

  // ── Boot ──────────────────────────────────────────────────
  let booted = false;
  function boot() {
    if (booted) return; booted = true;
    safe(() => enhance(document.body));
    safe(progress);
    document.addEventListener('pointerover', onOver, { capture: true, passive: true });
    document.addEventListener('pointerout', onOut, { capture: true, passive: true });
    document.addEventListener('pointerout', onLeaveMag, { capture: true, passive: true });
    document.addEventListener('pointerdown', onDown, { capture: true, passive: true });
    document.addEventListener('pointerup', onUp, { capture: true, passive: true });
    document.addEventListener('pointercancel', onUp, { capture: true, passive: true });
    document.addEventListener('pointermove', onMove, { capture: true, passive: true });
    document.addEventListener('visibilitychange', onVisibility);
    safe(() => mo.observe(document.body, { childList: true, subtree: true }));
  }
  function destroy() {
    safe(() => mo.disconnect());
    document.removeEventListener('pointerover', onOver, true); document.removeEventListener('pointerout', onOut, true);
    document.removeEventListener('pointerout', onLeaveMag, true); document.removeEventListener('pointerdown', onDown, true);
    document.removeEventListener('pointerup', onUp, true); document.removeEventListener('pointercancel', onUp, true);
    document.removeEventListener('pointermove', onMove, true); document.removeEventListener('visibilitychange', onVisibility);
    document.querySelectorAll('.uib-aurora, .uib-progress').forEach(n => n.remove());
    html.classList.remove('uib-has-motion', 'uib-paused');
    booted = false; window.UIBTheme = undefined;
  }

  window.UIBTheme = { refresh: () => safe(() => enhance(document.body)), destroy, hasMotion: () => can('animate') };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
