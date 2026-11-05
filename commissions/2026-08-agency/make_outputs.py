import json, os
from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.lib import colors
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_CENTER
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment
OUT=os.environ.get('OUT','out'); os.makedirs(OUT,exist_ok=True)
S=json.load(open('statement_all.json'))
AG=['Uriel Rendon','Randy Diaz','Amanda Montano','Lazaro Reigoza','Alberto Manzor']
RULE={'Uriel Rendon':'50/50 split after a $10.00 Underwriting Pack fee on each new-business policy (documented rule, commissions/2026-09-uriel-rendon).',
      'Randy Diaz':'50% agent share — the app\'s default agentCommissionShare. Confirm before paying.',
      'Amanda Montano':'No percentage — the agency keeps all commission on her clients. Flat pay: $25 per new policy, $10 per policy whose Underwriting-tab items she clears, $10 per renewal she renews in the AMS.',
      'Lazaro Reigoza':'50% agent share — the app\'s default agentCommissionShare. Confirm before paying.',
      'Alberto Manzor':'House / agency book — shown for completeness; no agent payout calculated.'}
NAVY=colors.HexColor('#1F3864'); LIGHT=colors.HexColor('#D9E1F2'); GREY=colors.HexColor('#555555'); AMBER=colors.HexColor('#FFF4D6'); AL=colors.HexColor('#C9A227')
m=lambda v: f"(${abs(v):,.2f})" if v<-0.004 else f"${abs(v) if abs(v)<0.005 else v:,.2f}"
title=ParagraphStyle('t',fontName='Helvetica-Bold',fontSize=15,textColor=NAVY,alignment=TA_CENTER,leading=19,spaceAfter=4)
sub=ParagraphStyle('s',fontName='Helvetica',fontSize=10,textColor=GREY,alignment=TA_CENTER,spaceAfter=10)
sect=ParagraphStyle('h',fontName='Helvetica-Bold',fontSize=10.5,textColor=NAVY,spaceBefore=10,spaceAfter=4)
body=ParagraphStyle('b',fontName='Helvetica',fontSize=8.6,leading=11.5)
cell=ParagraphStyle('c',fontName='Helvetica',fontSize=7.4,leading=8.8)
base=[('FONTSIZE',(0,0),(-1,-1),8.2),('FONTNAME',(0,0),(-1,0),'Helvetica-Bold'),('TEXTCOLOR',(0,0),(-1,0),colors.white),('BACKGROUND',(0,0),(-1,0),NAVY),('VALIGN',(0,0),(-1,-1),'MIDDLE'),('TOPPADDING',(0,0),(-1,-1),2),('BOTTOMPADDING',(0,0),(-1,-1),2)]
def uwlabel(r):
    if not r['fee']: return ''
    if r['uw_state']=='none': return 'Agency (no items)'
    if r['uw_to']=='Unassigned': return 'Held – not worked'
    return r['uw_to']+(' (cleared)' if r['uw_state']=='cleared' else ' (in progress)')
for a in AG:
    A=S[a]; uriel=a=='Uriel Rendon'; house=a=='Alberto Manzor'
    fn=f"{OUT}/{a.replace(' ','_')}_Commission_Statement_August_2026.pdf"
    doc=SimpleDocTemplate(fn,pagesize=letter,topMargin=0.55*inch,bottomMargin=0.5*inch,leftMargin=0.55*inch,rightMargin=0.55*inch,title=f'{a} - August 2026 Commission Statement',author='Universal Insurance Brokers')
    st=[Paragraph(f'Commission Statement — {a}',title),Paragraph('August 2026 carrier statements  |  Prepared 11/05/2026',sub)]
    r=Table([[Paragraph('<b>COMMISSION RULE APPLIED</b>  '+RULE[a],body)]],colWidths=[7.4*inch]); r.setStyle(TableStyle([('BOX',(0,0),(-1,-1),1,AL),('BACKGROUND',(0,0),(-1,-1),AMBER),('LEFTPADDING',(0,0),(-1,-1),8)]))
    st+=[r,Paragraph('Summary',sect)]
    rows=[['','Amount'],['Gross commission on agent\'s policies (August carrier statements)',m(A['gross'])]]
    if uriel: rows+=[[f"Less: Underwriting Pack fees ({A['fee_count']} new-business policies × $10.00)",m(-A['fees'])],['Net commission to split',m(A['net'])]]
    if a=='Amanda Montano':
        for k in ('New policy','AMS renewal','Underwriting work'):
            fs=[f for f in A['flat'] if f['kind']==k and f['amount']]
            rows.append([f"{k} fees ({len(fs)} × ${ {'New policy':25,'AMS renewal':10,'Underwriting work':10}[k]}.00)",m(sum(f['amount'] for f in fs))])
    rows+=[['Agency share',m(A['agency'] - A['fees'] if uriel else A['agency'])],[('PAYABLE TO '+a.upper()) if not house else 'Agent payout (house book)',m(A['agent_pay'])]]
    t=Table(rows,colWidths=[5.7*inch,1.7*inch]); t.setStyle(TableStyle(base+[('ALIGN',(1,0),(1,-1),'RIGHT'),('FONTNAME',(0,-1),(-1,-1),'Helvetica-Bold'),('BACKGROUND',(0,-1),(-1,-1),LIGHT),('TEXTCOLOR',(0,-1),(-1,-1),NAVY),('LINEABOVE',(0,-1),(-1,-1),1.1,NAVY)]))
    st.append(t)
    if a=='Amanda Montano':
        st.append(Paragraph('Flat fees',sect))
        ft=[['Fee','Insured','Carrier','Policy #','Date','Status','Amount']]+[[f['kind'],Paragraph(str(f['customer'])[:30],cell),Paragraph(str(f['carrier'])[:28],cell),str(f['policy']),f['date'],Paragraph(f['status'],cell),m(f['amount'])] for f in A['flat']]
        ft.append(['Total','','','','','',m(A['agent_pay'])])
        t=Table(ft,colWidths=[x*inch for x in [1.05,1.35,1.3,1.05,0.75,1.3,0.6]]); t.setStyle(TableStyle(base+[('ALIGN',(6,0),(6,-1),'RIGHT'),('FONTNAME',(0,-1),(-1,-1),'Helvetica-Bold')])); st.append(t)
    st.append(Paragraph('By carrier' + (' (commission on her clients — kept by the agency)' if a=='Amanda Montano' else ''),sect))
    bc=[['Carrier','New business','Renewals & adj.','Gross']+(['UW fees'] if uriel else [])+['Agent pay']]
    for c,v in A['by_carrier'].items(): bc.append([c,m(v['new']),m(v['other']),m(v['comm'])]+([m(-v['fee'])] if uriel else [])+[m(v['agent_pay'])])
    bc.append(['Total',m(sum(v['new'] for v in A['by_carrier'].values())),m(sum(v['other'] for v in A['by_carrier'].values())),m(A['gross'])]+([m(-A['fees'])] if uriel else [])+[m(sum(v['agent_pay'] for v in A['by_carrier'].values()))])
    t=Table(bc); t.setStyle(TableStyle(base+[('ALIGN',(1,0),(-1,-1),'RIGHT'),('FONTNAME',(0,-1),(-1,-1),'Helvetica-Bold'),('LINEABOVE',(0,-1),(-1,-1),0.8,NAVY)])); st.append(t)
    if uriel and A['alloc']:
        st.append(Paragraph('Underwriting Pack fees — who gets the $10',sect))
        at=[['Recipient','Policies','Amount']]+[[k,str(v['count']),m(v['amount'])] for k,v in A['alloc'].items()]
        t=Table(at,colWidths=[3.5*inch,1*inch,1.2*inch]); t.setStyle(TableStyle(base+[('ALIGN',(1,0),(-1,-1),'RIGHT')])); st.append(t)
    st.append(Paragraph('Detail by policy',sect))
    hd=['Carrier','Insured','Policy #','Transactions','Gross']+(['UW fee','UW fee to'] if uriel else [])+['Agent pay']
    dt=[hd]
    for p in sorted(A['rows'],key=lambda p:(p['carrier'],-p['comm'])):
        tx='; '.join(f"{x['tran']} {m(x['comm'])}" for x in p['txns'])
        dt.append([p['carrier'],Paragraph(str(p['customer'])[:34],cell),p['policy'],Paragraph(tx[:140],cell),m(p['comm'])]+([m(p['fee']) if p['fee'] else '',Paragraph(uwlabel(p),cell)] if uriel else [])+[m(p['agent_pay'])])
    cw=[0.95,1.45,0.95,2.15,0.65]+([0.5,0.95] if uriel else [])+[0.65]
    if not uriel: cw[3]+=1.45
    t=Table(dt,colWidths=[c*inch for c in cw],repeatRows=1); t.setStyle(TableStyle(base+[('FONTSIZE',(0,1),(-1,-1),7.2),('ALIGN',(4,0),(-1,-1),'RIGHT'),('ROWBACKGROUNDS',(0,1),(-1,-1),[colors.white,colors.HexColor('#F3F6FB')])]))
    st.append(t); doc.build(st); print('wrote',fn)
# workbook
wb=openpyxl.Workbook(); H=Font(bold=True,color='FFFFFF'); F=PatternFill('solid',fgColor='1F3864'); B=Font(bold=True)
def hdr(ws,row):
    ws.append(row)
    for c in ws[ws.max_row]: c.font=H; c.fill=F
ws=wb.active; ws.title='Agency Summary'
ws.append(['UIB — August 2026 agency commissions (all agents except Jorge Castro, already done)']); ws['A1'].font=Font(bold=True,size=13)
ws.append([])
hdr(ws,['Agent','Rule applied','Policies','Gross commission','UW pack fees','Agent payable','Agency keeps'])
for a in AG:
    A=S[a]; ws.append([a,RULE[a],len(A['rows']),A['gross'],A['fees'],A['agent_pay'],round(A['gross']-A['agent_pay'],2)])
o=S['_other']
for k in ['Jorge Castro','Jorge book (not on his Aug stmt)','Unmatched']:
    if k in o: ws.append([k,{'Jorge Castro':'Already on Jorge\'s August statement (excl. National General $593.64 — that statement is not in the August uploads)','Jorge book (not on his Aug stmt)':'Jorge\'s binder policies whose August transactions are NOT on his statement — review','Unmatched':'No binder/AMS match — review'}[k],len(o[k]['txns']),o[k]['total'],0,None,None])
ws.append(['TOTAL (ties to the six carrier statements)','',None,'=SUM(D4:D%d)'%ws.max_row]); ws[ws.max_row][0].font=B
for col,w in zip('ABCDEFG',[34,70,9,16,13,14,14]): ws.column_dimensions[col].width=w
for row in ws.iter_rows(min_row=4,min_col=4,max_col=7):
    for c in row: c.number_format='#,##0.00;(#,##0.00)'
ws2=wb.create_sheet('By Carrier'); hdr(ws2,['Agent','Carrier','New business','Renewals & adj.','Gross','UW fees','Agent payable'])
for a in AG:
    for c,v in S[a]['by_carrier'].items(): ws2.append([a,c,v['new'],v['other'],v['comm'],v['fee'],v['agent_pay']])
ws3=wb.create_sheet('Policy Detail'); hdr(ws3,['Agent','Carrier','Insured','Policy #','Binder type','New business?','Gross','UW fee','UW fee to','Agent payable','Matched by','Transactions'])
for a in AG:
    for p in S[a]['rows']: ws3.append([a,p['carrier'],p['customer'],p['policy'],p['binder_type'],'Y' if p['is_new'] else '',p['comm'],p['fee'],uwlabel(p),p['agent_pay'],p['how'],'; '.join(f"{x['tran']} {x['date']} prem {x['prem']} @{x['rate']} = {x['comm']}" for x in p['txns'])])
ws4=wb.create_sheet('Review Items'); hdr(ws4,['Bucket','Carrier','Policy #','Name on statement','Transaction','Commission','Note'])
for k in ['Unmatched','Jorge book (not on his Aug stmt)']:
    for t in o.get(k,{}).get('txns',[]): ws4.append([k,t['carrier'],t['policy'],t.get('name') or t.get('customer') or '',t.get('tran'),t['comm'],t['how']])
for a in AG:
    for p in S[a]['rows']:
        if 'name match' in p['how'] or 'producer' in p['how']: ws4.append([f'{a} (matched by name/producer)',p['carrier'],p['policy'],p['customer'],'',p['comm'],p['how']])
wsA=wb.create_sheet('Amanda Flat Fees'); hdr(wsA,['Fee','Insured','Carrier','Policy #','Date','Status','Amount'])
for f in S['Amanda Montano']['flat']: wsA.append([f['kind'],f['customer'],f['carrier'],f['policy'],f['date'],f['status'],f['amount']])
ws5=wb.create_sheet('Aug Binder - No Carrier Txn'); hdr(ws5,['Agent','Entry date','Carrier','Policy #','Customer','Premium'])
for a,v in S['_missing'].items():
    for x in v: ws5.append([a,x['date'],x['carrier'],x['policy'],x['customer'],x['premium']])
for w in wb.worksheets[1:]:
    for col in w.columns: w.column_dimensions[col[0].column_letter].width=min(60,max(10,max(len(str(c.value or '')) for c in col)+2))
fn=f'{OUT}/UIB_Agency_Commissions_August_2026.xlsx'; wb.save(fn); print('wrote',fn)
