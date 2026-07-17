#!/usr/bin/env python3
"""Mechanical format checker for generated todo.md files.

Usage: python3 check_todo_format.py <path-to-todo.md> [--shared-files f1,f2]

Emits JSON: {"checks": [{"name", "passed", "evidence"}], "tasks": N}
Checks the machine-parseable contract of the planning-and-task-breakdown skill:
  - task ids T-XXX (3-digit zero-padded), sequential from T-001
  - dedicated Deps: line containing only ids or 'none'
  - Size: on its own line, value in {XS,S,M,L}
  - Risk: on its own line, value in {S,M,L,XL}
  - Files: on its own line
  - Deps reference existing ids; graph acyclic
  - (optional) tasks sharing one of --shared-files are serialized via Deps path
"""
import json
import re
import sys
from pathlib import Path

TASK_RE = re.compile(r"^- \[( |x)\] (T-\d+): (.+)$")
STRICT_ID_RE = re.compile(r"^T-\d{3}$")
DEPS_RE = re.compile(r"^\s+Deps: (none|T-\d{3}(?:, T-\d{3})*)\s*$")
DEPS_LOOSE_RE = re.compile(r"^\s+Deps:", re.IGNORECASE)
SIZE_RE = re.compile(r"^\s+Size: (XS|S|M|L)\s*$")
SIZE_LOOSE_RE = re.compile(r"^\s+Size:", re.IGNORECASE)
RISK_RE = re.compile(r"^\s+Risk: (S|M|L|XL)\s*$")
RISK_LOOSE_RE = re.compile(r"^\s+Risk:", re.IGNORECASE)
FILES_LOOSE_RE = re.compile(r"^\s+Files:\s*(.+)$")
ID_TOKEN_RE = re.compile(r"T-\d{3}")


def main() -> None:
    path = Path(sys.argv[1])
    shared_files = []
    if "--shared-files" in sys.argv:
        shared_files = sys.argv[sys.argv.index("--shared-files") + 1].split(",")

    checks = []

    def check(name, passed, evidence):
        checks.append({"name": name, "passed": bool(passed), "evidence": evidence})

    if not path.exists():
        check("todo-md-exists", False, f"{path} not found")
        print(json.dumps({"checks": checks, "tasks": 0}, indent=2))
        return
    check("todo-md-exists", True, str(path))

    lines = path.read_text(encoding="utf-8").splitlines()

    # Split into tasks: checkbox line + indented body until next non-indented line.
    tasks = []  # {id, title, line_no, body: [lines]}
    current = None
    for i, line in enumerate(lines, 1):
        m = TASK_RE.match(line)
        if m:
            current = {"id": m.group(2), "title": m.group(3), "line": i, "body": []}
            tasks.append(current)
        elif current is not None:
            if line.startswith((" ", "\t")):
                current["body"].append(line)
            elif line.strip() == "":
                continue
            else:
                current = None

    ids = [t["id"] for t in tasks]
    check("has-tasks", len(tasks) > 0, f"{len(tasks)} task(s) found")

    bad_ids = [i for i in ids if not STRICT_ID_RE.match(i)]
    check(
        "task-ids-are-T-XXX-3-digit",
        len(tasks) > 0 and not bad_ids,
        f"off-format ids: {bad_ids}" if bad_ids else f"all {len(ids)} ids zero-padded 3-digit",
    )

    expected = [f"T-{n:03d}" for n in range(1, len(ids) + 1)]
    check(
        "task-ids-sequential-from-001",
        len(tasks) > 0 and sorted(ids) == expected,
        f"ids: {ids}" if sorted(ids) != expected else "sequential T-001..T-%03d" % len(ids),
    )

    dup = sorted({i for i in ids if ids.count(i) > 1})
    check("task-ids-unique", len(tasks) > 0 and not dup, f"duplicated: {dup}" if dup else "no duplicates")

    # Per-task field checks
    deps_map = {}
    files_map = {}
    problems = {"deps": [], "size": [], "risk": [], "files": []}
    for t in tasks:
        body = t["body"]
        deps_lines = [l for l in body if DEPS_LOOSE_RE.match(l)]
        if len(deps_lines) != 1 or not DEPS_RE.match(deps_lines[0]):
            problems["deps"].append(f"{t['id']}: {deps_lines or 'missing'}")
            deps_map[t["id"]] = ID_TOKEN_RE.findall(deps_lines[0]) if deps_lines else []
        else:
            deps_map[t["id"]] = ID_TOKEN_RE.findall(deps_lines[0])

        size_lines = [l for l in body if SIZE_LOOSE_RE.match(l)]
        if len(size_lines) != 1 or not SIZE_RE.match(size_lines[0]):
            problems["size"].append(f"{t['id']}: {size_lines or 'missing'}")

        risk_lines = [l for l in body if RISK_LOOSE_RE.match(l)]
        if len(risk_lines) != 1 or not RISK_RE.match(risk_lines[0]):
            problems["risk"].append(f"{t['id']}: {risk_lines or 'missing'}")

        file_lines = [l for l in body if FILES_LOOSE_RE.match(l)]
        if len(file_lines) != 1:
            problems["files"].append(f"{t['id']}: {len(file_lines)} Files: lines")
            files_map[t["id"]] = []
        else:
            raw = FILES_LOOSE_RE.match(file_lines[0]).group(1)
            files_map[t["id"]] = [f.strip().rstrip(".") for f in raw.split(",") if f.strip()]

    check(
        "deps-dedicated-line-ids-only",
        len(tasks) > 0 and not problems["deps"],
        problems["deps"] or "every task has exactly one Deps: line with only ids/none",
    )
    check(
        "size-own-line-no-XL",
        len(tasks) > 0 and not problems["size"],
        problems["size"] or "every task has Size: on its own line, XS/S/M/L",
    )
    check(
        "risk-own-line-S-M-L-XL",
        len(tasks) > 0 and not problems["risk"],
        problems["risk"] or "every task has Risk: on its own line, S/M/L/XL",
    )
    check(
        "files-own-line",
        len(tasks) > 0 and not problems["files"],
        problems["files"] or "every task has exactly one Files: line",
    )

    # Dependency references + cycles
    orphans = [
        f"{tid} -> {d}" for tid, deps in deps_map.items() for d in deps if d not in deps_map
    ]
    check(
        "deps-reference-existing-tasks",
        len(tasks) > 0 and not orphans,
        orphans or "all Deps ids exist",
    )

    def has_cycle():
        WHITE, GRAY, BLACK = 0, 1, 2
        color = {i: WHITE for i in deps_map}

        def dfs(u):
            color[u] = GRAY
            for v in deps_map.get(u, []):
                if v not in color:
                    continue
                if color[v] == GRAY or (color[v] == WHITE and dfs(v)):
                    return True
            color[u] = BLACK
            return False

        return any(color[i] == WHITE and dfs(i) for i in list(deps_map))

    check("deps-graph-acyclic", len(tasks) > 0 and not has_cycle(), "cycle detected" if has_cycle() else "acyclic")

    # Shared-file serialization (transitive reachability between tasks sharing a file)
    if shared_files:
        def reaches(src, dst, seen=None):
            seen = seen or set()
            if src == dst:
                return True
            seen.add(src)
            return any(d not in seen and reaches(d, dst, seen) for d in deps_map.get(src, []))

        unserialized = []
        tids = list(files_map)
        for sf in shared_files:
            owners = [t for t in tids if any(sf in f for f in files_map[t])]
            for a_i in range(len(owners)):
                for b_i in range(a_i + 1, len(owners)):
                    a, b = owners[a_i], owners[b_i]
                    if not (reaches(a, b) or reaches(b, a)):
                        unserialized.append(f"{sf}: {a} ∥ {b}")
        check(
            "shared-file-edits-serialized-via-deps",
            not unserialized,
            unserialized or f"tasks sharing {shared_files} are connected by Deps paths",
        )

    print(json.dumps({"checks": checks, "tasks": len(tasks)}, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
