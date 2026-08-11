import re, json

txt = open('binder.txt').read()
lines = [l.rstrip() for l in txt.split('\n')]

LOBS = ['Personal Auto','Commercial Auto','Motorcycle/ATV','Motorhome','Boat','Home','Umbrella']
COS  = ['United Auto','Ocean Harbor','National General','Progressive','Infinity','AmWins','Kemper','Geico','GEICO']
STAT = ['Active','Renewed','Cancelled','Cancel','Pending']

recs=[]
for ln in lines:
    if not ln.startswith('Jorge '): continue
    rest = ln[len('Jorge '):]
    m = re.search(r'\b(Active|Renewed|Cancelled|Pending)\s+(New|Renewal|Rewrite)\s+', rest)
    if not m:
        print("NO-MATCH:", ln); continue
    name = rest[:m.start()].strip()
    status, ptype = m.group(1), m.group(2)
    tail = rest[m.end():]
    lob = next((l for l in LOBS if tail.startswith(l)), None)
    if not lob: print("NO-LOB:", ln); continue
    tail = tail[len(lob):].strip()
    co = next((c for c in COS if tail.startswith(c)), None)
    if not co: print("NO-CO:", ln); continue
    tail = tail[len(co):].strip()
    # eff date
    dm = list(re.finditer(r'\b(\d{1,2}/\d{1,2}/\d{4})\b', tail))
    if not dm: print("NO-DATE:", ln); continue
    d = dm[-1]
    eff = d.group(1)
    pol = tail[d.end():].strip()
    pre = tail[:d.start()].strip()
    # term = last integer token before date
    tm = re.search(r'(\d+)\s*$', pre)
    term = tm.group(1) if tm else ''
    pre2 = pre[:tm.start()].strip() if tm else pre
    amts = re.findall(r'\$\s*([\d,\s]*\.\d{2}|-)', pre2)
    amts = [a.replace(' ','').replace(',','') for a in amts]
    def f(a):
        try: return float(a)
        except: return 0.0
    # premium = last amount
    prem = f(amts[-1]) if amts else 0.0
    # strip trailing notes from policy: policy tokens are alnum/dash/space
    pm = re.match(r'^([A-Z]{2,3}\s?\d[\d\s\-]*|\d[\d\s\-]*|[A-Z]\d+[\d\-]*)', pol)
    policy = pm.group(1).strip() if pm else pol
    note = pol[len(policy):].strip() if pm else ''
    recs.append(dict(name=name,status=status,ptype=ptype,lob=lob,co=co,
                     prem=prem,term=term,eff=eff,policy=policy,note=note,raw=ln))

print("TOTAL:",len(recs))
json.dump(recs, open('binder.json','w'), indent=1)
for r in recs: print(f"{r['ptype']:8} {r['co']:17} {r['name'][:34]:34} {r['prem']:10.2f} {r['eff']:10} [{r['policy']}] {r['note']}")
