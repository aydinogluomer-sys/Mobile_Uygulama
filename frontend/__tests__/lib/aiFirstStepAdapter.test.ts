import {
  CLARIFICATION_QUESTION,
  NO_AI_ESTIMATE,
  adaptAiFirstStep,
  buildFallbackFirstStep,
  classifyAiFailureReason,
  formatAiEstimateLabel,
  resolveAiFirstStepPromptContext,
  resolveFirstStepWithFallback,
  validateRawAiFirstStepPayload,
  verifyStagedAiSuggestionFreshness,
  type AiFirstStepContext,
} from '../../lib/aiFirstStepAdapter';
import type { Task } from '../../lib/taskTypes';

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: overrides.id ?? 'task-1',
    user_id: overrides.user_id ?? 'user-a',
    title: overrides.title ?? 'Rapor yaz',
    description: overrides.description ?? null,
    status: overrides.status ?? 'pending',
    priority: overrides.priority ?? 'medium',
    due_date: overrides.due_date ?? '2026-11-24',
    list_type: overrides.list_type ?? 'inbox',
    completed: overrides.completed ?? false,
    created_at: overrides.created_at ?? '2026-11-24T08:00:00Z',
    updated_at: overrides.updated_at !== undefined ? overrides.updated_at : '2026-11-24T08:00:00Z',
    estimated_minutes: overrides.estimated_minutes ?? null,
    estimate_source: overrides.estimate_source ?? null,
    parent_task_id: overrides.parent_task_id ?? null,
    is_subtask: overrides.is_subtask ?? false,
    project_id: overrides.project_id ?? null,
  };
}

function makeContext(overrides: Partial<AiFirstStepContext> = {}): AiFirstStepContext {
  return {
    userId: overrides.userId ?? 'user-a',
    localDayKey: overrides.localDayKey ?? '2026-11-24',
    requestId: overrides.requestId ?? 'req-101',
    userPrompt: overrides.userPrompt ?? 'Rapor yaz',
    openTasks: overrides.openTasks ?? [makeTask()],
    activeFocusRunning: overrides.activeFocusRunning,
    includeJournalContext: overrides.includeJournalContext,
    journalText: overrides.journalText,
  };
}

describe('E11 / LEAF-02 — AI first-step schema validation & single concrete micro-step adapter', () => {
  it('(+) converts "Rapor yaz" model response into a single confirmable ready_suggestion without completing parent', () => {
    const task = makeTask({
      id: 'task-report-1',
      user_id: 'user-a',
      title: 'Rapor yaz',
      updated_at: '2026-11-24T09:15:00Z',
    });
    const ctx = makeContext({
      requestId: 'req-report-1',
      userPrompt: 'Rapor yaz',
      openTasks: [task],
    });

    const result = adaptAiFirstStep(
      {
        type: 'suggest_small_step',
        task_query: 'Rapor yaz',
        step: '  Rapor dosyasını aç ve üç başlık ekle  ',
        minutes: 10,
      },
      ctx,
    );

    expect(result).toEqual({
      kind: 'ready_suggestion',
      fallbackUsed: false,
      requestId: 'req-report-1',
      taskId: 'task-report-1',
      parentTitle: 'Rapor yaz',
      expectedFingerprint: expect.any(String),
      expectedVersion: '2026-11-24T09:15:00Z',
      stepTitle: 'Rapor dosyasını aç ve üç başlık ekle',
      estimate: {
        source: 'ai',
        minutes: 10,
        rangeMin: null,
        rangeMax: null,
        editable: true,
      },
      requiresConfirmation: true,
      completesParentOnFinish: false,
      droppedExtraStepsCount: 0,
      preserveActiveSession: false,
      includeJournalContext: false,
    });
    if (result.kind === 'ready_suggestion') {
      expect(formatAiEstimateLabel(result.estimate)).toBe('10 dk (Önerilen süre)');
    }
  });

  it('(+) extracts ONLY the first concrete micro-step when model returns a multi-step list', () => {
    const ctx = makeContext({ userPrompt: 'Teklifi hazırla', openTasks: [makeTask({ title: 'Teklifi hazırla' })] });
    const result = adaptAiFirstStep(
      {
        steps: [
          'Müşteri notlarını ve şablon dosyasını aç',
          'Fiyat tablosunu doldur',
          'Son okumayı yapıp PDF al',
        ],
        rangeMin: 5,
        rangeMax: 15,
      },
      ctx,
    );

    expect(result.kind).toBe('ready_suggestion');
    if (result.kind === 'ready_suggestion') {
      expect(result.stepTitle).toBe('Müşteri notlarını ve şablon dosyasını aç');
      expect(result.droppedExtraStepsCount).toBe(2);
      expect(result.estimate).toEqual({
        source: 'ai',
        minutes: 10,
        rangeMin: 5,
        rangeMax: 15,
        editable: true,
      });
      expect(formatAiEstimateLabel(result.estimate)).toBe('5-15 dk (Önerilen süre)');
    }
  });

  it.each([
    ['user_id', { step: 'Dosyayı aç', user_id: 'user-evil' }],
    ['id', { step: 'Dosyayı aç', id: 'task-override' }],
    ['completed', { step: 'Dosyayı aç', completed: true }],
    ['xp', { step: 'Dosyayı aç', xp: 250 }],
    ['total_xp', { step: 'Dosyayı aç', total_xp: 9999 }],
    ['daily_goal', { step: 'Dosyayı aç', daily_goal: 30 }],
    ['frequency_config', { step: 'Dosyayı aç', frequency_config: { type: 'daily' } }],
    ['due_date', { step: 'Dosyayı aç', due_date: '2026-12-01' }],
    ['fabricated source', { step: 'Dosyayı aç', source: 'verified_db' }],
    ['nested authority in subtasks', { subtasks: [{ title: 'Dosyayı aç' }, { title: 'Bitir', completed: true }] }],
  ])('(-) strictly rejects authority, direct-write, or fabricated source field: %s', (_label, payload) => {
    const validation = validateRawAiFirstStepPayload(payload);
    expect(validation.ok).toBe(false);
    if (!validation.ok) {
      expect(validation.reason).toBe('forbidden_authority_field');
    }

    const adapted = adaptAiFirstStep(payload, makeContext());
    expect(adapted.kind).toBe('rejected');
  });

  it('(-) strictly rejects __proto__ and constructor prototype-poisoning payloads', () => {
    const protoPayload: unknown = JSON.parse('{"__proto":{"x":1},"__proto__":{"polluted":true},"step":"Başla"}');
    const ctorPayload: unknown = JSON.parse('{"constructor":{"prototype":{}},"step":"Başla"}');

    const vProto = validateRawAiFirstStepPayload(protoPayload);
    expect(vProto).toMatchObject({ ok: false, reason: 'forbidden_prototype_field', field: '__proto__' });

    const vCtor = validateRawAiFirstStepPayload(ctorPayload);
    expect(vCtor).toMatchObject({ ok: false, reason: 'forbidden_prototype_field', field: 'constructor' });
  });

  it('(-) rejects non-object payloads, unknown keys, empty steps, and >120 char steps', () => {
    expect(validateRawAiFirstStepPayload(null)).toMatchObject({ ok: false, reason: 'not_an_object' });
    expect(validateRawAiFirstStepPayload(['adım'])).toMatchObject({ ok: false, reason: 'not_an_object' });
    expect(validateRawAiFirstStepPayload({ step: '   ' })).toMatchObject({ ok: false, reason: 'invalid_step' });
    expect(validateRawAiFirstStepPayload({ step: 'a'.repeat(121) })).toMatchObject({
      ok: false,
      reason: 'invalid_step',
    });
    expect(validateRawAiFirstStepPayload({ step: 'Başla', hallucinated_extra: 42 })).toMatchObject({
      ok: false,
      reason: 'unexpected_field',
      field: 'hallucinated_extra',
    });
  });

  it.each([
    ['omitted duration', { step: 'Rapor dosyasını aç' }],
    ['zero minutes', { step: 'Rapor dosyasını aç', minutes: 0 }],
    ['negative minutes', { step: 'Rapor dosyasını aç', minutes: -5 }],
    ['over 60 minutes', { step: 'Rapor dosyasını aç', minutes: 180 }],
    ['non-numeric string', { step: 'Rapor dosyasını aç', minutes: 'yaklaşık' }],
    ['fractional minutes', { step: 'Rapor dosyasını aç', minutes: 7.5 }],
    ['inverted range', { step: 'Rapor dosyasını aç', rangeMin: 20, rangeMax: 10 }],
    ['out-of-bounds range', { step: 'Rapor dosyasını aç', rangeMin: 10, rangeMax: 90 }],
  ])('(+) maps missing or invalid duration (%s) to source="none" («Tahmin yok») without inventing precision', (_caseName, raw) => {
    const validated = validateRawAiFirstStepPayload(raw);
    expect(validated.ok).toBe(true);
    if (validated.ok) {
      expect(validated.value.estimate).toEqual(NO_AI_ESTIMATE);
      expect(formatAiEstimateLabel(validated.value.estimate)).toBe('Tahmin yok');
    }
  });
});

describe('E11 / LEAF-02 / U04 — Task ownership scoping, ambiguity question, draft candidate, and staleness guard', () => {
  it('(-) eliminates candidate tasks belonging to another user_id even when title matches 1:1', () => {
    const foreignTask = makeTask({
      id: 'foreign-task-99',
      user_id: 'user-other',
      title: 'Rapor yaz',
    });
    const ctx = makeContext({
      userId: 'user-a',
      userPrompt: 'Rapor yaz',
      openTasks: [foreignTask],
    });

    const result = adaptAiFirstStep(
      { task_query: 'Rapor yaz', step: 'Rapor dosyasını aç ve üç başlık ekle', minutes: 5 },
      ctx,
    );

    expect(result.kind).toBe('draft_candidate');
    if (result.kind === 'draft_candidate') {
      expect(result.draftParentTitle).toBe('Rapor yaz');
      expect(result.requiresConfirmation).toBe(true);
      expect(result.completesParentOnFinish).toBe(false);
    }
  });

  it('(+) returns a single clarification_needed question when multiple user-owned tasks match ("Teklif…")', () => {
    const t1 = makeTask({ id: 'task-prop-1', user_id: 'user-a', title: 'Teklif sunumunu hazırla' });
    const t2 = makeTask({ id: 'task-prop-2', user_id: 'user-a', title: 'Teklif bütçesini kontrol et' });
    const foreign = makeTask({ id: 'task-prop-foreign', user_id: 'user-b', title: 'Teklif dosyasını sil' });

    const ctx = makeContext({
      userId: 'user-a',
      requestId: 'req-ambig-1',
      userPrompt: 'Teklif',
      openTasks: [t1, t2, foreign],
    });

    const result = adaptAiFirstStep(
      { task_query: 'Teklif', step: 'Teklif klasörünü aç ve ilk slayt başlığını yaz', minutes: 10 },
      ctx,
    );

    expect(result).toEqual({
      kind: 'clarification_needed',
      fallbackUsed: false,
      requestId: 'req-ambig-1',
      question: CLARIFICATION_QUESTION,
      candidates: [
        { id: 'task-prop-1', title: 'Teklif sunumunu hazırla', due_date: '2026-11-24', updated_at: '2026-11-24T08:00:00Z' },
        { id: 'task-prop-2', title: 'Teklif bütçesini kontrol et', due_date: '2026-11-24', updated_at: '2026-11-24T08:00:00Z' },
      ],
      stepTitle: 'Teklif klasörünü aç ve ilk slayt başlığını yaz',
      estimate: { source: 'ai', minutes: 10, rangeMin: null, rangeMax: null, editable: true },
      preserveActiveSession: false,
      includeJournalContext: false,
    });
  });

  it('(+) returns an unwritten draft_candidate when no open task matches', () => {
    const ctx = makeContext({
      requestId: 'req-draft-1',
      userPrompt: 'Sunum taslağını çıkar',
      openTasks: [makeTask({ id: 't-other', title: 'Market alışverişi' })],
    });

    const result = adaptAiFirstStep(
      { step: 'Boş slayt dosyasını oluştur ve kapak başlığını yaz' },
      ctx,
    );

    expect(result).toEqual({
      kind: 'draft_candidate',
      fallbackUsed: false,
      requestId: 'req-draft-1',
      draftParentTitle: 'Sunum taslağını çıkar',
      stepTitle: 'Boş slayt dosyasını oluştur ve kapak başlığını yaz',
      estimate: NO_AI_ESTIMATE,
      requiresConfirmation: true,
      completesParentOnFinish: false,
      droppedExtraStepsCount: 0,
      preserveActiveSession: false,
      includeJournalContext: false,
    });
  });

  it('(-) verifyStagedAiSuggestionFreshness returns refresh_required on version/title/status drift and task_gone when deleted', () => {
    const originalTask = makeTask({
      id: 'task-fresh-1',
      user_id: 'user-a',
      title: 'Rapor yaz',
      updated_at: '2026-11-24T10:00:00Z',
    });
    const staged = adaptAiFirstStep(
      { step: 'Rapor dosyasını aç ve üç başlık ekle', minutes: 10 },
      makeContext({ openTasks: [originalTask] }),
    );
    expect(staged.kind).toBe('ready_suggestion');
    if (staged.kind !== 'ready_suggestion') return;

    expect(verifyStagedAiSuggestionFreshness(staged, originalTask)).toBe('fresh');

    const editedTitleTask = { ...originalTask, title: 'Yıllık raporu yaz', updated_at: '2026-11-24T10:05:00Z' };
    expect(verifyStagedAiSuggestionFreshness(staged, editedTitleTask)).toBe('refresh_required');

    const completedElsewhereTask = { ...originalTask, completed: true, status: 'completed' as const };
    expect(verifyStagedAiSuggestionFreshness(staged, completedElsewhereTask)).toBe('refresh_required');

    expect(verifyStagedAiSuggestionFreshness(staged, undefined)).toBe('task_gone');
    expect(verifyStagedAiSuggestionFreshness(staged, null)).toBe('task_gone');
    expect(
      verifyStagedAiSuggestionFreshness(
        { ...staged, userId: 'user-a' },
        { ...originalTask, user_id: 'user-b' },
      ),
    ).toBe('task_gone');
  });
});

describe('LEAF-03 — Provider failure / timeout / broken JSON / quota / offline fallback & active focus safety', () => {
  it.each([
    ['timeout', { ok: false as const, error: Object.assign(new Error('Request timed out'), { name: 'EdgeTimeoutError' }) }, 'timeout'],
    ['offline', { ok: false as const, error: Object.assign(new TypeError('Network request failed'), { name: 'FunctionsFetchError' }) }, 'offline'],
    ['quota_exceeded', { ok: false as const, status: 429, code: 'QUOTA_EXCEEDED' }, 'quota_exceeded'],
    ['5xx', { ok: false as const, status: 503 }, '5xx'],
    ['broken JSON text', { ok: true as const, rawText: '{"step": "yarım kalmış...' }, 'malformed_response'],
  ] as const)(
    '(+) falls back cleanly on %s, preserving requestId and active focus session via local taskDecomposition + smallStart',
    (_label, outcome, expectedReason) => {
      const task = makeTask({
        id: 'task-write-1',
        user_id: 'user-a',
        title: 'Rapor yaz',
      });
      const ctx = makeContext({
        requestId: 'req-same-777',
        userPrompt: 'Rapor yaz',
        openTasks: [task],
        activeFocusRunning: true,
      });

      const resolved = resolveFirstStepWithFallback(outcome, ctx);

      expect(resolved.kind).toBe('local_fallback');
      if (resolved.kind === 'local_fallback') {
        expect(resolved.fallbackUsed).toBe(true);
        expect(resolved.source).toBe('local_splitter');
        expect(resolved.reason).toBe(expectedReason);
        expect(resolved.requestId).toBe('req-same-777');
        expect(resolved.retryRequestId).toBe('req-same-777');
        expect(resolved.preserveActiveSession).toBe(true);
        expect(resolved.taskId).toBe('task-write-1');
        expect(resolved.stepTitle).toBe('Ana fikri tek cümleyle yaz — Rapor yaz');
        expect(resolved.smallStep).toEqual({
          title: 'Ana fikri tek cümleyle yaz — Rapor yaz',
          minutes: 10,
          parent: { kind: 'task', id: 'task-write-1', title: 'Rapor yaz' },
        });
        expect(resolved.estimate).toEqual(NO_AI_ESTIMATE);
        expect(resolved.requiresConfirmation).toBe(true);
        expect(resolved.completesParentOnFinish).toBe(false);
      }
    },
  );

  it('(+) falls back to local_splitter with rejectedAiReason when model returns an authority-violating payload', () => {
    const ctx = makeContext({
      requestId: 'req-hostile-9',
      userPrompt: 'Teklifi hazırla',
      openTasks: [makeTask({ id: 't-prep', title: 'Teklifi hazırla' })],
      activeFocusRunning: true,
    });

    const resolved = resolveFirstStepWithFallback(
      { ok: true, payload: { step: 'Şablonu aç', completed: true, user_id: 'attacker' } },
      ctx,
    );

    expect(resolved.kind).toBe('local_fallback');
    if (resolved.kind === 'local_fallback') {
      expect(resolved.reason).toBe('malformed_response');
      expect(resolved.rejectedAiReason).toBe('forbidden_authority_field');
      expect(resolved.retryRequestId).toBe('req-hostile-9');
      expect(resolved.preserveActiveSession).toBe(true);
      expect(resolved.stepTitle).toBe('Gerekenleri tek bir yere topla — Teklifi hazırla');
    }
  });

  it('(+) delayed valid AI answer while activeFocusRunning=true marks preserveActiveSession=true and still requires confirmation', () => {
    const ctx = makeContext({
      requestId: 'req-late-1',
      activeFocusRunning: true,
    });

    const res = resolveFirstStepWithFallback(
      { ok: true, payload: { step: 'Rapor dosyasını aç ve üç başlık ekle', minutes: 10 } },
      ctx,
    );

    expect(res.kind).toBe('ready_suggestion');
    if (res.kind === 'ready_suggestion') {
      expect(res.preserveActiveSession).toBe(true);
      expect(res.requiresConfirmation).toBe(true);
    }

    const directFallback = buildFallbackFirstStep(ctx, classifyAiFailureReason('timeout'));
    expect(directFallback.preserveActiveSession).toBe(true);
    expect(directFallback.retryRequestId).toBe('req-late-1');
  });
});

describe('R09.05 / E11 — Journal context privacy default', () => {
  it('(+) keeps includeJournalContext=false by default and strips journalText unless explicitly enabled', () => {
    const ownTask = makeTask({ id: 't-own', user_id: 'user-a', title: 'Rapor yaz' });
    const otherTask = makeTask({ id: 't-other', user_id: 'user-b', title: 'Gizli görev' });

    const defaultEnvelope = resolveAiFirstStepPromptContext(
      makeContext({
        userId: 'user-a',
        openTasks: [ownTask, otherTask],
        journalText: 'Bugün çok yorgunum, özel günlük satırı.',
      }),
    );

    expect(defaultEnvelope.includeJournalContext).toBe(false);
    expect(defaultEnvelope.journalExcerpt).toBeNull();
    expect(defaultEnvelope.openTaskTitles).toEqual(['Rapor yaz']);

    const explicitOptInEnvelope = resolveAiFirstStepPromptContext(
      makeContext({
        userId: 'user-a',
        openTasks: [ownTask, otherTask],
        includeJournalContext: true,
        journalText: '  Bugün odaklanmakta zorlandım.  ',
      }),
    );

    expect(explicitOptInEnvelope.includeJournalContext).toBe(true);
    expect(explicitOptInEnvelope.journalExcerpt).toBe('Bugün odaklanmakta zorlandım.');
  });
});
