/**
 * T1 — render tests for the interaction surfaces this core round added. Each
 * pins a promise the screen makes to the user, by rendering it and pressing
 * it, not by reading its source.
 */
import React from 'react';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn() }),
  useLocalSearchParams: () => ({}),
}));
jest.mock('../../lib/supabase', () => ({ supabase: {} }));
jest.mock('../../lib/session', () => ({
  currentUser: jest.fn(async () => ({ id: 'u1', email: null })),
}));

import JournalBody from '../../components/JournalBody';
import OutboxIssues from '../../components/OutboxIssues';
import ReminderEditor from '../../components/ReminderEditor';
import SmallStartSheet from '../../components/SmallStartSheet';
import TimeOffSheet from '../../components/TimeOffSheet';
import type { Habit } from '../../lib/supabase';
import { useTaskStore } from '../../store/taskStore';
import {
  fireEvent,
  renderWithProviders,
  screen,
  type RenderedScreen,
} from '../helpers/renderWithProviders';

function unwrapJson(json: ReturnType<RenderedScreen['toJSON']>) {
  if (json && !Array.isArray(json) && json.type === 'RNCSafeAreaProvider') {
    if (!json.children || json.children.length === 0) return null;
    return json.children.length === 1 ? json.children[0] : json.children;
  }
  return json;
}

function textOf(r: RenderedScreen): string {
  const out: string[] = [];
  const walk = (n: any) => {
    if (n == null) return;
    if (typeof n === 'string') {
      out.push(n);
      return;
    }
    if (Array.isArray(n)) {
      n.forEach(walk);
      return;
    }
    walk(n.children);
  };
  walk(r.toJSON());
  return out.join(' ');
}

function isDisabled(el: { props: Record<string, any> }): boolean {
  return Boolean(el.props.accessibilityState?.disabled ?? el.props.disabled);
}

describe('SmallStartSheet', () => {
  const parent = { kind: 'task' as const, id: 't1', title: 'Tez giriş bölümü' };

  it('says what the step does not do; start is disabled until a step is written', async () => {
    const onStart = jest.fn(() => true);
    const r = renderWithProviders(
      <SmallStartSheet parent={parent} onClose={() => {}} onStart={onStart} />,
    );
    expect(textOf(r)).toMatch(/asıl işi tamamlamaz ya da küçültmez/);
    const start = screen.getByLabelText('10 dakika başlat');
    expect(isDisabled(start)).toBe(true);
    fireEvent.changeText(screen.getByLabelText('İlk adım'), 'ilk paragrafı yaz');
    await r.user.press(screen.getByLabelText('5 dakika'));
    await r.user.press(screen.getByLabelText('5 dakika başlat'));
    expect(onStart).toHaveBeenCalledWith(parent, { title: 'ilk paragrafı yaz', minutes: 5 });
  });

  it('a refused start (a session is already open) is said, not swallowed', async () => {
    const r = renderWithProviders(
      <SmallStartSheet parent={parent} onClose={() => {}} onStart={() => false} />,
    );
    fireEvent.changeText(screen.getByLabelText('İlk adım'), 'x');
    await r.user.press(screen.getByLabelText('10 dakika başlat'));
    expect(textOf(r)).toMatch(/Devam eden bir odak oturumu var/);
  });
});

describe('TimeOffSheet', () => {
  it('cannot save while the server update is pending, and says so', () => {
    const onConfirm = jest.fn();
    const r = renderWithProviders(
      <TimeOffSheet
        visible
        kind="pause"
        habitName="Spor"
        today="2026-10-07"
        available={false}
        onClose={() => {}}
        onConfirm={onConfirm}
      />,
    );
    expect(textOf(r)).toMatch(/sunucu güncellemesini bekliyor/);
    expect(isDisabled(screen.getByLabelText('Ara ver kaydet'))).toBe(true);
  });

  it('shows what changes and the one-day alternative; confirms the chosen dates', async () => {
    const onConfirm = jest.fn(async () => ({ ok: true as const }));
    const r = renderWithProviders(
      <TimeOffSheet
        visible
        kind="holiday"
        today="2026-10-07"
        available
        onClose={() => {}}
        onConfirm={onConfirm}
      />,
    );
    const t = textOf(r);
    expect(t).toMatch(/Bütün seriler tatilin üzerinden köprü kurar/);
    expect(t).toMatch(/YALNIZ BİR GÜN İÇİNSE/);
    await r.user.press(screen.getByLabelText('Tatil modu kaydet'));
    expect(onConfirm).toHaveBeenCalledWith({
      kind: 'holiday',
      start_date: '2026-10-07',
      end_date: '2026-10-13',
    });
  });

  it('a refused save shows the reason and stays open', async () => {
    const r = renderWithProviders(
      <TimeOffSheet
        visible
        kind="pause"
        today="2026-10-07"
        available
        onClose={() => {}}
        onConfirm={async () => ({
          ok: false as const,
          error: 'Bu tarihlerde zaten bir duraklatma var.',
        })}
      />,
    );
    await r.user.press(screen.getByLabelText('Ara ver kaydet'));
    expect(textOf(r)).toMatch(/zaten bir duraklatma var/);
  });
});

describe('OutboxIssues', () => {
  it('renders nothing when everything is delivered', () => {
    useTaskStore.setState({ outbox: null, tasks: [] });
    const r = renderWithProviders(<OutboxIssues />);
    expect(unwrapJson(r.toJSON())).toBeNull();
  });

  it('a conflict offers "apply mine" and "give up", wired to the store', async () => {
    const retryChange = jest.fn(async () => undefined);
    const discardChange = jest.fn(async () => undefined);
    useTaskStore.setState({
      tasks: [{ id: 't1', title: 'Rapor', completed: false, status: 'pending' } as any],
      outbox: {
        userId: 'u1',
        nextSeq: 2,
        tombstones: {},
        authBlocked: false,
        commands: [
          {
            operationId: 'op1',
            userId: 'u1',
            entity: 'task',
            entityId: 't1',
            kind: 'update',
            payload: { completed: true },
            baseVersion: 'v1',
            dependsOn: [],
            seq: 1,
            attempts: 0,
            status: 'conflict',
            readyAt: 0,
            createdAt: 0,
            lastError: 'moved',
          },
        ],
      },
      retryChange,
      discardChange,
    } as any);
    const r = renderWithProviders(<OutboxIssues />);
    expect(textOf(r)).toMatch(/Rapor\s+—\s+değişti/);
    expect(textOf(r)).toMatch(/Başka bir yerde değiştirilmiş/);
    await r.user.press(screen.getByLabelText('Rapor: benim değişikliğimi uygula'));
    await r.user.press(screen.getByLabelText('Rapor: bu değişikliği bırak'));
    expect(retryChange).toHaveBeenCalledWith('op1');
    expect(discardChange).toHaveBeenCalledWith('op1');
  });
});

describe('ReminderEditor', () => {
  const habit = { id: 'h1', name: 'Su', reminders: { enabled: true, time: '08:00' } } as Habit;

  it('says when notifications are not allowed instead of pretending', () => {
    const r = renderWithProviders(
      <ReminderEditor habit={habit} permission={false} onClose={() => {}} onSave={async () => {}} />,
    );
    expect(textOf(r)).toMatch(/bildirim izni kapalı; hatırlatıcılar gönderilemez/);
  });

  it('refuses a duplicate time; saves a valid edit with times and days', async () => {
    const onSave = jest.fn(async () => {});
    const r = renderWithProviders(
      <ReminderEditor habit={habit} permission onClose={() => {}} onSave={onSave} />,
    );
    await r.user.press(screen.getByLabelText('Saat ekle'));
    const second = screen.getByLabelText('Hatırlatıcı saati 2');
    fireEvent.changeText(second, '08:00');
    await r.user.press(screen.getByLabelText('Hatırlatıcıyı kaydet'));
    expect(onSave).not.toHaveBeenCalled();
    expect(textOf(r)).toMatch(/Aynı saat iki kez olamaz/);
    fireEvent.changeText(second, '20:00');
    await r.user.press(screen.getByLabelText('Pzt'));
    await r.user.press(screen.getByLabelText('Hatırlatıcıyı kaydet'));
    expect(onSave).toHaveBeenCalledWith({
      enabled: true,
      time: '08:00',
      times: ['08:00', '20:00'],
      days: [0],
    });
  });
});

describe('JournalBody', () => {
  it('renders formatting, tags and habit links', async () => {
    const onOpenHabit = jest.fn();
    const r = renderWithProviders(
      <JournalBody
        content={'# Gün\n- **iyi** bir gün #su-iç'}
        habits={[{ id: 'h1', name: 'Su iç' }]}
        onOpenHabit={onOpenHabit}
      />,
    );
    const t = textOf(r);
    expect(t).toMatch(/Gün/);
    expect(t).toMatch(/iyi/);
    expect(t).toMatch(/#su-iç/);
    await r.user.press(screen.getByLabelText('Su iç alışkanlığını aç'));
    expect(onOpenHabit).toHaveBeenCalledWith('h1');
  });
});
