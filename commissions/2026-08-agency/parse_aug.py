import re, json, bisect, sys
from pypdf import PdfReader
P = sys.argv[1]
def money(s):
    s=str(s).strip().replace('$','').replace(',','')
    neg=(s.startswith('(') and s.endswith(')')) or s.endswith('-') or s.startswith('-')
    s=s.strip('()-').strip()
    if s in ('','.'): return 0.0
    v=float(s); return -v if neg else v
pages=lambda f:[pg.extract_text() for pg in PdfReader(f).pages]
out={}
# PROGRESSIVE
pt=' '.join(ln.rstrip() for t in pages(P+'/06_Progressive_August.pdf') for ln in t.splitlines())
sig=re.compile(r'(?P<date>\d{2}/\d{2}/\d{4})\s+(?P<gross>-?[\d,]+\.\d{2})\s+(?P<dpc>-?[\d,]+\.\d{2})\s+(?P<dps>-?[\d,]+\.\d{2})\s+(?P<billed>-?[\d,]+\.\d{2})\s+[\d,.-]+\s+(?P<rate>[\d.]+)\s+(?P<gc>-?[\d,]+\.\d{2})\s+(?P<net>-?[\d,]+\.\d{2})')
pols=[(m.start(),m.group()) for m in re.finditer(r'\b\d{9}\b',pt)]; ps=[p[0] for p in pols]
CODES=['New Business','Renewal','Endorsement','Reinstatement','Cancellation','Cancel','Credit','Rewrite','Adjustment','MVRChargeback']
prog=[]
for m in sig.finditer(pt):
    i=bisect.bisect_left(ps,m.start())-1; pol=pols[i][1] if i>=0 else ''
    win=pt[pols[i][0]:m.start()] if i>=0 else ''
    code=next((c for c in CODES if c in win),'Other')
    prog.append(dict(carrier='Progressive',policy=pol,tran=code,date=m.group('date'),prem=money(m.group('gross')),rate=round(float(m.group('rate'))*100,2),comm=money(m.group('gc'))))
out['progressive']=prog
print('Progressive',len(prog),round(sum(p['comm'] for p in prog),2),'printed 19,468.25')
# KEMPER (commission section only; stop at FL COMMISSION TOTAL)
L=open(P+'/02_Kemper.txt').read().splitlines()
kem=[]
kl=re.compile(r'^\s*(?P<acct>\d{11}-\d+)\s+(?P<name>.+?)\s{2,}(?P<date>\d{2}/\d{2}/\d{4})\s+(?P<act>\S+)\s+0\.1\s+(?P<prem>-?\$[\d,]+\.\d{2})\s+.*?(?P<net>-?\$[\d,]+\.\d{2})\s*$')
for ln in L:
    if 'COMMISSION TOTAL' in ln: break
    m=kl.match(ln)
    if m: kem.append(dict(carrier='Kemper / Infinity',policy=m.group('acct').split('-')[0],name=m.group('name').strip(),date=m.group('date'),tran=m.group('act'),prem=money(m.group('prem')),rate=10.0,comm=money(m.group('net'))))
out['kemper']=kem
print('Kemper',len(kem),round(sum(k['comm'] for k in kem),2),'printed 3,596.22')
# UNITED (10% as collected, promo excluded)
un=[];last=None
for ln in open(P+'/03_United_Aug.txt').read().splitlines():
    m=re.match(r'^\s*(?:01\s+(?P<pol>UA[A-Z]\s*-?\d+)\s+)?(?P<date>\d\d/\d\d/\d\d)\s+(?:\*R\s+)?(?P<desc>COMM AS COLLECTED|CANCEL \(PRORATE\)|ENDORSEMENT|REINSTATE|NEW BUSINESS|PROMOTIONAL INCENTIVE)\s+(?P<name>.+?)\s{2,}(?P<prem>[\d,]*\.\d\d-?)\s+(?P<comm>[\d,]*\.\d\d-?)\s+(?P<due>[\d,]*\.\d\d-?)\s+(?P<pct>[\d.]+)\s*$',ln)
    if not m: continue
    if m.group('pol'): last=re.sub(r'[\s-]','',m.group('pol'))
    un.append(dict(carrier='United Auto',policy=last,name=m.group('name').strip(),date=m.group('date'),tran=m.group('desc'),prem=money(m.group('prem')),rate=float(m.group('pct')),comm=-money(m.group('comm')),promo=m.group('desc')=='PROMOTIONAL INCENTIVE'))
um=[u for u in un if not u['promo']]
out['united']=um
print('United',len(um),round(sum(u['comm'] for u in um),2),'| promo excl',round(sum(u['comm'] for u in un if u['promo']),2),'| printed current balance 178.30 incl promo')
# AMWINS
aw=[]
for ln in open(P+'/04_Amwins.txt').read().splitlines():
    m=re.match(r'^\s*246500\s+(?P<pol>\S+)\s+(?P<eff>\S+)\s+(?P<name>.+?)\s+\$(?P<prem>[\d,.]+)\s+\$(?P<g>[\d,.]+)\s+\$(?P<f>[\d,.]+)\s+\$(?P<n>[\d,.]+)\s+\w\s+(?P<pct>\d+)%\s+\$(?P<c>[\d,.]+)',ln)
    if m: aw.append(dict(carrier='AmWins',policy=m.group('pol'),name=m.group('name'),date=m.group('eff'),tran='Net cash',prem=money(m.group('n')),rate=float(m.group('pct')),comm=money(m.group('c'))))
out['amwins']=aw
print('AmWins',len(aw),round(sum(a['comm'] for a in aw),2),'printed 71.30')
# OCEAN
oh=[]
for ln in open(P+'/05_Ocean_August.txt').read().splitlines():
    m=re.match(r'^(?P<name>[A-Z].+?,\s*[A-Z].*?)\s+(?P<pol>P\d{12})\s+(?P<eff>\S+)\s+(?P<act>NEW|REN|CANC|REI|END)\s+(?P<prem>-?\$[\d,.]+)\s+(?P<fee>-?\$[\d,.]+)\s+(?P<c>-?\$[\d,.]+)\s+(?P<pct>[\d.]+)%',ln.strip())
    if m: oh.append(dict(carrier='Ocean Harbor',policy=m.group('pol'),name=m.group('name'),date=m.group('eff'),tran=m.group('act'),prem=money(m.group('prem')),rate=float(m.group('pct')),comm=money(m.group('c'))))
out['ocean']=oh
print('Ocean',len(oh),round(sum(o['comm'] for o in oh),2),'printed 831.00')
json.dump(out,open('carriers.json','w'),indent=1)
