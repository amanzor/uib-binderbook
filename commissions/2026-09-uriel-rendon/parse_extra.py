"""GEICO (wrapped rows) and National General (xlsx) for September 2026."""
import re, json, openpyxl
def money(s):
    s=str(s).strip().replace('$','').replace(',','')
    neg=s.startswith('(') or s.startswith('-') or s.endswith('-')
    s=s.strip('()-')
    return -float(s) if neg else float(s)
L=open('sep/pdfs/01_Geico_Sept.txt').read().splitlines()
row=re.compile(r'^\s*(I\d{6})\s+(?:(?P<nm>[A-Za-z][A-Za-z .\'-]+?)\s{2,})?(?P<eff>\d\d/\d\d/\d{4})\s+(?:(?P<code>[A-Za-z]+)\s+)?(?P<td>\d\d/\d\d/\d{4})\s+(?P<prem>\(?\$[\d,]+\.\d\d\)?)\s+(?P<rate>[\d.]+)%\s+(?:[A-D]\s+)?(?:\w+\s+)?(?P<comm>\(?\$[\d,]+\.\d\d\)?)')
section='First Year'
gc=[]
for i,ln in enumerate(L):
    if 'Renewal Year Commission' in ln: section='Renewal Year'
    m=row.match(ln)
    if not m: continue
    pol=None
    for j in (i-1,i-2):
        pm=re.search(r'(\d{10})-',L[j])
        if pm: pol=pm.group(1); prev=L[j]; break
    # insured name: words after writing agent col on prev/next lines
    def ins(s):
        return ' '.join(re.findall(r'[A-Z][A-Z\'.-]+', s[45:75])) if len(s)>45 else ''
    name=' '.join(x for x in [ins(prev), m.group('nm') or '', ins(L[i+1])] if x).strip()
    gc.append(dict(policy=pol,name=name,eff=m.group('eff'),tran=m.group('code') or '',
                   rate=float(m.group('rate')),prem=money(m.group('prem')),comm=money(m.group('comm')),section=section))
print('GEICO',len(gc),round(sum(g['comm'] for g in gc),2),'(stmt 8,349.25)')
wb=openpyxl.load_workbook('sep/pdfs/02_Commission_Statement_DB_September_2026.xlsx',data_only=True)
ng=[]
for r in list(wb['Summary Details'].iter_rows(values_only=True))[1:]:
    if not r[2] or not r[12]: continue
    ng.append(dict(policy=str(r[2]).split()[0],name=r[7],eff=r[8],tran=r[9],prem=money(r[10]),rate=float(r[11]),comm=money(r[12]),producer=r[1]))
print('NATGEN',len(ng),round(sum(x['comm'] for x in ng),2),'(stmt 700.33 before adj)')
json.dump(dict(geico=gc,national=ng),open('extra.json','w'),indent=1,default=str)
