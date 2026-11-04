import re, json

def money(s): return float(s.replace('$','').replace(',','').replace('(','-').replace(')',''))

# ---------- KEMPER (Infinity) ----------
kem=[]
pat = re.compile(r'^(\S+?)-(\d+)\s+(.+?)\s+(\d{2}/\d{2}/\d{4})\s+(\S+)\s+([\d.]+)\s+(-?\$-?[\d,]+\.\d{2})\s+(-?\$-?[\d,]+\.\d{2})\s+(-?\$-?[\d,]+\.\d{2})\s+(-?\$-?[\d,]+\.\d{2})\s+(-?\$-?[\d,]+\.\d{2})$')
for ln in open('kemper.txt'):
    m=pat.match(ln.strip())
    if m:
        kem.append(dict(acct=m.group(1),seq=m.group(2),name=m.group(3),date=m.group(4),
                        tran=m.group(5),rate=float(m.group(6)),prem=money(m.group(7)),
                        comm=money(m.group(11))))
print("KEMPER rows:",len(kem), "sum comm", round(sum(k['comm'] for k in kem),2))

# ---------- AMWINS ----------
amw=[]
pa = re.compile(r'^(\d{6})\s+(\S+)\s+(\d{2}/\d{2}/\d{4})\s+(.+?)\s+(-?\$-?[\d,]+\.\d{2})\s+(-?\$-?[\d,]+\.\d{2})\s+(-?\$-?[\d,]+\.\d{2})\s+(-?\$-?[\d,]+\.\d{2})\s+(\w)\s+(\d+)%\s+(-?\$-?[\d,]+\.\d{2})$')
for ln in open('amwins.txt'):
    ln=ln.strip().replace('$-','$-')
    m=pa.match(ln)
    if m:
        amw.append(dict(policy=m.group(2),eff=m.group(3),name=m.group(4),prem=money(m.group(5)),
                        gross=money(m.group(6)),fees=money(m.group(7)),net=money(m.group(8)),
                        rate=int(m.group(10))/100.0,comm=money(m.group(11))))
print("AMWINS rows:",len(amw),"sum comm",round(sum(a['comm'] for a in amw),2))

# ---------- PROGRESSIVE ----------
import openpyxl
wb=openpyxl.load_workbook("/root/.claude/uploads/1c03ef55-29f7-5482-9b94-43f345ea2246/797f7cf0-DetailedStatement20260811_Progressive.xlsx",data_only=True)
ws=wb['Detailed']
prog=[]
for r in ws.iter_rows(min_row=2,values_only=True):
    prog.append(dict(name=r[0],policy=str(r[1]).strip(),eff=r[2],tran=r[6],tdate=r[7],
                     prem=float(r[8] or 0),rate=float(r[13] or 0),comm=float(r[14] or 0),prod=r[16]))
print("PROG rows:",len(prog),"sum comm",round(sum(p['comm'] for p in prog),2))

json.dump(dict(kemper=kem,amwins=amw,prog=prog),open('carriers.json','w'),indent=1,default=str)
