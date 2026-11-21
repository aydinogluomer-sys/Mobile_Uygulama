/**
 * F20 (SYN-25 / INT-21) — CSV formül enjeksiyonu kaçışı.
 * Yalnız metin hücreleri önek alır; sayılar, mantıksallar ve Excel XML String hücreleri bozulmaz.
 */
import { escapeCsvCell, FORMULA_PREFIX } from '../../lib/csvImport';
import { sessionsSheet, toCSV, toExcelXML, type FocusSessionRow } from '../../lib/focusReport';
import { backupToCSV, type Backup } from '../../services/exportService';

describe('escapeCsvCell — pozitif vakalar', () => {
  it('formül başlatıcı karakterlerle başlayan metin hücrelerine tek tırnak öneki ekler', () => {
    expect(FORMULA_PREFIX.test('=1+1')).toBe(true);
    expect(escapeCsvCell('=1+1')).toBe("'=1+1");
    expect(escapeCsvCell('+1')).toBe("'+1");
    expect(escapeCsvCell('-5')).toBe("'-5");
    expect(escapeCsvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(escapeCsvCell('\t=1')).toBe("'\t=1");
    expect(escapeCsvCell('\r=1')).toBe('"\'\r=1"');
    expect(escapeCsvCell(' =1+1')).toBe("' =1+1");
  });

  it('hem formül karakteri hem virgül/tırnak/satır sonu içeren hücreyi önekleyip tırnaklar', () => {
    expect(escapeCsvCell('=a,b')).toBe('"\'=a,b"');
    expect(escapeCsvCell('merhaba')).toBe('merhaba');
    expect(escapeCsvCell('sat"ır')).toBe('"sat""ır"');
    expect(escapeCsvCell('a\r\nb')).toBe('"a\r\nb"');
  });
});

describe('escapeCsvCell — negatif vakalar', () => {
  it('negatif sayılar, sıfır, mantıksal ve boş değerler formül öneki almaz', () => {
    expect(escapeCsvCell(-5)).toBe('-5');
    expect(escapeCsvCell(0)).toBe('0');
    expect(escapeCsvCell(true)).toBe('true');
    expect(escapeCsvCell(false)).toBe('false');
    expect(escapeCsvCell(null)).toBe('');
    expect(escapeCsvCell(undefined)).toBe('');
  });
});

describe('CSV ve Excel dışa aktarma entegrasyonu', () => {
  const payload = '=HYPERLINK("https://ornek.test","tikla")';

  it('backupToCSV ve focusReport.toCSV formül başlıklı görevi önekler; toExcelXML String türünü öneksiz korur', () => {
    const emptyBackup: Backup = {
      format_version: 3,
      export_date: '2026-11-01T00:00:00.000Z',
      truncated: [],
      failed: [],
      habits: [],
      habit_logs: [],
      tasks: [{ id: 't1', title: payload, offset: -5 }],
      projects: [],
      goals: [],
      notes: [],
      journal_entries: [],
      focus_sessions: [],
      bad_habits: [],
      webhooks: [],
      okrs: [],
      key_results: [],
      reading_list: [],
      focus_tasks: [],
      recovery_plans: [],
      weekly_reviews: [],
      monthly_reviews: [],
      life_area_logs: [],
      deep_work_sessions: [],
      ai_conversations: [],
      ai_messages: [],
      ai_conversation_actions: [],
      journal_insights: [],
      routines: [],
      habit_deletions: [],
      habit_pauses: [],
      habit_goal_versions: [],
      habit_checklist_items: [],
      habit_checklist_checks: [],
      profiles: [],
      user_onboarding: [],
      device: [],
      notes_on_contents: [],
    };

    const backupCsv = backupToCSV(emptyBackup);
    expect(backupCsv).toContain('"\'=HYPERLINK(""https://ornek.test"",""tikla"")"');
    expect(backupCsv).toContain(',-5');

    const session: FocusSessionRow = {
      id: 's1',
      task_id: 't1',
      task_title: payload,
      mode: 'work',
      started_at: '2026-11-01T10:00:00.000Z',
      ended_at: '2026-11-01T10:25:00.000Z',
      planned_seconds: 1500,
      completed_seconds: 1500,
      completed: true,
    };
    const focusCsv = toCSV([session]);
    const dataRow = focusCsv.split('\n')[1] ?? '';
    expect(dataRow.startsWith('"\'=HYPERLINK(')).toBe(true);

    const xml = toExcelXML([sessionsSheet([session])]);
    expect(xml).toContain('<Data ss:Type="String">=HYPERLINK(&quot;https://ornek.test&quot;,&quot;tikla&quot;)</Data>');
  });
});
