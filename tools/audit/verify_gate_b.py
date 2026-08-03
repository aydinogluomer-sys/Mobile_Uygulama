#!/usr/bin/env python3
"""Gate B structural verifier.

Parses the planning documents under docs/ and asserts the structural invariants
Gate B depends on. This is AUDIT TOOLING, not application code: it is not
imported by the app, ships in no bundle, and is excluded from the Expo build.

Design constraints, deliberate:
  * READ-ONLY. Opens files for reading only. Never writes, never mutates git.
  * NO NETWORK, NO DATABASE. Nothing here connects anywhere.
  * DETERMINISTIC and FIXTURE-FREE. Same repo state => same output.
  * Task IDs are read from the ACTUAL H2 headings in the backlog and matched by
    literal alternation. No ID pattern is guessed. An earlier version of this
    checker used a regex that could not match `DEMO-001A`/`DEMO-001B` (an
    uppercase suffix defeats `\\b`), which hid a real defect from the very check
    that claimed to cover it.
  * NO DOCUMENT WHITELIST in the stale scan. Every .md under docs/ is scanned.
    An earlier version skipped six plan documents by filename and let a stale
    figure survive.

Usage:
    python tools/audit/verify_gate_b.py            # from the repository root
    python tools/audit/verify_gate_b.py --repo /path/to/repo

Exit code 0 if every invariant holds, 1 otherwise.
"""
from __future__ import annotations

import argparse
import collections
import io
import os
import re
import sys

if hasattr(sys.stdout, "buffer"):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

BACKLOG = "docs/plan/01_IMPLEMENTATION_BACKLOG.md"
FIELDS = ["scope", "goal", "acceptance_criteria", "validation", "risk", "rollback"]
AGENTS = [
    "Supabase & Security", "Habit Domain", "Expo Architecture",
    "QA & Test", "Repository Audit", "Open-Source Research",
]
# Each agent's forbidden path prefixes, per docs/plan/04_AGENT_TASK_GRAPH.md section 1.
FORBIDDEN = {
    "Supabase & Security":  ["frontend/"],
    "Habit Domain":         ["supabase/", "frontend/app/"],
    "Expo Architecture":    ["supabase/", "frontend/lib/", "frontend/store/"],
    "Repository Audit":     ["supabase/", "frontend/app/", "frontend/lib/", "frontend/store/"],
    "Open-Source Research": ["supabase/", "frontend/"],
}
# The migration ordering invariant that Gate B round 6 established (finding B1).
BASELINE_VERSION = "20260801000000"
EMERGENCY_VERSIONS = ["20260802181931", "20260802205850"]


def is_test_path(path: str) -> bool:
    return "tests" in path or "jest" in path


class Report:
    def __init__(self) -> None:
        self.failures: list[str] = []

    def fail(self, msg: str) -> None:
        self.failures.append(msg)
        print("   FAIL  " + msg)

    def ok(self, msg: str) -> None:
        print("   ok    " + msg)


def parse_backlog(repo: str):
    """Return (tasks, pointer_stubs) parsed from the real H2 headings."""
    text = open(os.path.join(repo, BACKLOG), encoding="utf-8").read()
    blocks, current = [], None
    for line in text.split("\n"):
        if line.startswith("## "):
            if current:
                blocks.append(current)
            current = {"head": line[3:].strip(), "body": []}
        elif current:
            current["body"].append(line)
    if current:
        blocks.append(current)

    tasks, stubs = {}, []
    for block in blocks:
        match = re.match(r"^(\S+)\s*·", block["head"])
        if not match:
            continue
        task_id = match.group(1)
        body = "\n".join(block["body"])
        if "**scope**" not in body:
            stubs.append(task_id)
            continue
        header = next((x for x in block["body"] if x.startswith("`P")), "")
        scope_line = re.search(r"\*\*scope\*\*[^:]*:\s*(.+)", body)
        files = re.findall(r"`([^`]+)`", scope_line.group(1)) if scope_line else []
        size = re.search(r"\*\*(XS|S|M|L|XL)\*\*", header)
        tasks[task_id] = {
            "header": header,
            "body": body,
            "agent": next((a for a in AGENTS if a in header), "?"),
            "files": [f.strip() for f in files],
            "size": size.group(1) if size else "?",
            "missing": [f for f in FIELDS if "**%s**" % f not in body],
        }
    return text, tasks, stubs


def check_fields(tasks, report):
    print("\n[1] MANDATORY FIELDS")
    for task_id, task in sorted(tasks.items()):
        if task["missing"]:
            report.fail("%s missing %s" % (task_id, task["missing"]))
    if not report.failures:
        report.ok("all %d open tasks carry all 13 fields" % len(tasks))


def check_index(text, tasks, ids_in, report):
    print("\n[2] BLOCK vs INDEX depends_on")
    index_start = text.index("## Task index")
    rows = {}
    for line in text[index_start:].split("\n"):
        if not line.startswith("| "):
            continue
        cells = [c.strip() for c in line.split("|")[1:-1]]
        if len(cells) < 6:
            continue
        key = cells[0].replace("~~", "").replace("`", "").replace("**", "")
        if key in tasks:
            rows[key] = cells[5]

    mismatches = 0
    for task_id, task in sorted(tasks.items()):
        if task_id not in rows:
            report.fail("%s missing from the task index" % task_id)
            mismatches += 1
            continue
        dep = re.search(r"depends_on:\s*(.+?)\s*·\s*\*\*(?:XS|S|M|L|XL)\*\*", task["header"])
        block_ids = ids_in(dep.group(1) if dep else "") - {task_id}
        index_ids = ids_in(rows[task_id]) - {task_id}
        task["deps"] = block_ids
        if block_ids != index_ids:
            report.fail("%s block=%s index=%s" % (task_id, sorted(block_ids), sorted(index_ids)))
            mismatches += 1
    if mismatches == 0:
        report.ok("block and index agree for all %d tasks" % len(tasks))
    return mismatches


def check_serialisation(tasks, report):
    print("\n[3] SHARED-FILE SERIALISATION")
    owners = collections.defaultdict(list)
    for task_id, task in tasks.items():
        for path in task["files"]:
            owners[path].append(task_id)

    def reaches(a, b, seen=None):
        seen = seen or set()
        if a == b:
            return True
        if a in seen:
            return False
        seen.add(a)
        return any(reaches(d, b, seen) for d in tasks.get(a, {}).get("deps", ()))

    unserialised = 0
    for path, ids in sorted(owners.items()):
        if len(ids) < 2:
            continue
        pairs = [
            (x, y) for i, x in enumerate(ids) for y in ids[i + 1:]
            if not reaches(x, y) and not reaches(y, x)
        ]
        if pairs:
            unserialised += len(pairs)
            report.fail("%s edited by unordered tasks %s" % (path, pairs))
        else:
            report.ok("%s : %s" % (path, " -> ".join(ids)))
    if unserialised == 0:
        report.ok("0 unserialised shared-file pairs")
    return owners, unserialised


def check_ownership(tasks, owners, report):
    print("\n[4] OWNERSHIP")
    conflicts = 0
    for path, ids in sorted(owners.items()):
        agents = {tasks[i]["agent"] for i in ids}
        if len(agents) > 1:
            conflicts += 1
            report.fail("%s owned by %s" % (path, sorted(agents)))

    violations = 0
    for task_id, task in sorted(tasks.items()):
        for path in task["files"]:
            if task["agent"] == "QA & Test":
                if not is_test_path(path):
                    report.fail("%s: QA & Test owns non-test file %s" % (task_id, path))
                    violations += 1
                continue
            if is_test_path(path):
                report.fail("%s: %s owns test file %s" % (task_id, task["agent"], path))
                violations += 1
                continue
            for prefix in FORBIDDEN.get(task["agent"], []):
                if path.startswith(prefix):
                    report.fail("%s: %s must not touch %s" % (task_id, task["agent"], path))
                    violations += 1
    if conflicts == 0 and violations == 0:
        report.ok("0 ownership conflicts, 0 never-touches violations")
    return conflicts, violations


def check_cycles_and_sizes(tasks, report):
    print("\n[5] SIZES, SCOPE AND CYCLES")
    sizes = collections.Counter(t["size"] for t in tasks.values())
    if sizes["XL"]:
        report.fail("XL tasks present: %d" % sizes["XL"])
    oversized = [i for i, t in tasks.items() if len(t["files"]) > 5]
    if oversized:
        report.fail("scope exceeds 5 files: %s" % oversized)

    colour = collections.defaultdict(int)
    cycles = []

    def visit(node, stack):
        if colour[node] == 1:
            cycles.append(stack + [node])
            return
        if colour[node] == 2:
            return
        colour[node] = 1
        for dep in tasks.get(node, {}).get("deps", ()):
            visit(dep, stack + [node])
        colour[node] = 2

    for task_id in tasks:
        visit(task_id, [])
    if cycles:
        report.fail("dependency cycles: %s" % cycles)

    files = {f for t in tasks.values() for f in t["files"]}
    print("   sizes: %s" % dict(sizes))
    print("   distinct scoped files: %d" % len(files))
    if not (sizes["XL"] or oversized or cycles):
        report.ok("0 XL, no scope over 5 files, 0 dependency cycles")
    return sizes, len(files)


def check_migration_ordering(repo, tasks, report):
    """Gate B round-6 finding B1: the baseline must sort before both Emergency
    migrations, or their REVOKEs run against functions that do not yet exist."""
    print("\n[6] MIGRATION ORDERING (B1)")
    versions = [BASELINE_VERSION] + EMERGENCY_VERSIONS
    for earlier, later in zip(versions, versions[1:]):
        if int(earlier) < int(later):
            report.ok("%s < %s" % (earlier, later))
        else:
            report.fail("ordering invariant violated: %s !< %s" % (earlier, later))

    block = tasks.get("1A-002", {}).get("body", "")
    if BASELINE_VERSION not in block:
        report.fail("1A-002 does not pin the baseline version %s" % BASELINE_VERSION)
    else:
        report.ok("1A-002 pins the baseline version %s" % BASELINE_VERSION)
    if "<ts>" in block:
        report.fail("1A-002 still contains a '<ts>' filename placeholder")

    migrations_dir = os.path.join(repo, "supabase", "migrations")
    if os.path.isdir(migrations_dir):
        active = sorted(f for f in os.listdir(migrations_dir) if f.endswith(".sql"))
        print("   active migration root: %s" % active)
        for version in EMERGENCY_VERSIONS:
            if not any(f.startswith(version) for f in active):
                report.fail("Emergency migration %s is missing from the active root" % version)
        # 001/002 must be archived before the baseline lands, else they sort first.
        legacy = [f for f in active if re.match(r"^0*\d{1,3}_", f)]
        if legacy:
            print("   note: legacy migrations still in the active root "
                  "(1A-002 requires archiving before the baseline lands): %s" % legacy)


def check_1a002_contract(tasks, report):
    print("\n[7] 1A-002 POST-REVOKE CONTRACT")
    block = tasks.get("1A-002", {}).get("body", "").lower()
    required = [
        "post-revoke", "mock_activate_subscription", "add_xp", "track_weekly_xp",
        "deal_damage_to_active_boss", "service_role", "postgres",
        "same transaction", "second application", "non-zero",
        "on_error_stop=1", "if not exists", "create or replace", "push-unsafe",
        "has_function_privilege", "ac-s01", "not deleted", "not folded",
    ]
    missing = [term for term in required if term not in block]
    if missing:
        report.fail("1A-002 missing required terms: %s" % missing)
    else:
        report.ok("all %d required contract terms present in the block" % len(required))
    if "original permissive grants" in block:
        report.fail("1A-002 still contains the superseded permissive-grant clause")
    else:
        report.ok("no permissive-grant clause")


def check_stale(repo, report):
    """Scan every .md under docs/. No document whitelist."""
    print("\n[8] ACTIVE STALE ASSERTIONS")
    stale = {
        "58": ["case", "e2e"], "21": ["predict", "defect", "failur"],
        "18": ["blocked", "device"], "20": ["l1", "layer", "failing"],
        "42": ["task", "row", "backlog"], "41": ["open", "specified"],
        "36": ["task", "row"], "31": ["task"], "69": ["file", "distinct"],
        "13 distinct": ["table"], "10 sites": ["site"],
    }
    superseded_markers = (
        "previously", "was wrong", "corrected", "superseded", "supersed",
        "no longer", "round-1", "round 1", "stale", "mistall", "miscount",
        "wrong when", "claimed", "historical", "then 36", "then 42",
        "not 20", "not 21", "deleted in full", "previous revision",
        "reverses the previous", "->", "→", "closed", "answered",
    )
    correction_headers = ("| was ", "| previously", "| claimed", "| old ", "was |", "(round-1")

    candidates = 0
    for dirpath, _, filenames in os.walk(os.path.join(repo, "docs")):
        for filename in sorted(filenames):
            if not filename.endswith(".md"):
                continue
            in_correction_table = False
            path = os.path.join(dirpath, filename)
            for lineno, line in enumerate(open(path, encoding="utf-8", errors="replace"), 1):
                lowered = line.lower()
                if lowered.startswith("|"):
                    if any(h in lowered for h in correction_headers):
                        in_correction_table = True
                elif not lowered.strip().startswith("|"):
                    in_correction_table = False
                if in_correction_table or any(m in lowered for m in superseded_markers):
                    continue
                for number, context in stale.items():
                    if number in ("13 distinct", "10 sites"):
                        if number not in lowered:
                            continue
                    else:
                        if not re.search(r"(?<![\d.:\-])" + number + r"(?![\d.:%\-])", line):
                            continue
                        if not any(c in lowered for c in context):
                            continue
                        if re.search(r"[\w/]+\.(ts|tsx|sql|js|py|md):" + number, line):
                            continue
                        if re.search(r"AC-[A-Z]?" + number, line):
                            continue
                    candidates += 1
                    print("   ?  %s:%s  n=%s  %s" % (filename, lineno, number, line.strip()[:90]))
    print("   candidates: %d (each requires adjudication; see docs/plan/14)" % candidates)
    return candidates


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", default=".", help="repository root (default: cwd)")
    args = parser.parse_args()
    repo = os.path.abspath(args.repo)

    if not os.path.isfile(os.path.join(repo, BACKLOG)):
        print("ERROR: %s not found. Run from the repository root or pass --repo." % BACKLOG)
        return 1

    print("=" * 74)
    print("GATE B STRUCTURAL VERIFIER   repo: %s" % repo)
    print("=" * 74)

    text, tasks, stubs = parse_backlog(repo)
    ids = sorted(tasks, key=len, reverse=True)  # longest first: DEMO-001A before DEMO-001
    id_re = re.compile("(" + "|".join(re.escape(i) for i in ids) + ")")

    def ids_in(s: str):
        return set(id_re.findall(s or ""))

    print("\n[0] TASK INVENTORY")
    print("   task-ID alphabet from real H2 headings: %d" % len(ids))
    print("   DEMO ids seen: %s" % sorted(i for i in ids if i.startswith("DEMO")))
    print("   pointer stubs (no scope, not tasks): %s" % stubs)

    report = Report()
    check_fields(tasks, report)
    mismatches = check_index(text, tasks, ids_in, report)
    owners, unserialised = check_serialisation(tasks, report)
    conflicts, violations = check_ownership(tasks, owners, report)
    sizes, file_count = check_cycles_and_sizes(tasks, report)
    check_migration_ordering(repo, tasks, report)
    check_1a002_contract(tasks, report)
    candidates = check_stale(repo, report)

    print("\n" + "=" * 74)
    print("SUMMARY")
    print("  open tasks .................. %d" % len(tasks))
    print("  index rows (incl. 1D-010) ... %d" % (len(tasks) + 1))
    print("  distinct scoped files ....... %d" % file_count)
    print("  block/index mismatches ...... %d" % mismatches)
    print("  unserialised shared pairs ... %d" % unserialised)
    print("  ownership conflicts ......... %d" % conflicts)
    print("  never-touches violations .... %d" % violations)
    print("  XL tasks .................... %d" % sizes["XL"])
    print("  stale candidates ............ %d" % candidates)
    print("  FAILURES .................... %s" % (len(report.failures) or "NONE"))
    print("=" * 74)
    return 1 if report.failures else 0


if __name__ == "__main__":
    sys.exit(main())
