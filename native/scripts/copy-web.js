// Copies the Binder Book web app from the repository root into native/www
// so the native shell ships with the app bundled. Two adjustments are made
// to the copies only (the website is untouched):
//   1. Vercel's clean URLs (./rater, ./ams, …) are rewritten to the real
//      files (./rater.html, ./ams.html, …) because the bundled app has no
//      URL rewriting.
//   2. Service-worker registrations are removed; the native shell already
//      has the files on the device.
const fs = require('fs'); const path = require('path');
const root = path.resolve(__dirname, '..', '..'); const www = path.resolve(__dirname, '..', 'www');
const FILES = ['index.html', 'ams.html', 'dailysalesentry.html', 'transactionentry.html', 'healthentry.html', 'insured-portal.html', 'rater.html',
  'app.js', 'ams.js', 'rater.js', 'supabase.js', 'uib-theme.css', 'uib-motion.js', 'motion.js', 'lz-string.min.js', 'storage-codec.js',
  'icon.png', 'manifest.json', 'rater.webmanifest'];
const DIRS = ['icons'];
const pages = FILES.filter((f) => f.endsWith('.html')).map((f) => f.replace(/\.html$/, '')).filter((p) => p !== 'index');
fs.rmSync(www, { recursive: true, force: true }); fs.mkdirSync(www, { recursive: true });
for (const f of FILES) {
  const src = path.join(root, f); if (!fs.existsSync(src)) { console.warn('skip (missing): ' + f); continue; }
  if (/\.(html|js)$/.test(f)) {
    let t = fs.readFileSync(src, 'utf8');
    for (const p of pages) t = t.replace(new RegExp("(['\"])(\\./|/)" + p + "(['\"?#])", 'g'), '$1$2' + p + '.html$3');
    t = t.replace(/<script>if\('serviceWorker' in navigator\) navigator\.serviceWorker\.register\('\/sw\.js'\);<\/script>\n?/, '');
    t = t.replace(/if \('serviceWorker' in navigator\) \{ navigator\.serviceWorker\.register\([^)]*\)\.catch\(\(\) => \{\}\); \}/, '/* service worker not used in the native app */');
    fs.writeFileSync(path.join(www, f), t);
  } else fs.copyFileSync(src, path.join(www, f));
}
for (const d of DIRS) fs.cpSync(path.join(root, d), path.join(www, d), { recursive: true });
console.log('Copied ' + FILES.length + ' files and ' + DIRS.join(', ') + '/ into native/www (clean URLs rewritten to .html, service workers removed)');
