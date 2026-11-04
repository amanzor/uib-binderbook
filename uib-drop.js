// ============================================================
//  DROP ANYWHERE — drag-and-drop for every file upload in the app
//  ------------------------------------------------------------
//  Any upload area (a box, card or form row holding an
//  <input type="file">) accepts files dropped onto it: the files are
//  handed to that input exactly as if they were picked with its
//  button, so each upload keeps its own handling. Areas that already
//  handle drops themselves are left alone. Dropping a file anywhere
//  else no longer makes the browser open it and leave the app.
// ============================================================
(function () {
    'use strict';
    if (window.__uibDrop) return;
    window.__uibDrop = true;

    const MAX_UP = 6;   // how far up from the drop point to look for the upload area
    let lit = null;

    function hasFiles(e) {
        const t = e.dataTransfer && e.dataTransfer.types;
        return !!t && Array.prototype.indexOf.call(t, 'Files') !== -1;
    }

    // The nearest area around the drop point that holds exactly one file
    // input (hidden ones count: most upload buttons use one).
    function areaFor(el) {
        for (let n = el, i = 0; n && n !== document.body && i < MAX_UP; n = n.parentElement, i++) {
            if (n.nodeType !== 1) continue;
            if (n.tagName === 'INPUT' && n.type === 'file') return { area: n, input: n };
            const inputs = n.querySelectorAll('input[type=file]:not([disabled])');
            if (inputs.length === 1) return { area: n, input: inputs[0] };
            if (inputs.length > 1) return null;
        }
        return null;
    }

    function accepts(input, file) {
        const acc = (input.getAttribute('accept') || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
        if (!acc.length) return true;
        const name = file.name.toLowerCase(), type = (file.type || '').toLowerCase();
        return acc.some(a => a.startsWith('.') ? name.endsWith(a)
            : a.endsWith('/*') ? type.startsWith(a.slice(0, -1)) : type === a);
    }

    function light(area) {
        if (lit === area) return;
        unlight();
        if (!area) return;
        lit = area;
        area.dataset.uibDropOutline = area.style.outline;
        area.style.outline = '3px dashed #1d4ed8';
    }
    function unlight() {
        if (!lit) return;
        lit.style.outline = lit.dataset.uibDropOutline || '';
        delete lit.dataset.uibDropOutline;
        lit = null;
    }

    document.addEventListener('dragover', function (e) {
        if (!hasFiles(e)) return;
        if (e.defaultPrevented) { unlight(); return; }   // an area with its own drag handling took it — keep its dropEffect
        e.preventDefault();                       // never let the browser navigate to the file
        const hit = areaFor(e.target);
        light(hit && hit.area);
        e.dataTransfer.dropEffect = hit ? 'copy' : 'none';
    });
    document.addEventListener('dragleave', function (e) {
        if (!e.relatedTarget || !document.documentElement.contains(e.relatedTarget)) unlight();
    });

    document.addEventListener('drop', function (e) {
        if (!hasFiles(e)) return;
        const handled = e.defaultPrevented;      // an area with its own drop handler already took it
        e.preventDefault();
        unlight();
        if (handled) return;
        const hit = areaFor(e.target);
        if (!hit) return;
        const input = hit.input;
        let files = Array.from(e.dataTransfer.files || []);
        const bad = files.filter(f => !accepts(input, f));
        files = files.filter(f => accepts(input, f));
        if (!input.multiple) files = files.slice(0, 1);
        if (!files.length) {
            alert('That file type cannot be uploaded here' + (input.accept ? ' (accepted: ' + input.accept + ').' : '.'));
            return;
        }
        try {
            const dt = new DataTransfer();
            files.forEach(f => dt.items.add(f));
            input.files = dt.files;
        } catch (err) { console.warn('uib-drop: could not hand the files to the upload', err); return; }
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        if (bad.length) console.info('uib-drop: skipped ' + bad.length + ' file(s) of a type this upload does not take');
    });
})();
