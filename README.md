# Friction

Instagram that gets quietly worse the longer you doomscroll: no popups, no blocking.

The app is a full-screen instagram.com with a script (`Friction/Resources/friction.js`) injected into every page.
Friction only applies on **Reels, Explore and the home feed**. DMs, profiles and posting are never touched.

| Mechanic | What the user feels | Ramp |
|---|---|---|
| Slow pagination | feed "runs out" for a beat, like bad wifi | delay ≈ 600 ms × (1 + 0.06·min) |
| Video start hold | reel sits on first frame like it's buffering | ≈ 350 ms at start → ~1 s at 30 min |
| Late audio | sound kicks in ~0.5 s after video (35% of reels) | random |
| Colour drain | saturation creeps down after 5 min, floor 55% | −1.2%/min, 2 s fade back out |
| Sticky swipes | some swipes spring back on Reels after 3 min | 2% → 15% |

All delays are `base × intensity × (1 + αt) × ε`, with ε lognormal (mean 1), so it never feels mechanical.
The session clock resets after 10 minutes away. Intensity (Off / Light / Normal / Strong) lives in **iOS Settings → Friction**.

## Project layout

```
project.yml                 XcodeGen spec → generates Friction.xcodeproj
Friction/FrictionApp.swift  app entry
Friction/BrowserView.swift  WKWebView wrapper, script injection, link handling
Friction/FrictionSettings.swift
Friction/Resources/friction.js        the friction engine
Friction/Resources/Settings.bundle    the iOS Settings pane
.github/workflows/build.yml           builds an unsigned .ipa on a cloud Mac
```

## Getting it on your iPhone from Windows (free)

You can't run Xcode on Windows, so GitHub's Macs build it and Sideloadly installs it.

1. Push this folder to a GitHub repo (public = unlimited free Mac minutes; private = ~200 Mac-minutes/month free, plenty for this).
2. Open the repo's **Actions** tab, wait for the `build` run (~4 min), then download **Friction-unsigned-ipa** from the run's Artifacts.
3. On Windows, install **iTunes** and **iCloud** (the apple.com versions, not the Microsoft Store ones), then **Sideloadly** (sideloadly.io).
4. Plug in your iPhone, drag the .ipa into Sideloadly, and sign in with your Apple ID. It signs and installs the app.
5. On the phone: **Settings → Privacy & Security → Developer Mode → On** (restart), then **Settings → General → VPN & Device Management** → trust your Apple ID.

With a free Apple ID the install expires after **7 days**; just re-run Sideloadly.

## Shipping to other people

1. **Apple Developer Program** ($99/yr): needed for TestFlight and the App Store.
2. Set a real bundle ID in `project.yml` (e.g. `com.yourname.friction`), add an app icon (required for upload).
3. Create the app in **App Store Connect**, then upload builds from CI using an App Store Connect API key (or use Codemagic, which handles signing + TestFlight with no Mac).
4. **TestFlight**: share a link with up to 10,000 testers. Do this before App Store review.
5. **App Store review**: don't use Instagram's name/logo in the app name, icon or screenshots. Lean on "digital wellbeing" framing.
6. **v2 — Screen Time redirect** (sends you here when you open the real Instagram): needs the Family Controls entitlement, and Apple must approve a *distribution* request for it. Apply early; approval can take weeks.

## Debugging

Turn on **Settings → Friction → Debug logging** to log every hold/spring-back. Instagram's web code changes often;
if feed delays stop firing, the friendly-name regex `FEEDISH` in `friction.js` is the first thing to check.
