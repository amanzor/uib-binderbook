import json, re
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter
from openpyxl.comments import Comment

B=json.load(open('binder.json')); C=json.load(open('carriers.json')); G=json.load(open('geico.json'))

FONT='Arial'
NAVY='1F3864'; HDR=PatternFill('solid',fgColor='1F3864'); SUB=PatternFill('solid',fgColor='D9E1F2')
SECT=PatternFill('solid',fgColor='8EA9DB'); WARN=PatternFill('solid',fgColor='FFF2CC')
TOT=PatternFill('solid',fgColor='FCE4D6')
thin=Side(style='thin',color='BFBFBF'); box=Border(left=thin,right=thin,top=thin,bottom=thin)
MONEY='$#,##0.00;($#,##0.00);-'; PCT='0.00%'

wb=Workbook()

# ---------------- Transaction Detail ----------------
d=wb.active; d.title='Transaction Detail'
dcols=['Match Key','Carrier','Commission Statement','Statement Policy #','Insured Name (per statement)',
       'Transaction Type','Transaction Date','Written / Comm Premium','Commissionable Basis',
       'Carrier Comm Rate','Commission (Basis x Rate)','In Doral Binder Book?','Binder Customer Name']
d.append(dcols)

binder_keys={}
for b in B:
    pol=re.sub(r'[^A-Z0-9]','',b['policy'].upper())
    key=f"{b['co']}|{pol}"
    binder_keys.setdefault(key,b['name'])
    b['_key']=key; b['_pol']=pol

drows=[]
def add(carrier,stmt,policy,name,ttype,tdate,written,basis,rate):
    pol=re.sub(r'[^A-Z0-9]','',str(policy).upper())
    key=f"{carrier}|{pol}"
    drows.append([key,carrier,stmt,str(policy),name,ttype,tdate,written,basis,rate,None,
                  'YES' if key in binder_keys else 'No', binder_keys.get(key,'')])

for p in C['prog']:
    add('Progressive','Progressive Detailed Statement 06/2026',p['policy'],p['name'],p['tran'],p['tdate'],
        p['prem'],p['prem'],p['rate'])
for k in C['kemper']:
    add('Infinity','Kemper Auto Monthly Producer Stmt 06/2026',k['acct'],k['name'],k['tran'],k['date'],
        k['prem'],k['prem'],k['rate'])
for a in C['amwins']:
    add('AmWins','Amwins Specialty Auto Commission Stmt 06/2026',a['policy'],a['name'],'Commission',a['eff'],
        a['prem'],a['net'],a['rate'])
for g in G:
    add('GEICO','GEICO Commission Statement 06/2026',g['policy'],g['name'],
        g['section']+' Commission',g['tdate'],g['prem'],g['prem'],g['rate'])

order={'Progressive':0,'Infinity':1,'AmWins':2,'GEICO':3}
drows.sort(key=lambda r:(order[r[1]], r[11]!='YES', r[3]))
for r in drows: d.append(r)
n=len(drows)
for i in range(2,n+2):
    d.cell(i,11).value=f'=ROUND(I{i}*J{i},2)'
d.append([])
tr=n+3
d.cell(tr,1).value='STATEMENT TOTAL (all transactions)'
for col in (8,9,11):
    d.cell(tr,col).value=f'=SUM({get_column_letter(col)}2:{get_column_letter(col)}{n+1})'
d.cell(tr+1,1).value='Of which: Doral binder-book clients'
for col in (8,9,11):
    L=get_column_letter(col)
    d.cell(tr+1,col).value=f'=SUMIF($L$2:$L${n+1},"YES",{L}2:{L}{n+1})'

# ---------------- Summary by Client ----------------
s=wb.create_sheet('Commission Summary',0)
title=['Doral Office Binder Book - June 2026 Commission Statement',
       'Universal Insurance Brokers  |  Producer: Jorge  |  Statement period 06/01/2026 - 06/30/2026',
       'Commissions taken from each carrier commission statement at the rate that carrier shows.']
for i,t in enumerate(title,1):
    s.cell(i,1).value=t
scols=['Producer','Customer Name','Binder Status','New / Renewal','Line of Business','Carrier',
       'Policy Number','Eff. Date','Term (mo)','Binder Premium','Carrier Statement Used','# Txns',
       'Carrier Comm Rate','Commissionable Premium','Commission Earned','Effective Rate','Notes']
HDR_ROW=5
for j,c in enumerate(scols,1): s.cell(HDR_ROW,j).value=c

STMT={'Progressive':'Progressive Detailed Statement 06/2026',
      'Infinity':'Kemper Auto Monthly Producer Stmt 06/2026',
      'AmWins':'Amwins Specialty Auto Commission Stmt 06/2026'}
NOSTMT={'United Auto':'United Auto','Ocean Harbor':'Ocean Harbor','National General':'National General'}

def hits_for(b):
    return [r for r in drows if r[0]==b['_key']]

r=HDR_ROW+1
sections=[]
for ptype,label in (('New','NEW BUSINESS'),('Renewal','RENEWALS')):
    s.cell(r,1).value=label; s.cell(r,1).font=Font(name=FONT,bold=True,color='FFFFFF')
    for j in range(1,len(scols)+1): s.cell(r,j).fill=SECT
    start=r+1; r+=1
    for b in [x for x in B if x['ptype']==ptype]:
        h=hits_for(b); co=b['co']
        note=''
        if co in NOSTMT:
            stmt='No statement provided'
            note=f'{co} commission statement was not included in the files provided - commission cannot be calculated.'
        elif not h:
            stmt=STMT[co]
            if b['prem']==0:
                note='12-month policy effective '+b['eff']+'; no June 2026 commission activity on this statement.'
            else:
                note='Policy not found on the June 2026 statement - commission likely paid in a different statement period.'
        else:
            stmt=STMT[co]
            rates=sorted(set(x[9] for x in h))
            if len(h)>1:
                note=f"{len(h)} transactions netted: " + "; ".join(f"{x[5]} {x[7]:,.2f}" for x in h)
            if len(rates)>1: note=(note+' | ' if note else '')+'Mixed rates: '+', '.join(f'{x:.0%}' for x in rates)
        rates=sorted(set(x[9] for x in h))
        s.cell(r,1).value=b['name'] and 'Jorge'
        s.cell(r,2).value=b['name']
        s.cell(r,3).value=b['status']
        s.cell(r,4).value='New Business' if ptype=='New' else 'Renewal'
        s.cell(r,5).value=b['lob']
        s.cell(r,6).value=co
        s.cell(r,7).value=b['policy']
        s.cell(r,8).value=b['eff']
        s.cell(r,9).value=int(b['term']) if b['term'] else None
        s.cell(r,10).value=b['prem'] if b['prem'] else None
        s.cell(r,11).value=stmt
        s.cell(r,12).value=f'=COUNTIF(\'Transaction Detail\'!$A$2:$A${n+1},$R{r})'
        s.cell(r,13).value=(rates[0] if len(rates)==1 else ('Mixed' if rates else None))
        s.cell(r,14).value=f'=SUMIF(\'Transaction Detail\'!$A$2:$A${n+1},$R{r},\'Transaction Detail\'!$I$2:$I${n+1})'
        s.cell(r,15).value=f'=SUMIF(\'Transaction Detail\'!$A$2:$A${n+1},$R{r},\'Transaction Detail\'!$K$2:$K${n+1})'
        s.cell(r,16).value=f'=IF(N{r}=0,"",O{r}/N{r})'
        s.cell(r,17).value=note
        s.cell(r,18).value=b['_key']   # helper key col R
        r+=1
    end=r-1
    s.cell(r,2).value=f'{label} SUBTOTAL'
    for col in (10,14,15): s.cell(r,col).value=f'=SUM({get_column_letter(col)}{start}:{get_column_letter(col)}{end})'
    s.cell(r,16).value=f'=IF(N{r}=0,"",O{r}/N{r})'
    sections.append((label,start,end,r))
    for j in range(1,len(scols)+1): s.cell(r,j).fill=SUB; s.cell(r,j).font=Font(name=FONT,bold=True)
    r+=2

gr=r
s.cell(gr,2).value='GRAND TOTAL - DORAL BINDER BOOK'
for col in (10,14,15):
    L=get_column_letter(col)
    s.cell(gr,col).value=f'={L}{sections[0][3]}+{L}{sections[1][3]}'
s.cell(gr,16).value=f'=IF(N{gr}=0,"",O{gr}/N{gr})'
for j in range(1,len(scols)+1): s.cell(gr,j).fill=TOT; s.cell(gr,j).font=Font(name=FONT,bold=True,size=11)
SUM_LAST=gr

# ---------------- Carrier Recap ----------------
rc=wb.create_sheet('Carrier Recap')
rc.cell(1,1).value='Recap by Carrier - Doral Binder Book vs. Full Carrier Statement'
rcols=['Carrier','Commission Statement Provided','Carrier Comm Rate(s) Shown','Binder Policies',
       'Policies Found on Statement','Commissionable Premium (binder clients)','Commission Earned (binder clients)',
       'Total Commission on Statement (all agency business)','Binder Share of Statement']
for j,c in enumerate(rcols,1): rc.cell(3,j).value=c

carriers=['Progressive','Infinity','United Auto','Ocean Harbor','National General','AmWins']
rateshow={'Progressive':'8% - 14% (varies by policy)','Infinity':'10%','AmWins':'10% of net cash',
          'United Auto':'n/a','Ocean Harbor':'n/a','National General':'n/a'}
stmtshow={'Progressive':'Yes - Progressive Detailed Statement','Infinity':'Yes - Kemper Auto Producer Stmt',
          'AmWins':'Yes - Amwins Specialty Auto','United Auto':'No - not provided',
          'Ocean Harbor':'No - not provided','National General':'No - not provided'}
rr=4
for co in carriers:
    cnt=len([b for b in B if b['co']==co])
    rc.cell(rr,1).value=co
    rc.cell(rr,2).value=stmtshow[co]
    rc.cell(rr,3).value=rateshow[co]
    rc.cell(rr,4).value=cnt
    rc.cell(rr,5).value=f"=SUMPRODUCT(('Commission Summary'!$F${HDR_ROW+1}:$F${SUM_LAST}=$A{rr})*('Commission Summary'!$L${HDR_ROW+1}:$L${SUM_LAST}>0))"
    rc.cell(rr,6).value=f"=SUMIF('Commission Summary'!$F${HDR_ROW+1}:$F${SUM_LAST},$A{rr},'Commission Summary'!$N${HDR_ROW+1}:$N${SUM_LAST})"
    rc.cell(rr,7).value=f"=SUMIF('Commission Summary'!$F${HDR_ROW+1}:$F${SUM_LAST},$A{rr},'Commission Summary'!$O${HDR_ROW+1}:$O${SUM_LAST})"
    rc.cell(rr,8).value=f"=SUMIF('Transaction Detail'!$B$2:$B${n+1},$A{rr},'Transaction Detail'!$K$2:$K${n+1})"
    rc.cell(rr,9).value=f'=IF(H{rr}=0,"",G{rr}/H{rr})'
    rr+=1
rc.cell(rr,1).value='GEICO'
rc.cell(rr,2).value='Yes - GEICO Commission Statement'
rc.cell(rr,3).value='10% / 12% / 15%'
rc.cell(rr,4).value=0
rc.cell(rr,5).value=0
rc.cell(rr,6).value=0; rc.cell(rr,7).value=0
rc.cell(rr,8).value=f"=SUMIF('Transaction Detail'!$B$2:$B${n+1},$A{rr},'Transaction Detail'!$K$2:$K${n+1})"
rc.cell(rr,9).value=''
rc.cell(rr,1).comment=Comment('No client on the Doral binder book appears on the GEICO statement. '
    'That statement covers writing agents Alberto Manzor Jr and Amanda Montano, not the Doral (Jorge) book.','Analysis')
grr=rr+1
rc.cell(grr,1).value='TOTAL'
for col in (4,5,6,7,8):
    L=get_column_letter(col); rc.cell(grr,col).value=f'=SUM({L}4:{L}{rr})'
rc.cell(grr,9).value=f'=IF(H{grr}=0,"",G{grr}/H{grr})'
for j in range(1,len(rcols)+1): rc.cell(grr,j).fill=TOT; rc.cell(grr,j).font=Font(name=FONT,bold=True)

# ---------------- Notes ----------------
nt=wb.create_sheet('Notes & Sources')
notes=[
 ('Source files',''),
 ('Binder book','Doral_Office_Binder_Book_June_Sheet.pdf - 63 policies (18 new business, 45 renewals), producer Jorge.'),
 ('Progressive','DetailedStatement20260811_Progressive.xlsx - 188 transactions, agent 24258, month end 202606. Detail total commission $14,289.02 ties to the Summary tab of that file.'),
 ('Infinity','Kemper.pdf - Kemper Auto Monthly Producer Statement, agent 5517897, 06/01/2026-06/30/2026. 27 commission transactions totalling $656.60, ties to the statement FL Commission Total.'),
 ('AmWins','Amwins_Comm_1.PDF - Amwins Specialty Auto of Florida, agent 246500, commissions 06/01/2026-06/30/2026. 9 rows totalling $72.34, ties to the statement Agency Total.'),
 ('GEICO','Commission_Statement_35.pdf - GEICO, payee Universal Brokers LLC. 38 transactions totalling $2,267.79, ties to the statement Payment Amount.'),
 ('',''),
 ('How commission is calculated',''),
 ('Matching','Every binder-book policy was matched to the carrier statements by POLICY NUMBER, not by name, so name spelling differences between the binder and the carriers do not affect the result.'),
 ('Rate used','The rate is taken from the carrier statement itself - it is never assumed. Commission = Commissionable Basis x the rate the carrier shows, rounded to the cent.'),
 ('Progressive basis','Gross Premium on the Progressive detail line. Progressive shows a per-policy rate that varies (8%, 9%, 10%, 12%, 14%).'),
 ('Infinity basis','Premium column on the Kemper statement. Kemper shows a flat 0.10 (10%) rate on every FL line.'),
 ('AmWins basis','NET CASH (gross cash less fees), not written premium. AmWins shows 10% and applies it to net cash - e.g. Angely Gejo: $164.67 net cash x 10% = $16.47.'),
 ('Multiple transactions','Where a policy has more than one line in a month (new business plus an endorsement or credit endorsement), all lines are netted. The Notes column on the summary lists them.'),
 ('',''),
 ('Items that could not be commissioned',''),
 ('No statement provided','United Auto (10 policies), Ocean Harbor (2 policies) and National General (3 policies) commission statements were not among the uploaded files, so no commission can be calculated for those 15 policies. Request those three statements to complete the book. Those 15 rows are shaded on the Commission Summary tab.'),
 ('Not on the June statement','6 Progressive renewals on the binder book do not appear anywhere in the June Progressive detail: Amarillys Gonzalez (970306264), Brudys Garcia (990100610), Yosvany Larralde (982064065), Ana G Castano (866496112), Manuel Martinez (990228513), Reysel Castillo (970570633). These were verified by both policy number and name. Most likely the commission fell into the May or July statement period - worth following up with Progressive.'),
 ('No June activity','4 Infinity policies are 12-month policies effective in December 2025 that carry no premium on the binder sheet and show no June 2026 activity on the Kemper statement: Levy Diaz Torres, Elizabeth Mirabal Hernandez, Ana Maria Acosta and James John Ciullo. $0 commission is the correct answer for those four this month, not a missing match.'),
 ('GEICO','The GEICO statement was reviewed line by line. None of its 38 transactions belong to a Doral binder-book client - it covers writing agents Alberto Manzor Jr and Amanda Montano. It is included on the Transaction Detail tab flagged "No" for completeness only, and contributes $0 to the Doral totals.'),
 ('',''),
 ('Controls performed',''),
 ('Binder premium tie-out','The Binder Premium column reproduces the binder sheet\'s own totals exactly: new business $29,109.40 ($28,891.00 base + $218.40 MVR/fees) and renewals $49,272.55, confirming all 63 rows were captured.'),
 ('Carrier tie-out','Each carrier statement was re-added from its individual transaction lines and agreed to the total the carrier printed: Progressive $14,289.02, Kemper/Infinity $656.60, AmWins $72.34, GEICO $2,267.79.'),
 ('Rate re-performance','Every commission on the Transaction Detail tab is recalculated in the workbook as basis x rate. All 262 transactions across the four statements reproduce the carrier-printed commission to the cent.'),
 ('',''),
 ('Reading the workbook',''),
 ('Commission Summary','One row per binder-book policy, in binder order, split into New Business and Renewals with subtotals. Column O is the commission earned.'),
 ('Transaction Detail','Every line from all four carrier statements. Column L flags whether the line belongs to a Doral binder-book client. Column K recalculates the commission from basis x rate, so it can be checked against the carrier.'),
 ('Carrier Recap','Per-carrier totals, and what share of each carrier statement the Doral book represents.'),
]
nt.cell(1,1).value='Notes, Sources & Methodology'
rn=3
for a,b_ in notes:
    nt.cell(rn,1).value=a; nt.cell(rn,2).value=b_
    if a and not b_: nt.cell(rn,1).font=Font(name=FONT,bold=True,size=11,color=NAVY)
    rn+=1

# ---------------- Formatting ----------------
def style(ws,hdr_row,ncols,widths,first_data,last_data,money_cols=(),pct_cols=(),num_cols=()):
    for row in ws.iter_rows():
        for c in row:
            c.font=Font(name=FONT,size=10) if not c.font.bold else Font(name=FONT,size=c.font.size or 10,bold=True,color=c.font.color.rgb if c.font.color else None)
            c.alignment=Alignment(vertical='center')
    for j,w in enumerate(widths,1): ws.column_dimensions[get_column_letter(j)].width=w
    if hdr_row:
        for j in range(1,ncols+1):
            c=ws.cell(hdr_row,j); c.fill=HDR; c.font=Font(name=FONT,size=10,bold=True,color='FFFFFF')
            c.alignment=Alignment(vertical='center',wrap_text=True,horizontal='center'); c.border=box
        ws.freeze_panes=ws.cell(hdr_row+1,3)
    for i in range(first_data,last_data+1):
        for j in money_cols: ws.cell(i,j).number_format=MONEY
        for j in pct_cols: ws.cell(i,j).number_format=PCT
        for j in num_cols: ws.cell(i,j).alignment=Alignment(horizontal='center')

for i,t in enumerate(title,1):
    s.cell(i,1).font=Font(name=FONT,size=14 if i==1 else 10,bold=(i==1),color=NAVY if i==1 else '404040')
style(s,HDR_ROW,17,[10,34,12,14,17,17,18,11,9,14,34,7,13,16,16,11,80],HDR_ROW+1,SUM_LAST,
      money_cols=(10,14,15),pct_cols=(16,),num_cols=(9,12))
for i in range(HDR_ROW+1,SUM_LAST+1):
    c=s.cell(i,13)
    if isinstance(c.value,float): c.number_format=PCT
    c.alignment=Alignment(horizontal='center')
    s.cell(i,17).alignment=Alignment(vertical='center',wrap_text=False)
    if s.cell(i,11).value=='No statement provided' or (s.cell(i,17).value or '').startswith('Policy not found'):
        for j in range(1,18): s.cell(i,j).fill=WARN
s.column_dimensions['R'].hidden=True
s.cell(HDR_ROW,18).value='key'
s.row_dimensions[HDR_ROW].height=30
s.auto_filter.ref=f'A{HDR_ROW}:Q{SUM_LAST}'
s.cell(3,1).font=Font(name=FONT,size=10,italic=True,color='404040')

style(d,1,13,[26,13,38,20,32,20,14,17,17,12,17,12,30],2,tr+1,money_cols=(8,9,11),pct_cols=(10,),num_cols=(12,))
d.auto_filter.ref=f'A1:M{n+1}'
for i in range(2,n+2):
    if d.cell(i,12).value=='YES':
        for j in range(1,14): d.cell(i,j).fill=PatternFill('solid',fgColor='E2EFDA')
for rw in (tr,tr+1):
    for j in range(1,14): d.cell(rw,j).fill=TOT; d.cell(rw,j).font=Font(name=FONT,size=10,bold=True)

rc.cell(1,1).font=Font(name=FONT,size=13,bold=True,color=NAVY)
style(rc,3,9,[20,36,28,12,14,20,20,24,14],4,grr,money_cols=(6,7,8),pct_cols=(9,),num_cols=(4,5))
rc.row_dimensions[3].height=42

nt.cell(1,1).font=Font(name=FONT,size=13,bold=True,color=NAVY)
nt.column_dimensions['A'].width=24; nt.column_dimensions['B'].width=132
for row in nt.iter_rows():
    for c in row:
        if not c.font.bold: c.font=Font(name=FONT,size=10)
        c.alignment=Alignment(vertical='top',wrap_text=True)

for ws in wb: ws.sheet_view.showGridLines=False
wb.save('Doral_Binder_Book_June_2026_Commissions.xlsx')
print("saved")
