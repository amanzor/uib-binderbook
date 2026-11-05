"""GEICO August 2026: rows wrap over 3 lines; policy # sits on the line above."""
import re,json,sys
L=open(sys.argv[1]+'/01_Geico_August.txt').read().splitlines()
def money(s):
    s=s.replace('$','').replace(',',''); neg=s.startswith('(')
    v=float(s.strip('()')); return -v if neg else v
row=re.compile(r'^\s*(?P<wa>I\d{6})\s+(?P<mid>.*?)\s*(?P<eff>\d\d/\d\d/\d{4})\s+(?:(?P<code>[A-Za-z]+)\s+)?(?P<td>\d\d/\d\d/\d{4})\s+(?P<prem>\(?\$[\d,]+\.\d\d\)?)\s+(?P<rate>[\d.]+)%\s+(?:[A-D]\s+)?(?:\w+\s+)?(?P<comm>\(?\$[\d,]+\.\d\d\)?)')
section='First Year';gc=[]
for i,ln in enumerate(L):
    if 'Renewal Year' in ln: section='Renewal Year'
    m=row.match(ln)
    if not m: continue
    pol=None
    for j in (i-1,i-2,i-3):
        pm=re.search(r'(\d{10})-',L[j])
        if pm: pol=pm.group(1);break
    nm=[L[j][40:58].strip() for j in range(i-3,i+3) if len(L[j])>40 and L[j][40:58].strip() and not re.search(r'\d',L[j][40:58])]
    gc.append(dict(carrier='GEICO',policy=pol,name=' '.join(x for x in nm if x not in ('Name','Insured Name'))[:40],date=m.group('eff'),tran=(m.group('code') or 'New')+' ('+section+')',rate=float(m.group('rate')),prem=money(m.group('prem')),comm=money(m.group('comm'))))
print('GEICO',len(gc),round(sum(g['comm'] for g in gc),2),'printed 2,396.88')
c=json.load(open('carriers.json')); c['geico']=gc; json.dump(c,open('carriers.json','w'),indent=1)
