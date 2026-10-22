"""Extract insured names + row detail from the four unique June-2026 PDFs."""
import collections, json, re
import pdfplumber

DATE = re.compile(r'^\d{2}/\d{2}/\d{4}$')
MONEY = re.compile(r'^\(?-?\$?[\d,]+\.\d{2}\)?$')


def rows_of(page):
    """Group a page's words into visual rows keyed by rounded top coordinate."""
    buckets = collections.defaultdict(list)
    for w in page.extract_words():
        buckets[round(w['top'])].append(w)
    return [(t, sorted(buckets[t], key=lambda w: w['x0'])) for t in sorted(buckets)]


def txt(words, lo=None, hi=None):
    return ' '.join(w['text'] for w in words
                    if (lo is None or w['x0'] >= lo) and (hi is None or w['x0'] < hi))


# ── Amwins ────────────────────────────────────────────────────
# 246500 FFL01008512 06/29/2026 GEJO ANGELY $248.00 ... 10% $16.47
def parse_amwins(path):
    out = []
    pat = re.compile(
        r'^(\d{6})\s+(\S+)\s+(\d{2}/\d{2}/\d{4})\s+(.+?)\s+\$-?[\d,]+\.\d{2}.*?(\$-?[\d,]+\.\d{2})\s*$')
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            for line in (page.extract_text() or '').split('\n'):
                m = pat.match(line.strip())
                if m:
                    out.append({'name': m.group(4).strip(), 'policy': m.group(2),
                                'date': m.group(3), 'commission': m.group(5), 'producer': ''})
    return out


# ── Kemper ────────────────────────────────────────────────────
# 50030429301-1 Almonte, Manuela  06/05/2026 ENDORSE 0.1 $84.00 ... $8.40
def parse_kemper(path):
    out = []
    pat = re.compile(
        r'^(\d{8,}-\d+)\s+(.+?)\s+(\d{2}/\d{2}/\d{4})\s+(\S+)\s+[\d.]+\s+.*?(-?\$[\d,]+\.\d{2})\s*$')
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            for line in (page.extract_text() or '').split('\n'):
                m = pat.match(line.strip())
                if m:
                    out.append({'name': m.group(2).strip(), 'policy': m.group(1),
                                'date': m.group(3), 'tran': m.group(4),
                                'commission': m.group(5), 'producer': ''})
    return out


# ── Progressive ───────────────────────────────────────────────
# Name lines sit left (x<200) above a policy-number line at x=41.
# Producer name sits far right (x>=880) across two rows.
def _prog_name_part(words):
    """Insured-name text in the left column, minus policy numbers and dates."""
    keep = [w['text'] for w in words
            if w['x0'] < 150
            and not DATE.match(w['text'])
            and not (w['text'].isdigit() and len(w['text']) >= 8)
            and w['text'] != '-']
    part = ' '.join(keep).strip()
    return part if any(c.isalpha() for c in part) else ''


def _prog_producer(rows, top):
    """Producer name wraps as 'MANZOR,' / 'ALBERTO' on the rows flanking the data row."""
    toks = [w['text'] for t, ws in rows if abs(t - top) <= 9
            for w in sorted(ws, key=lambda w: w['x0']) if w['x0'] >= 880]
    if not toks:
        return ''
    surname = [t.rstrip(',') for t in toks if t.endswith(',')]
    given = [t for t in toks if not t.endswith(',')]
    if surname:
        return ' '.join(given + surname).title()
    return ' '.join(given).title()


def parse_progressive(path):
    out = []
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            page_rows = rows_of(page)
            name_buf, policy, recs = [], '', []
            for row_top, words in page_rows:
                # A policy number is an 8-9 digit token in the far-left column.
                for w in words:
                    if w['x0'] < 60 and w['text'].isdigit() and 8 <= len(w['text']) <= 9:
                        policy = w['text']

                # The data row (a transaction date at x~331) closes the record.
                if any(abs(w['x0'] - 331) < 8 and DATE.match(w['text']) for w in words):
                    # Short records carry the name on the data row itself.
                    inline = _prog_name_part(words)
                    nums = [w['text'] for w in words if 700 < w['x0'] < 820]
                    date = [w['text'] for w in words if abs(w['x0'] - 331) < 8]
                    rec = {'name': ' '.join(name_buf + ([inline] if inline else [])).strip(),
                           'policy': policy, 'date': date[0],
                           'commission': nums[-1] if nums else '',
                           'tran': txt(words, 245, 330).strip(),
                           'producer': _prog_producer(page_rows, row_top)}
                    recs.append(rec)
                    out.append(rec)
                    name_buf, policy = [], ''
                    continue

                part = _prog_name_part(words)
                if part and not part.startswith('Insured'):
                    name_buf.append(part)
    return [r for r in out if r['name']]


# ── GEICO ─────────────────────────────────────────────────────
# Each record = a data row (agent id at x=30) with the insured name split
# across the row above and the row below, in the x 182..250 column.
def parse_geico(path):
    out = []
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            rows = rows_of(page)
            for top, words in rows:
                first = words[0]
                if not (first['x0'] < 40 and re.match(r'^[A-Z]\d{6}$', first['text'])):
                    continue
                # One record occupies a band of rows around its data row
                # (records repeat every ~36pt, so +/-13 stays inside this one).
                block = [w for t, ws in rows if abs(t - top) <= 13 for w in ws]
                block.sort(key=lambda w: (w['top'], w['x0']))

                # The insured name wraps down the 182..250 column; the policy
                # effective date crowds its right edge.
                name = ' '.join(w['text'] for w in block
                                if 182 <= w['x0'] < 250 and not DATE.match(w['text']))
                policy = ''.join(w['text'] for w in block if 132 <= w['x0'] < 182)
                agent = ' '.join(w['text'] for w in block if 75 <= w['x0'] < 132).title()
                money = [w['text'] for w in words if 640 < w['x0'] < 700]
                dates = [w['text'] for w in words if DATE.match(w['text'])]
                if name:
                    out.append({'name': name, 'policy': policy,
                                'date': dates[1] if len(dates) > 1 else '',
                                'commission': money[0] if money else '',
                                'producer': agent})
    return out


SOURCES = [
    ('Amwins Specialty Auto', 'pdfs/01_Amwins_Comm.PDF', parse_amwins),
    ('Progressive', 'pdfs/02_DetailedStatement20260717.pdf', parse_progressive),
    ('Kemper Auto', 'pdfs/03_07b3dbfb-9753-4c12-b5b6-8a1869835bb5.pdf', parse_kemper),
    ('GEICO', 'pdfs/04_Commission_Statement_(35).pdf', parse_geico),
]

if __name__ == '__main__':
    all_rows = []
    for carrier, path, fn in SOURCES:
        rows = fn(path)
        for r in rows:
            r['carrier'] = carrier
            r['file'] = path.split('/')[-1]
        all_rows += rows
        names = sorted({r['name'] for r in rows})
        print(f'{carrier:24} {len(rows):4} rows  {len(names):3} names')
        for n in names:
            print('      ', n)
    json.dump(all_rows, open('pdf_rows.json', 'w'), indent=1)
    print('TOTAL rows', len(all_rows))
