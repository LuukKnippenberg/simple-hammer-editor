// Shared helpers for scripted runs: launch the system browser headless with GPU, drive the editor.
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const shotsDir = join(root, 'docs', 'screenshots');
mkdirSync(shotsDir, { recursive: true });
/** The dev server: EDITOR_URL, else the port vite.config.ts reads from SHE_PORT. */
export const baseUrl = process.env.EDITOR_URL ?? `http://localhost:${process.env.SHE_PORT ?? 5190}/`;

export async function launch() {
  const executablePath = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  ].find((p) => existsSync(p));
  return chromium.launch({
    executablePath,
    headless: true,
    // SwiftShader is the software WebGL fallback when the GPU can't be used (screenshot.mjs always passed it).
    args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'],
  });
}

/**
 * Runs `fn(d, page)` on a new 1600×900 editor page, then closes the browser (also when `fn` throws).
 * Page errors are logged and dialogs accepted. `fn` opens the map itself (`await d.open('repo:x.vmf')`), so it can
 * add page listeners or a viewport size before the editor loads.
 */
export async function withEditor(fn) {
  const browser = await launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    page.on('pageerror', (error) => console.log('  [pageerror]', error.message));
    page.on('dialog', (dialog) => dialog.accept());
    return await fn(driver(page), page);
  } finally {
    await browser.close();
  }
}

/** Wraps a page with editor-aware helpers. */
export function driver(page) {
  const d = {
    page,
    async open(map) {
      const url = new URL(baseUrl);
      // Without a map the editor would wait on the start screen: skip it, which opens the first map in maps/.
      url.searchParams.set(...(map ? ['map', map] : ['start', 'skip']));
      await page.goto(url.toString());
      await page.waitForFunction(() => window.__editor?.ready, null, { timeout: 120000 });
      await d.settle();
    },
    async settle(ms = 600) {
      await page.waitForFunction(() => !window.__editor.busy(), null, { timeout: 120000 }).catch(() => {});
      await page.waitForTimeout(ms);
    },
    view(pos, target) {
      return page.evaluate(([p, t]) => window.__editor.setView(p, t), [pos, target]);
    },
    project(p) {
      return page.evaluate((p) => window.__editor.project(p), p);
    },
    async click(p, opts = {}) {
      const [x, y] = await d.project(p);
      if (opts.shift) await page.keyboard.down('Shift');
      if (opts.ctrl) await page.keyboard.down('Control');
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.up();
      if (opts.shift) await page.keyboard.up('Shift');
      if (opts.ctrl) await page.keyboard.up('Control');
      await page.waitForTimeout(120);
    },
    /** Drags between two world points (or screen points if `screen` is set). */
    async drag(a, b, { steps = 12, screen = false, hold } = {}) {
      const [ax, ay] = screen ? a : await d.project(a);
      const [bx, by] = screen ? b : await d.project(b);
      await page.mouse.move(ax, ay);
      await page.waitForTimeout(60);
      await page.mouse.move(ax + 1, ay + 1);
      await page.waitForTimeout(60);
      await page.mouse.down();
      for (let i = 1; i <= steps; i++) {
        await page.mouse.move(ax + ((bx - ax) * i) / steps, ay + ((by - ay) * i) / steps);
        await page.waitForTimeout(16);
      }
      if (hold) await hold();
      await page.mouse.up();
      await page.waitForTimeout(150);
    },
    async key(k) {
      await page.keyboard.press(k);
      await page.waitForTimeout(80);
    },
    async shot(name) {
      await page.waitForTimeout(250);
      const file = join(shotsDir, `${name}.png`);
      await page.screenshot({ path: file });
      const f = await page.evaluate(() => window.__editor.editor.frame);
      console.log(`saved ${name}.png  (fps ${f.fps}, draw calls ${f.drawCalls}, tris ${f.triangles})`);
    },
    eval(fn, arg) {
      return page.evaluate(fn, arg);
    },
  };
  return d;
}
