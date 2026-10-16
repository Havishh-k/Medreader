"""Reference implementation / executable spec of the label validation engine and safety gate.

The Kotlin port must reproduce the behaviour of every test in test_label_logic.py.
NOTE: fixture drug data used by tests is illustrative test data, NOT authoritative medical data.
"""
from __future__ import annotations

import math
import re
import sqlite3
from collections import Counter
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal
from pathlib import Path

SCHEMA_PATH = Path(__file__).with_name("schema.sql")

# --------------------------------------------------------------------------- 1. Normalisation
_ALPHABET = " ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"          # 37 symbols
_IDX = {c: i for i, c in enumerate(_ALPHABET)}
_SKEL = str.maketrans({"0": "O", "1": "I", "L": "I", "5": "S", "8": "B", "2": "Z", "6": "G", "V": "U"})
_NUM_CONF = str.maketrans("OoIl", "0011")

# A numeric token may contain O/o/I/l lookalikes if it has >=1 real digit and is not glued to letters
# (units are allowed to follow).
_NUM_TOKEN = re.compile(
    r"(?<![A-Za-z0-9])([0-9OoIl]*[0-9][0-9OoIl]*)"
    r"(?=\s?(?:mg|mcg|µg|μg|gm|g|iu|ml|%)(?![A-Za-z])|[\s/\-.:,]|$)",
    re.I,
)


def normalize_digits(text: str) -> str:
    return _NUM_TOKEN.sub(lambda m: m.group(1).translate(_NUM_CONF), text)


def normalize_name(s: str) -> str:
    s = re.sub(r"[^A-Za-z0-9]+", " ", s).upper()
    return re.sub(r"\s+", " ", s).strip()


def skeleton(s: str) -> str:
    return normalize_name(s).replace("RN", "M").translate(_SKEL)


def trigram_codes(skel: str) -> list[int]:
    p = "  " + skel + " "
    return sorted({_IDX[a] * 1369 + _IDX[b] * 37 + _IDX[c] for a, b, c in zip(p, p[1:], p[2:])})


# --------------------------------------------------------------------------- 2. Field extraction
_UNIT_CANON = {"mg": "mg", "mcg": "mcg", "µg": "mcg", "μg": "mcg", "gm": "g", "g": "g", "iu": "iu", "ml": "ml", "%": "%"}
STRENGTH_RE = re.compile(
    r"(?i)(?<![\d.])(\d{1,6}(?:\.\d{1,3})?)\s?(mg|mcg|µg|μg|gm|g|iu|ml|%)(?![a-z])"
    r"(?:\s?/\s?(\d{0,3})\s?(ml|g)(?![a-z]))?"
)
EXPIRY_RE = re.compile(
    r"(?i)\b(?:exp(?:iry)?\.?\s*(?:date|dt)?|use\s*before|best\s*before)\s*[:.\-]?\s*"
    r"((?:0?[1-9]|1[0-2])\s*[/\-.]\s*(?:20)?\d{2}"
    r"|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*[\-,.]?\s*(?:20)?\d{2})"
)
_MONTHS = {m: i for i, m in enumerate("jan feb mar apr may jun jul aug sep oct nov dec".split(), 1)}


@dataclass(frozen=True)
class Strength:
    canon: str
    dose_like: bool  # False = pack size (plain ml / g), ignored by the gate


def _fmt(v: str) -> str:
    return format(Decimal(v).normalize(), "f")


def extract_strengths(text: str) -> list[Strength]:
    out = []
    for m in STRENGTH_RE.finditer(normalize_digits(text)):
        val, unit, per_n, per_u = m.groups()
        unit = _UNIT_CANON[unit.lower()]
        canon = f"{_fmt(val)} {unit}"
        dose_like = unit in ("mg", "mcg", "iu", "%")
        if per_u:
            canon += f"/{per_n or 1} {per_u.lower()}"
            dose_like = True
        out.append(Strength(canon, dose_like))
    return out


def extract_expiry(text: str) -> list[tuple[int, int]]:
    out = []
    for m in EXPIRY_RE.finditer(normalize_digits(text)):
        g = m.group(1)
        name = re.match(r"(?i)([a-z]{3})", g)
        if name:
            month = _MONTHS[name.group(1).lower()]
            year_s = re.search(r"(\d{2,4})\s*$", g).group(1)
        else:
            month_s, year_s = re.split(r"\s*[/\-.]\s*", g)
            month = int(month_s)
        year = int(year_s)
        out.append((year + 2000 if year < 100 else year, month))
    return out


def parse_gs1(payload: str) -> dict[str, str]:
    """Parse GS1 element strings: '(01)...(17)...' or raw with FNC1 (\\x1d). Returns {AI: value}."""
    out: dict[str, str] = {}
    if "(" in payload:
        for ai, val in re.findall(r"\((\d{2,4})\)([^(]+)", payload):
            out[ai] = val
        return out
    fixed = {"01": 14, "17": 6}
    i = 0
    while i + 2 <= len(payload):
        ai = payload[i:i + 2]
        i += 2
        if ai in fixed:
            out[ai] = payload[i:i + fixed[ai]]
            i += fixed[ai]
        elif ai in ("10", "21"):
            j = payload.find("\x1d", i)
            j = len(payload) if j == -1 else j
            out[ai] = payload[i:j]
            i = j + 1
        else:
            break
    return out


def gs1_expiry(fields: dict[str, str]) -> tuple[int, int] | None:
    v = fields.get("17")
    if v and len(v) == 6 and v.isdigit() and 1 <= int(v[2:4]) <= 12:
        return 2000 + int(v[:2]), int(v[2:4])
    return None


# --------------------------------------------------------------------------- 3. Brand matching
_CONF_PAIRS = {frozenset(p) for p in [("0", "O"), ("1", "I"), ("1", "L"), ("I", "L"), ("5", "S"),
                                      ("8", "B"), ("2", "Z"), ("6", "G"), ("U", "V")]}
CONF_SUB_COST = 0.25
MARGIN = 1.0


def weighted_distance(a: str, b: str) -> float:
    a, b = a.upper(), b.upper()
    prev = [float(j) for j in range(len(b) + 1)]
    for i, ca in enumerate(a, 1):
        cur = [float(i)]
        for j, cb in enumerate(b, 1):
            sub = 0.0 if ca == cb else (CONF_SUB_COST if frozenset((ca, cb)) in _CONF_PAIRS else 1.0)
            cur.append(min(prev[j] + 1.0, cur[j - 1] + 1.0, prev[j - 1] + sub))
        prev = cur
    return prev[-1]


def max_dist(n: int) -> float:
    return 0.5 if n <= 4 else (1.0 if n <= 7 else 1.5)


@dataclass
class BrandMatch:
    status: str  # exact | fuzzy | ambiguous | none
    family_id: int | None = None
    name: str | None = None
    distance: float = 0.0


def retrieve(db: sqlite3.Connection, qn: str, limit: int = 60):
    codes = trigram_codes(skeleton(qn))
    need = max(2, math.ceil(0.35 * len(codes)))
    sql = ("SELECT n.id, n.family_id, n.name_norm, COUNT(*) AS c "
           "FROM name_trigrams t JOIN brand_names n ON n.id = t.name_id "
           f"WHERE t.tri IN ({','.join('?' * len(codes))}) "
           "GROUP BY t.name_id HAVING c >= ? ORDER BY c DESC LIMIT ?")
    return db.execute(sql, [*codes, need, limit]).fetchall()


def match_brand(db: sqlite3.Connection, cand: str) -> BrandMatch:
    qn = normalize_name(cand)
    if len(qn) < 3:
        return BrandMatch("none")
    best: dict[int, tuple[float, str]] = {}
    for _nid, fid, name, _c in retrieve(db, qn):
        d = weighted_distance(qn, name)
        if fid not in best or d < best[fid][0]:
            best[fid] = (d, name)
    ranked = sorted((d, fid, name) for fid, (d, name) in best.items())
    if not ranked:
        return BrandMatch("none")
    d1, f1, n1 = ranked[0]
    if d1 == 0:
        return BrandMatch("exact", f1, n1, 0.0)
    if d1 > max_dist(len(qn)):
        return BrandMatch("none")
    if len(ranked) > 1 and ranked[1][0] - d1 < MARGIN:
        return BrandMatch("ambiguous")
    return BrandMatch("fuzzy", f1, n1, d1)


STOP = {"TABLET", "TABLETS", "CAPSULE", "CAPSULES", "SYRUP", "IP", "BP", "USP", "EACH", "CONTAINS", "STORE",
        "BELOW", "MRP", "BATCH", "EXP", "MFG", "DATE", "FILM", "COATED", "ORAL", "SUSPENSION", "DROPS"}


def brand_windows(lines: list[tuple[str, float]], top_k: int = 3) -> list[str]:
    wins = set()
    for text, _h in sorted(lines, key=lambda l: -l[1])[:top_k]:
        toks = [t for t in re.split(r"[^A-Za-z0-9]+", text) if t]
        for i in range(len(toks)):
            for j in range(i + 1, min(i + 3, len(toks)) + 1):
                w = " ".join(toks[i:j])
                nw = normalize_name(w)
                if len(nw) >= 3 and sum(c.isalpha() for c in w) >= 2 and not set(nw.split()) <= STOP:
                    wins.add(w)
    return sorted(wins)


# --------------------------------------------------------------------------- 4. Frames, voting, gate
@dataclass
class FrameRead:
    strengths: dict[str, bool] = field(default_factory=dict)   # canon -> dose_like
    expiries: set = field(default_factory=set)
    brands: dict[int, float] = field(default_factory=dict)     # family_id -> best distance
    ambiguous: bool = False


def analyse_frame(lines: list[tuple[str, float]], db: sqlite3.Connection) -> FrameRead:
    text = "\n".join(t for t, _ in lines)
    fr = FrameRead()
    fr.strengths = {s.canon: s.dose_like for s in extract_strengths(text)}
    fr.expiries = set(extract_expiry(text))
    for w in brand_windows(lines):
        m = match_brand(db, w)
        if m.status in ("exact", "fuzzy"):
            fr.brands[m.family_id] = min(m.distance, fr.brands.get(m.family_id, 9.0))
        elif m.status == "ambiguous":
            fr.ambiguous = True
    return fr


@dataclass
class Params:
    min_frames: int = 5
    min_agree: int = 3
    min_ratio: float = 0.7
    conflict_ratio: float = 0.3


def vote(sets: list[set], p: Params):
    """Vote only among frames where the field was detected (non-empty set)."""
    detected = [s for s in sets if s]
    n = len(detected)
    counts = Counter(v for s in detected for v in s)
    accepted = [v for v, c in counts.items() if c >= p.min_agree and c / n >= p.min_ratio]
    dissent = [v for v, c in counts.items() if v not in accepted and c / n >= p.conflict_ratio]
    return accepted, dissent, n


@dataclass
class Decision:
    status: str  # FULL | PARTIAL | ABSTAIN
    brand: str | None = None
    strengths: list[str] = field(default_factory=list)
    expiry: tuple[int, int] | None = None
    expired: bool | None = None
    reasons: list[str] = field(default_factory=list)


def family_info(db, fid):
    key = db.execute("SELECT family_key FROM brand_families WHERE id=?", (fid,)).fetchone()[0]
    strengths = {r[0] for r in db.execute("SELECT strength_canon FROM family_strengths WHERE family_id=?", (fid,))}
    return key.title(), strengths


def read_label(frames, db, today: date, p: Params = Params()) -> Decision:
    if len(frames) < p.min_frames:
        return Decision("ABSTAIN", reasons=["too_few_frames"])
    reads = [analyse_frame(f, db) for f in frames]

    # --- brand
    bsets = [set(map(str, r.brands)) | ({"AMBIG"} if r.ambiguous else set()) for r in reads]
    acc, diss, _ = vote(bsets, p)
    fams = [a for a in acc if a != "AMBIG"]
    if "AMBIG" in acc or "AMBIG" in diss or len(fams) > 1 or [d for d in diss if d != "AMBIG"]:
        return Decision("ABSTAIN", reasons=["brand_ambiguous"])
    if len(fams) != 1:
        return Decision("ABSTAIN", reasons=["brand_not_verified"])
    fid = int(fams[0])
    brand, known = family_info(db, fid)
    d = Decision("PARTIAL", brand=brand)

    # --- strength
    dose_flag: dict[str, bool] = {}
    for r in reads:
        dose_flag.update(r.strengths)
    sacc, _sd, _ = vote([set(r.strengths) for r in reads], p)
    dose = [s for s in sacc if dose_flag[s]]           # plain ml / g are pack sizes: ignored
    if dose and not known:
        d.reasons.append("strength_unverifiable")
    elif dose:
        bad = [s for s in dose if s not in known]
        if bad:
            return Decision("ABSTAIN", brand=brand, reasons=["strength_implausible"])
        d.strengths = sorted(dose)
    else:
        d.reasons.append("strength_unclear")

    # --- expiry
    eacc, ediss, _ = vote([r.expiries for r in reads], p)
    if len(eacc) == 1 and not ediss:
        d.expiry = eacc[0]
        d.expired = d.expiry < (today.year, today.month)
    else:
        d.reasons.append("expiry_unclear")

    d.status = "FULL" if d.strengths and d.expiry else "PARTIAL"
    return d


def apply_gs1(d: Decision, code_expiry: tuple[int, int] | None, today: date) -> Decision:
    """Cross-check a decoded code against the label reading. Disagreement => abstain."""
    if code_expiry is None or d.status == "ABSTAIN":
        return d
    if d.expiry is not None and d.expiry != code_expiry:
        return Decision("ABSTAIN", brand=d.brand, reasons=["code_label_conflict"])
    if d.expiry is None:
        d.expiry, d.expired = code_expiry, code_expiry < (today.year, today.month)
        d.reasons = [r for r in d.reasons if r != "expiry_unclear"] + ["expiry_from_code"]
        d.status = "FULL" if d.strengths else "PARTIAL"
    return d


# --------------------------------------------------------------------------- 5. Speech rendering
_DIG = dict(zip("0123456789", "zero one two three four five six seven eight nine".split()))
_UNIT_W = {"mg": "milligrams", "mcg": "micrograms", "g": "grams", "iu": "international units",
           "ml": "millilitres", "%": "percent"}
_MONTH_NAMES = "January February March April May June July August September October November December".split()


def spell_number(s: str) -> str:
    return " ".join("point" if ch == "." else _DIG[ch] for ch in s)


def speak_strength(canon: str) -> str:
    main, _, per = canon.partition("/")
    v, u = main.split(" ")
    out = f"{spell_number(v)} {_UNIT_W[u]}"
    if per:
        pv, pu = per.split(" ")
        out += f" per {_UNIT_W[pu][:-1]}" if pv == "1" else f" per {spell_number(pv)} {_UNIT_W[pu]}"
    return out


_ABSTAIN_TEXT = {
    "too_few_frames": "I could not read this reliably. Try again, or ask for help.",
    "brand_not_verified": "I cannot tell which medicine this is. Please ask for help.",
    "brand_ambiguous": "I cannot tell which medicine this is. Please ask for help.",
    "strength_implausible": "The strength I read does not match this medicine. Please ask for help.",
    "code_label_conflict": "The label and the code do not agree. Please ask for help.",
}


def render_text(d: Decision) -> str:
    if d.status == "ABSTAIN":
        return _ABSTAIN_TEXT.get(d.reasons[0], _ABSTAIN_TEXT["too_few_frames"])
    parts = [f"{d.brand}."]
    if d.strengths:
        parts.append(" and ".join(speak_strength(s) for s in d.strengths) + ".")
    if d.expiry:
        y, m = d.expiry
        parts.append(f"Expired {_MONTH_NAMES[m - 1]} {y}. This medicine is past its expiry date." if d.expired
                     else f"Expires {_MONTH_NAMES[m - 1]} {y}. Valid.")
    flags = []
    if "strength_unclear" in d.reasons or "strength_unverifiable" in d.reasons:
        flags.append("Strength is unclear.")
    if "expiry_unclear" in d.reasons:
        flags.append("I could not read the expiry date.")
    if flags:
        parts += flags + ["Please ask someone to check."]
    return " ".join(parts)


# --------------------------------------------------------------------------- 6. DB build helpers
def _tri_insert(db, name_id, name_norm):
    db.executemany("INSERT OR IGNORE INTO name_trigrams VALUES (?,?)",
                   [(t, name_id) for t in trigram_codes(skeleton(name_norm))])


def new_db() -> sqlite3.Connection:
    db = sqlite3.connect(":memory:")
    db.executescript(SCHEMA_PATH.read_text())
    return db


def add_brand(db, names: list[str], strengths: list[str], generic: str = "TEST GENERIC", form: str = "tablet"):
    """names[0] must be the family key (first token). Fixture/builder helper."""
    fam_key = normalize_name(names[0]).split()[0]
    db.execute("INSERT OR IGNORE INTO brand_families(family_key) VALUES (?)", (fam_key,))
    fid = db.execute("SELECT id FROM brand_families WHERE family_key=?", (fam_key,)).fetchone()[0]
    db.execute("INSERT OR IGNORE INTO generics(name, name_norm) VALUES (?,?)", (generic, normalize_name(generic)))
    gid = db.execute("SELECT id FROM generics WHERE name_norm=?", (normalize_name(generic),)).fetchone()[0]
    for nm in names:
        nn = normalize_name(nm)
        db.execute("INSERT OR IGNORE INTO brand_names(family_id,name_norm,display_name,skeleton) VALUES (?,?,?,?)",
                   (fid, nn, nm, skeleton(nn)))
        nid = db.execute("SELECT id FROM brand_names WHERE name_norm=?", (nn,)).fetchone()[0]
        _tri_insert(db, nid, nn)
        mid = db.execute("INSERT INTO medicines(brand_name_id, dosage_form) VALUES (?,?)", (nid, form)).lastrowid
        for s in strengths:
            db.execute("INSERT OR IGNORE INTO medicine_ingredients VALUES (?,?,?)", (mid, gid, s))
    for s in strengths:
        db.execute("INSERT OR IGNORE INTO family_strengths VALUES (?,?)", (fid, s))


def fixture_db() -> sqlite3.Connection:
    db = new_db()
    add_brand(db, ["Crocin", "Crocin Advance"], ["500 mg", "650 mg"], "Paracetamol")
    add_brand(db, ["Dolo", "Dolo 650"], ["500 mg", "650 mg"], "Paracetamol")
    add_brand(db, ["Calpol"], ["125 mg/5 ml", "500 mg", "650 mg"], "Paracetamol", "syrup/tablet")
    add_brand(db, ["Zyrtec"], ["10 mg"], "Cetirizine")
    add_brand(db, ["Cetzine"], ["10 mg"], "Cetirizine")
    add_brand(db, ["Azithral"], ["250 mg", "500 mg"], "Azithromycin")
    add_brand(db, ["Pantop"], ["40 mg"], "Pantoprazole")
    add_brand(db, ["Ecosprin"], ["75 mg", "150 mg"], "Aspirin")
    add_brand(db, ["Telma"], ["40 mg"], "Telmisartan")
    add_brand(db, ["Alphax"], ["100 mg"], "Testgeneric A")     # fictional look-alike pair
    add_brand(db, ["Alphex"], ["100 mg"], "Testgeneric B")     # fictional look-alike pair
    add_brand(db, ["Ocumol"], ["0.5 %"], "Testgeneric C", "eye drops")  # fictional
    db.commit()
    return db
