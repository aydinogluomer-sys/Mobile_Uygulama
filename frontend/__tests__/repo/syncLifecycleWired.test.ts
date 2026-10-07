/**
 * §18 / §22 — the two subsystems are actually REACHED.
 *
 * Both `hydrateSyncQueue`/`flushPendingSync` and `lib/analytics.ts` were
 * finished, documented, unit-tested — and called by nothing but their own
 * test files. That is a failure mode no behavioural test can catch, because
 * every behavioural test calls the store directly and therefore passes
 * whether or not the app ever does. This file is the missing half: it asserts
 * the CALL SITES exist, in the right place, in the right order.
 *
 * ON THE KNOWN TRAP IN THIS REPO. A source-text assertion that matches too
 * loosely produces confident nonsense — a match in a comment, or in an
 * unrelated part of the same file, makes a broken thing look green. It has
 * happened here four times. Two defences, applied to every assertion below:
 *
 *   1. COMMENTS ARE STRIPPED before anything is matched. The production files
 *      this checks discuss `hydrateSyncQueue()` and `flushPendingSync()` at
 *      length in their own comments; a raw `src.includes(...)` would pass with
 *      the actual calls deleted. `stripComments` is proven on a fixture below
 *      rather than assumed.
 *   2. SCOPE IS ANCHORED, not just the pattern. Every check slices the exact
 *      function body / JSX subtree it means, so a match somewhere else in the
 *      same file cannot satisfy it. Scanner-sanity cases prove each pattern
 *      rejects the near-miss it is supposed to reject.
 *
 * AC-W01  `hydrateSyncQueue()` is AWAITED in the boot sequence, before
 *         `setLoading(false)` — the store's own contract
 * AC-W02  nothing renders until boot resolves, so the "tap races hydration"
 *         race is structurally impossible rather than merely unlikely
 * AC-W03  `flushPendingSync()` runs after hydration at boot
 * AC-W04  `flushPendingSync()` runs on `AppState -> 'active'`
 * AC-W05  no polling timer, no network-state library
 * AC-W06  the re-entrancy guard lives in the STORE, not in the caller
 * AC-W07  the §22 event is emitted from `logHabit` and from nowhere else —
 *         in particular NOT from the replay path, which would double-count
 * AC-W08  `SyncStatusBadge` is exported from the ui barrel and MOUNTED in the
 *         screen where habit completion happens
 */
import { execSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
// `stripComments`/`at` are shared rather than copied — that duplication is
// what let a CRLF defect survive in two of the four gates. See the helper.
import { stripComments, at } from '../helpers/sourceText';

const ROOT = join(__dirname, '..', '..');

const read = (p: string) => stripComments(readFileSync(join(ROOT, p), 'utf8'));

const layout = read('app/_layout.tsx');
const store = read('store/logStore.ts');
const today = read('app/tabs/today.tsx');
const barrel = read('components/ui/index.ts');

/** The boot IIFE inside the first effect — not the whole file. */
function bootSequence(): string {
  const start = layout.indexOf('let alive = true;');
  const end = layout.indexOf('subscription.unsubscribe', start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return layout.slice(start, end);
}

describe('the comment stripper actually works (everything below depends on it)', () => {
  it('removes a call that appears only inside a comment', () => {
    const fixture = [
      '// calls hydrateSyncQueue() at boot',
      '/* also flushPendingSync() here */',
      'const x = 1;',
    ].join('\n');
    const out = stripComments(fixture);
    expect(out).not.toContain('hydrateSyncQueue()');
    expect(out).not.toContain('flushPendingSync()');
    expect(out).toContain('const x = 1;');
  });

  it('keeps real code that sits before a trailing comment', () => {
    expect(stripComments('await hydrateSyncQueue(); // boot')).toContain('await hydrateSyncQueue();');
  });

  it('does not mistake a URL for a comment', () => {
    expect(stripComments("const u = 'https://x.dev/a';")).toContain('https://x.dev/a');
  });

  it('strips comments from CRLF source exactly as it does from LF source', () => {
    // The bug this pins: `.` does not match `\r`, so with CRLF endings the
    // line-comment pattern never matched and stripping became a no-op — which
    // made every assertion in this file read comments as if they were code.
    const lf = ['// calls hydrateSyncQueue() at boot', 'const x = 1;'].join('\n');
    const crlf = lf.replace(/\n/g, '\r\n');
    expect(stripComments(crlf)).not.toContain('hydrateSyncQueue()');
    expect(stripComments(crlf)).toBe(stripComments(lf));
  });

  it('the production files really do discuss these calls in comments — so stripping matters', () => {
    const raw = readFileSync(join(ROOT, 'app/_layout.tsx'), 'utf8');
    const mentionsInComments =
      (raw.match(/hydrateSyncQueue/g) ?? []).length - (layout.match(/hydrateSyncQueue/g) ?? []).length;
    expect(mentionsInComments).toBeGreaterThan(0);
  });
});

describe('AC-W01 — hydration is awaited at boot, before anything can be tapped', () => {
  it('hydrateSyncQueue() is called in the boot sequence', () => {
    expect(bootSequence()).toContain('hydrateSyncQueue()');
  });

  it('it is AWAITED, not fired and forgotten', () => {
    const boot = bootSequence();
    const callAt = at(boot, 'hydrateSyncQueue()');
    const awaitAt = boot.lastIndexOf('await', callAt);
    expect(awaitAt).toBeGreaterThan(-1);
    // Nothing between the `await` and the call may end a statement, so the
    // call is genuinely inside the awaited expression.
    expect(boot.slice(awaitAt, callAt)).not.toMatch(/[;{}]/);
  });

  it('it completes before the boot gate opens', () => {
    const boot = bootSequence();
    expect(at(boot, 'setLoading(false)')).toBeGreaterThan(at(boot, 'hydrateSyncQueue()'));
  });

  it('scanner sanity — a fire-and-forget call would fail the await check', () => {
    const fake = 'await getSession();\n      hydrateSyncQueue();';
    const callAt = fake.indexOf('hydrateSyncQueue()');
    expect(fake.slice(fake.lastIndexOf('await', callAt), callAt)).toMatch(/[;{}]/);
  });
});

describe('AC-W02 — nothing renders while the boot sequence is still running', () => {
  /**
   * The gate now reads `if (loading || (!!session && !onboardingHydrated))`.
   *
   * The property this AC protects is unchanged and in fact stronger: the
   * navigator still renders nothing until boot resolves, and now also waits
   * for the onboarding row, so a new user never sees Today flash before
   * being redirected. `[^{]*?` widens the condition without letting the
   * pattern run past the opening brace into unrelated code -- the sanity
   * case below still proves the effects' one-line `if (loading) return;`
   * cannot satisfy it.
   */
  const BOOT_GATE = /if \(loading[^{]*?\) \{\s*return \(/;

  it('a block-bodied `if (loading …)` returns early', () => {
    expect(layout).toMatch(BOOT_GATE);
  });

  it('the gate still starts with the boot flag', () => {
    // Widening the condition must not become "any early return will do".
    expect(layout).toMatch(/if \(loading\b/);
  });

  it('that gate precedes the navigator', () => {
    const gate = layout.search(BOOT_GATE);
    expect(gate).toBeGreaterThan(-1);
    expect(at(layout, '<Stack')).toBeGreaterThan(gate);
  });

  it('scanner sanity — the effects\' own `if (loading) return;` must NOT satisfy it', () => {
    expect('if (loading) return;\n\n  const x = 1;').not.toMatch(BOOT_GATE);
  });
});

describe('AC-W03 / AC-W04 — the flush has two triggers and only two', () => {
  it('boot flushes after hydration', () => {
    const boot = bootSequence();
    expect(at(boot, 'flushPendingSync(')).toBeGreaterThan(at(boot, 'hydrateSyncQueue()'));
  });

  it('an AppState listener flushes on return to the foreground', () => {
    const listenerAt = at(layout, 'AppState.addEventListener');
    const end = layout.indexOf('sub.remove()', listenerAt);
    expect(end).toBeGreaterThan(listenerAt);
    // Scoped to the listener itself: a `flushPendingSync(` anywhere else in
    // the file (the boot call, for instance) cannot satisfy this.
    const handler = layout.slice(listenerAt, end);
    expect(handler).toMatch(/next === 'active'/);
    expect(handler).toContain('flushPendingSync(');
  });

  it('scanner sanity — a listener that never flushes would fail', () => {
    const fake = "AppState.addEventListener('change', (n) => { if (n === 'active') doNothing(); });";
    expect(fake.slice(0, fake.length)).not.toContain('flushPendingSync(');
  });
});

describe('AC-W05 — no polling timer and no network-state dependency', () => {
  it('the root layout starts no interval', () => {
    expect(layout).not.toMatch(/setInterval\s*\(/);
  });

  it('no netinfo-style library was added', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    for (const name of Object.keys(deps)) {
      expect(name).not.toMatch(/netinfo|network-info/i);
    }
  });

  it('no third-party analytics SDK was added either (plan §22 seam only)', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    for (const name of Object.keys(deps)) {
      expect(name).not.toMatch(/segment|amplitude|mixpanel|posthog|firebase\/analytics/i);
    }
  });
});

describe('AC-W06 — the re-entrancy guard lives with the flush, not with a caller', () => {
  it('the store declares it', () => {
    expect(store).toMatch(/let\s+flushInFlight\b/);
  });

  it('flushPendingSync consults it', () => {
    const at = store.indexOf('flushPendingSync: ');
    expect(at).toBeGreaterThan(-1);
    const end = store.indexOf('\n    },', at);
    expect(end).toBeGreaterThan(at);
    const body = store.slice(at, end);
    expect(body).toContain('flushInFlight');
  });

  it('the caller does NOT reimplement its own guard — that would protect one caller only', () => {
    expect(layout).not.toMatch(/flushInFlight|flushingRef|isFlushing/);
  });
});

describe('AC-W07 — the §22 event is emitted from logHabit and nowhere else', () => {
  const decl = 'function emitHabitLogEvent';

  it('logStore builds its events with buildEvent', () => {
    expect(store).toContain('buildEvent(');
    expect(store).toContain('emitEvent(');
  });

  it('there is exactly ONE emission call site', () => {
    const calls = store.match(/emitHabitLogEvent\(/g) ?? [];
    // One declaration + one call.
    expect(calls).toHaveLength(2);
    expect(store.indexOf(decl)).toBeGreaterThan(-1);
  });

  it('that call site is inside logHabit', () => {
    const start = store.indexOf('logHabit: (');
    const end = store.indexOf('getLogForHabit: (habitId, date)', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(store.slice(start, end)).toContain('emitHabitLogEvent(');
  });

  it('the replay path does NOT emit — a queued write must not double-count', () => {
    const start = store.indexOf('async function runFlushPass');
    const end = store.indexOf('return {', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(store.slice(start, end)).not.toContain('emitHabitLogEvent(');
  });

  it('no screen emits directly — a screen can be bypassed', () => {
    const out = execSync(
      'grep -rl "buildEvent\\|emitEvent" app components --include=*.tsx || true',
      { cwd: ROOT, encoding: 'utf8' },
    );
    expect(out.trim()).toBe('');
  });
});

describe('AC-W08 — the sync badge exists, is exported, and is mounted', () => {
  it('the component file exists', () => {
    expect(existsSync(join(ROOT, 'components/ui/SyncStatusBadge.tsx'))).toBe(true);
  });

  it('is exported from the ui barrel, like every other primitive', () => {
    expect(barrel).toMatch(/^export .*SyncStatusBadge.* from '\.\/SyncStatusBadge';$/m);
  });

  it('scanner sanity — a mention is not an export line', () => {
    expect("const s = \"SyncStatusBadge from './SyncStatusBadge';\";").not.toMatch(
      /^export .*SyncStatusBadge.* from '\.\/SyncStatusBadge';$/m,
    );
  });

  it('is MOUNTED in today.tsx\'s rendered tree, not merely imported', () => {
    const jsxAt = today.indexOf('<SafeAreaView');
    expect(jsxAt).toBeGreaterThan(-1);
    const jsx = today.slice(jsxAt);
    // Scoped to the returned JSX: the `import { … SyncStatusBadge }` line at
    // the top of the file sits before this slice and cannot satisfy it.
    expect(jsx).toMatch(/<SyncStatusBadge[\s/>]/);
  });

  it('is wired to the real store counts, not to a placeholder', () => {
    const jsxAt = today.indexOf('<SafeAreaView');
    const tag = today.slice(jsxAt).match(/<SyncStatusBadge[^>]*\/>/);
    expect(tag).not.toBeNull();
    // R02: the task outbox's counts are ADDED to the habit-log queue's; the
    // queue's own counts must still be there, first, from the store.
    expect(tag![0]).toMatch(/pending=\{pendingSyncCount(?: \+ taskSync\.pending)?\}/);
    expect(tag![0]).toMatch(/dead=\{deadSyncCount(?: \+ taskSync\.dead \+ taskSync\.conflict)?\}/);
    // …and those names come from the store, not from local state.
    expect(today).toMatch(
      /const \{[^}]*\bpendingSyncCount\b[^}]*\bdeadSyncCount\b[^}]*\} = useLogStore\(\);/,
    );
  });

  it('the component renders BOTH tones rather than collapsing them', () => {
    const badge = read('components/ui/SyncStatusBadge.tsx');
    // The pure derivation is asserted in __tests__/ui/syncStatusBadge.test.ts;
    // what matters here is that the component actually renders what it derives.
    expect(badge).toContain('syncBadgeParts(');
    expect(badge).toMatch(/parts\.map\(/);
  });
});
