import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import {
  ANALYTICS_ENUMS,
  ANALYTICS_EVENTS,
  ANALYTICS_RETENTION_DAYS,
  buildEvent,
  emitEvent,
  emitProductEvent,
  isAnalyticsOptedIn,
  isPermittedString,
  setAnalyticsOptIn,
  setAnalyticsSink,
  type AnalyticsEvent,
  type AnalyticsEventName,
} from '../../lib/analytics';
import {
  buildCrashReport,
  reportError,
  scrubMessage,
  scrubStack,
  setCrashSink,
  type CrashReport,
} from '../../lib/crashReporting';
import { SENTRY_DSN_CONFIGURED, initCrashReporting } from '../../lib/sentryClient';
import { stripComments } from '../helpers/sourceText';

const FRONTEND_ROOT = join(__dirname, '..', '..');
const REPO_ROOT = join(FRONTEND_ROOT, '..');
const RUNBOOK_PATH = join(REPO_ROOT, 'docs', 'implementation-v3', 'OBSERVABILITY_RUNBOOK.md');
const SENTRY_CLIENT_PATH = join(FRONTEND_ROOT, 'lib', 'sentryClient.ts');

const REQUIRED_RUNBOOK_TOKENS = [
  'EXPO_PUBLIC_SENTRY_DSN',
  'EXPO_PUBLIC_SENTRY_ENVIRONMENT',
  'SENTRY_AUTH_TOKEN',
  'beforeBreadcrumb',
  'beforeSend',
  'tracesSampleRate: 0',
  'replaysSessionSampleRate: 0',
  '42501',
  '42703',
  'refund_credit',
  'oldestPendingAgeMs',
  '044',
  'ai_retention_purge',
  '24s',
  'ANALYTICS_RETENTION_DAYS = 90',
  'first_action_started',
  'day_replan_applied',
  'day_replan_undone',
  'focus_stopped_early',
  'light_day_confirmed',
  'BLOKE',
] as const;

export function verifyObservabilityRunbookTokens(markdown: string): string[] {
  const normalized = markdown.replace(/\r\n?/g, '\n');
  return REQUIRED_RUNBOOK_TOKENS.filter((token) => !normalized.includes(token));
}

afterEach(() => {
  setAnalyticsSink(null);
  setAnalyticsOptIn(false);
  setCrashSink(null);
});

describe('Y04 controlled incident drill — crashReporting and sentryClient zero-leak barrier', () => {
  it('(+) redacts 100% of quoted journal prose, PostgREST query values, emails, Bearer JWTs, OS paths, and non-enum context in a compound incident', () => {
    const jwtSecret = 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.secret';
    const rawIncidentMessage = [
      'PostgrestError PGRST116 on journal_entries?title=eq.GizliNot&mood=eq.CokKaygili',
      'for user test@example.com',
      `auth=${jwtSecret}`,
      'payload="Bugun terapistimle gizli_gunluk_notu konustum"',
    ].join(' ');

    const err = new Error(rawIncidentMessage);
    err.name = 'PostgrestError';
    err.stack = [
      `PostgrestError: ${rawIncidentMessage}`,
      '    at syncJournal (C:\\Users\\Trade Bilisim\\Mobile_Uygulama\\frontend\\services\\journalService.ts:88:13)',
      '    at flush (/Users/private_dev/aderyth/frontend/lib/outboxEngine.ts:142:7)',
    ].join('\n');

    const scrubbed = scrubMessage(rawIncidentMessage);
    expect(scrubbed.redacted).toBe(true);

    const seenReports: CrashReport[] = [];
    setCrashSink((r) => {
      seenReports.push(r);
    });
    reportError(err, 'manual', 'Serbest metin baslik sizan baglam');

    expect(seenReports).toHaveLength(1);
    const report = seenReports[0];
    expect(report.redacted).toBe(true);
    expect(report.name).toBe('PostgrestError');
    expect(report.context).toBeUndefined();

    const wirePayload = JSON.stringify(report);
    const forbiddenLeakTokens = [
      'terapistimle',
      'gizli_gunluk_notu',
      'GizliNot',
      'CokKaygili',
      'test@example.com',
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
      'secret',
      'Trade Bilisim',
      'private_dev',
      'sizan baglam',
    ];
    for (const token of forbiddenLeakTokens) {
      expect(wirePayload).not.toContain(token);
    }

    // Diagnostic spine survives so engineers can still triage the incident.
    expect(report.message).toContain('PGRST116');
    expect(report.message).toContain('title=[redacted]');
    expect(report.stack).toContain('journalService.ts:88:13');
    expect(report.stack).toContain('outboxEngine.ts:142:7');
    expect(scrubStack(err.stack)).not.toContain('Trade Bilisim');
  });

  it('(+) keeps valid enum-shaped context and enforces all 4 Sentry privacy layers while remaining inert without a DSN', () => {
    const validReport = buildCrashReport(new Error('Network request failed'), 'render', 'today_replan');
    expect(validReport.context).toBe('today_replan');
    expect(validReport.redacted).toBe(false);

    expect(SENTRY_DSN_CONFIGURED).toBe(false);
    expect(initCrashReporting()).toBe(false);

    const sentryCode = stripComments(readFileSync(SENTRY_CLIENT_PATH, 'utf8'));
    for (const requiredSnippet of [
      'process.env.EXPO_PUBLIC_SENTRY_DSN',
      'process.env.EXPO_PUBLIC_SENTRY_ENVIRONMENT',
      'sendDefaultPii: false',
      'tracesSampleRate: 0',
      'replaysSessionSampleRate: 0',
      'replaysOnErrorSampleRate: 0',
      'beforeBreadcrumb: () => null',
      'delete event.request;',
      'delete event.user;',
      'delete event.extra;',
      'delete event.server_name;',
      'event.breadcrumbs = [];',
    ]) {
      expect(sentryCode).toContain(requiredSnippet);
    }
  });
});

describe('E13 minimal opt-in product analytics, closed vocabularies, and 90-day retention', () => {
  const E13_EVENTS: readonly AnalyticsEventName[] = [
    'first_action_started',
    'day_replan_applied',
    'day_replan_undone',
    'focus_stopped_early',
    'light_day_confirmed',
  ];

  it('(+) declares 90-day retention, all 5 E13 events, and closed lowercase enum vocabularies', () => {
    expect(ANALYTICS_RETENTION_DAYS).toBe(90);
    expect(isAnalyticsOptedIn()).toBe(false);

    for (const eventName of E13_EVENTS) {
      expect(ANALYTICS_EVENTS).toContain(eventName);
    }

    expect(ANALYTICS_ENUMS.replan_outcome).toEqual([
      'committed',
      'pending',
      'partial',
      'conflict',
      'aborted',
    ]);
    expect(ANALYTICS_ENUMS.undo_outcome).toEqual([
      'undone',
      'pending',
      'partial',
      'conflict',
      'noop',
    ]);
    expect(ANALYTICS_ENUMS.stop_reason).toEqual([
      'early_exit',
      'switched_task',
      'completed',
      'paused',
    ]);
    expect(ANALYTICS_ENUMS.suggestion_kind).toEqual([
      'resume_focus',
      'resume_routine',
      'start_small',
      'recovery',
      'habit',
      'task',
    ]);
    expect(ANALYTICS_ENUMS.environment).toEqual([
      'development',
      'staging',
      'production',
      'test',
    ]);

    expect(isPermittedString('replan_outcome', 'committed')).toBe(true);
    expect(isPermittedString('replan_outcome', 'undone')).toBe(false);
    expect(isPermittedString('stop_reason', 'early_exit')).toBe(true);
    expect(isPermittedString('stop_reason', 'yoruldum')).toBe(false);
  });

  it('(+) accepts valid UUIDs, counts, dates, and closed enums across all E13 events while stripping task titles, journal notes, and emotions', () => {
    const opId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

    const firstAction = buildEvent('first_action_started', {
      action_id: opId,
      suggestion_kind: 'start_small',
      environment: 'production',
      elapsed_seconds: 18,
      local_day: '2026-11-24',
      task_title: 'Vergi beyannamesini hazirla',
      journal_note: 'Bugun odaklanmakta cok zorlandim',
      emotion: 'bunalmis ve kaygili',
    });
    expect(firstAction.props).toEqual({
      action_id: opId,
      suggestion_kind: 'start_small',
      environment: 'production',
      elapsed_seconds: 18,
      local_day: '2026-11-24',
    });
    expect(firstAction.dropped.sort()).toEqual(['emotion', 'journal_note', 'task_title']);

    const replanApplied = buildEvent('day_replan_applied', {
      operation_id: opId,
      replan_outcome: 'committed',
      moved_count: 3,
      protected_count: 1,
      task_title: 'Dis hekimi randevusu sonrasi rapor',
    });
    expect(replanApplied.props.replan_outcome).toBe('committed');
    expect(replanApplied.props.moved_count).toBe(3);
    expect(replanApplied.dropped).toEqual(['task_title']);

    const replanUndone = buildEvent('day_replan_undone', {
      operation_id: opId,
      undo_outcome: 'undone',
      restored_count: 3,
      note: 'Yanlislikla erteledim',
    });
    expect(replanUndone.props.undo_outcome).toBe('undone');
    expect(replanUndone.dropped).toEqual(['note']);

    const focusStopped = buildEvent('focus_stopped_early', {
      session_id: opId,
      stop_reason: 'early_exit',
      actual_seconds: 420,
      planned_seconds: 1500,
      emotion: 'dikkatim dagildi',
    });
    expect(focusStopped.props.stop_reason).toBe('early_exit');
    expect(focusStopped.props.actual_seconds).toBe(420);
    expect(focusStopped.dropped).toEqual(['emotion']);

    const lightDay = buildEvent('light_day_confirmed', {
      local_day: '2026-11-24',
      kept_count: 2,
      deferred_count: 4,
      journal_entry: 'Cok yorgun uyandim',
    });
    expect(lightDay.props.kept_count).toBe(2);
    expect(lightDay.dropped).toEqual(['journal_entry']);

    const combinedWire = JSON.stringify([
      firstAction.props,
      replanApplied.props,
      replanUndone.props,
      focusStopped.props,
      lightDay.props,
    ]);
    for (const leaked of [
      'Vergi beyannamesini',
      'zorlandim',
      'bunalmis',
      'Dis hekimi',
      'Yanlislikla',
      'dagildi',
      'yorgun uyandim',
    ]) {
      expect(combinedWire).not.toContain(leaked);
    }
  });

  it('(+) emitProductEvent drops events when opted out, emits scrubbed payloads when opted in, and preserves emitEvent compatibility', () => {
    const seen: AnalyticsEvent[] = [];
    setAnalyticsSink((e) => {
      seen.push(e);
    });

    expect(isAnalyticsOptedIn()).toBe(false);
    const droppedWhenOptedOut = emitProductEvent('first_action_started', {
      suggestion_kind: 'start_small',
      elapsed_seconds: 12,
      task_title: 'Gizli gorev basligi',
    });
    expect(droppedWhenOptedOut).toBeNull();
    expect(seen).toHaveLength(0);

    // Undeclared event names still throw loudly even when opted out.
    expect(() =>
      emitProductEvent('undeclared_free_text_event' as AnalyticsEventName, {}),
    ).toThrow(/unknown event/);

    setAnalyticsOptIn(true);
    expect(isAnalyticsOptedIn()).toBe(true);

    const emitted = emitProductEvent('day_replan_applied', {
      replan_outcome: 'partial',
      moved_count: 2,
      journal_note: 'Gizli gunluk metni',
    });
    expect(emitted).not.toBeNull();
    expect(seen).toHaveLength(1);
    expect(seen[0].name).toBe('day_replan_applied');
    expect(seen[0].props).toEqual({
      replan_outcome: 'partial',
      moved_count: 2,
    });
    expect(seen[0].dropped).toEqual(['journal_note']);
    expect(JSON.stringify(seen[0])).not.toContain('Gizli gunluk metni');

    // Sink failure never breaks product execution; emitEvent remains directly callable.
    setAnalyticsSink(() => {
      throw new Error('sink network failure');
    });
    expect(() =>
      emitProductEvent('light_day_confirmed', { kept_count: 1 }),
    ).not.toThrow();

    setAnalyticsOptIn(false);
    const direct = buildEvent('habit_completed', { state: 'done', xp: 10 });
    const legacySeen: AnalyticsEvent[] = [];
    setAnalyticsSink((e) => {
      legacySeen.push(e);
    });
    emitEvent(direct);
    expect(legacySeen).toHaveLength(1);
  });
});

describe('Y04 & E13 OBSERVABILITY_RUNBOOK.md contract and drift guard', () => {
  it('(+) OBSERVABILITY_RUNBOOK.md exists and documents DSN, 4-layer scrubbing, 5 signals, 044 retention check, ANALYTICS_RETENTION_DAYS, and BLOKE status', () => {
    expect(existsSync(RUNBOOK_PATH)).toBe(true);
    const runbook = readFileSync(RUNBOOK_PATH, 'utf8').replace(/\r\n?/g, '\n');

    expect(verifyObservabilityRunbookTokens(runbook)).toEqual([]);
    expect(runbook).toContain(`ANALYTICS_RETENTION_DAYS = ${ANALYTICS_RETENTION_DAYS}`);
  });

  it('(-) verifyObservabilityRunbookTokens catches missing DSN, retention, or BLOKE status on synthetic markdown', () => {
    const runbook = readFileSync(RUNBOOK_PATH, 'utf8');
    const missingBloke = runbook.replace(/BLOKE/g, 'READY');
    expect(verifyObservabilityRunbookTokens(missingBloke)).toContain('BLOKE');

    const missingRetention = runbook.replace(/ANALYTICS_RETENTION_DAYS = 90/g, 'RETENTION_OMITTED');
    expect(verifyObservabilityRunbookTokens(missingRetention)).toContain(
      'ANALYTICS_RETENTION_DAYS = 90',
    );
  });
});
