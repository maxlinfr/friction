// PreToolUse hook (Bash|PowerShell): enforces CLAUDE.md hard rules at commit/push time.
//   git commit:
//     - innerHTML / outerHTML / insertAdjacentHTML / document.write in friction.js  -> deny  (rule 4)
//     - private keys / tokens in staged or pending changes, or signing files        -> deny  (rule 5)
//     - the T tunables (or ALPHA / SIGMA) differ from HEAD                          -> ask   (rule 7)
//   git push:
//     - --force / -f / +refspec                                                     -> deny
//     - pushing to main                                                             -> ask
// Fails open: a bug in this hook must never block unrelated work.
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ENGINE = 'Friction/Resources/friction.js';

const out = (decision, reason) => {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: decision, permissionDecisionReason: reason },
  }));
  process.exit(0);
};

let raw = '';
process.stdin.on('data', (c) => (raw += c));
process.stdin.on('end', () => {
  try { main(JSON.parse(raw || '{}')); } catch (_) {}
  process.exit(0);
});

function main(input) {
  const cmd = String((input.tool_input || {}).command || '');
  const cwd = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
  const git = (...args) => {
    try { return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 << 20 }); }
    catch (_) { return null; }
  };
  // Split on shell separators so `git add -A && git commit` is seen as two commands.
  const parts = cmd.split(/&&|\|\||;|\n|\|/).map((s) => s.trim());
  const isGit = (p, sub) => new RegExp('^(?:\\S+=\\S+\\s+)*git(?:\\.exe)?\\b(?:\\s+-[cC]\\s+\\S+|\\s+--?[\\w-]+(?:=\\S+)?)*\\s+' + sub + '\\b').test(p);

  const pushes = parts.filter((p) => isGit(p, 'push'));
  for (const p of pushes) {
    if (/\s(--force(-with-lease)?|-f)\b|\s\+\S/.test(p)) out('deny', 'Force-push is not allowed in this repo. Make a new commit instead.');
  }
  for (const p of pushes) {
    const branch = (git('rev-parse', '--abbrev-ref', 'HEAD') || '').trim();
    const args = p.replace(/^.*?\bpush\b/, '').trim().split(/\s+/).filter((a) => a && !a.startsWith('-'));
    const target = args.length >= 2 ? args.slice(1).join(' ') : branch;
    if (/(^|[\s:/])main\b/.test(target)) out('ask', 'This pushes to main. Owner: approve only if this change is CI-verified and meant for main.');
  }

  if (!parts.some((p) => isGit(p, 'commit'))) return;

  // --- engine checks: look at both the staged and the working-tree version
  const versions = [];
  const staged = git('show', ':' + ENGINE);
  if (staged != null) versions.push(staged);
  try { versions.push(readFileSync(join(cwd, ENGINE), 'utf8')); } catch (_) {}
  const head = git('show', 'HEAD:' + ENGINE);

  const DOM_HTML = /\.(innerHTML|outerHTML)\s*\+?=|\binsertAdjacentHTML\s*\(|\bdocument\.write(ln)?\s*\(/;
  for (const v of versions) {
    const hit = v.split('\n').find((l) => DOM_HTML.test(l.replace(/\/\/.*$/, '')));
    if (hit) out('deny', 'friction.js uses an HTML-string DOM API (CLAUDE.md rule 4, Trusted Types): ' + hit.trim().slice(0, 160));
  }

  const tunables = (src) => {
    if (src == null) return null;
    src = src.replace(/\r\n/g, '\n');
    const t = (src.match(/const T = \{[\s\S]*?\n\s*\};/) || [''])[0];
    const a = (src.match(/const ALPHA\s*=\s*[^;]+;/) || [''])[0];
    const s = (src.match(/const SIGMA\s*=\s*[^;]+;/) || [''])[0];
    return [t, a, s].join('\n').replace(/\/\/.*$/gm, '').replace(/\s+/g, ' ').trim();
  };
  const headT = tunables(head);
  if (headT != null && versions.some((v) => tunables(v) !== headT)) {
    out('ask', 'The friction feel defaults (T / ALPHA / SIGMA in friction.js) differ from HEAD. ' +
      'CLAUDE.md rule 7: the owner must approve feel changes. Approve only if you agreed to these numbers.');
  }

  // --- secrets: staged + unstaged added lines, and untracked files that `git add -A` would pick up
  const SECRET = [
    /-----BEGIN ([A-Z]+ )?PRIVATE KEY-----/,
    /\bghp_[A-Za-z0-9]{30,}/, /\bgithub_pat_[A-Za-z0-9_]{30,}/,
    /\bAKIA[0-9A-Z]{16}\b/,
    /\bsk-ant-[A-Za-z0-9_-]{20,}/,
  ];
  const SECRET_FILE = /(^|\/)(\.env(\..+)?|.+\.(p8|p12|pem|key|mobileprovision|cer))$/i;
  const added = [git('diff', '--cached', '-U0'), git('diff', '-U0')]
    .filter(Boolean).join('\n').split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++'));
  const changedFiles = [git('diff', '--cached', '--name-only'), git('diff', '--name-only'),
    git('ls-files', '--others', '--exclude-standard')].filter(Boolean).join('\n').split('\n').filter(Boolean);
  const badFile = changedFiles.find((f) => SECRET_FILE.test(f));
  if (badFile) out('deny', 'Refusing to commit a credential/signing file: ' + badFile + ' (CLAUDE.md rule 5). Add it to .gitignore.');
  const untracked = (git('ls-files', '--others', '--exclude-standard') || '').split('\n').filter(Boolean);
  for (const f of untracked) {
    try {
      const p = join(cwd, f);
      if (existsSync(p) && statSync(p).size < 1 << 20) added.push(...readFileSync(p, 'utf8').split('\n'));
    } catch (_) {}
  }
  for (const l of added) {
    const re = SECRET.find((r) => r.test(l));
    if (re) out('deny', 'Possible secret in the changes being committed (matched ' + re + '). CLAUDE.md rule 5: secrets go in CI secrets only.');
  }
}
