/**
 * Plan §22: "hassas journal metinleri event platformlarına gönderilmemelidir."
 *
 * The precise boundary, established by the Orchestrator's privacy pre-audit:
 * journal text MAY reach the AI feature the user explicitly invoked
 * (`journal-insights.tsx` sends `entries: text` — that text is the feature's
 * whole input). It must NEVER reach an analytics/event sink.
 *
 * So the rule this guard enforces is narrower and sharper than "no journal
 * text anywhere": an analytics event payload carries ids, counts, enums and
 * timestamps ONLY — never free text. A constraint like this erodes silently
 * as code changes, which is why it is a test rather than a comment.
 *
 * Source-text + type invariant, same instrument as `rule4NoDirectDbInUi.test.ts`.
 */
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { ANALYTICS_EVENTS, buildEvent, type AnalyticsEventName } from '../../lib/analytics';

const libPath = join(__dirname, '..', '..', 'lib', 'analytics.ts');

describe('§22 analytics event layer', () => {
  it('exists', () => {
    expect(existsSync(libPath)).toBe(true);
  });

  it('declares every event name plan §22 lists', () => {
    const required = [
      'habit_created', 'habit_completed', 'habit_partial', 'habit_missed',
      'recovery_created', 'recovery_completed',
      'routine_installed',
      'focus_started', 'focus_completed',
      'weekly_review_completed',
      'ai_routine_generated',
    ];
    for (const name of required) {
      expect(ANALYTICS_EVENTS).toContain(name as AnalyticsEventName);
    }
  });

  it('strips any free-text value from an event payload', () => {
    // A caller carelessly passing journal/note/title text must not get it through.
    const ev = buildEvent('habit_completed', {
      habit_id: '11111111-1111-1111-1111-111111111111',
      state: 'done',
      xp: 30,
      // hostile / careless additions:
      note: 'bugün kendimi çok kötü hissettim',
      journal: 'private entry',
      title: 'Sabah yürüyüşü',
    } as never);
    const serialised = JSON.stringify(ev);
    expect(serialised).not.toContain('kendimi');
    expect(serialised).not.toContain('private entry');
    expect(serialised).not.toContain('Sabah yürüyüşü');
  });

  it('keeps ids, counts, enums and timestamps', () => {
    const ev = buildEvent('habit_completed', {
      habit_id: '11111111-1111-1111-1111-111111111111',
      state: 'done',
      xp: 30,
    });
    expect(ev.props.habit_id).toBe('11111111-1111-1111-1111-111111111111');
    expect(ev.props.state).toBe('done');
    expect(ev.props.xp).toBe(30);
    expect(typeof ev.name).toBe('string');
  });

  it('rejects an unknown event name rather than silently emitting it', () => {
    expect(() => buildEvent('journal_written' as AnalyticsEventName, {})).toThrow();
  });

  it('scanner sanity — the free-text detector would catch a leaked string', () => {
    const leaked = JSON.stringify({ props: { note: 'kendimi' } });
    expect(leaked).toContain('kendimi');
  });
});
