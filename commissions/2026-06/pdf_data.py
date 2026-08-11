import json, collections
B=json.load(open('binder.json')); C=json.load(open('carriers.json'))
D2=json.load(open('carriers2.json')); BM=json.load(open('bookmatch.json'))['matched']
ADJ=json.load(open('adjustments.json'))
PROMO='Promotional Incentive'
ORDER=['Progressive','United Auto','Infinity','National General','GEICO','AmWins','Ocean Harbor']
LABEL={'Progressive':'PROGRESSIVE','United Auto':'UNITED AUTO','Infinity':'INFINITY',
       'National General':'NATIONAL GENERAL','GEICO':'GEICO','AmWins':'AMWINS','Ocean Harbor':'OCEAN HARBOR'}

# June binder policies -> commission (counted basis, United 10%)
june={}   # key -> dict
for b in B:
    june[b['_key'] if '_key' in b else None]=None
import re
def norm(p):
    p=re.sub(r'[^A-Z0-9]','',str(p).upper())
    m=re.match(r'^([A-Z]*)(\d*)$',p)
    return m.group(1)+m.group(2).lstrip('0') if m and m.group(2) else p
jkey={f"{b['co']}|{norm(b['policy'])}":b for b in B}

tx=collections.defaultdict(float)   # (carrier, key) -> commission counted
def addtx(carrier,policy,comm,ttype=''):
    if ttype==PROMO: return
    tx[(carrier,norm(policy))]+=comm
for p in C['prog']:  addtx('Progressive',p['policy'],p['comm'])
for k in C['kemper']:addtx('Infinity',k['acct'],k['comm'])
for a in C['amwins']:addtx('AmWins',a['policy'],a['comm'])
for u in D2['united']:
    if u['desc']!='PROMOTIONAL INCENTIVE': addtx('United Auto',u['policy'],u['comm'])
for o in D2['ocean']: addtx('Ocean Harbor',o['policy'],o['comm'])
for g in D2['natgen']:addtx('National General',g['policy'],g['comm'])

rows=collections.defaultdict(list)   # carrier -> [(name, amount, bucket)]
seen=set()
for b in B:
    key=(b['co'],norm(b['policy'])); seen.add(key)
    amt=round(tx.get(key,0.0),2)
    rows[b['co']].append((b['name'],amt,'new' if b['ptype']=='New' else 'ren'))
bk=collections.defaultdict(float); bkname={}
for t in BM:
    if t['in_june'] or t['ttype']==PROMO: continue
    k=(t['carrier'],norm(t['policy'])); bk[k]+=t['comm']; bkname[k]=t['book_name']
for k,v in bk.items():
    rows[k[0]].append((bkname[k],round(v,2),'ren'))
adj_total=round(sum(a['amt'] for a in ADJ if a['doral']),2)   # -> the MVRs operating-expense line
adj_parts=[]
for c in ORDER:
    v=round(sum(a['amt'] for a in ADJ if a['doral'] and a['carrier']==c),2)
    if v: adj_parts.append((c,v))

summary=[]
gt_new=gt_ren=0.0
for co in ORDER:
    n=round(sum(x[1] for x in rows[co] if x[2]=='new'),2)
    r=round(sum(x[1] for x in rows[co] if x[2]=='ren'),2)
    summary.append((co,n,r,round(n+r,2))); gt_new+=n; gt_ren+=r
gross=round(gt_new+gt_ren,2)
print(f"{'Carrier':18}{'New Business':>14}{'Renewals & Adj':>16}{'Total':>12}")
for co,n,r,t in summary: print(f"  {co:16}{n:>14,.2f}{r:>16,.2f}{t:>12,.2f}")
print(f"  {'TOTAL':16}{gt_new:>14,.2f}{gt_ren:>16,.2f}{gross:>12,.2f}")
carrier_fees={'Infinity':32.90,'Ocean Harbor':16.72}
print("\nMVRs / statement adjustments (operating-expense line):",adj_total,adj_parts)
json.dump(dict(summary=summary,rows={k:v for k,v in rows.items()},gross=gross,
               adj_total=adj_total,adj_parts=adj_parts,
               gt_new=round(gt_new,2),gt_ren=round(gt_ren,2),order=ORDER,label=LABEL,
               fees=carrier_fees),open('pdf_data.json','w'),indent=1)
