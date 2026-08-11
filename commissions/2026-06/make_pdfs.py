import json
from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.lib import colors
from reportlab.platypus import (SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer)
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_CENTER

D=json.load(open('pdf_data.json'))
EXPENSES=[('220 License Rent',-500.00),('Systems',-224.00),
          ('MVRs',round(D['adj_total'],2)),('Cash Payments Owed',-589.00)]
def opex(gross):
    roy=round(gross*0.15,2); paid=round(gross-roy,2)
    return roy,paid,round(paid+sum(v for _,v in EXPENSES),2)
ORDER=D['order']; LABEL=D['label']; ROWS=D['rows']
NAVY=colors.HexColor('#1F3864'); LIGHT=colors.HexColor('#D9E1F2'); GREY=colors.HexColor('#666666')
def m(v):
    return f"(${abs(v):,.2f})" if v<0 else f"${v:,.2f}"

title=ParagraphStyle('t',fontName='Helvetica-Bold',fontSize=15,textColor=NAVY,alignment=TA_CENTER,spaceAfter=2)
sub  =ParagraphStyle('s',fontName='Helvetica',fontSize=10.5,textColor=GREY,alignment=TA_CENTER,spaceAfter=10)
sect =ParagraphStyle('h',fontName='Helvetica-Bold',fontSize=10,textColor=NAVY,spaceBefore=10,spaceAfter=4)
note =ParagraphStyle('n',fontName='Helvetica',fontSize=8,textColor=GREY,leading=11)

# ============================ DETAIL ============================
doc=SimpleDocTemplate('Detailed_Commission_Statement_Doral_June_2026.pdf',pagesize=letter,
                      topMargin=0.55*inch,bottomMargin=0.5*inch,leftMargin=0.8*inch,rightMargin=0.8*inch,
                      title='June 2026 Commission Statement - Detail by Carrier',author='Doral Office')
story=[Paragraph('June 2026 Commission Statement — Detail by Carrier',title),
       Paragraph('Doral Office  |  Period 06/01/2026 – 06/30/2026',sub)]
data=[['Insured Name','Commission','Pos / Neg']]
style=[('FONTNAME',(0,0),(-1,0),'Helvetica-Bold'),('FONTSIZE',(0,0),(-1,-1),8.2),
       ('TEXTCOLOR',(0,0),(-1,0),colors.white),('BACKGROUND',(0,0),(-1,0),NAVY),
       ('ALIGN',(1,0),(2,-1),'RIGHT'),('ALIGN',(2,0),(2,-1),'CENTER'),
       ('VALIGN',(0,0),(-1,-1),'MIDDLE'),('TOPPADDING',(0,0),(-1,-1),1.9),
       ('BOTTOMPADDING',(0,0),(-1,-1),1.9),('LEFTPADDING',(0,0),(-1,-1),6),
       ('LINEBELOW',(0,0),(-1,0),0.6,NAVY)]
grand=0.0
for co in ORDER:
    rows=ROWS.get(co,[])
    if not rows: continue
    i=len(data); data.append([LABEL[co],'','']) 
    style += [('BACKGROUND',(0,i),(-1,i),LIGHT),('FONTNAME',(0,i),(-1,i),'Helvetica-Bold'),
              ('TEXTCOLOR',(0,i),(-1,i),NAVY)]
    tot=0.0
    for name,amt,_ in rows:
        j=len(data)
        data.append([name,m(amt),'Negative' if amt<0 else 'Positive'])
        if amt<0: style.append(('TEXTCOLOR',(1,j),(2,j),colors.HexColor('#C00000')))
        tot+=amt
    j=len(data); tot=round(tot,2); grand+=tot
    data.append([f'{LABEL[co]} Total',m(tot),''])
    style += [('FONTNAME',(0,j),(-1,j),'Helvetica-Bold'),('LINEABOVE',(0,j),(-1,j),0.5,NAVY),
              ('LINEBELOW',(0,j),(-1,j),0.5,NAVY)]
j=len(data); grand=round(grand,2)
data.append(['GRAND TOTAL',m(grand),''])
style += [('FONTNAME',(0,j),(-1,j),'Helvetica-Bold'),('FONTSIZE',(0,j),(-1,j),10),
          ('BACKGROUND',(0,j),(-1,j),LIGHT),('TEXTCOLOR',(0,j),(-1,j),NAVY),
          ('LINEABOVE',(0,j),(-1,j),1.1,NAVY)]
t=Table(data,colWidths=[4.4*inch,1.3*inch,1.0*inch],repeatRows=1)
t.setStyle(TableStyle(style)); story.append(t)

roy,paid,netd=opex(grand)
story.append(Paragraph('OPERATING EXPENSES &amp; NET TO DORAL',sect))
ed=[['Gross Commissions',m(grand)],['Royalty (15%)',m(-roy)],['Paid to Doral',m(paid)]]
est=[('FONTSIZE',(0,0),(-1,-1),9),('ALIGN',(1,0),(1,-1),'RIGHT'),
     ('TOPPADDING',(0,0),(-1,-1),3),('BOTTOMPADDING',(0,0),(-1,-1),3),('LEFTPADDING',(0,0),(-1,-1),6),
     ('FONTNAME',(0,2),(-1,2),'Helvetica-Bold'),('LINEABOVE',(0,2),(-1,2),0.5,NAVY),
     ('TEXTCOLOR',(1,1),(1,1),colors.HexColor('#C00000'))]
for _l,_v in EXPENSES:
    i=len(ed); ed.append([_l,m(_v)])
    if _v<0: est.append(('TEXTCOLOR',(1,i),(1,i),colors.HexColor('#C00000')))
i=len(ed); ed.append(['Net to Doral',m(netd)])
est += [('FONTNAME',(0,i),(-1,i),'Helvetica-Bold'),('FONTSIZE',(0,i),(-1,i),10.5),
        ('BACKGROUND',(0,i),(-1,i),LIGHT),('TEXTCOLOR',(0,i),(-1,i),NAVY),
        ('LINEABOVE',(0,i),(-1,i),1.1,NAVY)]
et=Table(ed,colWidths=[4.4*inch,2.3*inch]); et.setStyle(TableStyle(est)); story.append(et)

story += [Spacer(1,10), Paragraph(
    'Commission is taken from each carrier’s own June 2026 statement at the rate that carrier shows, matched to the '
    'Doral book by policy number. United Auto is carried at 10% as collected; its separate 3% promotional incentive '
    'is excluded. Amounts in parentheses are chargebacks — cancellations, credit endorsements and carrier '
    'adjustments — which net against the month.',note),
    Spacer(1,5), Paragraph(
    '<b>MVRs</b> of $43.42 is carrier-charged and is shown as an operating expense rather than inside the carrier '
    'sections above, so it is not counted twice: $8.36 of Pearl MVR costs and $35.06 of National General loss- and '
    'violation-history chargebacks. <b>220 License Rent, Systems and Cash Payments Owed</b> are office figures taken '
    'from the expense schedule supplied; they appear on no carrier statement.',note)]
doc.build(story)
print("detail pdf grand total:",m(grand))

# ============================ MONTHLY ============================
gross=D['gross']
doc2=SimpleDocTemplate('Monthly_Commission_Statement_Doral_June_2026.pdf',pagesize=letter,
                       topMargin=0.75*inch,bottomMargin=0.7*inch,leftMargin=1.1*inch,rightMargin=1.1*inch,
                       title='Doral Office Monthly Commission Statement - June 2026',author='Doral Office')
s2=[Paragraph('DORAL OFFICE',title),Paragraph('Monthly Commission Statement<br/>Period: June 2026',sub)]

def block(header,rows,total_row=None):
    d=[[header,'','']] if False else []
    dd=[]; st=[('FONTSIZE',(0,0),(-1,-1),9.5),('ALIGN',(1,0),(-1,-1),'RIGHT'),
               ('VALIGN',(0,0),(-1,-1),'MIDDLE'),('TOPPADDING',(0,0),(-1,-1),3),
               ('BOTTOMPADDING',(0,0),(-1,-1),3),('LEFTPADDING',(0,0),(-1,-1),6)]
    return dd,st

s2.append(Paragraph('COMMISSION SUMMARY BY CARRIER',sect))
d=[['Carrier','New Business','Renewals & Adj.','Total']]
st=[('FONTNAME',(0,0),(-1,0),'Helvetica-Bold'),('FONTSIZE',(0,0),(-1,-1),9),
    ('TEXTCOLOR',(0,0),(-1,0),colors.white),('BACKGROUND',(0,0),(-1,0),NAVY),
    ('ALIGN',(1,0),(-1,-1),'RIGHT'),('TOPPADDING',(0,0),(-1,-1),3.5),('BOTTOMPADDING',(0,0),(-1,-1),3.5)]
for co,n,r,tt in D['summary']:
    i=len(d); d.append([co,m(n),m(r),m(tt)])
    for c,val in ((1,n),(2,r),(3,tt)):
        if val<0: st.append(('TEXTCOLOR',(c,i),(c,i),colors.HexColor('#C00000')))
i=len(d); d.append(['Total Gross Commissions',m(D['gt_new']),m(D['gt_ren']),m(gross)])
st += [('FONTNAME',(0,i),(-1,i),'Helvetica-Bold'),('BACKGROUND',(0,i),(-1,i),LIGHT),
       ('TEXTCOLOR',(0,i),(-1,i),NAVY),('LINEABOVE',(0,i),(-1,i),0.9,NAVY)]
t=Table(d,colWidths=[2.3*inch,1.35*inch,1.45*inch,1.3*inch]); t.setStyle(TableStyle(st)); s2.append(t)

def money_block(header,rows):
    s2.append(Paragraph(header,sect))
    d=[]; st=[('FONTSIZE',(0,0),(-1,-1),9.5),('ALIGN',(1,0),(1,-1),'RIGHT'),
              ('TOPPADDING',(0,0),(-1,-1),3.5),('BOTTOMPADDING',(0,0),(-1,-1),3.5),
              ('LEFTPADDING',(0,0),(-1,-1),6)]
    for label,val,kind in rows:
        i=len(d)
        d.append([label, val if isinstance(val,str) else m(val)])
        if kind=='total':
            st += [('FONTNAME',(0,i),(-1,i),'Helvetica-Bold'),('BACKGROUND',(0,i),(-1,i),LIGHT),
                   ('TEXTCOLOR',(0,i),(-1,i),NAVY),('LINEABOVE',(0,i),(-1,i),0.9,NAVY)]
        elif kind=='open':
            st += [('TEXTCOLOR',(0,i),(-1,i),GREY)]
        if not isinstance(val,str) and val<0 and kind!='total':
            st.append(('TEXTCOLOR',(1,i),(1,i),colors.HexColor('#C00000')))
    t=Table(d,colWidths=[4.1*inch,2.3*inch]); t.setStyle(TableStyle(st)); s2.append(t)

mroy,mpaid,mnet=opex(gross)
money_block('ROYALTY &amp; AMOUNT PAID TO DORAL',[
    ('Gross Commissions',gross,''),
    ('Royalty (15%)',-mroy,''),
    ('Paid to Doral',mpaid,'total')])
money_block('OPERATING EXPENSES',
    [(l,v,'') for l,v in EXPENSES]+[('Net to Doral',mnet,'total')])
s2 += [Spacer(1,12), Paragraph(
    '<b>Basis.</b> Gross commissions are taken from the seven carrier commission statements for June 2026 at the rate '
    'each carrier shows, matched to the Doral book by policy number. New Business is the 18 new policies on the June '
    'binder sheet; Renewals &amp; Adj. is the 45 renewals plus prior-month activity (endorsements, cancellations, '
    'as-collected commission) and carrier adjustments. United Auto is carried at 10% as collected, with its 3% '
    'promotional incentive excluded.',note),
    Spacer(1,6), Paragraph(
    '<b>Operating expenses.</b> MVRs of $43.42 is carrier-charged — $8.36 of Pearl MVR costs and $35.06 of National '
    'General loss- and violation-history chargebacks — and is shown here rather than inside the carrier figures '
    'above so it is not counted twice. 220 License Rent, Systems and Cash Payments Owed are office figures taken '
    'from the expense schedule supplied and appear on no carrier statement; change them here if the June amounts '
    'differ.',note)]
doc2.build(s2)
print("monthly pdf: gross",m(gross),"royalty",m(mroy),"paid to doral",m(mpaid),"net to doral",m(mnet))
