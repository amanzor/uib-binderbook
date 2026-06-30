/****************************************************************
 * UIB BINDER BOOK — Complete Google Apps Script Backend
 * --------------------------------------------------------------
 * Handles everything the app needs through ONE web app URL:
 *   1. Data sync   (key/value storage in a Google Sheet)
 *   2. Claude AI   (proxy to the Anthropic API for the chat)
 *   3. Email       (admin notifications)
 *
 * SETUP (do this once):
 *   1. Paste your real Anthropic API key below where it says
 *      PASTE_YOUR_KEY_HERE  (it starts with  sk-ant-...)
 *   2. Save (disk icon).
 *   3. Deploy ▸ Manage deployments ▸ ✏️ Edit ▸ Version: "New version" ▸ Deploy.
 *   4. The first time, Google will ask you to authorize — approve it.
 ****************************************************************/

// ── 1. PASTE YOUR ANTHROPIC API KEY HERE ──────────────────────
const ANTHROPIC_API_KEY = 'PASTE_YOUR_KEY_HERE';

// Model is sent by the app, but this is the fallback default.
const DEFAULT_MODEL = 'claude-sonnet-4-6';

// Admin email for notifications (used by the sendEmail action).
const ADMIN_EMAIL = 'admin@universalinsurancebroker.com';

// Name of the tab used as the key/value store. Auto-created if missing.
const STORE_SHEET = 'Store';

// Max characters per Sheet cell (Google limit is 50,000 — we stay under).
const CHUNK = 45000;


/* ============================================================ *
 *  ENTRY POINTS
 * ============================================================ */

function doGet(e) {
  try {
    const key = e && e.parameter && e.parameter.key;
    const action = e && e.parameter && e.parameter.action;

    // Legacy "getAll" support (returns the binderData array directly).
    if (action === 'getAll') {
      const val = kvGet('binderData');
      const arr = val ? JSON.parse(val) : [];
      return json(Array.isArray(arr) ? arr : []);
    }

    if (key) {
      const raw = kvGet(key);
      return json({ success: true, data: raw ? JSON.parse(raw) : null });
    }

    return json({ success: true, message: 'UIB BinderBook backend is running.' });
  } catch (err) {
    return json({ success: false, error: String(err) });
  }
}

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');

    // ── Claude AI proxy ──
    if (body.action === 'claude') {
      return handleClaudeRequest(body.body || {});
    }

    // ── Email notification ──
    if (body.action === 'sendEmail') {
      MailApp.sendEmail({
        to: body.to || ADMIN_EMAIL,
        subject: body.subject || '(no subject)',
        body: body.body || ''
      });
      return json({ success: true });
    }

    // ── Legacy "save" action (full binder array) ──
    if (body.action === 'save' && Array.isArray(body.data)) {
      kvSet('binderData', JSON.stringify(body.data));
      return json({ success: true });
    }

    // ── Key/value store (default) ──
    if (body.key !== undefined) {
      kvSet(body.key, JSON.stringify(body.value));
      return json({ success: true });
    }

    return json({ success: false, error: 'No key or recognized action provided.' });
  } catch (err) {
    return json({ success: false, error: String(err) });
  }
}


/* ============================================================ *
 *  CLAUDE API PROXY
 * ============================================================ */

function handleClaudeRequest(reqBody) {
  if (!ANTHROPIC_API_KEY || ANTHROPIC_API_KEY === 'PASTE_YOUR_KEY_HERE') {
    return json({ success: false, error: 'Anthropic API key not set in the Apps Script. Paste your sk-ant-... key into ANTHROPIC_API_KEY and redeploy.' });
  }

  const payload = {
    model: reqBody.model || DEFAULT_MODEL,
    max_tokens: reqBody.max_tokens || 4096,
    messages: reqBody.messages || []
  };
  if (reqBody.system) payload.system = reqBody.system;

  const options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  const resp = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', options);
  const text = resp.getContentText();

  // Pass the Claude API response straight back to the browser.
  return ContentService
    .createTextOutput(text)
    .setMimeType(ContentService.MimeType.JSON);
}


/* ============================================================ *
 *  KEY / VALUE STORE  (Sheet-backed, chunked for large values)
 * ============================================================ */

function storeSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(STORE_SHEET);
  if (!sh) {
    sh = ss.insertSheet(STORE_SHEET);
    sh.appendRow(['key', 'value']);
  }
  return sh;
}

function kvGet(key) {
  const sh = storeSheet();
  const data = sh.getDataRange().getValues();
  // Collect all chunk rows for this key, in order.
  const chunks = [];
  for (let i = 1; i < data.length; i++) {
    const k = String(data[i][0]);
    if (k === key || k.indexOf(key + '__#') === 0) {
      chunks.push([k, data[i][1]]);
    }
  }
  if (!chunks.length) return null;
  if (chunks.length === 1 && chunks[0][0] === key) return String(chunks[0][1]);

  // Sort chunk rows key__#0, key__#1, ...
  chunks.sort(function (a, b) {
    const ai = parseInt(a[0].split('__#')[1] || '0', 10);
    const bi = parseInt(b[0].split('__#')[1] || '0', 10);
    return ai - bi;
  });
  return chunks.map(function (c) { return String(c[1]); }).join('');
}

function kvSet(key, value) {
  const sh = storeSheet();
  const data = sh.getDataRange().getValues();

  // Remove every existing row for this key (single or chunked), bottom-up.
  for (let i = data.length - 1; i >= 1; i--) {
    const k = String(data[i][0]);
    if (k === key || k.indexOf(key + '__#') === 0) {
      sh.deleteRow(i + 1);
    }
  }

  value = String(value);
  if (value.length <= CHUNK) {
    sh.appendRow([key, value]);
  } else {
    // Split across multiple chunk rows.
    let idx = 0;
    for (let pos = 0; pos < value.length; pos += CHUNK) {
      sh.appendRow([key + '__#' + idx, value.substring(pos, pos + CHUNK)]);
      idx++;
    }
  }
}


/* ============================================================ *
 *  HELPERS
 * ============================================================ */

function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Run this ONCE manually (select it in the dropdown ▸ Run) to grant the
 * external-URL permission Claude needs, without going through the browser.
 */
function authorizeOnce() {
  const r = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post', muteHttpExceptions: true,
    contentType: 'application/json',
    headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    payload: JSON.stringify({ model: DEFAULT_MODEL, max_tokens: 10, messages: [{ role: 'user', content: 'ping' }] })
  });
  Logger.log(r.getContentText());
}
