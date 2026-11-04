"""Match every July 2026 carrier-statement transaction to the Doral book by
policy number, exactly as June did. Each transaction is tagged:
  * matched to the Doral book (else it belongs to another office and is dropped)
  * whether the matched policy is on the July binder sheet (New/Renewal) or is
    wider-book activity (endorsement / cancellation / as-collected on earlier
    business)
  * a surname cross-check between the statement insured and the book customer
United Auto is booked 10% as collected with the 3% promotional incentive
excluded; those promo lines are tagged and never counted."""
import json, re, unicodedata, collections

BOOK = json.load(open('book_all.json'))
C = json.load(open('carriers.json'))
BINDER = json.load(open('binder.json'))


def norm(p):
    p = re.sub(r'[^A-Z0-9]', '', str(p).upper())
    m = re.match(r'^([A-Z]*)(\d*)$', p)
    return m.group(1) + m.group(2).lstrip('0') if m and m.group(2) else p


def nm(s):
    s = unicodedata.normalize('NFKD', str(s).upper())
    return re.sub(r'[^A-Z ]', ' ', s)


STOP = {'DE', 'LA', 'DEL', 'JR', 'SR', 'II', 'III', 'MR', 'MRS', 'LLC', 'INC',
        'THE', 'AND', 'CORP', 'CO', 'MD', 'PA'}


def toks(s):
    return {t for t in nm(s).split() if len(t) > 2 and t not in STOP}


# book index: policy key -> rows (plus 10-digit prefix and first-token variants)
bidx = collections.defaultdict(list)
for r in BOOK:
    bidx[r['key']].append(r)
    p = re.sub(r'[^A-Z0-9]', '', r['policy'].upper())
    if p.isdigit() and len(p) > 10:
        bidx[p[:10]].append(r)
    first = re.split(r'[\s\-]', r['policy'].strip())[0]
    if first and norm(first) != r['key']:
        bidx[norm(first)].append(r)

binder_pol = {norm(b['policy']) for b in BINDER}


def keys_for(carrier, policy):
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


TX = []


def add(carrier, policy, name, ttype, tdate, prem, rate, comm, promo=False):
    TX.append(dict(carrier=carrier, policy=str(policy), name=name, ttype=ttype,
                   tdate=tdate, prem=prem, rate=rate, comm=comm, promo=promo))


for p in C['progressive']:
    add('Progressive', p['policy'], '', 'Transaction', p['date'], p['prem'], p['rate'], p['comm'])
for k in C['kemper']:
    add('Infinity', k['acct'], k['name'], k['act'], k['date'], k['prem'], 0.10, k['comm'])
for g in C['geico']:
    add('GEICO', g['policy'], g['name'], 'Commission', g['eff'], g['prem'], g['rate'] / 100.0, g['comm'])
for u in C['united']:
    add('United Auto', u['policy'], u['name'], u['desc'], u['date'], u['prem'],
        u['rate'] / 100.0, u['comm'], promo=u['promo'])
for o in C['ocean']:
    add('Ocean Harbor', o['policy'], o['name'], o['act'], o['eff'], o['prem'], o['rate'] / 100.0, o['comm'])
for g in C['national']:
    add('National General', g['policy'], g['name'], g['tran'], g['eff'], g['prem'], g['rate'] / 100.0, g['comm'])
for a in C['amwins']:
    add('AmWins', a['policy'], a['name'], 'Commission', a['eff'], a['net_cash'], a['rate'], a['comm'])

matched = []
unmatched = []
namebad = []
for t in TX:
    hits = []
    for k in keys_for(t['carrier'], t['policy']):
        hits += bidx.get(k, [])
    seen = set()
    rows = []
    for h in hits:
        i = (h['sheet'], h['row'])
        if i not in seen:
            seen.add(i)
            rows.append(h)
    if not rows:
        unmatched.append(t)
        continue
    best = sorted(rows, key=lambda x: x['sheet'])[-1]
    ok = bool(toks(t['name']) & toks(best['name'])) or not toks(t['name'])
    t['book_name'] = best['name']
    t['book_sheet'] = best['sheet']
    t['book_policy'] = best['policy']
    t['book_co'] = best['co']
    t['name_ok'] = ok
    t['in_binder'] = norm(t['policy']) in binder_pol or any(norm(r['policy']) in binder_pol for r in rows)
    matched.append(t)
    if not ok:
        namebad.append(t)

print(f"transactions total {len(TX)}")
print(f"  matched to Doral book              : {len(matched)}")
print(f"  of which on the July binder sheet  : {sum(1 for t in matched if t['in_binder'])}")
print(f"  wider-book (matched, not binder)   : {sum(1 for t in matched if not t['in_binder'])}")
print(f"  not in Doral book (other offices)  : {len(unmatched)}")
print(f"  surname-mismatch flags             : {len(namebad)}")
print()
print(f"  {'carrier':18}{'matched':>9}{'binder':>8}{'wider':>7}{'comm(all matched)':>20}")
for c in ['Progressive', 'Infinity', 'United Auto', 'Ocean Harbor', 'National General', 'AmWins', 'GEICO']:
    mm = [t for t in matched if t['carrier'] == c and not t['promo']]
    b = [t for t in mm if t['in_binder']]
    w = [t for t in mm if not t['in_binder']]
    print(f"  {c:18}{len(mm):>9}{len(b):>8}{len(w):>7}{sum(x['comm'] for x in mm):>20,.2f}")

if namebad:
    print("\n--- SURNAME MISMATCHES (statement insured vs book customer) ---")
    for t in namebad:
        print(f"  {t['carrier']:16}{t['policy']:18}stmt={t['name'][:24]:26}book={t['book_name'][:24]:26}{t['book_sheet']}")

json.dump(dict(matched=matched, unmatched=unmatched), open('bookmatch.json', 'w'), indent=1)
