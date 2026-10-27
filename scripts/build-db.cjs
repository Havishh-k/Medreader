const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const snapshotPath = path.join(__dirname, '../data/official-medicines.json');
if (!fs.existsSync(snapshotPath)) {
  throw new Error('Official medicine snapshot missing. Run npm run data:refresh first.');
}

const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
if (snapshot.schemaVersion !== 1 || !Array.isArray(snapshot.sources) || !Array.isArray(snapshot.medicines)) {
  throw new Error('Official medicine snapshot has an unsupported schema.');
}
if (snapshot.medicines.length < 100) {
  throw new Error(`Official snapshot has only ${snapshot.medicines.length} products; refusing to build.`);
}
if (snapshot.medicines.some(medicine => !medicine.manufacturer || !medicine.sourceUrl)) {
  throw new Error('Every medicine must include manufacturer and source URL provenance.');
}

const dbPath = path.join(__dirname, '../public/medicines.db');
const tempDbPath = `${dbPath}.tmp`;
if (fs.existsSync(tempDbPath)) fs.unlinkSync(tempDbPath);

const db = new Database(tempDbPath);

// ─── Simple drugs table (backward compat) ───
db.exec(`
  CREATE TABLE meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  ) WITHOUT ROWID;

  CREATE TABLE data_sources (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    manufacturer TEXT NOT NULL,
    url TEXT NOT NULL,
    retrieved_at TEXT NOT NULL,
    sha256 TEXT NOT NULL,
    product_count INTEGER NOT NULL
  );

  CREATE TABLE drugs (
    id TEXT PRIMARY KEY,
    brand_name TEXT NOT NULL,
    generic_name TEXT NOT NULL,
    strength TEXT NOT NULL,
    type TEXT NOT NULL,
    manufacturer TEXT NOT NULL,
    source_url TEXT NOT NULL
  );
  CREATE INDEX idx_brand ON drugs(brand_name);
`);

// ─── Advanced schema for fuzzy matching ───
db.exec(`
  CREATE TABLE brand_families (
    id INTEGER PRIMARY KEY,
    family_key TEXT NOT NULL UNIQUE
  );

  CREATE TABLE brand_names (
    id INTEGER PRIMARY KEY,
    family_id INTEGER NOT NULL REFERENCES brand_families(id),
    name_norm TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    skeleton TEXT NOT NULL
  );

  CREATE TABLE family_strengths (
    family_id INTEGER NOT NULL REFERENCES brand_families(id),
    strength_canon TEXT NOT NULL,
    PRIMARY KEY (family_id, strength_canon)
  ) WITHOUT ROWID;

  CREATE TABLE name_trigrams (
    tri INTEGER NOT NULL,
    name_id INTEGER NOT NULL REFERENCES brand_names(id),
    PRIMARY KEY (tri, name_id)
  ) WITHOUT ROWID;

  CREATE INDEX idx_names_family ON brand_names(family_id);
`);

// ─── Normalisation helpers (must match label-logic.ts exactly) ───

const ALPHABET = ' ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const IDX = {};
for (let i = 0; i < ALPHABET.length; i++) IDX[ALPHABET[i]] = i;

const SKEL_MAP = { '0': 'O', '1': 'I', 'L': 'I', '5': 'S', '8': 'B', '2': 'Z', '6': 'G', 'V': 'U' };

function normalizeName(s) {
  return s.replace(/[^A-Za-z0-9]+/g, ' ').toUpperCase().replace(/\s+/g, ' ').trim();
}

function skeleton(s) {
  let n = normalizeName(s).replace(/RN/g, 'M');
  return n.split('').map(c => SKEL_MAP[c] || c).join('');
}

function trigramCodes(skel) {
  const p = '  ' + skel + ' ';
  const codes = new Set();
  for (let i = 0; i < p.length - 2; i++) {
    const a = IDX[p[i]], b = IDX[p[i+1]], c = IDX[p[i+2]];
    if (a !== undefined && b !== undefined && c !== undefined) {
      codes.add(a * 1369 + b * 37 + c);
    }
  }
  return [...codes].sort((a, b) => a - b);
}

// ─── Database Builder ───

const insertMeta = db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)');
const insertSource = db.prepare(`INSERT INTO data_sources
  (name, manufacturer, url, retrieved_at, sha256, product_count)
  VALUES (?, ?, ?, ?, ?, ?)`);
const insertDrug = db.prepare(`INSERT INTO drugs
  (id, brand_name, generic_name, strength, type, manufacturer, source_url)
  VALUES (?, ?, ?, ?, ?, ?, ?)`);
const insertFamily = db.prepare('INSERT OR IGNORE INTO brand_families (family_key) VALUES (?)');
const getFamily = db.prepare('SELECT id FROM brand_families WHERE family_key = ?');
const insertName = db.prepare('INSERT OR IGNORE INTO brand_names (family_id, name_norm, display_name, skeleton) VALUES (?, ?, ?, ?)');
const getName = db.prepare('SELECT id FROM brand_names WHERE name_norm = ?');
const insertTrigram = db.prepare('INSERT OR IGNORE INTO name_trigrams (tri, name_id) VALUES (?, ?)');
const insertStrength = db.prepare('INSERT OR IGNORE INTO family_strengths (family_id, strength_canon) VALUES (?, ?)');

function populateDatabase(snapshot) {
  const medicinesData = snapshot.medicines;
  db.transaction(() => {
    insertMeta.run('schema_version', String(snapshot.schemaVersion));
    insertMeta.run('generated_at', snapshot.generatedAt);
    insertMeta.run('record_count', String(medicinesData.length));
    for (const source of snapshot.sources) {
      insertSource.run(
        source.name,
        source.manufacturer,
        source.url,
        source.retrievedAt,
        source.sha256,
        source.productCount,
      );
    }

    medicinesData.forEach((med, idx) => {
      if (!med.brand) return;
      
      // Simple drugs table
      insertDrug.run(
        String(idx + 1), med.brand, med.generic || '', med.strength || '', med.type || 'Medicine',
        med.manufacturer, med.sourceUrl,
      );

      // Advanced tables
      const familyKey = normalizeName(med.brand).split(' ')[0];
      if (!familyKey) return;
      
      insertFamily.run(familyKey);
      const familyRow = getFamily.get(familyKey);
      const familyId = familyRow.id;

      const nameNorm = normalizeName(med.brand);
      const skel = skeleton(med.brand);
      insertName.run(familyId, nameNorm, med.brand, skel);
      
      const nameRow = getName.get(nameNorm);
      if (nameRow) {
        const nameId = nameRow.id;
        const codes = trigramCodes(skel);
        for (const tri of codes) {
          insertTrigram.run(tri, nameId);
        }
      }

      // Insert strength
      if (med.strength && !['Tablet', 'Syrup'].includes(med.strength)) {
        insertStrength.run(familyId, med.strength);
      }
    });
  })();

  console.log(`Built medicines.db with ${medicinesData.length} officially sourced products.`);
  db.close();
  fs.renameSync(tempDbPath, dbPath);
}

populateDatabase(snapshot);
