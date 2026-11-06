import re, json, collections
D=lambda s: re.sub(r'\D','',str(s or '')).lstrip('0')
def K(carrier,p):
    p=str(p or '').upper()
    if carrier=='United Auto': return re.sub(r'[^A-Z0-9]','',p)  # e.g. UAO000663386
    if carrier in ('AmWins','Ocean Harbor'): return re.sub(r'[^A-Z0-9]','',p)
    return D(p)
def KB(p):  # binder variants
    p=str(p or '').upper().strip(); out=set()
    a=re.sub(r'[^A-Z0-9]','',p); out.add(a); d=D(p)
    if d: out.add(d)
    if d and len(d)>10: out.add(d[:10])
    if d and len(d)>11: out.add(d[:11])
    f=re.split(r'[\s/]',p)[0]; out.add(re.sub(r'[^A-Z0-9]','',f)); out.add(D(f))
    m=re.match(r'^(UA[A-Z])\W*0*(\d+)',p)
    if m: out.add(m.group(1)+m.group(2).zfill(9))
    m=re.match(r'^(P\d{12})',a)
    if m: out.add(m.group(1))
    return {x for x in out if x and len(x)>=6}
C=json.load(open('carriers.json'))
T=[t for v in C.values() for t in v]
for t in T:
    t['key']=K(t['carrier'],t['policy'])
    if t['carrier']=='United Auto': t['key']=re.sub(r'^(UA[A-Z])0*(\d+)$',lambda m:m.group(1)+m.group(2).zfill(9),t['key'])
# --- Jorge's set
J=json.load(open('jorge_aug.json'))
jk=collections.defaultdict(float)
for r in J:
    pol=r['policy']
    if not pol:
        m=re.search(r'(UA[A-Z]-?\d+|FFL\d+|\b\d{10}\b)',r['name'])
        pol=m.group(1) if m else ''
    r['policy']=pol
CARMAP={'PROGRESSIVE':'Progressive','UNITED AUTO':'United Auto','INFINITY':'Kemper / Infinity','AMWINS':'AmWins','OCEAN HARBOR':'Ocean Harbor','GEICO':'GEICO','NATIONAL GENERAL':'National General'}
jset=set()
for r in J:
    c=CARMAP[r['carrier']]; pp=r['policy']
    if c=='Kemper / Infinity': pp=pp.split('-')[0]
    if c=='GEICO': pp=D(pp)[:10]
    r['policy']=pp; k=K(c,pp)
    if c=='United Auto': k=re.sub(r'^(UA[A-Z])0*(\d+)$',lambda m:m.group(1)+m.group(2).zfill(9),k)
    if k: jset.add((c,k)); jk[(c,k)]+=r['comm']
# Jorge rows with no policy: find by name in progressive (Tuttle, Guillen)
noj=[r for r in J if not r['policy']]
# --- binder index
b=json.load(open('aug/raw_binderData.json'))[0]['value']
latest={}; allag=collections.defaultdict(set); ent={}
for e in sorted(b,key=lambda e:(e.get('entryDate') or '')):
    for k in KB(e.get('policyNumber')):
        if e.get('agent'): latest[k]=e['agent']; allag[k].add(e['agent'])
        ent[k]=e
import itertools
byk=collections.defaultdict(list)
for t in T: byk[(t['carrier'],t['key'])].append(t)
# Tuttle / Guillen: no policy printed on Jorge's statement -> locate by amount in Progressive
for r in noj:
    for t in T:
        if t['carrier']=='Progressive' and abs(t['comm']-r['comm'])<0.005 and (t['carrier'],t['key']) not in jset:
            jset.add((t['carrier'],t['key'])); jk[(t['carrier'],t['key'])]+=r['comm']; print('  located',r['name'],'->',t['key']); break
for ck in jset:
    tx=byk.get(ck,[]); want=round(jk[ck],2)
    if abs(sum(t['comm'] for t in tx)-want)<0.01: sel=tx
    else:
        sel=None
        for n in range(len(tx),0,-1):
            for comb in itertools.combinations(tx,n):
                if abs(sum(t['comm'] for t in comb)-want)<0.01: sel=comb; break
            if sel: break
        sel=sel or []
    for t in tx:
        if any(t is x for x in sel): t['agent']='Jorge Castro'; t['how']='on Jorge Aug statement'
        else: t['agent']='Jorge book (not on his Aug stmt)'; t['how']='jorge-policy leftover'
for t in T:
    if t.get('agent'): continue
    a=latest.get(t['key'])
    if not a and t['carrier']=='GEICO': a=latest.get(t['key'][:10])
    if a:
        e=ent.get(t['key']) or {}
        t['agent']=a if a!='Jorge Castro' else 'Jorge book (not on his Aug stmt)'; t['how']='binder'; t['customer']=e.get('customerName'); t['binder_type']=e.get('policyType'); t['binder_date']=e.get('entryDate'); t['binder_id']=e.get('id'); t['others']=sorted(allag[t['key']]-{a})
    else: t['agent']=None; t['how']='unmatched'
# Jorge statement items that did not find a statement txn
found=collections.defaultdict(float)
for t in T:
    if t['agent']=='Jorge Castro': found[(t['carrier'],t['key'])]+=t['comm']
miss=[(k,round(v,2),round(found.get(k,0),2)) for k,v in jk.items() if abs(v-found.get(k,0))>0.01 and k[0]!='National General']
print('Jorge items not tying to statement:',miss)

agg=collections.defaultdict(lambda: collections.defaultdict(float))
for t in T: agg[t['agent'] or 'UNMATCHED'][t['carrier']]+=t['comm']
for a,v in agg.items(): print(f"{a:16}", {k:round(x,2) for k,x in v.items()}, round(sum(v.values()),2))
json.dump(T,open('attributed.json','w'),indent=1,default=str)
