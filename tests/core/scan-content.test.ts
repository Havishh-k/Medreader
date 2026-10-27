import { describe, expect, it } from 'vitest';
import {
  bestScannedText,
  cleanScannedText,
  findMedicineConsensus,
  isLikelyClinicalDocument,
  isReadableDocument,
} from '../../src/core/scan-content';

describe('scan content classification', () => {
  it('recognizes a clinical report from its fields', () => {
    const report = `City Hospital\nPatient: Asha Patil\nAge: 64  Sex: F\nDiagnosis: Hypertension\nDoctor: Dr Mehta\nPrescription: Amlodipine 5 mg daily`;
    expect(isLikelyClinicalDocument(report)).toBe(true);
  });

  it('does not classify a short medicine label as a report', () => {
    expect(isLikelyClinicalDocument('Cipla Asthalin 100 mcg inhaler EXP 11/27')).toBe(false);
  });

  it('keeps complete report lines and chooses the fullest OCR result', () => {
    const full = cleanScannedText(' Patient: Asha  Patil \n\n Doctor: Mehta \n Diagnosis: Stable ');
    expect(full).toBe('Patient: Asha Patil\nDoctor: Mehta\nDiagnosis: Stable');
    expect(bestScannedText(['Patient: Asha', full])).toBe(full);
    expect(isReadableDocument(full)).toBe(true);
  });

  it('requires repeated medicine agreement even for a close fuzzy match', () => {
    const strongRead = { brand_name: 'Amlokind', strength: '5 mg', distance: 0 };
    expect(findMedicineConsensus([strongRead])).toBeNull();
    expect(findMedicineConsensus([strongRead, { ...strongRead, distance: 0.25 }])).toEqual({
      ...strongRead,
      distance: 0.25,
    });
  });
});
