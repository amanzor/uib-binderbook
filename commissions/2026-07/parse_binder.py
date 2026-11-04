"""Extract the July 2026 Doral binder sheet (producer Jorge Castro) from the
office binder book workbook. Output: binder.json — one record per policy on the
'JULY 26 ' tab, split into New Business and Renewals, mirroring June's method.
Matching against carrier statements is done later by policy number."""
import openpyxl, json, re, datetime

SRC = "Doral_Office_Binder_Book.xlsx"
TAB = "JULY 26 "


def norm(p):
    """Normalize a policy number for matching: upper, strip non-alnum, drop
    leading zeros on the numeric tail (carriers pad/suffix differently)."""
    p = re.sub(r'[^A-Z0-9]', '', str(p).upper())
    m = re.match(r'^([A-Z]*)(\d*)$', p)
    if m and m.group(2):
        return m.group(1) + m.group(2).lstrip('0')
    return p


def s(v):
    if v is None:
        return ''
    if isinstance(v, datetime.datetime):
        return v.strftime('%m/%d/%Y')
    if isinstance(v, float):
        return ('%.2f' % v).rstrip('0').rstrip('.') if v != int(v) else str(int(v))
    return str(v).strip()


def num(v):
    try:
        return float(str(v).replace(',', '').replace('$', '').strip())
    except (ValueError, AttributeError):
        return 0.0


wb = openpyxl.load_workbook(SRC, data_only=True)
ws = wb[TAB]

records = []
section = None            # 'New' / 'Renewal'
section_note = ''
for i, r in enumerate(ws.iter_rows(min_row=1, values_only=True), 1):
    r = list(r) + [''] * 20
    prod, name, status, typ, lob, co = (s(r[0]), s(r[1]), s(r[2]),
                                        s(r[3]), s(r[4]), s(r[5]))
    base, total, term, eff, pol = s(r[9]), s(r[10]), s(r[11]), s(r[12]), s(r[13])
    phone, email = s(r[14]), s(r[15])

    low = name.lower()
    if low == 'customer name' or name.startswith('Doral Universal'):
        continue
    # section-note rows: text in the name column but no policy/company
    if name and not pol and not co:
        section_note = name
        continue
    # subtotal rows: a base number but no name
    if not name:
        continue
    if not pol:
        continue

    t = typ.lower()
    if 'renew' in t:            # test 'renew' first: 'new' is a substring of 'renewal'
        section = 'Renewal'
    elif 'new' in t:
        section = 'New'

    records.append(dict(
        row=i, section=section, section_note=section_note if section == 'Renewal' else '',
        producer=prod, name=name, status=status, type=typ, lob=lob, company=co,
        base_premium=num(base), total_premium=num(total), term=term,
        eff_date=eff, policy=pol, key=norm(pol), phone=phone, email=email,
    ))

json.dump(records, open('binder.json', 'w'), indent=1)

new = [x for x in records if x['section'] == 'New']
ren = [x for x in records if x['section'] == 'Renewal']
print(f"JULY 26 binder sheet: {len(records)} policies "
      f"({len(new)} new, {len(ren)} renewals)")
print(f"  New Business base premium total:   {sum(x['base_premium'] for x in new):,.2f}")
print(f"  New Business total premium:        {sum(x['total_premium'] for x in new):,.2f}")
print(f"  Renewal total premium:             {sum(x['total_premium'] for x in ren):,.2f}")

blank = [x for x in records if not x['producer']]
if blank:
    print(f"\n  Rows with NO producer listed ({len(blank)}):")
    for x in blank:
        print(f"    row {x['row']}: {x['name']} | {x['company']} | {x['policy']} | eff {x['eff_date']}")

canc = [x for x in records if x['status'].lower() in ('canceled', 'cancelled', 'pending')]
if canc:
    print(f"\n  Canceled / pending ({len(canc)}):")
    for x in canc:
        print(f"    {x['status']:9} {x['name']} | {x['company']} | {x['policy']} | total {x['total_premium']:.2f}")

print("\n  By company:")
comp = {}
for x in records:
    comp.setdefault(x['company'], [0, 0.0])
    comp[x['company']][0] += 1
    comp[x['company']][1] += x['total_premium']
for c, (n, prem) in sorted(comp.items(), key=lambda kv: -kv[1][1]):
    print(f"    {c:20} {n:3} policies  ${prem:,.2f} premium")
