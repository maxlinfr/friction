# Friction — project instructions

iOS app that wraps instagram.com in a WKWebView and injects a JS "friction engine": Reels, Explore
and the home feed get gradually slower and duller the longer you scroll (loading holds, mid-video
buffering, colour drain, sticky swipes). DMs, profiles and posting are never slowed.
Goal: invisible friction, not blocking. Human overview: README.md.

## Environment — read this first

- The owner develops on **Windows**. There is no local Xcode, no simulator, no `swift`.
  **Never claim Swift code works because it "looks right".** It is verified only by the GitHub
  Actions macOS build (see the `ci-loop` skill).
- Node is available locally (for JS tests). GitHub CLI `gh` is used to read CI results.
- The repo path is under OneDrive, but OneDrive sync is **off**, so git worktrees are fine.
  If git still reports odd file-lock errors, say so; don't fight it.

## Agents (`.claude/agents/`)

The main session is the **lead**: owns the roadmap, commits, and talks to the owner.
- `engine-dev`: friction.js, tests/, userscript generator. Local-only; never commits.
- `ios-ci`: Swift, project.yml, workflows. Runs the `ci-loop` skill; the **only** agent that pushes.
- `reviewer`: read-only check of the diff against these rules and DESIGN.md before a push.
Design/feel decisions are made by the owner + lead, recorded in DESIGN.md.
Hooks in `.claude/settings.json` enforce rules 1, 2, 4, 5 and the feel-defaults half of rule 7.

## Layout

```
project.yml                        XcodeGen spec -> Friction.xcodeproj (generated, never committed)
Friction/*.swift                   SwiftUI app + WKWebView wrapper
Friction/Resources/friction.js     THE friction engine — single source of truth
Friction/Resources/Settings.bundle iOS Settings pane (intensity, debug)
testing/*.user.js                  GENERATED userscript copies of the engine (desktop + friends)
analysis/summarize.py              experiment analysis (ON/OFF days, permutation test)
DESIGN.md                          design + feel principles (agents check against it)
.github/workflows/build.yml        macOS CI build
```

## Hard rules

1. **Never edit or commit `Friction.xcodeproj`.** Change `project.yml`; CI runs `xcodegen generate`.
2. **`friction.js` is the only place engine logic lives.** The `testing/*.user.js` files are header +
   engine copy. After changing the engine, regenerate them (via `scripts/build-userscripts.mjs` once it
   exists) — never hand-edit them.
3. **Every engine hook stays wrapped in try/catch.** A friction bug must never break Instagram itself.
4. **No `innerHTML` in the engine** (Instagram may enforce Trusted Types). Build DOM with createElement.
5. **Never put Instagram credentials, Apple credentials, or API keys in the repo.** CI secrets only.
6. **Small commits, one concern each.** Push → let CI judge → fix. Don't stack unverified changes.
7. Stop and ask the owner before: changing friction *feel* defaults (the numbers in `T` in
   friction.js), anything touching signing/certificates, or adding a paid service.

## Engine facts (friction.js)

- Delays: `d = base · M · (1 + ALPHA·t) · ε`, ε lognormal with mean 1; `t` = minutes on friction
  surfaces this session. All tunables are in the `T` object; `ALPHA = 0.05`, `SIGMA = 0.4`.
- Surfaces: `surface()` → 'reels' | 'explore' | 'feed' | null. Video friction only on reels + feed.
- Videos are hidden by CSS (`html[data-fr-v] video:not([data-fr-ok])`) until friction releases them;
  this prevents the next reel flashing before its loading hold.
- Mid-video buffering uses `playbackRate = 0` (no 'pause' event → Instagram shows no paused UI).
- Experiment mode (`experiment: true`): each day is ON/OFF via FNV hash of `id|date`; sessions logged
  to localStorage `__fr_log`; stats panel at `instagram.com/#friction`. analysis/summarize.py
  reimplements the same hash — keep them in sync.
- Console test hooks: `__friction.status()`, `.setMinutes(n)`, `.T`, `.testOverlay()`, `.stats()`.

## Roadmap (do in order; check with owner before starting the next phase)

### Phase 1 — feedback loop (first task)
Done when all of these work and are documented in README.md:
- [ ] CI builds for the **simulator**, boots an iPhone simulator, installs + launches the app, waits,
      takes screenshots with `xcrun simctl io booted screenshot`, uploads them as artifact `screenshots`.
      (Without login, Instagram's login page is the expected screenshot.)
- [ ] CI keeps producing the unsigned device `.ipa` artifact (used for Sideloadly installs).
- [ ] `scripts/build-userscripts.mjs` regenerates `testing/*.user.js` from friction.js + headers.
- [ ] Playwright **WebKit** tests (`tests/`) run the engine against a local fixture page that fakes
      Instagram (a `/reels/` path, `<video>` elements, an XHR with an `x-fb-friendly-name` header).
      Cover: video hidden until released, loading overlay shown then removed, feed request delayed,
      like-mutation request NOT delayed, OFF day = no friction, no errors thrown.
- [ ] CI runs those tests too.

### Phase 2 — TestFlight-ready
Bundle ID `com.maxlin.friction` (team ID via build setting placeholder), AppIcon asset catalog
(placeholder icon OK), `PrivacyInfo.xcprivacy` declaring UserDefaults (reason CA92.1), build number
bump strategy, CI job that archives + uploads to TestFlight using an App Store Connect API key from
GitHub secrets (owner creates the key and secrets).

### Phase 3 — hub
Home screen with Instagram + YouTube Shorts tiles. Per-site adapter in the engine (surfaces + which
requests count as "load more"). Instagram adapter = current behaviour.

### Later — Screen Time (blocked on Apple's Family Controls distribution approval)
Shield native apps + redirect via notification. Do not start without the owner.

## Things only a human can verify
How friction *feels*, real Instagram login/behaviour, Screen Time, App Store Connect setup.
When a change needs one of these, say exactly what the owner should check.
