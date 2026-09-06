#!/usr/bin/env node
/**
 * Generate static PNG previews of every resume template.
 *
 * Why this exists: social crawlers (Pinterest, Facebook, LinkedIn, Twitter)
 * don't execute JavaScript, so they can't see the template thumbnails we
 * render via <iframe> + renderTemplate() on /resume-templates/ pages. This
 * script runs the templates through headless Chromium once, saves each as
 * a real PNG file, and those PNGs become crawlable images the ad tools and
 * link-preview services can actually use.
 *
 * Setup (one time):
 *   npm i -D playwright
 *   npx playwright install chromium
 *
 * Run (from repo root):
 *   node scripts/generate-template-previews.mjs
 *
 * Output:
 *   img/templates/<template-id>.png   (816x1056, one per template)
 *
 * After running, commit the img/templates/ folder and update each template
 * landing page's og:image to point at the new PNG (or run
 * scripts/update-template-og-images.js if that helper exists).
 */

import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'img', 'templates');
const PORT = 4319;

// The 25 template ids from js/templates.js TEMPLATE_DEFS. Kept in sync manually;
// if you add a new template, add its id here.
const TEMPLATES = [
  'harvard', 'stanford', 'modern', 'minimal',
  'consulting', 'executive', 'professional', 'classic',
  'elegant', 'ivory', 'cascade',
  'jake', 'faang', 'deedy',
  'creative', 'slate', 'compact', 'timeline',
  'twocolumn', 'healthcare', 'sales', 'ats',
  'wharton', 'mit', 'googledocs'
];

// Minimal MIME sniffer for the tiny static server that serves the repo to
// Playwright. Only covers the file types preview-shot.html actually loads.
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpeg': 'image/jpeg', '.jpg': 'image/jpeg',
  '.png':  'image/png',
  '.ico':  'image/x-icon',
  '.svg':  'image/svg+xml'
};

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent(new URL(req.url, `http://localhost:${PORT}`).pathname);
      // Prevent directory traversal outside the repo root.
      const rel = urlPath.replace(/^\/+/, '');
      const full = path.resolve(ROOT, rel);
      if (!full.startsWith(ROOT)) { res.writeHead(403); return res.end('forbidden'); }
      fs.stat(full, (err, st) => {
        if (err || !st.isFile()) { res.writeHead(404); return res.end('not found'); }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream' });
        fs.createReadStream(full).pipe(res);
      });
    });
    server.listen(PORT, () => resolve(server));
  });
}

async function shoot(page, tplId) {
  const url = `http://localhost:${PORT}/preview-shot.html?tpl=${tplId}`;
  await page.goto(url, { waitUntil: 'load' });
  // Wait for the render function to signal readiness (or error out).
  await page.waitForFunction(() => window.__previewReady === true || window.__previewError, { timeout: 15000 });
  const errored = await page.evaluate(() => window.__previewError);
  if (errored) throw new Error(`render error for ${tplId}: ${errored}`);
  // Extra beat for iframe content to fully paint before capture.
  await page.waitForTimeout(400);
  const el = await page.$('#page');
  if (!el) throw new Error(`#page not found for ${tplId}`);
  const outPath = path.join(OUT_DIR, `${tplId}.png`);
  await el.screenshot({ path: outPath, omitBackground: false });
  const kb = (fs.statSync(outPath).size / 1024).toFixed(1);
  console.log(`  ✓ ${tplId.padEnd(14)} → ${path.relative(ROOT, outPath)}  (${kb} KB)`);
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log(`Starting local server on http://localhost:${PORT}`);
  const server = await startServer();
  console.log(`Launching headless Chromium`);
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 900, height: 1100 },
    deviceScaleFactor: 2, // retina PNGs so they look sharp on 1200x630 social cards
  });
  const page = await context.newPage();

  let ok = 0, fail = 0;
  for (const tpl of TEMPLATES) {
    try {
      await shoot(page, tpl);
      ok++;
    } catch (e) {
      console.error(`  ✗ ${tpl}: ${e.message}`);
      fail++;
    }
  }

  await browser.close();
  server.close();
  console.log(`\nDone. ${ok} succeeded, ${fail} failed. PNGs saved to ${path.relative(ROOT, OUT_DIR)}/`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
