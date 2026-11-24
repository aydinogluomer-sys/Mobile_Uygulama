/**
 * `daily_capacity` stays empty, on purpose. This file is that decision.
 *
 * ## The question
 *
 * Migration `005_phase1_core_engine.sql` §C created `daily_capacity`
 * with columns that mirror `lib/capacity.dailyLoad`'s output one for one —
 * `habit_load, task_load, focus_load, overdue_pressure, raw_load,
 * normalised_load, band`, keyed `(user_id, capacity_date)`. Live it has RLS,
 * one owner policy, and zero rows, because no client code has ever written
 * it. The obvious reading is "unfinished wiring".
 *
 * It is not. Wiring it would introduce a SECOND answer to a question that
 * already has one.
 *
 * ## Why a snapshot would be a second source of truth, not a cache
 *
 * `dailyLoad` is a pure function of four inputs — the habits due that day,
 * the tasks due that day, focus minutes logged, and the overdue count — and
 * every one of those already lives in a table (`habits`, `tasks`,
 * `focus_sessions`). So a stored row is not new information; it is a copy of
 * a derivation, and a copy can disagree with its source.
 *
 * It disagrees immediately, not eventually. Load is a property of a day that
 * is still being lived: a snapshot written when the user opens the app at
 * 09:00 does not know about the task they add at 18:00. A reader then has to
 * choose between the stored number and the recomputed one, and whichever it
 * picks, the other is visibly wrong somewhere in the UI.
 *
 * ## The historical need is already met — by recomputation, in one place
 *
 * The argument FOR a snapshot is history: you cannot recompute a past day
 * whose inputs have changed. But the three surfaces that show historical load
 * already recompute it, all through the same `dailyLoad`:
 *
 *     app/screens/weekly-review.tsx     "days in [start,end] with band aşırı"
 *     app/screens/monthly-review.tsx    same, over a month
 *     app/screens/insights.tsx          same, over the insight window
 *
 * They work, they are tested, and they have exactly one implementation of the
 * scoring rule. Adding a snapshot writer would not remove that code — those
 * screens would still need to handle days with no snapshot — so the outcome
 * is both paths, forever, with the reconciliation between them as a new class
 * of bug.
 *
 * ## What is genuinely lost, stated rather than hidden
 *
 * Recomputation cannot reconstruct a day whose inputs were deleted: a task
 * completed and removed last week no longer contributes to last week's load.
 * That is a real limitation of the current design. It is accepted here
 * because no screen surfaces it and nobody has asked for it — and inventing a
 * second store of truth to answer a question the product does not ask is a
 * worse trade than the imprecision.
 *
 * If that requirement ever arrives, the honest shape is an append-only
 * end-of-day snapshot written by a scheduled server job (which cannot be
 * beaten by a same-day edit), read ONLY for days strictly before today, with
 * recomputation still serving today. That is a different design from "have
 * the client upsert its current number", which is what the empty table
 * invites.
 *
 * ## What this test enforces
 *
 * Not "never use the table" — a future forward migration and a server job may
 * well use it. What it enforces is that the CLIENT does not start writing it
 * casually, and that the historical consumers keep deriving from one
 * implementation. Both assertions fail loudly if someone wires an upsert in
 * without revisiting the reasoning above.
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative, sep } from 'path';
import { stripComments } from '../helpers/sourceText';

const ROOT = join(__dirname, '..', '..');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

const PROD_DIRS = ['app', 'components', 'store', 'services', 'repositories', 'lib'];
const FILES = PROD_DIRS.flatMap((d) => walk(join(ROOT, d)));
const rel = (f: string) => relative(ROOT, f).split(sep).join('/');

describe('the scan sees the production tree', () => {
  it('reads a realistic number of files', () => {
    // A zero-length list would make the negative assertion below pass for the
    // worst possible reason.
    expect(FILES.length).toBeGreaterThan(100);
  });
});

describe('daily_capacity is not written by the client', () => {
  it('no production file names the table outside a comment (except backupFormat NOT_BACKED_UP exclusion)', () => {
    const hits = FILES
      .filter((f) => stripComments(readFileSync(f, 'utf8')).includes('daily_capacity'))
      .map(rel)
      .filter((p) => p !== 'lib/backupFormat.ts');
    expect(hits).toEqual([]);
    const bf = stripComments(readFileSync(join(ROOT, 'lib/backupFormat.ts'), 'utf8'));
    expect((bf.match(/daily_capacity/g) ?? []).length).toBe(1);
    expect(bf).toMatch(/\bdaily_capacity\s*:/);
    expect(bf).not.toContain("'daily_capacity'");
  });

  it('no repository exists for it', () => {
    const repos = readdirSync(join(ROOT, 'repositories'));
    expect(repos.filter((f) => /capacity/i.test(f))).toEqual([]);
  });
});

describe('historical load has exactly one implementation', () => {
  const consumers = [
    'app/screens/weekly-review.tsx',
    'app/screens/monthly-review.tsx',
    'app/screens/insights.tsx',
  ];

  it.each(consumers)('%s derives its trend from lib/capacity.dailyLoad', (f) => {
    const src = stripComments(readFileSync(join(ROOT, f), 'utf8'));
    // Positive control: these screens really do compute load, so the
    // assertion below is about HOW rather than whether.
    expect(src).toContain('dailyLoad(');
    expect(src).toContain("from '../../lib/capacity'");
  });

  it.each(consumers)('%s does not read a stored snapshot instead', (f) => {
    const src = stripComments(readFileSync(join(ROOT, f), 'utf8'));
    expect(src).not.toContain('daily_capacity');
  });

  it('the scoring rule itself lives in one module', () => {
    // `dailyLoad` is exported from exactly one place; a second definition
    // would mean two answers before any table is involved.
    const definitions = FILES.filter((f) =>
      /export function dailyLoad\b/.test(stripComments(readFileSync(f, 'utf8'))),
    ).map(rel);
    expect(definitions).toEqual(['lib/capacity.ts']);
  });
});
