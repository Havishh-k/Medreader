const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');

const dbPath = path.join(__dirname, '../public/medicines.db');
if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);

const db = new Database(dbPath);

// ─── Simple drugs table (backward compat) ───
db.exec(`
  CREATE TABLE drugs (
    id TEXT PRIMARY KEY,
    brand_name TEXT,
    generic_name TEXT,
    strength TEXT,
    type TEXT
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

// ─── OCR Data Cleaning ───
// This strips packaging fluff so the DB exactly matches what the camera sees
function cleanBrandForOCR(rawName) {
  if (!rawName) return '';
  let clean = rawName;
  
  // 1. Remove anything inside parentheses e.g., "(15 Tablets)"
  clean = clean.replace(/\s*\(.*?\)/g, '');
  
  // 2. Remove common form suffixes 
  clean = clean.replace(/\s+(Tablet|Syrup|Capsule|Injection|Drops|Spray|Gel|Ointment|Cream)\b.*/i, '');
  
  // 3. Remove package sizing e.g., "100ml", "50gm"
  clean = clean.replace(/\s+\d+(ml|gm|g|mg|mcg)\b/i, '');
  
  return clean.trim();
}

// ─── Database Builder ───

const insertDrug = db.prepare('INSERT INTO drugs (id, brand_name, generic_name, strength, type) VALUES (?, ?, ?, ?, ?)');
const insertFamily = db.prepare('INSERT OR IGNORE INTO brand_families (family_key) VALUES (?)');
const getFamily = db.prepare('SELECT id FROM brand_families WHERE family_key = ?');
const insertName = db.prepare('INSERT OR IGNORE INTO brand_names (family_id, name_norm, display_name, skeleton) VALUES (?, ?, ?, ?)');
const getName = db.prepare('SELECT id FROM brand_names WHERE name_norm = ?');
const insertTrigram = db.prepare('INSERT OR IGNORE INTO name_trigrams (tri, name_id) VALUES (?, ?)');
const insertStrength = db.prepare('INSERT OR IGNORE INTO family_strengths (family_id, strength_canon) VALUES (?, ?)');

function populateDatabase(medicinesData) {
  db.transaction(() => {
    medicinesData.forEach((med, idx) => {
      if (!med.brand) return;
      
      // Simple drugs table
      insertDrug.run(String(idx + 1), med.brand, med.generic || '', med.strength || '', med.type || '');

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

  console.log(`Successfully built medicines.db with ${medicinesData.length} medicines (simple + fuzzy tables).`);
  db.close();
}

// ─── Data Loading Logic ───

const medicines = [];
const fallbackMedicines = [
  { brand: 'Crocin', generic: 'Paracetamol', strength: '500mg', type: 'Tablet' },
  { brand: 'Dolo', generic: 'Paracetamol', strength: '650mg', type: 'Tablet' },
  { brand: 'Calpol', generic: 'Paracetamol', strength: '250mg', type: 'Syrup' },
  { brand: 'Augmentin', generic: 'Amoxicillin and Clavulanate', strength: '625mg', type: 'Tablet' },
  { brand: 'Thyronorm', generic: 'Thyroxine', strength: '50mcg', type: 'Tablet' },
  { brand: 'Ecosprin', generic: 'Aspirin', strength: '75mg', type: 'Tablet' },
  { brand: 'Pan', generic: 'Pantoprazole', strength: '40mg', type: 'Tablet' },
  { brand: 'Allegra', generic: 'Fexofenadine', strength: '120mg', type: 'Tablet' },
  { brand: 'Amlokind', generic: 'Amlodipine', strength: '5mg', type: 'Tablet' },
  { brand: 'Glycomet', generic: 'Metformin', strength: '500mg', type: 'Tablet' },
  { brand: 'Telmikind', generic: 'Telmisartan', strength: '40mg', type: 'Tablet' },
  { brand: 'Azithral', generic: 'Azithromycin', strength: '500mg', type: 'Tablet' },
  { brand: 'Ascoril', generic: 'Ambroxol + Guaifenesin', strength: '100ml', type: 'Syrup' },
  { brand: 'Combiflam', generic: 'Ibuprofen + Paracetamol', strength: '400mg/325mg', type: 'Tablet' },
  { brand: 'Levocet', generic: 'Levocetirizine', strength: '5mg', type: 'Tablet' },
  { brand: 'Volini', generic: 'Diclofenac', strength: '30g', type: 'Gel' },
  { brand: 'Betadine', generic: 'Povidone Iodine', strength: '10%', type: 'Ointment' },
  { brand: 'Shelcal', generic: 'Calcium + Vitamin D3', strength: '500mg', type: 'Tablet' },
  { brand: 'Cheston Cold', generic: 'Cetirizine + Paracetamol', strength: 'Tablet', type: 'Tablet' },
  { brand: 'Meftal Spas', generic: 'Mefenamic Acid', strength: '250mg', type: 'Tablet' },
  { brand: 'O2', generic: 'Ofloxacin + Ornidazole', strength: '200mg/500mg', type: 'Tablet' },
  { brand: 'Zerodol', generic: 'Aceclofenac', strength: '100mg', type: 'Tablet' },
  { brand: 'Taxim O', generic: 'Cefixime', strength: '200mg', type: 'Tablet' },
  { brand: 'Cipcal', generic: 'Calcium', strength: '500mg', type: 'Tablet' },
  { brand: 'Zincovit', generic: 'Multivitamin', strength: 'Syrup', type: 'Syrup' },
  { brand: 'Otrivin', generic: 'Xylometazoline', strength: '10ml', type: 'Nasal Drops' },
  { brand: 'Otrivin Oxy', generic: 'Oxymetazoline', strength: '10ml', type: 'Nasal Spray' },
];

const csvPath = path.join(__dirname, '../medicines.csv');

if (fs.existsSync(csvPath)) {
  console.log(`Found medicines.csv! Parsing and cleaning data for OCR...`);
  const uniqueMap = new Map();
  
  // Also preload our fallback verified medicines to ensure top medicines are always included
  for (const f of fallbackMedicines) {
    uniqueMap.set(f.brand.toUpperCase(), f);
  }

  fs.createReadStream(csvPath)
    .pipe(csv())
    .on('data', (row) => {
      const rawBrand = row.product_name || row.brand || row.name || row.Brand || '';
      if (!rawBrand) return;
      
      const pureBrand = cleanBrandForOCR(rawBrand);
      if (pureBrand.length < 2) return;
      const key = pureBrand.toUpperCase();
      
      if (!uniqueMap.has(key)) {
        uniqueMap.set(key, {
          brand: pureBrand,
          generic: row.salt_composition || row.generic || row.Generic || '',
          strength: row.medicine_desc || row.strength || row.Strength || '',
          type: 'Medicine'
        });
      }
    })
    .on('end', () => {
      const uniqueMedicines = Array.from(uniqueMap.values());
      console.log(`Loaded ${uniqueMedicines.length} unique Indian medicine brands from CSV.`);
      populateDatabase(uniqueMedicines);
    })
    .on('error', (err) => {
      console.error('Error reading CSV:', err);
    });
} else {
  console.log(`medicines.csv not found in the root directory.
Using the default 27 medicines fallback dataset.`);
  populateDatabase(fallbackMedicines);
}
