// image.js — load a photo, make the stored versions, and prepare it for OCR.

/** Decode a File/Blob into an <img>. iOS applies the photo's EXIF rotation for us. */
export function loadImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That photo could not be opened. Try taking it again.')); };
    img.src = url;
  });
}

function canvasFor(img, maxSide, rotate = 0) {
  const w0 = img.naturalWidth || img.width, h0 = img.naturalHeight || img.height;
  const scale = Math.min(1, maxSide / Math.max(w0, h0));
  const w = Math.round(w0 * scale), h = Math.round(h0 * scale);
  const quarter = ((rotate % 360) + 360) % 360 / 90;
  const c = document.createElement('canvas');
  c.width = quarter % 2 ? h : w;
  c.height = quarter % 2 ? w : h;
  const ctx = c.getContext('2d');
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate(quarter * Math.PI / 2);
  ctx.drawImage(img, -w / 2, -h / 2, w, h);
  return c;
}

const toBlob = (canvas, type, q) => new Promise(res => canvas.toBlob(res, type, q));

/** The saved photo (sharp enough to read later) and a small thumbnail for the list. */
export async function makeStoredImages(img, rotate = 0) {
  const photo = await toBlob(canvasFor(img, 1600, rotate), 'image/jpeg', 0.85);
  const thumb = await toBlob(canvasFor(img, 560, rotate), 'image/jpeg', 0.78);
  return { photo, thumb };
}

/**
 * List thumbnail cropped to where the text is, so the card fills the frame
 * instead of the desk around it. `box` is {x0,y0,x1,y1} in 0..1 of the
 * rotated photo. Falls back to the whole photo if there's no box.
 */
export async function makeCroppedThumb(img, rotate, box) {
  const full = canvasFor(img, 1400, rotate);
  let { x0, y0, x1, y1 } = box || { x0: 0, y0: 0, x1: 1, y1: 1 };
  x0 *= full.width; x1 *= full.width; y0 *= full.height; y1 *= full.height;
  // pad around the text, then widen to the list's 7:4 frame
  const padX = (x1 - x0) * 0.12 + 20, padY = (y1 - y0) * 0.18 + 20;
  x0 -= padX; x1 += padX; y0 -= padY; y1 += padY;
  const want = 7 / 4;
  let w = x1 - x0, hgt = y1 - y0;
  if (w / hgt < want) { const nw = hgt * want; x0 -= (nw - w) / 2; w = nw; } else { const nh = w / want; y0 -= (nh - hgt) / 2; hgt = nh; }
  x0 = Math.max(0, Math.min(x0, full.width - Math.min(w, full.width)));
  y0 = Math.max(0, Math.min(y0, full.height - Math.min(hgt, full.height)));
  w = Math.min(w, full.width); hgt = Math.min(hgt, full.height);
  const scale = Math.min(1, 560 / w);
  const c = document.createElement('canvas');
  c.width = Math.round(w * scale); c.height = Math.round(hgt * scale);
  c.getContext('2d').drawImage(full, x0, y0, w, hgt, 0, 0, c.width, c.height);
  return toBlob(c, 'image/jpeg', 0.8);
}

/**
 * Grayscale + contrast stretch. Tesseract does its own thresholding; this just
 * gives it an even, high-contrast input regardless of lighting or card colour.
 */
export function prepareForOcr(img, rotate = 0) {
  const c = canvasFor(img, 2000, rotate);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  const d = ctx.getImageData(0, 0, c.width, c.height);
  const px = d.data;
  const hist = new Uint32Array(256);
  for (let i = 0; i < px.length; i += 4) {
    const g = (px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114) | 0;
    px[i] = g; hist[g]++;
  }
  // clip the darkest/lightest 1% and stretch the rest to 0..255
  const total = px.length / 4;
  let lo = 0, hi = 255, acc = 0;
  for (; lo < 255; lo++) { acc += hist[lo]; if (acc > total * 0.01) break; }
  acc = 0;
  for (; hi > 0; hi--) { acc += hist[hi]; if (acc > total * 0.01) break; }
  const range = Math.max(1, hi - lo);
  for (let i = 0; i < px.length; i += 4) {
    const v = Math.max(0, Math.min(255, ((px[i] - lo) * 255) / range));
    px[i] = px[i + 1] = px[i + 2] = v;
  }
  ctx.putImageData(d, 0, 0);
  return c;
}
