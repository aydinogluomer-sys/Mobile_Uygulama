import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '../helpers/sourceText';

const ROOT = join(__dirname, '..', '..');
const readRaw = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
const readCode = (rel: string) => stripComments(readRaw(rel));

describe('F30 — Quick-Add, Speech Hardening, Smart Lists & Subtask Cascade Wiring Guard', () => {
  it('lib/taskQuickAdd.ts and lib/smartTaskLists.ts are 100% pure (no supabase, repositories, stores, React, network, AI, or toISOString)', () => {
    for (const rel of ['lib/taskQuickAdd.ts', 'lib/smartTaskLists.ts']) {
      const code = readCode(rel);
      expect(code).not.toMatch(/from\s+['"][^'"]*(?:supabase|repositories\/|store\/|react)/);
      expect(code).not.toMatch(/\bfetch\s*\(/);
      expect(code).not.toMatch(/functions\s*\.\s*invoke/);
      expect(code).not.toMatch(/toISOString\s*\(/);
    }
    const quickAdd = readCode('lib/taskQuickAdd.ts');
    expect(quickAdd).toMatch(/export\s+function\s+foldTr\b/);
    expect(quickAdd).toMatch(/export\s+function\s+parseQuickAdd\b/);
    expect(quickAdd).toMatch(/export\s+function\s+formatChipDate\b/);
    expect(quickAdd).toMatch(/export\s+function\s+formatTimeBlock\b/);
    expect(quickAdd).toMatch(/export\s+function\s+quickAddToTaskInput\b/);
  });

  it('tasks.tsx wires quickAdd, voice, SMART_LISTS without red/shame copy, and projects.tsx stays raw-title', () => {
    const tasks = readCode('app/tabs/tasks.tsx');
    expect(tasks).toContain('quickAdd=');
    expect(tasks).toMatch(/\bvoice\b/);
    expect(tasks).toContain('SMART_LISTS');
    expect(tasks).toContain('filterSmartList');
    expect(tasks).toContain('archiveParent');

    // Smart-list chip block never uses colors.error or "gecikmiş"
    const smartIdx = tasks.indexOf('SMART_LISTS.map');
    expect(smartIdx).toBeGreaterThan(-1);
    const smartSlice = tasks.slice(smartIdx, smartIdx + 600);
    expect(smartSlice).not.toContain('colors.error');
    expect(smartSlice.toLowerCase()).not.toContain('gecikmiş');

    // projects.tsx deliberately keeps raw title submission without quickAdd token stripping
    const projects = readCode('app/screens/projects.tsx');
    expect(projects).toContain('<InlineComposer');
    expect(projects).not.toContain('quickAdd=');

    // TODO(Wave9-merge): Coordinator enables after wiring quickAdd in today.tsx
    // const today = readCode('app/tabs/today.tsx');
    // expect(today).toContain('quickAdd=');
    // expect(today).toMatch(/\bvoice\b/);
  });

  it('InlineComposer.tsx preserves run-tests.js invariants and wires parseQuickAdd + useSpeechInput', () => {
    const ic = readCode('components/InlineComposer.tsx');
    expect(ic).toContain('onSubmit');
    expect(ic).toContain('onSubmitEditing');
    expect(ic).toContain('TextInput');
    expect(ic).toContain('parseQuickAdd');
    expect(ic).toContain('useSpeechInput');
    expect(ic).toMatch(/\bvoice\b/);
  });

  it('useSpeechInput.ts and ai-coach.tsx enforce selection-safe dictation, blocked guard, and zero transcript logging/sending', () => {
    const speech = readCode('hooks/useSpeechInput.ts');
    expect(speech).toMatch(/export\s+function\s+classifySpeechError\b/);
    expect(speech).toMatch(/export\s+function\s+splitAtSelection\b/);
    expect(speech).toMatch(/export\s+function\s+composeDictation\b/);
    expect(speech).not.toMatch(/\bonSubmit\b/);
    expect(speech).not.toMatch(/\b(?:console\.\w+|reportError)\s*\(/);

    const coach = readCode('app/screens/ai-coach.tsx');
    expect(coach).toContain('splitAtSelection');
    expect(coach).toContain('!speech.blocked');
    expect(readRaw('app/screens/ai-coach.tsx').split('\n').length).toBeLessThan(1000);
  });

  it('ADHDTaskSplitter.tsx, taskDecomposition.ts, and taskRepository.ts wire verb-based steps, archiveParent, and parent_task_id/is_subtask', () => {
    const decomp = readCode('lib/taskDecomposition.ts');
    expect(decomp).toContain('STEP_FAMILIES');
    expect(decomp).toContain('deriveSplitSteps');
    expect(decomp).toContain('parent_task_id');
    expect(decomp).toContain('is_subtask: true');
    expect(decomp).not.toContain('SPLIT_LABELS');

    const splitter = readCode('components/ADHDTaskSplitter.tsx');
    expect(splitter).toContain('archiveParent');
    expect(splitter).toContain('Switch');

    const repo = readCode('repositories/taskRepository.ts');
    expect(repo).toContain('parent_task_id');
    expect(repo).toContain('is_subtask');
    expect(repo).toContain('time_block_start');
  });
});
