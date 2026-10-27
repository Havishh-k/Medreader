import { describe, expect, it } from 'vitest';
import { chooseUnambiguousMatch, isSafeMedicineToken } from '../../src/core/medicine-match-policy';

describe('medicine match safety policy', () => {
  it('rejects short and report-like OCR tokens', () => {
    expect(isSafeMedicineToken('O2')).toBe(false);
    expect(isSafeMedicineToken('PATIENT')).toBe(false);
    expect(isSafeMedicineToken('AMLOKIND')).toBe(true);
  });

  it('abstains when two medicine families are too close', () => {
    expect(chooseUnambiguousMatch([
      { familyId: 1, distance: 0 },
      { familyId: 2, distance: 0.5 },
    ])).toBeNull();
  });

  it('accepts a match with a full-point margin', () => {
    expect(chooseUnambiguousMatch([
      { familyId: 1, distance: 0 },
      { familyId: 2, distance: 1 },
    ])).toEqual({ familyId: 1, distance: 0 });
  });
});
