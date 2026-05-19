// ============================================================
// UIB BINDER BOOK — MOTION ANIMATIONS
// Powered by Motion One (motion.dev) + 21st.dev patterns
// Branch: feature/motion-animations
// All information is unchanged — this file only adds movement.
// ============================================================

(function () {
    if (!window.Motion) {
        console.warn('[UIBMotion] Motion library not loaded — animations skipped.');
        window.UIBMotion = {};
        return;
    }

    const { animate, stagger } = window.Motion;

    // ── Easing curves (from 21st.dev Framer Motion patterns) ────
    const SPRING    = [0.34, 1.56, 0.64, 1];   // springy overshoot
    const EASE_OUT  = [0.22, 1, 0.36, 1];        // smooth decel
    const EASE_BACK = [0.68, -0.55, 0.27, 1.55]; // back ease for cards
    const EASE_IO   = [0.65, 0, 0.35, 1];         // smooth in-out

    // ── helper: safely query elements ────────────────────────────
    function q(sel, ctx) { return (ctx || document).querySelectorAll(sel); }

    // ─────────────────────────────────────────────────────────────
    // 1. HEADER — fade + drift down on first load
    // ─────────────────────────────────────────────────────────────
    function animateHeader() {
        const h1 = document.querySelector('header h1');
        const p  = document.querySelector('header p');
        if (!h1) return;

        animate(h1, { opacity: [0, 1], transform: ['translateY(-10px)', 'translateY(0)'] },
            { duration: 0.55, easing: EASE_OUT });

        if (p) animate(p, { opacity: [0, 0.65] }, { duration: 0.5, delay: 0.18 });
    }

    // ─────────────────────────────────────────────────────────────
    // 2. LOGIN PAGE — stagger agent cards in, subtitle + buttons
    // ─────────────────────────────────────────────────────────────
    function animateAgentCards() {
        const cards    = q('.agent-btn');
        const subtitle = document.querySelector('.login-subtitle');
        const h2       = document.querySelector('.login-container h2');
        const actions  = document.querySelector('.login-container > div:last-of-type');

        if (h2) {
            h2.style.opacity = '0';
            animate(h2,
                { opacity: [0, 1], transform: ['translateY(-8px)', 'translateY(0)'] },
                { duration: 0.4, easing: EASE_OUT });
        }
        if (subtitle) {
            subtitle.style.opacity = '0';
            animate(subtitle, { opacity: [0, 1] }, { duration: 0.4, delay: 0.12 });
        }

        if (cards.length) {
            cards.forEach(c => { c.style.opacity = '0'; c.style.transform = 'translateY(18px) scale(0.97)'; });
            animate(cards,
                { opacity: [0, 1], transform: ['translateY(18px) scale(0.97)', 'translateY(0) scale(1)'] },
                { duration: 0.45, delay: stagger(0.07, { start: 0.15 }), easing: EASE_BACK });
        }

        if (actions) {
            actions.style.opacity = '0';
            animate(actions,
                { opacity: [0, 1], transform: ['translateY(8px)', 'translateY(0)'] },
                { duration: 0.4, delay: 0.55, easing: EASE_OUT });
        }
    }

    // ─────────────────────────────────────────────────────────────
    // 3. SECTION TRANSITIONS — fade + slide when switching views
    // ─────────────────────────────────────────────────────────────
    function animateSection(el) {
        if (!el) return;
        animate(el,
            { opacity: [0, 1], transform: ['translateY(12px)', 'translateY(0)'] },
            { duration: 0.35, easing: EASE_OUT });
    }

    // ─────────────────────────────────────────────────────────────
    // 4. MODALS — spring entrance / quick exit
    // ─────────────────────────────────────────────────────────────
    function animateModalOpen(modalEl) {
        if (!modalEl) return;
        const content = modalEl.querySelector('.modal-content');
        if (!content) return;

        // Backdrop fade
        animate(modalEl,
            { opacity: [0, 1] },
            { duration: 0.22, easing: EASE_IO });

        // Content spring pop
        animate(content,
            { opacity: [0, 1], transform: ['scale(0.92) translateY(14px)', 'scale(1) translateY(0)'] },
            { duration: 0.4, easing: SPRING });
    }

    function animateModalClose(modalEl, callback) {
        if (!modalEl) { callback?.(); return; }
        const content = modalEl.querySelector('.modal-content');
        const run = content
            ? animate(content,
                { opacity: [1, 0], transform: ['scale(1)', 'scale(0.95)'] },
                { duration: 0.18, easing: EASE_IO })
            : animate(modalEl, { opacity: [1, 0] }, { duration: 0.18 });
        run.finished.then(() => callback?.());
    }

    // ─────────────────────────────────────────────────────────────
    // 5. STAT CARDS — stagger in + count-up numbers
    // ─────────────────────────────────────────────────────────────
    function countUp(el, targetText) {
        const match = targetText.match(/[\d,]+\.?\d*/);
        if (!match) { el.textContent = targetText; return; }

        const raw     = match[0].replace(/,/g, '');
        const target  = parseFloat(raw);
        const isFloat = raw.includes('.');
        const decs    = isFloat ? (raw.split('.')[1] || '').length : 0;
        const pre     = targetText.slice(0, targetText.indexOf(match[0]));
        const suf     = targetText.slice(targetText.indexOf(match[0]) + match[0].length);
        const dur     = Math.min(1200, Math.max(600, target * 0.05));

        let start = null;
        function frame(ts) {
            if (!start) start = ts;
            const p = Math.min((ts - start) / dur, 1);
            const ease = 1 - Math.pow(1 - p, 3); // cubic ease-out
            const cur = target * ease;
            el.textContent = pre + (isFloat
                ? cur.toLocaleString('en-US', { minimumFractionDigits: decs, maximumFractionDigits: decs })
                : Math.floor(cur).toLocaleString('en-US')) + suf;
            if (p < 1) requestAnimationFrame(frame);
            else el.textContent = targetText;
        }
        el.textContent = pre + (isFloat ? (0).toFixed(decs) : '0') + suf;
        requestAnimationFrame(frame);
    }

    function animateStatCards() {
        const cards = q('.stat-card');
        if (!cards.length) return;

        cards.forEach(c => { c.style.opacity = '0'; c.style.transform = 'translateY(14px)'; });

        const anim = animate(cards,
            { opacity: [0, 1], transform: ['translateY(14px)', 'translateY(0)'] },
            { duration: 0.42, delay: stagger(0.09), easing: EASE_OUT });

        anim.finished.then(() => {
            cards.forEach(card => {
                const num = card.querySelector('.number');
                if (num && num.textContent.trim()) countUp(num, num.textContent.trim());
            });
        });
    }

    // ─────────────────────────────────────────────────────────────
    // 6. TABLE ROWS — stagger slide-in from left
    // ─────────────────────────────────────────────────────────────
    function animateTableRows(tbody) {
        const rows = tbody ? tbody.querySelectorAll('tr') : [];
        if (!rows.length) return;

        rows.forEach(r => { r.style.opacity = '0'; r.style.transform = 'translateX(-10px)'; });

        animate(rows,
            { opacity: [0, 1], transform: ['translateX(-10px)', 'translateX(0)'] },
            { duration: 0.3, delay: stagger(0.035, { start: 0.04 }), easing: EASE_OUT });
    }

    // ─────────────────────────────────────────────────────────────
    // 7. CHART BARS — animate width from 0 → target
    // ─────────────────────────────────────────────────────────────
    function animateChartBars(container) {
        const bars = container ? container.querySelectorAll('[data-chart-bar]') : [];
        if (!bars.length) return;

        bars.forEach((bar, i) => {
            const targetWidth = bar.dataset.chartBar;
            bar.style.width = '0%';
            animate(bar,
                { width: ['0%', targetWidth] },
                { duration: 0.7, delay: i * 0.06, easing: EASE_OUT });
        });
    }

    // ─────────────────────────────────────────────────────────────
    // 8. SUCCESS TOAST — slide down + auto dismiss
    // ─────────────────────────────────────────────────────────────
    function animateSuccess(el) {
        if (!el) return;
        el.style.display = 'block';
        el.style.opacity = '0';
        animate(el,
            { opacity: [0, 1], transform: ['translateY(-12px)', 'translateY(0)'] },
            { duration: 0.32, easing: SPRING });

        setTimeout(() => {
            animate(el, { opacity: [1, 0], transform: ['translateY(0)', 'translateY(-6px)'] },
                { duration: 0.3, easing: EASE_IO })
                .finished.then(() => { el.style.display = ''; });
        }, 3000);
    }

    // ─────────────────────────────────────────────────────────────
    // 9. BUTTON RIPPLE — Material-style click wave
    // ─────────────────────────────────────────────────────────────
    function rippleHandler(e) {
        const btn = e.currentTarget;
        const old = btn.querySelector('.m-ripple');
        if (old) old.remove();

        const rect = btn.getBoundingClientRect();
        const size = Math.max(rect.width, rect.height) * 2.2;
        const span = document.createElement('span');
        span.className = 'm-ripple';
        span.style.cssText = [
            'position:absolute', 'border-radius:50%', 'pointer-events:none',
            `width:${size}px`, `height:${size}px`,
            `left:${e.clientX - rect.left - size / 2}px`,
            `top:${e.clientY - rect.top - size / 2}px`,
            'background:rgba(255,255,255,0.22)', 'transform:scale(0)',
        ].join(';');

        btn.style.position = btn.style.position || 'relative';
        btn.style.overflow = 'hidden';
        btn.appendChild(span);

        animate(span,
            { transform: ['scale(0)', 'scale(1)'], opacity: [0.7, 0] },
            { duration: 0.55, easing: EASE_OUT })
            .finished.then(() => span.remove());
    }

    function addRippleToButtons() {
        document.querySelectorAll('button:not([data-no-ripple])').forEach(btn => {
            if (!btn.dataset.rippleAttached) {
                btn.dataset.rippleAttached = '1';
                btn.addEventListener('click', rippleHandler);
            }
        });
    }

    // ─────────────────────────────────────────────────────────────
    // 10. FORM SECTIONS — stagger reveal inside modals
    // ─────────────────────────────────────────────────────────────
    function animateFormSections(container) {
        const secs = container ? container.querySelectorAll('.form-section, .form-group') : [];
        if (!secs.length) return;
        secs.forEach(s => { s.style.opacity = '0'; s.style.transform = 'translateY(6px)'; });
        animate(secs,
            { opacity: [0, 1], transform: ['translateY(6px)', 'translateY(0)'] },
            { duration: 0.3, delay: stagger(0.04), easing: EASE_OUT });
    }

    // ─────────────────────────────────────────────────────────────
    // 11. USER-INFO BAR — slide down from top
    // ─────────────────────────────────────────────────────────────
    function animateUserInfoBar(sectionEl) {
        const bar = sectionEl ? sectionEl.querySelector('.user-info') : null;
        if (!bar) return;
        bar.style.opacity = '0';
        animate(bar,
            { opacity: [0, 1], transform: ['translateY(-8px)', 'translateY(0)'] },
            { duration: 0.35, easing: EASE_OUT });
    }

    // ─────────────────────────────────────────────────────────────
    // PUBLIC API
    // ─────────────────────────────────────────────────────────────
    window.UIBMotion = {
        animateHeader,
        animateAgentCards,
        animateSection,
        animateModalOpen,
        animateModalClose,
        animateStatCards,
        animateTableRows,
        animateChartBars,
        animateSuccess,
        addRippleToButtons,
        animateFormSections,
        animateUserInfoBar,
    };

    console.log('[UIBMotion] Ready ✓');
})();
