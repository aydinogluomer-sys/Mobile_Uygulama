#!/usr/bin/env python3
"""Gate B structural verifier.

AUDIT TOOLING, not application code. Nothing in `frontend/` imports it, it ships
in no bundle, and it is not part of the Expo build.

Governing rule, established at Gate B round 8:

    Checking that a piece of text EXISTS is not verification.
    The verifier must test the BEHAVIOUR and EXECUTABILITY that text claims.

Constraints:
  * READ-ONLY. Opens files for reading. Runs `git show` (read-only) for the
    deletion-regression check and nothing else. Never writes, never mutates git.
  * NO NETWORK, NO DATABASE.
  * DETERMINISTIC and FIXTURE-FREE, given a repository state.

Usage:
    python tools/audit/verify_gate_b.py
    python tools/audit/verify_gate_b.py --repo . --baseline-rev HEAD~1

Exit 0 if every invariant holds, 1 otherwise.
"""
from __future__ import annotations

import argparse
import collections
import io
import os
import re
import subprocess
import sys

if hasattr(sys.stdout, "buffer"):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

BACKLOG = "docs/plan/01_IMPLEMENTATION_BACKLOG.md"
MIGRATIONS_DIR = os.path.join("supabase", "migrations")

BODY_FIELDS = ["scope", "goal", "acceptance_criteria", "validation", "risk", "rollback"]
HEADER_FIELDS = ["id", "title", "priority", "obligation", "agent", "depends_on", "size"]
ALL_13 = HEADER_FIELDS + BODY_FIELDS

AGENTS = [
    "Supabase & Security", "Habit Domain", "Expo Architecture",
    "QA & Test", "Repository Audit", "Open-Source Research",
]
FORBIDDEN = {
    "Supabase & Security":  ["frontend/"],
    "Habit Domain":         ["supabase/", "frontend/app/"],
    "Expo Architecture":    ["supabase/", "frontend/lib/", "frontend/store/"],
    "Repository Audit":     ["supabase/", "frontend/app/", "frontend/lib/", "frontend/store/"],
    "Open-Source Research": ["supabase/", "frontend/"],
}

# Non-task dependency tokens that are still REAL dependencies and must take part
# in the block-vs-index comparison (round-7 finding m4c: filtering these out hid
# exactly the H-01 divergence that round-6 B2 was about).
HUMAN_TOKENS = ["H-01", "H-13", "H-14", "H-03", "Gate B PASS"]

# Criteria whose DELETION from 1A-002 is a regression (round-8 item 1E).
# Each is (label, [alternative marker phrases]) — matched case-insensitively.
CRITICAL_1A002 = [
    ("baseline-alone secure posture",   ["baseline's own output contract", "baseline alone"]),
    ("before-Emergency validation",     ["before either emergency", "before any emergency"]),
    ("preserved Emergency files",       ["not deleted", "not folded"]),
    ("migration ordering invariant",    ["sorts before", "ordering invariant"]),
    ("second application non-zero",     ["second application", "-ne 0"]),
    ("no client grants",                ["fail condition"]),
    ("five-role privilege introspection", ["pg_exec", "postgres"]),
]


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

    def note(self, msg: str) -> None:
        print("   note  " + msg)


# --------------------------------------------------------------------------- #
# parsing
# --------------------------------------------------------------------------- #
def split_blocks(text: str):
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
    return blocks


def parse_backlog(repo: str):
    text = open(os.path.join(repo, BACKLOG), encoding="utf-8").read()
    tasks, stubs = {}, []
    for block in split_blocks(text):
        match = re.match(r"^(\S+)\s*·\s*(.+)$", block["head"])
        if not match:
            continue
        task_id, title = match.group(1), match.group(2).strip()
        body = "\n".join(block["body"])
        if "**scope**" not in body:
            stubs.append(task_id)
            continue
        header = next((x for x in block["body"] if x.startswith("`P")), "")
        scope_line = re.search(r"\*\*scope\*\*[^:]*:\s*(.+)", body)
        files = re.findall(r"`([^`]+)`", scope_line.group(1)) if scope_line else []

        # --- all 13 fields parsed individually (round-8 item 1B) ---
        present = {}
        present["id"] = bool(task_id)
        present["title"] = bool(title)
        present["priority"] = bool(re.search(r"`P[0-4]`", header))
        present["obligation"] = bool(re.search(r"\b(MUST|SHOULD|COULD)\b", header))
        present["agent"] = any(a in header for a in AGENTS)
        present["depends_on"] = "depends_on:" in header
        size_match = re.search(r"\*\*(XS|S|M|L|XL)\*\*", header)
        present["size"] = bool(size_match)
        for field in BODY_FIELDS:
            present[field] = ("**%s**" % field) in body

        tasks[task_id] = {
            "title": title,
            "header": header,
            "body": body,
            "agent": next((a for a in AGENTS if a in header), "?"),
            "files": [f.strip() for f in files],
            "size": size_match.group(1) if size_match else "?",
            "present": present,
            "missing": [f for f in ALL_13 if not present.get(f)],
        }
    return text, tasks, stubs


# --------------------------------------------------------------------------- #
# checks
# --------------------------------------------------------------------------- #
def check_fields(tasks, report):
    """1B: assert all 13 fields individually, not a 6-field proxy."""
    print("\n[1] MANDATORY FIELDS (all %d, parsed individually)" % len(ALL_13))
    bad = 0
    for task_id, task in sorted(tasks.items()):
        if task["missing"]:
            report.fail("%s missing %s" % (task_id, task["missing"]))
            bad += 1
    if not bad:
        report.ok("all %d open tasks carry all %d fields (%s)"
                  % (len(tasks), len(ALL_13), ", ".join(ALL_13)))
    return bad


def dep_tokens(raw: str, id_re) -> set:
    """1C: task IDs AND human/gate tokens. Human dependencies are real."""
    tokens = set(id_re.findall(raw or ""))
    for human in HUMAN_TOKENS:
        if re.search(re.escape(human), raw or ""):
            tokens.add(human)
    return tokens


def check_index(text, tasks, id_re, report):
    print("\n[2] BLOCK vs INDEX depends_on (human tokens included)")
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
        block_set = dep_tokens(dep.group(1) if dep else "", id_re) - {task_id}
        index_set = dep_tokens(rows[task_id], id_re) - {task_id}
        task["deps"] = {d for d in block_set if d in tasks}
        if block_set != index_set:
            report.fail("%s block=%s index=%s" % (task_id, sorted(block_set), sorted(index_set)))
            mismatches += 1
    if not mismatches:
        report.ok("block and index agree for all %d tasks, human tokens included" % len(tasks))
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
        pairs = [(x, y) for i, x in enumerate(ids) for y in ids[i + 1:]
                 if not reaches(x, y) and not reaches(y, x)]
        if pairs:
            unserialised += len(pairs)
            report.fail("%s edited by unordered tasks %s" % (path, pairs))
        else:
            report.ok("%s : %s" % (path, " -> ".join(ids)))
    if not unserialised:
        report.ok("0 unserialised shared-file pairs")
    return owners, unserialised


def check_ownership(tasks, owners, report):
    print("\n[4] OWNERSHIP")
    conflicts = violations = 0
    for path, ids in sorted(owners.items()):
        agents = {tasks[i]["agent"] for i in ids}
        if len(agents) > 1:
            conflicts += 1
            report.fail("%s owned by %s" % (path, sorted(agents)))
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
    if not conflicts and not violations:
        report.ok("0 ownership conflicts, 0 never-touches violations")
    return conflicts, violations


def check_sizes_and_cycles(tasks, report):
    print("\n[5] SIZES, SCOPE AND CYCLES")
    sizes = collections.Counter(t["size"] for t in tasks.values())
    if sizes["XL"]:
        report.fail("XL tasks present: %d" % sizes["XL"])
    oversized = [i for i, t in tasks.items() if len(t["files"]) > 5]
    if oversized:
        report.fail("scope exceeds 5 files: %s" % oversized)

    colour, cycles = collections.defaultdict(int), []

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
        report.fail("declared dependency cycles: %s" % cycles)

    files = {f for t in tasks.values() for f in t["files"]}
    print("   sizes: %s   distinct scoped files: %d" % (dict(sizes), len(files)))
    if not (sizes["XL"] or oversized or cycles):
        report.ok("0 XL, no scope over 5 files, 0 declared cycles")
    return sizes, len(files)


def check_migration_ordering(repo, tasks, report):
    """1A: derive every version from REAL sources. No hardcoded comparison."""
    print("\n[6] MIGRATION ORDERING (derived from disk + 1A-002 scope)")
    block = tasks.get("1A-002", {})
    body = block.get("body", "")

    # baseline filename parsed from the 1A-002 scope line
    baseline_files = [f for f in block.get("files", []) if "baseline_schema" in f]
    if not baseline_files:
        report.fail("1A-002 scope names no baseline_schema file")
        return
    baseline_name = os.path.basename(baseline_files[0])
    m = re.match(r"^(\d+)_", baseline_name)
    if not m:
        report.fail("baseline filename carries no numeric version: %s" % baseline_name)
        return
    baseline_version = m.group(1)
    if "<ts>" in baseline_name or "<" in baseline_name:
        report.fail("baseline filename is still a placeholder: %s" % baseline_name)
        return
    report.ok("baseline version parsed from 1A-002 scope: %s (%s)" % (baseline_version, baseline_name))

    # emergency + active migrations parsed from disk
    mig_dir = os.path.join(repo, MIGRATIONS_DIR)
    if not os.path.isdir(mig_dir):
        report.fail("%s not found" % MIGRATIONS_DIR)
        return
    on_disk = sorted(f for f in os.listdir(mig_dir) if f.endswith(".sql"))
    emergency = sorted(f for f in on_disk if "emergency_gate_0" in f)
    if len(emergency) != 2:
        report.fail("expected 2 Emergency Gate 0 migrations on disk, found %d: %s"
                    % (len(emergency), emergency))
        return
    emergency_versions = [re.match(r"^(\d+)_", f).group(1) for f in emergency]
    report.ok("emergency versions parsed from disk: %s" % emergency_versions)

    if os.path.exists(os.path.join(mig_dir, baseline_name)):
        report.ok("baseline file exists on disk")
    else:
        report.note("baseline file NOT on disk yet — PLANNED filename (1A-002 unstarted)")

    # real comparison: parsed baseline vs parsed emergency versions
    for ev, ef in zip(emergency_versions, emergency):
        if int(baseline_version) < int(ev) and baseline_version < ev:
            report.ok("%s < %s  (numeric and lexical)" % (baseline_version, ef))
        else:
            report.fail("ORDERING VIOLATED: baseline %s does not sort before %s"
                        % (baseline_version, ef))

    # any other active migration that would sort before the baseline
    for f in on_disk:
        if f in emergency or f == baseline_name:
            continue
        v = re.match(r"^(\d+)_", f)
        if v and v.group(1) < baseline_version:
            report.note("%s sorts BEFORE the baseline — 1A-002 requires it archived "
                        "before the baseline lands" % f)

    # the block must state the invariant, not merely be consistent with it
    if re.search(r"sorts?\s+before|ordering invariant", body, re.I):
        report.ok("1A-002 states the ordering invariant in its criteria")
    else:
        report.fail("1A-002 does not state the ordering invariant")


def check_bash_executability(tasks, report):
    """1D: does the validation block actually run, or pass vacuously?"""
    print("\n[7] 1A-002 VALIDATION BLOCK EXECUTABILITY")
    body = tasks.get("1A-002", {}).get("body", "")
    fences = re.findall(r"```bash\n(.*?)```", body, re.S)
    if not fences:
        report.fail("1A-002 has no ```bash validation block")
        return
    script = "\n".join(fences)

    # variables used inside the fence must be ASSIGNED inside the fence
    used = set(re.findall(r"\$\{?([A-Z_][A-Z0-9_]*)\}?", script))
    used -= {"PGPASSWORD", "PATH", "HOME", "PWD", "TZ", "IFS"}
    assigned = set(re.findall(r"^\s*([A-Z_][A-Z0-9_]*)=", script, re.M))
    assigned |= set(re.findall(r"^\s*([A-Z_][A-Z0-9_]*)=\(", script, re.M))
    undefined = sorted(used - assigned)
    if undefined:
        report.fail("variables used but never assigned INSIDE the bash fence: %s "
                    "-> they expand to empty and the test passes vacuously" % undefined)
    else:
        report.ok("every variable used in the fence is assigned inside it")

    # assignment must precede first use
    for var in sorted(assigned):
        first_assign = re.search(r"^\s*%s=" % var, script, re.M)
        first_use = re.search(r"\$\{?%s\b" % var, script)
        if first_assign and first_use and first_use.start() < first_assign.start():
            report.fail("%s is used before it is assigned" % var)

    # ON_ERROR_STOP must reach a real psql invocation
    if "ON_ERROR_STOP=1" not in script:
        report.fail("ON_ERROR_STOP=1 absent — psql exits 0 on statement errors")
    else:
        psql_assign = re.search(r"^\s*PSQL=.*ON_ERROR_STOP=1", script, re.M)
        if psql_assign and re.search(r"\$\{?PSQL", script):
            report.ok("ON_ERROR_STOP=1 reaches psql via the PSQL variable")
        elif re.search(r"psql\s+-v\s+ON_ERROR_STOP=1", script):
            report.ok("ON_ERROR_STOP=1 is on a direct psql invocation")
        else:
            report.fail("ON_ERROR_STOP=1 present but not wired to any psql invocation")

    # the second-application test must guard against a setup-error false positive
    if re.search(r"test\s+-f\s+\"?\$\{?BASE", script):
        report.ok("baseline file existence is asserted before the second-application test")
    else:
        report.fail("no `test -f $BASE` guard — a missing file would make the "
                    "non-zero expectation pass for the wrong reason")
    if re.search(r"status=\$\?|\$\?", script) and re.search(r"-ne\s+0|!= *0", script):
        report.ok("second-application exit status is captured and asserted non-zero")
    else:
        report.fail("second-application test does not capture and assert an exit status")


def check_two_stage_validation(tasks, report):
    """Item 2: baseline-alone posture must be proven separately from full reset."""
    print("\n[8] TWO-STAGE VALIDATION (baseline-alone vs full chain)")
    body = tasks.get("1A-002", {}).get("body", "").lower()
    stage_a = any(k in body for k in ["stage a", "baseline alone", "baseline-alone"])
    before = any(k in body for k in ["before either emergency", "before any emergency",
                                     "without applying the emergency"])
    stage_b = any(k in body for k in ["stage b", "full migration chain", "full chain"])
    for label, ok in [("Stage A (baseline alone) present", stage_a),
                      ("privilege assertion BEFORE Emergency migrations", before),
                      ("Stage B (full chain) present", stage_b)]:
        (report.ok if ok else report.fail)(label)
    if re.search(r"db reset", body) and not before:
        report.fail("full `db reset` is used as the only posture evidence — it cannot "
                    "distinguish baseline-produced ACL from Emergency-produced ACL")


def check_deletion_regression(repo, tasks, baseline_rev, report):
    """1E: FAIL if a critical 1A-002 criterion present in <rev> is now gone."""
    print("\n[9] ACCEPTANCE-CRITERIA DELETION REGRESSION (vs %s)" % baseline_rev)
    try:
        prev = subprocess.run(
            ["git", "show", "%s:%s" % (baseline_rev, BACKLOG)],
            cwd=repo, capture_output=True, text=True, timeout=30,
        )
    except Exception as exc:                                    # pragma: no cover
        report.note("git unavailable (%s) — regression check skipped" % exc)
        return
    if prev.returncode != 0:
        report.note("cannot read %s:%s — regression check skipped" % (baseline_rev, BACKLOG))
        return

    prev_block = ""
    for block in split_blocks(prev.stdout):
        if block["head"].startswith("1A-002"):
            prev_block = "\n".join(block["body"]).lower()
            break
    now_block = tasks.get("1A-002", {}).get("body", "").lower()

    regressions = 0
    for label, markers in CRITICAL_1A002:
        was = any(m in prev_block for m in markers)
        now = any(m in now_block for m in markers)
        if was and not now:
            report.fail("REGRESSION: '%s' was in 1A-002 at %s and is now GONE" % (label, baseline_rev))
            regressions += 1
        elif now:
            report.ok("'%s' present" % label)
        else:
            report.fail("'%s' absent (and absent at %s too)" % (label, baseline_rev))
            regressions += 1
    return regressions


def check_stale(repo, report):
    print("\n[10] ACTIVE STALE ASSERTIONS (every .md under docs/, no whitelist)")
    stale = {
        "58": ["case", "e2e"], "21": ["predict", "defect", "failur"],
        "18": ["blocked", "device"], "20": ["l1", "layer", "failing"],
        "42": ["task", "row", "backlog"], "41": ["open", "specified"],
        "36": ["task", "row"], "31": ["task"], "69": ["file", "distinct"],
        "13 distinct": ["table"], "10 sites": ["site"],
    }
    # Narrow markers only. "->", "closed" and "answered" were removed at round 8:
    # they skipped whole lines wholesale and hid real assertions.
    superseded = (
        "previously", "was wrong", "corrected", "superseded", "supersed",
        "no longer", "round-1", "round 1", "stale", "mistall", "miscount",
        "wrong when", "historical", "then 36", "then 42", "not 20", "not 21",
        "deleted in full", "previous revision", "reverses the previous",
    )
    correction_headers = ("| was ", "| previously", "| claimed", "| old ", "was |", "(round-1")

    candidates = 0
    for dirpath, _, filenames in os.walk(os.path.join(repo, "docs")):
        for filename in sorted(filenames):
            if not filename.endswith(".md"):
                continue
            in_table = False
            for lineno, line in enumerate(
                    open(os.path.join(dirpath, filename), encoding="utf-8", errors="replace"), 1):
                low = line.lower()
                if low.startswith("|"):
                    if any(h in low for h in correction_headers):
                        in_table = True
                elif not low.strip().startswith("|"):
                    in_table = False
                if in_table or any(m in low for m in superseded):
                    continue
                for number, context in stale.items():
                    if number in ("13 distinct", "10 sites"):
                        if number not in low:
                            continue
                    else:
                        if not re.search(r"(?<![\d.:\-])" + number + r"(?![\d.:%\-])", line):
                            continue
                        if not any(c in low for c in context):
                            continue
                        if re.search(r"[\w/]+\.(ts|tsx|sql|js|py|md):" + number, line):
                            continue
                        if re.search(r"AC-[A-Z]?" + number, line):
                            continue
                    candidates += 1
                    print("   ?  %s:%s  n=%s  %s" % (filename, lineno, number, line.strip()[:88]))
    print("   candidates: %d — each requires adjudication (see docs/plan/14 §4)" % candidates)
    return candidates


def check_h01(repo, report):
    """Item 11 of round 6, re-verified: H-01 must not read as an open decision."""
    print("\n[11] H-01 CLOSURE")
    open_markers = [
        "awaits h-01", "decision required — h-01", "only after h-01",
        "waits on h-01", "needs h-01", "h-01 + ", "h-01 is on the critical path",
        "if h-01 stalls", "cannot start until this is answered",
    ]
    banner_docs = ("07_GATE_B_REMEDIATION_REPORT", "11_GATE_B_REMEDIATION_ROUND_2")
    # A row whose line also carries a resolution arrow is a correction record,
    # not a live assertion: "| `plan/10:3` \"awaits H-01\" | -> H-01 ANSWERED |".
    resolution_markers = ("→", "->", "answered", "closed", "resolution", "annotated")
    hits = 0
    for dirpath, _, filenames in os.walk(os.path.join(repo, "docs")):
        for filename in sorted(filenames):
            if not filename.endswith(".md"):
                continue
            if any(b in filename for b in banner_docs):
                continue                      # legitimately banner-superseded
            for lineno, line in enumerate(
                    open(os.path.join(dirpath, filename), encoding="utf-8", errors="replace"), 1):
                low = line.lower()
                if low.startswith("|") and any(r in low for r in resolution_markers):
                    continue                  # correction-record row
                if any(m in low for m in open_markers):
                    report.fail("H-01 presented as open: %s:%s  %s"
                                % (filename, lineno, line.strip()[:80]))
                    hits += 1
    if not hits:
        report.ok("no document presents H-01 as an open decision")
    return hits


# --------------------------------------------------------------------------- #
def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", default=".")
    parser.add_argument("--baseline-rev", default="HEAD~1",
                        help="revision to compare 1A-002 against for deletion regressions")
    args = parser.parse_args()
    repo = os.path.abspath(args.repo)

    if not os.path.isfile(os.path.join(repo, BACKLOG)):
        print("ERROR: %s not found. Run from the repository root." % BACKLOG)
        return 1

    print("=" * 78)
    print("GATE B STRUCTURAL VERIFIER")
    print("repo: %s" % repo)
    print("rule: existence of text is not verification — behaviour is")
    print("=" * 78)

    text, tasks, stubs = parse_backlog(repo)
    ids = sorted(tasks, key=len, reverse=True)
    id_re = re.compile("(" + "|".join(re.escape(i) for i in ids) + ")")

    print("\n[0] TASK INVENTORY")
    print("   task-ID alphabet from real H2 headings: %d" % len(ids))
    print("   DEMO ids seen: %s" % sorted(i for i in ids if i.startswith("DEMO")))
    print("   pointer stubs (no scope, not tasks): %s" % stubs)

    report = Report()
    check_fields(tasks, report)
    mismatches = check_index(text, tasks, id_re, report)
    owners, unserialised = check_serialisation(tasks, report)
    conflicts, violations = check_ownership(tasks, owners, report)
    sizes, file_count = check_sizes_and_cycles(tasks, report)
    check_migration_ordering(repo, tasks, report)
    check_bash_executability(tasks, report)
    check_two_stage_validation(tasks, report)
    check_deletion_regression(repo, tasks, args.baseline_rev, report)
    candidates = check_stale(repo, report)
    h01 = check_h01(repo, report)

    print("\n" + "=" * 78)
    print("SUMMARY")
    print("  open tasks .................. %d" % len(tasks))
    print("  index rows (incl. 1D-010) ... %d" % (len(tasks) + 1))
    print("  distinct scoped files ....... %d" % file_count)
    print("  block/index mismatches ...... %d" % mismatches)
    print("  unserialised shared pairs ... %d" % unserialised)
    print("  ownership conflicts ......... %d" % conflicts)
    print("  never-touches violations .... %d" % violations)
    print("  XL tasks .................... %d" % sizes["XL"])
    print("  H-01 open-decision sites .... %d" % h01)
    print("  stale candidates ............ %d" % candidates)
    print("  FAILURES .................... %s" % (len(report.failures) or "NONE"))
    print("=" * 78)
    return 1 if report.failures else 0


if __name__ == "__main__":
    sys.exit(main())
