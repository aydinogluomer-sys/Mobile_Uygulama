/**
 * R07.07 — charts carry their text, and a shared focus report leaves task
 * titles out unless the user ticks the box.
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Share } from 'react-native';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: ({ children }: any) => children }));
jest.mock('../../lib/supabase', () => ({ supabase: {} }));
jest.mock('../../lib/session', () => ({ currentUser: jest.fn(async () => ({ id: 'u1' })) }));
const mockRows = [{ id: 's1', user_id: 'u1', task_id: 't', task_title: 'Gizli proje', mode: 'work', started_at: new Date().toISOString(), ended_at: new Date().toISOString(), planned_seconds: 1500, completed_seconds: 1500, completed: true }];
jest.mock('../../services/focusService', () => ({ sessionsSince: jest.fn(async () => ({ ok: true, data: mockRows })) }));

import AreaRadar from '../../components/AreaRadar';
import FocusReportModal from '../../components/focus/FocusReportModal';
import { TrendChart } from '../../app/tabs/stats';

it('the life-area radar has a text alternative', async () => {
  let r!: TestRenderer.ReactTestRenderer;
  await act(async () => { r = TestRenderer.create(<AreaRadar values={{ saglik: 8 } as never} />); });
  const img = r.root.findAll((n) => typeof n.type === 'string' && n.props?.accessibilityRole === 'image')[0];
  expect(img.props.accessibilityLabel).toMatch(/^Yaşam alanları \(10 üzerinden\): Sağlık 8/);
});

it('the focus report chart speaks, and sharing leaves titles out unless chosen', async () => {
  const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' } as never);
  let r!: TestRenderer.ReactTestRenderer;
  await act(async () => { r = TestRenderer.create(<FocusReportModal visible onClose={() => {}} accent="#D97757" />); });
  await act(async () => { await new Promise((x) => setTimeout(x, 0)); });
  const chart = r.root.findAll((n) => typeof n.type === 'string' && n.props?.accessibilityRole === 'image')[0];
  expect(chart.props.accessibilityLabel).toMatch(/^Odak süresi: en yüksek .* \(25 dk\)/);
  const press = async (label: string) => {
    const n = r.root.findAll((x) => typeof x.props?.onPress === 'function' && (x.props?.accessibilityLabel === label || (x.findAll?.((c: any) => c.props?.children === label).length ?? 0) > 0))[0];
    await act(async () => { await n.props.onPress(); });
    // iOS (the jest platform) closes the modal first and shares 350 ms later
    await act(async () => { await new Promise((x) => setTimeout(x, 400)); });
  };
  await press('JSON');
  expect(String(share.mock.calls[0][0].message)).not.toMatch(/Gizli proje/);
  await press('Paylaşılan rapora görev adlarını ekle');
  await press('JSON');
  expect(String(share.mock.calls[1][0].message)).toMatch(/Gizli proje/);
  share.mockRestore();
});

it('the 14-day trend chart on Stats has a text alternative', async () => {
  let r!: TestRenderer.ReactTestRenderer;
  await act(async () => { r = TestRenderer.create(<TrendChart data={[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 3]} />); });
  const img = r.root.findAll((n) => typeof n.type === 'string' && n.props?.accessibilityRole === 'image')[0];
  expect(img.props.accessibilityLabel).toMatch(/^Son 14 gün tamamlanan: en yüksek \d\d\/\d\d \(3\), en düşük \d\d\/\d\d \(0\), toplam 5, ortalama 0,4\.$/);
});
