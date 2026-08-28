import openpyxl, json, re, unicodedata, collections
BOOK=json.load(open('book_all.json'))
def nm(s): return re.sub(r'[^A-Z ]',' ',unicodedata.normalize('NFKD',str(s).upper()))
STOP={'DE','LA','DEL','JR','SR','II','III','LLC','INC','THE','AND'}
def toks(s): return {t for t in nm(s).split() if len(t)>2 and t not in STOP}
bookidx=[(toks(b['name']),b) for b in BOOK]
def find(name):
    t=toks(name)
    if not t: return None
    hits=[b for bt,b in bookidx if len(t&bt)>=2]
    return hits[-1] if hits else None

adj=[]
# ---- National General Adjustments tab (quote-level; Doral status decided per quote) ----
wb=openpyxl.load_workbook("/root/.claude/uploads/1c03ef55-29f7-5482-9b94-43f345ea2246/4250c277-National_General_Commission_Statement_DB_June_2026.xlsx",data_only=True)
rows=[]
for r in wb['Adjustments'].iter_rows(min_row=2,values_only=True):
    if not r[4] or str(r[8]).startswith('Total'): continue
    rows.append(dict(quote=str(r[3]),name=str(r[4]),date=str(r[7])[:10],ttype=str(r[8]),amt=float(r[9] or 0)))
qmap={}
for r in rows:
    b=find(r['name'])
    if b and r['quote'] not in qmap: qmap[r['quote']]=b
for r in rows:
    b=qmap.get(r['quote'])
    adj.append(dict(carrier='National General',ref='Quote '+r['quote'],name=r['name'],ttype=r['ttype'],
                    date=r['date'],amt=r['amt'],doral=bool(b),
                    book_name=b['name'] if b else '',book_sheet=b['sheet'].strip() if b else '',
                    basis='Matched by name and quote number - this section carries no policy number'))
# ---- Kemper fee activity (agency level) ----
for code,amt in [('FL - 23',-10.35),('FL - 90',-22.55)]:
    adj.append(dict(carrier='Infinity',ref='Agent 5517897',name=f'UW Reports fee {code}',
                    ttype='Fee - UW Reports',date='06/30/2026',amt=amt,doral=False,book_name='',book_sheet='',
                    basis='Agency-level fee - Kemper names no insured, so it cannot be attributed to the Doral book'))
# ---- Pearl MVR costs ----
for who,date,amt in [('JOHNSON, J','06/22/2026',-8.36),('MARTINEZ, L','06/05/2026',-8.36)]:
    b=None
    if who.startswith('JOHNSON'):
        b=[x for x in BOOK if 'JAHMAR' in x['name'].upper()]
        b=b[-1] if b else None
    adj.append(dict(carrier='Ocean Harbor',ref='Producer 6883',name=who,ttype='MVR Cost',date=date,amt=amt,
                    doral=bool(b),book_name=b['name'] if b else '',book_sheet=b['sheet'].strip() if b else '',
                    basis=('Name abbreviated by Pearl; matched to Jahmar J Johnson, who is on this same statement'
                           if b else 'Name abbreviated by Pearl - no confident Doral match')))
# ---- United Auto: its statement's own "Adjustment Commission" section = the 3% incentive lines ----
import collections
BK=json.load(open('bookmatch.json'))['matched']
up=[t for t in BK if t['carrier']=='United Auto' and t['ttype']=='Promotional Incentive']
for label,rows in (('on June binder-sheet policies',[t for t in up if t['in_june']]),
                   ('on wider Doral book policies',[t for t in up if not t['in_june']])):
    if not rows: continue
    adj.append(dict(carrier='United Auto',ref='Agent 001-1D-100208',
                    name=f'3% promotional incentive {label}',ttype='Promotional Incentive',
                    date='06/30/26',amt=round(sum(t['comm'] for t in rows),2),doral=False,
                    book_name='',book_sheet=f'{len(rows)} lines',
                    basis=('United books its 3% incentive as an Adjustment (its statement shows 37 such lines '
                           'netting $6.89 agency-wide). Excluded by instruction - this book is carried at 10% '
                           'as collected. Every line is itemised on the Transaction Detail and Book Activity tabs.')))

tot=sum(a['amt'] for a in adj); dor=sum(a['amt'] for a in adj if a['doral'])
print(f"adjustment rows {len(adj)}   total {tot:,.2f}   Doral-attributable {dor:,.2f}")
for c in ['National General','Infinity','Ocean Harbor','United Auto']:
    rs=[a for a in adj if a['carrier']==c]
    print(f"  {c:18} rows {len(rs):3}  all {sum(x['amt'] for x in rs):8.2f}  doral {sum(x['amt'] for x in rs if x['doral']):8.2f}")
json.dump(adj,open('adjustments.json','w'),indent=1)
