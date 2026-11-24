"""Uriel Rendon — September 2026 commission statement.

RULE (Uriel Rendon):
  * 50/50 commission split with the agency.
  * Before the split, a $10.00 Underwriting Pack fee is deducted from the
    commission on each new-business policy.
  * The $10.00 goes to whoever worked that policy's pending items in the
    Underwriting tab (the person recorded as clearing it). Policies with no
    pending items keep the $10 with the agency.
"""
import json, re
from collections import defaultdict, OrderedDict
UW_FEE = 10.00; SPLIT = 0.50
M = json.load(open('uriel_matched.json'))
b = json.load(open('raw_binderData.json'))[0]['value']
uw = json.load(open('raw_underwritingData.json'))[0]['value']
D = lambda s: re.sub(r'\D', '', str(s or ''))
byid = {e['id']: e for e in b}

# Attribution: a policy belongs to the agent on its most recent binder entry that names one.
latest_agent = {}
for e in sorted(b, key=lambda e: e.get('entryDate') or ''):
    k = D(e.get('policyNumber'))
    if len(k) >= 6 and e.get('agent'): latest_agent[k] = e['agent']
excluded = [t for t in M if latest_agent.get(D(t['policy'])) != 'Uriel Rendon']
M = [t for t in M if latest_agent.get(D(t['policy'])) == 'Uriel Rendon']

pol = OrderedDict()
for t in M:
    k = (t['carrier'], D(t['policy']))
    p = pol.setdefault(k, dict(carrier=t['carrier'], policy=t['policy'], customer=t['customer'], binder_id=t['binder_id'],
                               binder_type=t['binder_type'], binder_date=t['binder_date'], txns=[], comm=0.0, is_new=False))
    p['txns'].append(t); p['comm'] = round(p['comm'] + t['comm'], 2)
    if t['tran'].lower().startswith('new') and 'Renewal Year' not in t['tran'] and t['binder_type'] in ('New', 'Rewrite'):
        p['is_new'] = True

def uw_who(bid):
    e = byid.get(bid, {})
    pend = [x for x in (e.get('documentationStatus') or []) if x and x != 'Clean']
    if not pend: return 'Agency (no pending items)', 'none', pend
    r = uw.get(str(bid), {})
    items = r.get('items', {})
    outstanding = [x for x in pend if not (items.get(x) or {}).get('satisfied')]
    who = r.get('clearedBy') or ''
    if not who:
        best, at = '', -1
        for v in items.values():
            if v.get('satisfied') and (v.get('at') or 0) > at: best, at = v.get('by', ''), v.get('at') or 0
        if not best and r.get('contacts'): best = r['contacts'][-1].get('by', '')
        who = best
    if not outstanding: return who or 'Unassigned', 'cleared', pend
    return (who or 'Unassigned'), 'open', pend

for p in pol.values():
    p['fee'] = UW_FEE if (p['is_new'] and p['comm'] > 0) else 0.0
    p['net'] = round(p['comm'] - p['fee'], 2)
    p['uriel'] = round(p['net'] * SPLIT, 2)
    p['agency'] = round(p['net'] - p['uriel'], 2)
    p['uw_to'], p['uw_state'], p['pending'] = uw_who(p['binder_id']) if p['fee'] else ('', '', [])

rows = list(pol.values())
tot = lambda f: round(sum(r[f] for r in rows), 2)
summary = dict(gross=tot('comm'), fees=tot('fee'), net=tot('net'), uriel=tot('uriel'), agency=tot('agency'),
               new_count=sum(1 for r in rows if r['is_new']), fee_count=sum(1 for r in rows if r['fee']))
alloc = defaultdict(lambda: dict(count=0, amount=0.0, open=0))
for r in rows:
    if r['fee']:
        a = alloc[r['uw_to']]; a['count'] += 1; a['amount'] = round(a['amount'] + r['fee'], 2)
        if r['uw_state'] == 'open': a['open'] += 1
# Uriel's September binder business with no September carrier transaction.
on_stmt = {D(r['policy']) for r in rows}
missing = [e for e in b if e.get('agent') == 'Uriel Rendon' and (e.get('entryDate') or '').startswith('2026-09')
           and D(e.get('policyNumber')) not in on_stmt]
by_carrier = OrderedDict()
for r in rows:
    c = by_carrier.setdefault(r['carrier'], dict(new=0.0, other=0.0, comm=0.0, fee=0.0, net=0.0, uriel=0.0))
    c['new' if r['is_new'] else 'other'] += r['comm']
    for f in ('comm', 'fee', 'net', 'uriel'): c[f] += r[f]
for c in by_carrier.values():
    for f in c: c[f] = round(c[f], 2)
json.dump(dict(rows=rows, summary=summary, alloc=alloc, by_carrier=by_carrier,
               excluded=excluded, missing=[dict(date=e['entryDate'], type=e.get('policyType'), carrier=e.get('company'),
               policy=e.get('policyNumber'), customer=e.get('customerName'), premium=e.get('basePremium')) for e in missing]),
          open('statement.json', 'w'), indent=1, default=str)
print(json.dumps(summary, indent=1)); print(dict(alloc)); print(json.dumps(by_carrier, indent=1))
print('excluded', [(t['policy'], t['customer'], t['comm'], latest_agent.get(D(t['policy']))) for t in excluded])
print('missing', len(missing)); [print(' ', e['entryDate'], e.get('policyType'), e.get('company'), e.get('policyNumber'), e.get('customerName')) for e in missing]
for r in rows:
    if r['fee']: print(f"{r['customer'][:26]:26} {r['comm']:8.2f} -> {r['uw_to']} [{r['uw_state']}] {r['pending']}")
