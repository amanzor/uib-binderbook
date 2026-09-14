#!/usr/bin/env python3
"""Off-site backup of the UIB Binder Book cloud data.

Downloads every key in the Supabase `app_store` table (except the app's own
rolling cloud snapshots, which are copies of the same data) into a dated
folder under backups/, one JSON file per key plus the full dump, and keeps the
last KEEP days. The backups/ folder is git-ignored; if it lives inside a
OneDrive/Dropbox-synced directory it is automatically off-site as well.

Run by hand:   python scripts/backup_cloud.py
Schedule it:   see the README section printed by  python scripts/backup_cloud.py --help-schedule

Reads the Supabase URL and anon key from supabase.js / app.js, so there is
nothing to configure. Read-only: it never writes to the cloud.
"""
import datetime as dt
import json
import os
import re
import shutil
import sys
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KEEP_DAYS = 60


def _const(name):
    for fn in ("supabase.js", "app.js"):
        try:
            src = open(os.path.join(ROOT, fn), encoding="utf-8").read()
        except OSError:
            continue
        m = re.search(r"const %s\s*=\s*'([^']+)'" % name, src)
        if m:
            return m.group(1)
    raise SystemExit("could not find %s in supabase.js/app.js" % name)


def main():
    if "--help-schedule" in sys.argv:
        print(__doc__)
        print("Windows Task Scheduler (daily at 7:00 PM), run in an Administrator or normal PowerShell:\n")
        print('  schtasks /Create /SC DAILY /ST 19:00 /TN "UIB Binder Book backup" '
              '/TR "python \\"%s\\"" /F' % os.path.join(ROOT, "scripts", "backup_cloud.py"))
        return

    url = _const("SUPABASE_URL")
    key = _const("SUPABASE_ANON_KEY")
    req = urllib.request.Request(
        url + "/rest/v1/app_store?select=key,value,updated_at&key=not.like.backupSnapshot*",
        headers={"apikey": key, "Authorization": "Bearer " + key},
    )
    with urllib.request.urlopen(req, timeout=300) as r:
        rows = json.load(r)

    stamp = dt.datetime.now().strftime("%Y-%m-%d")
    out = os.path.join(ROOT, "backups", stamp)
    os.makedirs(out, exist_ok=True)
    with open(os.path.join(out, "app_store_full.json"), "w", encoding="utf-8") as f:
        json.dump(rows, f, ensure_ascii=False)
    summary = []
    for row in sorted(rows, key=lambda r: r["key"]):
        k, v = row["key"], row["value"]
        safe = re.sub(r"[^A-Za-z0-9._-]+", "_", k)[:80]
        with open(os.path.join(out, safe + ".json"), "w", encoding="utf-8") as f:
            json.dump(v, f, ensure_ascii=False)
        n = len(v) if isinstance(v, (list, dict)) else "-"
        summary.append("%-34s items=%-6s chars=%9d updated=%s" % (k[:34], n, len(json.dumps(v, ensure_ascii=False)), str(row.get("updated_at", ""))[:19]))

    book = next((r["value"] for r in rows if r["key"] == "binderData"), [])
    ids = [e.get("id") for e in book] if isinstance(book, list) else []
    with open(os.path.join(out, "SUMMARY.txt"), "w", encoding="utf-8") as f:
        f.write("UIB Binder Book cloud backup  %s\n" % dt.datetime.now().isoformat(timespec="seconds"))
        f.write("keys: %d   binderData entries: %d   unique ids: %d\n\n" % (len(rows), len(ids), len(set(ids))))
        f.write("\n".join(summary) + "\n")
    print("backup written to %s  (keys=%d, policies=%d)" % (out, len(rows), len(ids)))

    # Rotate: keep the last KEEP_DAYS dated folders.
    bdir = os.path.join(ROOT, "backups")
    dated = sorted(d for d in os.listdir(bdir) if re.fullmatch(r"\d{4}-\d{2}-\d{2}", d))
    for d in dated[:-KEEP_DAYS]:
        shutil.rmtree(os.path.join(bdir, d), ignore_errors=True)


if __name__ == "__main__":
    main()
