// Friction engine — injected at document start into instagram.com.
// Goal: make the compulsive surfaces (Reels, Explore, home feed) feel a little
// worse over a session, in ways that read as "bad wifi / clunky app", never as a nag.
// Every hook is wrapped so a failure here can never break Instagram itself.
(() => {
  if (window.__friction) return;
  const CFG = Object.assign({ intensity: 1.0, debug: false }, window.__FRICTION_CONFIG__ || {});
  window.__friction = { cfg: CFG };
  const M = Number(CFG.intensity) || 0;
  if (M <= 0) return;

  const now = () => Date.now();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const log = (...a) => {
    if (!CFG.debug) return;
    try { window.webkit.messageHandlers.friction.postMessage(a.map(String).join(' ')); } catch (_) {}
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
  let s = (() => {
    try {
      const v = JSON.parse(localStorage.getItem(STORE));
      if (v && now() - v.last < IDLE_RESET_MS) return v;
    } catch (_) {}
    return { t: 0, last: now() };
  })();
  const minutes = () => s.t / 60;

  setInterval(() => {
    try {
      if (document.visibilityState !== 'visible') return;
      if (now() - s.last > IDLE_RESET_MS) s.t = 0;
      if (surface()) s.t += 1;
      s.last = now();
      localStorage.setItem(STORE, JSON.stringify(s));
      applyVisuals();
    } catch (_) {}
  }, 1000);

  // ---------------------------------------------------------------- sampling
  // d = base * M * (1 + ALPHA*t) * eps,  eps ~ LogNormal(-SIGMA^2/2, SIGMA^2)  (mean 1)
  const ALPHA = 0.06; // per minute: +6% per minute on a friction surface
  const SIGMA = 0.5;
  const gauss = () => {
    let u = 0, v = 0;
    while (!u) u = Math.random();
    while (!v) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  const delay = (base, cap) => {
    const eps = Math.exp(SIGMA * gauss() - (SIGMA * SIGMA) / 2);
    const d = base * M * (1 + ALPHA * minutes()) * eps;
    return Math.max(0, Math.min(cap * M, d));
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
    if (!surface()) return false;
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
          const d = delay(600, 4000);
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
          const d = delay(600, 4000);
          log('xhr hold', d | 0, name || this.__frUrl);
          setTimeout(() => { try { xSend.call(this, body); } catch (_) {} }, d);
          return;
        }
      } catch (_) {}
      return xSend.apply(this, arguments);
    };
  } catch (_) {}

  // ------------------------------------------------ 2. delayed video start
  // Each new video sits on its first frame for a moment, like it's buffering.
  // Keyed by src because Instagram reuses <video> elements as you scroll.
  const released = new WeakMap(); // el -> src allowed to play
  const srcOf = (el) => el.currentSrc || el.src || '';
  try {
    const MP = HTMLMediaElement.prototype;
    const origPlay = MP.play, origPause = MP.pause;

    MP.pause = function () {
      this.__frTok = (this.__frTok || 0) + 1; // cancels any pending held play
      return origPause.apply(this, arguments);
    };

    MP.play = function () {
      const el = this;
      try {
        if (!surface() || released.get(el) === srcOf(el)) return origPlay.apply(el, arguments);
        if (el.__frPending) return el.__frPending;
        const tok = (el.__frTok = (el.__frTok || 0) + 1);
        const d = delay(350, 2500);
        log('video hold', d | 0);
        el.__frPending = sleep(d).then(() => {
          el.__frPending = null;
          if (el.__frTok !== tok || !el.isConnected) return; // swiped away meanwhile
          released.set(el, srcOf(el));
          return Promise.resolve(origPlay.call(el)).then(() => lateAudio(el));
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
        if (!(el instanceof HTMLMediaElement) || !surface()) return;
        if (released.get(el) === srcOf(el) || el.__frPending) return;
        el.pause();
        el.play();
      } catch (_) {}
    }, true);
  } catch (_) {}

  // ---------------------------------------------- 5. audio arrives late
  function lateAudio(el) {
    try {
      if (el.muted || Math.random() > 0.35 * Math.min(1, M)) return;
      el.__frMuting = true;
      el.muted = true;
      setTimeout(() => {
        if (el.__frMuting) el.muted = false; // skip if the user touched mute meanwhile
        el.__frMuting = false;
      }, delay(400, 1200));
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

  log('friction loaded, intensity', M, 'session min', minutes().toFixed(1));
})();
