"""Build the ranked candidate list: names on the June-2026 PDFs that also appear
on Jorge Castro's June 2026 commission."""
import collections, json, re
from names import FORMATS, split, surname_agrees, given_agrees, tok_match, money

# ── Jorge Castro's June 2026 commission universe ──────────────
jorge = []
for j in json.load(open('jorge_june.json')):
    src = 'United Auto statement' if j['carrier'] == 'United Auto' else 'Ocean Harbor statement'
    jorge.append({'name': j['name'], 'src': src, 'policy': j['policy'], 'amt': j['comm'] or 0})
for b in json.load(open('raw_binderData.json'))[0]['value']:
    if (b.get('agent') or '') == 'Jorge Castro' and (b.get('entryDate') or '').startswith('2026-06'):
        jorge.append({'name': b.get('customerName'), 'src': 'Binder book (his own June entry)',
                      'policy': b.get('policyNumber') or '', 'amt': b.get('agentCommissionShare') or 0})

pdfs = json.load(open('pdf_rows.json'))

# ── Surname rarity, measured on the PDF side ──────────────────
pdf_people = sorted({(p['carrier'], p['name']) for p in pdfs})
pdf_surnames = {(c, n): split(n, FORMATS[c])[0] for c, n in pdf_people}


def rarity(tokens):
    """How many distinct PDF insureds share one of these surnames."""
    return sum(1 for k in pdf_people
               if any(tok_match(a, b) for a in tokens for b in pdf_surnames[k]))


def digits(s):
    return re.sub(r'\D', '', s or '')


# ── Pair up ───────────────────────────────────────────────────
pairs = {}
for p in pdfs:
    ps, pg = split(p['name'], FORMATS[p['carrier']])
    pd = digits(p.get('policy'))

    for j in jorge:
        js, jg = split(j['name'], FORMATS[j['src']])
        jd = digits(j['policy'])
        sur = surname_agrees(js, ps)
        giv = given_agrees(jg, pg)
        pol = bool(jd and pd and len(jd) >= 8 and len(pd) >= 8 and (jd in pd or pd in jd))
        # Cross hits (a surname on one side matching a given name on the other)
        # are pure coincidence, so a pair needs a real surname or policy hit.
        if not sur and not pol:
            continue

        key = (p['carrier'], p['name'], j['name'], j['src'])
        rec = pairs.setdefault(key, {
            'carrier': p['carrier'], 'file': p['file'], 'pdf_name': p['name'],
            'j_name': j['name'], 'j_src': j['src'],
            'pdf_rows': 0, 'pdf_amt': 0.0, 'pdf_pol': set(), 'dates': set(),
            'producer': set(), 'sur': sur, 'giv': giv, 'pol': pol,
            'shared': sorted({a for a in js for b in ps if tok_match(a, b)}),
            'rare': rarity(js)})
        rec['pdf_rows'] += 1
        rec['pdf_amt'] += money(p['commission'])
        if p.get('policy'):
            rec['pdf_pol'].add(p['policy'])
        if p.get('date'):
            rec['dates'].add(p['date'])
        prod = ' '.join((p.get('producer') or '').split())
        if prod:
            rec['producer'].add(prod)
        rec['pol'] |= pol

# Jorge-side totals per person.
jtot, jrows, jpols = collections.defaultdict(float), collections.Counter(), collections.defaultdict(set)
for j in jorge:
    k = (j['name'], j['src'])
    jtot[k] += j['amt']
    jrows[k] += 1
    if j['policy']:
        jpols[k].add(j['policy'])


def classify(r):
    if r['pol']:
        return 'A', 'CONFIRMED - same policy number on both sides'
    if r['giv'] is True:
        return 'B', 'Likely the same person - surname and first name both agree'
    if r['giv'] is None:
        return 'C', 'Surname agrees; first name not shown on one side - check manually'
    if r['rare'] <= 1:
        return 'C', 'Same uncommon surname, different first name - possible relative/same household'
    return 'D', 'Common surname only, first names differ - most likely a different person'


rows = []
for r in pairs.values():
    tier, note = classify(r)
    k = (r['j_name'], r['j_src'])
    rows.append({
        'tier': tier, 'note': note,
        'pdf_name': r['pdf_name'], 'carrier': r['carrier'], 'file': r['file'],
        'pdf_rows': r['pdf_rows'], 'pdf_amt': round(r['pdf_amt'], 2),
        'pdf_pol': ', '.join(sorted(r['pdf_pol']))[:44],
        'dates': ', '.join(sorted(r['dates'])[:2]),
        'producer': ', '.join(sorted(r['producer']))[:34],
        'j_name': r['j_name'], 'j_src': r['j_src'],
        'j_pol': ', '.join(sorted(jpols[k]))[:44],
        'j_rows': jrows[k], 'j_amt': round(jtot[k], 2),
        'matched_on': 'Policy number' if r['pol'] else ' + '.join(r['shared']),
    })

rows.sort(key=lambda r: (r['tier'], r['j_name'], r['carrier'], r['pdf_name']))
json.dump(rows, open('final_rows.json', 'w'), indent=1)

print(f'{len(rows)} candidate pairs')
for t in 'ABCD':
    sel = [r for r in rows if r['tier'] == t]
    print(f'\n--- Tier {t}: {len(sel)}')
    for r in sel:
        print(f"  {r['carrier']:22} {r['pdf_name']:30} <-> {r['j_name']:24} "
              f"[{r['j_src'][:21]:21}] on {r['matched_on']}")
