"""Summarize Friction experiment results.

Usage:
    python analysis/summarize.py results.txt

results.txt: one "FR1:..." code per line (what each person copies from
instagram.com/#friction). Lines starting with # are ignored; you can put a
name before the code, e.g.  "jake FR1:eyJp...".

Each person's days are randomly ON/OFF (50/50). Days a person didn't scroll at
all are reconstructed as 0 minutes, because the ON/OFF schedule is a known
function of (id, date). The effect estimate is the average within-person
difference, and the p-value comes from a permutation test that reshuffles
ON/OFF labels within each person.
"""
import base64
import json
import random
import sys
from collections import defaultdict
from datetime import date, timedelta


def fnv(s: str) -> int:
    """Same 32-bit FNV-1a hash the engine uses to assign ON/OFF days."""
    h = 2166136261
    for ch in s:
        h ^= ord(ch)
        h = (h * 16777619) & 0xFFFFFFFF
    return h


def condition(pid: str, day: str) -> int:
    return 1 if fnv(f"{pid}|{day}") % 2 else 0  # 1 = ON, 0 = OFF


def decode(line: str):
    code = line[line.index("FR1:") + 4:].strip()
    data = json.loads(base64.b64decode(code + "=" * (-len(code) % 4)))
    name = line[: line.index("FR1:")].strip() or data["id"]
    return name, data["id"], data["l"]  # l: [day, on, seconds, reels]


def person_days(pid, log):
    """Daily totals for every day in the person's window, zeros included."""
    minutes, reels = defaultdict(float), defaultdict(int)
    for day, _on, sec, r in log:
        minutes[day] += sec / 60
        reels[day] += r
    days = sorted(minutes)
    if not days:
        return []
    d0, d1 = date.fromisoformat(days[0]), date.fromisoformat(days[-1])
    out = []
    while d0 <= d1:
        k = d0.isoformat()
        out.append((k, condition(pid, k), minutes.get(k, 0.0), reels.get(k, 0)))
        d0 += timedelta(days=1)
    return out


def effect(people):
    """Mean over people of (mean ON minutes - mean OFF minutes)."""
    diffs = []
    for days in people:
        on = [m for _, c, m, _ in days if c == 1]
        off = [m for _, c, m, _ in days if c == 0]
        if on and off:
            diffs.append(sum(on) / len(on) - sum(off) / len(off))
    return sum(diffs) / len(diffs) if diffs else float("nan"), diffs


def main(path):
    lines = [l for l in open(path, encoding="utf-8") if "FR1:" in l and not l.lstrip().startswith("#")]
    people, rows = [], []
    for line in lines:
        name, pid, log = decode(line)
        days = person_days(pid, log)
        if not days:
            continue
        people.append(days)
        on = [d for d in days if d[1] == 1]
        off = [d for d in days if d[1] == 0]
        avg = lambda xs, i: sum(x[i] for x in xs) / len(xs) if xs else float("nan")
        rows.append((name, len(on), len(off), avg(on, 2), avg(off, 2), avg(on, 3), avg(off, 3)))

    print(f"{'person':<14}{'ON d':>5}{'OFF d':>6}{'min/day ON':>12}{'OFF':>8}{'reels/day ON':>14}{'OFF':>8}")
    for r in rows:
        print(f"{r[0]:<14}{r[1]:>5}{r[2]:>6}{r[3]:>12.1f}{r[4]:>8.1f}{r[5]:>14.1f}{r[6]:>8.1f}")

    obs, diffs = effect(people)
    off_mean = sum(r[4] for r in rows if r[4] == r[4]) / max(1, sum(1 for r in rows if r[4] == r[4]))
    print(f"\nAverage within-person change on ON days: {obs:+.1f} min/day"
          + (f"  ({obs / off_mean:+.0%} vs OFF days)" if off_mean else ""))

    # Permutation test: shuffle ON/OFF labels within each person.
    rng, n, hits = random.Random(0), 10000, 0
    for _ in range(n):
        shuffled = []
        for days in people:
            labels = [c for _, c, _, _ in days]
            rng.shuffle(labels)
            shuffled.append([(d, l, m, r) for (d, _, m, r), l in zip(days, labels)])
        e, _ = effect(shuffled)
        if abs(e) >= abs(obs):
            hits += 1
    print(f"Permutation p-value (two-sided, {n} shuffles): {hits / n:.3f}")
    print(f"People with both ON and OFF days: {len(diffs)}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "results.txt")
