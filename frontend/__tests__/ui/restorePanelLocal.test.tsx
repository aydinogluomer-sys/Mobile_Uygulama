/**
 * R08.02 — the panel shows the real local-backup status, takes a copy on
 * request, and checks the newest complete copy through the same dry run.
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

jest.mock('../../lib/supabase', () => ({ supabase: {} }));
jest.mock('../../lib/session', () => ({ currentUser: jest.fn(async () => ({ id: 'u1' })) }));
const mockRun = jest.fn(async () => ({ ok: true, complete: true, status: { lastSuccessAt: new Date().toISOString(), lastAttemptAt: null, lastError: null, slots: [{ key: 'k', created_at: 'x', complete: true, bytes: 1 }] } }));
const mockDry = jest.fn(async () => ({ ok: true, plan: { collections: [], inserts: 0, blockedRows: 0 }, summary: ['Hepsi zaten hesabında.'] }));
jest.mock('../../services/localBackupService', () => ({
  loadLocalBackupStatus: jest.fn(async () => ({ lastSuccessAt: null, lastAttemptAt: null, lastError: null, slots: [] })),
  runLocalBackup: (...a: unknown[]) => (mockRun as any)(...a),
  latestCompleteLocalBackup: jest.fn(async () => ({ text: '{"manifest":{}}', created_at: '2026-10-08T09:00:00Z' })),
}));
jest.mock('../../services/restoreService', () => ({ dryRunRestore: (...a: unknown[]) => (mockDry as any)(...a), executeRestore: jest.fn(), loadRestoreJob: jest.fn(async () => null) }));

import RestorePanel from '../../components/RestorePanel';

function textOf(r: TestRenderer.ReactTestRenderer): string {
  const out: string[] = [];
  const walk = (n: any) => { if (n == null) return; if (typeof n === 'string') { out.push(n); return; } if (Array.isArray(n)) { n.forEach(walk); return; } walk(n.children); };
  walk(r.toJSON());
  return out.join(' ');
}
const press = async (r: TestRenderer.ReactTestRenderer, label: string) => {
  const n = r.root.findAll((x) => x.props?.accessibilityLabel === label && typeof x.props.onPress === 'function')[0];
  await act(async () => { await n.props.onPress(); });
};

it('says there is no copy yet, takes one on request, then says it is there', async () => {
  let r!: TestRenderer.ReactTestRenderer;
  await act(async () => { r = TestRenderer.create(<RestorePanel />); });
  await act(async () => { await new Promise((x) => setTimeout(x, 0)); });
  expect(textOf(r)).toMatch(/Henüz tam bir yerel yedek yok\./);
  expect(textOf(r)).toMatch(/Uygulama açılmazsa yedek alınmaz/);
  await press(r, 'Şimdi yerel yedek al');
  expect(mockRun).toHaveBeenCalled();
  expect(textOf(r)).toMatch(/Son tam yerel yedek: az önce \(cihazda 1 tam kopya\)/);
});

it('checks the newest complete local copy with the dry run (nothing written)', async () => {
  let r!: TestRenderer.ReactTestRenderer;
  await act(async () => { r = TestRenderer.create(<RestorePanel />); });
  await press(r, 'Son yerel yedeği doğrula');
  expect(mockDry).toHaveBeenCalledWith('{"manifest":{}}');
  expect(textOf(r)).toMatch(/Hepsi zaten hesabında/);
});
