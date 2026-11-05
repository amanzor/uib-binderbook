"""Apply each agent's rule to the attributed August transactions.
  Uriel Rendon : documented rule (commissions/2026-09-uriel-rendon/README.md) - $10 UW pack fee
                 on each new-business policy with commission > 0, then 50/50.
  Amanda Montano : NO percentage - the agency keeps all commission on her clients. Flat pay:
                 $25 per new policy she writes, $10 per policy whose Underwriting-tab items she
                 clears, $10 per renewal she renews in the AMS (Renewals > Renewed, renewal date
                 in the month).
  Randy Diaz, Lazaro Reigoza : app default agent share, 50% (agentCommissionShare in app.js).
                 No UW fee. TO CONFIRM.
  Alberto Manzor : house / agency book - no agent payout computed.
"""
import json,re,collections
T=json.load(open('attributed2.json'))
b=json.load(open('aug/raw_binderData.json'))[0]['value']
uw=json.load(open('aug/raw_underwritingData.json'))[0]['value']
byid={e['id']:e for e in b}
AG=['Uriel Rendon','Randy Diaz','Amanda Montano','Lazaro Reigoza','Alberto Manzor']
def is_new_tx(t):
    tr=(t.get('tran') or '').lower()
    if t['carrier']=='GEICO': return 'first year' in tr
    return tr.startswith('new') or tr in ('new business',)
def uw_who(bid):
    e=byid.get(bid,{}); pend=[x for x in (e.get('documentationStatus') or []) if x and x!='Clean']
    if not pend: return 'Agency (no pending items)','none'
    r=uw.get(str(bid),{}); items=r.get('items',{})
    outst=[x for x in pend if not (items.get(x) or {}).get('satisfied')]
    who=r.get('clearedBy') or ''
    if not who:
        best,at='',-1
        for v in items.values():
            if v.get('satisfied') and (v.get('at') or 0)>at: best,at=v.get('by',''),v.get('at') or 0
        who=best
    return (who or 'Unassigned'), ('open' if outst else 'cleared')
res={}
for a in AG:
    pol=collections.OrderedDict()
    for t in sorted([t for t in T if t['agent']==a],key=lambda t:(t['carrier'],-abs(t['comm']))):
        k=(t['carrier'],t['key'] or t['policy'])
        p=pol.setdefault(k,dict(carrier=t['carrier'],policy=t['policy'],customer=t.get('customer') or t.get('name') or '',binder_id=t.get('binder_id'),binder_type=t.get('binder_type'),txns=[],comm=0.0,is_new=False,how=t['how']))
        p['txns'].append(dict(tran=t.get('tran'),date=t.get('date'),prem=t.get('prem'),rate=t.get('rate'),comm=t['comm']))
        p['comm']=round(p['comm']+t['comm'],2)
        if is_new_tx(t) and (p['binder_type'] in ('New','Rewrite',None)): p['is_new']=True
    rows=list(pol.values())
    for p in rows:
        if a=='Uriel Rendon':
            p['fee']=10.0 if (p['is_new'] and p['comm']>0) else 0.0
            p['uw_to'],p['uw_state']=uw_who(p['binder_id']) if p['fee'] else ('','')
        else: p['fee']=0.0; p['uw_to']=p['uw_state']=''
        p['net']=round(p['comm']-p['fee'],2)
        share=0.0 if a in ('Alberto Manzor','Amanda Montano') else 0.5
        p['agent_pay']=round(p['net']*share,2); p['agency']=round(p['net']-p['agent_pay']+p['fee'],2)
    by=collections.OrderedDict()
    for p in rows:
        c=by.setdefault(p['carrier'],dict(new=0.0,other=0.0,comm=0.0,fee=0.0,agent_pay=0.0))
        c['new' if p['is_new'] else 'other']+=p['comm']
        for f in ('comm','fee','agent_pay'): c[f]+=p[f]
    for c in by.values():
        for f in c: c[f]=round(c[f],2)
    tot=lambda f: round(sum(p[f] for p in rows),2)
    alloc=collections.defaultdict(lambda: dict(count=0,amount=0.0,open=0))
    for p in rows:
        if p['fee']:
            x=alloc[p['uw_to']]; x['count']+=1; x['amount']+=p['fee']; x['open']+= p['uw_state']=='open'
    res[a]=dict(rows=rows,by_carrier=by,gross=tot('comm'),fees=tot('fee'),net=tot('net'),agent_pay=tot('agent_pay'),
                agency=round(tot('comm')-tot('agent_pay'),2),new_count=sum(p['is_new'] for p in rows),fee_count=sum(1 for p in rows if p['fee']),alloc=dict(alloc))
    print(f"{a:16} policies {len(rows):3}  gross {res[a]['gross']:>10,.2f}  UW fees {res[a]['fees']:>7,.2f}  agent {res[a]['agent_pay']:>10,.2f}  agency {res[a]['agency']:>10,.2f}  new {res[a]['new_count']}")
    if alloc: print('   UW fees ->',dict(alloc))
other=collections.defaultdict(list)
for t in T:
    if t['agent'] not in AG: other[t['agent'] or 'Unmatched'].append(t)
# ---- Amanda Montano flat fees
NEW_FEE,UW_FEE_A,RNW_FEE=25.0,10.0,10.0
flat=[]
on_stmt={t['key'] for t in T}
for e in b:
    if e.get('agent')=='Amanda Montano' and (e.get('entryDate') or '').startswith('2026-08') and e.get('policyType') in ('New','Rewrite'):
        flat.append(dict(kind='New policy',amount=NEW_FEE,customer=e.get('customerName'),carrier=e.get('company'),policy=e.get('policyNumber'),date=e.get('entryDate'),status='earned'))
seen=set()
for e in b:
    pt=str(e.get('policyType') or '').lower(); rd=str(e.get('effectiveDate') or e.get('effDate') or e.get('entryDate') or '')[:10]
    if e.get('agent')=='Amanda Montano' and 'renew' in pt and rd.startswith('2026-08'):
        k=re.sub(r'\D','',str(e.get('policyNumber')))
        later=[x for x in b if re.sub(r'\D','',str(x.get('policyNumber')))==k and x is not e and 'renew' in str(x.get('policyType') or '').lower() and str(x.get('effDate') or '')[:7]>'2026-08']
        if later or k in seen:
            flat.append(dict(kind='AMS renewal',amount=0.0,customer=e.get('customerName'),carrier=e.get('company'),policy=e.get('policyNumber'),date=rd,status='not counted - same policy renewed again eff '+str(later[0].get('effDate')) if later else 'duplicate')); continue
        seen.add(k)
        flat.append(dict(kind='AMS renewal',amount=RNW_FEE,customer=e.get('customerName'),carrier=e.get('company'),policy=e.get('policyNumber'),date=rd,status='earned'))
for a2 in AG:
    for p in res[a2]['rows']:
        if p['fee'] and p['uw_to']=='Amanda Montano':
            flat.append(dict(kind='Underwriting work',amount=UW_FEE_A if p['uw_state']=='cleared' else 0.0,customer=p['customer'],carrier=p['carrier'],policy=p['policy'],date='',status='earned' if p['uw_state']=='cleared' else 'held - items still open ($10 when cleared)'))
A=res['Amanda Montano']; A['flat']=flat; A['agent_pay']=round(sum(f['amount'] for f in flat),2); A['agency']=round(A['gross']-A['agent_pay'],2)
for f in flat: print('  Amanda',f['kind'],f['amount'],f['customer'],f['status'])
print('  Amanda payable',A['agent_pay'],'| agency keeps',A['agency'])
res['_other']={k:dict(total=round(sum(t['comm'] for t in v),2),txns=v) for k,v in other.items()}
for k,v in res['_other'].items(): print(k,v['total'])
# binder entries in August for each agent with no carrier txn
on={(t['key']) for t in T}
miss=collections.defaultdict(list)
D=lambda s: re.sub(r'\D','',str(s or '')).lstrip('0')
for e in b:
    if e.get('agent') in AG and (e.get('entryDate') or '').startswith('2026-08') and e.get('policyType') in ('New','Rewrite'):
        if D(e.get('policyNumber')) not in on and re.sub(r'[^A-Z0-9]','',str(e.get('policyNumber')).upper()) not in on:
            miss[e['agent']].append(dict(date=e['entryDate'],carrier=e.get('company'),policy=e.get('policyNumber'),customer=e.get('customerName'),premium=e.get('basePremium')))
res['_missing']=miss
for k,v in miss.items(): print('no Aug carrier txn:',k,len(v),collections.Counter(x['carrier'] for x in v).most_common(6))
json.dump(res,open('statement_all.json','w'),indent=1,default=str)
