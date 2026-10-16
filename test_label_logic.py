import unittest
from datetime import date
from label_logic import *

TODAY = date(2026, 9, 21)


def frame(brand="Crocin", strength="500 mg", exp="EXP. 11/2026", extra=()):
    lines = [(brand, 1.0)]
    if strength:
        lines.append((f"Paracetamol Tablets IP {strength}", 0.4))
    if exp:
        lines.append((exp, 0.3))
    lines += [(t, 0.2) for t in extra]
    return lines


class Extraction(unittest.TestCase):
    def test_strength_vectors(self):
        cases = {
            "Paracetamol Tablets IP 500 mg": ["500 mg"],
            "PARACETAMOL 500MG": ["500 mg"],
            "Paracetamol 125 mg/5 ml": ["125 mg/5 ml"],
            "Each ml contains 5 mg/ml": ["5 mg/1 ml"],
            "Timolol 0.5 % w/v": ["0.5 %"],
            "Cr0cin 5O0 mg": ["500 mg"],
            "Vitamin D3 60000 IU": ["60000 iu"],
            "Folic acid 400 µg": ["400 mcg"],
            "Pack of 10 tablets": [],
        }
        for text, want in cases.items():
            self.assertEqual([s.canon for s in extract_strengths(text)], want, text)

    def test_pack_size_not_dose_like(self):
        s = extract_strengths("Net content 60 ml")[0]
        self.assertFalse(s.dose_like)

    def test_expiry_vectors(self):
        cases = {
            "Exp. Date: 11/2026": [(2026, 11)], "EXP. 11/26": [(2026, 11)],
            "EXPIRY DATE NOV.2026": [(2026, 11)], "Expiry Date: 11/2026": [(2026, 11)],
            "MFG 05/2024 EXP 04/2028": [(2028, 4)], "Exp: Nov 2026": [(2026, 11)],
            "exp 11/2026": [(2026, 11)], "Use before 11-2026": [(2026, 11)],
            "EXP 1I/2O26": [(2026, 11)], "B.No. AB123 MFG. 05/24": [],
            "EXP 13/2026": [],
        }
        for text, want in cases.items():
            self.assertEqual(extract_expiry(text), want, text)

    def test_digit_normalisation_does_not_touch_words(self):
        self.assertEqual(normalize_digits("Cr0cin Oil"), "Cr0cin Oil")
        self.assertEqual(normalize_digits("5O0 mg"), "500 mg")

    def test_weighted_distance(self):
        self.assertEqual(weighted_distance("CR0CIN", "CROCIN"), 0.25)
        self.assertEqual(weighted_distance("ZYRTEC", "ZANTAC"), 3.0)
        self.assertEqual(weighted_distance("LOSEC", "LASIX"), 3.0)

    def test_parity_vectors(self):  # Kotlin port must match these exactly
        self.assertEqual(skeleton("Cr0cin"), "CROCIN")
        self.assertEqual(skeleton("Crocln"), "CROCIN")
        self.assertEqual(skeleton("Dolo 650"), "DOIO GSO")
        self.assertEqual(trigram_codes("CROCIN"), [3, 129, 4454, 4788, 12839, 20655, 25200])
        self.assertEqual(trigram_codes(skeleton("Dolo 650")), [4, 163, 278, 6040, 10301, 12876, 20542, 20883, 26566])

    def test_gs1(self):
        f = parse_gs1("(01)08901234567890(17)261100(10)AB123")
        self.assertEqual(gs1_expiry(f), (2026, 11))
        raw = "0108901234567890" + "17261100" + "10AB123\x1d21XYZ"
        self.assertEqual(parse_gs1(raw)["10"], "AB123")
        self.assertEqual(gs1_expiry(parse_gs1(raw)), (2026, 11))


class Gate(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.db = fixture_db()

    def run_gate(self, frames):
        return read_label(frames, self.db, TODAY)

    def test_clean_full_readout(self):
        d = self.run_gate([frame()] * 6)
        self.assertEqual((d.status, d.brand, d.strengths, d.expiry, d.expired), ("FULL", "Crocin", ["500 mg"], (2026, 11), False))
        self.assertEqual(render_text(d), "Crocin. five zero zero milligrams. Expires November 2026. Valid.")

    def test_ocr_confusions_still_verified(self):
        d = self.run_gate([frame("Cr0cin", "5O0 mg", "EXP 1I/2O26")] * 6)
        self.assertEqual((d.status, d.brand, d.strengths, d.expiry), ("FULL", "Crocin", ["500 mg"], (2026, 11)))

    def test_field_visible_in_too_few_frames_is_not_spoken(self):
        frames = [frame()] * 2 + [frame(strength=None)] * 4
        d = self.run_gate(frames)
        self.assertEqual(d.status, "PARTIAL")
        self.assertEqual(d.strengths, [])
        self.assertIn("strength_unclear", d.reasons)
        self.assertIn("Strength is unclear.", render_text(d))

    def test_conflicting_strength_reads_not_spoken(self):
        frames = [frame(strength="500 mg")] * 4 + [frame(strength="650 mg")] * 3
        d = self.run_gate(frames)
        self.assertEqual(d.strengths, [])
        self.assertIn("strength_unclear", d.reasons)

    def test_consistent_but_implausible_strength_abstains(self):
        d = self.run_gate([frame(strength="900 mg")] * 6)
        self.assertEqual((d.status, d.reasons), ("ABSTAIN", ["strength_implausible"]))

    def test_ambiguous_brand_abstains(self):
        d = self.run_gate([frame("Alphix", "100 mg")] * 6)
        self.assertEqual((d.status, d.reasons), ("ABSTAIN", ["brand_ambiguous"]))

    def test_exact_brand_wins_over_close_lookalike(self):
        d = self.run_gate([frame("Alphax", "100 mg")] * 6)
        self.assertEqual((d.status, d.brand), ("FULL", "Alphax"))

    def test_unknown_brand_abstains(self):
        d = self.run_gate([frame("Zorblax", "500 mg")] * 6)
        self.assertEqual((d.status, d.reasons), ("ABSTAIN", ["brand_not_verified"]))

    def test_expired(self):
        d = self.run_gate([frame(exp="EXP 03/2026")] * 6)
        self.assertTrue(d.expired)
        self.assertIn("Expired March 2026", render_text(d))

    def test_current_month_is_still_valid(self):
        d = self.run_gate([frame(exp="EXP 09/2026")] * 6)
        self.assertFalse(d.expired)

    def test_mfg_is_not_taken_as_expiry(self):
        d = self.run_gate([frame(exp="MFG 05/2024 EXP 04/2028")] * 6)
        self.assertEqual(d.expiry, (2028, 4))

    def test_conflicting_expiry_reads_flagged(self):
        frames = [frame(exp="EXP 11/2026")] * 3 + [frame(exp="EXP 11/2028")] * 3
        d = self.run_gate(frames)
        self.assertIn("expiry_unclear", d.reasons)
        self.assertIsNone(d.expiry)

    def test_pack_size_is_ignored_not_abstained(self):
        d = self.run_gate([frame(extra=["Net content 60 ml"])] * 6)
        self.assertEqual((d.status, d.strengths), ("FULL", ["500 mg"]))

    def test_compound_strength_spoken(self):
        d = self.run_gate([frame("Calpol", "125 mg/5 ml")] * 6)
        self.assertEqual(d.strengths, ["125 mg/5 ml"])
        self.assertIn("one two five milligrams per five millilitres", render_text(d))

    def test_percent_strength(self):
        d = self.run_gate([frame("Ocumol", "0.5 %")] * 6)
        self.assertIn("zero point five percent", render_text(d))

    def test_too_few_frames_abstains(self):
        self.assertEqual(self.run_gate([frame()] * 3).reasons, ["too_few_frames"])

    def test_no_text_abstains(self):
        self.assertEqual(self.run_gate([[]] * 6).status, "ABSTAIN")

    def test_code_label_conflict_abstains(self):
        d = self.run_gate([frame()] * 6)
        self.assertEqual(apply_gs1(d, (2027, 1), TODAY).reasons, ["code_label_conflict"])

    def test_code_fills_missing_expiry(self):
        d = self.run_gate([frame(exp=None)] * 6)
        d = apply_gs1(d, (2027, 1), TODAY)
        self.assertEqual((d.status, d.expiry), ("FULL", (2027, 1)))


if __name__ == "__main__":
    unittest.main(verbosity=2)
