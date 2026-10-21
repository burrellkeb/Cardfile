// vcard.js — build a vCard so iOS can add the person to Contacts.
import { splitName } from './parser.js';

const esc = s => String(s || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');

// vCard lines must be folded at 75 characters.
const fold = line => {
  if (line.length <= 75) return line;
  const parts = [line.slice(0, 75)];
  for (let i = 75; i < line.length; i += 74) parts.push(' ' + line.slice(i, i + 74));
  return parts.join('\r\n');
};

const TEL_TYPE = { Mobile: 'CELL', Work: 'WORK,VOICE', Fax: 'WORK,FAX', Home: 'HOME,VOICE' };

export function buildVCard(card, photoBase64) {
  const n = splitName(card.name);
  const lines = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `N:${esc(n.family)};${esc(n.given)};;${esc(n.prefix)};${esc(n.suffix)}`,
    `FN:${esc(card.name || card.company || 'Business card')}`,
  ];
  if (card.company) lines.push(`ORG:${esc(card.company)}`);
  if (card.title) lines.push(`TITLE:${esc(card.title)}`);
  for (const p of card.phones || []) {
    if (!p.value) continue;
    const type = TEL_TYPE[p.label] || 'VOICE';
    lines.push(`TEL;TYPE=${type}:${p.value}`);
  }
  for (const e of card.emails || []) if (e) lines.push(`EMAIL;TYPE=INTERNET,WORK:${e}`);
  if (card.website) lines.push(`URL:${/^https?:/i.test(card.website) ? card.website : 'https://' + card.website}`);
  if (card.address) lines.push(`ADR;TYPE=WORK:;;${esc(card.address)};;;;`);
  const note = [card.notes, card.tagNames && card.tagNames.length ? 'Tags: ' + card.tagNames.join(', ') : '']
    .filter(Boolean).join('\n');
  if (note) lines.push(`NOTE:${esc(note)}`);
  if (photoBase64) lines.push(`PHOTO;ENCODING=b;TYPE=JPEG:${photoBase64}`);
  lines.push('END:VCARD');
  return lines.map(fold).join('\r\n') + '\r\n';
}

export function vcardFileName(card) {
  return ((card.name || card.company || 'contact').replace(/[^\w\- ]+/g, '').trim() || 'contact') + '.vcf';
}
