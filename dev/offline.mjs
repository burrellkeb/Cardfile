// Check the app opens and scans with no network after the first visit.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const server = spawn('python3', ['-m', 'http.server', '8124', '-d', path.join(here, '..', 'app')], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 800));
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const page = await ctx.newPage();

async function scan(file) {
  await page.click('.fab');
  await page.setInputFiles('#pick-library', path.join(here, 'cards', file));
  await page.waitForSelector('[data-action="save"]:not([disabled])', { timeout: 120000 });
  const name = await page.inputValue('#f-name');
  await page.click('[data-action="cancel-edit"]');
  return name;
}

await page.goto('http://localhost:8124/');
await page.waitForFunction(() => navigator.serviceWorker.controller || new Promise(r => navigator.serviceWorker.addEventListener('controllerchange', () => r(true))), null, { timeout: 15000 }).catch(() => {});
await page.reload(); // now controlled by the service worker
console.log('online scan:', await scan('tech.jpg'));
server.kill();
await ctx.setOffline(true);
await page.reload();
await page.waitForSelector('.fab');
console.log('offline reload ok');
console.log('offline scan:', await scan('dark.jpg'));
await browser.close();
