/**
 * R08.01–R08.05 — manifest, verification, the dry run and what may come back.
 */
import {
  buildManifest, verifyBackupText, checksum, canonical, stripAuthority, REGISTRY, BACKUP_FORMAT_VERSION, MAX_BACKUP_TEXT_CHARS,
} from '../../lib/backupFormat';
import { planNotices, planRestore, planSummary } from '../../lib/restorePlan';

const U = 'user-a';
const data = {
  projects: [{ id: 'p1', user_id: U, name: 'Tez' }],
  tasks: [
    { id: 't1', user_id: U, title: 'Giriş', project_id: 'p1', updated_at: '2026-10-01T00:00:00Z' },
    { id: 't2', user_id: U, title: 'Kayıp', project_id: 'p-yok' },
  ],
  habits: [{ id: 'h1', user_id: U, name: 'Su', status: 'active', xp: 500 }],
  habit_logs: [{ id: 'l1', user_id: U, habit_id: 'h1', completed_at: '2026-10-01', xp: 30 }],
  journal_entries: [{ id: 'j1', user_id: U, date: '2026-10-01', content: 'a', mood: 3 }],
  webhooks: [{ id: 'w1', user_id: U, url: 'https://x' }],
};
const fileText = (over: Record<string, unknown> = {}, manifestUser = U) => JSON.stringify({
  format_version: 3, truncated: [], manifest: buildManifest(manifestUser, '2026-10-07T00:00:00Z', data), ...data, ...over,
});

describe('manifest and verification', () => {
  it('a fresh export verifies', () => {
    const r = verifyBackupText(fileText(), U);
    expect(r.ok).toBe(true);
    expect(BACKUP_FORMAT_VERSION).toBe(3);
  });
  it('checksums do not depend on key order', () => {
    expect(checksum(canonical({ a: 1, b: [1, { c: 2, d: 3 }] }))).toBe(checksum(canonical({ b: [1, { d: 3, c: 2 }], a: 1 })));
    expect(checksum('abc')).not.toBe(checksum('abd'));
  });
  it('refuses: not JSON, no manifest, another account, truncated, cut, edited, malformed meta or >25 MB', () => {
    expect(verifyBackupText('{oops', U).ok).toBe(false);
    expect(verifyBackupText(JSON.stringify({ format_version: 2, ...data }), U)).toMatchObject({ ok: false });
    expect(verifyBackupText(fileText({}, 'user-b'), U)).toMatchObject({ ok: false, reason: expect.stringMatching(/başka bir hesaba/) });
    expect(verifyBackupText(fileText({ truncated: ['tasks'] }), U)).toMatchObject({ ok: false, reason: expect.stringMatching(/eksik/) });
    expect(verifyBackupText(fileText({ tasks: data.tasks.slice(0, 1) }), U)).toMatchObject({ ok: false, reason: expect.stringMatching(/sayısı tutmuyor/) });
    expect(verifyBackupText(fileText({ tasks: [{ ...data.tasks[0], title: 'X' }, data.tasks[1]] }), U)).toMatchObject({ ok: false, reason: expect.stringMatching(/sağlaması tutmuyor/) });
    // F20 (SYN-18): meta null veya bozuk olduğunda TypeError atmaz, ok:false döner
    const nullMeta = JSON.stringify({
      format_version: 3,
      truncated: [],
      manifest: { format: 3, user_id: U, created_at: '2026-10-07T00:00:00Z', collections: { tasks: null } },
      tasks: [],
    });
    expect(verifyBackupText(nullMeta, U)).toMatchObject({ ok: false, reason: expect.stringMatching(/manifest kaydı bozuk/) });
    const badCollections = JSON.stringify({
      format_version: 3,
      truncated: [],
      manifest: { format: 3, user_id: U, created_at: '2026-10-07T00:00:00Z', collections: [] },
    });
    expect(verifyBackupText(badCollections, U)).toMatchObject({ ok: false, reason: expect.stringMatching(/koleksiyon listesi bozuk/) });
    expect(verifyBackupText('x'.repeat(MAX_BACKUP_TEXT_CHARS + 1), U)).toMatchObject({ ok: false, reason: expect.stringMatching(/çok büyük/) });
  });
});

describe('R08.05 — authority is never taken from a file', () => {
  it('XP, streaks, purged_xp, tokens, headers and tiers are stripped', () => {
    const { row, stripped } = stripAuthority({
      id: 'x', name: 'a', xp: 9, total_xp: 9, streak_current: 12, streak_best: 30, purged_xp: 5, headers: { a: 1 }, tier: 'pro', access_token: 't',
    });
    expect(row).toEqual({ id: 'x', name: 'a' });
    expect(stripped.sort()).toEqual(['access_token', 'headers', 'purged_xp', 'streak_best', 'streak_current', 'tier', 'total_xp', 'xp']);
  });
  it('server-scored and secret-less collections are not restorable', () => {
    expect(REGISTRY.filter((c) => !c.restorable).map((c) => c.name).sort()).toEqual([
      'ai_conversation_actions', 'ai_conversations', 'ai_messages', 'deep_work_sessions', 'device', 'focus_sessions',
      'habit_deletions', 'habit_logs', 'journal_insights', 'life_area_logs', 'profiles', 'routines', 'user_onboarding', 'webhooks',
    ]);
  });
});

describe('R08.03 — the dry run', () => {
  const v = verifyBackupText(fileText(), U);
  if (!v.ok) throw new Error('fixture');
  const empty = {};

  it('into an empty account: parents and children added, orphans and blocked reported', () => {
    const p = planRestore({ userId: U, file: v.collections, existing: empty });
    const by = (n: string) => p.collections.find((c) => c.name === n)!;
    expect(by('projects').insert.map((r) => r.id)).toEqual(['p1']);
    expect(by('tasks').insert.map((r) => r.id)).toEqual(['t1']);
    expect(by('tasks').orphans).toEqual(['t2']);
    expect(by('habits').insert[0]).not.toHaveProperty('xp');
    expect(by('habits').stripped).toEqual(['xp']);
    expect(by('habit_logs').blocked).toMatch(/XP/);
    expect(by('webhooks').blocked).toBeTruthy();
    expect(p.inserts).toBe(4);
    expect(planSummary(p).join('\n')).toMatch(/habit_logs: 1 kayıt geri yüklenmeyecek/);
  });

  it('the same file again adds nothing (one effect); a changed row is a conflict, the account wins', () => {
    const existing = {
      projects: new Map([['p1', data.projects[0]]]),
      tasks: new Map([['t1', { ...data.tasks[0], updated_at: '2026-10-05T00:00:00Z' }]]),
      habits: new Map([['h1', { id: 'h1', user_id: U, name: 'Su (değişti)', status: 'active' }]]),
      journal_entries: new Map([['j-other', { id: 'j-other', user_id: U, date: '2026-10-01', content: 'kendi', mood: 4 }]]),
    };
    const p = planRestore({ userId: U, file: v.collections, existing });
    const by = (n: string) => p.collections.find((c) => c.name === n)!;
    expect(by('projects')).toMatchObject({ present: 1, insert: [] });
    expect(by('tasks').present).toBe(1);                    // updated_at is not "content"
    expect(by('habits').conflicts).toEqual(['h1']);
    expect(by('journal_entries').conflicts).toEqual(['j1']); // same date, different id: the account's row stays
  });

  it('rows of another owner are never inserted', () => {
    const foreign = { ...v.collections, notes: [{ id: 'n1', user_id: 'user-b', body: 'x' }] };
    const p = planRestore({ userId: U, file: foreign, existing: empty });
    expect(p.collections.find((c) => c.name === 'notes')).toMatchObject({ foreign: 1, insert: [] });
  });

  it('planNotices places habit_logs first with count and reason, includes webhooks, and excludes device', () => {
    const withDevice = { ...v.collections, device: [{ key: 'theme', value: 'dark' }] };
    const p = planRestore({ userId: U, file: withDevice, existing: empty });
    const notices = planNotices(p);
    expect(notices[0]).toMatch(/^habit_logs: 1 kayıt \(tarihçen\) dosyada duruyor ama bu uygulamada geri yüklenemez\./);
    expect(notices[0]).toMatch(/XP/);
    expect(notices.some((n) => n.startsWith('webhooks: 1 kayıt geri yüklenmez.'))).toBe(true);
    expect(notices.some((n) => n.startsWith('device:'))).toBe(false);
  });
});
