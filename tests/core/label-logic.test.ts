import { describe, test, expect, beforeAll } from 'vitest';
import { Database } from 'sql.js';
import { fixtureDb } from './fixture-db';
import {
  extractStrengths,
  extractExpiry,
  normalizeDigits,
  weightedDistance,
  skeleton,
  trigramCodes,
  parseGs1,
  gs1Expiry,
  readLabel,
  renderText,
  applyGs1,
} from '../../src/core/label-logic';

const TODAY = new Date(2026, 8, 21); // Month is 0-indexed in JS (8 = September)

function frame(brand: string = "Crocin", strength: string | null = "500 mg", exp: string | null = "EXP. 11/2026", extra: string[] = []): Array<[string, number]> {
  const lines: Array<[string, number]> = [[brand, 1.0]];
  if (strength) lines.push([`Paracetamol Tablets IP ${strength}`, 0.4]);
  if (exp) lines.push([exp, 0.3]);
  extra.forEach(t => lines.push([t, 0.2]));
  return lines;
}

describe('Extraction', () => {
  test('strength_vectors', () => {
    const cases: Record<string, string[]> = {
      "Paracetamol Tablets IP 500 mg": ["500 mg"],
      "PARACETAMOL 500MG": ["500 mg"],
      "Paracetamol 125 mg/5 ml": ["125 mg/5 ml"],
      "Each ml contains 5 mg/ml": ["5 mg/1 ml"],
      "Timolol 0.5 % w/v": ["0.5 %"],
      "Cr0cin 5O0 mg": ["500 mg"],
      "Vitamin D3 60000 IU": ["60000 iu"],
      "Folic acid 400 µg": ["400 mcg"],
      "Pack of 10 tablets": [],
    };
    for (const [text, want] of Object.entries(cases)) {
      expect(extractStrengths(text).map(s => s.canon)).toEqual(want);
    }
  });

  test('pack_size_not_dose_like', () => {
    const s = extractStrengths("Net content 60 ml")[0];
    expect(s.doseLike).toBe(false);
  });

  test('expiry_vectors', () => {
    const cases: Record<string, [number, number][]> = {
      "Exp. Date: 11/2026": [[2026, 11]], "EXP. 11/26": [[2026, 11]],
      "EXPIRY DATE NOV.2026": [[2026, 11]], "Expiry Date: 11/2026": [[2026, 11]],
      "MFG 05/2024 EXP 04/2028": [[2028, 4]], "Exp: Nov 2026": [[2026, 11]],
      "exp 11/2026": [[2026, 11]], "Use before 11-2026": [[2026, 11]],
      "EXP 1I/2O26": [[2026, 11]], "B.No. AB123 MFG. 05/24": [],
      "EXP 13/2026": [],
    };
    for (const [text, want] of Object.entries(cases)) {
      expect(extractExpiry(text)).toEqual(want);
    }
  });

  test('digit_normalisation_does_not_touch_words', () => {
    expect(normalizeDigits("Cr0cin Oil")).toBe("Cr0cin Oil");
    expect(normalizeDigits("5O0 mg")).toBe("500 mg");
  });

  test('weighted_distance', () => {
    expect(weightedDistance("CR0CIN", "CROCIN")).toBe(0.25);
    expect(weightedDistance("ZYRTEC", "ZANTAC")).toBe(3.0);
    expect(weightedDistance("LOSEC", "LASIX")).toBe(3.0);
  });

  test('parity_vectors', () => {
    expect(skeleton("Cr0cin")).toBe("CROCIN");
    expect(skeleton("Crocln")).toBe("CROCIN");
    expect(skeleton("Dolo 650")).toBe("DOIO GSO");
    expect(trigramCodes("CROCIN")).toEqual([3, 129, 4454, 4788, 12839, 20655, 25200]);
    expect(trigramCodes(skeleton("Dolo 650"))).toEqual([4, 163, 278, 6040, 10301, 12876, 20542, 20883, 26566]);
  });

  test('gs1', () => {
    const f = parseGs1("(01)08901234567890(17)261100(10)AB123");
    expect(gs1Expiry(f)).toEqual([2026, 11]);
    const raw = "01089012345678901726110010AB123\x1d21XYZ";
    expect(parseGs1(raw)["10"]).toBe("AB123");
    expect(gs1Expiry(parseGs1(raw))).toEqual([2026, 11]);
  });
});

describe('Gate', () => {
  let db: Database;

  beforeAll(async () => {
    db = await fixtureDb();
  });

  function runGate(frames: Array<Array<[string, number]>>) {
    return readLabel(frames, db, TODAY);
  }

  test('clean_full_readout', () => {
    const d = runGate(Array(6).fill(frame()));
    expect([d.status, d.brand, d.strengths, d.expiry, d.expired]).toEqual(["FULL", "Crocin", ["500 mg"], [2026, 11], false]);
    expect(renderText(d)).toBe("Crocin. five zero zero milligrams. Expires November 2026. Valid.");
  });

  test('ocr_confusions_still_verified', () => {
    const d = runGate(Array(6).fill(frame("Cr0cin", "5O0 mg", "EXP 1I/2O26")));
    expect([d.status, d.brand, d.strengths, d.expiry]).toEqual(["FULL", "Crocin", ["500 mg"], [2026, 11]]);
  });

  test('field_visible_in_too_few_frames_is_not_spoken', () => {
    const frames = [...Array(2).fill(frame()), ...Array(4).fill(frame("Crocin", null))];
    const d = runGate(frames);
    expect(d.status).toBe("PARTIAL");
    expect(d.strengths).toEqual([]);
    expect(d.reasons).toContain("strength_unclear");
    expect(renderText(d)).toContain("Strength is unclear.");
  });

  test('conflicting_strength_reads_not_spoken', () => {
    const frames = [...Array(4).fill(frame("Crocin", "500 mg")), ...Array(3).fill(frame("Crocin", "650 mg"))];
    const d = runGate(frames);
    expect(d.strengths).toEqual([]);
    expect(d.reasons).toContain("strength_unclear");
  });

  test('consistent_but_implausible_strength_abstains', () => {
    const d = runGate(Array(6).fill(frame("Crocin", "900 mg")));
    expect([d.status, d.reasons]).toEqual(["ABSTAIN", ["strength_implausible"]]);
  });

  test('ambiguous_brand_abstains', () => {
    const d = runGate(Array(6).fill(frame("Alphix", "100 mg")));
    expect([d.status, d.reasons]).toEqual(["ABSTAIN", ["brand_ambiguous"]]);
  });

  test('exact_brand_wins_over_close_lookalike', () => {
    const d = runGate(Array(6).fill(frame("Alphax", "100 mg")));
    expect([d.status, d.brand]).toEqual(["FULL", "Alphax"]);
  });

  test('unknown_brand_abstains', () => {
    const d = runGate(Array(6).fill(frame("Zorblax", "500 mg")));
    expect([d.status, d.reasons]).toEqual(["ABSTAIN", ["brand_not_verified"]]);
  });

  test('expired', () => {
    const d = runGate(Array(6).fill(frame("Crocin", "500 mg", "EXP 03/2026")));
    expect(d.expired).toBe(true);
    expect(renderText(d)).toContain("Expired March 2026");
  });

  test('current_month_is_still_valid', () => {
    const d = runGate(Array(6).fill(frame("Crocin", "500 mg", "EXP 09/2026")));
    expect(d.expired).toBe(false);
  });

  test('mfg_is_not_taken_as_expiry', () => {
    const d = runGate(Array(6).fill(frame("Crocin", "500 mg", "MFG 05/2024 EXP 04/2028")));
    expect(d.expiry).toEqual([2028, 4]);
  });

  test('conflicting_expiry_reads_flagged', () => {
    const frames = [...Array(3).fill(frame("Crocin", "500 mg", "EXP 11/2026")), ...Array(3).fill(frame("Crocin", "500 mg", "EXP 11/2028"))];
    const d = runGate(frames);
    expect(d.reasons).toContain("expiry_unclear");
    expect(d.expiry).toBeUndefined();
  });

  test('pack_size_is_ignored_not_abstained', () => {
    const d = runGate(Array(6).fill(frame("Crocin", "500 mg", "EXP. 11/2026", ["Net content 60 ml"])));
    expect([d.status, d.strengths]).toEqual(["FULL", ["500 mg"]]);
  });

  test('compound_strength_spoken', () => {
    const d = runGate(Array(6).fill(frame("Calpol", "125 mg/5 ml")));
    expect(d.strengths).toEqual(["125 mg/5 ml"]);
    expect(renderText(d)).toContain("one two five milligrams per five millilitres");
  });

  test('percent_strength', () => {
    const d = runGate(Array(6).fill(frame("Ocumol", "0.5 %")));
    expect(renderText(d)).toContain("zero point five percent");
  });

  test('too_few_frames_abstains', () => {
    expect(runGate(Array(3).fill(frame())).reasons).toEqual(["too_few_frames"]);
  });

  test('no_text_abstains', () => {
    expect(runGate(Array(6).fill([])).status).toBe("ABSTAIN");
  });

  test('code_label_conflict_abstains', () => {
    const d = runGate(Array(6).fill(frame()));
    expect(applyGs1(d, [2027, 1], TODAY).reasons).toEqual(["code_label_conflict"]);
  });

  test('code_fills_missing_expiry', () => {
    let d = runGate(Array(6).fill(frame("Crocin", "500 mg", null)));
    d = applyGs1(d, [2027, 1], TODAY);
    expect([d.status, d.expiry]).toEqual(["FULL", [2027, 1]]);
  });
});
