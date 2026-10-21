// ocr.js — on-device text recognition with Tesseract (WebAssembly).
// All engine files are served from ./vendor so it works offline and no
// image ever leaves the phone.

let workerPromise = null;
let progressCb = () => {};

const abs = p => new URL(p, document.baseURI).href;

async function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      if (!window.Tesseract) await loadScript(abs('vendor/tesseract/tesseract.min.js'));
      const worker = await window.Tesseract.createWorker('eng', 1, {
        workerPath: abs('vendor/tesseract/worker.min.js'),
        corePath: abs('vendor/tesseract/core'),
        langPath: abs('vendor/tesseract/lang'),
        workerBlobURL: false, // load the worker from our own origin so offline caching covers it
        logger: m => progressCb(m),
      });
      // 11 = "sparse text": find as much text as possible in no particular order,
      // which suits business cards far better than the default page layout mode.
      await worker.setParameters({ tessedit_pageseg_mode: '11', preserve_interword_spaces: '1' });
      return worker;
    })().catch(err => { workerPromise = null; throw err; });
  }
  return workerPromise;
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('The text reader could not load. Open the app once while online so it can download.'));
    document.head.appendChild(s);
  });
}

/** Start loading the engine early (e.g. while the camera is open). */
export function warmUp() { getWorker().catch(() => {}); }

/**
 * Recognise text in a canvas. Returns lines: [{ text, conf, h, x, y }]
 * sorted top-to-bottom, left-to-right.
 */
export async function recognize(canvas, onProgress) {
  progressCb = m => {
    if (!onProgress) return;
    if (m.status === 'recognizing text') onProgress(0.25 + 0.75 * m.progress, 'Reading the card');
    else if (/load|initializ/i.test(m.status)) onProgress(0.25 * (m.progress || 0), 'Getting the text reader ready');
  };
  const worker = await getWorker();
  const { data } = await worker.recognize(canvas, {}, { blocks: true, text: true });
  const lines = [];
  for (const b of data.blocks || []) {
    for (const p of b.paragraphs || []) {
      for (const l of p.lines || []) {
        const text = (l.text || '').trim();
        if (!text) continue;
        lines.push({ text, conf: Math.round(l.confidence), h: l.bbox.y1 - l.bbox.y0, w: l.bbox.x1 - l.bbox.x0, x: l.bbox.x0, y: l.bbox.y0 });
      }
    }
  }
  // reading order: group into rows by vertical position, then left to right
  lines.sort((a, b) => (Math.abs(a.y - b.y) < Math.min(a.h, b.h) * 0.5 ? a.x - b.x : a.y - b.y));
  progressCb = () => {};
  lines.size = { w: canvas.width, h: canvas.height };
  return lines;
}
