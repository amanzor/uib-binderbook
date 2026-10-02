"""Pull one month's commission-statement PDFs and the matching BinderBook data
out of Supabase, into ./pdfs and ./raw_*.json.

The app files commission-statement PDFs under the Documents section using the
client key MonthlyDocs_<year>_<Month> (see mdocClientKey() in app.js), so that
is all we need to find a month's uploads.

    python fetch.py 2026 June [AgentName]
"""
import json, os, subprocess, sys, urllib.parse

SUPABASE_URL = 'https://jgjmobktucyimupelfxd.supabase.co'
# Same anon key the app ships with (app.js) — read-only usage here.
ANON = os.environ.get('SUPABASE_ANON_KEY') or (
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impnam1v'
    'Ymt0dWN5aW11cGVsZnhkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI5NDAxMDYsImV4cCI6MjA5'
    'ODUxNjEwNn0.5vClAeHl-Cgo6QH4IW3oDHKQn_DKB3DZef9bN9IP0XQ')
HDR = ['-H', f'apikey: {ANON}', '-H', f'Authorization: Bearer {ANON}']


def curl(url, out=None):
    cmd = ['curl', '-sS', '-m', '180', *HDR, url]
    if out:
        cmd += ['-o', out]
        subprocess.run(cmd, check=True)
        return None
    return subprocess.run(cmd, capture_output=True, text=True, check=True).stdout


def main(year, month):
    key = f'MonthlyDocs_{year}_{month}'
    docs = json.loads(curl(
        f'{SUPABASE_URL}/rest/v1/documents?select=id,file_name,storage_path,size_bytes,'
        f'uploaded_at&client_key=eq.{key}&order=uploaded_at.desc'))
    os.makedirs('pdfs', exist_ok=True)
    print(f'{len(docs)} document(s) filed under {key}')
    seen = {}
    for i, d in enumerate(docs, 1):
        path = d['storage_path']
        url = (f'{SUPABASE_URL}/storage/v1/object/client-files/'
               + '/'.join(urllib.parse.quote(s) for s in path.split('/')))
        dest = f"pdfs/{i:02d}_{d['file_name'].replace(' ', '_')}"
        curl(url, dest)
        dup = seen.get(d['size_bytes'])
        seen.setdefault(d['size_bytes'], dest)
        print(f"  {dest}  {d['size_bytes']:>8} bytes  {d['uploaded_at'][:10]}"
              + (f'   (same size as {dup} - check for a duplicate upload)' if dup else ''))

    for store_key in ('binderData', 'commissionStatements'):
        curl(f'{SUPABASE_URL}/rest/v1/app_store?select=value&key=eq.{store_key}',
             f'raw_{store_key}.json')
        print(f'  raw_{store_key}.json')


def jorge_slice(agent, month_label):
    """Write jorge_june.json: the statement entries credited to `agent` that month."""
    cs = json.load(open('raw_commissionStatements.json'))[0]['value']
    rows = []
    for stmt in cs.values():
        if not str(stmt.get('month', '')).startswith(month_label):
            continue
        for e in stmt.get('entries') or []:
            if (e.get('agentMatch') or '') == agent:
                rows.append({'stmt': stmt.get('sheetName'), 'carrier': e.get('carrier'),
                             'name': e.get('clientName') or e.get('customerName'),
                             'policy': e.get('policyNumber'), 'comm': e.get('commission'),
                             'tran': e.get('transaction')})
    json.dump(rows, open('jorge_june.json', 'w'), indent=1)
    print(f'{len(rows)} statement rows credited to {agent} in {month_label} '
          f'({len({r["name"] for r in rows})} distinct insureds)')


if __name__ == '__main__':
    yr = sys.argv[1] if len(sys.argv) > 1 else '2026'
    mo = sys.argv[2] if len(sys.argv) > 2 else 'June'
    who = sys.argv[3] if len(sys.argv) > 3 else 'Jorge Castro'
    main(yr, mo)
    jorge_slice(who, f'{mo} {yr}')
