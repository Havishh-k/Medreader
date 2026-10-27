# Database Design & Schema Document

**Companion docs:** PRD (01) · TRD (02) · System Architecture (03) · Frontend/Accessibility UX (05)
**Nature of this DB:** read-only asset shipped with the PWA and built from the committed Mankind Pharma official-product snapshot. Each runtime medicine row includes manufacturer and source URL provenance. The database is never written by the browser.

---

## 1. Why This Isn't a Flat Brand-Name Table

A naive design — one `medicines` table, `LIKE '%crocin%'` or a full-table Levenshtein scan on every query — has two problems for this use case:

1. **It doesn't scale with retrieval cost.** A flat scan is O(number of brands) per query, run once per frame, up to K times per scan (TRD §3).
2. **It can't express the safety questions the validation engine actually needs answered**, which are not "does this string exist" but "what strengths are known for this brand family" (the plausibility check, TRD §4.5) and "are there several very-close matches" (the ambiguity/margin rule, TRD §4.3).

The schema below is built around three ideas: (a) a **brand family** groups variants of the same product line (`Crocin`, `Crocin Advance`) so ambiguity and plausibility are evaluated at the level that actually matters clinically; (b) a **trigram inverted index over a confusable-collapsed "skeleton"** narrows candidates before any distance calculation runs; (c) **weighted edit distance**, not Soundex/Metaphone, is the reranker — see TRD §4.3 for why phonetic algorithms are the wrong tool for OCR-style errors, with test evidence.

---

## 2. Schema

```sql
-- Schema v1: read-only reference DB shipped inside the APK (assets/).
-- Built offline (Python/Colab), never written to on device.
PRAGMA user_version = 1;

CREATE TABLE meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
) WITHOUT ROWID;
-- meta rows: source dataset name + version, build date, row counts — for
-- in-app "about this data" and for evaluation-report provenance.

CREATE TABLE manufacturers (
  id        INTEGER PRIMARY KEY,
  name      TEXT NOT NULL,
  name_norm TEXT NOT NULL UNIQUE
);

CREATE TABLE generics (
  id        INTEGER PRIMARY KEY,
  name      TEXT NOT NULL,
  name_norm TEXT NOT NULL UNIQUE
);

-- One family per product line (keyed by the first token of the normalised
-- brand name, e.g. "CROCIN"). This is the level at which ambiguity and
-- plausibility are evaluated — not the individual pack/variant level.
CREATE TABLE brand_families (
  id         INTEGER PRIMARY KEY,
  family_key TEXT NOT NULL UNIQUE
);

-- Every distinct normalised brand string that can appear on a label,
-- including bare family names and named variants ("Crocin", "Crocin Advance").
CREATE TABLE brand_names (
  id           INTEGER PRIMARY KEY,
  family_id    INTEGER NOT NULL REFERENCES brand_families(id),
  name_norm    TEXT NOT NULL UNIQUE,   -- A-Z, 0-9, single spaces only
  display_name TEXT NOT NULL,          -- as spoken/shown to the user
  skeleton     TEXT NOT NULL           -- confusable-collapsed form, see §3
);

CREATE TABLE medicines (
  id              INTEGER PRIMARY KEY,
  brand_name_id   INTEGER NOT NULL REFERENCES brand_names(id),
  manufacturer_id INTEGER REFERENCES manufacturers(id),
  dosage_form     TEXT,                -- 'tablet', 'syrup', 'eye drops', ...
  pack_desc       TEXT
);

CREATE TABLE medicine_ingredients (
  medicine_id    INTEGER NOT NULL REFERENCES medicines(id),
  generic_id     INTEGER NOT NULL REFERENCES generics(id),
  strength_canon TEXT NOT NULL,        -- canonical form: '500 mg', '125 mg/5 ml', '0.5 %'
  PRIMARY KEY (medicine_id, generic_id, strength_canon)
) WITHOUT ROWID;

-- Denormalised on purpose: every strength seen anywhere in a family, for a
-- single fast lookup in the plausibility check (TRD §4.5) without a join
-- across medicines → medicine_ingredients at query time.
CREATE TABLE family_strengths (
  family_id      INTEGER NOT NULL REFERENCES brand_families(id),
  strength_canon TEXT NOT NULL,
  PRIMARY KEY (family_id, strength_canon)
) WITHOUT ROWID;

-- Inverted index for fuzzy candidate retrieval.
-- tri = a 3-character code packed into a single integer (base-37 over the
-- alphabet " A-Z0-9"), computed from each brand name's skeleton (§3).
CREATE TABLE name_trigrams (
  tri     INTEGER NOT NULL,
  name_id INTEGER NOT NULL REFERENCES brand_names(id),
  PRIMARY KEY (tri, name_id)
) WITHOUT ROWID;

CREATE INDEX idx_medicines_brand ON medicines(brand_name_id);
CREATE INDEX idx_names_family    ON brand_names(family_id);
```

`name_trigrams` is queried by `tri`, so SQLite's implicit `PRIMARY KEY` index on `(tri, name_id)` already serves that access pattern — no extra index needed there.

---

## 3. Skeleton and Trigram Encoding

"Skeleton" collapses OCR-confusable characters to a canonical form *before* trigram hashing, so a name and its plausible OCR misreadings land in overlapping trigram buckets:

```python
_ALPHABET = " ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"           # 37 symbols
_IDX = {c: i for i, c in enumerate(_ALPHABET)}
_SKEL = str.maketrans({"0":"O","1":"I","L":"I","5":"S","8":"B","2":"Z","6":"G","V":"U"})

def normalize_name(s: str) -> str:
    s = re.sub(r"[^A-Za-z0-9]+", " ", s).upper()
    return re.sub(r"\s+", " ", s).strip()

def skeleton(s: str) -> str:
    return normalize_name(s).replace("RN", "M").translate(_SKEL)

def trigram_codes(skel: str) -> list[int]:
    padded = "  " + skel + " "
    return sorted({_IDX[a]*1369 + _IDX[b]*37 + _IDX[c]
                   for a, b, c in zip(padded, padded[1:], padded[2:])})
```

**Verified parity vectors** (the Kotlin port must reproduce these exactly, or the on-device index won't match trigrams computed against the pre-built DB):

```
skeleton("Cr0cin")    == "CROCIN"
skeleton("Crocln")    == "CROCIN"
skeleton("Dolo 650")  == "DOIO GSO"
trigram_codes("CROCIN")             == [3, 129, 4454, 4788, 12839, 20655, 25200]
trigram_codes(skeleton("Dolo 650")) == [4, 163, 278, 6040, 10301, 12876, 20542, 20883, 26566]
```

---

## 4. Candidate Retrieval and Reranking

**Step 1 — retrieve candidates by trigram overlap**, requiring at least ~35% of the query's trigrams to match (tunable), grouped to the best-scoring name per family, capped:

```sql
SELECT n.id, n.family_id, n.name_norm, COUNT(*) AS c
FROM   name_trigrams t
JOIN   brand_names n ON n.id = t.name_id
WHERE  t.tri IN (?, ?, ?, ...)          -- query's trigram codes
GROUP BY t.name_id
HAVING c >= ?                            -- minimum overlap threshold
ORDER BY c DESC
LIMIT ?;                                 -- e.g. 60
```

**Step 2 — rerank retrieved candidates by OCR-aware weighted edit distance** (in Kotlin, not SQL — SQLite has no native weighted-distance function):

```python
def weighted_distance(a: str, b: str) -> float:
    # standard DP edit distance, except a substitution between two
    # visually-confusable characters costs 0.25 instead of 1.0
    ...

def max_dist(n: int) -> float:
    return 0.5 if n <= 4 else (1.0 if n <= 7 else 1.5)
```

**Step 3 — decide** using the exact-first / margin-rule logic specified in TRD §4.3.

### Sample query: `"Cr0cin"`

```
normalized: CR0CIN
skeleton:   CROCIN
trigrams:   [3, 129, 4454, 4788, 12839, 20655, 25200]

retrieved candidates (id, family_id, name_norm, overlap):
  (2, 1, 'CROCIN ADVANCE', 7)
  (1, 1, 'CROCIN',         7)

weighted_distance('CR0CIN', 'CROCIN') = 0.25   →  ≤ max_dist(6)=1.0
best two candidates both resolve to family_id=1, so no cross-family ambiguity

match_brand result: BrandMatch(status='fuzzy', family_id=1, name='CROCIN', distance=0.25)
```

Contrast, an **ambiguous** case from the same fixture DB — `"Alphix"` sits close to both a fictional `Alphax` and `Alphex` (used in testing to model real look-alike brand-name pairs):

```
match_brand result: BrandMatch(status='ambiguous', family_id=None, name=None, distance=0.0)
```

which the safety gate turns into an abstention rather than a guess (TRD §4.9, `test_ambiguous_brand_abstains`).

---

## 5. Performance Evidence (desktop, synthetic 100k-name DB)

A synthetic brand-name set was generated — deliberately **larger than the real Indian medicine brand universe** is expected to be — to stress-test retrieval before real data exists.

| Metric | Result |
|---|---|
| Synthetic brand names generated | 100,000, across ~81,000 families |
| `name_trigrams` rows | 1,183,635 |
| Raw SQLite DB size | 24.84 MB |
| Gzip-compressed size | 8.3 MB (a reasonable proxy for the APK's compressed contribution) |
| DB build time (offline, Colab-equivalent) | 3.7 s |
| SQL trigram retrieval, per query | **median 21.6 ms / p95 43.9 ms** |
| Weighted-distance rerank, per query (median 60 candidates) | **median 3.15 ms / p95 6.09 ms** |
| End-to-end `match_brand()` on corrupted queries | median 29.8 ms / p95 52.3 ms / max 66.4 ms |

**These are desktop CPython + Android's SQLite driver is different from CPython's `sqlite3` module** — this is directional evidence that the retrieve-then-rerank design is algorithmically sound and roughly where it needs to be, not a device SLA (TRD-OQ5). Re-measure once the DB is populated with the real (likely much smaller) Indian brand dataset and run on-device.

### Accuracy check: does the tiered threshold actually avoid wrong-family matches?

Two corruption models were tested against 300-name samples from the synthetic DB:

| Corruption type | Correct family | Wrong family accepted | Correctly flagged ambiguous | Correctly abstained (none) |
|---|---|---|---|---|
| Visually-confusable substitution only (`O↔0`, `I↔1`, `S↔5`, `B↔8`) — models realistic OCR error | 96.9% | **0.0%** | 3.1% | 0.0% |
| Random non-confusable character substitution — a harder, more adversarial test than typical OCR produces | 89.2% | **0.7%** | 8.7% | 1.4% |

For comparison, forcing a single strict threshold (0.5 for every name length, no tiering) eliminates the 0.7% wrong-family rate on the harder test but also drives 98.6% of queries to "none" (abstain) — i.e. it "solves" the risk by refusing to match almost anything, which is not a usable trade-off. **The tiered threshold is a deliberate choice, not an oversight**, and the residual 0.7% wrong-family rate on adversarial (non-OCR-realistic) input is exactly why brand match is never the sole gate — the strength plausibility check (TRD §4.5) and GS1 cross-check (TRD §4.7) exist specifically to catch what fuzzy name matching alone cannot.

---

## 6. Build Pipeline (offline, not part of the shipped app)

```python
def new_db() -> sqlite3.Connection:
    db = sqlite3.connect(":memory:")
    db.executescript(SCHEMA_PATH.read_text())
    return db

def add_brand(db, names: list[str], strengths: list[str], generic: str, form: str):
    """names[0] establishes the family key (its first token).
    Inserts family, generic, every brand-name variant + its trigrams,
    a medicine row per variant, and the family-level strength set."""
    ...
```

Current source flow: Mankind Pharma official product page → `npm run data:fetch` provenance snapshot → validation and normalization in `scripts/build-db.cjs` → atomically replaced, schema-versioned `public/medicines.db`. Future manufacturers must be added only through an equally attributable official source.

---

## 7. Query-Time Rules Enforced by This Schema (cross-reference to TRD §4)

| Rule | How the schema supports it |
|---|---|
| Exact match always wins over fuzzy | `name_norm UNIQUE` allows a direct equality lookup before the trigram path runs |
| Ambiguity is evaluated at the family level, not the variant level | Retrieval groups by `family_id`; `Crocin` vs `Crocin Advance` never falsely trigger "ambiguous" against each other |
| Plausibility check is a single indexed lookup, not a join at query time | `family_strengths` is pre-flattened during the build pipeline |
| Database never supplies a value the label didn't produce | Enforced in application logic (TRD §4.5), not the schema — the schema only ever answers "is X known", never "what is X" |
