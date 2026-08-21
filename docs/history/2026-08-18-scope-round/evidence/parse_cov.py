"""Parse v8 coverage-final.json and emit per-file coverage + uncovered lines.

Output: .tmp_scope_eval/coverage_summary.json + .tmp_scope_eval/coverage_uncovered.txt
"""
import json
import sys
from pathlib import Path

src = Path(r"D:\by56_CAP_Agent\coverage\coverage-final.json")
dst_summary = Path(r"D:\by56_CAP_Agent\.tmp_scope_eval\coverage_summary.json")
dst_uncovered = Path(r"D:\by56_CAP_Agent\.tmp_scope_eval\coverage_uncovered.txt")

data = json.loads(src.read_text(encoding="utf-8"))

# We only care about TS files in server/, utils/, shared/, composables/,
# and key API endpoints.  Vue / .nuxt config etc are excluded by §4 #7.
KEEP_PREFIXES = (
    "D:\\by56_CAP_Agent\\server\\",
    "D:\\by56_CAP_Agent\\utils\\",
    "D:\\by56_CAP_Agent\\shared\\",
    "D:\\by56_CAP_Agent\\composables\\",
)

def is_tracked(path: str) -> bool:
    return path.startswith(KEEP_PREFIXES)

summary = []
uncovered_lines_by_file = {}

for path, info in data.items():
    if not is_tracked(path):
        continue

    sm = info.get("statementMap", {})
    s = info.get("s", {})
    bm = info.get("branchMap", {})
    b = info.get("b", {})
    fm = info.get("fnMap", {})
    f = info.get("f", {})

    total_stmts = len(sm)
    hit_stmts = sum(1 for k, v in s.items() if v > 0)
    pct_stmts = (hit_stmts / total_stmts * 100) if total_stmts else 0.0

    total_branches = 0
    hit_branches = 0
    for k, arr in b.items():
        total_branches += len(arr)
        hit_branches += sum(1 for v in arr if v > 0)
    pct_branches = (hit_branches / total_branches * 100) if total_branches else 0.0

    total_fns = len(fm)
    hit_fns = sum(1 for v in f.values() if v > 0)
    pct_fns = (hit_fns / total_fns * 100) if total_fns else 0.0

    # Collect uncovered statement lines
    uncovered = []
    for stmt_id, hits in s.items():
        if hits == 0 and stmt_id in sm:
            start = sm[stmt_id]["start"]["line"]
            end = sm[stmt_id]["end"]["line"]
            uncovered.append(f"L{start}-{end}" if end != start else f"L{start}")

    # Collect uncovered branch line numbers (line key is on the parent)
    uncovered_branches = []
    for branch_id, arr in b.items():
        if branch_id in bm and any(v == 0 for v in arr):
            line = bm[branch_id]["loc"]["start"]["line"]
            uncovered_branches.append(f"L{line}")

    uncovered_lines_by_file[path] = {
        "stmts_uncovered": uncovered,
        "stmts_uncovered_count": len(uncovered),
        "branches_uncovered": uncovered_branches,
        "branches_uncovered_count": len(uncovered_branches),
        "pct_stmts": pct_stmts,
        "pct_branches": pct_branches,
        "pct_fns": pct_fns,
        "total_stmts": total_stmts,
        "total_branches": total_branches,
        "total_fns": total_fns,
    }

    summary.append({
        "path": path,
        "stmts": f"{hit_stmts}/{total_stmts} ({pct_stmts:.1f}%)",
        "branches": f"{hit_branches}/{total_branches} ({pct_branches:.1f}%)",
        "fns": f"{hit_fns}/{total_fns} ({pct_fns:.1f}%)",
        "stmts_uncovered_count": len(uncovered),
        "branches_uncovered_count": len(uncovered_branches),
    })

# Sort by statement coverage ascending (lowest first = biggest gap)
summary.sort(key=lambda x: float(x["stmts"].split("(")[1].rstrip("%)")))

dst_summary.write_text(
    json.dumps(
        {"files": summary, "uncovered_lines": uncovered_lines_by_file},
        indent=2,
        ensure_ascii=False,
    ),
    encoding="utf-8",
)

# Write a flat text file too
lines = []
for entry in summary:
    p = entry["path"]
    info = uncovered_lines_by_file[p]
    lines.append(
        f"{p}\n"
        f"  stmts {entry['stmts']}  branches {entry['branches']}  fns {entry['fns']}\n"
        f"  uncovered stmts ({info['stmts_uncovered_count']}): "
        f"{', '.join(info['stmts_uncovered'][:30])}\n"
        f"  uncovered branches ({info['branches_uncovered_count']}): "
        f"{', '.join(info['branches_uncovered'][:30])}\n"
    )

dst_uncovered.write_text("\n".join(lines), encoding="utf-8")
print(f"wrote {dst_summary} and {dst_uncovered}")
print(f"tracked files: {len(summary)}")
for e in summary[:5]:
    print(f"  LOW: {e['path']}  stmts={e['stmts']}  uncovered_stmts={e['stmts_uncovered_count']}")
