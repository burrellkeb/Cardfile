// parser.js — turns OCR'd business-card text into structured fields.
//
// Input:  an array of lines, each { text, h } where h is the line's pixel
//         height (bigger text is usually the name or company), or a plain string.
// Output: { name, title, company, phones:[{label,value}], emails:[], website,
//           address, lines:[cleaned lines] }
//
// Strategy: pull out the easy, pattern-shaped things first (emails, websites,
// phones, address), then score the leftover lines to decide which one is the
// person's name, their job title and the company.

const TLDS = 'com|net|org|edu|gov|io|co|us|biz|info|me|app|dev|ai|studio|design|tech|health|care|dental|law|legal|shop|store|online|site|agency|media|realty|homes|restaurant|cafe|bar|pizza|menu|furniture|clinic|church|ca|uk|au|de|fr|mx'.split('|');
const TLD_RE = TLDS.join('|');

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const WEB_RE = new RegExp(String.raw`\b(?:https?:\/\/)?(?:www\.)?[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.(?:${TLD_RE})\b(?:\/[^\s,]*)?`, 'gi');
const PHONE_RE = /(?:\+\s?\d{1,3}[\s.\-–]?)?(?:\(\s?\d{2,4}\s?\)|\d{2,4})[\s.\-–]?\d{3,4}[\s.\-–]?\d{3,4}(?:\s*(?:x|ext\.?|extension)\s*\d{1,6})?/gi;

const US_STATES = 'AL|AK|AZ|AR|CA|CO|CT|DE|DC|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY';
const STREET_SUFFIX = 'St|Street|Ave|Avenue|Blvd|Boulevard|Rd|Road|Dr|Drive|Ln|Lane|Way|Ct|Court|Pl|Place|Pkwy|Parkway|Hwy|Highway|Cir|Circle|Ter|Terrace|Trl|Trail|Sq|Square|Loop|Plaza|Pike|Row|Run|Crossing|Xing';
const STREET_RE = new RegExp(String.raw`\b\d{1,6}[A-Za-z]?\s+(?:[NSEW]\.?\s+)?[A-Za-z0-9.'\- ]{2,40}?\b(?:${STREET_SUFFIX})\b\.?`, 'i');
const CITY_STATE_ZIP_RE = new RegExp(String.raw`\b(?:${US_STATES})\.?,?\s+\d{5}(?:-\d{4})?\b`);
const UNIT_RE = /^(?:suite|ste\.?|unit|floor|fl\.?|bldg\.?|building|#)\s*\w+/i;
const PO_BOX_RE = /\bp\.?\s?o\.?\s+box\s+\d+/i;

const TITLE_WORDS = [
  'president', 'vice', 'vp', 'ceo', 'cfo', 'coo', 'cto', 'cmo', 'chief', 'owner', 'co-owner', 'founder', 'co-founder',
  'partner', 'principal', 'director', 'manager', 'mgr', 'supervisor', 'lead', 'head', 'senior', 'sr', 'junior', 'jr',
  'associate', 'assistant', 'executive', 'officer', 'coordinator', 'administrator', 'admin', 'specialist', 'consultant',
  'advisor', 'adviser', 'analyst', 'engineer', 'developer', 'designer', 'architect', 'technician', 'representative', 'rep',
  'agent', 'broker', 'realtor', 'attorney', 'lawyer', 'counsel', 'paralegal', 'accountant', 'cpa', 'chef', 'sous',
  'sommelier', 'bartender', 'server', 'host', 'nurse', 'rn', 'np', 'physician', 'surgeon', 'dentist', 'hygienist',
  'therapist', 'pharmacist', 'practitioner', 'sales', 'marketing', 'account', 'accounts', 'operations', 'buyer',
  'planner', 'instructor', 'professor', 'teacher', 'pastor', 'contractor', 'estimator', 'foreman', 'superintendent',
  'producer', 'photographer', 'stylist', 'creative', 'editor', 'writer', 'recruiter', 'secretary', 'treasurer',
  'chair', 'chairman', 'chairwoman', 'board', 'member', 'intern', 'manager,', 'general', 'regional', 'national', 'district',
];
const TITLE_SET = new Set(TITLE_WORDS);

const COMPANY_WORDS = [
  'inc', 'llc', 'l.l.c', 'llp', 'ltd', 'co', 'corp', 'corporation', 'company', 'group', 'partners', 'associates', 'agency',
  'studio', 'studios', 'clinic', 'hospital', 'center', 'centre', 'dentistry', 'dental', 'medical', 'health', 'healthcare',
  'pharmacy', 'restaurant', 'grill', 'cafe', 'café', 'kitchen', 'bar', 'bakery', 'pizza', 'pizzeria', 'bistro', 'diner',
  'furniture', 'interiors', 'design', 'designs', 'realty', 'properties', 'insurance', 'bank', 'law', 'firm', 'construction',
  'services', 'solutions', 'systems', 'technologies', 'tech', 'labs', 'industries', 'enterprises', 'consulting', 'motors',
  'auto', 'salon', 'spa', 'fitness', 'church', 'university', 'college', 'school', 'foundation', 'institute', 'hotel',
  'inn', 'market', 'supply', 'store', 'shop', 'boutique', 'gallery', 'media', 'marketing', 'printing', 'plumbing',
  'electric', 'roofing', 'landscaping', 'cleaning', 'logistics', 'capital', 'financial', 'advisors', 'holdings',
];
const COMPANY_SET = new Set(COMPANY_WORDS);

// Mailboxes that say nothing about the person's name.
const GENERIC_MAILBOX = new Set(['info', 'hello', 'hi', 'contact', 'sales', 'support', 'office', 'admin', 'team',
  'appointments', 'appointment', 'booking', 'bookings', 'reservations', 'orders', 'service', 'help', 'mail', 'inquiries',
  'enquiries', 'frontdesk', 'reception', 'billing', 'accounts', 'jobs', 'careers', 'marketing', 'events']);

const NAME_PREFIX_RE = /^(?:dr|mr|mrs|ms|miss|mx|prof|rev|hon)\.?\s+/i;
const NAME_SUFFIX_RE = /,?\s+(?:jr\.?|sr\.?|ii|iii|iv|md|m\.d\.|dds|d\.d\.s\.|dmd|do|phd|ph\.d\.|rn|np|pa-c|cpa|esq\.?|mba|pe|aia|leed ap|ma|ms|msw|lcsw|dpt|od|dvm|pharmd)\.?$/i;

const STOP_WORDS = new Set(['the', 'and', 'of', 'for', 'at', 'by', 'in', 'on', 'a', 'an', '&']);

// ---------- small helpers ----------

const lettersOnly = s => s.toLowerCase().replace(/[^a-z]/g, '');
const words = s => s.split(/\s+/).filter(Boolean);
const bareWord = w => w.toLowerCase().replace(/[^a-z0-9&'-]/g, '');

export function digitsOf(s) { return (s || '').replace(/\D/g, ''); }

/** Pretty-print a phone number. US/Canada numbers become (205) 555-0142. */
export function formatPhone(raw) {
  const [main, ext] = String(raw).split(/\s*(?:x|ext\.?|extension)\s*/i);
  let d = digitsOf(main);
  const hadPlus = /^\s*\+/.test(main);
  let out;
  if (d.length === 11 && d[0] === '1') d = d.slice(1);
  if (d.length === 10 && (!hadPlus || digitsOf(main).startsWith('1'))) {
    out = `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  } else {
    out = main.trim().replace(/\s+/g, ' ');
  }
  return ext ? `${out} ext. ${digitsOf(ext)}` : out;
}

/** tel: link for a stored phone value. */
export function telHref(value) {
  const [main, ext] = String(value).split(/\s*(?:x|ext\.?|extension)\s*/i);
  let d = digitsOf(main);
  if (d.length === 10) d = '1' + d;
  const base = (/^\s*\+/.test(main) || d.length === 11) ? '+' + d : d;
  return 'tel:' + base + (ext ? ',' + digitsOf(ext) : '');
}

/** Normalise a website for display and linking. */
export function normalizeWebsite(w) {
  return (w || '').trim().replace(/[.,;]+$/, '').replace(/^(https?:\/\/)?(www\.)?/i, (m, p, www) => (www ? 'www.' : '')).toLowerCase();
}
export function websiteHref(w) {
  const s = (w || '').trim();
  return /^https?:\/\//i.test(s) ? s : 'https://' + s;
}

/** "KEVIN O'BRIEN" -> "Kevin O'Brien"; leaves mixed-case text alone. */
export function titleCase(s, { keepShortCaps = false } = {}) {
  if (/[a-z]/.test(s)) return s; // already mixed case, trust it
  return s.toLowerCase().replace(/[a-z][a-z'’]*/g, (w, i, full) => {
    if (keepShortCaps && w.length <= 3 && !STOP_WORDS.has(w) && !['co', 'inc', 'ltd'].includes(w)) {
      return w === 'llc' || w === 'llp' ? w.toUpperCase() : w.toUpperCase();
    }
    if (i > 0 && STOP_WORDS.has(w) && full[i - 1] === ' ') return w;
    let t = w[0].toUpperCase() + w.slice(1);
    t = t.replace(/^(O['’])([a-z])/, (m, a, b) => a + b.toUpperCase());
    t = t.replace(/^(Mc)([a-z])/, (m, a, b) => a + b.toUpperCase());
    return t;
  }).replace(/(^|[\s-])([a-z])/g, (m, a, b) => a + b.toUpperCase());
}

/** Split a display name into vCard parts. */
export function splitName(full) {
  let s = (full || '').trim();
  let prefix = '', suffix = '';
  const pm = s.match(NAME_PREFIX_RE);
  if (pm) { prefix = pm[0].trim(); s = s.slice(pm[0].length); }
  const sm = s.match(NAME_SUFFIX_RE);
  if (sm) { suffix = sm[0].replace(/^,?\s+/, ''); s = s.slice(0, sm.index); }
  const parts = words(s);
  const family = parts.length > 1 ? parts.pop() : '';
  return { prefix, given: parts.join(' '), family, suffix };
}

// ---------- OCR clean-up ----------

function cleanLine(t) {
  return t
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/[®™©]/g, '')
    .replace(/^[\s|•·*>\-–—_=~:]+/, '')
    .replace(/[\s|•·*_=~]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Wide gaps (from preserve_interword_spaces) or separators mean two columns
// were read as one line, e.g. "Phone: 555-1234      Fax: 555-9876".
function splitSegments(t) {
  return t.split(/\s{3,}|\s[|•·]\s/).map(cleanLine).filter(Boolean);
}

// Common OCR slips inside numbers: O->0, l/I/|->1, S->5 when surrounded by digits.
function fixDigits(t) {
  return t.replace(/[\d()+.\-\s OolI|S]{9,}/g, run => {
    if ((run.match(/\d/g) || []).length < 6) return run;
    return run.replace(/(?<=[\d(.\-\s])[Oo](?=[\d).\-\s])/g, '0')
      .replace(/(?<=[\d(.\-\s])[lI|](?=[\d).\-\s])/g, '1')
      .replace(/(?<=\d)S(?=\d)/g, '5');
  });
}

// Undo spaces OCR inserts inside emails/URLs: "bob @ acme. com" -> "bob@acme.com"
function fixAddressy(t) {
  let s = t.replace(/\s*@\s*/g, '@').replace(/\s*\(at\)\s*/gi, '@');
  s = s.replace(new RegExp(String.raw`([a-z0-9-])\s?\.\s(${TLD_RE})\b`, 'gi'), '$1.$2');
  s = s.replace(/\b(www)\s?\.\s?/gi, 'www.');
  return s;
}

// "BIvd" -> "Blvd", "VVay" -> "Way": capital I/VV misreads inside lowercase words
function fixLetters(t) {
  // ZIP codes after a state: "AL 354O1" -> "AL 35401"
  t = t.replace(new RegExp(String.raw`\b(${US_STATES})(\.?,?\s+)([\dOoIl]{5})\b`), (m, st, sep, zip) =>
    st + sep + zip.replace(/[Oo]/g, '0').replace(/[Il]/g, '1'));
  t = t.replace(/\bB[Il1|][Vv]d\b/g, 'Blvd');
  return t.replace(/\b([A-Z])I([a-z]{2,})\b/g, '$1l$2').replace(/\bVV/g, 'W');
}

const LABEL_RE = /^(?:e-?mail|email|e|web|website|w|url|address|addr|a)\s*[:.]\s*/i;

// ---------- the parser ----------

export function parseCard(input) {
  const rawLines = typeof input === 'string'
    ? input.split(/\r?\n/).map(text => ({ text, h: 0 }))
    : input.map(l => ({ text: l.text || '', h: l.h || 0, conf: l.conf }));

  // 1. clean up and split into segments
  const segs = [];
  rawLines.forEach((l, lineIdx) => {
    for (const seg of splitSegments(l.text)) {
      // drop junk: no letters/digits, or very low confidence short noise
      if (!/[a-z0-9]/i.test(seg)) continue;
      if (l.conf !== undefined && l.conf < 35 && seg.length < 5) continue;
      segs.push({ text: fixLetters(fixAddressy(fixDigits(seg))), h: l.h, lineIdx, used: false, rest: '' });
    }
  });

  const out = { name: '', title: '', company: '', phones: [], emails: [], website: '', address: '', lines: segs.map(s => s.text) };
  const extraSites = [];

  // 2. emails
  for (const s of segs) {
    const found = s.text.match(EMAIL_RE);
    if (!found) continue;
    for (const e of found) {
      const email = e.toLowerCase().replace(/\.+$/, '');
      if (!out.emails.includes(email)) out.emails.push(email);
    }
    s.rest = s.text.replace(EMAIL_RE, ' ');
    s.used = !/[a-z]{3,}/i.test(s.rest.replace(LABEL_RE, ''));
  }

  // 3. websites (skip the domain part of emails)
  for (const s of segs) {
    const text = s.rest || s.text;
    const found = text.match(WEB_RE);
    if (!found) continue;
    let anyUrl = false;
    for (const w of found) {
      // "Co." or "Inc." followed by a word is not a URL; require no spaces and a dot
      if (/@/.test(w)) continue;
      const site = normalizeWebsite(w);
      if (!/\./.test(site) || site.length < 4) continue;
      anyUrl = true;
      if (!out.website) out.website = site; else if (site !== out.website) extraSites.push(site);
    }
    if (anyUrl) {
      const remaining = text.replace(WEB_RE, ' ').replace(LABEL_RE, '');
      s.rest = remaining;
      s.used = !/[a-z]{3,}/i.test(remaining);
    }
  }

  // 4. phones
  for (const s of segs) {
    if (s.used) continue;
    const text = s.text;
    PHONE_RE.lastIndex = 0;
    let m, any = false, consumed = text;
    while ((m = PHONE_RE.exec(text))) {
      const raw = m[0].trim();
      const n = digitsOf(raw.split(/x|ext/i)[0]).length;
      if (n < 10 || n > 15) continue;
      // looks like part of an address ("1820 ... 35404") — phone runs have no letters, so fine
      const before = text.slice(0, m.index);
      const after = text.slice(m.index + m[0].length);
      const label = phoneLabel(before, after);
      const value = formatPhone(raw);
      if (!out.phones.some(p => digitsOf(p.value) === digitsOf(value))) out.phones.push({ label, value });
      consumed = consumed.replace(m[0], ' ');
      any = true;
    }
    if (any) {
      s.rest = consumed;
      s.used = !/[a-z]{4,}/i.test(consumed.replace(/\b(?:phone|tel|cell|mobile|office|fax|direct|main|work|toll[- ]free|emergency|after hours|ph|mob)\b/gi, ''));
    }
  }

  // 5. address: street line, unit line, PO box, city/state/zip — glue neighbours
  const addrIdx = [];
  segs.forEach((s, i) => {
    if (s.used) return;
    const t = s.text.replace(LABEL_RE, '');
    if (STREET_RE.test(t) || CITY_STATE_ZIP_RE.test(t) || PO_BOX_RE.test(t) || UNIT_RE.test(t)) addrIdx.push(i);
  });
  if (addrIdx.length) {
    // keep the cluster that contains the strongest signal (zip or street)
    const parts = [];
    for (const i of addrIdx) {
      const t = segs[i].text.replace(LABEL_RE, '');
      // a lone unit line only counts if next to another address line
      if (UNIT_RE.test(t) && !STREET_RE.test(t) && !CITY_STATE_ZIP_RE.test(t) &&
          !addrIdx.includes(i - 1) && !addrIdx.includes(i + 1)) continue;
      parts.push(t.replace(/\s*,\s*$/, ''));
      segs[i].used = true;
    }
    out.address = parts.join(', ').replace(/\s+/g, ' ');
  }

  // 6. score what's left for name / title / company
  const domains = [...out.emails.map(e => e.split('@')[1]), out.website]
    .filter(Boolean).map(d => lettersOnly(d.replace(/^www\./, '').replace(/\.[a-z]+$/, '')));
  const locals = out.emails.map(e => e.split('@')[0].toLowerCase())
    .filter(l => !GENERIC_MAILBOX.has(lettersOnly(l)));

  const cands = segs.filter(s => !s.used && /[a-z]{2,}/i.test(s.text) && s.text.length <= 60);
  const maxH = Math.max(1, ...cands.map(c => c.h || 0));

  const scored = cands.map(s => {
    const t = s.text;
    const ws = words(t).map(bareWord).filter(Boolean);
    const sig = ws.filter(w => !STOP_WORDS.has(w) && !COMPANY_SET.has(w) && w.length >= 3);
    const hasDigits = /\d/.test(t);
    const bigness = s.h ? s.h / maxH : 0;

    // company
    let company = 0;
    if (ws.some(w => COMPANY_SET.has(w.replace(/\.$/, '')))) company += 3;
    for (const d of domains) {
      const hits = sig.filter(w => w.length >= 4 && d.includes(lettersOnly(w))).length;
      if (sig.length && hits === sig.length) company += 4;
      else if (hits > 0) company += 2;
    }
    if (/^[^a-z]+$/.test(t) && ws.length <= 5) company += 0.5; // ALL CAPS wordmark
    if (s.lineIdx <= 1) company += 0.5;
    if (bigness > 0.95) company += 0.5;

    // title
    let title = 0;
    const titleHits = ws.filter(w => TITLE_SET.has(w.replace(/[.,]$/, ''))).length;
    if (titleHits) title += 3 + Math.min(titleHits, 2);
    if (/&/.test(t) && titleHits) title += 0.5; // "Owner & Chef"

    // name
    let name = 0;
    const nameish = /^[A-Za-z][A-Za-z.'\-]*(?:\s+[A-Za-z][A-Za-z.'\-]*){1,3}(?:,\s*[A-Za-z.\-]{2,8})?$/.test(t);
    const capsOk = words(t.replace(NAME_PREFIX_RE, '').replace(NAME_SUFFIX_RE, ''))
      .every(w => /^[A-Z]/.test(w) || /^(?:de|da|van|von|del|la|le|di|bin|al)$/.test(w));
    if (nameish && capsOk && !hasDigits) name += 2;
    if (NAME_PREFIX_RE.test(t) || NAME_SUFFIX_RE.test(t)) name += 3;
    const nameTokens = words(t.replace(NAME_PREFIX_RE, '').replace(NAME_SUFFIX_RE, '')).map(lettersOnly).filter(Boolean);
    for (const local of locals) {
      const L = lettersOnly(local);
      const first = nameTokens[0] || '', last = nameTokens[nameTokens.length - 1] || '';
      if (!first) continue;
      if (nameTokens.length > 1 && L.includes(first) && L.includes(last)) name += 5;
      else if (last.length > 2 && (L === first[0] + last || L === first + last[0] || L.includes(last))) name += 4;
      else if (first.length > 2 && L.startsWith(first)) name += 3;
    }
    if (titleHits) name -= 3;
    if (company >= 3) name -= 2;
    if (ws.length > 4) name -= 2;
    if (bigness > 0.6) name += 0.5;

    return { s, name, title, company };
  });

  const take = (key, min) => {
    const best = scored.filter(c => !c.taken && c[key] >= min).sort((a, b) => b[key] - a[key] || (b.s.h - a.s.h))[0];
    if (best) best.taken = true;
    return best ? best.s.text : '';
  };
  // Decide the strongest signal first so a line isn't claimed twice.
  const order = ['name', 'company', 'title'].sort((a, b) =>
    Math.max(0, ...scored.map(c => c[b])) - Math.max(0, ...scored.map(c => c[a])));
  const mins = { name: 2, company: 2, title: 3 };
  for (const key of order) out[key] = take(key, mins[key]);

  // Company fallback: the domain, pretty-printed, if nothing scored.
  if (!out.company && domains[0] && !GENERIC_DOMAINS.has(domains[0])) {
    const leftover = scored.filter(c => !c.taken && !/\d/.test(c.s.text) && c.company >= 0.5).sort((a, b) => b.s.h - a.s.h)[0];
    if (leftover) { out.company = leftover.s.text; leftover.taken = true; }
  }

  out.name = out.name ? titleCase(out.name.replace(/\s+,/, ',')) : '';
  out.company = out.company ? titleCase(out.company, { keepShortCaps: true }) : '';
  out.title = out.title ? titleCase(out.title) : '';
  if (extraSites.length) out.notes = 'Also: ' + extraSites.join(', ');
  return out;
}

const GENERIC_DOMAINS = new Set(['gmail', 'yahoo', 'outlook', 'hotmail', 'icloud', 'aol', 'me', 'live', 'msn', 'protonmail', 'proton']);

function phoneLabel(before, after) {
  const b = before.toLowerCase().replace(/[^a-z ]/g, ' ').trim().split(/\s+/).pop() || '';
  const a = after.toLowerCase().replace(/[^a-z ]/g, ' ').trim().split(/\s+/)[0] || '';
  const pick = w => {
    if (/^(?:m|c|cell|cel|mobile|mob|mbl|cellular|iphone)$/.test(w)) return 'Mobile';
    if (/^(?:f|fax|fx)$/.test(w)) return 'Fax';
    if (/^(?:t|tel|p|ph|phone|o|off|office|w|work|d|dir|direct|main|business|bus)$/.test(w)) return 'Work';
    if (/^(?:home|h)$/.test(w)) return 'Home';
    if (/^(?:emergency|toll|tollfree|after|text|sms|pager|fax2)$/.test(w)) return w[0].toUpperCase() + w.slice(1);
    return '';
  };
  return pick(b) || pick(a) || 'Work';
}
