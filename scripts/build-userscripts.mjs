#!/usr/bin/env node
// Regenerates testing/*.user.js = userscript header + exact copy of the engine.
// The engine (Friction/Resources/friction.js) is the single source of truth; the headers
// below are the only hand-maintained part of the userscripts. Never edit testing/*.user.js.
//
//   node scripts/build-userscripts.mjs           rewrite the files
//   node scripts/build-userscripts.mjs --check   exit 1 if any file is out of date (CI)
//
// Output is always LF and UTF-8, whatever the checkout's line endings are.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ENGINE = join(ROOT, 'Friction', 'Resources', 'friction.js');

// Each header ends with the config line; a blank line separates it from the engine.
const TARGETS = [
  {
    file: 'testing/friction.user.js',
    header: `// ==UserScript==
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
`,
  },
  {
    file: 'testing/friction-friends.user.js',
    header: `// ==UserScript==
// @name         Friction
// @namespace    friction
// @version      0.2.0
// @description  Instagram quietly gets slower the longer you doomscroll. Experiment mode: each day is randomly ON or OFF.
// @match        https://www.instagram.com/*
// @run-at       document-start
// @inject-into  page
// @grant        none
// @downloadURL  https://raw.githubusercontent.com/maxlinfr/friction/main/testing/friction-friends.user.js
// @updateURL    https://raw.githubusercontent.com/maxlinfr/friction/main/testing/friction-friends.user.js
// ==/UserScript==

// Stats: open instagram.com/#friction
window.__FRICTION_CONFIG__ = { intensity: 1.0, experiment: true, debug: false };
`,
  },
];

const lf = (s) => s.replace(/\r\n?/g, '\n');

function main() {
  const check = process.argv.includes('--check');
  const engine = lf(readFileSync(ENGINE, 'utf8')).replace(/^﻿/, '');
  let stale = 0;
  for (const { file, header } of TARGETS) {
    const path = join(ROOT, file);
    const want = lf(header) + '\n' + engine;
    const have = existsSync(path) ? lf(readFileSync(path, 'utf8')) : null;
    const name = relative(ROOT, path).replace(/\\/g, '/');
    if (have === want) {
      console.log(`up to date  ${name}`);
      continue;
    }
    if (check) {
      stale++;
      console.error(`OUT OF DATE ${name}`);
    } else {
      writeFileSync(path, want, 'utf8');
      console.log(`wrote       ${name}`);
    }
  }
  if (stale) {
    console.error(`\n${stale} userscript(s) out of date. Run: node scripts/build-userscripts.mjs`);
    process.exit(1);
  }
}

main();
