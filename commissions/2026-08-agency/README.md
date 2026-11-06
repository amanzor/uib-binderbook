# August 2026 — agency commissions, all agents except Jorge Castro

Jorge Castro's August statement was already issued (Admin ▸ Commission Statements ▸
`AgentStmt_Jorge Castro_2026_August`, gross $11,712.56). This prices **everyone else** off the
six carrier statements uploaded for August (`MonthlyDocs_2026_August`).

## Every carrier read ties to its printed total

| Carrier | Parsed | Printed |
|---|---:|---:|
| Progressive | $19,468.25 | AGENT TOTAL $19,468.25 |
| Kemper / Infinity | $3,596.22 | FL COMMISSION TOTAL $3,596.22 |
| GEICO | $2,396.88 | Commissions $2,396.88 |
| Ocean Harbor | $831.00 | Commission Due $831.00 |
| AmWins | $71.30 | AGENCY TOTAL $71.30 (10% of net cash) |
| United Auto | ($50.85) | 10% as collected; with the 3% promo ($127.45 chargeback, excluded) = $178.30 owed back, as printed |
| **Total** | **$26,312.80** | |

**No National General statement is in the August uploads.** Jorge's statement carries $593.64 of
National General, so a file existed somewhere; nobody else's National General is included here.

## Result

| Agent | Rule applied | Gross | UW fees | **Agent payable** | Agency keeps |
|---|---|---:|---:|---:|---:|
| Uriel Rendon | 50/50 after $10 UW pack fee on new business (his documented rule) | $5,354.57 | ($280.00) | **$2,537.28** | $2,817.29 |
| Randy Diaz | 50% (app default — confirm) | $3,546.73 | — | **$1,773.36** | $1,773.37 |
| Amanda Montano | flat fees only — agency keeps her clients' commission | $3,990.36 | — | **$70.00** | $3,920.36 |
| Lazaro Reigoza | 50% — carrier statements + August new business from the binder | $2,657.80 | — | **$1,328.89** | $1,328.91 |
| Alberto Manzor | house book — no payout | $323.07 | — | — | $323.07 |
| Jorge Castro | already on his August statement | $11,118.92 | | | |
| Jorge's book, *not* on his Aug statement | review | $203.90 | | | |
| Unmatched | review | $321.80 | | | |
| **Total** | | **$27,517.15** ($26,312.80 statements + $1,204.35 binder new business) | | | |

Uriel's 28 UW pack fees: 26 agency (no pending items), 1 Amanda Montano (items still open),
1 held (not worked yet).

### Lazaro Reigoza — August new business added from the binder book
His three August new-business policies are on no uploaded carrier statement, so they are added
from the binder book at commission + agency fee, split 50%:

| Insured | Carrier | Commission | Agency fee | Lazaro 50% |
|---|---|---:|---:|---:|
| Traffic Systems Technology (surety bond) | Philadelphia Indemnity | $661.30 | $0.00 | $330.65 |
| DF Painting Services (GL) | Spinnaker | $56.90 | $281.00 | $168.95 |
| Home Art's Design (inland marine) | Spinnaker | $101.50 | $103.65 | $102.58 |
| **Total** | | **$819.70** | **$384.65** | **$602.18** |

Plus $726.71 (50% of $1,453.45 carrier-statement commission) = **$1,328.89**.

### Amanda Montano — flat-fee rule
No percentage: the agency keeps all commission on her clients ($3,990.36 in August). She is paid
**$25 per new policy** she writes, **$10 per policy whose Underwriting-tab items she clears**, and
**$10 per renewal she renews in the AMS** (Renewals ▸ Renewed, renewal date in the month).

| Fee | August | Amount |
|---|---|---:|
| New policies | Michel Hernandez Esnard (Ocean Harbor), Billal Chahine (Infinity) | $50.00 |
| AMS renewals | Ivette Borrell (8/26), Yerandy Carrazana (8/29) | $20.00 |
| Underwriting work | Scott Kupersmith (Uriel) — items still open, $10 held until cleared | $0.00 |
| **Payable** | | **$70.00** |

Tijana Olsen 862628611 has an 8/27 imported renewal row, but the same policy was renewed in the AMS
effective 9/5, so it counts in September. The Underwriting tab only holds September-onward
policies, so August has no other underwriting work recorded.

## How a transaction is assigned

1. **Jorge first** — each line on his issued August detail statement is matched to the carrier
   transactions by policy number and amount; those are his and are excluded.
2. **Binder book by policy number** — agent on the most recent binder entry for that policy.
   Policies Jorge owns whose August activity was *not* on his statement go to the
   "Jorge's book, not on his statement" review bucket, never to another agent.
3. **Progressive producer column** (MANZOR, ALBERTO / MONTANO, AMANDA) when the binder has no match.
4. **Insured name** against the binder (same carrier preferred, latest entry). Most of these are
   the same policy with a new term suffix (e.g. Ocean Harbor `…306` → `…308`).

## Review items (workbook ▸ Review Items)

- **Unmatched $321.80**: Kemper Heric Melo 50035563801 New $171.80; Progressive Gonzalez E.
  868925218 $82.70 and Cruz M. 48386315 $67.30 (both "Unassigned" producer).
- **Jorge's book, not on his statement, net $203.90**: $768.07 of Progressive on Jorge binder
  policies (e.g. 879038354, 972778107, 986257767) and $564.17 of United chargebacks
  (cancellations on UAO-000694805, UAO-000695126, UAM-003007497, UAE-000268427, UAO-062029202
  "Done By Alberto"). Decide whether to adjust Jorge's next statement.
- **Split for Randy** is the app's default 50% `agentCommissionShare`;
  no written rule exists for them in the repo.
- Workbook ▸ *Aug Binder - No Carrier Txn*: August new business with no August carrier
  transaction (mostly carriers with no uploaded statement — Spinnaker, UPC, Landmark, etc.).

## Deliverables

- `<Agent>_Commission_Statement_August_2026.pdf` — one per agent: rule, summary, by carrier, detail by policy.
- `UIB_Agency_Commissions_August_2026.xlsx` — Agency Summary, By Carrier, Policy Detail, Review Items,
  Aug Binder - No Carrier Txn.

## Rebuilding

```
mkdir -p aug && cd aug && python3 ../../../tools/commission-audit/fetch.py 2026 August && cd ..
#  plus Jorge's Detailed statement from AgentStmt_Jorge Castro_2026_August into aug/jorge/,
#  raw_amsClientData / raw_underwritingData from app_store, and pdftotext -layout on each PDF
python3 parse_aug.py aug/pdfs      # Progressive, Kemper, United, AmWins, Ocean -> carriers.json
python3 parse_geico.py aug/pdfs    # GEICO
python3 parse_jorge.py aug/jorge/<Detailed>.txt
python3 match_all.py && python3 fallback.py && python3 build_all.py
OUT=. python3 make_outputs.py
```
