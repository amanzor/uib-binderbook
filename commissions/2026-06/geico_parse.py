import pdfplumber, json, re
p="/root/.claude/uploads/1c03ef55-29f7-5482-9b94-43f345ea2246/3897e4a0-Commission_Statement_35.pdf"
def money(s):
    s=s.strip()
    if not s: return None
    neg = s.startswith('(')
    v=float(re.sub(r'[^\d.]','',s) or 0)
    return -v if neg else v
rows=[]; section=None
with pdfplumber.open(p) as pdf:
    for pg in pdf.pages:
        t=pg.extract_table()
        if not t: continue
        for r in t:
            c=[(x or "").replace("\n"," ").strip() for x in r]
            if c[0].startswith('First Year'): section='First Year'; continue
            if c[0].startswith('Renewal Year'): section='Renewal Year'; continue
            if c[0].startswith('Writing Agent'): continue
            if not c[0] and c[7]: rows.append(dict(kind='TOTAL',section=section,prem=money(c[7]),comm=money(c[11]))); continue
            if not c[0]: continue
            rows.append(dict(kind='TXN',section=section,agent=c[1],policy=re.sub(r'\s+','',c[2]),
                name=re.sub(r'\s+',' ',c[3]),eff=c[4],due=c[5],tdate=c[6],prem=money(c[7]),
                rate=float(c[8].replace('%',''))/100,comm=money(c[11]),carrier=c[12],product=c[13]))
txn=[r for r in rows if r['kind']=='TXN']
print("GEICO txns:",len(txn),"comm sum",round(sum(r['comm'] for r in txn),2))
for r in [x for x in rows if x['kind']=='TOTAL']: print("TOTAL:",r)
bad=[r for r in txn if abs(round(r['prem']*r['rate'],2)-r['comm'])>0.005]
print("rate variances:",len(bad))
json.dump(txn,open('geico.json','w'),indent=1)
