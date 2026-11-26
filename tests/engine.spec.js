// Friction engine tests against a fake instagram.com (see helpers.js and fixture/).
// The clock is paused: an engine delay only elapses when a test calls ig.runFor(), so
// "not delayed" means "happened with the clock stopped", and nothing depends on real timing.
// Engine defaults are used as-is (intensity 1); bounds are read from __friction.T.
import { test, expect } from './helpers.js';

const FEED_QUERY = 'PolarisFeedTimelineQuery';
const REELS_QUERY = 'PolarisClipsTabDesktopPaginationQuery';
const LIKE = 'usePolarisLikeMediaLikeMutation';

test.describe('video loading hold (Reels, default intensity)', () => {
  test('a video stays hidden until friction releases it, then gets data-fr-ok', async ({ ig }) => {
    await ig.open('/reels/');
    const { videoStart } = await ig.T();

    // Hidden from the first frame, before play() and before any timer has run.
    expect(await ig.videoSurfaceAttr()).toBe(true);
    expect(await ig.opacity('v1')).toBe('0');
    expect(await ig.released('v1')).toBe(false);

    await ig.play('v1');
    await ig.runFor(videoStart.floor - 50); // just short of the minimum hold
    expect(await ig.opacity('v1')).toBe('0');
    expect(await ig.mediaPlays('v1')).toBe(0); // the browser hasn't been told to play yet
    expect(await ig.playState('v1')).toBe('pending');

    const hold = videoStart.floor - 50 + (await ig.runUntilReleased('v1'));
    expect(hold).toBeGreaterThanOrEqual(videoStart.floor);
    expect(hold).toBeLessThanOrEqual(videoStart.cap + 50);
    expect(await ig.opacity('v1')).toBe('1');
    await expect.poll(() => ig.playState('v1')).toBe('resolved');
    expect(await ig.mediaPlays('v1')).toBe(1);
    expect((await ig.video('v1')).paused).toBe(false);

    // The next (preloaded, never played) video is still hidden: no flash of the next reel.
    expect(await ig.opacity('v2')).toBe('0');
  });

  test('injected before <html> exists: videos are hidden as soon as <html> is inserted', async ({ ig, page }) => {
    // Playwright's WebKit runs init scripts while document.documentElement is still null, so
    // the engine's first syncSurfaceAttr()/ensureCss() can't touch the DOM. Its MutationObserver
    // must redo both when <html> is inserted. window.__early is recorded by an inline <script>
    // at the top of the fixture's <head>: mid-parse, before DOMContentLoaded and before any
    // engine timer (clock paused), so neither fallback (DCL, 1 s tick) can be what set them.
    await ig.open('/reels/');
    expect(await page.evaluate(() => window.__rootAtInject), 'precondition: no <html> at injection').toBe(false);
    expect(await page.evaluate(() => window.__early)).toEqual({ readyState: 'loading', surfaceAttr: true, hideCss: true });
  });

  test('injected before <html> exists, non-video surface: CSS installed, no data-fr-v', async ({ ig, page }) => {
    await ig.open('/direct/inbox/');
    expect(await page.evaluate(() => window.__rootAtInject)).toBe(false);
    expect(await page.evaluate(() => window.__early)).toEqual({ readyState: 'loading', surfaceAttr: false, hideCss: true });
  });

  test('loading overlay appears on play() and is removed when the hold ends', async ({ ig }) => {
    await ig.open('/reels/');
    const { loadingTint } = await ig.T();
    expect(await ig.overlays()).toEqual([]);

    await ig.play('v1');
    const shown = await ig.overlays();
    expect(shown).toHaveLength(1);
    expect(shown[0]).toEqual({ background: `rgba(0, 0, 0, ${loadingTint})`, display: 'flex' });

    await ig.runUntilReleased('v1');
    expect(await ig.overlays()).toEqual([]);
  });

  test('a video started by autoplay (play event, no play() call) is caught and held', async ({ ig, page }) => {
    await ig.open('/reels/');
    await page.evaluate(() => document.getElementById('v1').dispatchEvent(new Event('play')));
    expect(await ig.overlays()).toHaveLength(1);
    expect(await ig.released('v1')).toBe(false);
    await ig.runUntilReleased('v1');
    expect(await ig.overlays()).toEqual([]);
    expect(await ig.mediaPlays('v1')).toBe(1);
  });

  test('pausing (swiping away) during the hold cancels it', async ({ ig, page }) => {
    await ig.open('/reels/');
    await ig.play('v1');
    expect(await ig.overlays()).toHaveLength(1);
    await page.evaluate(() => document.getElementById('v1').pause());
    expect(await ig.overlays()).toEqual([]);
    await ig.runFor(10_000);
    expect(await ig.released('v1')).toBe(false);
    expect(await ig.mediaPlays('v1')).toBe(0);
    expect(await ig.overlays()).toEqual([]);
  });

  test('mid-video buffering freezes the frame without a pause, then resumes', async ({ ig, page }) => {
    // Real-time cost: while an overlay is up, its rAF tracking loop makes the fake clock step
    // every 16 ms (~1 s real per fake s); idle playback is ~30x cheaper. So this uses a fresh
    // session (short holds/stalls, long cheap gaps) rather than setMinutes(n): a deep session
    // doesn't stall more often (the rate caps at stallRateMax by ~30 min) but stalls longer.
    test.setTimeout(150_000); // generous for slow CI runners; locally it takes a few seconds
    await ig.open('/reels/');
    const { bufferTint } = await ig.T();
    await ig.play('v1');
    await ig.runUntilReleased('v1', { step: 250 });
    await expect.poll(() => ig.playState('v1')).toBe('resolved');
    const pausesBefore = await ig.mediaPauses('v1');
    // Record every overlay the engine adds (its tint) from here on.
    await page.evaluate(() => {
      window.__added = [];
      new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => {
        if (n.style && n.style.zIndex === '2147483646') window.__added.push(n.style.background);
      }))).observe(document.body, { childList: true });
    });

    // Play on (10 s chunks of fake time) until one stall has started and ended. The stall rate
    // starts at T.stallRate0 (~1 / 28 s) and rises with the session: P(no stall in 600 s) ~ e^-30.
    const rateLog = () => page.evaluate(() => window.__media.rates('v1'));
    for (let t = 0; t < 600_000 && (await rateLog()).length < 2; t += 10_000) await ig.runFor(10_000);
    const rates = await rateLog();
    const { stall } = await ig.T();
    expect(rates.length, 'at least one stall should have happened').toBeGreaterThanOrEqual(2);
    // Alternates freeze (0) / resume (1), each freeze lasting within [floor, cap] of T.stall.
    for (let i = 0; i < rates.length; i++) {
      expect(rates[i].v).toBe(i % 2 === 0 ? 0 : 1);
      if (i % 2 === 1) {
        const len = rates[i].t - rates[i - 1].t;
        expect(len).toBeGreaterThanOrEqual(stall.floor - 1); // ±1 ms: timer rounding
        expect(len).toBeLessThanOrEqual(stall.cap + 1);
      }
    }
    // Frozen via playbackRate only: no pause() ever reached the media element, so
    // Instagram never sees a 'pause' event / shows its paused UI.
    expect(await ig.mediaPauses('v1')).toBe(pausesBefore);
    expect((await ig.video('v1')).paused).toBe(false);
    // Each freeze showed the (lighter) buffering tint, not the loading tint.
    const added = await page.evaluate(() => window.__added);
    expect(added.length).toBe(Math.ceil(rates.length / 2));
    for (const bg of added) expect(bg).toBe(`rgba(0, 0, 0, ${bufferTint})`);
    // Right now the overlay is shown iff the video is frozen.
    const frozenNow = rates[rates.length - 1].v === 0;
    expect((await ig.overlays()).length).toBe(frozenNow ? 1 : 0);
    expect((await ig.video('v1')).playbackRate).toBe(frozenNow ? 0 : 1);
  });
});

test.describe('feed pagination hold', () => {
  test('feed query via fetch is delayed; a like mutation sent alongside is not', async ({ ig }) => {
    await ig.open('/');
    const { feedHold } = await ig.T();
    await ig.fetchNamed(FEED_QUERY);
    await ig.fetchNamed(LIKE);
    await ig.expectHeld(FEED_QUERY, LIKE);

    await ig.runFor(feedHold.floor - 50);
    await ig.expectHeld(FEED_QUERY, LIKE);
    await ig.runFor(feedHold.cap);
    await ig.expectArrives(FEED_QUERY);
  });

  test('reels pagination via XHR is delayed; a like mutation via XHR is not', async ({ ig }) => {
    await ig.open('/reels/');
    const { feedHold } = await ig.T();
    await ig.xhrNamed(REELS_QUERY);
    await ig.xhrNamed(LIKE);
    await ig.expectHeld(REELS_QUERY, LIKE);
    await ig.runFor(feedHold.cap);
    await ig.expectArrives(REELS_QUERY);
  });

  test('REST "load more" URLs without a friendly name are delayed', async ({ ig }) => {
    await ig.open('/explore/');
    const { feedHold } = await ig.T();
    await ig.fetchUrl('/api/v1/feed/timeline/');
    await ig.xhrUrl('/api/v1/discover/topical_explore/');
    await ig.fetchUrl('/api/v1/web/likes/123/like/'); // control: not a load-more URL
    await ig.expectHeld('/api/v1/feed/timeline/', '/api/v1/web/likes/123/like/');
    expect(ig.hits('/api/v1/discover/topical_explore/')).toBe(0);
    await ig.runFor(feedHold.cap);
    await ig.expectArrives('/api/v1/feed/timeline/');
    await ig.expectArrives('/api/v1/discover/topical_explore/');
  });

  test('mutations are never delayed, even with feed-like names', async ({ ig }) => {
    await ig.open('/reels/');
    const names = ['PolarisFeedItemLikeMutation', 'usePolarisClipsCommentCreateMutation', 'PolarisExploreFollowMutation'];
    for (const n of names) { await ig.fetchNamed(n + 'F'); await ig.xhrNamed(n + 'X'); }
    // Clock is stopped: anything that arrives was not delayed at all.
    for (const n of names) { await ig.expectArrives(n + 'F'); await ig.expectArrives(n + 'X'); }
  });
});

test.describe('OFF = no friction', () => {
  async function expectNoFriction(ig) {
    expect(await ig.videoSurfaceAttr()).toBe(false);
    expect(await ig.opacity('v1')).toBe('1');
    expect(await ig.opacity('v2')).toBe('1');
    await ig.play('v1');
    expect(await ig.overlays()).toEqual([]);
    await expect.poll(() => ig.playState('v1')).toBe('resolved'); // with the clock stopped
    expect(await ig.mediaPlays('v1')).toBe(1);
    await ig.fetchNamed(REELS_QUERY);
    await ig.xhrNamed(FEED_QUERY);
    await ig.fetchUrl('/api/v1/feed/timeline/');
    await ig.expectArrives(REELS_QUERY);
    await ig.expectArrives(FEED_QUERY);
    await ig.expectArrives('/api/v1/feed/timeline/');
    // Long session on an OFF day: still no stalls, no colour drain.
    await ig.page.evaluate(() => window.__friction.setMinutes(60));
    await ig.runFor(60_000);
    expect(await ig.overlays()).toEqual([]);
    expect(await ig.video('v1')).toEqual({ paused: false, playbackRate: 1 });
    expect(await ig.rootFilter()).toBe('');
  }

  test('intensity 0', async ({ ig }) => {
    await ig.open('/reels/', { config: { intensity: 0 } });
    expect((await ig.status()).condition).toBe('off');
    await expectNoFriction(ig);
  });

  test('experiment mode, OFF day (id hashed to OFF for today)', async ({ ig }) => {
    await ig.open('/reels/', { config: { intensity: 1, experiment: true }, experimentDay: 'off' });
    const st = await ig.status();
    expect(st.experiment).toBe(true);
    expect(st.condition).toBe('off');
    expect(st.intensity).toBe(0);
    await expectNoFriction(ig);
  });

  test('experiment mode, ON day (control: the OFF test above is not vacuous)', async ({ ig }) => {
    await ig.open('/reels/', { config: { intensity: 1, experiment: true }, experimentDay: 'on' });
    expect((await ig.status()).condition).toBe('on');
    expect(await ig.opacity('v1')).toBe('0');
    await ig.fetchNamed(REELS_QUERY);
    await ig.fetchNamed(LIKE);
    await ig.expectHeld(REELS_QUERY, LIKE);
  });
});

test.describe('never slowed', () => {
  test('/direct/inbox/ gets zero friction at full intensity, even deep into a session', async ({ ig, page }) => {
    await ig.open('/direct/inbox/');
    await page.evaluate(() => window.__friction.setMinutes(60));
    expect((await ig.status()).surface).toBe(null);
    expect(await ig.videoSurfaceAttr()).toBe(false);
    expect(await ig.opacity('v1')).toBe('1');
    await ig.play('v1');
    expect(await ig.overlays()).toEqual([]);
    await expect.poll(() => ig.playState('v1')).toBe('resolved');
    await ig.fetchNamed(FEED_QUERY); // feed-ish names fired from a DM page still go straight out
    await ig.xhrNamed(REELS_QUERY);
    await ig.fetchUrl('/api/v1/feed/timeline/');
    await ig.expectArrives(FEED_QUERY);
    await ig.expectArrives(REELS_QUERY);
    await ig.expectArrives('/api/v1/feed/timeline/');
    await ig.runFor(60_000);
    expect(await ig.overlays()).toEqual([]);
    expect(await ig.video('v1')).toEqual({ paused: false, playbackRate: 1 });
    expect(await ig.rootFilter()).toBe('');
  });

  // path -> [videos hidden until released, load-more requests held]
  const SURFACES = {
    '/reels/': [true, true],
    '/reel/C0ffee123/': [true, true],
    '/': [true, true],
    '/explore/': [false, true],
    '/direct/inbox/': [false, false],
    '/direct/t/1234567890/': [false, false],
    '/someuser/': [false, false],
    '/p/C0ffee123/': [false, false],
    '/accounts/edit/': [false, false],
  };
  for (const [path, [videoHeld, requestsHeld]] of Object.entries(SURFACES)) {
    test(`surface ${path}: video hold ${videoHeld ? 'on' : 'off'}, request hold ${requestsHeld ? 'on' : 'off'}`, async ({ ig }) => {
      await ig.open(path);
      expect(await ig.videoSurfaceAttr()).toBe(videoHeld);
      expect(await ig.opacity('v1')).toBe(videoHeld ? '0' : '1');
      await ig.play('v1');
      expect(await ig.overlays()).toHaveLength(videoHeld ? 1 : 0);
      await ig.fetchNamed(FEED_QUERY);
      await ig.fetchNamed(LIKE);
      if (requestsHeld) await ig.expectHeld(FEED_QUERY, LIKE);
      else { await ig.expectArrives(LIKE); await ig.expectArrives(FEED_QUERY); }
    });
  }

  test('SPA navigation turns video hiding on and off with the route', async ({ ig, page }) => {
    await ig.open('/direct/inbox/');
    expect(await ig.opacity('v2')).toBe('1');
    await page.evaluate(() => history.pushState(null, '', '/reels/'));
    expect(await ig.videoSurfaceAttr()).toBe(true);
    expect(await ig.opacity('v2')).toBe('0');
    await page.evaluate(() => history.pushState(null, '', '/direct/t/1/'));
    expect(await ig.videoSurfaceAttr()).toBe(false);
    expect(await ig.opacity('v2')).toBe('1');
    await page.evaluate(() => history.back());
    await expect.poll(() => ig.videoSurfaceAttr()).toBe(true);
  });

  test('colour drain applies on Reels late in a session but never on DMs', async ({ ig, page }) => {
    await ig.open('/reels/');
    await page.evaluate(() => window.__friction.setMinutes(30));
    expect(await ig.rootFilter()).toMatch(/^saturate\(0\.\d+\)$/);
    await page.evaluate(() => history.pushState(null, '', '/direct/inbox/'));
    await ig.runFor(1000); // the 1 s tick re-applies visuals for the new route
    expect(await ig.rootFilter()).toBe('');
  });
});
