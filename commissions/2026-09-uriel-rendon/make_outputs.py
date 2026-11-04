import json
from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.lib import colors
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer, PageBreak, KeepTogether
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_CENTER
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment
S = json.load(open('statement.json')); R = S['rows']; T = S['summary']
NAVY = colors.HexColor('#1F3864'); LIGHT = colors.HexColor('#D9E1F2'); GREY = colors.HexColor('#555555')
RED = colors.HexColor('#C00000'); AMBER = colors.HexColor('#FFF4D6'); AMBERLINE = colors.HexColor('#C9A227')
def m(v): return f"(${abs(v):,.2f})" if v < -0.004 else f"${v:,.2f}"
def who(r):
    if not r['fee']: return ''
    if r['uw_state'] == 'none': return 'Agency (no items)'
    if r['uw_to'] == 'Unassigned': return 'Held – not worked yet'
    return r['uw_to'] + (' (cleared)' if r['uw_state'] == 'cleared' else ' (in progress)')
title = ParagraphStyle('t', fontName='Helvetica-Bold', fontSize=15, textColor=NAVY, alignment=TA_CENTER, leading=19, spaceAfter=4)
sub = ParagraphStyle('s', fontName='Helvetica', fontSize=10, textColor=GREY, alignment=TA_CENTER, spaceAfter=10)
sect = ParagraphStyle('h', fontName='Helvetica-Bold', fontSize=10.5, textColor=NAVY, spaceBefore=10, spaceAfter=4)
body = ParagraphStyle('b', fontName='Helvetica', fontSize=8.6, leading=11.5)
note = ParagraphStyle('n', fontName='Helvetica', fontSize=8, textColor=GREY, leading=10.5)
cell = ParagraphStyle('c', fontName='Helvetica', fontSize=7.6, leading=9)
base = [('FONTSIZE', (0, 0), (-1, -1), 8.4), ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white), ('BACKGROUND', (0, 0), (-1, 0), NAVY),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'), ('TOPPADDING', (0, 0), (-1, -1), 2.2), ('BOTTOMPADDING', (0, 0), (-1, -1), 2.2)]

doc = SimpleDocTemplate('Uriel_Rendon_Commission_Statement_September_2026.pdf', pagesize=letter,
    topMargin=0.55*inch, bottomMargin=0.5*inch, leftMargin=0.6*inch, rightMargin=0.6*inch,
    title='Uriel Rendon - September 2026 Commission Statement', author='Universal Insurance Brokers')
st = [Paragraph('Commission Statement — Uriel Rendon', title),
      Paragraph('Boca Raton Office  |  September 2026 carrier statements  |  Prepared 11/04/2026', sub)]
rule = Table([[Paragraph('<b>AGENT COMMISSION RULE — URIEL RENDON</b>', ParagraphStyle('r', parent=body, textColor=NAVY, fontSize=9.5))],
    [Paragraph('1.&nbsp; <b>50/50 split.</b> Uriel is paid 50% of the commission on his policies; the agency keeps 50%.', body)],
    [Paragraph('2.&nbsp; <b>$10.00 Underwriting Pack fee, taken before the split.</b> $10.00 is deducted from the commission on each '
               'new-business policy, and the remainder is split 50/50 (so it costs Uriel $5 and the agency $5).', body)],
    [Paragraph('3.&nbsp; <b>Who gets the $10.00.</b> The fee is paid to whoever works that policy\'s pending items in the '
               '<b>Underwriting</b> tab (the person who clears them). If a policy had no pending items, the $10 stays with the agency. '
               'If items are still open, the $10 is held until someone clears them.', body)],
    [Paragraph('Renewals, endorsements, cancellations and other adjustments are split 50/50 with no fee.', note)]],
    colWidths=[7.3*inch])
rule.setStyle(TableStyle([('BOX', (0, 0), (-1, -1), 1, AMBERLINE), ('BACKGROUND', (0, 0), (-1, -1), AMBER),
    ('LEFTPADDING', (0, 0), (-1, -1), 9), ('TOPPADDING', (0, 0), (-1, -1), 2.5), ('BOTTOMPADDING', (0, 0), (-1, -1), 2.5)]))
st += [rule, Paragraph('Summary', sect)]
summ = [['', 'Amount'],
        ['Gross commission on Uriel\'s policies (September carrier statements)', m(T['gross'])],
        [f"Less: Underwriting Pack fees ({T['fee_count']} new-business policies × $10.00)", m(-T['fees'])],
        ['Net commission to split', m(T['net'])],
        ['Agency share (50%)', m(T['agency'])],
        ['PAYABLE TO URIEL RENDON (50%)', m(T['uriel'])]]
t = Table(summ, colWidths=[5.6*inch, 1.7*inch])
t.setStyle(TableStyle(base + [('ALIGN', (1, 0), (1, -1), 'RIGHT'), ('LINEABOVE', (0, 3), (-1, 3), 0.6, NAVY),
    ('FONTNAME', (0, 3), (-1, 3), 'Helvetica-Bold'), ('FONTNAME', (0, 5), (-1, 5), 'Helvetica-Bold'), ('FONTSIZE', (0, 5), (-1, 5), 10.5),
    ('BACKGROUND', (0, 5), (-1, 5), LIGHT), ('TEXTCOLOR', (0, 5), (-1, 5), NAVY), ('LINEABOVE', (0, 5), (-1, 5), 1.1, NAVY)]))
st.append(t)
st.append(Paragraph('By carrier', sect))
bc = [['Carrier', 'New business', 'Renewals & adj.', 'Gross', 'UW fees', 'Net', 'Uriel 50%']]
for c, v in S['by_carrier'].items():
    bc.append([c, m(v['new']), m(v['other']), m(v['comm']), m(-v['fee']), m(v['net']), m(v['uriel'])])
bc.append(['Total', m(sum(v['new'] for v in S['by_carrier'].values())), m(sum(v['other'] for v in S['by_carrier'].values())),
           m(T['gross']), m(-T['fees']), m(T['net']), m(T['uriel'])])
t = Table(bc, colWidths=[1.55*inch, 1.0*inch, 1.05*inch, 0.95*inch, 0.85*inch, 0.95*inch, 0.95*inch])
t.setStyle(TableStyle(base + [('ALIGN', (1, 0), (-1, -1), 'RIGHT'), ('FONTNAME', (0, -1), (-1, -1), 'Helvetica-Bold'),
    ('LINEABOVE', (0, -1), (-1, -1), 0.8, NAVY), ('BACKGROUND', (0, -1), (-1, -1), LIGHT)]))
st.append(t)
st.append(Paragraph('Underwriting Pack fees — who gets the $10', sect))
order = sorted(S['alloc'].items(), key=lambda kv: (kv[0].startswith('Agency'), kv[0] == 'Unassigned', kv[0]))
al = [['Goes to', 'Policies', 'Amount', 'Status']]
for k, v in order:
    if k.startswith('Agency'): status = 'No pending items on the policy — kept by the agency'
    elif k == 'Unassigned': status = 'Pending items not worked yet — hold until someone clears them'
    else:
        done = v['count'] - v['open']; status = f"{done} cleared, payable now" + (f"; {v['open']} still open — pay when cleared" if v['open'] else '')
    al.append(['Held (not worked yet)' if k == 'Unassigned' else k, str(v['count']), m(v['amount']), status])
al.append(['Total', str(T['fee_count']), m(T['fees']), ''])
t = Table(al, colWidths=[1.75*inch, 0.65*inch, 0.8*inch, 4.1*inch])
t.setStyle(TableStyle(base + [('ALIGN', (1, 0), (2, -1), 'RIGHT'), ('FONTNAME', (0, -1), (-1, -1), 'Helvetica-Bold'),
    ('LINEABOVE', (0, -1), (-1, -1), 0.8, NAVY), ('FONTSIZE', (3, 1), (3, -1), 7.6)]))
st.append(t)
st.append(Spacer(1, 6))
st.append(Paragraph('Commission is taken from the carrier statements uploaded for September 2026 (Progressive detailed statement '
    'run 10/13/2026, Kemper/Infinity, GEICO, National General) and matched to Uriel\'s policies by policy number. Each carrier read ties to the '
    'total the carrier prints. Ocean Harbor, United Auto and AmWins statements had no Uriel policies this month.', note))

# ---- detail
st.append(PageBreak())
st.append(Paragraph('Detail by Policy — Uriel Rendon, September 2026', title))
st.append(Paragraph('UW fee is deducted before the 50/50 split. "UW fee to" shows who the $10 is paid to.', sub))
hdr = ['Insured', 'Policy #', 'Type', 'Commission', 'UW fee', 'Net', 'Uriel 50%', 'UW fee to']
cw = [1.6*inch, 0.85*inch, 0.62*inch, 0.8*inch, 0.55*inch, 0.75*inch, 0.75*inch, 1.38*inch]
for c in S['by_carrier']:
    rr = [r for r in R if r['carrier'] == c]
    data = [hdr, [c, '', '', '', '', '', '', '']]
    sty = base + [('ALIGN', (3, 0), (6, -1), 'RIGHT'), ('FONTSIZE', (0, 1), (-1, -1), 7.6),
                  ('BACKGROUND', (0, 1), (-1, 1), LIGHT), ('FONTNAME', (0, 1), (-1, 1), 'Helvetica-Bold'), ('TEXTCOLOR', (0, 1), (-1, 1), NAVY)]
    for r in sorted(rr, key=lambda r: (not r['is_new'], r['customer'].lower())):
        typ = 'New' if r['is_new'] else ('Renewal' if any('Renew' in x['tran'] for x in r['txns']) else 'Adj./End.')
        j = len(data)
        data.append([Paragraph(r['customer'], cell), r['policy'], typ, m(r['comm']), m(-r['fee']) if r['fee'] else '–',
                     m(r['net']), m(r['uriel']), Paragraph(who(r), cell)])
        if r['comm'] < 0: sty.append(('TEXTCOLOR', (3, j), (6, j), RED))
    v = S['by_carrier'][c]
    data.append([f'{c} total', '', '', m(v['comm']), m(-v['fee']), m(v['net']), m(v['uriel']), ''])
    sty += [('FONTNAME', (0, -1), (-1, -1), 'Helvetica-Bold'), ('LINEABOVE', (0, -1), (-1, -1), 0.6, NAVY)]
    t = Table(data, colWidths=cw, repeatRows=1); t.setStyle(TableStyle(sty)); st += [t, Spacer(1, 8)]
gt = Table([['GRAND TOTAL', '', '', m(T['gross']), m(-T['fees']), m(T['net']), m(T['uriel']), '']], colWidths=cw)
gt.setStyle(TableStyle([('FONTNAME', (0, 0), (-1, -1), 'Helvetica-Bold'), ('FONTSIZE', (0, 0), (-1, -1), 9), ('ALIGN', (3, 0), (6, 0), 'RIGHT'),
    ('BACKGROUND', (0, 0), (-1, -1), LIGHT), ('TEXTCOLOR', (0, 0), (-1, -1), NAVY), ('LINEABOVE', (0, 0), (-1, -1), 1.1, NAVY)]))
st.append(gt)

st.append(Paragraph('Review items', sect))
items = [
 'Rosa Scotto (Progressive 880175215) was written and cancelled flat on the same statement, netting $0.00, so no $10 fee was taken.',
 'Tanya Sandy Stevens (GEICO 6275534730): the policy number matches the binder, but GEICO prints the insured as Paul Walker. Confirm it is the same household.',
 'Carlos Lopez (Progressive 907591849, renewal $156.08 at 8%) is counted for Uriel because the latest binder entry is his; the prior term was under Alberto Manzor.',
 'Not counted: Alvaro Ganoza (GEICO 6225015939, net +$184.08). Uriel has a March rewrite on it, but the latest binder term is under Alberto Manzor.',
 'Several commissions above are on transactions Progressive dated in October (e.g. James Tracy, Kenneth Lofton, Joseph Novak 880648020); they are on the statement run 10/13/2026, which is the September statement uploaded.',
]
if S['missing']:
    items.append('On Uriel\'s September binder but on no September carrier statement (likely on the October statement or a carrier with no upload): '
        + '; '.join(f"{x['customer']} ({x['carrier'] or 'n/a'} {x['policy']})" for x in S['missing']) + '.')
for i in items: st.append(Paragraph('• ' + i, note))
doc.build(st)

# ---- workbook
wb = openpyxl.Workbook(); ws = wb.active; ws.title = 'Statement'
H = Font(bold=True, color='FFFFFF'); HF = PatternFill('solid', fgColor='1F3864')
ws.append(['Uriel Rendon — September 2026 Commission Statement']); ws['A1'].font = Font(bold=True, size=14)
ws.append(['Rule: 50/50 split. $10 Underwriting Pack fee deducted from each new-business policy BEFORE the split; the $10 goes to whoever clears that policy\'s pending items in the Underwriting tab (no pending items = agency keeps it).'])
ws.append([])
ws.append(['Carrier', 'Insured', 'Policy #', 'Type', 'Commission', 'UW fee', 'Net', 'Uriel 50%', 'Agency 50%', 'UW fee to', 'Pending items'])
for c in ws[4]: c.font = H; c.fill = HF
first = 5
for r in R:
    typ = 'New' if r['is_new'] else ('Renewal' if any('Renew' in x['tran'] for x in r['txns']) else 'Adj./End.')
    n = ws.max_row + 1
    ws.append([r['carrier'], r['customer'], r['policy'], typ, r['comm'], r['fee'], f'=E{n}-F{n}', f'=ROUND(G{n}*0.5,2)', f'=G{n}-H{n}', who(r), ', '.join(r['pending'])])
last = ws.max_row
ws.append(['TOTAL', '', '', '', f'=SUM(E{first}:E{last})', f'=SUM(F{first}:F{last})', f'=SUM(G{first}:G{last})', f'=SUM(H{first}:H{last})', f'=SUM(I{first}:I{last})'])
for c in ws[ws.max_row]: c.font = Font(bold=True)
for row in ws.iter_rows(min_row=first, min_col=5, max_col=9):
    for c in row: c.number_format = '$#,##0.00;[Red]($#,##0.00)'
for col, w in zip('ABCDEFGHIJK', [18, 34, 16, 10, 12, 9, 12, 12, 12, 26, 40]): ws.column_dimensions[col].width = w
w2 = wb.create_sheet('Transactions')
w2.append(['Carrier', 'Policy #', 'Insured (binder)', 'Name on statement', 'Transaction', 'Date', 'Premium', 'Rate %', 'Commission'])
for c in w2[1]: c.font = H; c.fill = HF
for r in R:
    for x in r['txns']:
        w2.append([x['carrier'], x['policy'], x['customer'], x.get('name', ''), x['tran'], x['date'], x['prem'], round(x['rate'], 2), x['comm']])
for col, w in zip('ABCDEFGHI', [18, 14, 32, 24, 24, 12, 12, 8, 12]): w2.column_dimensions[col].width = w
w3 = wb.create_sheet('UW Fee Allocation')
w3.append(['Goes to', 'Policies', 'Amount', 'Still open'])
for c in w3[1]: c.font = H; c.fill = HF
for k, v in order: w3.append(['Held (not worked yet)' if k == 'Unassigned' else k, v['count'], v['amount'], v['open']])
wb.save('Uriel_Rendon_Commission_Statement_September_2026.xlsx')
print('ok')
