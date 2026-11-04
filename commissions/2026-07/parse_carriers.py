"""Parse all seven July 2026 carrier statements into carriers.json.
Whole-agency statements; matching to the Doral book by policy number happens in
match_book.py. Amounts are taken exactly as each carrier prints them, with each
carrier's sign convention normalized so a chargeback is negative.

Booking rules (per office instruction, same as June):
  * United Auto  -> 10% AS COLLECTED (monthly), 3% promotional incentive excluded.
  * AmWins       -> 10% of NET CASH collected this month (monthly), not gross.
Each carrier's parsed total is printed against the figure the statement prints
so the read can be verified."""
import re, json
from pypdf import PdfReader


def money(s):
    """Accounting money: $, commas, (parens)=neg, trailing minus=neg."""
    s = str(s).strip().replace('$', '').replace(',', '')
    neg = (s.startswith('(') and s.endswith(')')) or s.endswith('-')
    s = s.replace('(', '').replace(')', '').rstrip('-').strip()
    if s in ('', '.'):
        return 0.0
    try:
        v = float(s)
    except ValueError:
        return 0.0
    return -v if neg else v


def pages(path):
    return [pg.extract_text() for pg in PdfReader(path).pages]


# ============ PROGRESSIVE ============
# Whole-agency PDF. The tran-code and producer wrap unpredictably across lines,
# so join the text and anchor on the amount signature
# ( date gross 0.00 0.00 billed <due> rate grossComm net PRODUCER ), pairing each
# with the nearest preceding 9-digit policy number. "Unassigned"-producer lines
# are real commission transactions and are kept; the lone Adjustment line
# (MVRChargeback, gross-comm 0.00) rides along at 0 and is tagged for the notes.
import bisect
prog = []
prog_adj = []
ptext = ' '.join(ln.rstrip() for t in pages('Progressive_Detailed_July_2026.pdf')
                 for ln in t.splitlines())
sig = re.compile(
    r'(?P<date>\d{2}/\d{2}/\d{4})\s+(?P<gross>-?[\d,]+\.\d{2})\s+0\.00\s+0\.00\s+'
    r'(?P<billed>-?[\d,]+\.\d{2})\s+[\d,.-]+\s+(?P<rate>[\d.]+)\s+'
    r'(?P<gc>-?[\d,]+\.\d{2})\s+(?P<net>-?[\d,]+\.\d{2})\s+(?P<prod>[A-Za-z]+)')
pols = [(m.start(), m.group()) for m in re.finditer(r'\b\d{9}\b', ptext)]
pstarts = [p[0] for p in pols]
for m in sig.finditer(ptext):
    idx = bisect.bisect_left(pstarts, m.start()) - 1
    policy = pols[idx][1] if idx >= 0 else ''
    rec = dict(policy=policy, date=m.group('date'), prem=money(m.group('gross')),
               rate=float(m.group('rate')), comm=money(m.group('gc')),
               net=money(m.group('net')), prod=m.group('prod'))
    if abs(rec['comm']) < 0.005 and rec['net'] < 0 and m.group('prod') == 'Unassigned':
        prog_adj.append(rec)          # MVRChargeback-type statement adjustment
    prog.append(rec)
psum = round(sum(p['comm'] for p in prog), 2)
padj = round(sum(a['net'] for a in prog_adj), 2)
print(f"PROGRESSIVE : {len(prog):4} txns  comm {psum:>11,.2f}   (stmt AGENT TOTAL current 17,885.65)"
      + (f"   [+ MVR adj {padj:,.2f}]" if prog_adj else ""))

# ============ KEMPER (Infinity) ============
kem = []
kraw = "\n".join(pages('Kemper_Infinity_July_2026.pdf')).splitlines()
kjoined = []
for ln in kraw:
    if re.match(r'^\d+-\d+\s', ln):
        kjoined.append(ln)
    elif kjoined and not re.search(r'-?\$?[\d,]+\.\d{2}\s*$', kjoined[-1]) \
            and not re.match(r'^\d+-\d+\s', ln):
        kjoined[-1] += ' ' + ln.strip()
    else:
        kjoined.append(ln)
kline = re.compile(
    r'^(?P<acct>\d+-\d+)\s+(?P<name>.+?)\s+(?P<date>\d{2}/\d{2}/\d{4})\s+'
    r'(?P<act>\S+)\s+0\.1\s+(?P<prem>-?\$?[\d,]+\.\d{2})\s+'
    r'\$?[\d,.-]+\s+\$?[\d,.-]+\s+\$?[\d,.-]+\s+(?P<net>-?\$?[\d,]+\.\d{2})\s*$')
for ln in kjoined:
    m = kline.match(ln.strip())
    if m:
        kem.append(dict(policy=m.group('acct').split('-')[0], acct=m.group('acct'),
                        name=m.group('name').strip(), date=m.group('date'),
                        act=m.group('act'), prem=money(m.group('prem')),
                        comm=money(m.group('net'))))
ksum = round(sum(k['comm'] for k in kem), 2)
print(f"KEMPER      : {len(kem):4} txns  comm {ksum:>11,.2f}   (stmt FL COMMISSION TOTAL 3,714.35)")

# ============ NATIONAL GENERAL ============
ng = []
ngflat = re.sub(r'\s+', ' ', "\n".join(pages('National_General_July_2026.pdf')))
ng_re = re.compile(
    r'(?P<pol>\d{10})\s+\d+\s+PPA\s+\w+\s+(?:Personal|PPA)\s*(?:Auto|Value)?\s+FL\s+'
    r'(?P<insured>.+?)\s+(?P<eff>\d{1,2}/\d{1,2}/\d{4})\s+'
    r'(?P<tt>New Business|Renew|Cancel|Endorsement|Uncollected Premium|Reinstatement)\s+'
    r'(?P<prem>\(?-?\$?[\d,]+\.\d{2}\)?)\s+(?P<rate>\d+)\s+(?P<comm>\(?-?\$?[\d,]+\.\d{2}\)?)')
for m in ng_re.finditer(ngflat):
    ng.append(dict(policy=m.group('pol'), name=m.group('insured').strip(),
                   eff=m.group('eff'), tran=m.group('tt'),
                   prem=money(m.group('prem')), rate=int(m.group('rate')),
                   comm=money(m.group('comm'))))
ngsum = round(sum(x['comm'] for x in ng), 2)
print(f"NATIONAL GEN: {len(ng):4} txns  comm {ngsum:>11,.2f}   (stmt Grand Total 658.32)")

# ============ OCEAN HARBOR (Pearl) ============
oh = []
for ln in "\n".join(pages('Ocean_Harbor_July_2026.pdf')).splitlines():
    m = re.match(
        r'^(?P<name>[A-Z].+?,\s*[A-Z].*?)\s+(?P<pol>P\d{12})\s+(?P<eff>\d{2}/\d{2}/\d{4})\s+'
        r'(?P<act>NEW|REN|CANC|REI|END)\s+(?P<rest>.+)$', ln.strip())
    if not m:
        continue
    nums = re.findall(r'-?\$?[\d,]+\.\d{2}', m.group('rest'))
    rate = re.search(r'([\d.]+)%', m.group('rest'))
    if len(nums) >= 2:
        oh.append(dict(policy=m.group('pol'), name=m.group('name').strip(),
                       eff=m.group('eff'), act=m.group('act'),
                       prem=money(nums[0]), comm=money(nums[1]),
                       fee=money(nums[2]) if len(nums) > 2 else 0.0,
                       rate=float(rate.group(1)) if rate else 0.0))
ohsum = round(sum(x['comm'] for x in oh), 2)
print(f"OCEAN HARBOR: {len(oh):4} txns  comm {ohsum:>11,.2f}   (stmt Commission Due 250.08)")

# ============ GEICO ============
gc = []
gflat = re.sub(r'\s+', ' ', "\n".join(pages('GEICO_July_2026.pdf')))
g_re = re.compile(
    r'(?P<policy>\d{10})-\s*\d+\s+(?P<insured>.+?)\s+'
    r'(?P<eff>\d{2}/\d{2}/\d{4})\s+\d{2}/\d{2}/\d{4}\s+\d{2}/\d{2}/\d{4}\s+'
    r'(?P<cp>\(?-?\$?[\d,]+\.\d{2}\)?)\s+(?P<rate>[\d.]+)%\s+'
    r'(?:[A-D]\s+)?(?:Voluntary\s+|Involuntary\s+)?'
    r'(?P<comm>\(?-?\$?[\d,]+\.\d{2}\)?)\s+GEICO')
for m in g_re.finditer(gflat):
    gc.append(dict(policy=m.group('policy'), name=m.group('insured').strip(),
                   eff=m.group('eff'), rate=float(m.group('rate')),
                   prem=money(m.group('cp')), comm=money(m.group('comm'))))
gcsum = round(sum(x['comm'] for x in gc), 2)
print(f"GEICO       : {len(gc):4} txns  comm {gcsum:>11,.2f}   (stmt Commissions 9,009.15)")

# ============ UNITED AUTO ============
# Trans line: 01 UAx -nnnnnnnnn  date  [*R]  DESCRIPTION  Insured  premium  comm-  due-  pct
# United prints the commission the agent EARNS with a trailing minus (a credit);
# a chargeback prints positive. Normalize so earned>0, chargeback<0: earned = -printed.
un = []
u_re = re.compile(
    r'^01\s+(?P<pol>UA[A-Z]\s*-?\s*\d+)\s+(?P<date>\d{2}/\d{2}/\d{2})\s+'
    r'(?:\*R\s+)?(?P<desc>COMM AS COLLECTED|CANCEL \(PRORATE\)|ENDORSEMENT|REINSTATE|NEW BUSINESS)\s+'
    r'(?P<name>.+?)\s+(?P<prem>-?[\d,]+\.\d{2}-?|\.00)\s+'
    r'(?P<comm>-?[\d,]*\.\d{2}-?|\.00)\s+(?P<due>-?[\d,]*\.\d{2}-?|\.00)\s+(?P<pct>[\d.]+)\s*$')
p_re = re.compile(
    r'^(?P<date>\d{2}/\d{2}/\d{2})\s+PROMOTIONAL INCENTIVE\s+(?P<name>.+?)\s+'
    r'(?P<prem>-?[\d,]+\.\d{2}-?|\.00)\s+(?P<comm>-?[\d,]*\.\d{2}-?|\.00)\s+'
    r'(?P<due>-?[\d,]*\.\d{2}-?|\.00)\s+(?P<pct>[\d.]+)\s*$')
for ln in "\n".join(pages('United_Auto_July_2026.pdf')).splitlines():
    s = ln.strip()
    m = u_re.match(s)
    if m:
        pol = re.sub(r'\s+', '', m.group('pol'))
        un.append(dict(policy=pol, name=m.group('name').strip(), date=m.group('date'),
                       desc=m.group('desc'), prem=money(m.group('prem')),
                       comm=-money(m.group('comm')), rate=float(m.group('pct')),
                       promo=False))
        continue
    mp = p_re.match(s)
    if mp:
        un.append(dict(policy='', name=mp.group('name').strip(), date=mp.group('date'),
                       desc='PROMOTIONAL INCENTIVE', prem=money(mp.group('prem')),
                       comm=-money(mp.group('comm')), rate=float(mp.group('pct')),
                       promo=True))
un_main = [u for u in un if not u['promo']]
un_promo = [u for u in un if u['promo']]
usum = round(sum(u['comm'] for u in un_main), 2)
upromo = round(sum(u['comm'] for u in un_promo), 2)
print(f"UNITED AUTO : {len(un_main):4} txns  comm {usum:>11,.2f} (10% as collected)  + promo(excl) {upromo:,.2f}")

# ============ AMWINS ============
aw = []
a_re = re.compile(
    r'^(?P<agent>\d{6})\s+(?P<pol>\S+)\s+(?P<eff>\d{2}/\d{2}/\d{4})\s+(?P<name>.+?)\s+'
    r'\$(?P<prem>[\d,]+\.\d{2})\s+\$(?P<gross>[\d,]+\.\d{2})\s+\$(?P<fees>[\d,]+\.\d{2})\s+'
    r'\$(?P<net>[\d,]+\.\d{2})\s+(?P<type>\w)\s+(?P<pct>\d+)%\s+\$(?P<comm>[\d,]+\.\d{2})')
for ln in "\n".join(pages('AmWins_July_2026.pdf')).splitlines():
    m = a_re.match(ln.strip())
    if m:
        aw.append(dict(policy=m.group('pol'), name=m.group('name').strip(),
                       eff=m.group('eff'), prem=money(m.group('prem')),
                       gross_cash=money(m.group('gross')), net_cash=money(m.group('net')),
                       rate=int(m.group('pct')) / 100.0, comm=money(m.group('comm'))))
awsum = round(sum(a['comm'] for a in aw), 2)
print(f"AMWINS      : {len(aw):4} txns  comm {awsum:>11,.2f}   (stmt AGENCY TOTAL 78.74; 10% of net cash)")

json.dump(dict(progressive=prog, kemper=kem, national=ng, ocean=oh, geico=gc,
               united=un, amwins=aw),
          open('carriers.json', 'w'), indent=1, default=str)
print("\nwrote carriers.json")
