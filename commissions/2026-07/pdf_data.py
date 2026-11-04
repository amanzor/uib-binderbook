"""Assemble the numbers behind the two July 2026 PDF statements.

New Business / Renewals split follows the July binder sheet; wider-book matched
activity (endorsements, cancellations, as-collected commission on earlier
business) folds into Renewals & Adj.; carrier-charged MVR/fee costs are pulled
out into the MVRs operating-expense line so they are not counted twice.

United Auto = 10% as collected, 3% promotional incentive excluded.
AmWins      = 10% of net cash collected this month.
Both are booked on the monthly as-collected basis, not on gross written premium.
"""
import json, re, collections

BINDER = json.load(open('binder.json'))
_bm = json.load(open('bookmatch.json'))
BM = _bm['matched']
UNMATCHED = _bm['unmatched']
# Ocean Harbor is Doral's own producer-6883 statement, so record every line it
# prints — including transactions whose policy number is not yet in the binder
# book — so the Ocean Harbor section foots to the statement's $250.08.
RECORD_UNMATCHED_CARRIERS = {'Ocean Harbor'}

ORDER = ['Progressive', 'United Auto', 'Infinity', 'National General', 'GEICO', 'AmWins', 'Ocean Harbor']
LABEL = {'Progressive': 'PROGRESSIVE', 'United Auto': 'UNITED AUTO', 'Infinity': 'INFINITY',
         'National General': 'NATIONAL GENERAL', 'GEICO': 'GEICO', 'AmWins': 'AMWINS',
         'Ocean Harbor': 'OCEAN HARBOR'}
# binder 'Company' -> carrier name used on the statements
CO2CARRIER = {'progressive': 'Progressive', 'united auto': 'United Auto', 'infinity': 'Infinity',
              'national general': 'National General', 'geico': 'GEICO', 'ocean harbor': 'Ocean Harbor',
              'amwins': 'AmWins'}


def norm(p):
    p = re.sub(r'[^A-Z0-9]', '', str(p).upper())
    m = re.match(r'^([A-Z]*)(\d*)$', p)
    return m.group(1) + m.group(2).lstrip('0') if m and m.group(2) else p


def keys(carrier, policy):
    p = str(policy).strip()
    out = {norm(p)}
    if carrier == 'National General':
        out.add(norm(p.split()[0]))
    if carrier == 'GEICO':
        out.add(norm(p.split('-')[0]))
    d = re.sub(r'[^0-9]', '', p)
    if d and len(d) > 10:
        out.add(d[:10])
    return {k for k in out if k}


# --- index the binder sheet by policy keys ---
binder_idx = {}
for b in BINDER:
    carr = CO2CARRIER.get(b['company'].strip().lower(), b['company'])
    for k in keys(carr, b['policy']):
        binder_idx.setdefault((carr, k), b['row'])
    # also index bare policy so a carrier line still finds it if company label differs
    for k in keys(carr, b['policy']):
        binder_idx.setdefault(('*', k), b['row'])

binder_by_row = {b['row']: b for b in BINDER}
binder_comm = collections.defaultdict(float)   # binder row -> commission
wider = collections.defaultdict(float)          # (carrier, book_policy) -> commission
wider_name = {}

for t in BM:
    if t['promo']:
        continue
    carr = t['carrier']
    row = None
    if t['in_binder']:
        for k in keys(carr, t['policy']):
            if (carr, k) in binder_idx:
                row = binder_idx[(carr, k)]
                break
            if ('*', k) in binder_idx:
                row = binder_idx[('*', k)]
                break
    if row is not None:
        binder_comm[row] += t['comm']
    else:
        key = (carr, norm(t['policy']))
        wider[key] += t['comm']
        wider_name[key] = t['book_name']

# --- build per-carrier rows: binder policies first (new/ren), then wider-book ---
rows = collections.defaultdict(list)   # carrier -> [(name, amount, bucket)]
for b in BINDER:
    carr = CO2CARRIER.get(b['company'].strip().lower(), b['company'])
    amt = round(binder_comm.get(b['row'], 0.0), 2)
    bucket = 'new' if b['section'] == 'New' else 'ren'
    rows[carr].append((b['name'], amt, bucket))
for (carr, _pol), v in wider.items():
    rows[carr].append((wider_name[(carr, _pol)], round(v, 2), 'ren'))

# record whole-statement carriers (Ocean Harbor) in full, as the statement shows
for t in UNMATCHED:
    if t.get('promo') or t['carrier'] not in RECORD_UNMATCHED_CARRIERS:
        continue
    rows[t['carrier']].append((t['name'], round(t['comm'], 2), 'ren'))

# --- carrier-charged MVR / fee adjustments (operating-expense "MVRs" line) ---
# Only costs on Doral's OWN carrier statements count; whole-agency fees do not.
ADJ = [
    dict(carrier='Ocean Harbor', name='TELLES DA SILVA, D', ttype='MVR Cost', amt=-8.36, doral=True,
         basis="On Doral's own Pearl statement (producer 6883); name abbreviated, not confidently in book"),
    dict(carrier='Infinity', name='UW Reports fees (FL-23, FL-90)', ttype='Fee', amt=-42.15, doral=False,
         basis='Agency-level fee on the whole-agency Kemper statement (Universal Brokers); names no insured'),
    dict(carrier='Progressive', name='MVR Chargeback', ttype='MVR Chargeback', amt=-6.40, doral=False,
         basis='Agency-level adjustment on the whole-agency Progressive statement; producer Unassigned'),
]
adj_total = round(sum(a['amt'] for a in ADJ if a['doral']), 2)
adj_parts = [(c, round(sum(a['amt'] for a in ADJ if a['doral'] and a['carrier'] == c), 2))
             for c in ORDER if any(a['doral'] and a['carrier'] == c for a in ADJ)]

# --- summary by carrier ---
summary = []
gt_new = gt_ren = 0.0
for co in ORDER:
    n = round(sum(x[1] for x in rows[co] if x[2] == 'new'), 2)
    r = round(sum(x[1] for x in rows[co] if x[2] == 'ren'), 2)
    summary.append((co, n, r, round(n + r, 2)))
    gt_new += n
    gt_ren += r
gross = round(gt_new + gt_ren, 2)

print(f"{'Carrier':18}{'New Business':>14}{'Renewals & Adj':>16}{'Total':>12}")
for co, n, r, t in summary:
    print(f"  {co:16}{n:>14,.2f}{r:>16,.2f}{t:>12,.2f}")
print(f"  {'TOTAL':16}{gt_new:>14,.2f}{gt_ren:>16,.2f}{gross:>12,.2f}")
print(f"\nDoral MVRs / statement adjustments: {adj_total:,.2f}  parts={adj_parts}")
print(f"Binder policies with $0 (no carrier line this month): "
      f"{sum(1 for b in BINDER if round(binder_comm.get(b['row'],0),2)==0)}")

json.dump(dict(summary=summary, rows={k: v for k, v in rows.items()}, gross=gross,
               adj_total=adj_total, adj_parts=adj_parts, adj=ADJ,
               gt_new=round(gt_new, 2), gt_ren=round(gt_ren, 2), order=ORDER, label=LABEL),
          open('pdf_data.json', 'w'), indent=1)
