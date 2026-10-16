-- Schema v1: read-only reference DB shipped inside the APK (assets/).
-- Built offline (Python/Colab), never written to on device.
PRAGMA user_version = 1;

CREATE TABLE meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
) WITHOUT ROWID;

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

-- One family per first token of a normalised brand name (CROCIN, DOLO, ...).
CREATE TABLE brand_families (
  id         INTEGER PRIMARY KEY,
  family_key TEXT NOT NULL UNIQUE
);

-- Every distinct normalised brand string, including the bare family key.
CREATE TABLE brand_names (
  id           INTEGER PRIMARY KEY,
  family_id    INTEGER NOT NULL REFERENCES brand_families(id),
  name_norm    TEXT NOT NULL UNIQUE,   -- A-Z, 0-9, single spaces
  display_name TEXT NOT NULL,
  skeleton     TEXT NOT NULL           -- confusable-collapsed form (see label_logic.skeleton)
);

CREATE TABLE medicines (
  id              INTEGER PRIMARY KEY,
  brand_name_id   INTEGER NOT NULL REFERENCES brand_names(id),
  manufacturer_id INTEGER REFERENCES manufacturers(id),
  dosage_form     TEXT,
  pack_desc       TEXT
);

CREATE TABLE medicine_ingredients (
  medicine_id    INTEGER NOT NULL REFERENCES medicines(id),
  generic_id     INTEGER NOT NULL REFERENCES generics(id),
  strength_canon TEXT NOT NULL,        -- '500 mg', '125 mg/5 ml', '0.5 %'
  PRIMARY KEY (medicine_id, generic_id, strength_canon)
) WITHOUT ROWID;

-- Denormalised plausibility table: every strength seen for any product in a family.
CREATE TABLE family_strengths (
  family_id      INTEGER NOT NULL REFERENCES brand_families(id),
  strength_canon TEXT NOT NULL,
  PRIMARY KEY (family_id, strength_canon)
) WITHOUT ROWID;

-- Inverted index for fuzzy candidate retrieval. tri = 3-char code, base-37 (see spec).
CREATE TABLE name_trigrams (
  tri     INTEGER NOT NULL,
  name_id INTEGER NOT NULL REFERENCES brand_names(id),
  PRIMARY KEY (tri, name_id)
) WITHOUT ROWID;

CREATE INDEX idx_medicines_brand ON medicines(brand_name_id);
CREATE INDEX idx_names_family    ON brand_names(family_id);
