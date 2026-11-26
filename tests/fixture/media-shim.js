// Injected BEFORE the engine. Stands in for the browser's native media playback so the tests
// don't depend on codecs: Playwright's WebKit on Windows has no media backend at all (every
// source fails with MEDIA_ERR_SRC_NOT_SUPPORTED), and Linux builds vary.
//
// It replaces HTMLMediaElement.prototype.play / pause / paused with a minimal model:
// play() resolves, flips paused to false and fires 'play' + 'playing'; pause() fires 'pause'.
// The engine then wraps these exactly as it wraps the native ones, so what we observe is the
// engine's real logic. Every call that reaches this layer (= "the browser actually started
// playing") is logged in window.__media.log for the tests.
//
// What this leaves UNVERIFIED (checked on-device only): that real WebKit video freezes on
// playbackRate = 0 without firing 'pause', and native play() promise/rejection semantics.
(() => {
  const MP = HTMLMediaElement.prototype;
  const paused = new WeakMap();
  const log = [];
  const idOf = (el) => el.id || '?';
  window.__media = {
    log,
    plays: (id) => log.filter((e) => e.op === 'play' && e.id === id).length,
    pauses: (id) => log.filter((e) => e.op === 'pause' && e.id === id).length,
    rates: (id) => log.filter((e) => e.op === 'rate' && e.id === id).map(({ v, t }) => ({ v, t })),
  };
  Object.defineProperty(MP, 'paused', {
    configurable: true,
    get() { return paused.has(this) ? paused.get(this) : true; },
  });
  // playbackRate stays native (so a rejected value would still fall back to pause in the
  // engine); writes are logged with the fake-clock time.
  const rate = Object.getOwnPropertyDescriptor(MP, 'playbackRate');
  if (rate && rate.set) {
    Object.defineProperty(MP, 'playbackRate', {
      configurable: true,
      get() { return rate.get.call(this); },
      set(v) { rate.set.call(this, v); log.push({ op: 'rate', id: idOf(this), v: rate.get.call(this), t: Date.now() }); },
    });
  }
  MP.play = function () {
    log.push({ op: 'play', id: idOf(this), t: Date.now() });
    const was = this.paused;
    paused.set(this, false);
    // Native media events are async; a microtask keeps that without depending on timers
    // (which the tests fake with page.clock).
    if (was) queueMicrotask(() => { this.dispatchEvent(new Event('play')); this.dispatchEvent(new Event('playing')); });
    return Promise.resolve();
  };
  MP.pause = function () {
    log.push({ op: 'pause', id: idOf(this), t: Date.now() });
    const was = this.paused;
    paused.set(this, true);
    if (!was) queueMicrotask(() => this.dispatchEvent(new Event('pause')));
  };
})();
