import re,json,unicodedata,collections
from pypdf import PdfReader
T=json.load(open('attributed.json'))
pt=' '.join(ln.rstrip() for pg in PdfReader('aug/pdfs/06_Progressive_August.pdf').pages for ln in pg.extract_text().splitlines())
sig=re.compile(r'(?P<date>\d{2}/\d{2}/\d{4})\s+(?P<gross>-?[\d,]+\.\d{2})\s+(-?[\d,]+\.\d{2})\s+(-?[\d,]+\.\d{2})\s+(-?[\d,]+\.\d{2})\s+[\d,.-]+\s+([\d.]+)\s+(?P<gc>-?[\d,]+\.\d{2})\s+(?P<net>-?[\d,]+\.\d{2})\s+(?P<prod>Unassigned|[A-Z][A-Z\'-]+,\s*[A-Z]+)')
prods=[m.group('prod') for m in sig.finditer(pt)]
P=[t for t in T if t['carrier']=='Progressive']
assert len(prods)==len(P),(len(prods),len(P))
PM={'MANZOR, ALBERTO':'Alberto Manzor','MONTANO, AMANDA':'Amanda Montano','CASTRO, JORGE':'Jorge Castro','DIAZ, RANDY':'Randy Diaz','REIGOZA, LAZARO':'Lazaro Reigoza','RENDON, URIEL':'Uriel Rendon'}
for t,p in zip(P,prods): t['producer']=PM.get(p,p)
print(collections.Counter(prods))
def toks(s):
    s=unicodedata.normalize('NFKD',str(s or '')).encode('ascii','ignore').decode().upper()
    return [x for x in re.sub(r'[^A-Z ]',' ',s).split() if len(x)>2 and x not in {'JR','DEL','LAS','LOS','LLC','INC','CORP'}]
b=json.load(open('aug/raw_binderData.json'))[0]['value']
ams=json.load(open('aug/raw_amsClientData.json'))[0]['value']
names=[]
CARW={'Kemper / Infinity':('INFINITY','KEMPER'),'United Auto':('UNITED',),'Ocean Harbor':('OCEAN',),'Progressive':('PROGRESSIVE',)}
binder_names=[(set(toks(e.get('customerName'))),e['agent'],e.get('entryDate') or '',str(e.get('company') or '').upper(),'binder: '+str(e.get('customerName'))+' / '+str(e.get('company'))+' '+str(e.get('policyNumber'))+' '+str(e.get('entryDate'))) for e in b if e.get('agent')]
for k,v in ams.items():
    a=v.get('assignedAgent') or v.get('agent') or v.get('csrName')
    nm=(v.get('firstName','')+' '+v.get('lastName','')).strip() or k
    if a: names.append((set(toks(nm)),a,'AMS client: '+nm))
for t in T:
    if t['agent'] is not None: continue
    if t['carrier']=='Progressive' and t.get('producer') and t['producer']!='Unassigned':
        t['agent']=t['producer'] if t['producer']!='Jorge Castro' else 'Jorge book (not on his Aug stmt)'; t['how']='Progressive producer field'; continue
    nt=toks(t.get('name',''))
    if len(nt)<2: continue
    def okf(ts): return all(any(x==y or (i==len(nt)-1 and y.startswith(x)) for y in ts) for i,x in enumerate(nt))
    hits=[h for h in binder_names if okf(h[0])]
    same=[h for h in hits if any(w in h[3] for w in CARW.get(t['carrier'],()))]
    pick=sorted(same or hits,key=lambda h:h[2])
    if pick:
        h=pick[-1]; a=h[1]; t['agent']=a if a!='Jorge Castro' else 'Jorge book (not on his Aug stmt)'; t['how']=('name match, same carrier ' if same else 'name match, other carrier ')+'('+h[4]+')'
        if len({x[1] for x in (same or hits)})>1: t['how']+=' [other agents also: '+','.join(sorted({x[1] for x in (same or hits)}-{a}))+']'
        continue
    cands=collections.Counter(); why={}
    for ts,a,w in names:
        # every statement token (allow truncated last token as prefix)
        ok=all(any(x==y or (i==len(nt)-1 and y.startswith(x)) for y in ts) for i,x in enumerate(nt))
        if ok: cands[a]+=1; why.setdefault(a,w)
    if len(cands)==1:
        a=next(iter(cands)); t['agent']=a if a!='Jorge Castro' else 'Jorge book (not on his Aug stmt)'; t['how']='name match ('+why[a]+')'
    elif cands: t['how']='ambiguous name '+str(dict(cands)); t['cands']=why
json.dump(T,open('attributed2.json','w'),indent=1,default=str)
agg=collections.defaultdict(lambda: collections.defaultdict(float))
for t in T: agg[t['agent'] or 'UNMATCHED'][t['carrier']]+=t['comm']
for a,v in agg.items(): print(f"{a:34}", {k:round(x,2) for k,x in v.items()}, round(sum(v.values()),2))
print('grand',round(sum(t['comm'] for t in T),2))
for t in T:
    if t['how'].startswith('name') or t['how'].startswith('Prog') or t['agent'] is None: print(' ',t['carrier'][:10],t['policy'],t.get('name',''),t['comm'],'->',t['agent'],'|',t['how'][:120])
