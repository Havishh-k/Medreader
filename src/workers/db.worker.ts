import initSqlJs from 'sql.js';
import { chooseUnambiguousMatch, isSafeMedicineToken } from '../core/medicine-match-policy';
// @ts-ignore
import sqlWasmUrl from 'sql.js/dist/sql-wasm.wasm?url';

let db: any = null;

// ─── Normalisation helpers (must match label-logic.ts) ───

const SKEL_MAP: Record<string, string> = {
  '0': 'O', '1': 'I', 'L': 'I', '5': 'S', '8': 'B', '2': 'Z', '6': 'G', 'V': 'U',
};

const CONF_PAIRS = new Set<string>();
for (const [a, b] of [
  ['0', 'O'], ['1', 'I'], ['1', 'L'], ['I', 'L'], ['5', 'S'],
  ['8', 'B'], ['2', 'Z'], ['6', 'G'], ['U', 'V'],
]) {
  CONF_PAIRS.add(a + b);
  CONF_PAIRS.add(b + a);
}

const ALPHABET = ' ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const IDX: Record<string, number> = {};
for (let i = 0; i < ALPHABET.length; i++) IDX[ALPHABET[i]] = i;

function normalizeName(s: string): string {
  return s.replace(/[^A-Za-z0-9]+/g, ' ').toUpperCase().replace(/\s+/g, ' ').trim();
}

function skeleton(s: string): string {
  let n = normalizeName(s).replace(/RN/g, 'M');
  return n.split('').map(c => SKEL_MAP[c] ?? c).join('');
}

function trigramCodes(skel: string): number[] {
  const p = '  ' + skel + ' ';
  const codes = new Set<number>();
  for (let i = 0; i < p.length - 2; i++) {
    const a = IDX[p[i]], b = IDX[p[i+1]], c = IDX[p[i+2]];
    if (a !== undefined && b !== undefined && c !== undefined) {
      codes.add(a * 1369 + b * 37 + c);
    }
  }
  return [...codes].sort((a, b) => a - b);
}

function weightedDistance(a: string, b: string): number {
  a = a.toUpperCase();
  b = b.toUpperCase();
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      const ca = a[i - 1], cb = b[j - 1];
      const sub = ca === cb ? 0 : (CONF_PAIRS.has(ca + cb) ? 0.25 : 1.0);
      cur.push(Math.min(prev[j] + 1.0, cur[j - 1] + 1.0, prev[j - 1] + sub));
    }
    prev = cur;
  }
  return prev[b.length];
}

function maxDist(n: number): number {
  return n <= 4 ? 0.5 : n <= 7 ? 1.0 : 1.5;
}

// ─── Expiry date extraction from OCR text ───

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

// Matches patterns like "Exp 11/27", "Expiry: Nov 2027", "Best Before: 11-2027", "EXP.DATE: 11.27"
const EXPIRY_RE = /(?:exp(?:iry)?\.?\s*(?:date)?\.?\s*:?\s*|best\s+before\s*:?\s*)((\d{1,2}\s*[/\-\.]\s*\d{2,4})|([a-z]{3}\s*[/\-\.]?\s*\d{2,4}))/gi;

function extractExpiry(text: string): { year: number; month: number } | null {
  EXPIRY_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = EXPIRY_RE.exec(text)) !== null) {
    const g = m[1];
    const nameMatch = g.match(/^([a-z]{3})/i);
    let month: number;
    let yearStr: string;
    if (nameMatch) {
      month = MONTHS[nameMatch[1].toLowerCase()];
      if (!month) continue;
      const ym = g.match(/(\d{2,4})\s*$/);
      if (!ym) continue;
      yearStr = ym[1];
    } else {
      const parts = g.split(/\s*[/\-\.]\s*/);
      if (parts.length < 2) continue;
      month = parseInt(parts[0], 10);
      yearStr = parts[1];
    }
    let year = parseInt(yearStr, 10);
    if (year < 100) year += 2000;
    if (month >= 1 && month <= 12 && year >= 2020 && year <= 2035) {
      return { year, month };
    }
  }
  return null;
}

// ─── Initialization ───

async function initDb() {
  try {
    const SQL = await initSqlJs({ locateFile: () => sqlWasmUrl });
    const response = await fetch('/medicines.db');
    if (!response.ok) throw new Error(`Medicine database returned HTTP ${response.status}`);
    const buf = await response.arrayBuffer();
    db = new SQL.Database(new Uint8Array(buf));
    console.log('[DB Worker] Database loaded');
    self.postMessage({ type: 'init_done' });
  } catch (err) {
    console.error('[DB Worker] Init failed:', err);
    self.postMessage({ type: 'init_error', error: String(err) });
  }
}

initDb();

function queryFuzzy(text: string): any {
  if (!db) return null;

  // Extract candidate brand windows and individual tokens from the OCR text
  const words = text.split(/[^A-Za-z0-9]+/).map(w => w.trim()).filter(w => w.length >= 2);
  const candidates = new Set<string>();
  
  for (let i = 0; i < words.length; i++) {
    for (let j = i + 1; j <= Math.min(i + 3, words.length); j++) {
      const window = words.slice(i, j).join(' ');
      const norm = normalizeName(window);
      if (isSafeMedicineToken(norm)) candidates.add(norm);
    }
    const single = normalizeName(words[i]);
    if (isSafeMedicineToken(single)) candidates.add(single);
  }

  type Match = {
    familyId: number;
    brand_name: string;
    generic_name: string;
    strength: string;
    manufacturer: string;
    source_url: string;
    distance: number;
  };
  const bestByFamily = new Map<number, Match>();

  for (const cand of candidates) {
    if (cand.length < 4) continue;

    // Trigram-based retrieval from the fuzzy index
    const codes = trigramCodes(skeleton(cand));
    const need = Math.max(2, Math.ceil(0.35 * codes.length));
    
    if (codes.length === 0) continue;

    const placeholders = codes.map(() => '?').join(',');
    let rows: any[] = [];
    try {
      const sql = `SELECT n.id, n.family_id, n.name_norm, n.display_name, COUNT(*) AS c
        FROM name_trigrams t JOIN brand_names n ON n.id = t.name_id
        WHERE t.tri IN (${placeholders})
        GROUP BY t.name_id HAVING c >= ? ORDER BY c DESC LIMIT 20`;
      const stmt = db.prepare(sql);
      stmt.bind([...codes, need]);
      while (stmt.step()) rows.push(stmt.getAsObject());
      stmt.free();
    } catch (e) {
      continue;
    }

    for (const row of rows) {
      // 1. Distance against full normalized brand name
      let dist = weightedDistance(cand, row.name_norm);
      let threshold = maxDist(cand.length);

      // 2. Token-level matching for multi-word brands (e.g. cand "OXY" or "OTRIVIN" against "OTRIVIN OXY")
      const tokens = row.name_norm.split(' ').filter((w: string) => w.length >= 2);
      for (const tok of tokens) {
        const dTok = weightedDistance(cand, tok);
        const tTok = maxDist(Math.max(cand.length, tok.length));
        if (dTok <= tTok && dTok < dist) {
          dist = dTok;
          threshold = tTok;
        }
      }
      
      if (dist <= threshold) {
        const familyId = Number(row.family_id);
        const existing = bestByFamily.get(familyId);
        if (!existing || dist < existing.distance) {
          // Look up the drug details from the simple table
          let drugInfo = null;
          try {
            const dStmt = db.prepare(`SELECT brand_name, generic_name, strength, manufacturer, source_url
              FROM drugs WHERE brand_name = ?`);
            dStmt.bind([row.display_name]);
            if (dStmt.step()) drugInfo = dStmt.getAsObject();
            dStmt.free();
          } catch (e) {
            // Fall back to display_name
          }
          
          bestByFamily.set(familyId, {
            familyId,
            brand_name: drugInfo?.brand_name || row.display_name,
            generic_name: drugInfo?.generic_name || '',
            strength: drugInfo?.strength || '',
            manufacturer: drugInfo?.manufacturer || '',
            source_url: drugInfo?.source_url || '',
            distance: dist,
          });
        }
      }
    }
  }

  const bestMatch = chooseUnambiguousMatch([...bestByFamily.values()]);
  if (!bestMatch) return null;

  console.log(`[DB Worker] Fuzzy match: "${bestMatch.brand_name}" (distance: ${bestMatch.distance.toFixed(2)})`);
  const { familyId: _, ...result } = bestMatch;
  return result;
}

// ─── Message handler ───

self.onmessage = (e: MessageEvent) => {
  if (e.data.type === 'query') {
    const { text } = e.data.payload;
    
    const result = queryFuzzy(text);
    
    // Extract expiry date from the raw OCR text
    const expiry = extractExpiry(text);
    if (result) {
      (result as any).expiry = expiry;
    }
    
    self.postMessage({ type: 'query_result', result, rawText: text });
  }
};
