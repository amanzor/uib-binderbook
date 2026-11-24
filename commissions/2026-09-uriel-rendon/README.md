# Uriel Rendon — September 2026 Commission Statement

## Commission rule — Uriel Rendon

1. **50/50 split.** Uriel is paid 50% of the commission on his policies; the agency keeps 50%.
2. **$10.00 Underwriting Pack fee, taken before the split.** $10.00 is deducted from the
   commission on each new-business policy, and the remainder is split 50/50.
3. **The $10.00 goes to whoever works the policy's pending items in the Underwriting tab**
   (the person recorded as clearing them). No pending items: the agency keeps the $10.
   Items still open: the $10 is held until someone clears them.

Renewals, endorsements, cancellations and other adjustments are split 50/50 with no fee.
A policy whose commission nets to $0 or less on the statement (e.g. written and cancelled
flat) takes no fee.

## Result

| | |
|---|---:|
| Gross commission (September carrier statements) | $8,361.37 |
| Underwriting Pack fees (49 × $10) | ($490.00) |
| Net to split | $7,871.37 |
| Agency 50% | $3,935.67 |
| **Payable to Uriel 50%** | **$3,935.70** |

| Carrier | Gross | UW fees | Uriel 50% |
|---|---:|---:|---:|
| Progressive | $6,278.17 | ($410.00) | $2,934.10 |
| Kemper / Infinity | $838.80 | ($20.00) | $409.40 |
| GEICO | $995.20 | ($50.00) | $472.60 |
| National General | $249.20 | ($10.00) | $119.60 |

Underwriting Pack fees: Amanda Montano 6 ($60 — 2 cleared, 4 still open), held / not yet
worked 4 ($40), agency (no pending items) 39 ($390).

## Sources

The September 2026 uploads (Admin ▸ Commission Statements ▸ Documents,
`MonthlyDocs_2026_September`), matched to Uriel's binder book by policy number. Every
carrier read ties to its printed total: Progressive $18,419.97, Kemper $4,823.01,
GEICO $8,349.25, National General $700.33. Ocean Harbor, United and AmWins carried no
Uriel policies. A policy is attributed to the agent on its most recent binder entry.

## Rebuilding

```
python3 ../../tools/commission-audit/fetch.py 2026 September   # into ./sep (pdfs + raw_*.json)
# Progressive + Kemper: ../2026-07/parse_carriers.py pointed at the September files -> work/carriers.json
python3 parse_extra.py      # GEICO + National General      -> extra.json
python3 match.py            # match to Uriel's book        -> uriel_matched.json
python3 build_statement.py  # apply the rule               -> statement.json
python3 make_outputs.py     # PDF + workbook
```
