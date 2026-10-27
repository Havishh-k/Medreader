import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCE = {
  name: 'Mankind Pharma official product list',
  manufacturer: 'Mankind Pharma Limited',
  url: 'https://www.mankindpharma.com/products/all-products/',
};

function decodeHtml(value) {
  const named = {
    amp: '&', apos: "'", gt: '>', lt: '<', nbsp: ' ', quot: '"',
    '#038': '&', '#039': "'",
  };
  return value
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&([a-z]+|#0(?:38|39));/gi, (entity, name) => named[name.toLowerCase()] ?? entity);
}

function cellText(value) {
  return decodeHtml(value)
    .replace(/<br\s*\/?\s*>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractStrength(molecule) {
  const matches = molecule.match(/\b\d+(?:\.\d+)?\s*(?:mcg|mg|g|ml|iu|%)(?:\s*\/\s*\d*(?:\.\d+)?\s*(?:mcg|mg|g|ml))?/gi) || [];
  return [...new Set(matches.map(value => value.replace(/\s+/g, ' ').toLowerCase()))].join(' + ');
}

const response = await fetch(SOURCE.url, {
  headers: { 'user-agent': 'EchoSight official-data importer/1.0' },
});
if (!response.ok) throw new Error(`Official source returned HTTP ${response.status}`);

const html = await response.text();
const table = html.match(/<table[^>]+id=["']medicineTable["'][^>]*>([\s\S]*?)<\/table>/i)?.[1];
if (!table) throw new Error('Official product table was not found; source layout may have changed');

const medicines = [];
for (const row of table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
  const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(match => cellText(match[1]));
  if (cells.length < 2 || !cells[0] || !cells[1]) continue;
  medicines.push({
    brand: cells[0],
    generic: cells[1],
    strength: extractStrength(cells[1]),
    type: 'Medicine',
    manufacturer: SOURCE.manufacturer,
    sourceUrl: SOURCE.url,
  });
}

if (medicines.length < 100) {
  throw new Error(`Only ${medicines.length} products parsed; refusing to replace the verified snapshot`);
}

const uniqueMedicines = [...new Map(medicines.map(medicine => [medicine.brand.toUpperCase(), medicine])).values()];
const output = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  sources: [{
    ...SOURCE,
    retrievedAt: new Date().toISOString(),
    sha256: createHash('sha256').update(html).digest('hex'),
    productCount: uniqueMedicines.length,
  }],
  medicines: uniqueMedicines,
};

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputPath = resolve(repoRoot, 'data/official-medicines.json');
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
console.log(`Saved ${uniqueMedicines.length} official products to ${outputPath}`);
