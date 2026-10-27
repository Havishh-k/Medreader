const CLINICAL_MARKERS = [
  'patient', 'doctor', 'hospital', 'clinic', 'diagnosis', 'laboratory',
  'medical report', 'test report', 'reference range', 'specimen',
  'investigation', 'consultant', 'chief complaint', 'medical record',
];

/** Keep report line breaks while removing OCR spacing noise. */
export function cleanScannedText(text: string): string {
  return text
    .split(/\r?\n/)
    .map(line => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .trim();
}

export function isLikelyClinicalDocument(text: string): boolean {
  const clean = cleanScannedText(text).toLowerCase();
  if (!clean) return false;

  const markerCount = CLINICAL_MARKERS.filter(marker => clean.includes(marker)).length;
  const labelledFields = new Set(
    [...clean.matchAll(/\b(patient|name|age|sex|date|doctor|diagnosis|test|result|range|uhid|opd)\s*[:\-]/g)]
      .map(match => match[1]),
  ).size;
  const wordCount = clean.split(/\s+/).length;

  return markerCount >= 2 || labelledFields >= 2 || (markerCount >= 1 && wordCount >= 18);
}

export function isReadableDocument(text: string): boolean {
  const clean = cleanScannedText(text);
  if (!clean) return false;
  const wordCount = clean.split(/\s+/).length;
  const lineCount = clean.split('\n').length;
  return isLikelyClinicalDocument(clean) || wordCount >= 18 || (wordCount >= 10 && lineCount >= 3);
}

export function bestScannedText(texts: string[]): string {
  return texts
    .map(cleanScannedText)
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)[0] || '';
}

export interface MedicineRead {
  brand_name: string;
  generic_name?: string;
  strength?: string;
  distance: number;
  expiry?: { year: number; month: number } | null;
  manufacturer?: string;
  source_url?: string;
}

export function findMedicineConsensus(reads: MedicineRead[]): MedicineRead | null {
  const counts = new Map<string, number>();
  for (const read of reads) {
    counts.set(read.brand_name, (counts.get(read.brand_name) || 0) + 1);
  }

  for (const [brand, count] of counts) {
    if (count >= 2) {
      return [...reads].reverse().find(read => read.brand_name === brand) || null;
    }
  }
  return null;
}
