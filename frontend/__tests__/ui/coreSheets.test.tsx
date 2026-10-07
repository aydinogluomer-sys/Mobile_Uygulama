/**
 * T1 — render tests for the interaction surfaces this core round added. Each
 * pins a promise the screen makes to the user, by rendering it and pressing
 * it, not by reading its source.
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: ({ children }: any) => children }));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }), useLocalSearchParams: () => ({}) }));
jest.mock('../../lib/supabase', () => ({ supabase: {} }));
jest.mock('../../lib/session', () => ({ currentUser: jest.fn(async () => ({ id: 'u1', email: null })) }));

import SmallStartSheet from '../../components/SmallStartSheet';
import TimeOffSheet from '../../components/TimeOffSheet';
import OutboxIssues from '../../components/OutboxIssues';
import ReminderEditor from '../../components/ReminderEditor';
import JournalBody from '../../components/JournalBody';
import { useTaskStore } from '../../store/taskStore';
import type { Habit } from '../../lib/supabase';

/** All text in the tree, joined. */
function textOf(r: TestRenderer.ReactTestRenderer): string {
  const out: string[] = [];
  const walk = (n: any) => {
    if (n == null) return;
    if (typeof n === 'string') { out.push(n); return; }
    if (Array.isArray(n)) { n.forEach(walk); return; }
    walk(n.children);
  };
  walk(r.toJSON());
  return out.join(' ');
}
const byLabel = (r: TestRenderer.ReactTestRenderer, label: string) =>
  r.root.findAll((n) => n.props?.accessibilityLabel === label && typeof n.props.onPress === 'function')[0];

describe('SmallStartSheet', () => {
  const parent = { kind: 'task' as const, id: 't1', title: 'Tez giriş bölümü' };

  it('says what the step does not do; start is disabled until a step is written', async () => {
    const onStart = jest.fn(() => true);
    let r!: TestRenderer.ReactTestRenderer;
    await act(async () => { r = TestRenderer.create(<SmallStartSheet parent={parent} onClose={() => {}} onStart={onStart} />); });
    expect(textOf(r)).toMatch(/asıl işi tamamlamaz ya da küçültmez/);
    const start = byLabel(r, '10 dakika başlat');
    expect(start.props.disabled).toBe(true);
    const input = r.root.findAll((n) => n.props?.accessibilityLabel === 'İlk adım' && n.props.onChangeText)[0];
    await act(async () => { input.props.onChangeText('ilk paragrafı yaz'); });
    await act(async () => { byLabel(r, '5 dakika').props.onPress(); });
    await act(async () => { byLabel(r, '5 dakika başlat').props.onPress(); });
    expect(onStart).toHaveBeenCalledWith(parent, { title: 'ilk paragrafı yaz', minutes: 5 });
  });

  it('a refused start (a session is already open) is said, not swallowed', async () => {
    let r!: TestRenderer.ReactTestRenderer;
    await act(async () => { r = TestRenderer.create(<SmallStartSheet parent={parent} onClose={() => {}} onStart={() => false} />); });
    const input = r.root.findAll((n) => n.props?.accessibilityLabel === 'İlk adım' && n.props.onChangeText)[0];
    await act(async () => { input.props.onChangeText('x'); });
    await act(async () => { byLabel(r, '10 dakika başlat').props.onPress(); });
    expect(textOf(r)).toMatch(/Devam eden bir odak oturumu var/);
  });
});

describe('TimeOffSheet', () => {
  it('cannot save while the server update is pending, and says so', async () => {
    const onConfirm = jest.fn();
    let r!: TestRenderer.ReactTestRenderer;
    await act(async () => { r = TestRenderer.create(<TimeOffSheet visible kind="pause" habitName="Spor" today="2026-10-07" available={false} onClose={() => {}} onConfirm={onConfirm} />); });
    expect(textOf(r)).toMatch(/sunucu güncellemesini bekliyor/);
    expect(byLabel(r, 'Ara ver kaydet').props.disabled).toBe(true);
  });

  it('shows what changes and the one-day alternative; confirms the chosen dates', async () => {
    const onConfirm = jest.fn(async () => ({ ok: true as const }));
    let r!: TestRenderer.ReactTestRenderer;
    await act(async () => { r = TestRenderer.create(<TimeOffSheet visible kind="holiday" today="2026-10-07" available onClose={() => {}} onConfirm={onConfirm} />); });
    const t = textOf(r);
    expect(t).toMatch(/Bütün seriler tatilin üzerinden köprü kurar/);
    expect(t).toMatch(/YALNIZ BİR GÜN İÇİNSE/);
    await act(async () => { byLabel(r, 'Tatil modu kaydet').props.onPress(); });
    expect(onConfirm).toHaveBeenCalledWith({ kind: 'holiday', start_date: '2026-10-07', end_date: '2026-10-13' });
  });

  it('a refused save shows the reason and stays open', async () => {
    let r!: TestRenderer.ReactTestRenderer;
    await act(async () => { r = TestRenderer.create(<TimeOffSheet visible kind="pause" today="2026-10-07" available onClose={() => {}} onConfirm={async () => ({ ok: false as const, error: 'Bu tarihlerde zaten bir duraklatma var.' })} />); });
    await act(async () => { byLabel(r, 'Ara ver kaydet').props.onPress(); });
    expect(textOf(r)).toMatch(/zaten bir duraklatma var/);
  });
});

describe('OutboxIssues', () => {
  it('renders nothing when everything is delivered', async () => {
    useTaskStore.setState({ outbox: null, tasks: [] });
    let r!: TestRenderer.ReactTestRenderer;
    await act(async () => { r = TestRenderer.create(<OutboxIssues />); });
    expect(r.toJSON()).toBeNull();
  });

  it('a conflict offers "apply mine" and "give up", wired to the store', async () => {
    const retryChange = jest.fn(async () => undefined);
    const discardChange = jest.fn(async () => undefined);
    useTaskStore.setState({
      tasks: [{ id: 't1', title: 'Rapor', completed: false, status: 'pending' } as any],
      outbox: { userId: 'u1', nextSeq: 2, tombstones: {}, authBlocked: false, commands: [
        { operationId: 'op1', userId: 'u1', entity: 'task', entityId: 't1', kind: 'update', payload: { completed: true }, baseVersion: 'v1', dependsOn: [], seq: 1, attempts: 0, status: 'conflict', readyAt: 0, createdAt: 0, lastError: 'moved' },
      ] },
      retryChange, discardChange,
    } as any);
    let r!: TestRenderer.ReactTestRenderer;
    await act(async () => { r = TestRenderer.create(<OutboxIssues />); });
    expect(textOf(r)).toMatch(/Rapor\s+—\s+değişti/);
    expect(textOf(r)).toMatch(/Başka bir yerde değiştirilmiş/);
    await act(async () => { byLabel(r, 'Rapor: benim değişikliğimi uygula').props.onPress(); });
    await act(async () => { byLabel(r, 'Rapor: değişiklikten vazgeç').props.onPress(); });
    expect(retryChange).toHaveBeenCalledWith('op1');
    expect(discardChange).toHaveBeenCalledWith('op1');
  });
});

describe('ReminderEditor', () => {
  const habit = { id: 'h1', name: 'Su', reminders: { enabled: true, time: '08:00' } } as Habit;

  it('says when notifications are not allowed instead of pretending', async () => {
    let r!: TestRenderer.ReactTestRenderer;
    await act(async () => { r = TestRenderer.create(<ReminderEditor habit={habit} permission={false} onClose={() => {}} onSave={async () => {}} />); });
    expect(textOf(r)).toMatch(/bildirim izni kapalı; hatırlatıcılar gönderilemez/);
  });

  it('refuses a duplicate time; saves a valid edit with times and days', async () => {
    const onSave = jest.fn(async () => {});
    let r!: TestRenderer.ReactTestRenderer;
    await act(async () => { r = TestRenderer.create(<ReminderEditor habit={habit} permission onClose={() => {}} onSave={onSave} />); });
    await act(async () => { byLabel(r, 'Saat ekle').props.onPress(); });
    const second = r.root.findAll((n) => n.props?.accessibilityLabel === 'Hatırlatıcı saati 2' && n.props.onChangeText)[0];
    await act(async () => { second.props.onChangeText('08:00'); });
    await act(async () => { byLabel(r, 'Hatırlatıcıyı kaydet').props.onPress(); });
    expect(onSave).not.toHaveBeenCalled();
    expect(textOf(r)).toMatch(/Aynı saat iki kez olamaz/);
    await act(async () => { second.props.onChangeText('20:00'); });
    await act(async () => { byLabel(r, 'Pzt').props.onPress(); });
    await act(async () => { byLabel(r, 'Hatırlatıcıyı kaydet').props.onPress(); });
    expect(onSave).toHaveBeenCalledWith({ enabled: true, time: '08:00', times: ['08:00', '20:00'], days: [0] });
  });
});

describe('JournalBody', () => {
  it('renders formatting, tags and habit links', async () => {
    const onOpenHabit = jest.fn();
    let r!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      r = TestRenderer.create(<JournalBody content={'# Gün\n- **iyi** bir gün #su-iç'} habits={[{ id: 'h1', name: 'Su iç' }]} onOpenHabit={onOpenHabit} />);
    });
    const t = textOf(r);
    expect(t).toMatch(/Gün/);
    expect(t).toMatch(/iyi/);
    expect(t).toMatch(/#su-iç/);
    await act(async () => { byLabel(r, 'Su iç alışkanlığını aç').props.onPress(); });
    expect(onOpenHabit).toHaveBeenCalledWith('h1');
  });
});
