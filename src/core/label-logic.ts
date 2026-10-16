/**
 * Reference implementation / executable spec of the label validation engine and safety gate.
 * Ported line-for-line from label_logic.py.
 * The 26-case test suite must reproduce identical behaviour.
 * NOTE: fixture drug data is illustrative test data, NOT authoritative medical data.
 */

import type { Database } from 'sql.js';

// ─── helpers ────────────────────────────────────────────────────────

function query(db: Database, sql: string, params: unknown[] = []): Record<string, unknown>[] {
  const stmt = db.prepare(sql);
  stmt.bind(params as any[]);
  const rows: Record<string, unknown>[] = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function queryOne(db: Database, sql: string, params: unknown[] = []): Record<string, unknown> | undefined {
  return query(db, sql, params)[0];
}

// ─── 1. Normalisation ───────────────────────────────────────────────

const ALPHABET = ' ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'; // 37 symbols
const IDX: Record<string, number> = {};
for (let i = 0; i < ALPHABET.length; i++) IDX[ALPHABET[i]] = i;

const SKEL_MAP: Record<string, string> = {
  '0': 'O', '1': 'I', 'L': 'I', '5': 'S', '8': 'B', '2': 'Z', '6': 'G', 'V': 'U',
};

const NUM_CONF: Record<string, string> = { O: '0', o: '0', I: '1', l: '1' };

const NUM_TOKEN = /(?<![A-Za-z0-9])([0-9OoIl]*[0-9][0-9OoIl]*)(?=\s?(?:mg|mcg|µg|μg|gm|g|iu|ml|%)(?![A-Za-z])|[\s/\-.:,]|$)/gi;

export function normalizeDigits(text: string): string {
  return text.replace(NUM_TOKEN, (_match, group: string) =>
    group.split('').map(c => NUM_CONF[c] ?? c).join(''),
  );
}

export function normalizeName(s: string): string {
  s = s.replace(/[^A-Za-z0-9]+/g, ' ').toUpperCase();
  return s.replace(/\s+/g, ' ').trim();
}

export function skeleton(s: string): string {
  let n = normalizeName(s).replace(/RN/g, 'M');
  return n.split('').map(c => SKEL_MAP[c] ?? c).join('');
}

export function trigramCodes(skel: string): number[] {
  const p = '  ' + skel + ' ';
  const codes = new Set<number>();
  for (let i = 0; i < p.length - 2; i++) {
    codes.add(IDX[p[i]] * 1369 + IDX[p[i + 1]] * 37 + IDX[p[i + 2]]);
  }
  return [...codes].sort((a, b) => a - b);
}

// ─── 2. Field extraction ────────────────────────────────────────────

const UNIT_CANON: Record<string, string> = {
  mg: 'mg', mcg: 'mcg', 'µg': 'mcg', 'μg': 'mcg', gm: 'g', g: 'g', iu: 'iu', ml: 'ml', '%': '%',
};

const STRENGTH_RE = /(?<![\d.])(\d{1,6}(?:\.\d{1,3})?)\s?(mg|mcg|µg|μg|gm|g|iu|ml|%)(?![a-z])(?:\s?\/\s?(\d{0,3})\s?(ml|g)(?![a-z]))?/gi;

const EXPIRY_RE = /\b(?:exp(?:iry)?\.?\s*(?:date|dt)?|use\s*before|best\s*before)\s*[:.\-]?\s*((?:0?[1-9]|1[0-2])\s*[/\-.](?:20)?\d{2}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*[\-,.]?\s*(?:20)?\d{2})/gi;

const MONTHS: Record<string, number> = {};
'jan feb mar apr may jun jul aug sep oct nov dec'.split(' ').forEach((m, i) => {
  MONTHS[m] = i + 1;
});

export interface Strength {
  canon: string;
  doseLike: boolean;
}

function fmt(v: string): string {
  return parseFloat(v).toString();
}

export function extractStrengths(text: string): Strength[] {
  const out: Strength[] = [];
  const normalized = normalizeDigits(text);
  // Reset lastIndex for global regex
  STRENGTH_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = STRENGTH_RE.exec(normalized)) !== null) {
    const [, val, unit, perN, perU] = m;
    const canonUnit = UNIT_CANON[unit.toLowerCase()];
    let canon = `${fmt(val)} ${canonUnit}`;
    let doseLike = ['mg', 'mcg', 'iu', '%'].includes(canonUnit);
    if (perU) {
      canon += `/${perN || 1} ${perU.toLowerCase()}`;
      doseLike = true;
    }
    out.push({ canon, doseLike });
  }
  return out;
}

export function extractExpiry(text: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const normalized = normalizeDigits(text);
  EXPIRY_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = EXPIRY_RE.exec(normalized)) !== null) {
    const g = m[1];
    const nameMatch = g.match(/^([a-z]{3})/i);
    let month: number;
    let yearStr: string;
    if (nameMatch) {
      month = MONTHS[nameMatch[1].toLowerCase()];
      const ym = g.match(/(\d{2,4})\s*$/);
      if (!ym) continue;
      yearStr = ym[1];
    } else {
      const parts = g.split(/\s*[/\-.]\s*/);
      month = parseInt(parts[0], 10);
      yearStr = parts[1];
    }
    let year = parseInt(yearStr, 10);
    if (year < 100) year += 2000;
    out.push([year, month]);
  }
  return out;
}

export function parseGs1(payload: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (payload.includes('(')) {
    const re = /\((\d{2,4})\)([^(]+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(payload)) !== null) {
      out[m[1]] = m[2];
    }
    return out;
  }
  const fixed: Record<string, number> = { '01': 14, '17': 6 };
  let i = 0;
  while (i + 2 <= payload.length) {
    const ai = payload.slice(i, i + 2);
    i += 2;
    if (ai in fixed) {
      out[ai] = payload.slice(i, i + fixed[ai]);
      i += fixed[ai];
    } else if (ai === '10' || ai === '21') {
      let j = payload.indexOf('\x1d', i);
      if (j === -1) j = payload.length;
      out[ai] = payload.slice(i, j);
      i = j + 1;
    } else {
      break;
    }
  }
  return out;
}

export function gs1Expiry(fields: Record<string, string>): [number, number] | null {
  const v = fields['17'];
  if (v && v.length === 6 && /^\d{6}$/.test(v)) {
    const month = parseInt(v.slice(2, 4), 10);
    if (month >= 1 && month <= 12) {
      return [2000 + parseInt(v.slice(0, 2), 10), month];
    }
  }
  return null;
}

// ─── 3. Brand matching ──────────────────────────────────────────────

const CONF_PAIRS = new Set<string>();
for (const [a, b] of [
  ['0', 'O'], ['1', 'I'], ['1', 'L'], ['I', 'L'], ['5', 'S'],
  ['8', 'B'], ['2', 'Z'], ['6', 'G'], ['U', 'V'],
]) {
  CONF_PAIRS.add(a + b);
  CONF_PAIRS.add(b + a);
}

const CONF_SUB_COST = 0.25;
const MARGIN = 1.0;

export function weightedDistance(a: string, b: string): number {
  a = a.toUpperCase();
  b = b.toUpperCase();
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      const ca = a[i - 1], cb = b[j - 1];
      const sub = ca === cb ? 0 : (CONF_PAIRS.has(ca + cb) ? CONF_SUB_COST : 1.0);
      cur.push(Math.min(prev[j] + 1.0, cur[j - 1] + 1.0, prev[j - 1] + sub));
    }
    prev = cur;
  }
  return prev[b.length];
}

export function maxDist(n: number): number {
  return n <= 4 ? 0.5 : n <= 7 ? 1.0 : 1.5;
}

export interface BrandMatch {
  status: 'exact' | 'fuzzy' | 'ambiguous' | 'none';
  familyId?: number;
  name?: string;
  distance: number;
}

export function retrieve(db: Database, qn: string, limit: number = 60) {
  const codes = trigramCodes(skeleton(qn));
  const need = Math.max(2, Math.ceil(0.35 * codes.length));
  const placeholders = codes.map(() => '?').join(',');
  const sql = `SELECT n.id, n.family_id, n.name_norm, COUNT(*) AS c
    FROM name_trigrams t JOIN brand_names n ON n.id = t.name_id
    WHERE t.tri IN (${placeholders})
    GROUP BY t.name_id HAVING c >= ? ORDER BY c DESC LIMIT ?`;
  return query(db, sql, [...codes, need, limit]);
}

export function matchBrand(db: Database, cand: string): BrandMatch {
  const qn = normalizeName(cand);
  if (qn.length < 3) return { status: 'none', distance: 0 };

  const best = new Map<number, { dist: number; name: string }>();
  for (const row of retrieve(db, qn)) {
    const fid = row.family_id as number;
    const name = row.name_norm as string;
    const d = weightedDistance(qn, name);
    const existing = best.get(fid);
    if (!existing || d < existing.dist) {
      best.set(fid, { dist: d, name });
    }
  }

  const ranked = [...best.entries()]
    .map(([fid, { dist, name }]) => ({ dist, fid, name }))
    .sort((a, b) => a.dist - b.dist);

  if (ranked.length === 0) return { status: 'none', distance: 0 };

  const { dist: d1, fid: f1, name: n1 } = ranked[0];
  if (d1 === 0) return { status: 'exact', familyId: f1, name: n1, distance: 0 };
  if (d1 > maxDist(qn.length)) return { status: 'none', distance: 0 };
  if (ranked.length > 1 && ranked[1].dist - d1 < MARGIN) {
    return { status: 'ambiguous', distance: 0 };
  }
  return { status: 'fuzzy', familyId: f1, name: n1, distance: d1 };
}

const STOP = new Set([
  'TABLET', 'TABLETS', 'CAPSULE', 'CAPSULES', 'SYRUP', 'IP', 'BP', 'USP', 'EACH', 'CONTAINS',
  'STORE', 'BELOW', 'MRP', 'BATCH', 'EXP', 'MFG', 'DATE', 'FILM', 'COATED', 'ORAL',
  'SUSPENSION', 'DROPS',
]);

export function brandWindows(lines: Array<[string, number]>, topK: number = 3): string[] {
  const wins = new Set<string>();
  const sorted = [...lines].sort((a, b) => b[1] - a[1]).slice(0, topK);
  for (const [text] of sorted) {
    const toks = text.split(/[^A-Za-z0-9]+/).filter(Boolean);
    for (let i = 0; i < toks.length; i++) {
      for (let j = i + 1; j <= Math.min(i + 3, toks.length); j++) {
        const w = toks.slice(i, j).join(' ');
        const nw = normalizeName(w);
        const alphaCount = [...w].filter(c => /[A-Za-z]/.test(c)).length;
        const nwWords = new Set(nw.split(' '));
        const isAllStop = [...nwWords].every(word => STOP.has(word));
        if (nw.length >= 3 && alphaCount >= 2 && !isAllStop) {
          wins.add(w);
        }
      }
    }
  }
  return [...wins].sort();
}

// ─── 4. Frames, voting, gate ────────────────────────────────────────

export interface FrameRead {
  strengths: Map<string, boolean>; // canon -> doseLike
  expiries: Set<string>; // serialized [year, month] as "year,month"
  brands: Map<number, number>; // familyId -> best distance
  ambiguous: boolean;
}

export function analyseFrame(lines: Array<[string, number]>, db: Database): FrameRead {
  const text = lines.map(([t]) => t).join('\n');
  const fr: FrameRead = {
    strengths: new Map(),
    expiries: new Set(),
    brands: new Map(),
    ambiguous: false,
  };
  for (const s of extractStrengths(text)) {
    fr.strengths.set(s.canon, s.doseLike);
  }
  for (const [y, m] of extractExpiry(text)) {
    fr.expiries.add(`${y},${m}`);
  }
  for (const w of brandWindows(lines)) {
    const bm = matchBrand(db, w);
    if ((bm.status === 'exact' || bm.status === 'fuzzy') && bm.familyId !== undefined) {
      const existing = fr.brands.get(bm.familyId);
      if (existing === undefined || bm.distance < existing) {
        fr.brands.set(bm.familyId, bm.distance);
      }
    } else if (bm.status === 'ambiguous') {
      fr.ambiguous = true;
    }
  }
  return fr;
}

export interface VoteParams {
  minFrames: number;
  minAgree: number;
  minRatio: number;
  conflictRatio: number;
}

export const DEFAULT_PARAMS: VoteParams = {
  minFrames: 5,
  minAgree: 3,
  minRatio: 0.7,
  conflictRatio: 0.3,
};

export function vote(sets: Set<string>[], p: VoteParams): { accepted: string[]; dissent: string[]; n: number } {
  const detected = sets.filter(s => s.size > 0);
  const n = detected.length;
  const counts = new Map<string, number>();
  for (const s of detected) {
    for (const v of s) counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  const accepted: string[] = [];
  for (const [v, c] of counts) {
    if (c >= p.minAgree && c / n >= p.minRatio) accepted.push(v);
  }
  const acceptedSet = new Set(accepted);
  const dissent: string[] = [];
  for (const [v, c] of counts) {
    if (!acceptedSet.has(v) && c / n >= p.conflictRatio) dissent.push(v);
  }
  return { accepted, dissent, n };
}

export interface Decision {
  status: 'FULL' | 'PARTIAL' | 'ABSTAIN';
  brand?: string;
  strengths: string[];
  expiry?: [number, number];
  expired?: boolean;
  reasons: string[];
}

export function familyInfo(db: Database, fid: number): { key: string; strengths: Set<string> } {
  const row = queryOne(db, 'SELECT family_key FROM brand_families WHERE id=?', [fid]);
  const key = (row?.family_key as string);
  // Title case
  const title = key.charAt(0).toUpperCase() + key.slice(1).toLowerCase();
  const srows = query(db, 'SELECT strength_canon FROM family_strengths WHERE family_id=?', [fid]);
  const strengths = new Set<string>(srows.map(r => r.strength_canon as string));
  return { key: title, strengths };
}

export function readLabel(
  frames: Array<Array<[string, number]>>,
  db: Database,
  today: Date,
  p: VoteParams = DEFAULT_PARAMS,
): Decision {
  if (frames.length < p.minFrames) {
    return { status: 'ABSTAIN', strengths: [], reasons: ['too_few_frames'] };
  }

  const reads = frames.map(f => analyseFrame(f, db));

  // --- brand
  const bsets = reads.map(r => {
    const s = new Set<string>([...r.brands.keys()].map(String));
    if (r.ambiguous) s.add('AMBIG');
    return s;
  });
  const { accepted: bAcc, dissent: bDiss } = vote(bsets, p);
  const fams = bAcc.filter(a => a !== 'AMBIG');
  if (
    bAcc.includes('AMBIG') ||
    bDiss.includes('AMBIG') ||
    fams.length > 1 ||
    bDiss.filter(d => d !== 'AMBIG').length > 0
  ) {
    return { status: 'ABSTAIN', strengths: [], reasons: ['brand_ambiguous'] };
  }
  if (fams.length !== 1) {
    return { status: 'ABSTAIN', strengths: [], reasons: ['brand_not_verified'] };
  }

  const fid = parseInt(fams[0], 10);
  const { key: brand, strengths: known } = familyInfo(db, fid);
  const d: Decision = { status: 'PARTIAL', brand, strengths: [], reasons: [] };

  // --- strength
  const doseFlag = new Map<string, boolean>();
  for (const r of reads) {
    for (const [k, v] of r.strengths) doseFlag.set(k, v);
  }
  const { accepted: sAcc } = vote(reads.map(r => new Set(r.strengths.keys())), p);
  const dose = sAcc.filter(s => doseFlag.get(s) === true);

  if (dose.length > 0 && known.size === 0) {
    d.reasons.push('strength_unverifiable');
  } else if (dose.length > 0) {
    const bad = dose.filter(s => !known.has(s));
    if (bad.length > 0) {
      return { status: 'ABSTAIN', brand, strengths: [], reasons: ['strength_implausible'] };
    }
    d.strengths = [...dose].sort();
  } else {
    d.reasons.push('strength_unclear');
  }

  // --- expiry
  const expSets = reads.map(r => r.expiries);
  const { accepted: eAcc, dissent: eDiss } = vote(expSets, p);
  if (eAcc.length === 1 && eDiss.length === 0) {
    const [y, m] = eAcc[0].split(',').map(Number) as [number, number];
    d.expiry = [y, m];
    const todayY = today.getFullYear();
    const todayM = today.getMonth() + 1; // JS months are 0-based
    d.expired = y < todayY || (y === todayY && m < todayM);
  } else {
    d.reasons.push('expiry_unclear');
  }

  d.status = d.strengths.length > 0 && d.expiry ? 'FULL' : 'PARTIAL';
  return d;
}

export function applyGs1(
  d: Decision,
  codeExpiry: [number, number] | null,
  today: Date,
): Decision {
  if (codeExpiry === null || d.status === 'ABSTAIN') return d;
  if (d.expiry && (d.expiry[0] !== codeExpiry[0] || d.expiry[1] !== codeExpiry[1])) {
    return { status: 'ABSTAIN', brand: d.brand, strengths: [], reasons: ['code_label_conflict'] };
  }
  if (!d.expiry) {
    const todayY = today.getFullYear();
    const todayM = today.getMonth() + 1;
    d.expiry = codeExpiry;
    d.expired = codeExpiry[0] < todayY || (codeExpiry[0] === todayY && codeExpiry[1] < todayM);
    d.reasons = d.reasons.filter(r => r !== 'expiry_unclear').concat('expiry_from_code');
    d.status = d.strengths.length > 0 ? 'FULL' : 'PARTIAL';
  }
  return d;
}

// ─── 5. Speech rendering ────────────────────────────────────────────

const DIG: Record<string, string> = {};
'0123456789'.split('').forEach((d, i) => {
  DIG[d] = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'][i];
});

const UNIT_W: Record<string, string> = {
  mg: 'milligrams', mcg: 'micrograms', g: 'grams', iu: 'international units',
  ml: 'millilitres', '%': 'percent',
};

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function spellNumber(s: string): string {
  return s.split('').map(ch => ch === '.' ? 'point' : DIG[ch]).join(' ');
}

export function speakStrength(canon: string): string {
  const [main, per] = canon.split('/');
  const [v, u] = main.split(' ');
  let out = `${spellNumber(v)} ${UNIT_W[u]}`;
  if (per) {
    const [pv, pu] = per.split(' ');
    out += pv === '1' ? ` per ${UNIT_W[pu].slice(0, -1)}` : ` per ${spellNumber(pv)} ${UNIT_W[pu]}`;
  }
  return out;
}

const ABSTAIN_TEXT: Record<string, string> = {
  too_few_frames: 'I could not read this reliably. Try again, or ask for help.',
  brand_not_verified: 'I cannot tell which medicine this is. Please ask for help.',
  brand_ambiguous: 'I cannot tell which medicine this is. Please ask for help.',
  strength_implausible: 'The strength I read does not match this medicine. Please ask for help.',
  code_label_conflict: 'The label and the code do not agree. Please ask for help.',
};

export function renderText(d: Decision): string {
  if (d.status === 'ABSTAIN') {
    return ABSTAIN_TEXT[d.reasons[0]] ?? ABSTAIN_TEXT.too_few_frames;
  }
  const parts: string[] = [`${d.brand}.`];
  if (d.strengths.length > 0) {
    parts.push(d.strengths.map(speakStrength).join(' and ') + '.');
  }
  if (d.expiry) {
    const [y, m] = d.expiry;
    parts.push(
      d.expired
        ? `Expired ${MONTH_NAMES[m - 1]} ${y}. This medicine is past its expiry date.`
        : `Expires ${MONTH_NAMES[m - 1]} ${y}. Valid.`,
    );
  }
  const flags: string[] = [];
  if (d.reasons.includes('strength_unclear') || d.reasons.includes('strength_unverifiable')) {
    flags.push('Strength is unclear.');
  }
  if (d.reasons.includes('expiry_unclear')) {
    flags.push('I could not read the expiry date.');
  }
  if (flags.length > 0) {
    parts.push(...flags, 'Please ask someone to check.');
  }
  return parts.join(' ');
}
