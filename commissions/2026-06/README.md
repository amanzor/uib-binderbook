# Doral Office Binder Book — June 2026 Commission Statement

`Doral_Binder_Book_June_2026_Commissions.xlsx` prices every policy on the Doral
office binder book (producer Jorge, 06/01/2026–06/30/2026) against the carrier
commission statements for the same month, using the commission rate each carrier
prints on its own statement. All six carriers on the binder are now covered.

## Result

| | Policies | Commissionable premium | Commission |
|---|---:|---:|---:|
| New business | 18 | $27,628.89 | $3,115.24 |
| Renewals | 45 | $34,604.14 | $3,499.29 |
| **Total** | **63** | **$62,233.03** | **$6,614.53** |

52 of the 63 binder policies were found on a carrier statement.

## Tabs

- **Commission Summary** — one row per binder policy, in binder order, split into
  new business and renewals with subtotals.
- **Transaction Detail** — all 384 transactions from the seven statements,
  flagged for whether they belong to a Doral binder client. Blue figures come
  straight from the carrier; column L re-performs each as basis × rate and column
  M shows the difference.
- **Carrier Recap** — per-carrier totals and the Doral book's share of each
  statement.
- **Notes & Sources** — method, tie-outs, and the exceptions below.

## Sources and rates

| Carrier | Statement | Rate shown | Basis | Statement total |
|---|---|---|---|---:|
| Progressive | Detailed Statement 06/2026 (agent 24258) | 8–14%, varies by policy | Gross premium | $14,289.02 |
| Infinity | Kemper Auto Monthly Producer Statement (agent 5517897) | 10% | Premium | $656.60 |
| United Auto | United Insurance Group Direct Billing (agent 001-1D-100208) | 10% + 3% promotional incentive | Premium collected | $444.33 |
| Ocean Harbor | Pearl Holding Group (producer code 6883) | 11%, 13% on some | Premium, fee excluded | $326.21 |
| National General | Commission Statement 06/2026 (Princeton code 9019644) | 10% | Written premium | $871.27 |
| AmWins | Amwins Specialty Auto of Florida (agent 246500) | 10% | Net cash | $72.34 |
| GEICO | GEICO Commission Statement | 10/12/15% | Comm premium | $2,267.79 |

Matching is by policy number, not by name.

## Things to know when reading it

- **United pays as collected.** Most United policies are direct bill, so June
  earns commission only on premium United actually collected in June — not the
  full term premium. Luis A. Ortiz shows $163.60 commissionable against a
  $1,103.35 binder premium; the rest earns on later monthly statements. The four
  United new-business policies (Gustave, Cordero, Vazquez, Howard) are on full
  premium.
- **United's statement nets to $444.33** for the whole agency because
  cancellations on non-Doral policies charge back over $1,300. The Doral book
  itself earned $1,155.38, so its share of that statement reads over 100%.
- **Binder Premium and Commissionable Premium are not meant to agree.** The
  binder figure is full term premium including MVR and policy fees; the
  commissionable figure is what the carrier actually paid on this month.
- **United truncates its 3% incentive** to the cent instead of rounding. Two
  Doral clients (Sandra Zambrana, Luis A. Ortiz) are each a penny under a
  straight 3%. The carrier figure is the one carried into the totals.

## Exceptions

- **On the binder, not on the June Progressive statement** — 6 renewals:
  Amarillys Gonzalez (970306264), Brudys Garcia (990100610), Yosvany Larralde
  (982064065), Ana G Castano (866496112), Manuel Martinez (990228513), Reysel
  Castillo (970570633). Likely fell into the May or July statement period.
- **No June activity (correctly $0)** — 5 policies effective late 2025 on
  12-month terms: Levy Diaz Torres, Elizabeth Mirabal Hernandez, Ana Maria
  Acosta, James John Ciullo (Infinity) and Armando Caralos (National General).
- **GEICO** — no Doral binder client appears on it; it covers writing agents
  Alberto Manzor Jr and Amanda Montano. Included on Transaction Detail for
  completeness only, contributing $0 to the Doral totals.

## Controls

- Binder premium column reproduces the binder sheet's own totals: $29,109.40 new
  ($28,891.00 base + $218.40 MVR/fees) and $49,272.55 renewals.
- Each carrier statement was re-added from its transaction lines and agreed to
  the total the carrier printed.
- Pearl Holding's statement is a scanned image and was read by OCR. The reading
  is confirmed three ways: the six lines re-add to the printed $326.21 Commission
  Due, every line reproduces as premium × rate, and both Doral policy numbers and
  premiums agree with the binder sheet ($1,153 + $35 fee = $1,188 on the binder;
  $1,141 + $35 = $1,176).
- Column M of Transaction Detail is $0.00 on all 384 transactions except the
  seven United promotional-incentive lines described above.
- The seven statements are issued to different agency codes and letterheads
  (Universal Brokers LLC, Creative Insurance Agency, producer code 6883,
  Princeton code 9019644). Every Doral policy number still matched its carrier
  statement exactly, so these are alternate identities for the same book.

## Rebuilding

Scripts expect the eight source files in the working directory. Pearl Holding
needs `pdftoppm` + `tesseract` (its embedded font has no usable encoding).

```
python3 parse_binder.py      # binder PDF text -> binder.json
python3 parse_carriers.py    # Kemper / AmWins / Progressive -> carriers.json
python3 geico_parse.py       # GEICO PDF -> geico.json
python3 parse_new3.py        # United / Ocean Harbor / National General -> carriers2.json
python3 build.py             # -> Doral_Binder_Book_June_2026_Commissions.xlsx
```

Then recalculate the formulas (LibreOffice Calc required) before shipping.
