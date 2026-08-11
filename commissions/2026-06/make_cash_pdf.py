from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.lib import colors
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer, KeepTogether
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_CENTER

NAVY=colors.HexColor('#1F3864'); LIGHT=colors.HexColor('#D9E1F2'); GREY=colors.HexColor('#666666')
RED=colors.HexColor('#C00000')
def m(v): return f"${v:,.2f}"
title=ParagraphStyle('t',fontName='Helvetica-Bold',fontSize=15,textColor=NAVY,alignment=TA_CENTER,spaceAfter=2)
sub=ParagraphStyle('s',fontName='Helvetica',fontSize=10.5,textColor=GREY,alignment=TA_CENTER,spaceAfter=10)
sect=ParagraphStyle('h',fontName='Helvetica-Bold',fontSize=10.5,textColor=NAVY,spaceBefore=12,spaceAfter=4)
note=ParagraphStyle('n',fontName='Helvetica',fontSize=8,textColor=GREY,leading=11)

R2025=[('Jan 23, 2025','Pearl Holding',124.94),('Feb 4, 2025','Pearl Holding',98.25),
       ('Feb 14, 2025','United',407.33),('Feb 21, 2025','Pearl Holding',196.68),
       ('Apr 22, 2025','United',141.95),('May 16, 2025','United',75.15),
       ('Jun 2, 2025','Pearl Holding',49.60),('Jul 16, 2025','United',125.25),
       ('Aug 15, 2025','Amwins',133.98),('Aug 22, 2025','United',192.05),
       ('Oct 9, 2025','United',416.65)]
R2026=[('Jan 7, 2026','Progressive',283.82),('Jan 7, 2026','Progressive',102.15),
       ('Jan 21, 2026','Progressive',40.80),('Feb 1, 2026','Progressive',101.15),
       ('Mar 5, 2026','National General',37.20),('Mar 9, 2026','Progressive',616.77),
       ('Mar 10, 2026','Progressive',102.15),('Mar 13, 2026','Kemper',167.53),
       ('Apr 2, 2026','Progressive',269.39),('Apr 2, 2026','Progressive',102.15),
       ('Apr 27, 2026','National General',337.00),('Apr 30, 2026','Progressive',269.33),
       ('Apr 30, 2026','Progressive',101.15),('Sep 19, 2026','United',83.50),
       ('Dec 30, 2026','National General',26.33)]
UNCOLLECTED=[
 ('Jun 9, 2026','National General','','',39.00,'No policy number supplied'),
 ('Jun 12, 2026','Progressive','979651509','Claudia Ruiz Lopez',270.33,''),
 ('Jun 18, 2026','Progressive','867943703','Guillermo Fayas Rodriguez',1794.00,''),
 ('Jul 1, 2026','Progressive','979651509','Claudia Ruiz Lopez',269.33,''),
 ('Jul 1, 2026','Progressive','864189944','Claudia Ruiz Lopez',101.15,''),
 ('Jul 21, 2026','Progressive','9615185828','',1647.00,'Policy number is 10 digits; not found in the book'),
 ('Jul 30, 2026','Pearl Holding','876976565','',100.00,'Number is Progressive format; not found in the book'),
 ('Jul 31, 2026','Pearl Holding','P020077622807','Moises D Carrillo',93.00,''),
]
doc=SimpleDocTemplate('Cash_Receipts_Statement_Doral.pdf',pagesize=letter,
    topMargin=0.6*inch,bottomMargin=0.6*inch,leftMargin=0.9*inch,rightMargin=0.9*inch,
    title='Cash Receipts Statement - Doral Office',author='Doral Office')
story=[Paragraph('Cash Receipts Statement',title),
       Paragraph('Doral Office  |  Period: January 23, 2025 – December 30, 2026',sub)]

def received(header,rows,label):
    story.append(Paragraph(header,sect))
    d=[['No.','Date','Payer','Amount Received']]
    st=[('FONTNAME',(0,0),(-1,0),'Helvetica-Bold'),('FONTSIZE',(0,0),(-1,-1),9),
        ('TEXTCOLOR',(0,0),(-1,0),colors.white),('BACKGROUND',(0,0),(-1,0),NAVY),
        ('ALIGN',(0,0),(0,-1),'CENTER'),('ALIGN',(3,0),(3,-1),'RIGHT'),
        ('TOPPADDING',(0,0),(-1,-1),2.6),('BOTTOMPADDING',(0,0),(-1,-1),2.6)]
    tot=0
    for i,(dt,payer,amt) in enumerate(rows,1):
        d.append([str(i),dt,payer,m(amt)]); tot+=amt
    j=len(d); d.append(['',label,'',m(round(tot,2))])
    st+=[('FONTNAME',(0,j),(-1,j),'Helvetica-Bold'),('BACKGROUND',(0,j),(-1,j),LIGHT),
         ('TEXTCOLOR',(0,j),(-1,j),NAVY),('LINEABOVE',(0,j),(-1,j),0.8,NAVY)]
    t=Table(d,colWidths=[0.55*inch,1.5*inch,2.6*inch,1.7*inch]); t.setStyle(TableStyle(st))
    story.append(t); return round(tot,2)

t25=received('2025',R2025,'Total 2025')
t26=received('2026',R2026,'Total 2026')
j=0
gt=round(t25+t26,2)
d=[['','Grand Total Received','',m(gt)]]
t=Table(d,colWidths=[0.55*inch,1.5*inch,2.6*inch,1.7*inch])
t.setStyle(TableStyle([('FONTNAME',(0,0),(-1,0),'Helvetica-Bold'),('FONTSIZE',(0,0),(-1,-1),9.5),
    ('ALIGN',(3,0),(3,0),'RIGHT'),('BACKGROUND',(0,0),(-1,0),LIGHT),('TEXTCOLOR',(0,0),(-1,0),NAVY),
    ('LINEABOVE',(0,0),(-1,0),1.1,NAVY),('TOPPADDING',(0,0),(-1,-1),3.5),('BOTTOMPADDING',(0,0),(-1,-1),3.5)]))
story += [Spacer(1,4),t]

_unc=[Paragraph('UNCOLLECTED',sect)]
d=[['No.','Date','Payer','Policy Number','Insured','Amount Uncollected']]
st=[('FONTNAME',(0,0),(-1,0),'Helvetica-Bold'),('FONTSIZE',(0,0),(-1,-1),8.5),
    ('TEXTCOLOR',(0,0),(-1,0),colors.white),('BACKGROUND',(0,0),(-1,0),NAVY),
    ('ALIGN',(0,0),(0,-1),'CENTER'),('ALIGN',(5,0),(5,-1),'RIGHT'),
    ('VALIGN',(0,0),(-1,-1),'MIDDLE'),
    ('TOPPADDING',(0,0),(-1,-1),2.6),('BOTTOMPADDING',(0,0),(-1,-1),2.6)]
tot=0
for i,(dt,payer,pol,ins,amt,flag) in enumerate(UNCOLLECTED,1):
    r=len(d); d.append([str(i),dt,payer,pol,ins,m(amt)]); tot+=amt
    st.append(('TEXTCOLOR',(5,r),(5,r),RED))
    if flag: st.append(('BACKGROUND',(0,r),(-1,r),colors.HexColor('#FFF2CC')))
j=len(d); tot=round(tot,2)
d.append(['','Total Uncollected','','','',m(tot)])
st+=[('FONTNAME',(0,j),(-1,j),'Helvetica-Bold'),('BACKGROUND',(0,j),(-1,j),LIGHT),
     ('TEXTCOLOR',(0,j),(-1,j),NAVY),('LINEABOVE',(0,j),(-1,j),1.1,NAVY)]
t=Table(d,colWidths=[0.45*inch,1.05*inch,1.15*inch,1.4*inch,1.6*inch,1.2*inch])
t.setStyle(TableStyle(st)); _unc.append(t); story.append(KeepTogether(_unc))

story.append(Paragraph('SUMMARY',sect))
d=[['Total Cash Received',m(gt)],['Total Uncollected',m(tot)],
   ['Net Position',m(round(gt-tot,2))]]
t=Table(d,colWidths=[4.5*inch,1.9*inch])
t.setStyle(TableStyle([('FONTSIZE',(0,0),(-1,-1),9.5),('ALIGN',(1,0),(1,-1),'RIGHT'),
    ('TEXTCOLOR',(1,1),(1,1),RED),
    ('FONTNAME',(0,2),(-1,2),'Helvetica-Bold'),('BACKGROUND',(0,2),(-1,2),LIGHT),
    ('TEXTCOLOR',(0,2),(0,2),NAVY),('LINEABOVE',(0,2),(-1,2),1.1,NAVY),
    ('TOPPADDING',(0,0),(-1,-1),3.5),('BOTTOMPADDING',(0,0),(-1,-1),3.5),
    ('LEFTPADDING',(0,0),(-1,-1),6)]))
story.append(t)
story += [Spacer(1,10), Paragraph(
 '<b>Uncollected</b> items were supplied by the office. Insured names are filled in where the policy number matches '
 'the Doral book: 979651509 and 864189944 are both Claudia Ruiz Lopez, 867943703 is Guillermo Fayas Rodriguez '
 '(whose $1,794.00 renewal premium appears on the June Progressive statement for the same amount), and '
 'P020077622807 is Moises D Carrillo.',note),
 Spacer(1,5), Paragraph(
 '<b>Shaded rows need checking.</b> The June 9 National General item has no policy number. Policy 9615185828 is ten '
 'digits where Progressive uses nine, and matches nothing in the book. Policy 876976565 is listed as Pearl Holding '
 'but is in Progressive’s number format and is not in the book either — Pearl policies begin with a P. Amounts are '
 'carried exactly as supplied.',note),
 Spacer(1,5), Paragraph(
 '<b>Note on periods.</b> Five of the eight uncollected items fall in July 2026 and one on June 9, so they sit '
 'outside the June commission statement period. They do not change the June commission statements, whose Cash '
 'Payments Owed line of $589.00 is a separate figure.',note)]
doc.build(story)
print(f"received {m(gt)}   uncollected {m(tot)}   net {m(round(gt-tot,2))}")
