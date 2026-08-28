import json,re,unicodedata,collections
BOOK=json.load(open('book_all.json'))
C=json.load(open('carriers.json')); D2=json.load(open('carriers2.json')); G=json.load(open('geico.json'))
JUNE=json.load(open('binder.json'))

def norm(p):
    p=re.sub(r'[^A-Z0-9]','',str(p).upper())
    m=re.match(r'^([A-Z]*)(\d*)$',p)
    if m and m.group(2): return m.group(1)+m.group(2).lstrip('0')
    return p
def nm(s):
    s=unicodedata.normalize('NFKD',str(s).upper())
    return re.sub(r'[^A-Z ]',' ',s)
STOP={'DE','LA','DEL','JR','SR','II','III','MR','MRS','LLC','INC','THE','AND','CORP','CO'}
def toks(s): return {t for t in nm(s).split() if len(t)>2 and t not in STOP}

# book index: full key -> rows ; plus reduced key (first token / 10-digit) -> rows
bidx=collections.defaultdict(list)
for r in BOOK:
    bidx[r['key']].append(r)
    p=re.sub(r'[^A-Z0-9]','',r['policy'].upper())
    if p.isdigit() and len(p)>10: bidx[p[:10]].append(r)
    first=re.split(r'[\s\-]',r['policy'].strip())[0]
    if first and norm(first)!=r['key']: bidx[norm(first)].append(r)

june_keys={f"{b['co']}|{norm(b['policy'])}" for b in JUNE}
june_pol={norm(b['policy']) for b in JUNE}

def keys_for(carrier,policy):
    p=str(policy).strip()
    out={norm(p)}
    if carrier=='National General': out.add(norm(p.split()[0]))
    if carrier=='GEICO': out.add(norm(p.split('-')[0]))
    d=re.sub(r'[^0-9]','',p)
    if d and len(d)>10: out.add(d[:10])
    return {k for k in out if k}

TX=[]
def add(carrier,policy,name,ttype,tdate,prem,basis,rate,comm):
    TX.append(dict(carrier=carrier,policy=str(policy),name=name,ttype=ttype,tdate=tdate,
                   prem=prem,basis=basis,rate=rate,comm=comm))
for p in C['prog']:  add('Progressive',p['policy'],p['name'],p['tran'],p['tdate'],p['prem'],p['prem'],p['rate'],p['comm'])
for k in C['kemper']:add('Infinity',k['acct'],k['name'],k['tran'],k['date'],k['prem'],k['prem'],k['rate'],k['comm'])
for a in C['amwins']:add('AmWins',a['policy'],a['name'],'Commission',a['eff'],a['prem'],a['net'],a['rate'],a['comm'])
TT={'COMM AS COLLECTED':'Comm as Collected','NEW BUSINESS':'New Business','ENDORSEMENT':'Endorsement',
    'CANCEL (PRORATE)':'Cancel (Prorate)','PROMOTIONAL INCENTIVE':'Promotional Incentive'}
for u in D2['united']: add('United Auto',u['policy'],u['name'],TT.get(u['desc'],u['desc'].title()),u['date'],u['prem'],u['prem'],u['rate'],u['comm'])
ACT={'REN':'Renewal','CANC':'Cancellation','NEW':'New Business','END':'Endorsement','UCC':'Uncollected Premium'}
for o in D2['ocean']: add('Ocean Harbor',o['policy'],o['name'],ACT.get(o['action'],o['action']),o['eff'],o['prem']+o['fee'],o['prem'],o['rate'],o['comm'])
for g in D2['natgen']:add('National General',g['policy'],g['insured'],g['tran'],g['eff'],g['prem'],g['prem'],g['rate'],g['comm'])
for g in G: add('GEICO',g['policy'],g['name'],g['section']+' Commission',g['tdate'],g['prem'],g['prem'],g['rate'],g['comm'])

matched=[];unmatched=[];namebad=[]
for t in TX:
    hits=[]
    for k in keys_for(t['carrier'],t['policy']):
        hits+=bidx.get(k,[])
    seen=set();rows=[]
    for h in hits:
        i=(h['sheet'],h['row'])
        if i not in seen: seen.add(i); rows.append(h)
    if not rows: unmatched.append(t); continue
    best=sorted(rows,key=lambda x:x['sheet'])[-1]
    ok=bool(toks(t['name']) & toks(best['name'])) or not toks(t['name'])
    t['book_name']=best['name']; t['book_sheet']=best['sheet']; t['book_policy']=best['policy']
    t['book_co']=best['co']; t['name_ok']=ok
    t['in_june']=norm(t['policy']) in june_pol or any(norm(r['policy']) in june_pol for r in rows)
    matched.append(t)
    if not ok: namebad.append(t)

print(f"transactions total {len(TX)}")
print(f"  matched to Doral book : {len(matched)}")
print(f"  of which already in the June sheet: {sum(1 for t in matched if t['in_june'])}")
print(f"  NEW (book but not June sheet)     : {sum(1 for t in matched if not t['in_june'])}")
print(f"  not in Doral book                 : {len(unmatched)}")
print(f"  name-mismatch flags               : {len(namebad)}")
print()
for c in ['Progressive','Infinity','United Auto','Ocean Harbor','National General','AmWins','GEICO']:
    m=[t for t in matched if t['carrier']==c and not t['in_june']]
    print(f"  {c:18} new txns {len(m):4}  commission {sum(x['comm'] for x in m):11,.2f}")
print("\n--- NAME MISMATCHES (need review) ---")
for t in namebad: print(f"  {t['carrier']:16}{t['policy']:20}stmt={t['name'][:26]:28}book={t['book_name'][:26]:28}{t['book_sheet']}")
json.dump(dict(matched=matched,unmatched=unmatched),open('bookmatch.json','w'),indent=1)
