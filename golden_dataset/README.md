# EchoSight Golden Dataset

Structured evaluation dataset for benchmarking OCR accuracy across medicine labels and documents.

## Target: 20 Medicines + 10 Documents = 30 Samples

## Directory Structure

```
golden_dataset/
├── medicines/
│   ├── MED-001/
│   │   ├── frame.png          ← Photo from phone camera (640×480 min)
│   │   ├── ground_truth.json  ← Hand-typed truth (see schema below)
│   │   └── metadata.json      ← Capture conditions
│   └── MED-002/ ...
├── documents/
│   ├── DOC-001/
│   │   ├── frame.png
│   │   ├── ground_truth.txt   ← Exact text, character-for-character
│   │   └── metadata.json
│   └── DOC-002/ ...
└── README.md
```

## Medicine ground_truth.json Schema

```json
{
  "brand_name": "Otrivin Oxy",
  "generic": "Oxymetazoline Hydrochloride",
  "strength": "0.05% w/v",
  "expiry": "11/2027",
  "manufacturer": "Novartis"
}
```

## Medicine metadata.json Schema

```json
{
  "surface": "glossy | matte | foil",
  "curvature": "none | slight | cylindrical",
  "lighting": "good | dim | harsh",
  "distance_cm": 20,
  "capture_device": "Samsung Galaxy M13"
}
```

## Document metadata.json Schema

```json
{
  "category": "clean_a4 | notice_board | worksheet | low_light | skewed",
  "lighting": "good | dim | harsh",
  "rotation_deg": 0,
  "distance_cm": 25,
  "font_size_pt": 12,
  "capture_device": "Samsung Galaxy M13"
}
```

## Capture Protocol

1. Use the EchoSight PWA's own camera (or any phone camera at similar resolution)
2. Hold at ~20cm for medicines, ~25cm for documents
3. Capture in realistic conditions (some dim, some glossy, some angled)
4. Name directories sequentially: MED-001, MED-002, ..., DOC-001, DOC-002, ...
5. Type ground truth carefully — this is what CER/WER is measured against

## Recommended Distribution

### Medicines (20 samples)
| Category | Count | Examples |
|:---------|:------|:---------|
| Tablets (blister pack) | 5 | Crocin, Dolo, Combiflam |
| Bottles (nasal/syrup) | 5 | Otrivin, Ascoril, Calpol |
| Tubes (ointment/gel) | 3 | Volini, Betadine |
| Glossy/foil packaging | 3 | Augmentin, Azithral |
| Expired medicines | 2 | Any with past date |
| Low-light conditions | 2 | Any medicine, dim room |

### Documents (10 samples)
| Category | Count | Examples |
|:---------|:------|:---------|
| Clean A4 print | 4 | Assignment, notice |
| Notice board / poster | 3 | College notice |
| Handwritten (clear) | 2 | Worksheet |
| Skewed / angled | 1 | Any doc at 15° |

## Running the Benchmark

```bash
npx tsx scripts/evaluate.ts
```

Outputs: `benchmark_results.md` and `benchmark_results.csv`
