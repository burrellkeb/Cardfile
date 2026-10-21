// app.js — screens, navigation and wiring.
import * as db from './db.js';
import { parseCard, telHref, websiteHref, formatPhone, digitsOf } from './parser.js';
import { loadImage, makeStoredImages, makeCroppedThumb, prepareForOcr } from './image.js';
import { recognize, warmUp } from './ocr.js';
import { buildVCard, vcardFileName } from './vcard.js';

const $app = document.getElementById('app');
const $camera = document.getElementById('pick-camera');
const $library = document.getElementById('pick-library');
const $backup = document.getElementById('pick-backup');

const state = {
  cards: [],
  tags: [],
  query: '',
  tagFilter: 'all',          // 'all' | 'untagged' | tagId
  sort: 'az',                // 'az' | 'tag'
  draft: null,               // card being created/edited
  pendingFile: null,         // photo picked for a new card
  scanToken: 0,
};

const thumbUrls = new Map(); // `${id}:${updatedAt}` -> object URL
const PHONE_LABELS = ['Mobile', 'Work', 'Fax', 'Home', 'Other'];

// ---------- utilities ----------

const h = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const tagById = id => state.tags.find(t => t.id === id);
const displayName = c => c.name || c.company || (c.emails && c.emails[0]) || 'Untitled card';

function thumbUrl(card) {
  if (!card.thumb) return '';
  const key = `${card.id}:${card.updatedAt}`;
  if (!thumbUrls.has(key)) thumbUrls.set(key, URL.createObjectURL(db.storedToBlob(card.thumb)));
  return thumbUrls.get(key);
}

let toastTimer;
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
}

const icon = name => `<svg class="i" aria-hidden="true"><use href="#i-${name}"/></svg>`;

async function reload() {
  [state.cards, state.tags] = await Promise.all([db.allCards(), db.allTags()]);
}

function go(hash) {
  if (location.hash === hash) render(); else location.hash = hash;
}

// ---------- search & filter ----------

function matches(card, query) {
  if (!query) return true;
  const tagNames = (card.tagIds || []).map(id => tagById(id)?.name || '').join(' ');
  const hay = [card.name, card.title, card.company, card.website, card.address, card.notes, card.rawText, tagNames,
    ...(card.emails || []), ...(card.phones || []).map(p => p.value)].join(' ').toLowerCase();
  const hayDigits = digitsOf((card.phones || []).map(p => p.value).join(' '));
  return query.toLowerCase().split(/\s+/).filter(Boolean).every(term => {
    const d = digitsOf(term);
    if (d.length >= 3 && d.length === term.replace(/[\s().\-+]/g, '').length) return hayDigits.includes(d);
    return hay.includes(term);
  });
}

function visibleCards() {
  const f = state.tagFilter;
  return state.cards
    .filter(c => f === 'all' || (f === 'untagged' ? !(c.tagIds || []).length : (c.tagIds || []).includes(f)))
    .filter(c => matches(c, state.query.trim()))
    .sort((a, b) => displayName(a).localeCompare(displayName(b), undefined, { sensitivity: 'base' }));
}

// ---------- list screen ----------

function cardRow(c) {
  const tags = (c.tagIds || []).map(tagById).filter(Boolean);
  const tab = tags[0] ? `<span class="tab" style="--tag:${tags[0].color}"></span>` : '';
  const thumb = c.thumb
    ? `<img src="${thumbUrl(c)}" alt="" loading="lazy">`
    : `<span class="no-photo">${h((displayName(c)[0] || '?').toUpperCase())}</span>`;
  const sub = [c.title, c.name ? c.company : ''].filter(Boolean);
  return `
    <li><a class="row" href="#/card/${c.id}">
      <span class="thumb">${tab}${thumb}</span>
      <span class="row-text">
        <strong>${h(displayName(c))}</strong>
        ${sub.map(s => `<span>${h(s)}</span>`).join('')}
        ${tags.length > 1 ? `<span class="dots">${tags.map(t => `<i style="--tag:${t.color}" title="${h(t.name)}"></i>`).join('')}</span>` : ''}
      </span>
    </a></li>`;
}

function renderList() {
  const cards = visibleCards();
  const count = id => state.cards.filter(c => (c.tagIds || []).includes(id)).length;
  const untagged = state.cards.filter(c => !(c.tagIds || []).length).length;

  const chips = [
    `<button class="chip ${state.tagFilter === 'all' ? 'on' : ''}" data-filter="all">All <b>${state.cards.length}</b></button>`,
    ...state.tags.map(t => `<button class="chip ${state.tagFilter === t.id ? 'on' : ''}" data-filter="${t.id}" style="--tag:${t.color}"><i></i>${h(t.name)} <b>${count(t.id)}</b></button>`),
    untagged && state.tags.length ? `<button class="chip ${state.tagFilter === 'untagged' ? 'on' : ''}" data-filter="untagged">Untagged <b>${untagged}</b></button>` : '',
  ].join('');

  $app.innerHTML = `
    <header class="bar">
      <h1>Cards</h1>
      <button class="icon-btn" data-action="open-tags" aria-label="Tags and backup">${icon('tag')}</button>
    </header>
    <main class="list">
      <label class="search">${icon('search')}
        <input type="search" id="q" placeholder="Search names, companies, numbers" value="${h(state.query)}" autocomplete="off" enterkeyhint="search">
      </label>
      <div class="chips" role="toolbar" aria-label="Filter by tag">${chips}</div>
      ${state.cards.length && state.tagFilter === 'all' ? `
      <div class="seg" role="group" aria-label="Arrange">
        <button class="${state.sort === 'az' ? 'on' : ''}" data-sort="az">A to Z</button>
        <button class="${state.sort === 'tag' ? 'on' : ''}" data-sort="tag">By tag</button>
      </div>` : ''}
      <div id="results">${listBody(cards)}</div>
    </main>
    <button class="fab" data-action="scan">${icon('camera')}<span>Scan card</span></button>`;

  const q = document.getElementById('q');
  q.addEventListener('input', () => {
    state.query = q.value;
    document.getElementById('results').innerHTML = listBody(visibleCards());
  });
}

function listBody(cards) {
  let body;
  if (!state.cards.length) {
    body = `<div class="empty">
      <div class="empty-card" aria-hidden="true"><span></span><span></span><span></span></div>
      <p><strong>No cards yet.</strong></p>
      <p>Tap <em>Scan card</em> and take a photo of a business card. The name, number and email are filled in for you.</p>
    </div>`;
  } else if (!cards.length) {
    body = `<div class="empty"><p>No cards match${state.query ? ` “${h(state.query)}”` : ''}${state.tagFilter !== 'all' ? ' in this tag' : ''}.</p>
      <button class="link" data-action="clear-search">Show all cards</button></div>`;
  } else if (state.sort === 'tag' && state.tagFilter === 'all') {
    const groups = state.tags.map(t => ({ t, list: cards.filter(c => (c.tagIds || []).includes(t.id)) })).filter(g => g.list.length);
    const none = cards.filter(c => !(c.tagIds || []).length);
    body = groups.map(g => `<section class="group"><h2 style="--tag:${g.t.color}"><i></i>${h(g.t.name)}</h2><ul class="rows">${g.list.map(cardRow).join('')}</ul></section>`).join('')
      + (none.length ? `<section class="group"><h2><i class="hollow"></i>Untagged</h2><ul class="rows">${none.map(cardRow).join('')}</ul></section>` : '');
  } else {
    body = `<ul class="rows">${cards.map(cardRow).join('')}</ul>`;
  }
  return body;
}

// ---------- scan sheet ----------

function openSheet(html) {
  closeSheet();
  const el = document.createElement('div');
  el.className = 'sheet-wrap';
  el.innerHTML = `<div class="scrim" data-action="close-sheet"></div><div class="sheet" role="dialog" aria-modal="true">${html}</div>`;
  document.body.appendChild(el);
  document.body.classList.add('sheet-open');
  requestAnimationFrame(() => el.classList.add('open'));
}
function closeSheet() {
  document.querySelectorAll('.sheet-wrap').forEach(e => e.remove());
  document.body.classList.remove('sheet-open');
}

function openScanSheet() {
  warmUp(); // load the text reader while the camera is open
  openSheet(`
    <p class="sheet-title">For the best read, fill the frame with the card, in good light, held flat.</p>
    <button class="sheet-btn" data-action="take-photo">${icon('camera')}Take photo</button>
    <button class="sheet-btn" data-action="choose-photo">${icon('image')}Choose from photos</button>
    <button class="sheet-btn" data-action="manual">${icon('pencil')}Type it in</button>
    <button class="sheet-btn cancel" data-action="close-sheet">Cancel</button>`);
}

function onPhotoPicked(input) {
  const file = input.files && input.files[0];
  input.value = '';
  closeSheet();
  if (!file) return;
  if (state.draft && (location.hash.startsWith('#/edit') || location.hash === '#/new')) {
    // retaking the photo: on an existing card keep what's already filled in
    startScan(file, { fillOnlyEmpty: !!state.draft.id });
    return;
  }
  state.pendingFile = file;
  go('#/new');
}

// ---------- editor ----------

function emptyDraft() {
  return { name: '', title: '', company: '', phones: [], emails: [], website: '', address: '', notes: '', tagIds: [],
    photo: null, thumb: null, rawText: '', lines: [], rotate: 0, img: null, touched: new Set(), scanning: false, progress: 0, status: '' };
}

const DRAFT_FIELDS = ['name', 'title', 'company', 'website', 'address', 'notes'];

async function startScan(file, { fillOnlyEmpty = false } = {}) {
  const d = state.draft;
  const token = ++state.scanToken;
  d.scanning = true; d.progress = 0; d.status = 'Opening photo';
  if (fillOnlyEmpty) {
    for (const f of DRAFT_FIELDS) if (d[f]) d.touched.add(f);
    if (d.phones.length) d.touched.add('phones');
    if (d.emails.length) d.touched.add('emails');
  }
  renderEditor();
  try {
    if (file) { d.img = await loadImage(file); d.rotate = 0; }
    const stored = await makeStoredImages(d.img, d.rotate);
    if (token !== state.scanToken) return;
    d.photo = stored.photo; d.thumb = stored.thumb;
    if (d.photoUrl) URL.revokeObjectURL(d.photoUrl);
    d.photoUrl = URL.createObjectURL(d.photo);
    updatePhotoPane();
    const lines = await recognize(prepareForOcr(d.img, d.rotate), (p, label) => {
      if (token !== state.scanToken) return;
      d.progress = p; d.status = label; updateProgress();
    });
    if (token !== state.scanToken) return;
    const box = textBox(lines);
    if (box) d.thumb = await makeCroppedThumb(d.img, d.rotate, box);
    const parsed = parseCard(lines);
    d.lines = parsed.lines;
    d.rawText = parsed.lines.join('\n');
    for (const f of DRAFT_FIELDS) if (!d.touched.has(f) && parsed[f]) d[f] = parsed[f];
    if (!d.touched.has('phones') && parsed.phones.length) d.phones = parsed.phones;
    if (!d.touched.has('emails') && parsed.emails.length) d.emails = parsed.emails;
    d.scanning = false;
    const found = [parsed.name, parsed.company, parsed.phones.length, parsed.emails.length].filter(Boolean).length;
    d.status = !lines.length ? 'No text found. Try rotating, or retake the photo closer and in better light.'
      : found ? 'Check the details below, then save.' : 'Some text was found but not sorted. Tap a line below to place it.';
  } catch (err) {
    console.error(err);
    if (token !== state.scanToken) return;
    d.scanning = false;
    d.status = err.message || 'The card could not be read. You can still type the details in.';
  }
  renderEditor();
}

// Where the confident text sits in the photo (0..1), to crop the thumbnail.
function textBox(lines) {
  const good = lines.filter(l => l.conf >= 60 && l.text.replace(/\W/g, '').length >= 3);
  if (good.length < 2 || !lines.size) return null;
  const { w, h } = lines.size;
  return {
    x0: Math.min(...good.map(l => l.x)) / w, x1: Math.max(...good.map(l => l.x + l.w)) / w,
    y0: Math.min(...good.map(l => l.y)) / h, y1: Math.max(...good.map(l => l.y + l.h)) / h,
  };
}

function updateProgress() {
  const bar = document.querySelector('.progress');
  if (!bar) return;
  bar.style.setProperty('--p', state.draft.progress);
  bar.querySelector('span').textContent = state.draft.status;
}
function updatePhotoPane() {
  const img = document.querySelector('.photo-pane img');
  if (img && state.draft.photoUrl) img.src = state.draft.photoUrl;
  else if (state.draft.photoUrl) renderEditor();
}

function field(name, label, opts = {}) {
  const v = state.draft[name] || '';
  const tag = opts.multiline ? 'textarea' : 'input';
  const attrs = `id="f-${name}" data-field="${name}" ${opts.type ? `type="${opts.type}"` : 'type="text"'} ${opts.auto ? `autocomplete="${opts.auto}"` : ''} ${opts.cap ? `autocapitalize="${opts.cap}"` : ''} ${opts.mode ? `inputmode="${opts.mode}"` : ''}`;
  return `<label class="field"><span>${label}</span>${tag === 'textarea'
    ? `<textarea ${attrs} rows="${opts.rows || 2}">${h(v)}</textarea>`
    : `<input ${attrs} value="${h(v)}">`}</label>`;
}

function renderEditor() {
  const d = state.draft;
  if (!d) { go('#/'); return; }
  const isNew = !d.id;
  const photo = d.photoUrl
    ? `<div class="photo-pane"><img src="${d.photoUrl}" alt="Photo of the card">
        <div class="photo-tools">
          <button class="pill" data-action="rotate" ${d.scanning ? 'disabled' : ''}>${icon('rotate')}Rotate</button>
          <button class="pill" data-action="retake">${icon('camera')}Retake</button>
        </div></div>`
    : `<button class="photo-pane add" data-action="retake">${icon('camera')}<span>Add a photo of the card</span></button>`;

  const status = d.scanning
    ? `<div class="progress" style="--p:${d.progress}"><span>${h(d.status)}</span></div>`
    : d.status ? `<p class="status">${h(d.status)}</p>` : '';

  const phones = d.phones.map((p, i) => `
    <div class="multi">
      <select data-phone-label="${i}" aria-label="Phone type">${PHONE_LABELS.concat(PHONE_LABELS.includes(p.label) ? [] : [p.label]).map(l => `<option ${l === p.label ? 'selected' : ''}>${h(l)}</option>`).join('')}</select>
      <input type="tel" data-phone="${i}" value="${h(p.value)}" placeholder="Phone number" autocomplete="off">
      <button class="icon-btn small" data-remove-phone="${i}" aria-label="Remove phone">${icon('x')}</button>
    </div>`).join('');
  const emails = d.emails.map((e, i) => `
    <div class="multi">
      <input type="email" data-email="${i}" value="${h(e)}" placeholder="name@company.com" autocapitalize="off" autocomplete="off">
      <button class="icon-btn small" data-remove-email="${i}" aria-label="Remove email">${icon('x')}</button>
    </div>`).join('');

  const tagChips = state.tags.map(t => `<button class="chip ${d.tagIds.includes(t.id) ? 'on' : ''}" data-toggle-tag="${t.id}" style="--tag:${t.color}" aria-pressed="${d.tagIds.includes(t.id)}"><i></i>${h(t.name)}</button>`).join('');

  const lines = d.lines.length ? `
    <section class="detected">
      <h3>Text on the card</h3>
      <p class="hint">Something in the wrong place? Tap a line to put it where it belongs.</p>
      <div class="line-chips">${d.lines.map((l, i) => `<button class="line" data-line="${i}">${h(l)}</button>`).join('')}</div>
    </section>` : '';

  $app.innerHTML = `
    <header class="bar compact">
      <button class="text-btn" data-action="cancel-edit">Cancel</button>
      <h1>${isNew ? 'New card' : 'Edit card'}</h1>
      <button class="text-btn strong" data-action="save" ${d.scanning ? 'disabled' : ''}>Save</button>
    </header>
    <main class="editor">
      ${photo}
      ${status}
      <div class="form">
        ${field('name', 'Name', { auto: 'off', cap: 'words' })}
        ${field('title', 'Job title', { cap: 'words' })}
        ${field('company', 'Company', { cap: 'words' })}
        <div class="field-group"><span class="group-label">Phone</span>${phones}
          <button class="add-row" data-action="add-phone">${icon('plus')}Add phone</button></div>
        <div class="field-group"><span class="group-label">Email</span>${emails}
          <button class="add-row" data-action="add-email">${icon('plus')}Add email</button></div>
        ${field('website', 'Website', { type: 'url', cap: 'off', mode: 'url' })}
        ${field('address', 'Address', { multiline: true, cap: 'words' })}
        <div class="field-group"><span class="group-label">Tags</span>
          <div class="chips wrap">${tagChips}<button class="chip add" data-action="new-tag">${icon('plus')}New tag</button></div></div>
        ${field('notes', 'Notes', { multiline: true, rows: 3, cap: 'sentences' })}
      </div>
      ${lines}
      ${!isNew ? `<button class="danger-btn" data-action="delete">Delete card</button>` : ''}
    </main>`;
}

function onEditorInput(e) {
  const d = state.draft;
  if (!d) return;
  const t = e.target;
  if (t.dataset.field) { d[t.dataset.field] = t.value; d.touched.add(t.dataset.field); }
  else if (t.dataset.phone !== undefined) { d.phones[+t.dataset.phone].value = t.value; d.touched.add('phones'); }
  else if (t.dataset.phoneLabel !== undefined) { d.phones[+t.dataset.phoneLabel].label = t.value; d.touched.add('phones'); }
  else if (t.dataset.email !== undefined) { d.emails[+t.dataset.email] = t.value.trim(); d.touched.add('emails'); }
}

function placeLine(i) {
  const text = state.draft.lines[i];
  openSheet(`
    <p class="sheet-title">Put “${h(text)}” in…</p>
    <div class="place-grid">
      ${[['name', 'Name'], ['title', 'Job title'], ['company', 'Company'], ['phone', 'Phone'], ['email', 'Email'], ['website', 'Website'], ['address', 'Address'], ['notes', 'Notes']]
        .map(([k, l]) => `<button class="sheet-btn" data-place="${k}" data-line-idx="${i}">${l}</button>`).join('')}
    </div>
    <button class="sheet-btn cancel" data-action="close-sheet">Cancel</button>`);
}

function applyPlace(where, i) {
  const d = state.draft;
  const text = d.lines[i].replace(/^(?:e-?mail|web(?:site)?|phone|tel|cell|mobile|office|fax|[a-z])\s*[:.]\s*/i, '').trim();
  if (where === 'phone') { d.phones.push({ label: 'Work', value: formatPhone(text) }); d.touched.add('phones'); }
  else if (where === 'email') { d.emails.push(text.replace(/\s+/g, '').toLowerCase()); d.touched.add('emails'); }
  else if (where === 'address' || where === 'notes') {
    d[where] = d[where] ? `${d[where]}${where === 'address' ? ', ' : '\n'}${text}` : text; d.touched.add(where);
  } else { d[where] = text; d.touched.add(where); }
  closeSheet();
  renderEditor();
}

async function saveDraft() {
  const d = state.draft;
  // pick up the value of whatever field still has focus
  if (document.activeElement) onEditorInput({ target: document.activeElement });
  const phones = d.phones.map(p => ({ label: p.label, value: p.value.trim() })).filter(p => p.value);
  const emails = d.emails.map(e => e.trim()).filter(Boolean);
  if (!d.name.trim() && !d.company.trim() && !phones.length && !emails.length && !d.photo) {
    toast('Add a photo, a name or a company before saving.');
    return;
  }
  const rec = {
    id: d.id, createdAt: d.createdAt,
    name: d.name.trim(), title: d.title.trim(), company: d.company.trim(), phones, emails,
    website: d.website.trim(), address: d.address.trim(), notes: d.notes.trim(), tagIds: d.tagIds,
    rawText: d.rawText,
    photo: d.photo instanceof Blob ? await db.blobToStored(d.photo) : d.photo,
    thumb: d.thumb instanceof Blob ? await db.blobToStored(d.thumb) : d.thumb,
  };
  try {
    const saved = await db.saveCard(rec);
    if (d.photoUrl) URL.revokeObjectURL(d.photoUrl);
    state.draft = null;
    await reload();
    toast('Saved');
    location.replace('#/card/' + saved.id);
  } catch (err) {
    console.error(err);
    toast('Could not save. Your iPhone may be low on storage.');
  }
}

async function newTag() {
  const name = (prompt('Name for the new tag (for example Plumbers)') || '').trim();
  if (!name) return null;
  const existing = state.tags.find(t => t.name.toLowerCase() === name.toLowerCase());
  if (existing) return existing;
  const used = new Set(state.tags.map(t => t.color));
  const color = db.TAG_COLORS.find(c => !used.has(c)) || db.TAG_COLORS[state.tags.length % db.TAG_COLORS.length];
  const tag = await db.saveTag({ name, color });
  state.tags = await db.allTags();
  return tag;
}

// ---------- card detail ----------

function renderDetail(id) {
  const c = state.cards.find(x => x.id === id);
  if (!c) { go('#/'); return; }
  const tags = (c.tagIds || []).map(tagById).filter(Boolean);
  const callable = (c.phones || []).filter(p => p.label !== 'Fax');
  const firstMobile = callable.find(p => p.label === 'Mobile') || callable[0];
  const actions = [
    callable[0] && `<a class="action" href="${telHref(callable[0].value)}">${icon('phone')}<span>Call</span></a>`,
    firstMobile && `<a class="action" href="sms:${digitsOf(firstMobile.value)}">${icon('message')}<span>Text</span></a>`,
    c.emails && c.emails[0] && `<a class="action" href="mailto:${h(c.emails[0])}">${icon('mail')}<span>Email</span></a>`,
    c.website && `<a class="action" href="${h(websiteHref(c.website))}" target="_blank" rel="noopener">${icon('globe')}<span>Website</span></a>`,
    `<button class="action" data-action="contacts">${icon('person')}<span>Contacts</span></button>`,
  ].filter(Boolean).join('');

  const rows = [
    ...(c.phones || []).map(p => p.label === 'Fax'
      ? `<div class="info"><span>${h(p.label)}</span><span class="plain">${h(p.value)}</span></div>`
      : `<div class="info"><span>${h(p.label)}</span><a href="${telHref(p.value)}">${h(p.value)}</a>
          <a class="mini" href="sms:${digitsOf(p.value)}" aria-label="Text ${h(p.value)}">${icon('message')}</a></div>`),
    ...(c.emails || []).map(e => `<div class="info"><span>Email</span><a href="mailto:${h(e)}">${h(e)}</a></div>`),
    c.website ? `<div class="info"><span>Website</span><a href="${h(websiteHref(c.website))}" target="_blank" rel="noopener">${h(c.website)}</a></div>` : '',
    c.address ? `<div class="info"><span>Address</span><a href="https://maps.apple.com/?q=${encodeURIComponent(c.address)}" target="_blank" rel="noopener">${h(c.address)}</a></div>` : '',
  ].join('');

  if ($app.dataset.photoUrl) URL.revokeObjectURL($app.dataset.photoUrl);
  const photoUrl = c.photo ? URL.createObjectURL(db.storedToBlob(c.photo)) : '';
  $app.innerHTML = `
    <header class="bar compact">
      <button class="text-btn" data-action="back">${icon('chevron')}Cards</button>
      <h1></h1>
      <button class="text-btn strong" data-action="edit">Edit</button>
    </header>
    <main class="detail">
      ${photoUrl ? `<button class="card-photo" data-action="zoom" aria-label="View photo full screen"><img src="${photoUrl}" alt="Photo of ${h(displayName(c))}'s business card"></button>` : ''}
      <div class="who">
        <h2>${h(displayName(c))}</h2>
        ${c.title ? `<p>${h(c.title)}</p>` : ''}
        ${c.name && c.company ? `<p class="co">${h(c.company)}</p>` : ''}
        ${tags.length ? `<div class="chips wrap static">${tags.map(t => `<span class="chip on" style="--tag:${t.color}"><i></i>${h(t.name)}</span>`).join('')}</div>` : ''}
      </div>
      <nav class="actions">${actions}</nav>
      ${rows ? `<div class="infos">${rows}</div>` : ''}
      ${c.notes ? `<div class="notes"><h3>Notes</h3><p>${h(c.notes).replace(/\n/g, '<br>')}</p></div>` : ''}
      <p class="meta">Added ${new Date(c.createdAt).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}</p>
    </main>`;
  $app.dataset.photoUrl = photoUrl;
}

function zoomPhoto() {
  const url = $app.dataset.photoUrl;
  if (!url) return;
  const el = document.createElement('div');
  el.className = 'viewer';
  el.innerHTML = `<button class="viewer-close" aria-label="Close">${icon('x')}</button><img src="${url}" alt="Business card photo">`;
  el.addEventListener('click', e => { if (e.target === el || e.target.closest('.viewer-close')) el.remove(); });
  document.body.appendChild(el);
}

async function addToContacts(id) {
  const c = state.cards.find(x => x.id === id);
  if (!c) return;
  let photoB64 = '';
  if (c.thumb) {
    const bytes = new Uint8Array(c.thumb.data);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    photoB64 = btoa(bin);
  }
  const vcf = buildVCard({ ...c, tagNames: (c.tagIds || []).map(t => tagById(t)?.name).filter(Boolean) }, photoB64);
  const file = new File([vcf], vcardFileName(c), { type: 'text/vcard' });
  await shareOrDownload(file, 'Choose Contacts, or Save to Files and open it to add the contact.');
}

async function shareOrDownload(file, hint) {
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file] });
      return;
    }
  } catch (err) {
    if (err && err.name === 'AbortError') return; // user closed the share sheet
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url; a.download = file.name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  if (hint) toast(hint);
}

// ---------- tags & backup ----------

function renderTags() {
  const count = id => state.cards.filter(c => (c.tagIds || []).includes(id)).length;
  $app.innerHTML = `
    <header class="bar compact">
      <button class="text-btn" data-action="back">${icon('chevron')}Cards</button>
      <h1>Tags</h1>
      <span></span>
    </header>
    <main class="tags-screen">
      <p class="hint">Tap a colour to change it. Rename a tag by editing its name.</p>
      <ul class="tag-list">
        ${state.tags.map(t => `
          <li>
            <button class="swatch" data-recolor="${t.id}" style="--tag:${t.color}" aria-label="Change colour of ${h(t.name)}"></button>
            <input value="${h(t.name)}" data-rename="${t.id}" aria-label="Tag name" autocapitalize="words">
            <span class="n">${count(t.id)}</span>
            <button class="icon-btn small" data-delete-tag="${t.id}" aria-label="Delete ${h(t.name)}">${icon('trash')}</button>
          </li>`).join('')}
      </ul>
      <button class="add-row" data-action="new-tag-list">${icon('plus')}New tag</button>

      <section class="backup">
        <h3>Backup</h3>
        <p>Your cards are stored only on this iPhone. If you remove Cardfile from your Home Screen they are deleted, so save a backup to Files now and then.</p>
        <div class="backup-btns">
          <button class="pill solid" data-action="export">${icon('download')}Save backup</button>
          <button class="pill" data-action="import">${icon('upload')}Restore backup</button>
        </div>
        <p class="meta">${state.cards.length} ${state.cards.length === 1 ? 'card' : 'cards'} saved</p>
      </section>
    </main>`;
}

// ---------- router ----------

async function render() {
  closeSheet();
  document.querySelectorAll('.viewer').forEach(v => v.remove());
  const hash = location.hash || '#/';
  const [, route, id] = hash.match(/^#\/([^/]*)\/?(.*)$/) || [];
  window.scrollTo(0, 0);
  if (route === 'card') return renderDetail(id);
  if (route === 'tags') return renderTags();
  if (route === 'new') {
    if (!state.draft || state.draft.id) state.draft = emptyDraft();
    renderEditor();
    if (state.pendingFile) { const f = state.pendingFile; state.pendingFile = null; startScan(f); }
    return;
  }
  if (route === 'edit') {
    const c = state.cards.find(x => x.id === id);
    if (!c) return go('#/');
    if (!state.draft || state.draft.id !== id) {
      state.draft = { ...emptyDraft(), ...structuredClone({ ...c, photo: null, thumb: null }), photo: c.photo, thumb: c.thumb,
        phones: (c.phones || []).map(p => ({ ...p })), emails: [...(c.emails || [])], tagIds: [...(c.tagIds || [])],
        lines: (c.rawText || '').split('\n').filter(Boolean), touched: new Set() };
      if (c.photo) state.draft.photoUrl = URL.createObjectURL(db.storedToBlob(c.photo));
    }
    return renderEditor();
  }
  state.draft = null;
  return renderList();
}

// ---------- events ----------

document.addEventListener('input', e => { if (state.draft && e.target.closest('.editor')) onEditorInput(e); });
document.addEventListener('change', async e => {
  const t = e.target;
  if (state.draft && t.closest('.editor')) onEditorInput(e);
  if (t.dataset.rename) {
    const tag = tagById(t.dataset.rename);
    const name = t.value.trim();
    if (tag && name && name !== tag.name) { await db.saveTag({ ...tag, name }); state.tags = await db.allTags(); toast('Tag renamed'); }
    else if (tag) t.value = tag.name;
  }
});

$camera.addEventListener('change', () => onPhotoPicked($camera));
$library.addEventListener('change', () => onPhotoPicked($library));
$backup.addEventListener('change', async () => {
  const file = $backup.files[0];
  $backup.value = '';
  if (!file) return;
  try {
    const n = await db.importBackup(await file.text());
    await reload();
    render();
    toast(`Restored ${n} ${n === 1 ? 'card' : 'cards'}`);
  } catch (err) {
    toast(err.message || 'That backup could not be read.');
  }
});

document.addEventListener('click', async e => {
  const el = e.target.closest('button, [data-action]');
  if (!el) return;
  const a = el.dataset;
  const d = state.draft;

  if (a.filter) { state.tagFilter = a.filter; renderList(); return; }
  if (a.sort) { state.sort = a.sort; renderList(); return; }
  if (a.toggleTag && d) {
    d.tagIds = d.tagIds.includes(a.toggleTag) ? d.tagIds.filter(x => x !== a.toggleTag) : [...d.tagIds, a.toggleTag];
    el.classList.toggle('on'); el.setAttribute('aria-pressed', d.tagIds.includes(a.toggleTag));
    return;
  }
  if (a.removePhone !== undefined && d) { d.phones.splice(+a.removePhone, 1); d.touched.add('phones'); renderEditor(); return; }
  if (a.removeEmail !== undefined && d) { d.emails.splice(+a.removeEmail, 1); d.touched.add('emails'); renderEditor(); return; }
  if (a.line !== undefined && d) { placeLine(+a.line); return; }
  if (a.place && d) { applyPlace(a.place, +a.lineIdx); return; }
  if (a.recolor) {
    const tag = tagById(a.recolor);
    const next = db.TAG_COLORS[(db.TAG_COLORS.indexOf(tag.color) + 1) % db.TAG_COLORS.length];
    await db.saveTag({ ...tag, color: next }); state.tags = await db.allTags(); renderTags(); return;
  }
  if (a.deleteTag) {
    const tag = tagById(a.deleteTag);
    const n = state.cards.filter(c => (c.tagIds || []).includes(tag.id)).length;
    if (!confirm(`Delete the tag “${tag.name}”?${n ? ` It will be removed from ${n} ${n === 1 ? 'card' : 'cards'}; the cards stay.` : ''}`)) return;
    await db.deleteTag(tag.id);
    if (state.tagFilter === tag.id) state.tagFilter = 'all';
    await reload(); renderTags(); return;
  }

  switch (a.action) {
    case 'scan': openScanSheet(); break;
    case 'take-photo': $camera.click(); break;
    case 'choose-photo': $library.click(); break;
    case 'manual': closeSheet(); state.draft = emptyDraft(); go('#/new'); break;
    case 'close-sheet': closeSheet(); break;
    case 'retake': openScanSheet(); document.querySelector('.sheet [data-action="manual"]')?.remove(); break;
    case 'rotate':
      if (d && (d.img || d.photo)) {
        if (!d.img) d.img = await loadImage(d.photo instanceof Blob ? d.photo : db.storedToBlob(d.photo));
        d.rotate = (d.rotate + 90) % 360;
        startScan(null, { fillOnlyEmpty: !!d.id });
      }
      break;
    case 'add-phone': if (d) { d.phones.push({ label: 'Mobile', value: '' }); renderEditor(); document.querySelector(`[data-phone="${d.phones.length - 1}"]`)?.focus(); } break;
    case 'add-email': if (d) { d.emails.push(''); renderEditor(); document.querySelector(`[data-email="${d.emails.length - 1}"]`)?.focus(); } break;
    case 'new-tag': if (d) { const t = await newTag(); if (t && !d.tagIds.includes(t.id)) d.tagIds.push(t.id); renderEditor(); } break;
    case 'new-tag-list': if (await newTag()) renderTags(); break;
    case 'save': await saveDraft(); break;
    case 'cancel-edit': {
      const id = d && d.id;
      state.scanToken++;
      if (d && d.photoUrl) URL.revokeObjectURL(d.photoUrl);
      state.draft = null;
      location.replace(id ? '#/card/' + id : '#/');
      break;
    }
    case 'delete': {
      if (!d || !confirm('Delete this card and its photo? This cannot be undone.')) break;
      await db.deleteCard(d.id); state.draft = null; await reload(); toast('Card deleted'); location.replace('#/');
      break;
    }
    case 'back': history.length > 1 ? history.back() : go('#/'); break;
    // replace (not push) so Back from the saved card returns to the list, not the same card again
    case 'edit': location.replace('#/edit/' + location.hash.split('/')[2]); break;
    case 'zoom': zoomPhoto(); break;
    case 'contacts': await addToContacts(location.hash.split('/')[2]); break;
    case 'open-tags': go('#/tags'); break;
    case 'clear-search': state.query = ''; state.tagFilter = 'all'; renderList(); break;
    case 'export': {
      const json = await db.exportBackup();
      const stamp = new Date().toISOString().slice(0, 10);
      await shareOrDownload(new File([json], `cardfile-backup-${stamp}.json`, { type: 'application/json' }), 'Backup saved to Downloads.');
      break;
    }
    case 'import': $backup.click(); break;
  }
});

window.addEventListener('hashchange', render);

// ---------- icons (inline SVG sprite) ----------

document.body.insertAdjacentHTML('afterbegin', `<svg width="0" height="0" style="position:absolute" aria-hidden="true">
  <defs>
    <symbol id="i-camera" viewBox="0 0 24 24"><path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.6l1.3-2h5.2l1.3 2h1.6A2.5 2.5 0 0 1 20 8.5v8A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5z"/><circle cx="12" cy="12.5" r="3.5"/></symbol>
    <symbol id="i-image" viewBox="0 0 24 24"><rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><circle cx="9" cy="10" r="1.8"/><path d="m4 17 5-4.5 4 3.5 3-2.5 4.5 4"/></symbol>
    <symbol id="i-pencil" viewBox="0 0 24 24"><path d="m14.5 5.5 4 4L9 19H5v-4z"/><path d="m13 7 4 4"/></symbol>
    <symbol id="i-search" viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/></symbol>
    <symbol id="i-tag" viewBox="0 0 24 24"><path d="M3.5 12.2V4.5a1 1 0 0 1 1-1h7.7l8.3 8.3a1.4 1.4 0 0 1 0 2l-6.7 6.7a1.4 1.4 0 0 1-2 0z"/><circle cx="8" cy="8" r="1.5"/></symbol>
    <symbol id="i-phone" viewBox="0 0 24 24"><path d="M6.6 3.5h2.6l1.4 4.3-2 1.4a12 12 0 0 0 6.2 6.2l1.4-2 4.3 1.4v2.6a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 4.6 5.7a2 2 0 0 1 2-2.2z"/></symbol>
    <symbol id="i-message" viewBox="0 0 24 24"><path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v7a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 4v-4h0A1.5 1.5 0 0 1 4 14.5z"/></symbol>
    <symbol id="i-mail" viewBox="0 0 24 24"><rect x="3.5" y="5.5" width="17" height="13" rx="2"/><path d="m4 7 8 6 8-6"/></symbol>
    <symbol id="i-globe" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.6 3.5 5.4 3.5 8.5s-1 5.9-3.5 8.5c-2.5-2.6-3.5-5.4-3.5-8.5s1-5.9 3.5-8.5z"/></symbol>
    <symbol id="i-person" viewBox="0 0 24 24"><circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20c.8-3.8 3.7-6 7.5-6s6.7 2.2 7.5 6"/><path d="M19 3.5v5M16.5 6h5"/></symbol>
    <symbol id="i-rotate" viewBox="0 0 24 24"><path d="M19 12a7 7 0 1 1-2.1-5"/><path d="M19.5 4v4.5H15"/></symbol>
    <symbol id="i-plus" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></symbol>
    <symbol id="i-x" viewBox="0 0 24 24"><path d="m6.5 6.5 11 11M17.5 6.5l-11 11"/></symbol>
    <symbol id="i-chevron" viewBox="0 0 24 24"><path d="m14.5 5-7 7 7 7"/></symbol>
    <symbol id="i-trash" viewBox="0 0 24 24"><path d="M5 7h14M10 7V4.5h4V7M6.5 7l1 12.5h9l1-12.5"/></symbol>
    <symbol id="i-download" viewBox="0 0 24 24"><path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14"/></symbol>
    <symbol id="i-upload" viewBox="0 0 24 24"><path d="M12 15V4M7.5 8.5 12 4l4.5 4.5M5 19.5h14"/></symbol>
  </defs></svg>`);

// ---------- start ----------

(async function start() {
  try {
    await db.seedIfEmpty();
    await reload();
    db.requestPersistence();
  } catch (err) {
    console.error(err);
    $app.innerHTML = `<div class="empty"><p><strong>Storage is unavailable.</strong></p><p>Cardfile needs website storage. If you are in a Private Browsing tab, open it in a normal tab instead.</p></div>`;
    return;
  }
  if (location.hash.startsWith('#/new') && !state.pendingFile) history.replaceState(null, '', '#/');
  render();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(err => console.warn('Offline support unavailable', err));
  }
})();
