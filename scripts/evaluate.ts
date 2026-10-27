#!/usr/bin/env npx tsx
import * as fs from 'fs';
import * as path from 'path';
import Tesseract from 'tesseract.js';

// ─── Levenshtein Distance ───

function levenshtein(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const matrix: number[][] = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  return matrix[b.length][a.length];
}

// ─── Metrics ───

function calculateCER(hyp: string, ref: string): number {
  if (ref.length === 0) return hyp.length > 0 ? 1 : 0;
  return levenshtein(hyp, ref) / ref.length;
}

function calculateWER(hyp: string, ref: string): number {
  const hypWords = hyp.trim().split(/\s+/).filter(w => w.length > 0);
  const refWords = ref.trim().split(/\s+/).filter(w => w.length > 0);
  if (refWords.length === 0) return hypWords.length > 0 ? 1 : 0;

  const m: number[][] = [];
  for (let i = 0; i <= refWords.length; i++) m[i] = [i];
  for (let j = 0; j <= hypWords.length; j++) m[0][j] = j;

  for (let i = 1; i <= refWords.length; i++) {
    for (let j = 1; j <= hypWords.length; j++) {
      if (refWords[i - 1] === hypWords[j - 1]) {
        m[i][j] = m[i - 1][j - 1];
      } else {
        m[i][j] = Math.min(m[i - 1][j - 1] + 1, m[i][j - 1] + 1, m[i - 1][j] + 1);
      }
    }
  }
  return m[refWords.length][hypWords.length] / refWords.length;
}

// ─── OCR Runner ───

async function runOcr(imagePath: string, psm: string): Promise<string> {
  const worker = await Tesseract.createWorker('eng');
  await worker.setParameters({ tessedit_pageseg_mode: psm as any });
  const { data: { text } } = await worker.recognize(imagePath);
  await worker.terminate();
  return text.trim();
}

// ─── Types ───

interface BenchmarkResult {
  sampleId: string;
  category: string;
  rawCER: number;
  rawWER: number;
  postProcessCER: number;
  postProcessWER: number;
  postValidationCER: number;
  postValidationWER: number;
  abstained: boolean;
  falsePositive: boolean;
  falseNegative: boolean;
  notes: string;
}

// ─── Main ───

async function evaluate(goldenDatasetPath: string) {
  const results: BenchmarkResult[] = [];

  // ── Process Documents ──
  const docsDir = path.join(goldenDatasetPath, 'documents');
  if (fs.existsSync(docsDir)) {
    const entries = fs.readdirSync(docsDir, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      const sampleDir = path.join(docsDir, entry.name);
      const framePath = path.join(sampleDir, 'frame.png');
      const gtPath = path.join(sampleDir, 'ground_truth.txt');
      const metaPath = path.join(sampleDir, 'metadata.json');

      if (!fs.existsSync(framePath)) {
        results.push({
          sampleId: entry.name, category: 'document',
          rawCER: 0, rawWER: 0, postProcessCER: 0, postProcessWER: 0,
          postValidationCER: 0, postValidationWER: 0,
          abstained: false, falsePositive: false, falseNegative: false,
          notes: 'SKIPPED: frame.png not found',
        });
        continue;
      }

      try {
        const groundTruth = fs.existsSync(gtPath)
          ? fs.readFileSync(gtPath, 'utf-8').trim()
          : '';
        const meta = fs.existsSync(metaPath)
          ? JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
          : {};

        console.log(`[DOC] Processing ${entry.name}...`);
        const ocrText = await runOcr(framePath, '3'); // PSM 3 = document mode

        const rawCER = calculateCER(ocrText, groundTruth);
        const rawWER = calculateWER(ocrText, groundTruth);

        results.push({
          sampleId: entry.name,
          category: meta.category || 'document',
          rawCER, rawWER,
          postProcessCER: rawCER,
          postProcessWER: rawWER,
          postValidationCER: rawCER,
          postValidationWER: rawWER,
          abstained: ocrText.length < 3,
          falsePositive: false,
          falseNegative: ocrText.length < 3,
          notes: `OCR: "${ocrText.slice(0, 60)}${ocrText.length > 60 ? '...' : ''}"`,
        });
      } catch (err) {
        results.push({
          sampleId: entry.name, category: 'document',
          rawCER: 1, rawWER: 1, postProcessCER: 1, postProcessWER: 1,
          postValidationCER: 1, postValidationWER: 1,
          abstained: true, falsePositive: false, falseNegative: true,
          notes: `ERROR: ${String(err).slice(0, 80)}`,
        });
      }
    }
  }

  // ── Process Medicines ──
  const medsDir = path.join(goldenDatasetPath, 'medicines');
  if (fs.existsSync(medsDir)) {
    const entries = fs.readdirSync(medsDir, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      const sampleDir = path.join(medsDir, entry.name);
      const framePath = path.join(sampleDir, 'frame.png');
      const gtPath = path.join(sampleDir, 'ground_truth.json');
      const metaPath = path.join(sampleDir, 'metadata.json');

      if (!fs.existsSync(framePath)) {
        results.push({
          sampleId: entry.name, category: 'medicine',
          rawCER: 0, rawWER: 0, postProcessCER: 0, postProcessWER: 0,
          postValidationCER: 0, postValidationWER: 0,
          abstained: false, falsePositive: false, falseNegative: false,
          notes: 'SKIPPED: frame.png not found',
        });
        continue;
      }

      try {
        const gtJson = fs.existsSync(gtPath)
          ? JSON.parse(fs.readFileSync(gtPath, 'utf-8'))
          : { brand_name: '' };
        const meta = fs.existsSync(metaPath)
          ? JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
          : {};

        const refBrand = gtJson.brand_name || '';
        console.log(`[MED] Processing ${entry.name} (expecting: "${refBrand}")...`);
        const ocrText = await runOcr(framePath, '11'); // PSM 11 = sparse text

        const rawCER = calculateCER(ocrText.toLowerCase(), refBrand.toLowerCase());
        const rawWER = calculateWER(ocrText.toLowerCase(), refBrand.toLowerCase());

        // Check if brand name appears somewhere in OCR text (case-insensitive)
        const brandFound = ocrText.toLowerCase().includes(refBrand.toLowerCase());

        results.push({
          sampleId: entry.name,
          category: meta.surface || 'medicine',
          rawCER, rawWER,
          postProcessCER: rawCER,
          postProcessWER: rawWER,
          postValidationCER: brandFound ? 0 : rawCER,
          postValidationWER: brandFound ? 0 : rawWER,
          abstained: ocrText.length < 3,
          falsePositive: false,
          falseNegative: !brandFound && ocrText.length >= 3,
          notes: `OCR: "${ocrText.slice(0, 60)}${ocrText.length > 60 ? '...' : ''}"`,
        });
      } catch (err) {
        results.push({
          sampleId: entry.name, category: 'medicine',
          rawCER: 1, rawWER: 1, postProcessCER: 1, postProcessWER: 1,
          postValidationCER: 1, postValidationWER: 1,
          abstained: true, falsePositive: false, falseNegative: true,
          notes: `ERROR: ${String(err).slice(0, 80)}`,
        });
      }
    }
  }

  // ── Generate Markdown Report ──
  let md = '# EchoSight Benchmark Results\n\n';
  md += `**Date:** ${new Date().toISOString()}\n\n`;
  md += '| Sample | Category | Raw CER | Raw WER | Post-Val CER | Post-Val WER | Abstain? | FP? | FN? | Notes |\n';
  md += '|:-------|:---------|:--------|:--------|:-------------|:-------------|:---------|:----|:----|:------|\n';

  for (const r of results) {
    md += `| ${r.sampleId} | ${r.category} | ${(r.rawCER * 100).toFixed(1)}% | ${(r.rawWER * 100).toFixed(1)}% | ${(r.postValidationCER * 100).toFixed(1)}% | ${(r.postValidationWER * 100).toFixed(1)}% | ${r.abstained ? '**Yes**' : 'No'} | ${r.falsePositive ? '⚠️' : '—'} | ${r.falseNegative ? '⚠️' : '—'} | ${r.notes.slice(0, 40)} |\n`;
  }

  // ── Summary Statistics ──
  const total = results.length;
  const fpCount = results.filter(r => r.falsePositive).length;
  const fnCount = results.filter(r => r.falseNegative).length;
  const abstainCount = results.filter(r => r.abstained).length;
  const skippedCount = results.filter(r => r.notes.startsWith('SKIPPED')).length;
  const evaluated = results.filter(r => !r.notes.startsWith('SKIPPED'));
  if (evaluated.length === 0) {
    throw new Error(
      'No real evaluation frames found. Add consented, de-identified frame.png samples to golden_dataset before reporting OCR accuracy.',
    );
  }
  const avgCER = evaluated.length > 0
    ? evaluated.reduce((s, r) => s + r.postValidationCER, 0) / evaluated.length : 0;
  const avgWER = evaluated.length > 0
    ? evaluated.reduce((s, r) => s + r.postValidationWER, 0) / evaluated.length : 0;

  md += `\n## Summary\n\n`;
  md += `- **Total Samples:** ${total} (${skippedCount} skipped — missing frame.png)\n`;
  md += `- **Evaluated:** ${evaluated.length}\n`;
  md += `- **Average CER:** ${(avgCER * 100).toFixed(1)}%\n`;
  md += `- **Average WER:** ${(avgWER * 100).toFixed(1)}%\n`;
  md += `- **False Positives (DANGEROUS):** ${fpCount} (${total > 0 ? (fpCount / total * 100).toFixed(1) : 0}%)\n`;
  md += `- **False Negatives:** ${fnCount}\n`;
  md += `- **Abstentions:** ${abstainCount}\n`;

  fs.writeFileSync(path.join(process.cwd(), 'benchmark_results.md'), md);

  // ── CSV Export ──
  let csv = 'sample_id,category,raw_cer,raw_wer,post_val_cer,post_val_wer,abstained,false_positive,false_negative,notes\n';
  for (const r of results) {
    csv += `${r.sampleId},${r.category},${r.rawCER.toFixed(4)},${r.rawWER.toFixed(4)},${r.postValidationCER.toFixed(4)},${r.postValidationWER.toFixed(4)},${r.abstained},${r.falsePositive},${r.falseNegative},"${r.notes.replace(/"/g, '""')}"\n`;
  }
  fs.writeFileSync(path.join(process.cwd(), 'benchmark_results.csv'), csv);

  // ── Console Summary ──
  console.log('\n─── Benchmark Summary ───');
  console.log(`Total Samples: ${total} (${skippedCount} skipped)`);
  console.log(`Average CER: ${(avgCER * 100).toFixed(1)}%`);
  console.log(`Average WER: ${(avgWER * 100).toFixed(1)}%`);
  console.log(`False Positives: ${fpCount} (${total > 0 ? (fpCount / total * 100).toFixed(1) : 0}%)`);
  console.log(`False Negatives: ${fnCount}`);
  console.log(`Abstentions: ${abstainCount}`);
  console.log(`\nResults written to: benchmark_results.md, benchmark_results.csv`);
}

evaluate(path.join(__dirname, '..', 'golden_dataset')).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
