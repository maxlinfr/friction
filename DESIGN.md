# Friction: design principles

Read with CLAUDE.md. These are the judgement calls already made; agents check their work against
them. Changing one is a conversation with the owner, not an implementation detail.

## Friction feel
1. **It should read as bad wifi or a clunky app, never as a nag.** No popups, timers, counters,
   guilt copy or "you've been scrolling for X minutes". If a user could screenshot it and say
   "the app is judging me", it's wrong.
2. **Never show a paused state.** Buffering uses `playbackRate = 0`, not `pause()`, so Instagram's
   own paused UI never appears. Spinners imitate Instagram's own loading indicator.
3. **Nothing mechanical.** Every delay has lognormal jitter. No fixed intervals someone could learn.
4. **Ramp, don't wall.** Friction starts mild and grows with time on the surface. Grace periods
   before colour drain (5 min) and sticky swipes (3 min).
5. **Fade, never snap.** Visual changes transition (colour returns over 2 s when you leave a surface).
6. **Never touch what matters.** DMs, profiles, posting, stories you open on purpose, settings and
   login: zero friction, always. A mutation request (like, comment, follow) is never delayed.
7. **No flash of the next reel.** A video stays hidden until friction releases it.

## App UI (wrapper and later the hub)
1. **Plain and native.** System fonts, system colours, SF Symbols, light and dark mode. No brand
   theatre; the app should feel like a utility.
2. **Out of the way.** Settings live in iOS Settings until there's a real reason for in-app UI.
3. **No Instagram name, logo or look-alike** in the app name, icon or screenshots (App Store review).
   Frame it as digital wellbeing.
4. **Hub (Phase 3):** a home screen of plain tiles, one per site. Opening a site should feel like
   opening that site, not a dashboard.

## Stats and experiment
1. Stats are opt-in to view (`#friction`), local-only, and exportable as a code the user chooses to send.
2. The stats panel is the one place we may look like our own UI; keep it small and neutral.
