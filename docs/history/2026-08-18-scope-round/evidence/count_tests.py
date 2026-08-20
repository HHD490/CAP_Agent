"""Count it() / it.each() in each test file and emit a per-file row + invariant summary."""
import re
from pathlib import Path

root = Path(r"D:\by56_CAP_Agent\tests")
files = sorted(root.rglob("*.test.ts"))

# Approx 1-line invariant tag from each test's leading it() identifier.
# We render it as: TC | path | first invariant (truncated)
rows = []
for f in files:
    text = f.read_text(encoding="utf-8")
    # Count it('...', ...)
    it_count = len(re.findall(r"\bit\(\s*['\"]", text))
    # Count it.each([...])( -> count brackets. Approx by counting the start.
    it_each_count = len(re.findall(r"\bit\.each\(", text))
    # Detect describe blocks for grouping
    describe_count = len(re.findall(r"\bdescribe\(\s*['\"]", text))
    # Extract first it() identifier (TC tag) as invariant hint
    m = re.search(r"\bit\(\s*['\"]([A-Z][A-Z0-9-]{2,40})", text)
    first_tag = m.group(1) if m else "(no tag)"
    # file rel path
    rel = str(f.relative_to(r"D:\by56_CAP_Agent"))
    rows.append((rel, it_count, it_each_count, describe_count, first_tag, f.stat().st_size))

# Sort: it_count desc
rows.sort(key=lambda r: (-r[1], r[0]))

total = sum(r[1] for r in rows)
print(f"files={len(rows)}  total it()={total}\n")
print(f"{'rel_path':55s}  {'it':>4s}  {'each':>4s}  {'desc':>4s}  size  first_tag")
for rel, itc, ie, d, ft, sz in rows:
    print(f"{rel:55s}  {itc:>4d}  {ie:>4d}  {d:>4d}  {sz:>5d}  {ft}")
