// Headless E2E smoke test: drives the real app through spins, forced scenarios, errors,
// a config swap, perf sampling and responsive layouts. Screenshots land in e2e/screenshots/.
//
//   pnpm dev                       # in one terminal (http://localhost:5173)
//   pnpm e2e                       # in another
//
// Env: BASE_URL (default http://localhost:5173/), CHROME_PATH (default /usr/bin/google-chrome),
//      E2E_GPU=0 to force software rendering (skips the FPS assertion).
import { mkdirSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const BASE = process.env.BASE_URL ?? 'http://localhost:5173/';
const OUT = new URL('./screenshots/', import.meta.url).pathname;
const GPU = process.env.E2E_GPU !== '0';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome',
  headless: true,
  args: [
    '--no-sandbox',
    '--autoplay-policy=no-user-gesture-required',
    ...(GPU ? ['--use-angle=gl', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']),
  ],
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
await page.goto(`${BASE}?inspector=1&seed=7`, { waitUntil: 'networkidle0' });
await page.waitForSelector('.reel-canvas canvas', { timeout: 15000 });
await sleep(1200);

const activeState = () => page.$eval('.state-pill.is-active', (el) => el.textContent);
const balance = () => page.$eval('.hud__meter--balance .meter__value', (el) => el.textContent);
const waitIdle = async (ms = 15000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if ((await activeState()) === 'IDLE') return true;
    await sleep(100);
  }
  return false;
};
const setScenario = async (value) => {
  const selects = await page.$$('.inspector select');
  // second select in the inspector = forced scenario
  await selects[1].select(value);
  await page.click('.stage'); // move focus off the <select> so Space reaches the game
};

check('canvas mounted', !!(await page.$('.reel-canvas canvas')));
check('initial state IDLE', (await activeState()) === 'IDLE');
await page.screenshot({ path: `${OUT}/01-idle-desktop.png` });

// 1. Normal spin via Space; spam Space to prove no double spin.
const b0 = await balance();
await page.click('.stage');
await page.keyboard.press('Space');
await sleep(60);
const s1 = await activeState();
for (let i = 0; i < 6; i++) await page.keyboard.press('Space');
check('spin leaves IDLE', s1 !== 'IDLE', s1);
await sleep(300);
await page.screenshot({ path: `${OUT}/02-spinning.png` });
check('round completes back to IDLE', await waitIdle());
const log = await page.$$eval('.log tbody tr', (rows) => rows.map((r) => ({ rejected: r.classList.contains('is-rejected'), text: r.textContent })));
const spinsRequested = log.filter((r) => !r.rejected && r.text.includes('SPIN_PRESSED')).length;
check('exactly one accepted SPIN_PRESSED despite spamming', spinsRequested === 1, `accepted=${spinsRequested}, rejected=${log.filter((r) => r.rejected).length}`);
check('balance changed after spin', (await balance()) !== b0, `${b0} → ${await balance()}`);

// 2. Forced big win.
await setScenario('bigWin');
await page.keyboard.press('Space');
await sleep(2600);
await page.screenshot({ path: `${OUT}/03-big-win.png` });
check('big win reaches WIN_PRESENTATION', ['WIN_PRESENTATION', 'IDLE'].includes(await activeState()), await activeState());
await page.keyboard.press('Space'); // skip presentation
check('big win completes', await waitIdle(12000));

// 3. Forced free spins → BONUS_OR_FREE_SPINS → back to IDLE.
await setScenario('freeSpins');
await page.keyboard.press('Space');
let sawBonus = false;
let sawBanner = false;
const t0 = Date.now();
while (Date.now() - t0 < 6000) {
  const st = await activeState();
  if (st === 'BONUS_OR_FREE_SPINS') sawBonus = true;
  if (await page.$('.banner')) {
    if (!sawBanner) await page.screenshot({ path: `${OUT}/04-free-spins-banner.png` });
    sawBanner = true;
  }
  if (sawBonus && sawBanner) break;
  await sleep(100);
}
check('free spins enter BONUS_OR_FREE_SPINS', sawBonus);
check('free spins banner shown', sawBanner);
// turbo to speed through the feature
await page.click('button[aria-label="Turbo spin"]');
check('feature plays out to IDLE', await waitIdle(90000));

// 4. Forced network error → ERROR_RECOVERABLE → recover.
await setScenario('networkError');
const bErr = await balance();
await page.keyboard.press('Space');
await page.waitForSelector('.modal', { timeout: 5000 }).catch(() => null);
check('network error opens error dialog', !!(await page.$('.modal')));
check('state is ERROR_RECOVERABLE', (await activeState()) === 'ERROR_RECOVERABLE');
check('stake refunded on error', (await balance()) === bErr, `${bErr} vs ${await balance()}`);
await page.screenshot({ path: `${OUT}/05-error.png` });
const actionsAlign = await page.$eval('.modal__actions', (el) => getComputedStyle(el).justifyContent);
check('modal actions right-aligned', actionsAlign === 'flex-end', actionsAlign);
await page.click('.modal .btn--primary');
check('recover returns to IDLE', await waitIdle(3000));

// 5. Corrupt payload → VALIDATION.
await setScenario('corruptPayload');
await page.keyboard.press('Space');
await page.waitForSelector('.modal', { timeout: 8000 }).catch(() => null);
const code = await page.$eval('.modal__code', (el) => el.textContent).catch(() => null);
check('corrupt payload caught by client cross-check', code === 'VALIDATION', String(code));
await page.click('.modal .btn--primary').catch(() => null);
await waitIdle(3000);

// 6. Config switch → crystal-ways 5×4.
const selects = await page.$$('.inspector select');
await selects[0].select('crystal-ways');
await page.click('.stage');
await sleep(800);
const title = await page.$eval('.brand__title', (el) => el.textContent);
check('config switch updates title', title === 'Crystal Ways', title);
await page.keyboard.press('Space');
check('crystal-ways round completes', await waitIdle(15000));
await page.screenshot({ path: `${OUT}/06-crystal-ways.png` });

// 7. FPS reading during a spin (turbo off for a longer spin).
await page.click('button[aria-label="Turbo spin"]');
await page.click('.stage');
await page.keyboard.press('Space');
await sleep(1100);
const fps = await page.$eval('.perf__fps', (el) => parseFloat(el.textContent));
const perfText = await page.$eval('.perf__stats', (el) => el.innerText.replace(/\s+/g, ' '));
if (GPU) check('FPS during spin >= 50', fps >= 50, `${fps} fps · ${perfText}`);
else console.log(`SKIP  FPS assertion (software rendering): ${fps} fps`);
await waitIdle();

// 8. Mobile portrait + landscape layouts.
// Note: toggling isMobile reloads the page (with ?inspector=1), so close the inspector after load.
const closeInspector = async () => {
  await page.waitForSelector('.reel-canvas canvas');
  await sleep(600);
  await page.click('.inspector .drawer__footer .btn--primary').catch(() => null);
  await sleep(500);
};
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await closeInspector();
await page.screenshot({ path: `${OUT}/07-mobile-portrait.png` });
const overflowP = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
check('portrait: no horizontal overflow', !overflowP);
await page.setViewport({ width: 844, height: 390, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await sleep(1000);
await page.screenshot({ path: `${OUT}/08-mobile-landscape.png` });
const spinVisible = await page.$eval('.spin-btn', (el) => {
  const r = el.getBoundingClientRect();
  return r.bottom <= window.innerHeight && r.right <= window.innerWidth && r.width > 0;
});
check('landscape: spin button fully visible', spinVisible);

// 9. Paytable drawer.
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
await sleep(400);
await page.click('button[aria-label="Paytable and rules"]');
await sleep(500);
await page.screenshot({ path: `${OUT}/09-paytable.png` });
const footerAlign = await page.$eval('.paytable .drawer__footer', (el) => getComputedStyle(el).justifyContent);
check('drawer footer right-aligned', footerAlign === 'flex-end', footerAlign);

check('no renderer error banner', !(await page.$('.reel-canvas__error')));
check('no uncaught page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
