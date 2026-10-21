// Run Tesseract on each test card and dump the lines (text + box height)
// to dev/cards/<id>.ocr.json so the parser can be tested without re-running OCR.
import { createWorker } from 'tesseract.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const cardsDir = path.join(here, 'cards');
const langPath = path.join(here, '..', 'node_modules', '@tesseract.js-data', 'eng', '4.0.0_best_int');

const worker = await createWorker('eng', 1, { langPath, cacheMethod: 'none' });
await worker.setParameters({ tessedit_pageseg_mode: '11', preserve_interword_spaces: '1' });

const only = process.argv[2];
for (const f of fs.readdirSync(cardsDir).filter(f => f.endsWith('.jpg'))) {
  const id = f.replace('.jpg', '');
  if (only && id !== only) continue;
  const t0 = Date.now();
  const { data } = await worker.recognize(path.join(cardsDir, f), {}, { blocks: true, text: true });
  const lines = [];
  for (const b of data.blocks || []) for (const p of b.paragraphs) for (const l of p.lines) {
    lines.push({ text: l.text.trim(), conf: Math.round(l.confidence), h: l.bbox.y1 - l.bbox.y0, y: l.bbox.y0, x: l.bbox.x0 });
  }
  fs.writeFileSync(path.join(cardsDir, id + '.ocr.json'), JSON.stringify(lines, null, 1));
  console.log(`\n== ${id} (${Date.now() - t0} ms)`);
  for (const l of lines) console.log(`  [h${l.h} c${l.conf}] ${l.text}`);
}
await worker.terminate();
