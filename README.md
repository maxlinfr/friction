# Friction

Instagram that gets quietly worse the longer you doomscroll: no popups, no blocking.

The app is a full-screen instagram.com with a script (`Friction/Resources/friction.js`) injected into every page.
Friction only applies on **Reels, Explore and the home feed**. DMs, profiles and posting are never touched.

| Mechanic | What the user feels | Fresh session → 30 min in |
|---|---|---|
| Loading screen | video hidden, tinted layer + spinner, buttons still visible | ~1.2 s (0.7 s min) → ~3 s |
| Mid-video buffering | frame freezes with spinner, then continues | ~1 s every ~29 s → ~2.5 s every ~8 s |
| Slow "load more" | feed runs out for a beat, like bad wifi | ~1 s → ~2.5 s |
| Late audio | sound kicks in ~0.5 s after video (35% of reels) | random |
| Colour drain | saturation creeps down after 5 min, floor 55% | 100% → 70% |
| Sticky swipes | some swipes spring back on Reels after 3 min | 0% → 14% |

All delays are `base × intensity × (1 + αt) × ε`, with ε lognormal (mean 1), so it never feels mechanical.
The session clock resets after 10 minutes away. Intensity (Off / Light / Normal / Strong) lives in **iOS Settings → Friction**.

## Status & roadmap

- ✅ v1 app shell, friction engine, desktop + Safari userscript versions, experiment mode + analysis
- ⏳ **Phase 1: feedback loop**: CI simulator screenshots, WebKit engine tests, userscript generator
- ⏳ **Phase 2: TestFlight-ready**: bundle ID, icon, privacy manifest, CI upload
- ⏳ **Phase 3: hub**: Instagram + YouTube Shorts
- 🕓 **Later: Screen Time block + redirect** (waiting on Apple's Family Controls approval)

Details and acceptance criteria: [CLAUDE.md](CLAUDE.md).

## Working on this with Claude Code

`CLAUDE.md` holds the standing project rules; Claude Code loads it every session.
`.claude/skills/ci-loop/` is the build-review loop: push → GitHub's Mac builds → read failures and
screenshots → fix → repeat. Requirements on your machine: **git**, **Node.js**, and the
**GitHub CLI** (`winget install GitHub.cli`, then `gh auth login`).

## Getting it on your iPhone from Windows (free)

GitHub's Macs build it; Sideloadly installs it.

1. Push to GitHub. In the **Actions** tab, open the latest `build` run and download **Friction-unsigned-ipa**.
2. On Windows install **iTunes** and **iCloud** from apple.com (not the Microsoft Store), then **Sideloadly** from sideloadly.io.
3. **Use a spare Apple ID for signing**, not your main one. Create one at account.apple.com with a different email.
   Your phone stays signed into your main account; the spare one is only ever typed into Sideloadly.
4. Plug in the iPhone, drag the .ipa into Sideloadly, enter the spare Apple ID, Start.
5. On the phone: **Settings → Privacy & Security → Developer Mode → On** (restart), then
   **Settings → General → VPN & Device Management** → trust the spare account.

Free signing expires after **7 days**; re-run Sideloadly (app data is kept).

## Running it with friends (free, iPhone, no App Store)

`testing/friction-friends.user.js` runs the same engine in iPhone Safari via the free
**Userscripts** extension, in **experiment mode**: each day is randomly ON or OFF per person,
and sessions are logged locally either way. Setup steps for friends: [FRIENDS.md](FRIENDS.md).
Collect everyone's "Copy results" codes into `results.txt`, then run
`python analysis/summarize.py results.txt` for per-person numbers, the average effect, and a
permutation-test p-value. (The install link needs this repo to be public.)

## Shipping to other people

1. **Apple Developer Program** ($99/yr, one account covers every app).
2. Phase 2 above, then create the app in **App Store Connect** and add testers.
3. **TestFlight**: up to 100 internal testers by email (no review) or 10,000 external by link (quick beta review).
4. **App Store review**: no Instagram name/logo in the app name, icon or screenshots; frame it as digital wellbeing.
5. **Screen Time** needs Apple to approve a Family Controls *distribution* request for the app **and each extension**. Submit right after enrolling; extension approvals can take weeks.

## Debugging

Turn on **Settings → Friction → Debug logging** to log every hold/stall/spring-back. On desktop, run
`__friction.status()` in the console. Instagram's web code changes often; if feed delays stop firing,
the friendly-name regex `FEEDISH` in `friction.js` is the first thing to check.
