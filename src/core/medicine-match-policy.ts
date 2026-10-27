export const MEDICINE_STOP_WORDS = new Set([
  'THE', 'FOR', 'AND', 'WITH', 'NOT', 'USE', 'SOLUTION', 'TABLET', 'TABLETS',
  'SYRUP', 'DROPS', 'CAPSULE', 'CAPSULES', 'INJECTION', 'FAST', 'RELIEF',
  'NASAL', 'HYDROCHLORIDE', 'ONLY', 'KEEP', 'PATIENT', 'DOCTOR', 'HOSPITAL',
  'CLINIC', 'REPORT', 'RESULT', 'DATE', 'NAME', 'AGE', 'MALE', 'FEMALE',
]);

export function isSafeMedicineToken(token: string): boolean {
  return token.length >= 4 && !MEDICINE_STOP_WORDS.has(token);
}

export function chooseUnambiguousMatch<T extends { familyId: number; distance: number }>(matches: T[]): T | null {
  const ranked = [...matches].sort((a, b) => a.distance - b.distance);
  const best = ranked[0];
  const runnerUp = ranked.find(match => match.familyId !== best?.familyId);
  if (!best || (runnerUp && runnerUp.distance - best.distance < 1)) return null;
  return best;
}
