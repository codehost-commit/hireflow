#!/usr/bin/env node
/**
 * Generate landing-page-quality screenshots of Applio's public pages.
 *
 * Why: social crawlers (Pinterest, LinkedIn, Facebook, Slack, Twitter)
 * don't execute JavaScript, so they can't see what the site actually looks
 * like. Every non-template page currently uses logo.jpeg as og:image. This
 * script produces real page screenshots that become both the og:image and
 * usable inline art for the "See it in action" section on the homepage.
 *
 * Setup (once):
 *   npm i -D playwright
 *   npx playwright install chromium
 *
 * Run (from repo root):
 *   npm run page-screenshots
 *
 * Output:
 *   img/screens/<slug>.png    (1200x800 hero-quality, retina 2x)
 */

import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'img', 'screens');
const PORT = 4321;

// Pages to screenshot. slug = output filename, path = url path on the local
// server, waitFor = optional selector to wait for before capture (for pages
// that render content via JS).
const PAGES = [
  { slug: 'home',         path: '/',                        waitFor: '.hero-title' },
  { slug: 'tools',        path: '/tools/',                  waitFor: '.tl-card' },
  { slug: 'ats-checker',  path: '/ats-checker',             waitFor: '.ac-hero' },
  { slug: 'examples',     path: '/resume-examples/',        waitFor: null },
  { slug: 'templates',    path: '/resume-templates/',       waitFor: '.th-card iframe' },
  { slug: 'guides',       path: '/guides/',                 waitFor: null },
  { slug: 'bullet-examples', path: '/tools/resume-bullet-examples', waitFor: '.bx-role-tab' },
];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpeg': 'image/jpeg', '.jpg': 'image/jpeg',
  '.png':  'image/png',
  '.ico':  'image/x-icon',
  '.svg':  'image/svg+xml',
  '.woff2': 'font/woff2', '.woff': 'font/woff'
};

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let urlPath = decodeURIComponent(new URL(req.url, `http://localhost:${PORT}`).pathname);
      // Directory index — try /index.html
      if (urlPath.endsWith('/')) urlPath += 'index.html';
      // Extensionless URL — try appending .html (GitHub Pages behavior)
      const rel = urlPath.replace(/^\/+/, '');
      const full = path.resolve(ROOT, rel);
      if (!full.startsWith(ROOT)) { res.writeHead(403); return res.end('forbidden'); }

      const tryFile = (p) => fs.promises.stat(p).then(st => st.isFile() ? p : null).catch(() => null);
      (async () => {
        let f = await tryFile(full);
        if (!f && !path.extname(full)) f = await tryFile(full + '.html');
        if (!f) { res.writeHead(404); return res.end('not found'); }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
        fs.createReadStream(f).pipe(res);
      })();
    });
    server.listen(PORT, () => resolve(server));
  });
}

async function shoot(page, spec) {
  const url = `http://localhost:${PORT}${spec.path}`;
  await page.goto(url, { waitUntil: 'networkidle', timeout: 15000 }).catch(() => page.goto(url, { waitUntil: 'domcontentloaded' }));
  if (spec.waitFor) {
    await page.waitForSelector(spec.waitFor, { timeout: 8000 }).catch(() => {});
  }
  await page.waitForTimeout(500); // let animations settle
  const outPath = path.join(OUT_DIR, `${spec.slug}.png`);
  await page.screenshot({ path: outPath, fullPage: false, clip: { x: 0, y: 0, width: 1200, height: 800 } });
  const kb = (fs.statSync(outPath).size / 1024).toFixed(1);
  console.log(`  ✓ ${spec.slug.padEnd(18)} → ${path.relative(ROOT, outPath)}  (${kb} KB)`);
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log(`Starting local server on http://localhost:${PORT}`);
  const server = await startServer();
  console.log(`Launching headless Chromium`);
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1200, height: 800 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();

  let ok = 0, fail = 0;
  for (const spec of PAGES) {
    try { await shoot(page, spec); ok++; }
    catch (e) { console.error(`  ✗ ${spec.slug}: ${e.message}`); fail++; }
  }

  await browser.close();
  server.close();
  console.log(`\nDone. ${ok} succeeded, ${fail} failed. PNGs in ${path.relative(ROOT, OUT_DIR)}/`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
