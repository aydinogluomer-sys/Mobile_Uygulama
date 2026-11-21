/**
 * R08.04 — the panel says a restore was cut short and offers to continue it
 * ("Sürdür") when the same file is checked again.
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

jest.mock('../../lib/supabase', () => ({ supabase: {} }));
jest.mock('../../lib/session', () => ({ currentUser: jest.fn(async () => ({ id: 'u1' })) }));
jest.mock('../../services/localBackupService', () => ({
  loadLocalBackupStatus: jest.fn(async () => ({ lastSuccessAt: null, lastAttemptAt: null, lastError: null, slots: [] })),
  runLocalBackup: jest.fn(), latestCompleteLocalBackup: jest.fn(async () => null),
}));
jest.mock('../../services/restoreService', () => ({
  loadRestoreJob: jest.fn(async () => ({ id: 'restore-x', fileCreatedAt: '2026-10-01T10:00:00Z', startedAt: '', updatedAt: '', status: 'running', inserted: { notes: 50 }, planned: 120 })),
  dryRunRestore: jest.fn(async () => ({ ok: true, plan: { userId: 'u1', collections: [], inserts: 70, blockedRows: 0 }, summary: ['notes: 70 eklenecek'], notices: [], job: { id: 'restore-x', fileCreatedAt: '2026-10-01T10:00:00Z', resumes: true } })),
  executeRestore: jest.fn(),
}));

import RestorePanel from '../../components/RestorePanel';

function textOf(r: TestRenderer.ReactTestRenderer): string {
  const out: string[] = [];
  const walk = (n: any) => { if (n == null) return; if (typeof n === 'string') { out.push(n); return; } if (Array.isArray(n)) { n.forEach(walk); return; } walk(n.children); };
  walk(r.toJSON());
  return out.join(' ');
}

it('names the interrupted restore and offers "Sürdür" for the same file', async () => {
  let r!: TestRenderer.ReactTestRenderer;
  await act(async () => { r = TestRenderer.create(<RestorePanel />); });
  await act(async () => { await new Promise((x) => setTimeout(x, 0)); });
  expect(textOf(r)).toMatch(/Yarım kalan bir geri yükleme var: 2026-10-01 tarihli dosya, 50 kayıt eklendikten sonra yarıda kaldı/);
  const input = r.root.findAll((n) => n.props?.accessibilityLabel === 'Dışa aktarım metni' && n.props.onChangeText)[0];
  await act(async () => { input.props.onChangeText('{"manifest":{}}'); });
  const check = r.root.findAll((n) => n.props?.accessibilityLabel === 'Dışa aktarımı doğrula' && typeof n.props.onPress === 'function')[0];
  await act(async () => { await check.props.onPress(); });
  expect(r.root.findAll((n) => typeof n.type === 'string' && n.props?.accessibilityLabel === 'Yarım kalan geri yüklemeyi sürdür')).toHaveLength(1);
  expect(textOf(r)).toMatch(/Sürdür/);
});
