import re, json, openpyxl

def num(s):
    s=s.strip()
    neg=s.endswith('-')
    v=float(s.rstrip('-').replace(',','') or 0)
    return -v if neg else v

# ---------------- UNITED AUTO ----------------
DESCS=['CANCEL (PRORATE)','PROMOTIONAL INCENTIVE','COMM AS COLLECTED','NEW BUSINESS',
       'ENDORSEMENT','REINSTATEMENT','RENEWAL','CANCEL','Commission Disbursement']
LINE=re.compile(r'^(?:(\d{2})\s+(UA[A-Z])\s*-\s*(\d+)\s+)?(\d{2}/\d{2}/\d{2})\s+(\*R\s+)?(.+?)\s+'
                r'(-?[\d,]*\.\d{2}-?)\s+(-?[\d,]*\.\d{2}-?)\s+(-?[\d,]*\.\d{2}-?)\s+(\d+\.\d{2})\s*$')
ua=[]; cur=None; skipped=[]
for ln in open('united.txt'):
    ln=ln.rstrip()
    if not ln.strip() or ln.startswith(('Run Date','Ref. No.','Report type','Agent Number','CREATIVE',
        '111 LEE','LEHIGH','Phone:','Renewal Trans','Reference','New Business :','Renewal *R:',
        'Adjustment Commission','Transactions processed','Commission dis','Commission cre','Commission deb',
        'Payments','Charge Back','_____','===','PAGES')): continue
    m=LINE.match(ln.strip())
    if not m:
        if 'Commission Disbursement' in ln or 'PPrriioorr' in ln or 'CCuurrrreenntt' in ln: continue
        skipped.append(ln); continue
    if m.group(2): cur=f"{m.group(2)} {m.group(3)}"
    desc=None
    body=m.group(6)
    for dsc in DESCS:
        if body.upper().startswith(dsc.upper()): desc=dsc; break
    if desc is None: skipped.append("NODESC:"+ln); continue
    name=body[len(desc):].strip()
    prem=num(m.group(7)); comm=-num(m.group(8)); rate=float(m.group(10))/100
    ua.append(dict(policy=cur,date=m.group(4),renewal=bool(m.group(5)),desc=desc,name=name,
                   prem=prem,comm=comm,rate=rate))
print("UNITED rows:",len(ua))
for s in skipped: print("  SKIP:",s)
cred=sum(r['comm'] for r in ua if r['comm']>0); deb=sum(r['comm'] for r in ua if r['comm']<0)
promo=sum(r['comm'] for r in ua if r['desc']=='PROMOTIONAL INCENTIVE')
print(f"  credits {cred:.2f} (stmt 1,455.04)  debits {deb:.2f} (stmt -1,017.60)  net {cred+deb:.2f} (stmt 444.33)")
bad=[r for r in ua if abs(round(r['prem']*r['rate'],2)-r['comm'])>0.005]
print("  rate variances:",len(bad))
for r in bad[:5]: print("   ",r)

# ---------------- OCEAN HARBOR / PEARL ----------------
oh=[]
OL=re.compile(r'^(.+?)\s+(P\d{12,13})\s+(\d{2}/\d{2}/\d{4})\s+([A-Z]{3,4})\s+(-?\$[\d,]+\.\d{2})\s+(\$[\d,]+\.\d{2})\s+(-?\$[\d,]+\.\d{2})\s+([\d.]+)%\s*$')
def m2(s): return float(s.replace('$','').replace(',',''))
for ln in open('pearl_ocr.txt'):
    m=OL.match(ln.strip())
    if m:
        oh.append(dict(name=m.group(1).strip(),policy=m.group(2),eff=m.group(3),action=m.group(4),
                       prem=m2(m.group(5)),fee=m2(m.group(6)),comm=m2(m.group(7)),
                       rate=float(m.group(8))/100))
print("OCEAN HARBOR rows:",len(oh),"comm",round(sum(r['comm'] for r in oh),2),"(stmt 326.21)")
print("  rate variances:",len([r for r in oh if abs(round(r['prem']*r['rate'],2)-r['comm'])>0.005]))

# ---------------- NATIONAL GENERAL ----------------
wb=openpyxl.load_workbook("/root/.claude/uploads/1c03ef55-29f7-5482-9b94-43f345ea2246/4250c277-National_General_Commission_Statement_DB_June_2026.xlsx",data_only=True)
ws=wb['Summary Details']
ng=[]
for r in ws.iter_rows(min_row=2,values_only=True):
    if not r[2] or str(r[0]).startswith('Total'): continue
    ng.append(dict(policy=str(r[2]),insured=r[7],eff=str(r[8]),tran=r[9],
                   prem=float(str(r[10]).replace(',','')),rate=float(r[11])/100,
                   comm=float(str(r[12]).replace(',','')),producer=r[1]))
print("NATIONAL GENERAL rows:",len(ng),"comm",round(sum(r['comm'] for r in ng),2),"(stmt 871.27)")
print("  rate variances:",len([r for r in ng if abs(round(r['prem']*r['rate'],2)-r['comm'])>0.005]))

json.dump(dict(united=ua,ocean=oh,natgen=ng),open('carriers2.json','w'),indent=1)
