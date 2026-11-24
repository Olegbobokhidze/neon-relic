#!/usr/bin/env node
/**
 * Regenerates the link-preview card and app icons from the running game.
 *
 *   pnpm dev                 # in another terminal
 *   pnpm share:assets        # writes public/og-image.jpg + PNG icons
 *
 * Env: BASE_URL (defaults to the dev URL in share-card.json), CHROME_PATH.
 * Card copy, palette, fonts and the screenshot crop live in scripts/share-card.json.
 *
 * Output sizes follow what the big unfurlers expect: a 1200×630 JPEG (1.91:1, well under
 * WhatsApp's ~300 kB comfort zone), a 180px opaque apple-touch icon, 192/512 manifest icons
 * and a 512px maskable icon with a safe-zone pad.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

/* global document -- evaluated inside the browser page */

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const cfg = JSON.parse(await readFile(path.join(here, 'share-card.json'), 'utf8'));
const publicDir = path.resolve(root, cfg.publicDir);
const BASE_URL = process.env.BASE_URL ?? cfg.devUrl;
const CHROME_PATH = process.env.CHROME_PATH ?? '/usr/bin/google-chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const browser = await puppeteer.launch({
  executablePath: CHROME_PATH,
  args: ['--use-angle=gl', '--enable-gpu', '--ignore-gpu-blocklist', '--hide-scrollbars'],
});

try {
  const page = await browser.newPage();

  // 1. Screenshot the live game in its default desktop state.
  const { viewport, dpr, query, waitMs } = cfg.shot;
  await page.setViewport({ width: viewport[0], height: viewport[1], deviceScaleFactor: dpr });
  const url = new URL(query ?? '', BASE_URL).href;
  const res = await page.goto(url, { waitUntil: 'networkidle0', timeout: 30_000 }).catch(() => null);
  if (!res?.ok()) throw new Error(`Could not load ${url}. Is \`pnpm dev\` running?`);
  await page.evaluate(() => document.fonts.ready);
  await sleep(waitMs ?? 2500);
  const shot = await page.screenshot({ type: 'png', encoding: 'base64' });

  // 2. Compose the 1200×630 card around a crop of that screenshot.
  const favicon = await readFile(path.join(publicDir, 'favicon.svg'), 'utf8');
  const faviconUri = `data:image/svg+xml;base64,${Buffer.from(favicon).toString('base64')}`;
  await page.close();
  const card = await browser.newPage();
  await card.setViewport({ width: 1200, height: 630, deviceScaleFactor: 1 });
  await card.setContent(cardHtml(cfg.card, shot, faviconUri, viewport), { waitUntil: 'load', timeout: 30_000 });
  await card.evaluate(() => document.fonts.ready);
  await sleep(300);
  const og = path.join(publicDir, 'og-image.jpg');
  await card.screenshot({ path: og, type: 'jpeg', quality: 88 });
  console.log(`✓ ${path.relative(root, og)}`);

  // 3. Raster icons from the vector favicon.
  const icons = [
    { file: 'apple-touch-icon.png', size: 180, bg: cfg.icon.bg, pad: cfg.icon.applePad ?? 0 },
    { file: 'icon-192.png', size: 192, bg: null, pad: 0 },
    { file: 'icon-512.png', size: 512, bg: null, pad: 0 },
    { file: 'icon-maskable-512.png', size: 512, bg: cfg.icon.bg, pad: 0.18 },
  ];
  for (const icon of icons) {
    const inset = Math.round(icon.size * icon.pad);
    await card.setViewport({ width: icon.size, height: icon.size, deviceScaleFactor: 1 });
    await card.setContent(
      `<body style="margin:0;width:${icon.size}px;height:${icon.size}px;background:${icon.bg ?? 'transparent'}">` +
        `<img src="${faviconUri}" style="position:absolute;left:${inset}px;top:${inset}px;` +
        `width:${icon.size - inset * 2}px;height:${icon.size - inset * 2}px"></body>`,
      { waitUntil: 'load' },
    );
    const out = path.join(publicDir, icon.file);
    await card.screenshot({ path: out, type: 'png', omitBackground: icon.bg === null });
    console.log(`✓ ${path.relative(root, out)}`);
  }
} finally {
  await browser.close();
}

function cardHtml(c, shotB64, faviconUri, [vw, vh]) {
  // The crop is given in CSS pixels of the screenshot viewport.
  const W = c.panelWidth;
  const H = 630;
  const { x, y, w, h } = c.crop;
  const scale = c.fit === 'width' ? W / w : Math.max(W / w, H / h);
  const bx = W / 2 - (x + w / 2) * scale;
  const by = H / 2 - (y + h / 2) * scale;
  const fadeY = c.fadeY ?? 0;
  const vfade = fadeY
    ? `,linear-gradient(180deg,${c.bg} 0,transparent ${fadeY}px,transparent ${H - fadeY}px,${c.bg} ${H}px)`
    : '';
  return `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="${c.fontsHref}">
<style>
*{box-sizing:border-box}html,body{margin:0}
body{width:1200px;height:630px;overflow:hidden;position:relative;background:${c.bg};color:${c.ink};
  font-family:${c.bodyFont};-webkit-font-smoothing:antialiased;font-variant-numeric:tabular-nums}
.backdrop{position:absolute;inset:0;background:${c.backdrop ?? 'none'}}
.panel{position:absolute;top:0;right:0;width:${W}px;height:${H}px;
  background:url(data:image/png;base64,${shotB64}) no-repeat;
  background-size:${vw * scale}px ${vh * scale}px;background-position:${bx}px ${by}px;
  ${c.clip ? `clip-path:inset(${c.clip[0]}px 0 ${c.clip[1]}px 0);` : ''}}
.panel::after{content:'';position:absolute;inset:0;
  background:linear-gradient(90deg,${c.bg} 0,transparent ${c.fadeX ?? 220}px)${vfade}}
${c.frame ? `.frame{position:absolute;inset:24px;border:1px solid ${c.frame};border-radius:4px;pointer-events:none}` : ''}
.copy{position:absolute;left:72px;top:56px;bottom:96px;width:${c.copyWidth ?? 520}px;
  display:flex;flex-direction:column;justify-content:center}
.eyebrow{display:flex;align-items:center;gap:12px;font-weight:600;font-size:14px;line-height:20px;
  letter-spacing:.22em;text-transform:uppercase;color:${c.accent}}
.eyebrow img{width:32px;height:32px;flex:none}
h1{margin:20px 0 0;font-family:${c.displayFont};font-size:${c.titleSize}px;line-height:${c.titleLineHeight}px;
  font-weight:${c.titleWeight ?? 400};letter-spacing:${c.titleTracking ?? 0};color:${c.titleColor ?? c.ink};
  ${c.titleShadow ? `text-shadow:${c.titleShadow};` : ''}${c.titleVariant ? `font-variant:${c.titleVariant};` : ''}}
.sub{margin:8px 0 0;font-family:${c.subFont ?? c.displayFont};font-style:${c.subStyle ?? 'normal'};
  font-size:28px;line-height:32px;color:${c.accent}}
.tag{margin:20px 0 0;font-size:22px;line-height:32px;color:${c.muted}}
ul{margin:24px 0 0;padding:0;list-style:none;display:grid;gap:12px}
li{display:flex;align-items:center;gap:14px;font-size:18px;line-height:24px;color:${c.ink}}
li::before{content:'';flex:none;width:7px;height:7px;background:${c.accent};transform:rotate(45deg)}
.by{position:absolute;left:72px;bottom:48px;font-size:14px;line-height:20px;letter-spacing:.18em;
  text-transform:uppercase;color:${c.muted}}
.by b{font-weight:600;color:${c.ink}}
</style></head><body>
<div class="backdrop"></div><div class="panel"></div>${c.frame ? '<div class="frame"></div>' : ''}
<div class="copy">
  <div class="eyebrow"><img src="${faviconUri}" alt="">${esc(c.eyebrow)}</div>
  <h1>${esc(c.title)}</h1>
  ${c.subtitle ? `<p class="sub">${esc(c.subtitle)}</p>` : ''}
  <p class="tag">${esc(c.tagline)}</p>
  <ul>${c.features.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>
</div>
<div class="by">Designed &amp; built by <b>${esc(c.author)}</b></div>
</body></html>`;
}
