// db.js — on-device storage in IndexedDB. Nothing leaves the phone.
//
// cards: { id, name, title, company, phones:[{label,value}], emails:[], website,
//          address, notes, tagIds:[], photo:{type,data:ArrayBuffer}|null,
//          thumb:{type,data}|null, rawText, createdAt, updatedAt }
// tags:  { id, name, color }
//
// Images are stored as ArrayBuffers (not Blobs) because that is the most
// reliable format across iOS Safari versions.

const DB_NAME = 'cardfile';
const DB_VERSION = 1;

export const TAG_COLORS = ['#d9a531', '#5f9e6e', '#4f8fd1', '#d9694f', '#9a7fd1', '#3f9ea0', '#c9668c', '#7c8a96'];

let dbPromise;
function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('cards')) db.createObjectStore('cards', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('tags')) db.createObjectStore('tags', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function tx(store, mode, fn) {
  return open().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let result;
    Promise.resolve(fn(s)).then(r => { result = r; });
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Storage transaction aborted'));
  }));
}

const reqP = req => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });

export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

// ---- cards ----
export async function allCards() {
  return tx('cards', 'readonly', s => reqP(s.getAll()));
}
export async function getCard(id) {
  return tx('cards', 'readonly', s => reqP(s.get(id)));
}
export async function saveCard(card) {
  const now = Date.now();
  const rec = { ...card, id: card.id || uid(), createdAt: card.createdAt || now, updatedAt: now };
  await tx('cards', 'readwrite', s => { s.put(rec); });
  return rec;
}
export async function deleteCard(id) {
  await tx('cards', 'readwrite', s => { s.delete(id); });
}

// ---- tags ----
export async function allTags() {
  const tags = await tx('tags', 'readonly', s => reqP(s.getAll()));
  return tags.sort((a, b) => a.name.localeCompare(b.name));
}
export async function saveTag(tag) {
  const rec = { ...tag, id: tag.id || uid() };
  await tx('tags', 'readwrite', s => { s.put(rec); });
  return rec;
}
export async function deleteTag(id) {
  await tx('tags', 'readwrite', s => { s.delete(id); });
  // remove from every card that had it
  const cards = await allCards();
  const touched = cards.filter(c => (c.tagIds || []).includes(id));
  if (touched.length) {
    await tx('cards', 'readwrite', s => {
      for (const c of touched) s.put({ ...c, tagIds: c.tagIds.filter(t => t !== id) });
    });
  }
}

// First run: a few starter tags the user can rename or delete.
export async function seedIfEmpty() {
  const seeded = await tx('meta', 'readonly', s => reqP(s.get('seeded')));
  if (seeded) return;
  const starters = [['Furniture', 0], ['Restaurants', 3], ['Healthcare', 2]];
  for (const [name, c] of starters) await saveTag({ name, color: TAG_COLORS[c] });
  await tx('meta', 'readwrite', s => { s.put({ key: 'seeded', value: true }); });
}

// Ask iOS not to evict our data under storage pressure.
export async function requestPersistence() {
  try { if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist(); } catch { /* ignore */ }
  return false;
}

// ---- image helpers ----
export async function blobToStored(blob) {
  if (!blob) return null;
  return { type: blob.type || 'image/jpeg', data: await blob.arrayBuffer() };
}
export function storedToBlob(stored) {
  return stored ? new Blob([stored.data], { type: stored.type }) : null;
}

// ---- backup ----
function bufToB64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
function b64ToBuf(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}
const packImg = img => img ? { type: img.type, b64: bufToB64(img.data) } : null;
const unpackImg = img => img ? { type: img.type, data: b64ToBuf(img.b64) } : null;

export async function exportBackup() {
  const [cards, tags] = await Promise.all([allCards(), allTags()]);
  return JSON.stringify({
    app: 'cardfile', version: 1, exportedAt: new Date().toISOString(), tags,
    cards: cards.map(c => ({ ...c, photo: packImg(c.photo), thumb: packImg(c.thumb) })),
  });
}

/** Merge a backup in. Existing cards/tags with the same id are overwritten. */
export async function importBackup(json) {
  const data = JSON.parse(json);
  if (data.app !== 'cardfile' || !Array.isArray(data.cards)) throw new Error('That file is not a Cardfile backup.');
  await tx('tags', 'readwrite', s => { for (const t of data.tags || []) s.put(t); });
  await tx('cards', 'readwrite', s => {
    for (const c of data.cards) s.put({ ...c, photo: unpackImg(c.photo), thumb: unpackImg(c.thumb) });
  });
  return data.cards.length;
}
