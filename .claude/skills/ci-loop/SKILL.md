---
name: ci-loop
description: Use after any change to Swift, project.yml, the workflow, or friction.js — pushes, waits for the GitHub Actions macOS build, reads failures and screenshots, and fixes until green. This is the only way to verify iOS code in this repo.
---

# CI build-review loop

There is no local Mac. GitHub Actions is the compiler, the simulator and the test runner.

1. **Before pushing:** run local checks that exist — `node --check Friction/Resources/friction.js`,
   the Playwright tests (`npx playwright test`) once Phase 1 adds them, and
   `node scripts/build-userscripts.mjs` if the engine changed. Fix anything local first.
2. **Commit one concern** with a clear message, then `git push`.
3. **Wait for CI:** `gh run watch --exit-status` (picks the latest run; use `gh run list -L 3` to
   find the run id if needed).
4. **If it failed:** `gh run view <id> --log-failed`. Read the *first* real error (Swift errors cascade;
   later ones are often noise). Fix the cause, not the symptom. Go to step 2.
5. **If it passed and the change touches UI:** `gh run download <id> -n screenshots -D ci-screens`
   then look at every image. Describe what you see and whether it matches the intent.
   (`ci-screens/` is gitignored.)
6. **Stop after 5 failed iterations on the same problem.** Summarise what you tried, the current
   error, and your best hypothesis, then ask the owner. Don't thrash.
7. **Report at the end:** what changed, CI run link (`gh run view <id> --web` prints it), what the
   screenshots showed, and anything the owner must verify on a real phone.
