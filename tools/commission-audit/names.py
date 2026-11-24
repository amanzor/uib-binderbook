"""Split each source's insured-name format into (surname tokens, given tokens).

Every carrier prints names differently, and United Auto truncates at 20
characters, so a raw string comparison is useless. Knowing which part is the
surname is what makes "same person / different person" decidable.
"""
import re, unicodedata

SUFFIX = {'JR', 'SR', 'II', 'III', 'IV'}


def _tokens(s):
    s = unicodedata.normalize('NFKD', s or '').encode('ascii', 'ignore').decode()
    s = re.sub(r"[^A-Za-z, ]", ' ', s.replace('-', ' ')).upper()
    return s


def split(name, fmt):
    """Return (surnames, givens). Either list may be empty when unknowable."""
    s = _tokens(name)
    if fmt == 'comma':                      # "PEREZ ROY, JUAN"
        if ',' in s:
            a, b = s.split(',', 1)
            return _clean(a), _clean(b)
        return _clean(s), []
    t = _clean(s.replace(',', ' '))
    if not t:
        return [], []
    if fmt == 'given_first':                # "IRIS LOPEZ SANCHEZ", "Marlene Castillo"
        return t[1:] or [t[0]], [t[0]]
    if fmt == 'surname_first':              # Amwins "QUINONES SANCHEZ LUIS"
        return t[:1], t[1:]
    if fmt == 'surname_initial':            # Progressive "LOPEZ PINA S."
        raw = [x for x in s.replace(',', ' ').split() if x]
        init = [x[0] for x in raw if len(x.replace('.', '')) == 1]
        return [x for x in t if len(x) >= 2], init
    return t, []


def _clean(s):
    return [x for x in s.split() if len(x) >= 2 and x not in SUFFIX]


def tok_match(a, b):
    n = min(len(a), len(b))
    return n >= 4 and a[:n] == b[:n]


def surname_agrees(s1, s2):
    return any(tok_match(a, b) for a in s1 for b in s2)


def given_agrees(g1, g2):
    """True/False when decidable, None when one side gives us nothing."""
    if not g1 or not g2:
        return None
    for a in g1:
        for b in g2:
            if len(a) == 1 or len(b) == 1:
                if a[0] == b[0]:
                    return True
            elif tok_match(a, b):
                return True
    return False


FORMATS = {
    'Amwins Specialty Auto': 'surname_first',
    'Progressive': 'surname_initial',
    'Kemper Auto': 'comma',
    'GEICO': 'given_first',
    'United Auto statement': 'given_first',
    'Ocean Harbor statement': 'comma',
    'Binder book (his own June entry)': 'given_first',
}


def money(s):
    """Parse a statement amount: '$1,234.56', '-$12.00', '($8.97)'."""
    s = (s or '').strip()
    neg = s.startswith('(') and s.endswith(')')
    v = re.sub(r'[^\d.\-]', '', s)
    if v in ('', '-', '.'):
        return 0.0
    return -float(v) if neg else float(v)
