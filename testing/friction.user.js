// ==UserScript==
// @name         Friction (desktop test)
// @namespace    friction
// @version      0.1
// @description  Test copy of Friction/Resources/friction.js for desktop Chrome. Regenerate if the engine changes.
// @match        https://www.instagram.com/*
// @run-at       document-start
// @inject-into  page
// @grant        none
// ==/UserScript==

// Change intensity here: 0 off, 0.6 light, 1.0 normal, 1.6 strong.
window.__FRICTION_CONFIG__ = { intensity: 1.0, debug: true };

// Friction engine — injected at document start into instagram.com.
// Goal: make the compulsive surfaces (Reels, Explore, home feed) feel a little
// worse over a session, in ways that read as "bad wifi / clunky app", never as a nag.
// Every hook is wrapped so a failure here can never break Instagram itself.
(() => {
  if (window.__friction) return;
  const CFG = Object.assign({ intensity: 1.0, debug: false, experiment: false }, window.__FRICTION_CONFIG__ || {});
  window.__friction = { cfg: CFG };
  const now = () => Date.now();

  // ------------------------------------------------------ experiment mode
  // With experiment: true, each calendar day is randomly ON or OFF (50/50), fixed per
  // person per day. Usage is logged on both kinds of day so they can be compared.
  const lsGet = (k) => { try { return localStorage.getItem(k); } catch (_) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (_) {} };
  const today = () => {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  };
  const fnv = (str) => { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
  let deviceId = lsGet('__fr_id');
  if (!deviceId) { deviceId = Math.random().toString(36).slice(2, 8); lsSet('__fr_id', deviceId); }
  const BASE = Number(CFG.intensity) || 0;
  const condition = CFG.experiment
    ? (fnv(deviceId + '|' + today()) % 2 ? 'on' : 'off')
    : (BASE > 0 ? 'on' : 'off');
  const M = condition === 'on' ? BASE : 0;
  const ACTIVE = M > 0;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const log = (...a) => {
    if (!CFG.debug) return;
    try { window.webkit.messageHandlers.friction.postMessage(a.map(String).join(' ')); }
    catch (_) { console.log('%c[friction]', 'color:#c60', ...a); } // desktop browser testing
  };

  // ---------------------------------------------------------------- surfaces
  // Only these get friction. DMs, profiles, posting, settings stay fast.
  const surface = () => {
    const p = location.pathname;
    if (p.startsWith('/reels') || p.startsWith('/reel/')) return 'reels';
    if (p.startsWith('/explore')) return 'explore';
    if (p === '/') return 'feed';
    return null;
  };

  // ----------------------------------------------------------- session clock
  // t = seconds spent on friction surfaces this session.
  // A session ends after 10 minutes away from the app.
  const STORE = '__fr_session';
  const IDLE_RESET_MS = 10 * 60 * 1000;
  // Finished sessions go to a local log: { d: day, c: 'on'|'off', s: seconds on
  // Reels/Explore/feed, r: reels watched }. Nothing leaves the device unless the
  // user copies it from the stats panel (instagram.com/#friction).
  const LOG_KEY = '__fr_log';
  const readLog = () => { try { return JSON.parse(lsGet(LOG_KEY)) || []; } catch (_) { return []; } };
  function finalize(sess) {
    if (!sess || !(sess.t >= 10)) return; // ignore sub-10-second visits
    const lg = readLog();
    lg.push({ d: sess.day || today(), c: sess.cond || condition, s: sess.t, r: sess.reels || 0 });
    while (lg.length > 1000) lg.shift();
    lsSet(LOG_KEY, JSON.stringify(lg));
  }
  const freshSession = () => ({ t: 0, last: now(), day: today(), cond: condition, reels: 0 });
  let s = (() => {
    try {
      const v = JSON.parse(lsGet(STORE));
      if (v && now() - v.last < IDLE_RESET_MS && (v.cond || condition) === condition) return v;
      if (v) finalize(v);
    } catch (_) {}
    return freshSession();
  })();
  const minutes = () => s.t / 60;

  // Testing hooks (console): __friction.setMinutes(30) jumps the session clock,
  // __friction.status() shows where you are on every ramp.
  window.__friction.setMinutes = (m) => { s.t = m * 60; s.last = now(); applyVisuals(); return status(); };
  window.__friction.status = () => status();
  function status() {
    const t = minutes();
    return {
      surface: surface(), minutes: +t.toFixed(1), intensity: M, condition, experiment: !!CFG.experiment,
      avgVideoStartMs: Math.round(T.videoStart.base * M * (1 + ALPHA * t)),
      avgFeedHoldMs: Math.round(T.feedHold.base * M * (1 + ALPHA * t)),
      avgStallMs: Math.round(T.stall.base * M * (1 + ALPHA * t)),
      secondsBetweenStalls: +(1 / (Math.min(T.stallRateMax, T.stallRate0 + T.stallRateK * t) * M)).toFixed(1),
      saturation: +(surface() ? Math.max(0.55, 1 - 0.012 * M * Math.max(0, t - 5)) : 1).toFixed(2),
      springBackChance: t > 3 ? +(Math.min(0.15, 0.02 + 0.004 * t) * M).toFixed(3) : 0,
    };
  }

  setInterval(() => {
    try {
      if (document.visibilityState !== 'visible') return;
      if (now() - s.last > IDLE_RESET_MS) { finalize(s); s = freshSession(); }
      if (surface()) s.t += 1;
      s.last = now();
      lsSet(STORE, JSON.stringify(s));
      applyVisuals();
      syncSurfaceAttr();
    } catch (_) {}
  }, 1000);

  // ---------------------------------------------------------------- sampling
  // d = base * M * (1 + ALPHA*t) * eps,  eps ~ LogNormal(-sigma^2/2, sigma^2)  (mean 1)
  const ALPHA = 0.05; // per minute on a friction surface
  const SIGMA = 0.4;

  // All tunables in one place.
  const T = {
    videoStart: { base: 1200, floor: 700, cap: 5000 }, // black screen + spinner before each video
    feedHold:   { base: 1000, floor: 300, cap: 5000 }, // "loading more" pause
    stall:      { base: 1000, floor: 450, cap: 4000 }, // mid-video buffering
    stallRate0: 0.035,  // stalls per second of playback at t = 0  (≈ one every ~30 s)
    stallRateK: 0.003,  // + per minute of session
    stallRateMax: 0.12, // ≈ one every ~8 s at worst
    loadingTint: 0.25,  // darkness of the layer over a loading video (0 = clear, 1 = black)
    bufferTint: 0.18,   // darkness over a buffering (frozen) video
  };
  window.__friction.T = T; // live-tweak from the console, e.g. __friction.T.videoStart.base = 1500

  const gauss = () => {
    let u = 0, v = 0;
    while (!u) u = Math.random();
    while (!v) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  const delay = ({ base, floor = 0, cap }, sigma = SIGMA) => {
    const eps = Math.exp(sigma * gauss() - (sigma * sigma) / 2);
    const d = base * M * (1 + ALPHA * minutes()) * eps;
    return Math.max(floor * M, Math.min(cap * M, d));
  };

  // ------------------------------------------------- 1. slow feed pagination
  // Hold back the requests that load *more content*, so the feed "runs out"
  // for a beat. Likes, comments, DMs etc. are never delayed.
  const FEEDISH = /feed|timeline|clips|reels|explore|discover|chaining|sectional/i;
  const API_FEED = /\/api\/v1\/(feed|clips|discover|explore)\//i;

  const nameFromBody = (body) => {
    try {
      let b = '';
      if (typeof body === 'string') b = body;
      else if (body instanceof URLSearchParams) b = body.toString();
      else if (body instanceof FormData) b = String(body.get('fb_api_req_friendly_name') || '');
      const m = b.match(/fb_api_req_friendly_name=([^&]+)/);
      return m ? decodeURIComponent(m[1]) : (b && !b.includes('=') ? b : '');
    } catch (_) { return ''; }
  };
  const nameFromHeaders = (h) => {
    try {
      if (!h) return '';
      if (h instanceof Headers) return h.get('x-fb-friendly-name') || '';
      for (const k in h) if (k.toLowerCase() === 'x-fb-friendly-name') return h[k];
    } catch (_) {}
    return '';
  };
  const isFeedRequest = (url, name) => {
    if (!ACTIVE || !surface()) return false;
    if (name) return FEEDISH.test(name) && !/mutation/i.test(name);
    return API_FEED.test(String(url || ''));
  };

  try {
    const origFetch = window.fetch;
    window.fetch = function (input, init) {
      const args = arguments;
      try {
        const url = typeof input === 'string' ? input : input && input.url;
        const name = nameFromHeaders(init && init.headers) || nameFromBody(init && init.body);
        if (isFeedRequest(url, name)) {
          const d = delay(T.feedHold);
          log('net hold', d | 0, name || url);
          return sleep(d).then(() => origFetch.apply(this, args));
        }
      } catch (_) {}
      return origFetch.apply(this, args);
    };

    const XP = XMLHttpRequest.prototype;
    const xOpen = XP.open, xSend = XP.send, xHeader = XP.setRequestHeader;
    XP.open = function (method, url) { this.__frUrl = url; return xOpen.apply(this, arguments); };
    XP.setRequestHeader = function (k, v) {
      try { if (String(k).toLowerCase() === 'x-fb-friendly-name') this.__frName = v; } catch (_) {}
      return xHeader.apply(this, arguments);
    };
    XP.send = function (body) {
      try {
        const name = this.__frName || nameFromBody(body);
        if (isFeedRequest(this.__frUrl, name)) {
          const d = delay(T.feedHold);
          log('xhr hold', d | 0, name || this.__frUrl);
          setTimeout(() => { try { xSend.call(this, body); } catch (_) {} }, d);
          return;
        }
      } catch (_) {}
      return xSend.apply(this, arguments);
    };
  } catch (_) {}

  // ------------------------------------------- spinner / loading overlay
  // A neutral activity spinner drawn with DOM APIs (no innerHTML, so it works under
  // Trusted Types CSP). Inserted right after the <video> so it covers the video but
  // sits under Instagram's own buttons/caption layers.
  const SVGNS = 'http://www.w3.org/2000/svg';
  let cssReady = false;
  function ensureCss() {
    if (cssReady) return;
    const st = document.createElement('style');
    st.textContent = '@keyframes __frspin{to{transform:rotate(360deg)}}' +
      // On Reels/feed, a video stays invisible until friction releases it. That stops
      // the preloaded next reel from flashing on screen before its loading hold begins.
      'html[data-fr-v] video:not([data-fr-ok]){opacity:0 !important}';
    (document.head || document.documentElement).appendChild(st);
    cssReady = true;
  }
  try { ensureCss(); } catch (_) { document.addEventListener('DOMContentLoaded', () => { try { ensureCss(); } catch (_) {} }); }

  // Keep <html data-fr-v> in sync with whether we're on a video surface.
  function syncSurfaceAttr() {
    try {
      const s = surface();
      document.documentElement.toggleAttribute('data-fr-v', ACTIVE && (s === 'reels' || s === 'feed'));
    } catch (_) {}
  }
  syncSurfaceAttr();
  // Some injectors run before <html> exists (document.documentElement === null), so the two
  // calls above did nothing. Redo them the moment <html> is inserted, before anything renders;
  // otherwise videos wouldn't be hidden until DOMContentLoaded / the first 1 s tick.
  if (!document.documentElement) {
    try {
      const mo = new MutationObserver(() => {
        if (!document.documentElement) return;
        mo.disconnect();
        try { ensureCss(); } catch (_) {}
        syncSurfaceAttr();
      });
      mo.observe(document, { childList: true });
    } catch (_) {}
  }
  for (const fn of ['pushState', 'replaceState']) {
    try {
      const orig = history[fn];
      history[fn] = function () { const r = orig.apply(this, arguments); syncSurfaceAttr(); return r; };
    } catch (_) {}
  }
  addEventListener('popstate', syncSurfaceAttr);

  // A reused <video> that gets a new source must be hidden again until released.
  const resetOk = (e) => {
    const el = e.target;
    if (el instanceof HTMLMediaElement && released.get(el) !== srcOf(el)) el.removeAttribute('data-fr-ok');
  };
  document.addEventListener('emptied', resetOk, true);
  document.addEventListener('loadstart', resetOk, true);
  // Thin rotating arc: a ring with a gap, spinning smoothly, like Instagram's
  // current video loading indicator.
  function makeSpinner() {
    const svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('viewBox', '0 0 48 48');
    svg.setAttribute('width', '36');
    svg.setAttribute('height', '36');
    svg.style.animation = '__frspin 0.8s linear infinite';
    const c = document.createElementNS(SVGNS, 'circle');
    c.setAttribute('cx', '24'); c.setAttribute('cy', '24'); c.setAttribute('r', '20');
    c.setAttribute('fill', 'none');
    c.setAttribute('stroke', '#fff');
    c.setAttribute('stroke-opacity', '0.9');
    c.setAttribute('stroke-width', '3');
    c.setAttribute('stroke-linecap', 'round');
    c.setAttribute('stroke-dasharray', '88 38'); // ~70% of the ring drawn, ~30% gap
    svg.appendChild(c);
    return svg;
  }
  // blackout=true: pure loading screen (no image). false: frozen frame, slightly dimmed.
  // The overlay is position:fixed on <body> and tracks the video's on-screen box every
  // frame. Being outside Instagram's own layers means nothing they stack over the video
  // (preview thumbnails etc.) can cover it.
  const overlays = new Set();
  function showOverlay(el, blackout) {
    try {
      hideOverlay(el);
      ensureCss();
      const host = document.body || document.documentElement;
      const o = document.createElement('div');
      o.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;z-index:2147483646;' +
        'display:flex;align-items:center;justify-content:center;pointer-events:none;' +
        'background:rgba(0,0,0,' + (blackout ? T.loadingTint : T.bufferTint) + ')';
      o.appendChild(makeSpinner());
      host.appendChild(o);
      el.__frOverlay = o;
      overlays.add(el);
      position(el);
      log('overlay', blackout ? 'loading' : 'buffer', JSON.stringify(rectOf(el)));
      if (overlays.size === 1) requestAnimationFrame(track);
    } catch (e) { log('overlay error', e && e.message); }
  }
  function rectOf(el) {
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
  }
  function position(el) {
    const o = el.__frOverlay;
    if (!o) return;
    const r = el.getBoundingClientRect();
    const visible = r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight;
    o.style.display = visible ? 'flex' : 'none';
    o.style.left = r.left + 'px'; o.style.top = r.top + 'px';
    o.style.width = r.width + 'px'; o.style.height = r.height + 'px';
  }
  function track() {
    for (const el of overlays) {
      if (!el.__frOverlay || !el.isConnected) { hideOverlay(el); continue; }
      position(el);
    }
    if (overlays.size) requestAnimationFrame(track);
  }
  function hideOverlay(el) {
    try { if (el.__frOverlay) el.__frOverlay.remove(); } catch (_) {}
    el.__frOverlay = null;
    overlays.delete(el);
  }

  // Console self-test: covers the biggest on-screen video with the loading screen for 3 s.
  window.__friction.testOverlay = () => {
    const vids = [...document.querySelectorAll('video')]
      .map((v) => [v, v.getBoundingClientRect()])
      .filter(([, r]) => r.width > 0 && r.bottom > 0 && r.top < innerHeight)
      .sort((a, b) => b[1].width * b[1].height - a[1].width * a[1].height);
    if (!vids.length) return 'no visible <video> on this page';
    const v = vids[0][0];
    showOverlay(v, true);
    setTimeout(() => hideOverlay(v), 3000);
    return { videosOnPage: document.querySelectorAll('video').length, covering: rectOf(v) };
  };

  // ------------------------------------------------ 2. delayed video start
  // Each new video shows a black loading screen with a spinner first.
  // Keyed by src because Instagram reuses <video> elements as you scroll.
  const released = new WeakMap(); // el -> src allowed to play
  const srcOf = (el) => el.currentSrc || el.src || '';
  const videoSurface = () => { const s = surface(); return s === 'reels' || s === 'feed'; };
  let origPlay, origPause;

  try {
    const MP = HTMLMediaElement.prototype;
    origPlay = MP.play;
    origPause = MP.pause;

    MP.pause = function () {
      this.__frTok = (this.__frTok || 0) + 1; // cancels any pending hold / stall
      clearTimeout(this.__frStallT);
      this.__frStallPaused = false; // never auto-resume a video the user paused
      endStall(this);
      hideOverlay(this);
      return origPause.apply(this, arguments);
    };

    MP.play = function () {
      const el = this;
      try {
        if (!ACTIVE || !videoSurface()) { el.setAttribute('data-fr-ok', ''); return origPlay.apply(el, arguments); }
        if (released.get(el) === srcOf(el)) {
          el.setAttribute('data-fr-ok', '');
          const p = origPlay.apply(el, arguments);
          scheduleStall(el);
          return p;
        }
        if (el.__frPending) return el.__frPending;
        const tok = (el.__frTok = (el.__frTok || 0) + 1);
        const d = delay(T.videoStart);
        log('video start hold', d | 0);
        showOverlay(el, true);
        el.__frPending = sleep(d).then(() => {
          el.__frPending = null;
          if (el.__frTok !== tok || !el.isConnected) { hideOverlay(el); return; } // swiped away
          released.set(el, srcOf(el));
          el.setAttribute('data-fr-ok', '');
          hideOverlay(el);
          return Promise.resolve(origPlay.call(el)).then(() => { lateAudio(el); scheduleStall(el); });
        });
        return el.__frPending;
      } catch (_) {
        return origPlay.apply(el, arguments);
      }
    };

    // Fallback for videos that start via the autoplay attribute instead of play().
    document.addEventListener('play', (e) => {
      try {
        const el = e.target;
        if (!ACTIVE || !(el instanceof HTMLMediaElement) || !videoSurface()) return;
        if (released.get(el) === srcOf(el) || el.__frPending) return;
        el.pause();
        el.play();
      } catch (_) {}
    }, true);
  } catch (_) {}

  // ------------------------------------------- 6. mid-video buffering
  // Stalls arrive as a Poisson process over playback time; the rate rises with the
  // session. Uses playbackRate = 0 (no 'pause' event, so Instagram doesn't show its
  // paused UI); falls back to a real pause if the browser rejects rate 0.
  function scheduleStall(el) {
    try {
      clearTimeout(el.__frStallT);
      if (!videoSurface()) return;
      const lam = Math.min(T.stallRateMax, T.stallRate0 + T.stallRateK * minutes()) * M; // per second
      if (lam <= 0) return;
      const wait = Math.max(2500, (-Math.log(1 - Math.random()) / lam) * 1000);
      const tok = el.__frTok, key = srcOf(el);
      el.__frStallT = setTimeout(() => stall(el, tok, key), wait);
    } catch (_) {}
  }

  function stall(el, tok, key) {
    try {
      if (el.__frTok !== tok || srcOf(el) !== key) return;
      if (!el.isConnected || el.paused || el.ended || !videoSurface()) return;
      el.__frPrevRate = el.playbackRate || 1;
      el.__frStalling = true;
      el.__frStallPaused = false;
      try { el.playbackRate = 0; } catch (_) {}
      if (el.playbackRate !== 0) { el.__frStallPaused = true; origPause.call(el); }
      showOverlay(el, false);
      const d = delay(T.stall);
      log('stall', d | 0);
      setTimeout(() => {
        if (el.__frTok !== tok) return; // user paused or video changed; pause() cleaned up
        endStall(el);
        hideOverlay(el);
        scheduleStall(el);
      }, d);
    } catch (_) {}
  }

  function endStall(el) {
    if (!el.__frStalling) return;
    el.__frStalling = false;
    try {
      if (el.__frStallPaused) { el.__frStallPaused = false; origPlay.call(el); }
      else el.playbackRate = el.__frPrevRate || 1;
    } catch (_) {}
  }

  // ---------------------------------------------- 5. audio arrives late
  function lateAudio(el) {
    try {
      if (el.muted || Math.random() > 0.35 * Math.min(1, M)) return;
      el.__frMuting = true;
      el.muted = true;
      setTimeout(() => {
        if (el.__frMuting) el.muted = false; // skip if the user touched mute meanwhile
        el.__frMuting = false;
      }, delay({ base: 400, cap: 1200 }));
    } catch (_) {}
  }
  document.addEventListener('volumechange', (e) => {
    const el = e.target;
    // A mute change we didn't just make came from the user — respect it.
    if (el && el.__frMuting && !el.muted) el.__frMuting = false;
  }, true);

  // --------------------------------------------------- 4. colour drains out
  // After a 5-minute grace period, saturation falls ~1.2%/min to a floor of 55%.
  // Leaving the surface fades back over 2s so it never "snaps".
  let lastFilter = null;
  function applyVisuals() {
    const root = document.documentElement;
    if (!root) return;
    const t = minutes();
    const sat = surface() ? Math.max(0.55, 1 - 0.012 * M * Math.max(0, t - 5)) : 1;
    const f = sat < 0.995 ? `saturate(${sat.toFixed(3)})` : '';
    if (f === lastFilter) return;
    if (lastFilter === null) root.style.transition = 'filter 2s ease';
    root.style.filter = f;
    lastFilter = f;
  }

  // ------------------------------------------------------ 3. sticky swipes
  // On Reels, once you're past the 3-minute grace period, a small and growing
  // share of swipes don't "take": the reel springs back.
  let scroller = null, lastTop = 0, settleTimer = null, springing = false;
  document.addEventListener('scroll', (e) => {
    try {
      if (surface() !== 'reels') return;
      const el = e.target === document ? document.scrollingElement : e.target;
      if (!(el instanceof Element)) return;
      clearTimeout(settleTimer);
      settleTimer = setTimeout(() => settle(el), 140);
    } catch (_) {}
  }, true);

  function settle(el) {
    const h = el.clientHeight;
    if (!h) return;
    const top = el.scrollTop;
    if (el !== scroller || springing) { scroller = el; lastTop = top; springing = false; return; }
    const t = minutes();
    const p = Math.min(0.15, 0.02 + 0.004 * t) * M;
    if (t > 3 && top > lastTop + h * 0.5 && Math.random() < p) {
      springing = true;
      log('spring back');
      el.scrollTo({ top: lastTop, behavior: 'smooth' });
      return;
    }
    lastTop = top;
  }

  // ------------------------------------------------------- reels counter
  // Counts distinct reels that actually started playing (on ON and OFF days alike).
  const counted = new WeakMap();
  document.addEventListener('playing', (e) => {
    try {
      const el = e.target;
      if (!(el instanceof HTMLMediaElement) || surface() !== 'reels') return;
      const k = el.currentSrc || el.src || '';
      if (counted.get(el) === k) return;
      counted.set(el, k);
      s.reels = (s.reels || 0) + 1;
    } catch (_) {}
  }, true);

  // ---------------------------------------------------------- stats panel
  // Open instagram.com/#friction to see your numbers and copy them to share.
  function summary() {
    const lg = readLog();
    if (s.t >= 10) lg.push({ d: s.day, c: s.cond, s: s.t, r: s.reels || 0, live: true });
    const agg = (c) => {
      const xs = lg.filter((x) => x.c === c);
      const days = new Set(xs.map((x) => x.d)).size;
      const sec = xs.reduce((a, x) => a + x.s, 0), reels = xs.reduce((a, x) => a + x.r, 0);
      return {
        days, sessions: xs.length,
        minPerDay: days ? +(sec / 60 / days).toFixed(1) : 0,
        minPerSession: xs.length ? +(sec / 60 / xs.length).toFixed(1) : 0,
        reelsPerDay: days ? +(reels / days).toFixed(1) : 0,
      };
    };
    return { id: deviceId, today: condition, on: agg('on'), off: agg('off'), log: lg };
  }
  window.__friction.stats = () => { const x = summary(); delete x.log; return x; };

  function exportCode() {
    const x = summary();
    const compact = x.log.map((e) => [e.d, e.c === 'on' ? 1 : 0, Math.round(e.s), e.r]);
    return 'FR1:' + btoa(JSON.stringify({ id: x.id, v: 1, l: compact }));
  }

  let panel = null;
  function mk(tag, css, text) {
    const n = document.createElement(tag);
    if (css) n.style.cssText = css;
    if (text != null) n.textContent = text;
    return n;
  }
  function openPanel() {
    try {
      if (panel || !document.body) return;
      const x = summary();
      panel = mk('div', 'position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.55);' +
        'display:flex;align-items:center;justify-content:center;font:15px -apple-system,system-ui,sans-serif');
      const card = mk('div', 'background:#fff;color:#111;border-radius:16px;padding:20px;width:min(340px,88vw);' +
        'box-shadow:0 10px 40px rgba(0,0,0,.3)');
      card.appendChild(mk('div', 'font-weight:700;font-size:18px;margin-bottom:4px', 'Friction stats'));
      card.appendChild(mk('div', 'color:#666;font-size:13px;margin-bottom:14px',
        CFG.experiment ? `ID ${x.id} · today is an ${x.today.toUpperCase()} day` : `ID ${x.id} · friction ${x.today}`));
      const row = (label, a, b) => {
        const r = mk('div', 'display:grid;grid-template-columns:1.6fr 1fr 1fr;padding:6px 0;border-bottom:1px solid #eee');
        r.appendChild(mk('div', 'color:#555', label));
        r.appendChild(mk('div', 'text-align:right;font-weight:600', String(a)));
        r.appendChild(mk('div', 'text-align:right;font-weight:600', String(b)));
        card.appendChild(r);
      };
      row('', 'ON', 'OFF');
      row('Days', x.on.days, x.off.days);
      row('Doomscroll min / day', x.on.minPerDay, x.off.minPerDay);
      row('Min / session', x.on.minPerSession, x.off.minPerSession);
      row('Reels / day', x.on.reelsPerDay, x.off.reelsPerDay);
      const btns = mk('div', 'display:flex;gap:10px;margin-top:16px');
      const copy = mk('button', 'flex:1;padding:11px;border:0;border-radius:10px;background:#0095f6;color:#fff;font-weight:600;font-size:15px', 'Copy results');
      const close = mk('button', 'flex:1;padding:11px;border:0;border-radius:10px;background:#efefef;color:#111;font-weight:600;font-size:15px', 'Close');
      copy.onclick = async () => {
        const code = exportCode();
        try { await navigator.clipboard.writeText(code); copy.textContent = 'Copied ✓'; }
        catch (_) { prompt('Copy this and send it over:', code); }
      };
      close.onclick = () => { closePanel(); try { history.replaceState(null, '', location.pathname + location.search); } catch (_) {} };
      btns.appendChild(copy); btns.appendChild(close); card.appendChild(btns);
      panel.appendChild(card);
      document.body.appendChild(panel);
    } catch (e) { log('panel error', e && e.message); }
  }
  function closePanel() { try { if (panel) panel.remove(); } catch (_) {} panel = null; }
  const checkHash = () => { if (location.hash === '#friction') openPanel(); };
  addEventListener('hashchange', checkHash);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(checkHash, 300));
  else setTimeout(checkHash, 300);
  window.__friction.panel = openPanel;

  log('friction loaded, intensity', M, 'condition', condition, 'session min', minutes().toFixed(1));
})();
