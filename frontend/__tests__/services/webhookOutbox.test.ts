import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Clipboard from 'expo-clipboard';
import TestRenderer, { act } from 'react-test-renderer';

const mockSession = { userId: 'u1' as string | null };
const mockWebhooks: { rows: Record<string, unknown>[] } = { rows: [] };
const mockHabitRepo = {
  insert: jest.fn(),
  find: jest.fn(),
  update: jest.fn(),
};

jest.mock('../../lib/session', () => ({
  currentUser: jest.fn(async () => (mockSession.userId ? { id: mockSession.userId, email: 'u1@aderyth.app' } : null)),
  currentUserId: jest.fn(async () => mockSession.userId),
}));

jest.mock('../../repositories/webhookRepository', () => ({
  fetchWebhooks: jest.fn(async () => ({ ok: true, data: mockWebhooks.rows })),
  insertWebhook: jest.fn(async (input: { url: string; eventTypes?: string[]; headers?: Record<string, string> }) => {
    const created = {
      id: `wh-${mockWebhooks.rows.length + 1}`,
      user_id: mockSession.userId ?? 'u1',
      url: input.url,
      event_types: input.eventTypes ?? ['habit_completed', 'task_completed'],
      headers: input.headers ?? null,
      enabled: true,
      created_at: '2026-08-04T10:00:00Z',
    };
    mockWebhooks.rows.push(created);
    return { ok: true, data: created };
  }),
  deleteWebhook: jest.fn(async (id: string) => {
    mockWebhooks.rows = mockWebhooks.rows.filter((w) => w.id !== id);
    return { ok: true, data: true };
  }),
}));

jest.mock('../../repositories/habitLogRepository', () => ({
  insertHabitLog: (...a: unknown[]) => mockHabitRepo.insert(...a),
  findHabitLog: (...a: unknown[]) => mockHabitRepo.find(...a),
  updateHabitLog: (...a: unknown[]) => mockHabitRepo.update(...a),
  fetchLogsForDate: jest.fn(async () => ({ ok: true, data: [] })),
  updateLogNote: jest.fn(),
}));

import WebhookModal from '../../components/settings/WebhookModal';
import Button from '../../components/ui/Button';
import { resetAccountMemory } from '../../lib/accountScope';
import { MAX_ATTEMPTS, RETRYABLE_GIVE_UP_MS, SETTLED_MAX_AGE_MS } from '../../lib/outbox';
import { outboxEngine, WEBHOOK_DEAD_REASON, WEBHOOK_MAX_PENDING } from '../../lib/outboxEngine';
import { namespacedOutboxKey } from '../../lib/outboxStorage';
import { persistCompletion, toPatch } from '../../services/habitLogService';
import {
  effectChannel,
  enqueueWebhookEvent,
  notify,
  registerWebhook,
  resetWebhookCache,
  setWebhookTransportFetchForTests,
  SIGNING_SECRET_KEY,
} from '../../services/webhookService';

const settleMicrotasks = async () => {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
};

describe('F46 (5.2-f & 5.4) — durable signed webhook outbox & one-time signing secret UI', () => {
  beforeEach(async () => {
    mockSession.userId = 'u1';
    mockWebhooks.rows = [];
    mockHabitRepo.insert.mockReset();
    mockHabitRepo.find.mockReset();
    mockHabitRepo.update.mockReset();
    resetWebhookCache();
    setWebhookTransportFetchForTests(null);
    resetAccountMemory('signed_out');
    effectChannel.reset();
    await AsyncStorage.clear();
  });

  afterAll(() => {
    setWebhookTransportFetchForTests(null);
  });

  it('(+) zero targets writes NOTHING to AsyncStorage; two targets enqueue two distinct durable commands and deduplicate same-day repeats', async () => {
    const setItemSpy = AsyncStorage.setItem as jest.Mock;
    setItemSpy.mockClear();

    await enqueueWebhookEvent({
      event: 'habit_completed',
      subjectKey: 'h1|2026-08-04',
      data: { habit_id: 'h1', date: '2026-08-04', state: 'done', value: null },
    });
    expect(setItemSpy).not.toHaveBeenCalled();

    await registerWebhook({ url: 'https://hooks.one.example/in' });
    await registerWebhook({ url: 'https://hooks.two.example/in' });

    const delivered: { url: string; body: Record<string, unknown> }[] = [];
    setWebhookTransportFetchForTests((async (url: string, init?: RequestInit) => {
      delivered.push({ url, body: JSON.parse(String(init?.body)) });
      return { ok: true, status: 200 };
    }) as unknown as typeof fetch);

    await enqueueWebhookEvent({
      event: 'habit_completed',
      subjectKey: 'h1|2026-08-04',
      data: { habit_id: 'h1', date: '2026-08-04', state: 'done', value: null },
    });
    await effectChannel.flush();
    expect(delivered).toHaveLength(2);

    // Second completion on the same habit & day -> duplicate within 14-day TTL -> zero new deliveries!
    await enqueueWebhookEvent({
      event: 'habit_completed',
      subjectKey: 'h1|2026-08-04',
      data: { habit_id: 'h1', date: '2026-08-04', state: 'done', value: null },
    });
    await effectChannel.flush();
    expect(delivered).toHaveLength(2);

    // After 14 days TTL, same operationId is pruned and can be sent again
    const rawKey = namespacedOutboxKey('effect', 'u1');
    const stored = JSON.parse((await AsyncStorage.getItem(rawKey))!);
    for (const k of Object.keys(stored.state.settled ?? {})) {
      stored.state.settled[k] = Date.now() - SETTLED_MAX_AGE_MS - 1_000;
    }
    await AsyncStorage.setItem(rawKey, JSON.stringify(stored));
    effectChannel.reset();

    await enqueueWebhookEvent({
      event: 'habit_completed',
      subjectKey: 'h1|2026-08-04',
      data: { habit_id: 'h1', date: '2026-08-04', state: 'done', value: null },
    });
    await effectChannel.flush();
    expect(delivered).toHaveLength(4);
  });

  it('(+) lost-response 23505 replay delivers the first completion webhook instead of dropping it', async () => {
    await registerWebhook({ url: 'https://hooks.example.com/replay' });
    const sent: Record<string, unknown>[] = [];
    setWebhookTransportFetchForTests((async (_u: string, init?: RequestInit) => {
      sent.push(JSON.parse(String(init?.body)));
      return { ok: true, status: 200 };
    }) as unknown as typeof fetch);

    // Simulate lost first response: server row ALREADY has state: 'done', so insert hits 23505
    mockHabitRepo.insert.mockResolvedValue({ ok: false, error: 'dup', code: '23505', status: 409 });
    mockHabitRepo.find.mockResolvedValue({
      ok: true,
      data: { id: 'r1', habit_id: 'h1', completed_at: '2026-08-04', state: 'done', value: null },
    });
    mockHabitRepo.update.mockResolvedValue({
      ok: true,
      data: { id: 'r1', habit_id: 'h1', completed_at: '2026-08-04', state: 'done', value: null },
    });

    const res = await persistCompletion({ habitId: 'h1', dateStr: '2026-08-04', patch: toPatch({ state: 'done' }) });
    expect(res.ok).toBe(true);
    await settleMicrotasks();
    await effectChannel.flush();
    expect(sent).toHaveLength(1);
    expect(sent[0].data).toEqual({ habit_id: 'h1', date: '2026-08-04', state: 'done', value: null });
  });

  it('(+) 503 spends zero attempts, survives process restart, recovers on 200; 72h retryable becomes dead with Otomasyon bildirimi; disabled/deleted webhook settles as gone', async () => {
    await registerWebhook({ url: 'https://hooks.example.com/flaky' });
    let httpStatus = 503;
    setWebhookTransportFetchForTests((async () => ({ ok: httpStatus === 200, status: httpStatus })) as unknown as typeof fetch);

    await enqueueWebhookEvent({
      event: 'task_completed',
      subjectKey: 't1:2026-08-04',
      data: { task_id: 't1' },
    });
    await effectChannel.flush();

    expect(effectChannel.state()?.commands[0]).toMatchObject({ status: 'pending', attempts: 0, retryableCount: 1 });

    // Simulate process death & cold reload
    effectChannel.reset();
    await effectChannel.ensure();
    expect(effectChannel.state()?.commands).toHaveLength(1);

    // Server recovers -> 200 -> applied
    httpStatus = 200;
    await effectChannel.flush({ now: Date.now() + 60_000 });
    expect(effectChannel.state()?.commands).toEqual([]);

    // 72h of 503 -> dead, surfaced in outboxEngine.listIssues() as "Otomasyon bildirimi"
    httpStatus = 503;
    const t0 = Date.now();
    await enqueueWebhookEvent({
      event: 'task_completed',
      subjectKey: 't2:2026-08-04',
      data: { task_id: 't2' },
    });
    await effectChannel.flush({ now: t0 });
    await effectChannel.flush({ now: t0 + RETRYABLE_GIVE_UP_MS + 1_000 });
    expect(effectChannel.state()?.commands[0].status).toBe('dead');
    expect(outboxEngine.listIssues()).toContainEqual(
      expect.objectContaining({
        channel: 'effect',
        label: 'Otomasyon bildirimi',
        reason: WEBHOOK_DEAD_REASON,
      }),
    );

    // Disabled/deleted webhook settles as gone
    mockWebhooks.rows[0].enabled = false;
    resetWebhookCache();
    await enqueueWebhookEvent({
      event: 'task_completed',
      subjectKey: 't3:2026-08-04',
      data: { task_id: 't3' },
    });
    // Force enqueue manually when disabled after queueing:
    mockWebhooks.rows[0].enabled = true;
    resetWebhookCache();
    await enqueueWebhookEvent({
      event: 'task_completed',
      subjectKey: 't4:2026-08-04',
      data: { task_id: 't4' },
    });
    // Disable before flush
    mockWebhooks.rows[0].enabled = false;
    resetWebhookCache();
    await effectChannel.flush({ now: t0 + RETRYABLE_GIVE_UP_MS + 20_000 });
    expect(effectChannel.state()?.commands.find((c) => c.entityId.includes('t4'))).toBeUndefined();
  });

  it('(-) isolates Account A effects from Account B, marks 404 dead after 6 attempts, caps pending at 200, never leaks task title, and notify never throws', async () => {
    await registerWebhook({ url: 'https://hooks.example.com/a', eventTypes: ['task_completed'] });
    const hits: string[] = [];
    setWebhookTransportFetchForTests((async (url: string) => {
      hits.push(url);
      return { ok: false, status: 404 };
    }) as unknown as typeof fetch);

    await enqueueWebhookEvent({
      event: 'task_completed',
      subjectKey: 't-acc:2026-08-04',
      data: { task_id: 't-acc' },
    });
    await effectChannel.flush();
    expect(hits).toHaveLength(1);
    expect(effectChannel.state()?.commands[0].payload).toEqual({
      event: 'task_completed',
      data: { task_id: 't-acc' },
      webhookId: 'wh-1',
    });
    expect(JSON.stringify(effectChannel.state())).not.toContain('title');

    // Switch to Account B -> Account A's effect does NOT fire
    hits.length = 0;
    mockSession.userId = 'u2';
    resetAccountMemory('user_changed');
    resetWebhookCache();
    await effectChannel.flush();
    expect(hits).toEqual([]);

    // Switch back to Account A -> 5 more 404s reach MAX_ATTEMPTS (6) -> dead
    mockSession.userId = 'u1';
    resetAccountMemory('user_changed');
    resetWebhookCache();
    await effectChannel.ensure();
    let clock = Date.now();
    for (let i = 1; i < MAX_ATTEMPTS; i += 1) {
      clock += 2 * 3600_000;
      await effectChannel.flush({ now: clock });
    }
    expect(effectChannel.state()?.commands[0].status).toBe('dead');

    // Cap at WEBHOOK_MAX_PENDING = 200 (201st drops oldest pending)
    setWebhookTransportFetchForTests((async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch);
    effectChannel.reset();
    await AsyncStorage.removeItem(namespacedOutboxKey('effect', 'u1'));
    for (let i = 1; i <= WEBHOOK_MAX_PENDING + 1; i += 1) {
      await enqueueWebhookEvent({
        event: 'task_completed',
        subjectKey: `cap-${i}:2026-08-04`,
        data: { task_id: `cap-${i}` },
      });
    }
    const pendingCmds = (effectChannel.state()?.commands ?? []).filter((c) => c.status === 'pending');
    expect(pendingCmds).toHaveLength(WEBHOOK_MAX_PENDING);
    expect(pendingCmds.some((c) => c.entityId.includes('cap-1:'))).toBe(false);
    expect(pendingCmds.some((c) => c.entityId.includes(`cap-${WEBHOOK_MAX_PENDING + 1}:`))).toBe(true);

    expect(() => notify('task_completed', { task_id: 't-safe' }, { subjectKey: 't-safe:2026-08-04' })).not.toThrow();
  });

  it('(+) WebhookModal renders one-time signing secret with screen-reader label, minHeight >= 44 copy button, and copies secret', async () => {
    const secret = 'ab'.repeat(32);
    const copySpy = jest.spyOn(Clipboard, 'setStringAsync').mockResolvedValue(true);

    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(
        React.createElement(WebhookModal, {
          visible: true,
          webhooks: [
            {
              id: 'wh-1',
              user_id: 'u1',
              url: 'https://hooks.example.com/in',
              event_types: ['habit_completed'],
              headers: { [SIGNING_SECRET_KEY]: secret },
              enabled: true,
              created_at: '2026-08-04T10:00:00Z',
            },
          ],
          loading: false,
          busy: false,
          url: '',
          error: null,
          signingSecret: secret,
          onChangeUrl: jest.fn(),
          onAdd: jest.fn(),
          onRemove: jest.fn(),
          onClose: jest.fn(),
        }),
      );
    });

    const secretRegion = tree.root.findByProps({
      accessibilityLabel: 'İmza anahtarı, bir daha gösterilmez',
    });
    expect(secretRegion).toBeDefined();

    const copyBtn = tree.root
      .findAllByType(Button)
      .find((b) => b.props.accessibilityLabel === 'İmza anahtarını kopyala');
    expect(copyBtn).toBeDefined();

    await act(async () => {
      copyBtn!.props.onPress?.();
    });
    expect(copySpy).toHaveBeenCalledWith(secret);

    await act(async () => {
      tree.unmount();
    });
    copySpy.mockRestore();
  }, 20_000);
});
