/**
 * R02 — the task outbox is wired: every task write goes through it, the
 * root layout flushes it on boot / foreground / session refresh and drops it
 * from memory on sign-out, the badge counts it, and the matrix document
 * exists and names its stop point.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '../helpers/sourceText';

const ROOT = join(__dirname, '..', '..');
const code = (p: string) => stripComments(readFileSync(join(ROOT, p), 'utf8'));

describe('R02 — task writes are local-first', () => {
  const store = code('store/taskStore.ts');

  it('the store no longer calls the direct write paths', () => {
    expect(store).not.toMatch(/\b(insertTask|repoUpdateTask|repoDeleteTask|setCompleted)\(/);
  });

  it('every task mutation goes through apply() -> taskChannel.write on the shared outbox', () => {
    for (const fn of ['addTask', 'updateTask', 'removeTask', 'toggleDone']) {
      const at = store.indexOf(`  ${fn}: async`);
      const body = store.slice(at, store.indexOf('\n  },', at));
      expect(body).toMatch(/apply\(/);
    }
    expect(store).toMatch(/const res = await taskChannel\.write\(input,/);
  });

  it('a refetch overlays unsent changes', () => {
    expect(store).toMatch(/const live = get\(\)\.outbox \?\? box;[\s\S]*tasks: live \? overlay\(live, 'task', res\.data\.rows\) : res\.data\.rows/);
    expect(store).not.toMatch(/tasks: box \? overlay\(box,/);
  });

  it('the signed-in account is asked before every command', () => {
    expect(store).toMatch(/currentUserId: async \(\) => \(await currentUser\(\)\)\?\.id \?\? null/);
  });
});

describe('R02 — lifecycle', () => {
  const layout = code('app/_layout.tsx');
  it('flushes on boot and on foreground', () => {
    expect((layout.match(/useTaskStore\.getState\(\)\.flush\(\)/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
  it('drops the account from memory on sign-out, resumes after a session refresh', () => {
    // R02.03: the core outbox is reset / resumed together with the task outbox.
    // F04: the sign-out resets both through the one account registry (lib/accountScope.ts), which
    // is where each of them is registered; the layout calls nothing else on SIGNED_OUT.
    expect(layout).toMatch(/if \(event === 'SIGNED_OUT'\) \{ void endAccountScope\('signed_out', prevUid\); \}/);
    expect(code('store/taskStore.ts')).toMatch(/registerAccountScoped\(\{ name: 'task', store: useTaskStore \}\)/);
    expect(code('services/coreOutbox.ts')).toMatch(/registerAccountScoped\(\{ name: 'coreOutbox', onReset: \(\) => coreOutbox\.reset\(\) \}\)/);
    expect(layout).toMatch(/event === 'TOKEN_REFRESHED' \|\| event === 'SIGNED_IN'\) \{ void useTaskStore\.getState\(\)\.authRefreshed\(\); void coreOutbox\.authRefreshed\(\); \}/);
    expect(layout).toMatch(/void coreOutbox\.flush\(\);/);
  });
});

describe('R02 — visibility', () => {
  it('Today counts the outbox in the badge and lists what needs the user', () => {
    const today = code('app/tabs/today.tsx');
    // R02.03: the core outbox's count is added after the task outbox's.
    expect(today).toMatch(/pending=\{pendingSyncCount \+ taskSync\.pending(?: \+ coreSync\.pending)?\}/);
    expect(today).toMatch(/<OutboxIssues \/>/);
    const issues = code('components/OutboxIssues.tsx');
    expect(issues).toMatch(/retryChange\(c\.operationId\)/);
    expect(issues).toMatch(/discardChange\(c\.operationId\)/);
  });
});

describe('R02 — repository backstop', () => {
  it('each outbox write refuses a session that is not the command\'s account', () => {
    const repo = code('repositories/taskRepository.ts');
    expect((repo.match(/const wrong = wrongAccount\(expectedUserId, u\.userId\);\s*if \(wrong\) return wrong;/g) ?? []).length).toBe(3);
    const svc = code('services/taskService.ts');
    expect((svc.match(/cmd\.userId\)/g) ?? []).length).toBe(3);
  });
});

describe('R02.01 / R02.02 — the matrix document', () => {
  it('exists, lists the core domains and states the SQLite stop point', () => {
    const doc = readFileSync(join(ROOT, '..', 'docs', 'implementation-v3', 'R02_OFFLINE_MATRIX.md'), 'utf8');
    for (const s of ['Alışkanlık kaydı', 'Bugün görevleri', 'Kontrol listesi', 'Odak', 'Günlük / review', 'AI koç']) expect(doc).toContain(s);
    expect(doc).toMatch(/DURMA NOKTASI S7/);
    expect(doc).toMatch(/N\/R \(S8\)/);
  });
});
