// Test harness: a fake instagram.com served by page.route, the engine injected the way the
// app injects it, and a paused fake clock so every engine delay is advanced explicitly.
import { test as base, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ENGINE_PATH = fileURLToPath(new URL('../Friction/Resources/friction.js', import.meta.url));
const SHIM_PATH = fileURLToPath(new URL('./fixture/media-shim.js', import.meta.url));
const FIXTURE_HTML = readFileSync(new URL('./fixture/instagram.html', import.meta.url), 'utf8');
const ORIGIN = 'https://www.instagram.com';

// A few seconds of silent 8 kHz mono WAV, generated so no binary lives in the repo.
// (The media shim means playback never depends on it; it just gives <video> a real local src.)
function silentWav(seconds = 5, rate = 8000) {
  const n = seconds * rate, b = Buffer.alloc(44 + n);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n, 4); b.write('WAVE', 8);
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate, 28); b.writeUInt16LE(1, 32); b.writeUInt16LE(8, 34);
  b.write('data', 36); b.writeUInt32LE(n, 40); b.fill(128, 44);
  return b;
}
const WAV = silentWav();

const realSleep = (ms) => new Promise((r) => setTimeout(r, ms)); // Node-side, not the fake clock

// Runs in the page before the engine: picks a __fr_id whose experiment day is `want`
// ('on' | 'off') for the page's *today*, using the same hash as the engine. No hard-coded date.
function seedExperimentId(want) {
  const d = new Date();
  const day = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const fnv = (str) => { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
  for (let i = 0; i < 1000; i++) {
    const id = 'test' + i;
    if ((fnv(id + '|' + day) % 2 ? 'on' : 'off') === want) { localStorage.setItem('__fr_id', id); return; }
  }
}

export class FakeInstagram {
  constructor(page) {
    this.page = page;
    this.requests = []; // API requests that reached the "network": { name, path, method }
  }

  /**
   * Open a fake Instagram page.
   * @param {string} path            e.g. '/reels/', '/', '/direct/inbox/'
   * @param {object} [opts]
   * @param {object} [opts.config]   window.__FRICTION_CONFIG__ (engine defaults otherwise)
   * @param {'on'|'off'} [opts.experimentDay]  seed __fr_id so today is that kind of day
   */
  async open(path, { config = {}, experimentDay } = {}) {
    const { page } = this;
    await page.route('**/*', (route) => {
      const req = route.request();
      const url = new URL(req.url());
      if (url.origin !== ORIGIN) return route.abort(); // no external network, ever
      if (url.pathname.startsWith('/__fixture/media/')) {
        return route.fulfill({ status: 200, contentType: 'audio/wav', body: WAV });
      }
      if (url.pathname.startsWith('/graphql/') || url.pathname.startsWith('/api/')) {
        this.requests.push({ name: req.headers()['x-fb-friendly-name'] || '', path: url.pathname, method: req.method() });
        return route.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"ok"}' });
      }
      return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: FIXTURE_HTML });
    });

    // Fake timers first, so the engine's setTimeout/setInterval/Date are the fake ones.
    // Paused: nothing the engine schedules fires until a test calls runFor().
    const t0 = Date.now();
    await page.clock.install({ time: t0 });
    await page.clock.pauseAt(t0 + 1000);

    // Record whether <html> existed when injection ran (in Playwright's WebKit it does not).
    await page.addInitScript(() => { window.__rootAtInject = !!document.documentElement; });
    await page.addInitScript({ path: SHIM_PATH });
    if (experimentDay) await page.addInitScript(seedExperimentId, experimentDay);
    // Same order as the app: FrictionSettings.configScript(), then friction.js.
    await page.addInitScript({ content: `window.__FRICTION_CONFIG__ = ${JSON.stringify(config)};` });
    await page.addInitScript({ path: ENGINE_PATH });

    await page.goto(ORIGIN + path);
    await expect.poll(() => page.evaluate(() => !!window.__friction && !!window.fx)).toBe(true);
  }

  runFor(ms) { return this.page.clock.runFor(ms); }

  // ---- page state
  videoSurfaceAttr() { return this.page.evaluate(() => document.documentElement.hasAttribute('data-fr-v')); }
  opacity(id) { return this.page.evaluate((id) => getComputedStyle(document.getElementById(id)).opacity, id); }
  released(id) { return this.page.evaluate((id) => document.getElementById(id).hasAttribute('data-fr-ok'), id); }
  status() { return this.page.evaluate(() => window.__friction.status()); }
  T() { return this.page.evaluate(() => JSON.parse(JSON.stringify(window.__friction.T))); }
  rootFilter() { return this.page.evaluate(() => document.documentElement.style.filter); }

  /** Engine overlays currently in the DOM: [{ background, display }] */
  overlays() {
    return this.page.evaluate(() => [...document.querySelectorAll('body > div')]
      .filter((d) => d.style.zIndex === '2147483646')
      .map((d) => ({ background: d.style.background || d.style.backgroundColor, display: d.style.display })));
  }

  // ---- media
  play(id) { return this.page.evaluate((id) => window.fx.play(id), id); }
  playState(id) { return this.page.evaluate((id) => window.fx.playState(id), id); }
  /** How many times the play() call reached the browser's media layer (the shim). */
  mediaPlays(id) { return this.page.evaluate((id) => window.__media.plays(id), id); }
  mediaPauses(id) { return this.page.evaluate((id) => window.__media.pauses(id), id); }
  video(id) {
    return this.page.evaluate((id) => {
      const v = document.getElementById(id);
      return { paused: v.paused, playbackRate: v.playbackRate };
    }, id);
  }

  /**
   * Steps the fake clock until `id` is released (data-fr-ok). Returns the hold in fake ms.
   * Small steps so the moment of release is observed before anything else (a stall can't
   * start until >= 2.5 s after release).
   */
  async runUntilReleased(id, { step = 50, max = 10_000 } = {}) {
    for (let t = 0; t <= max; t += step) {
      if (await this.released(id)) return t;
      await this.runFor(step);
    }
    throw new Error(`${id} not released within ${max} ms of fake time`);
  }

  // ---- network
  fetchNamed(name, url) { return this.page.evaluate(([n, u]) => window.fx.fetchNamed(n, u), [name, url]); }
  xhrNamed(name, url) { return this.page.evaluate(([n, u]) => window.fx.xhrNamed(n, u), [name, url]); }
  fetchUrl(url) { return this.page.evaluate((u) => window.fx.fetchUrl(u), url); }
  xhrUrl(url) { return this.page.evaluate((u) => window.fx.xhrUrl(u), url); }
  hits(key) { return this.requests.filter((r) => r.name === key || r.path === key).length; }
  /** Wait (real time) until `key` reached the network. With the clock paused, that means "not delayed". */
  async expectArrives(key, n = 1) {
    await expect.poll(() => this.hits(key), { message: `${key} should reach the network`, timeout: 5000 }).toBe(n);
  }
  /**
   * Assert `key` is being held while `control` (sent at the same time, never delayed) gets
   * through. Then a little extra real time to make sure it isn't merely slower.
   */
  async expectHeld(key, control) {
    await this.expectArrives(control);
    await realSleep(250);
    expect(this.hits(key), `${key} should be held back`).toBe(0);
  }
}

export const test = base.extend({
  // Every test fails on any uncaught page error (a friction bug must never break the page).
  pageErrors: [async ({ page }, use) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e && e.stack || e)));
    await use(errors);
    expect(errors, 'uncaught errors in the page').toEqual([]);
  }, { auto: true }],
  ig: async ({ page }, use) => { await use(new FakeInstagram(page)); },
});

export { expect };
