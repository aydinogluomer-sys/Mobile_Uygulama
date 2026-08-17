#!/usr/bin/env python3
"""Gate B structural verifier.

AUDIT TOOLING, not application code. Nothing in `frontend/` imports it, it ships
in no bundle, and it is not part of the Expo build.

SCOPE — read this before quoting any output as evidence.

GUARANTEES (structural only):
  * task and reference existence across plan/01-05, in ACTIVE CONTENT ONLY:
    table rows, depends_on headers and the mandatory task fields. Prose,
    blockquotes and history tables are deliberately not scanned
  * block/index equality of depends_on, human tokens included
  * graph reachability: no dangling token, no cycle, no unresolved human dependency
  * ownership uniqueness and `never touches` compliance
  * file scope and count consistency
  * a fixed set of known structural invariants

DOES NOT GUARANTEE:
  * shell procedure semantics       * SQL correctness
  * Supabase runtime behaviour      * privilege correctness
  * schema equivalence              * business-logic correctness

Those are established by HUMAN REVIEW (Gate B) and EXECUTION EVIDENCE (Gate C),
never by this tool. It is a structural checker, not a semantic verifier, and no
output of it proves execution correctness.

Governing rule, established at Gate B round 8 and still binding for the
structural checks it does make:

    Checking that a piece of text EXISTS is not verification.
    A structural check must test the property it claims, not a keyword near it.

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
HUMAN_TOKENS = ["H-01", "H-03", "H-11", "H-13", "H-14", "Gate B PASS"]

# The single named exception to "all test files belong to QA & Test"
# (docs/plan/04_AGENT_TASK_GRAPH.md section 1). Any other non-QA test file FAILS.
TEST_OWNERSHIP_EXCEPTIONS = {"supabase/tests/baseline_privileges.test.sql"}

# Criteria below are tracked across every block whose id starts with this
# prefix, so splitting a task does not read as deleting its criteria.
TRACKED_PREFIX = "1A-002"

# A validation block that builds its own database with plain createdb is not a
# valid Supabase environment: no auth schema, no anon/authenticated/service_role
# roles, no platform extensions. has_function_privilege('anon', ...) would raise
# "role does not exist", so the defining assertion could not even run.
# Round 9 (F4): a literal blacklist is not enough. Plain-PostgreSQL bootstrap is
# matched broadly, and the real requirement is expressed as a positive contract.
PLAIN_DB_PATTERNS = [
    r"\bcreatedb\b", r"\bdropdb\b",
    r"\bCREATE\s+DATABASE\b", r"\bDROP\s+DATABASE\b",
]
# Behavioural contract a baseline-only validation must satisfy.
BOOTSTRAP_CONTRACT = [
    ("starts or asserts a running stack", [r"supabase start", r"docker info"]),
    ("scratch directory created",         [r"mktemp -d"]),
    # `supabase init` creates ONLY config.toml — verified by probe. The
    # migrations directory must be made explicitly, before anything is copied
    # into it, or the fence dies on the first cp (round-10 BLOCKER 1).
    ("migrations directory created",      [r"mkdir -p +\"?\$\{?SCRATCH\}?/supabase/migrations"]),
    ("migrations directory asserted",     [r"test -d +\"?\$\{?SCRATCH\}?/supabase/migrations"]),
    ("Stage A asserts exactly ONE migration", [r"migrations\"? \| wc -l\)\"? -eq 1",
                                               r"wc -l\)\"? -eq 1"]),
    ("Stage B asserts all THREE migrations",   [r"wc -l\)\"? -eq 3"]),
    ("Supabase roles assertion",          [r"pg_roles"]),
    ("auth schema assertion",             [r"schema_name='auth'", r"information_schema.schemata"]),
    ("Emergency migrations absent",       [r"NOT copied", r"not copied", r"deliberately"]),
    ("local-only / no remote",            [r"127\.0\.0\.1", r"zdqiujpeewtyhtcqhdcj"]),
]
# Gate tokens a depends_on may legitimately name.
GATE_TOKENS = ["Gate B PASS", "Gate C", "separate explicit approval", "separate approval"]
# Repository artefact extensions worth resolving to a producing task.
ARTEFACT_RE = r"(?:supabase|frontend|backend|docs|tools)/[\w./\-]+\.(?:sql|sh|py|ts|tsx|js|toml|json|md)"
SUPABASE_BOOTSTRAP_MARKERS = ["supabase db reset", "supabase start"]
# DONE tasks that exist only as an index row.
INDEX_ONLY_TASKS = ["1D-010"]

# Round 10: active plan graphs that must not reference a task that does not exist.
PLAN_GRAPHS = [
    "docs/plan/01_IMPLEMENTATION_BACKLOG.md",
    "docs/plan/02_DEPENDENCY_GRAPH.md",
    "docs/plan/03_RELEASE_ROADMAP.md",
    "docs/plan/04_AGENT_TASK_GRAPH.md",
    "docs/plan/05_RISK_REGISTER.md",
]
# Task-shaped tokens, matched by SHAPE so an unknown id cannot slip through by
# not being in the alphabet (round-9 MAJOR 4).
TASK_SHAPE = re.compile(
    r"\b(?:SEC-1D-[0-9a-z]+|OPS-[0-9A-Z]+-[0-9]+|DEMO-[0-9]+[A-Z]?"
    r"|1[A-Z]-[0-9]{3}[A-Z]?|1E-L[0-9][ab]?|H-[0-9]{2})\b")
# A ranged form names a span rather than one task: "SEC-1D-001..003".
# Round 11 (MAJOR-B): this used to match a bare em/en dash ANYWHERE on the line.
# The em-dash is this project's standard empty-cell marker, so the guard silently
# disabled the check on 33 of 69 rows in plan/02 and 10 of 53 in plan/05 — and a
# live dangling token was already hiding behind it. The range test is now
# anchored to the token itself.
def _is_ranged(token, line):
    return bool(re.search(re.escape(token) + r"\s*(?:\.\.|\u2026)", line))

# Actions a task may declare OUT OF SCOPE. If the same task also REQUIRES one,
# that is a task-internal contradiction (round-10 BLOCKER 2).
# An action is identified by a SET of terms that must co-occur in the same line,
# in any order. The earlier version required "canonical ... reset" in that order
# and so missed "a final `supabase db reset` in the **canonical** repository".
CONTRADICTION_ACTIONS = [
    ("canonical repository reset", [r"\bcanonical\b", r"\breset\b"]),
]
# NOTE: "owns the canonical reset" is an OWNERSHIP claim, not an exclusion -
# including it made 1A-003 (which legitimately owns and requires the reset)
# read as self-contradictory.
EXCLUSION_MARKERS = (r"(?:deliberately )?NOT part of this task|not part of this task"
                     r"|out of scope")

# Criteria whose DELETION from 1A-002 is a regression (round-8 item 1E).
# Each is (label, [alternative marker phrases]) — matched case-insensitively.
CRITICAL_1A002 = [
    ("baseline-alone secure posture",   ["baseline's own output contract", "baseline alone"]),
    # Round 8 strengthened this: the Emergency migrations are not merely applied
    # later, they are ABSENT from the migration set during Stage A.
    ("baseline-alone posture proof",    ["before either emergency", "before any emergency",
                                         "absent from the migration set",
                                         "neither emergency migration is present"]),
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
def tracked_blocks(tasks):
    """Every task under TRACKED_PREFIX (1A-002, or 1A-002A + 1A-002B after the
    round-8 split). Checks must not hardcode a single task id: a split would
    silently disable them."""
    return {tid: task for tid, task in tasks.items() if tid.startswith(TRACKED_PREFIX)}


def tracked_body(tasks):
    return " ".join(task["body"] for task in tracked_blocks(tasks).values())


def tracked_files(tasks):
    out = []
    for task in tracked_blocks(tasks).values():
        out.extend(task["files"])
    return out


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
                if path in TEST_OWNERSHIP_EXCEPTIONS:
                    report.note("%s: %s owns %s — NAMED exception (plan/04 section 1)"
                                % (task_id, task["agent"], path))
                    continue
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
    ids = sorted(tracked_blocks(tasks))
    body = tracked_body(tasks)

    # baseline filename parsed from the tracked scope lines
    baseline_files = [f for f in tracked_files(tasks) if "baseline_schema" in f]
    if not baseline_files:
        report.fail("%s scope names no baseline_schema file" % (ids or TRACKED_PREFIX))
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
    report.ok("baseline version parsed from %s scope: %s (%s)" % (ids, baseline_version, baseline_name))

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
        report.ok("%s states the ordering invariant in its criteria" % ids)
    else:
        report.fail("%s does not state the ordering invariant" % ids)


def check_bash_executability(tasks, report):
    """1D: does the validation block actually run, or pass vacuously?"""
    print("\n[7] 1A-002 VALIDATION BLOCK EXECUTABILITY")
    blocks = tracked_blocks(tasks)
    numbered = []
    for tid in sorted(blocks):
        for n, fence in enumerate(re.findall(r"```bash\n(.*?)```", blocks[tid]["body"], re.S), 1):
            numbered.append(("%s fence %d" % (tid, n), fence))
    if not numbered:
        report.fail("%s has no ```bash validation block" % sorted(blocks))
        return
    # Round 9 (F5): each fence is checked INDEPENDENTLY. A variable assigned in
    # one fence must not satisfy a use in another, and document order must not
    # change the result.
    for label, script in numbered:
        _check_one_fence(label, script, report)
    return


def _check_one_fence(label, script, report):

    # variables used inside the fence must be ASSIGNED inside the fence
    used = set(re.findall(r"\$\{?([A-Z_][A-Z0-9_]*)\}?", script))
    used -= {"PGPASSWORD", "PATH", "HOME", "PWD", "TZ", "IFS"}
    assigned = set(re.findall(r"^\s*([A-Z_][A-Z0-9_]*)=", script, re.M))
    assigned |= set(re.findall(r"^\s*([A-Z_][A-Z0-9_]*)=\(", script, re.M))
    undefined = sorted(used - assigned)
    if undefined:
        report.fail("%s: variables used but never assigned in THIS fence: %s "
                    "-> they expand to empty and the test passes vacuously" % (label, undefined))
    else:
        report.ok("%s: every variable used is assigned in this fence" % label)

    # assignment must precede first use
    for var in sorted(assigned):
        first_assign = re.search(r"^\s*%s=" % var, script, re.M)
        first_use = re.search(r"\$\{?%s\b" % var, script)
        if first_assign and first_use and first_use.start() < first_assign.start():
            report.fail("%s: %s is used before it is assigned" % (label, var))

    # ON_ERROR_STOP must reach a real psql invocation
    uses_psql = bool(re.search(r"\bpsql\b", script))
    if not uses_psql:
        report.ok("%s: static fence — no database access, psql guarantees N/A" % label)
    elif "ON_ERROR_STOP=1" not in script:
        report.fail("%s: ON_ERROR_STOP=1 absent — psql exits 0 on statement errors" % label)
    else:
        psql_assign = re.search(r"^\s*PSQL=.*ON_ERROR_STOP=1", script, re.M)
        if psql_assign and re.search(r"\$\{?PSQL", script):
            report.ok("ON_ERROR_STOP=1 reaches psql via the PSQL variable")
        elif re.search(r"psql\s+-v\s+ON_ERROR_STOP=1", script):
            report.ok("ON_ERROR_STOP=1 is on a direct psql invocation")
        else:
            report.fail("ON_ERROR_STOP=1 present but not wired to any psql invocation")

    # the second-application test must guard against a setup-error false positive
    # A "second application" test exists only where the baseline is re-applied
    # against an already-populated database.
    reapplies = bool(re.search(r"set \+e", script) and re.search(r"status=\$\?", script))
    if not reapplies:
        report.ok("%s: no second-application test in this fence — N/A" % label)
    else:
        if re.search(r"test\s+-f\s+\"?\$\{?BASE", script):
            report.ok("%s: baseline existence asserted before the re-apply test" % label)
        else:
            report.fail("%s: no `test -f $BASE` guard — a missing file would make "
                        "the non-zero expectation pass for the wrong reason" % label)
        if re.search(r"-ne\s+0|!= *0", script):
            report.ok("%s: second-application exit status asserted non-zero" % label)
        else:
            report.fail("%s: second-application test does not assert an exit status" % label)


def check_two_stage_validation(tasks, report):
    """Item 2: baseline-alone posture must be proven separately from full reset."""
    print("\n[8] TWO-STAGE VALIDATION (baseline-alone vs full chain)")
    body = tracked_body(tasks).lower()
    stage_a = any(k in body for k in ["stage a", "baseline alone", "baseline-alone"])
    before = any(k in body for k in ["before either emergency", "before any emergency",
                                     "without applying the emergency",
                                     "absent from the migration set",
                                     "neither emergency migration is present"])
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

    # A task may be SPLIT between revisions (1A-002 -> 1A-002A + 1A-002B).
    # Compare the union of every block whose id starts with the tracked prefix,
    # so a split is not misreported as seven deletions.
    prev_block = " ".join(
        "\n".join(b["body"]) for b in split_blocks(prev.stdout)
        if b["head"].startswith(TRACKED_PREFIX)
    ).lower()
    now_block = " ".join(
        task["body"] for tid, task in tasks.items() if tid.startswith(TRACKED_PREFIX)
    ).lower()
    prev_ids = sorted(b["head"].split(" ")[0] for b in split_blocks(prev.stdout)
                      if b["head"].startswith(TRACKED_PREFIX))
    now_ids = sorted(tid for tid in tasks if tid.startswith(TRACKED_PREFIX))
    if prev_ids != now_ids:
        report.note("tracked blocks changed: %s -> %s (split/merge; criteria "
                    "compared as a union)" % (prev_ids, now_ids))

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


def check_supabase_bootstrap(tasks, report):
    """Round-8: a validation block must not build its environment with plain
    createdb. It must use a Supabase-bootstrapped stack."""
    print("\n[10] SUPABASE-BOOTSTRAPPED VALIDATION ENVIRONMENT")
    offenders = 0
    for task_id, task in sorted(tasks.items()):
        for fence in re.findall(r"```bash\n(.*?)```", task["body"], re.S):
            plain = [pat for pat in PLAIN_DB_PATTERNS if re.search(pat, fence, re.I)]
            if plain:
                report.fail("%s validation builds its environment with %s — a plain "
                            "PostgreSQL database has no auth schema and no "
                            "anon/authenticated/service_role roles, so "
                            "has_function_privilege('anon', ...) would error"
                            % (task_id, plain))
                offenders += 1
            if "has_function_privilege" in fence or "pg_roles" in fence:
                if not any(m in task["body"] for m in SUPABASE_BOOTSTRAP_MARKERS):
                    report.fail("%s introspects privileges but never establishes a "
                                "Supabase-bootstrapped stack" % task_id)
                    offenders += 1

    # POSITIVE behavioural contract. A blacklist alone cannot express what a
    # baseline-only proof must DO; this asserts each required behaviour is
    # present in the task that performs the proof.
    for task_id, task in sorted(tasks.items()):
        fences = "\n".join(re.findall(r"```bash\n(.*?)```", task["body"], re.S))
        if "baseline_privileges" not in fences:
            continue
        for label, pats in BOOTSTRAP_CONTRACT:
            if any(re.search(pat, fences, re.I) for pat in pats):
                report.ok("%s: %s" % (task_id, label))
            else:
                report.fail("%s: bootstrap contract missing '%s'" % (task_id, label))
                offenders += 1
    if not offenders:
        report.ok("no validation block uses a plain createdb environment")
    return offenders


def check_artefact_cycles(tasks, report):
    """Round-8: task -> required artefact -> artefact's owner task -> dependency
    path back to the task. A task cannot require a file produced by something
    that depends on it: the file will not exist when it is needed."""
    print("\n[11] ACCEPTANCE-ARTEFACT CYCLES")
    producer = {}
    for task_id, task in tasks.items():
        for path in task["files"]:
            producer.setdefault(path, task_id)

    def reaches(a, b, seen=None):
        seen = seen or set()
        if a == b:
            return True
        if a in seen:
            return False
        seen.add(a)
        return any(reaches(d, b, seen) for d in tasks.get(a, {}).get("deps", ()))

    cycles = 0
    for task_id, task in sorted(tasks.items()):
        # artefacts REQUIRED by this task's executable validation, not merely mentioned
        required = set()
        for fence in re.findall(r"```bash\n(.*?)```", task["body"], re.S):
            required |= set(re.findall(r"[\w./$\{\}\-]*?(supabase/tests/[\w.\-]+\.sql)", fence))
        for artefact in sorted(required):
            owner = producer.get(artefact)
            if owner is None:
                report.fail("%s requires %s, which NO task produces" % (task_id, artefact))
                cycles += 1
                continue
            if owner == task_id:
                continue                      # produced by the task itself: fine
            if reaches(owner, task_id):
                report.fail("ACCEPTANCE CYCLE: %s requires %s, produced by %s, "
                            "which transitively depends on %s — the file will not "
                            "exist when %s runs" % (task_id, artefact, owner, task_id, task_id))
                cycles += 1
            else:
                report.ok("%s requires %s (produced by %s, no cycle)" % (task_id, artefact, owner))
    if not cycles:
        report.ok("0 acceptance-artefact cycles")
    return cycles


def check_dependency_tokens(text, tasks, report):
    """Round 9 (F2): every depends_on token must resolve to a real task id, a
    known human dependency, or a defined gate. An unknown token must FAIL.

    This is the check whose absence hid the 1A-002 -> 1A-002A/B split: an
    unknown token was dropped from BOTH the block set and the index set, so the
    equality check compared two sets that agreed *because the same edge had
    vanished from each*."""
    print("\n[3] DEPENDENCY TOKEN RESOLUTION")
    known = set(tasks) | set(INDEX_ONLY_TASKS) | set(HUMAN_TOKENS) | set(GATE_TOKENS)
    # candidate tokens: task-id shaped strings appearing in a depends_on clause
    shape = re.compile(r"\b(?:SEC-|OPS-|DEMO-)?\d?[A-Z]?-?[0-9A-Za-z]*\d[0-9A-Za-z]*\b")
    unknown = 0

    def scan(where, raw, ident):
        nonlocal unknown
        cleaned = raw
        for k in sorted(known, key=len, reverse=True):
            cleaned = cleaned.replace(k, " ")
        for tok in re.findall(r"\b(?:SEC-1D|OPS-[0-9A-Z]+|DEMO)-[0-9A-Za-z]+|\b1[A-E]-[0-9]{3}[A-Z]?\b|\b1E-L\d[ab]?\b|\bH-\d{2}\b",
                              cleaned):
            report.fail("UNKNOWN DEPENDENCY '%s' in %s of %s — resolves to no task, "
                        "human dependency or gate" % (tok, where, ident))
            unknown += 1

    for tid, task in sorted(tasks.items()):
        dep = re.search(r"depends_on:\s*(.+?)\s*·\s*\*\*(?:XS|S|M|L|XL)\*\*", task["header"])
        if dep:
            scan("block depends_on", dep.group(1), tid)

    index_start = text.index("## Task index")
    for line in text[index_start:].split("\n"):
        if not line.startswith("| "):
            continue
        cells = [c.strip() for c in line.split("|")[1:-1]]
        if len(cells) < 6:
            continue
        key = cells[0].replace("~~", "").replace("`", "").replace("**", "")
        if key in tasks or key in INDEX_ONLY_TASKS:
            scan("index row", cells[5], key)

    if not unknown:
        report.ok("every depends_on token resolves to a task, human dependency or gate")
    return unknown


def check_artefact_resolution(repo, tasks, report):
    """Round 9 (F4): resolve EVERY repository artefact referenced in a validation
    fence, not just supabase/tests/*.sql. Missing producer, wrong order, or two
    producers are all failures. This is the check that would have caught
    supabase/config.toml being required before 1D-009 creates it."""
    print("\n[12] ARTEFACT RESOLUTION (all paths, not just supabase/tests)")
    producers = collections.defaultdict(list)   # file -> tasks that CREATE it
    editors = collections.defaultdict(list)     # file -> tasks that touch it
    for tid, task in tasks.items():
        scope_line = re.search(r"\*\*scope\*\*[^:]*:\s*(.+)", task["body"])
        raw = scope_line.group(1) if scope_line else ""
        for f in task["files"]:
            key = f.lstrip("./")
            editors[key].append(tid)
            # marked "(new)" in the scope line -> this task creates the file
            if re.search(re.escape(f) + r"`?\s*\((?:new|moved)\)", raw):
                producers[key].append(tid)

    def reaches(a, b, seen=None):
        seen = seen or set()
        if a == b:
            return True
        if a in seen:
            return False
        seen.add(a)
        return any(reaches(d, b, seen) for d in tasks.get(a, {}).get("deps", ()))

    problems = 0
    for f, owners in sorted(producers.items()):
        if len(set(owners)) > 1:
            report.fail("two tasks both CREATE %s: %s" % (f, sorted(set(owners))))
            problems += 1
    # several tasks may EDIT one file; that is governed by serialisation
    # (check [3]) and single-agent ownership (check [4]), not by this check.

    for tid, task in sorted(tasks.items()):
        referenced = set()
        for fence in re.findall(r"```bash\n(.*?)```", task["body"], re.S):
            # Paths under a scratch/temp variable are NOT repository artefacts.
            # Strip them first, or "$SCRATCH/supabase/config.toml" reads as a
            # demand for the repository's own supabase/config.toml.
            # strip shell comments: a comment cannot require a file
            scanned = re.sub(r"(?m)^\s*#.*$", " ", fence)
            scanned = re.sub(r"\$\{?(?:SCRATCH|TMPDIR|TMP)\}?/[\w./\-]+", " ", scanned)
            referenced |= set(re.findall(ARTEFACT_RE, scanned))
        own = {f.lstrip("./") for f in task["files"]}
        for art in sorted(referenced):
            art = art.lstrip("./")
            if art in own:
                continue
            on_disk = os.path.exists(os.path.join(repo, art))
            producer = (producers.get(art) or [None])[0]
            if on_disk and producer is None:
                report.ok("%s uses %s (exists on disk, no producer needed)" % (tid, art))
                continue
            if producer is None:
                report.fail("%s requires %s — file does NOT exist and NO task produces it"
                            % (tid, art))
                problems += 1
                continue
            if reaches(producer, tid):
                report.fail("ACCEPTANCE CYCLE: %s requires %s, produced by %s, which "
                            "transitively depends on %s" % (tid, art, producer, tid))
                problems += 1
            elif not reaches(tid, producer):
                report.fail("ORDER: %s requires %s, produced by %s, but %s does not "
                            "depend on %s — nothing guarantees the file exists yet"
                            % (tid, art, producer, tid, producer))
                problems += 1
            else:
                report.ok("%s requires %s (produced by %s, correctly ordered)" % (tid, art, producer))
    if not problems:
        report.ok("0 artefact resolution problems")
    return problems


def check_graph_referential_integrity(repo, tasks, report):
    """Round 10: every task-shaped token in ANY active plan graph must resolve.

    The backlog being clean is not enough: round 9 fixed plan/01 and left
    plan/02 and plan/04 pointing at a task the split had removed. Tokens are
    matched by SHAPE, not against a known alphabet, so an unknown id cannot
    slip through by simply not being recognised."""
    print("\n[13] PLAN-GRAPH REFERENTIAL INTEGRITY")
    known = set(tasks) | set(INDEX_ONLY_TASKS) | set(HUMAN_TOKENS) | set(GATE_TOKENS)
    known |= {"H-01", "H-02", "H-03", "H-04", "H-05", "H-06", "H-07", "H-08",
              "H-09", "H-10", "H-11", "H-12", "H-13", "H-14"}
    # Documented non-tasks: 1B-006 is the cross-listing pointer (plan/01 names it
    # as such); 1B-009 is deferred to Phase 2A and registered as D-17 in plan/05.
    known |= {"1B-006", "1B-009"}
    bad = 0
    for rel in PLAN_GRAPHS:
        fp = os.path.join(repo, rel)
        if not os.path.isfile(fp):
            continue
        for lineno, line in enumerate(open(fp, encoding="utf-8", errors="replace"), 1):
            stripped = line.lstrip()
            # Only ACTIVE plan rows carry live edges: markdown table rows and
            # task-header `depends_on:` lines. Prose, blockquotes and history
            # tables legitimately name superseded ids (e.g. explaining a split),
            # and flagging those would make the check unusable.
            is_table_row = stripped.startswith("|")
            is_dep_line = stripped.startswith("`P") and "depends_on:" in line
            # Round 12 (MAJOR-1): mandatory task fields are live content too.
            # A dangling id sat in 1A-003's **risk** field and was invisible,
            # because only table rows and depends_on lines were scanned - while
            # the guarantee list claimed 'reference existence across plan/01-05'.
            is_field_line = bool(re.match(r"\*\*(scope|goal|acceptance_criteria"
                                          r"|validation|risk|rollback|test_contract)\*\*",
                                          stripped))
            if not (is_table_row or is_dep_line or is_field_line):
                continue
            if stripped.startswith(">"):
                continue                       # blockquote = commentary
            # (range handling is per-token, below)
            # a row that annotates its own supersession is a record, not an edge
            # Round 11: this list previously included `history` and `was`, which are
            # ordinary English appearing in live rows (R-02 says "history is
            # fabricated"), so a whole active row was skipped for containing one.
            # Only unambiguous supersession markers remain.
            if re.search(r"superseded|~~|split into|round-\d+ (?:figure|record)",
                         line, re.I):
                continue
            for tok in set(TASK_SHAPE.findall(line)):
                if tok in known:
                    continue
                if _is_ranged(tok, line):
                    continue                   # "SEC-1D-001..003" names a span
                # A RENAME RECORD names the retired id on the left of an arrow and
                # its replacement(s) on the right: "DEMO-001 -> DEMO-001A + DEMO-001B".
                # That is documentation of the split, not a live edge. Recognised
                # precisely (successor must itself resolve) rather than by skipping
                # every row containing an arrow.
                rename = re.search(re.escape(tok) + r"`?\s*(?:->|\u2192)\s*`?([^|]*)", line)
                if rename and any(s in known for s in TASK_SHAPE.findall(rename.group(1))):
                    continue
                report.fail("UNRESOLVED TASK TOKEN '%s' in %s:%d — no such task, "
                            "human dependency or gate" % (tok, os.path.basename(rel), lineno))
                bad += 1
    if not bad:
        report.ok("every task token in the 5 active plan graphs resolves")
    return bad


def check_task_contradictions(tasks, report):
    """Round 10 (BLOCKER 2): a task may not both REQUIRE an action and declare
    it out of scope."""
    print("\n[14] TASK-INTERNAL CONTRADICTIONS")
    bad = 0
    for tid, task in sorted(tasks.items()):
        body = task["body"]
        # acceptance criteria = bullet lines; exclusions = blockquote lines
        required = "\n".join(l for l in body.split("\n") if l.startswith("- "))
        excluded = "\n".join(l for l in body.split("\n") if l.lstrip().startswith(">"))
        for label, terms in CONTRADICTION_ACTIONS:
            req = any(all(re.search(term, line, re.I) for term in terms)
                      for line in required.split("\n"))
            exc = any(all(re.search(term, line, re.I) for term in terms)
                      and re.search(EXCLUSION_MARKERS, line, re.I)
                      for line in excluded.split("\n"))
            if req and exc:
                report.fail("CONTRADICTION in %s: '%s' is REQUIRED by an acceptance "
                            "criterion and simultaneously declared out of scope"
                            % (tid, label))
                bad += 1
    if not bad:
        report.ok("no task both requires and excludes the same action")
    return bad


def check_self_test(report):
    """Round 10: every check_* defined must be reachable from main().
    A defined-but-uncalled check has happened twice in this engagement."""
    print("\n[15] VERIFIER SELF-TEST (defined-but-unreachable checks)")
    src = open(os.path.abspath(__file__), encoding="utf-8").read()
    # Round 11 (MAJOR-C): the old pattern was `check_[a-z_]+`, which cannot match
    # a name containing a digit. `check_h01` was invisible, so the verifier
    # reported 18/18 when there were 19 — and deleting its call stayed green.
    # Round 12: parse with `ast`. The previous `src.index("def main(")` matched
    # the string literal on its OWN line, so `main_src` began here and contained
    # the *definitions* of every check declared below - each matching its own
    # `def` line and counting as reachable whether or not main() called it.
    # check_fence_syntax, check_stale and check_h01 were all falsely reachable.
    import ast as _ast
    _tree = _ast.parse(src)
    defined = {f.name for f in _ast.walk(_tree)
               if isinstance(f, _ast.FunctionDef) and f.name.startswith('check_')}
    _main = next((f for f in _ast.walk(_tree)
                  if isinstance(f, _ast.FunctionDef) and f.name == 'main'), None)
    called = set()
    if _main is not None:
        called = {c.func.id for c in _ast.walk(_main)
                  if isinstance(c, _ast.Call) and isinstance(c.func, _ast.Name)} & defined
    unreachable = sorted(defined - called - {"check_self_test"})
    print("   defined: %d   reachable from main(): %d" % (len(defined), len(called)))
    if unreachable:
        report.fail("defined but NEVER CALLED: %s" % unreachable)
    else:
        report.ok("all %d check functions are reachable from main()" % len(defined))

    # A check whose failures go into a throwaway Report() is silently discarded.
    # Every call must pass the shared `report` name.
    bad_report = []
    if _main is not None:
        for c in _ast.walk(_main):
            if (isinstance(c, _ast.Call) and isinstance(c.func, _ast.Name)
                    and c.func.id in defined and c.func.id != 'check_self_test'):
                names = {a.id for a in c.args if isinstance(a, _ast.Name)}
                if 'report' not in names:
                    bad_report.append(c.func.id)
    if bad_report:
        report.fail("called with a non-shared Report (failures would be discarded): %s"
                    % sorted(set(bad_report)))
    else:
        report.ok("every check receives the shared report object")
    return len(unreachable) + len(bad_report)


def check_fence_syntax(repo, tasks, report):
    """Round 10 item 7: the validation fences must be valid shell."""
    print("\n[16] FENCE SHELL SYNTAX (bash -n)")
    import subprocess as _sp, tempfile as _tf
    bad = 0
    for tid, task in sorted(tasks.items()):
        for n, fence in enumerate(re.findall(r"```bash\n(.*?)```", task["body"], re.S), 1):
            fh = _tf.NamedTemporaryFile("w", suffix=".sh", delete=False, encoding="utf-8")
            fh.write(fence)
            fh.close()
            try:
                r = None
                for shell in ("bash", "sh", "/usr/bin/bash", "/bin/bash"):
                    try:
                        r = _sp.run([shell, "-n", fh.name], capture_output=True,
                                    text=True, timeout=30)
                    except FileNotFoundError:
                        continue
                    # a shell that cannot even start is an environment fault,
                    # not a syntax defect in the document
                    if r.returncode != 0 and re.search(
                            r"execvpe|CreateProcessCommon|No such file or directory",
                            r.stderr or ""):
                        r = None
                        continue
                    break
                if r is None:
                    report.note("no usable shell for `-n` — syntax check skipped "
                                "(environment, not a document defect)")
                    return 0
                if r.returncode != 0:
                    report.fail("%s fence %d is not valid shell: %s"
                                % (tid, n, r.stderr.strip()[:120]))
                    bad += 1
            except Exception as exc:
                report.note("bash unavailable (%s) — syntax check skipped" % exc)
                return 0
            finally:
                os.unlink(fh.name)
    if not bad:
        report.ok("every validation fence passes `bash -n`")
    return bad


def check_stale(repo, report):
    print("\n[12] ACTIVE STALE ASSERTIONS (every .md under docs/, no whitelist)")
    stale = {
        "58": ["case", "e2e"], "21": ["predict", "defect", "failur"],
        "18": ["blocked", "device"], "20": ["l1", "layer", "failing"],
        "42": ["task", "row", "backlog"], "41": ["open", "specified"],
        "36": ["task", "row"], "31": ["task"], "69": ["file", "distinct"],
        # round-9: cover the transitions the canonical figures actually made
        "48": ["open", "specified", "task"], "49": ["row", "backlog"],
        "73": ["file", "distinct"],
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
    print("\n[13] H-01 CLOSURE")
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
    unknown_tokens = check_dependency_tokens(text, tasks, report)
    owners, unserialised = check_serialisation(tasks, report)
    conflicts, violations = check_ownership(tasks, owners, report)
    sizes, file_count = check_sizes_and_cycles(tasks, report)
    check_migration_ordering(repo, tasks, report)
    check_bash_executability(tasks, report)
    check_two_stage_validation(tasks, report)
    check_deletion_regression(repo, tasks, args.baseline_rev, report)
    check_supabase_bootstrap(tasks, report)
    artefact_cycles = check_artefact_cycles(tasks, report)
    artefact_problems = check_artefact_resolution(repo, tasks, report)
    graph_bad = check_graph_referential_integrity(repo, tasks, report)
    contradictions = check_task_contradictions(tasks, report)
    unreachable = check_self_test(report)
    syntax_bad = check_fence_syntax(repo, tasks, report)
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
    print("  unknown dependency tokens ... %d" % unknown_tokens)
    print("  acceptance-artefact cycles .. %d" % artefact_cycles)
    print("  artefact resolution issues .. %d" % artefact_problems)
    print("  unresolved graph tokens ..... %d" % graph_bad)
    print("  task contradictions ......... %d" % contradictions)
    print("  unreachable checks .......... %d" % unreachable)
    print("  fence syntax errors ......... %d" % syntax_bad)
    print("  H-01 open-decision sites .... %d" % h01)
    print("  stale candidates ............ %d" % candidates)
    print("  FAILURES .................... %s" % (len(report.failures) or "NONE"))
    print("=" * 78)
    return 1 if report.failures else 0


if __name__ == "__main__":
    sys.exit(main())
