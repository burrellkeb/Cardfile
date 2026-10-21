// Parser tests: real Tesseract output from the generated card photos,
// plus hand-written "messy OCR" cases that mimic common real-world slips.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCard, digitsOf, formatPhone, telHref, titleCase, splitName } from '../app/js/parser.js';

const here = path.dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0;
const check = (label, cond, got) => {
  if (cond) pass++; else { fail++; console.log(`  FAIL ${label}: got ${JSON.stringify(got)}`); }
};
const norm = s => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

function verify(id, r, e) {
  console.log(`- ${id}: ${JSON.stringify({ name: r.name, title: r.title, company: r.company, phones: r.phones, emails: r.emails, website: r.website, address: r.address })}`);
  if (e.name) check(`${id} name`, norm(r.name).includes(norm(e.name)), r.name);
  if (e.title) check(`${id} title`, norm(r.title) === norm(e.title), r.title);
  if (e.company) check(`${id} company`, norm(r.company) === norm(e.company), r.company);
  for (const p of e.phones || []) check(`${id} phone ${p}`, r.phones.some(x => digitsOf(x.value.split(' ext')[0]).endsWith(digitsOf(p))), r.phones);
  if (e.fax) check(`${id} fax`, r.phones.some(x => x.label === 'Fax' && digitsOf(x.value).endsWith(digitsOf(e.fax))), r.phones);
  for (const m of e.emails || []) check(`${id} email ${m}`, r.emails.includes(m), r.emails);
  if (e.website) check(`${id} website`, r.website === e.website, r.website);
  for (const a of e.address_has || []) check(`${id} address has ${a}`, r.address.includes(a), r.address);
  if (e.no_address) check(`${id} no address`, !r.address, r.address);
}

// 1) real OCR output
const expected = JSON.parse(fs.readFileSync(path.join(here, 'cards', 'expected.json'), 'utf8'));
for (const [id, e] of Object.entries(expected)) {
  const f = path.join(here, 'cards', id + '.ocr.json');
  if (!fs.existsSync(f)) { console.log(`(skip ${id}: run dev/ocr_node.mjs first)`); continue; }
  verify(id, parseCard(JSON.parse(fs.readFileSync(f, 'utf8'))), e);
}

// 2) messy OCR cases
const messy = [
  {
    id: 'two-column merged',
    text: 'BLUE RIDGE MEDICAL CENTER\nSarah Kim, MD\nInternal Medicine\nPhone: 205-555-0100      Fax: 205-555-0101\nskim@blueridgemed.org | www.blueridgemed.org\n2201 Hospital Dr, Ste 4\nNorthport, AL 35476',
    e: { name: 'Sarah Kim', company: 'Blue Ridge Medical Center', phones: ['2055550100'], fax: '2055550101', emails: ['skim@blueridgemed.org'], website: 'www.blueridgemed.org', address_has: ['2201 Hospital Dr', '35476'] },
  },
  {
    id: 'ocr slips',
    text: 'Tony Russo\nOwner & Chef\nRusso\'s Pizzeria\nCell: (2O5) 555-O177\ntony @ russospizza. com\n15 Main St\nTuscaloosa, AL 354O1',
    e: { name: 'Tony Russo', title: 'Owner & Chef', company: "Russo's Pizzeria", phones: ['2055550177'], emails: ['tony@russospizza.com'], address_has: ['15 Main St', '35401'] },
  },
  {
    id: 'gmail freelancer',
    text: 'Maria Lopez\nInterior Designer\n(205) 555-3344\nmarialopez.designs@gmail.com',
    e: { name: 'Maria Lopez', title: 'Interior Designer', phones: ['2055553344'], emails: ['marialopez.designs@gmail.com'], no_address: true },
  },
  {
    id: 'international + ext',
    text: 'Oliver Bennett\nHead of Procurement\nHarrow & Finch Ltd\nT +44 20 7946 0958\nM +44 7700 900123\nDirect: 212-555-0198 x204\noliver.bennett@harrowfinch.co.uk',
    e: { name: 'Oliver Bennett', title: 'Head of Procurement', company: 'Harrow & Finch Ltd', phones: ['2079460958', '7700900123', '2125550198'], emails: ['oliver.bennett@harrowfinch.co.uk'] },
  },
];
for (const m of messy) verify(m.id, parseCard(m.text), m.e);

// 3) helpers
check('formatPhone US', formatPhone('205.555.0142') === '(205) 555-0142', formatPhone('205.555.0142'));
check('formatPhone +1', formatPhone('+1 205 555 0188') === '(205) 555-0188', formatPhone('+1 205 555 0188'));
check('formatPhone intl', formatPhone('+44 20 7946 0958') === '+44 20 7946 0958', formatPhone('+44 20 7946 0958'));
check('telHref US', telHref('(205) 555-0142') === 'tel:+12055550142', telHref('(205) 555-0142'));
check('telHref ext', telHref('(212) 555-0198 ext. 204') === 'tel:+12125550198,204', telHref('(212) 555-0198 ext. 204'));
check('titleCase', titleCase("KEVIN O'BRIEN") === "Kevin O'Brien", titleCase("KEVIN O'BRIEN"));
check('titleCase company', titleCase('THE IRON SKILLET', { keepShortCaps: true }) === 'The Iron Skillet', titleCase('THE IRON SKILLET', { keepShortCaps: true }));
const sn = splitName('Dr. Priya Raman, DDS');
check('splitName', sn.prefix === 'Dr.' && sn.given === 'Priya' && sn.family === 'Raman' && sn.suffix === 'DDS', sn);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
