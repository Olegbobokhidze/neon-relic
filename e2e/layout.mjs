// Responsive layout check: HUD controls must not overlap or overflow at common viewports.
// Env: BASE_URL (default http://localhost:5173/), CHROME_PATH.
import { mkdirSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
const BASE = process.env.BASE_URL ?? 'http://localhost:5173/';
const out = new URL('./screenshots/', import.meta.url).pathname;
mkdirSync(out, { recursive: true });
let failed = 0;
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--use-angle=gl', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
const overlaps = () => page.evaluate(() => {
  const els = [...document.querySelectorAll('.hud .stepper, .hud .toggle-btn, .hud .spin-btn, .hud .meter__value')];
  const bad = [];
  for (let i = 0; i < els.length; i++) for (let j = i + 1; j < els.length; j++) {
    const a = els[i].getBoundingClientRect(), b = els[j].getBoundingClientRect();
    if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) bad.push(`${els[i].className} × ${els[j].className}`);
  }
  const offscreen = els.filter(e => { const r = e.getBoundingClientRect(); return r.right > innerWidth || r.bottom > innerHeight || r.left < 0; }).map(e => e.className);
  const docOverflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
  return { bad, offscreen, docOverflow, vw: innerWidth };
});
for (const [name, vp] of [['portrait-390', { width: 390, height: 844 }], ['portrait-360', { width: 360, height: 740 }], ['portrait-320', { width: 320, height: 640 }], ['landscape-844', { width: 844, height: 390 }], ['tablet-820', { width: 820, height: 1180 }], ['desktop-1280', { width: 1280, height: 720 }]]) {
  await page.setViewport({ ...vp, deviceScaleFactor: 2, isMobile: name !== 'desktop-1280', hasTouch: name !== 'desktop-1280' });
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('.reel-canvas canvas'); await new Promise(r => setTimeout(r, 900));
  const r = await overlaps();
  const ok = r.bad.length === 0 && r.offscreen.length === 0 && r.docOverflow === 0;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${JSON.stringify(r)}`);
  await page.screenshot({ path: `${out}/layout-${name}.png` });
}
await browser.close();
process.exit(failed ? 1 : 0);
