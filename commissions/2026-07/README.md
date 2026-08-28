# Doral Office Binder Book — July 2026 Commission Statement

Prices every policy on the Doral office binder book (producer Jorge Castro,
07/01/2026 – 07/31/2026) against the seven carrier commission statements for the
same month, using the commission rate each carrier prints on its own statement,
and folds in every wider-book client who had a positive or negative commission
transaction. Matching is by **policy number**, cross-checked on surname.

## Result

| | Policies | Commission |
|---|---:|---:|
| New Business (binder sheet) | 21 | $3,057.29 |
| Renewals & Adjustments | 49 renewals + wider-book activity | $6,459.31 |
| **Total Gross Commission** | | **$9,516.60** |

159 carrier transactions matched the Doral book (71 on the July binder sheet,
88 wider-book); 277 more belonged to the agency's other offices and are excluded.
**Every carrier read ties exactly to the total that carrier prints.**

| | |
|---|---:|
| Gross Commissions | $9,516.60 |
| Royalty (15%) | ($1,427.49) |
| **Paid to Doral** | **$8,089.11** |
| 220 License Rent | ($500.00) |
| Systems | ($224.00) |
| MVRs | ($8.36) |
| **Net to Doral** | **$7,356.75** |

## Commission summary by carrier

| Carrier | New Business | Renewals & Adj. | Total | Statement total |
|---|---:|---:|---:|---:|
| Progressive | $2,111.10 | $6,028.78 | $8,139.88 | $17,885.65 |
| United Auto | $30.62 | $339.50 | $370.12 | ($589.59) net |
| Infinity (Kemper) | $0.00 | ($17.86) | ($17.86) | $3,714.35 |
| National General | $164.50 | ($106.28) | $58.22 | $658.32 |
| GEICO | $577.91 | $100.32 | $678.23 | $9,009.15 |
| AmWins | $0.00 | $37.93 | $37.93 | $78.74 |
| Ocean Harbor | $173.16 | $76.92 | $250.08 | $250.08 |
| **Total** | **$3,057.29** | **$6,459.31** | **$9,516.60** | |

"Statement total" is what each carrier prints for the whole agency; the Doral
columns are this office's share, matched by policy number.

## Sources and rates

| Carrier | Statement | Rate | Basis |
|---|---|---|---|
| Progressive | Detailed Statement 07/2026 (agent total $17,885.65) | 8–14% per policy | Gross premium |
| Infinity | Kemper Auto Monthly Producer Statement (agent 5517897) | 10% | Premium |
| United Auto | United Insurance Group (agent 001-1D-100208) | **10% as collected** | Premium collected this month |
| Ocean Harbor | Pearl Holding Group (producer 6883) | 11%, 13% on new | Premium, fee excluded |
| National General | Commission Statement 07/2026 (code 9019644) | 10% | Written premium |
| AmWins | Amwins Specialty Auto of Florida (agent 246500) | **10% of net cash** | Net cash collected this month |
| GEICO | GEICO Commission Statement (Universal Brokers) | 10/12/15% | Comm premium |

**United Auto and AmWins are booked on the monthly as-collected basis, not on
gross written premium**, per instruction. United earns 10% only on premium
United actually collected in July (its separate 3% promotional incentive,
$23.92 agency-wide, is excluded); AmWins earns 10% of the net cash it collected.

## Review items (see the workbook's Notes & Exceptions tab)

1. **Melissa A Taylor (Progressive 876394907)** — the binder lists her as active
   New ($1,404), but Progressive's July statement shows a full cancellation
   (−$1,227 at 12% = −$147.24). She earned +$147.24 on it in June, so it nets to
   zero across the two months. Shown at the carrier figure (−$147.24); confirm
   the binder status.
2. **Ocean Harbor** is recorded in full as its producer-6883 statement shows —
   all five lines, including Ertas Meral (+$118.91) and Morin George (−$64.87) —
   so the section foots to the statement's $250.08 Commission Due.
3. **Office-only expense lines** — 220 License Rent ($500) and Systems ($224) are
   the office figures provided for July; the Cash Payments Owed line is removed
   for now. They appear on no carrier statement.

## Binder policies with no carrier commission this month ($0)

Likely billed in an adjacent statement period, or pending/canceled:
Luis Chacon Pena, Emiley Blomberg, Guillermo Fayas Rodriguez, Karen A Morales
(pending) and Hector L Parra Salcedo (Progressive); Alex Cruz and Tammie Goa
(Ocean Harbor); Kevin D Jimenez Aguero (National General).

## Deliverables

- `Monthly_Commission_Statement_Doral_July_2026.pdf` — one-page carrier summary,
  royalty, operating expenses, net to Doral.
- `Detailed_Commission_Statement_Doral_July_2026.pdf` — one row per insured,
  grouped by carrier with carrier totals, Pos/Neg column, grand total.
- `Doral_Binder_Book_July_2026_Commissions.xlsx` — Commission Summary,
  Transaction Detail (all 159 matched transactions, binder-flagged), Carrier
  Recap, Notes & Exceptions.
- `July_2026_Binder_Roster.md` — the extracted binder sheet (21 new, 49 renewals).

## Rebuilding

Source statements expected in this directory (as supplied).

```
python3 parse_binder.py      # JULY 26 binder tab   -> binder.json
python3 parse_bookall.py     # full book of business -> book_all.json
python3 parse_carriers.py    # 7 carrier PDFs        -> carriers.json  (each ties to its printed total)
python3 match_book.py        # match all statements to the book -> bookmatch.json
python3 pdf_data.py          # assemble summary      -> pdf_data.json
python3 make_pdfs.py         # -> both PDFs
python3 build.py             # -> commission workbook
```
