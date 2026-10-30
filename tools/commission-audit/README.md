# Commission statement cross-check

Cross-references the commission-statement PDFs uploaded for one month (Admin ▸
Commission Statements ▸ Documents) against the entries credited to one agent for
that month, and writes a single-sheet workbook for manual verification.

Built to answer: *"check all the PDFs uploaded for June and give me the names
that are also on Jorge Castro's June 2026 commission."*

## Running it

```bash
pip install pdfplumber openpyxl
python fetch.py 2026 June "Jorge Castro"   # pulls PDFs + BinderBook data from Supabase
python extract.py                          # PDFs      -> pdf_rows.json
python build.py                            # matching  -> final_rows.json
python make_xlsx.py                        # workbook  -> *_CrossCheck.xlsx
```

`fetch.py` finds a month's uploads by the client key the app files them under,
`MonthlyDocs_<year>_<Month>` (see `mdocClientKey()` in `app.js`), and flags
same-size files so duplicate uploads are visible.

## Why it is not a string comparison

Every carrier prints insured names differently, and two of the sources truncate:

| Source | Format | Example |
|---|---|---|
| Amwins | surname first | `QUINONES SANCHEZ LUIS` |
| Progressive | surname + first initial, surname truncated ~12 chars | `FLORES JARAM I.` |
| Kemper | `Last, First` | `PEREZ ROY, JUAN` |
| GEICO | given name first, wrapped over 3 rows | `ANISLEY LOPEZ BROCHE` |
| United Auto | given name first, whole name truncated at 20 chars | `Oreste Canizares Gonz` |
| Ocean Harbor | `Last, First M` | `Forero Avendano, Javier A` |

So `names.py` splits each format into (surname, given name) and compares those
parts with prefix tolerance, instead of comparing raw strings. A shared surname
alone is not a match — the given name has to agree too, or the pair is ranked
down. Policy numbers are compared as digits only, which is the one fully
reliable key.

## Trusting the extraction

`extract.py` is checked against the total each carrier prints on its own
statement. All four reconcile exactly:

| PDF | Rows | Insureds | Parsed | Printed on statement |
|---|---|---|---|---|
| Amwins Specialty Auto | 9 | 7 | $72.34 | $72.34 |
| Progressive | 188 | 138 | $14,289.02 | $14,289.02 |
| Kemper Auto | 27 | 20 | $656.60 | $656.60 |
| GEICO | 38 | 19 | $2,267.79 | $2,267.79 |

If a parser silently drops rows, these stop matching — re-run and check before
trusting any output.

## Ranking in the output

| Rank | Meaning |
|---|---|
| A | Same policy number on both sides. Confirmed. |
| B | Surname and first name (or initial) both agree. |
| C | Surname agrees, first name differs or is not printed. Needs a human. |
| D | Common surname only, first names differ. Almost certainly a different person. |
