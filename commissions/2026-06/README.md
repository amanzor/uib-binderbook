# Doral Office Binder Book — June 2026 Commission Statement

`Doral_Binder_Book_June_2026_Commissions.xlsx` prices every policy on the Doral
office binder book (producer Jorge, 06/01/2026–06/30/2026) against the carrier
commission statements for the same month, using the commission rate each carrier
prints on its own statement.

## Result

| | Policies | Commissionable premium | Commission |
|---|---:|---:|---:|
| New business | 18 | $19,731.29 | $2,088.56 |
| Renewals | 45 | $28,848.44 | $2,884.85 |
| **Total** | **63** | **$48,579.73** | **$4,973.41** |

38 of the 63 binder policies were found on a carrier statement.

## Tabs

- **Commission Summary** — one row per binder policy, in binder order, split into
  new business and renewals with subtotals.
- **Transaction Detail** — all 262 transactions from the four carrier statements,
  flagged for whether they belong to a Doral binder client. Commission is
  recalculated in-cell as basis × rate.
- **Carrier Recap** — per-carrier totals and the Doral book's share of each
  statement.
- **Notes & Sources** — method, tie-outs, and the exceptions listed below.

## Sources

| Carrier | Statement | Rate shown | Statement total |
|---|---|---|---:|
| Progressive | Detailed Statement 06/2026 (agent 24258) | 8–14%, varies by policy | $14,289.02 |
| Infinity | Kemper Auto Monthly Producer Statement (agent 5517897) | 10% | $656.60 |
| AmWins | Amwins Specialty Auto of Florida (agent 246500) | 10% of net cash | $72.34 |
| GEICO | GEICO Commission Statement (Universal Brokers LLC) | 10/12/15% | $2,267.79 |

Matching is by policy number, not by name.

## Exceptions

- **No statement supplied** — United Auto (10 policies), Ocean Harbor (2) and
  National General (3). Those 15 policies cannot be commissioned until the
  statements are provided.
- **On the binder, not on the June Progressive statement** — 6 renewals:
  Amarillys Gonzalez (970306264), Brudys Garcia (990100610), Yosvany Larralde
  (982064065), Ana G Castano (866496112), Manuel Martinez (990228513), Reysel
  Castillo (970570633). Likely fell into the May or July statement period.
- **No June activity (correctly $0)** — 4 Infinity policies effective December
  2025 on 12-month terms: Levy Diaz Torres, Elizabeth Mirabal Hernandez, Ana
  Maria Acosta, James John Ciullo.
- **GEICO** — no Doral binder client appears on it; it covers writing agents
  Alberto Manzor Jr and Amanda Montano. Included on Transaction Detail for
  completeness only, contributing $0 to the Doral totals.

## Controls

- Binder premium column reproduces the binder sheet's own totals: $29,109.40 new
  ($28,891.00 base + $218.40 MVR/fees) and $49,272.55 renewals.
- Each carrier statement was re-added from its transaction lines and agreed to
  the total the carrier printed.
- All 262 transactions reproduce the carrier-printed commission to the cent as
  basis × rate.

## Rebuilding

Scripts expect the five source files in the working directory.

```
python3 parse_binder.py      # binder PDF text  -> binder.json
python3 parse_carriers.py    # Kemper/AmWins/Progressive -> carriers.json
python3 geico_parse.py       # GEICO PDF        -> geico.json
python3 build.py             # -> Doral_Binder_Book_June_2026_Commissions.xlsx
```

Then recalculate the formulas (LibreOffice Calc required) before shipping.
