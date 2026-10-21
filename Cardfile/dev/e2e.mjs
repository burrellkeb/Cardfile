// End-to-end test in a phone-sized Chromium: scan every test card, check the
// fields that were filled in, tag, save, search, reload, export a contact.
// Usage: node dev/e2e.mjs   (serves ./app on :8123 itself)
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const shots = path.join(here, 'shots');
fs.mkdirSync(shots, { recursive: true });
const expected = JSON.parse(fs.readFileSync(path.join(here, 'cards', 'expected.json'), 'utf8'));
const TAGS = { furniture: 'Furniture', restaurant: 'Restaurants', dentist: 'Healthcare', tech: null, realtor: null, dark: null };

const server = spawn('python3', ['-m', 'http.server', '8123', '-d', path.join(here, '..', 'app')], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 800));

let fails = 0;
const ok = (label, cond, got) => { if (!cond) { fails++; console.log(`  FAIL ${label}:`, got); } else console.log(`  ok   ${label}`); };
const norm = s => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const digits = s => (s || '').replace(/\D/g, '');

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, acceptDownloads: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error' && !/^Estimating resolution/.test(m.text())) errors.push(m.text()); });
page.on('dialog', d => d.accept(d.type() === 'prompt' ? 'Tech' : undefined));

await page.goto('http://localhost:8123/');
await page.waitForSelector('.empty');
await page.screenshot({ path: path.join(shots, '01-empty.png') });

let first = true;
for (const [id, e] of Object.entries(expected)) {
  console.log(`\n# ${id}`);
  await page.click('.fab');
  await page.waitForSelector('.sheet-wrap.open');
  if (first) await page.screenshot({ path: path.join(shots, '02-scan-sheet.png') });
  await page.setInputFiles('#pick-library', path.join(here, 'cards', id + '.jpg'));
  await page.waitForSelector('.editor');
  if (first) { await page.waitForSelector('.progress'); await page.screenshot({ path: path.join(shots, '03-reading.png') }); }
  const t0 = Date.now();
  await page.waitForSelector('[data-action="save"]:not([disabled])', { timeout: 120000 });
  console.log(`  read in ${Date.now() - t0} ms`);
  const v = await page.evaluate(() => ({
    name: document.querySelector('#f-name').value,
    title: document.querySelector('#f-title').value,
    company: document.querySelector('#f-company').value,
    website: document.querySelector('#f-website').value,
    address: document.querySelector('#f-address').value,
    phones: [...document.querySelectorAll('[data-phone]')].map(i => i.value),
    labels: [...document.querySelectorAll('[data-phone-label]')].map(i => i.value),
    emails: [...document.querySelectorAll('[data-email]')].map(i => i.value),
    status: document.querySelector('.status')?.textContent,
  }));
  console.log('  ', JSON.stringify(v));
  if (e.name) ok('name', norm(v.name).includes(norm(e.name)), v.name);
  if (e.title) ok('title', norm(v.title) === norm(e.title), v.title);
  if (e.company) ok('company', norm(v.company) === norm(e.company), v.company);
  for (const p of e.phones || []) ok(`phone ${p}`, v.phones.some(x => digits(x).endsWith(digits(p))), v.phones);
  for (const m of e.emails || []) ok(`email ${m}`, v.emails.includes(m), v.emails);
  if (e.website) ok('website', v.website === e.website, v.website);
  for (const a of e.address_has || []) ok(`address has ${a}`, v.address.includes(a), v.address);

  if (TAGS[id]) await page.click(`.editor .chip:has-text("${TAGS[id]}")`);
  if (id === 'tech') await page.click('[data-action="new-tag"]'); // prompt answers "Tech"
  if (first) { await page.screenshot({ path: path.join(shots, '04-editor.png'), fullPage: true }); first = false; }
  await page.click('[data-action="save"]');
  await page.waitForSelector('.detail');
  if (id === 'restaurant') await page.screenshot({ path: path.join(shots, '05-detail.png'), fullPage: true });
  await page.click('[data-action="back"]');
  await page.waitForSelector('.list .rows');
}

console.log('\n# list, search, filter');
await page.screenshot({ path: path.join(shots, '06-list.png') });
const count = async () => page.locator('#results .row').count();
ok('6 cards listed', (await count()) === 6, await count());
await page.fill('#q', 'skillet');
ok('search "skillet" -> 1', (await count()) === 1, await count());
await page.fill('#q', '555-0177');
ok('search phone digits -> dentist', (await count()) === 1 && (await page.textContent('#results')).includes('Priya'), await page.textContent('#results'));
await page.fill('#q', 'southern kitchen');
ok('search raw card text', (await count()) === 1, await count());
await page.fill('#q', '');
await page.click('.list .chip:has-text("Healthcare")');
ok('tag filter Healthcare -> 1', (await count()) === 1, await count());
await page.click('.list .chip:has-text("All")');
await page.click('[data-sort="tag"]');
await page.screenshot({ path: path.join(shots, '07-by-tag.png'), fullPage: true });
ok('by-tag sections', (await page.locator('.group h2').count()) >= 4, await page.locator('.group h2').allTextContents());

console.log('\n# persistence');
await page.reload();
await page.waitForSelector('.list .rows');
ok('cards survive reload', (await count()) === 6, await count());

console.log('\n# tap a detected line to place it, edit, save');
await page.click('.row:has-text("Theo Park")');
await page.waitForSelector('.detail');
await page.click('[data-action="edit"]');
await page.waitForSelector('.editor');
await page.click('.line:has-text("Creative Director")');
await page.click('[data-place="notes"]');
ok('line placed in notes', (await page.inputValue('#f-notes')).includes('Creative Director'), await page.inputValue('#f-notes'));
await page.click('[data-action="save"]');
await page.waitForSelector('.detail .notes');
ok('notes shown on detail', (await page.textContent('.notes')).includes('Creative Director'), '');

console.log('\n# add to contacts (vCard)');
await page.click('[data-action="back"]');
await page.click('.row:has-text("Marcus")');
await page.waitForSelector('.detail');
const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-action="contacts"]')]);
const vcf = fs.readFileSync(await dl.path(), 'utf8');
fs.writeFileSync(path.join(shots, dl.suggestedFilename()), vcf);
ok('vcard name', vcf.includes('N:Delgado;Marcus;;;') && vcf.includes('FN:Marcus Delgado'), vcf.slice(0, 200));
ok('vcard phones', vcf.includes('TEL;TYPE=CELL:(205) 555-0199') && vcf.includes('TEL;TYPE=WORK,VOICE:(205) 555-0142'), vcf);
ok('vcard org/email/url', vcf.includes('ORG:Crimson Oak Furniture Co.') && vcf.includes('EMAIL;TYPE=INTERNET,WORK:marcus@crimsonoakfurniture.com') && vcf.includes('URL:https://www.crimsonoakfurniture.com'), '');
ok('vcard photo', vcf.includes('PHOTO;ENCODING=b;TYPE=JPEG:'), '');
ok('tap-to-call link', (await page.getAttribute('.action:has-text("Call")', 'href')) === 'tel:+12055550142', await page.getAttribute('.action:has-text("Call")', 'href'));
ok('text goes to mobile', (await page.getAttribute('.action:has-text("Text")', 'href')) === 'sms:2055550199', await page.getAttribute('.action:has-text("Text")', 'href'));

console.log('\n# tags screen and backup');
await page.click('[data-action="back"]');
await page.click('[data-action="open-tags"]');
await page.waitForSelector('.tag-list');
await page.screenshot({ path: path.join(shots, '08-tags.png'), fullPage: true });
const [bk] = await Promise.all([page.waitForEvent('download'), page.click('[data-action="export"]')]);
const backup = JSON.parse(fs.readFileSync(await bk.path(), 'utf8'));
ok('backup has 6 cards with photos', backup.cards.length === 6 && backup.cards.every(c => c.photo && c.photo.b64.length > 1000), backup.cards.length);
// wipe and restore
await page.evaluate(() => new Promise(r => { const q = indexedDB.deleteDatabase('cardfile'); q.onsuccess = q.onerror = q.onblocked = r; }));
await page.goto('http://localhost:8123/#/');
await page.reload();
await page.waitForSelector('.empty');
await page.click('[data-action="open-tags"]');
await page.setInputFiles('#pick-backup', await bk.path());
await page.waitForFunction(() => document.querySelector('.backup .meta')?.textContent.startsWith('6'));
ok('restore brings back 6 cards', true, '');

ok('no page errors', errors.length === 0, errors);
await browser.close();
server.kill();
console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
process.exit(fails ? 1 : 0);
