import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import initSqlJs from 'sql.js';
import { describe, expect, it } from 'vitest';

const repoRoot = join(__dirname, '../..');

describe('official medicine data', () => {
  it('contains only provenance-tracked official records', () => {
    const snapshot = JSON.parse(readFileSync(join(repoRoot, 'data/official-medicines.json'), 'utf8'));

    expect(snapshot.medicines.length).toBeGreaterThan(100);
    expect(snapshot.sources.every((source: any) => source.url.startsWith('https://www.mankindpharma.com/'))).toBe(true);
    expect(snapshot.medicines.every((medicine: any) =>
      medicine.manufacturer === 'Mankind Pharma Limited' &&
      medicine.sourceUrl.startsWith('https://www.mankindpharma.com/')
    )).toBe(true);
    expect(JSON.stringify(snapshot).toLowerCase()).not.toContain('kaggle');
  });

  it('ships the provenance metadata inside medicines.db', async () => {
    const SQL = await initSqlJs();
    const db = new SQL.Database(readFileSync(join(repoRoot, 'public/medicines.db')));
    const count = db.exec('SELECT COUNT(*) FROM drugs')[0].values[0][0];
    const source = db.exec('SELECT manufacturer, url FROM data_sources')[0].values[0];
    const knownBrand = db.exec("SELECT generic_name FROM drugs WHERE brand_name = 'Amlokind'")[0].values[0][0];

    expect(count).toBeGreaterThan(100);
    expect(source).toEqual(['Mankind Pharma Limited', 'https://www.mankindpharma.com/products/all-products/']);
    expect(knownBrand).toBe('Amlodipine Besilate');
    db.close();
  });
});
