"""Jorge Castro's already-issued August statement (Detail by Carrier) -> jorge_aug.json,
so his transactions are left out of everyone else's figures."""
import re,json,sys
T=open(sys.argv[1]).read().splitlines()
CARS=['PROGRESSIVE','UNITED AUTO','INFINITY','NATIONAL GENERAL','AMWINS','OCEAN HARBOR','GEICO']
car=None; rows=[]
for ln in T:
    s=ln.strip()
    if any(s.upper().startswith(c) and len(s)<30 and '$' not in s for c in CARS): car=s.upper(); continue
    m=re.match(r'^(?P<name>.+?)\s{2,}(?:(?P<pol>[A-Z0-9-]{6,})\s+)?(?P<type>New Business|Renewal|Endorsement|Cancellation|Adjustment|Reinstatement|Rewrite|Other|As Collected|[A-Za-z ]+?)\s+(?P<c>\(?-?\$[\d,]+\.\d\d\)?)\s+(Positive|Negative)',s)
    if m:
        c=m.group('c'); v=float(re.sub(r'[^\d.]','',c))*(-1 if '(' in c or '-' in c else 1)
        rows.append(dict(carrier=car,name=m.group('name').strip(),policy=m.group('pol') or '',type=m.group('type'),comm=v))
print(len(rows),'rows', round(sum(r['comm'] for r in rows),2),'(statement 11,712.56)')
json.dump(rows,open('jorge_aug.json','w'),indent=1)
