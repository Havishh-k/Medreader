import { readFileSync } from 'fs';
import { join } from 'path';
import initSqlJs, { Database } from 'sql.js';
import { normalizeName, skeleton, trigramCodes } from '../../src/core/label-logic';

export async function newDb(): Promise<Database> {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  const schemaPath = join(__dirname, '../../schema.sql');
  const schema = readFileSync(schemaPath, 'utf-8');
  db.run(schema);
  return db;
}

function _triInsert(db: Database, nameId: number, nameNorm: string) {
  const codes = trigramCodes(skeleton(nameNorm));
  const stmt = db.prepare('INSERT OR IGNORE INTO name_trigrams VALUES (?, ?)');
  for (const t of codes) {
    stmt.run([t, nameId]);
  }
  stmt.free();
}

export function addBrand(
  db: Database,
  names: string[],
  strengths: string[],
  generic: string = 'TEST GENERIC',
  form: string = 'tablet'
) {
  const famKey = normalizeName(names[0]).split(' ')[0];
  db.run('INSERT OR IGNORE INTO brand_families(family_key) VALUES (?)', [famKey]);
  const fidRes = db.exec('SELECT id FROM brand_families WHERE family_key=?', [famKey]);
  const fid = fidRes[0].values[0][0] as number;

  db.run('INSERT OR IGNORE INTO generics(name, name_norm) VALUES (?,?)', [generic, normalizeName(generic)]);
  const gidRes = db.exec('SELECT id FROM generics WHERE name_norm=?', [normalizeName(generic)]);
  const gid = gidRes[0].values[0][0] as number;

  for (const nm of names) {
    const nn = normalizeName(nm);
    db.run(
      'INSERT OR IGNORE INTO brand_names(family_id,name_norm,display_name,skeleton) VALUES (?,?,?,?)',
      [fid, nn, nm, skeleton(nn)]
    );
    const nidRes = db.exec('SELECT id FROM brand_names WHERE name_norm=?', [nn]);
    const nid = nidRes[0].values[0][0] as number;
    _triInsert(db, nid, nn);
    
    db.run('INSERT INTO medicines(brand_name_id, dosage_form) VALUES (?,?)', [nid, form]);
    const midRes = db.exec('SELECT last_insert_rowid()');
    const mid = midRes[0].values[0][0] as number;

    for (const s of strengths) {
      db.run('INSERT OR IGNORE INTO medicine_ingredients VALUES (?,?,?)', [mid, gid, s]);
    }
  }

  for (const s of strengths) {
    db.run('INSERT OR IGNORE INTO family_strengths VALUES (?,?)', [fid, s]);
  }
}

export async function fixtureDb(): Promise<Database> {
  const db = await newDb();
  addBrand(db, ['Crocin', 'Crocin Advance'], ['500 mg', '650 mg'], 'Paracetamol');
  addBrand(db, ['Dolo', 'Dolo 650'], ['500 mg', '650 mg'], 'Paracetamol');
  addBrand(db, ['Calpol'], ['125 mg/5 ml', '500 mg', '650 mg'], 'Paracetamol', 'syrup/tablet');
  addBrand(db, ['Zyrtec'], ['10 mg'], 'Cetirizine');
  addBrand(db, ['Cetzine'], ['10 mg'], 'Cetirizine');
  addBrand(db, ['Azithral'], ['250 mg', '500 mg'], 'Azithromycin');
  addBrand(db, ['Pantop'], ['40 mg'], 'Pantoprazole');
  addBrand(db, ['Ecosprin'], ['75 mg', '150 mg'], 'Aspirin');
  addBrand(db, ['Telma'], ['40 mg'], 'Telmisartan');
  addBrand(db, ['Alphax'], ['100 mg'], 'Testgeneric A');
  addBrand(db, ['Alphex'], ['100 mg'], 'Testgeneric B');
  addBrand(db, ['Ocumol'], ['0.5 %'], 'Testgeneric C', 'eye drops');
  return db;
}
