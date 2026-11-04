import re, json, bisect, subprocess
from collections import defaultdict
def money(s):
    s=str(s).replace('$','').replace(',','').strip(); neg=s.startswith('-') or s.endswith('-') or s.startswith('(')
    v=float(s.strip('()-')); return -v if neg else v
D=lambda s: re.sub(r'\D','',str(s or ''))
# ---- Progressive with tran codes
txt=subprocess.run(['pdftotext','sep/pdfs/07_DetailedStatement20261013.pdf','-'],capture_output=True,text=True).stdout
pt=' '.join(l.strip() for l in txt.splitlines())
sig=re.compile(r'(?P<date>\d{2}/\d{2}/\d{4})\s+(?P<gross>-?[\d,]+\.\d{2})\s+0\.00\s+0\.00\s+(?P<billed>-?[\d,]+\.\d{2})\s+[\d,.-]+\s+(?P<rate>[\d.]+)\s+(?P<gc>-?[\d,]+\.\d{2})\s+(?P<net>-?[\d,]+\.\d{2})')
pols=[(m.start(),m.group()) for m in re.finditer(r'\b\d{9}\b',pt)]; ps=[p[0] for p in pols]
CODES=['New Business','Renewal','Endorsement','Reinstatement','Cancellation','Cancel','Credit','Rewrite','Adjustment','MVRChargeback']
prog=[]
for m in sig.finditer(pt):
    i=bisect.bisect_left(ps,m.start())-1; pol=pols[i][1]
    win=pt[pols[i][0]:m.start()]
    code=next((c for c in CODES if c in win),'')
    if not code:
        back=pt[max(0,pols[i-1][0] if i>0 else 0):m.start()]
        code=next((c for c in CODES if c in pt[m.start()-200:m.start()]),'Other')
    prog.append(dict(carrier='Progressive',policy=pol,tran=code,date=m.group('date'),prem=money(m.group('gross')),rate=float(m.group('rate'))*100,comm=money(m.group('gc'))))
print('Progressive',len(prog),round(sum(p['comm'] for p in prog),2),'printed 18,419.97')
kem=[dict(carrier='Kemper / Infinity',policy=k['policy'],name=k['name'],tran=k['act'],date=k['date'],prem=k['prem'],rate=10.0,comm=k['comm']) for k in json.load(open('work/carriers.json'))['kemper']]
print('Kemper',len(kem),round(sum(k['comm'] for k in kem),2),'printed 4,823.01')
ex=json.load(open('extra.json'))
gc=[dict(carrier='GEICO',policy=g['policy'],name=g['name'],tran=(g['tran'] or 'New')+(' ('+g['section']+')'),date=g['eff'],prem=g['prem'],rate=g['rate'],comm=g['comm']) for g in ex['geico']]
ng=[dict(carrier='National General',policy=n['policy'],name=n['name'],tran=n['tran'],date=n['eff'][:10] if n['eff'] else '',prem=n['prem'],rate=n['rate'],comm=n['comm']) for n in ex['national']]
allt=prog+kem+gc+ng
b=json.load(open('raw_binderData.json'))[0]['value']
U=[e for e in b if e.get('agent')=='Uriel Rendon']
idx=defaultdict(list)
for e in U:
    k=D(e.get('policyNumber'))
    if len(k)>=6: idx[k].append(e)
# everyone's book, to show who else owns a matched policy
allidx=defaultdict(set)
for e in b:
    k=D(e.get('policyNumber'))
    if len(k)>=6: allidx[k].add(e.get('agent'))
out=[]
for t in allt:
    k=D(t['policy'])
    if k in idx:
        es=sorted(idx[k],key=lambda e:e.get('entryDate') or '')
        e=es[-1]
        t.update(binder_id=e['id'],customer=e.get('customerName'),binder_type=e.get('policyType'),binder_date=e.get('entryDate'),
                 binder_premium=e.get('basePremium'),binder_carrier=e.get('company'),others=sorted(a for a in allidx[k] if a and a!='Uriel Rendon'),
                 lob=e.get('lineOfBusiness'),docs=e.get('documentationStatus') or [])
        out.append(t)
print('matched',len(out),round(sum(t['comm'] for t in out),2))
json.dump(out,open('uriel_matched.json','w'),indent=1,default=str)
for t in out: print(f"{t['carrier'][:11]:11} {t['policy']:12} {t['tran'][:22]:22} {t['date']:10} {t['prem']:>9.2f} {t['rate']:>5} {t['comm']:>8.2f} | {t['customer'][:28]:28} {t['binder_type']} {t['binder_date']} {t.get('name','')[:22]} {t['others']}")
