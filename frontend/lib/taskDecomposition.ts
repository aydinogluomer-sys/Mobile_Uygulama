/**
 * Task Decomposition Service V2 -- AI subtask validator & deterministic Turkish verb splitter.
 * (Phase 3, CODER-L, plan §15 + F30 INT-15)
 *
 * Pipeline:
 *   task -> task decomposition service -> validated subtasks -> preview -> save
 *
 * `buildLocalSplitProposal` derives concrete, action-oriented Turkish steps from
 * the trailing verb of the parent task title (or `GENERIC_STEPS` when unknown),
 * keeps the first step at a 2-minute low-friction threshold, truncates long or
 * emoji-heavy topics at code-point and word boundaries (`<= MAX_TOPIC_LENGTH`),
 * and returns `unknown` so every proposal still passes through the strict
 * `validateSubtaskProposal` barrier before reaching UI preview or persistence.
 */
import type { ValidationError } from './routineProposal';
import type { Task } from '../lib/taskTypes';
import { foldTr } from './taskQuickAdd';

// ---------------------------------------------------------------------------
// Schema constants -- every bound a validator rejection below cites.
// ---------------------------------------------------------------------------

export const MAX_SUBTASKS_PER_PROPOSAL = 8;
export const MAX_SUBTASK_TITLE_LENGTH = 150;
export const MAX_SUBTASK_DESCRIPTION_LENGTH = 500;

const ALLOWED_TOP_KEYS = new Set(['subtasks']);
const ALLOWED_SUBTASK_KEYS = new Set(['title', 'description']);
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ProposedSubtask = {
  title: string;
  description: string | null;
};

export type SubtaskDecompositionProposal = {
  subtasks: ProposedSubtask[];
};

export type SubtaskValidationResult =
  | { ok: true; proposal: SubtaskDecompositionProposal }
  | { ok: false; errors: ValidationError[] };

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function describeType(v: unknown): string {
  if (v === null) return 'null';
  if (v === undefined) return 'undefined';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'number' && Number.isNaN(v)) return 'NaN';
  return typeof v;
}

function hasForbiddenKey(obj: Record<string, unknown>): boolean {
  return Object.keys(obj).some((k) => FORBIDDEN_KEYS.has(k));
}

// ---------------------------------------------------------------------------
// Per-subtask validation
// ---------------------------------------------------------------------------

function validateSubtask(
  raw: unknown,
  index: number,
): { errors: ValidationError[]; subtask: ProposedSubtask | null } {
  const path = `subtasks[${index}]`;
  const errors: ValidationError[] = [];

  if (!isPlainObject(raw)) {
    errors.push({ path, message: `${path}: expected an object, got ${describeType(raw)}` });
    return { errors, subtask: null };
  }

  if (hasForbiddenKey(raw)) {
    errors.push({ path, message: `${path}: contains a forbidden key (__proto__ / constructor / prototype)` });
  }
  const extraKeys = Object.keys(raw).filter((k) => !ALLOWED_SUBTASK_KEYS.has(k) && !FORBIDDEN_KEYS.has(k));
  if (extraKeys.length > 0) {
    errors.push({ path, message: `${path}: unexpected field(s): ${extraKeys.join(', ')}` });
  }

  const title = raw.title;
  if (typeof title !== 'string') {
    errors.push({ path: `${path}.title`, message: `${path}.title: expected a string, got ${describeType(title)}` });
  } else if (title.trim().length === 0) {
    errors.push({ path: `${path}.title`, message: `${path}.title: must not be empty` });
  } else if (title.length > MAX_SUBTASK_TITLE_LENGTH) {
    errors.push({ path: `${path}.title`, message: `${path}.title: exceeds max length ${MAX_SUBTASK_TITLE_LENGTH} (got ${title.length})` });
  }

  const description = raw.description;
  if (description !== null && description !== undefined) {
    if (typeof description !== 'string') {
      errors.push({ path: `${path}.description`, message: `${path}.description: expected a string or null, got ${describeType(description)}` });
    } else if (description.length > MAX_SUBTASK_DESCRIPTION_LENGTH) {
      errors.push({ path: `${path}.description`, message: `${path}.description: exceeds max length ${MAX_SUBTASK_DESCRIPTION_LENGTH} (got ${description.length})` });
    }
  }

  if (errors.length > 0) return { errors, subtask: null };

  return {
    errors: [],
    subtask: {
      title: (title as string).trim(),
      description: typeof description === 'string' ? description.trim() : null,
    },
  };
}

// ---------------------------------------------------------------------------
// Top-level validator -- the barrier's entry point
// ---------------------------------------------------------------------------

export function validateSubtaskProposal(raw: unknown): SubtaskValidationResult {
  if (!isPlainObject(raw)) {
    return { ok: false, errors: [{ path: '$', message: `expected an object, got ${describeType(raw)}` }] };
  }

  const errors: ValidationError[] = [];

  if (hasForbiddenKey(raw)) {
    errors.push({ path: '$', message: 'root object contains a forbidden key (__proto__ / constructor / prototype)' });
  }
  const extraTopKeys = Object.keys(raw).filter((k) => !ALLOWED_TOP_KEYS.has(k) && !FORBIDDEN_KEYS.has(k));
  if (extraTopKeys.length > 0) {
    errors.push({ path: '$', message: `unexpected field(s): ${extraTopKeys.join(', ')}` });
  }

  const subtasksRaw = raw.subtasks;
  const validSubtasks: ProposedSubtask[] = [];

  if (!Array.isArray(subtasksRaw)) {
    errors.push({ path: 'subtasks', message: `subtasks: expected an array, got ${describeType(subtasksRaw)}` });
  } else if (subtasksRaw.length === 0) {
    errors.push({ path: 'subtasks', message: 'subtasks: must contain at least one subtask' });
  } else if (subtasksRaw.length > MAX_SUBTASKS_PER_PROPOSAL) {
    errors.push({ path: 'subtasks', message: `subtasks: contains ${subtasksRaw.length} subtasks, exceeds max of ${MAX_SUBTASKS_PER_PROPOSAL}` });
  } else {
    let allSubtasksClean = true;
    subtasksRaw.forEach((s, i) => {
      const { errors: sErrors, subtask } = validateSubtask(s, i);
      if (sErrors.length > 0) allSubtasksClean = false;
      errors.push(...sErrors);
      if (subtask) validSubtasks.push(subtask);
    });

    if (allSubtasksClean) {
      const seenAt = new Map<string, number>();
      validSubtasks.forEach((s, i) => {
        const key = s.title.toLowerCase();
        const firstIndex = seenAt.get(key);
        if (firstIndex !== undefined) {
          errors.push({
            path: `subtasks[${i}].title`,
            message: `subtasks[${i}].title: duplicate subtask title '${s.title}' (already used at subtasks[${firstIndex}])`,
          });
        } else {
          seenAt.set(key, i);
        }
      });
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  return { ok: true, proposal: { subtasks: validSubtasks } };
}

// ---------------------------------------------------------------------------
// F30 Deterministic Turkish verb-family decomposition
// ---------------------------------------------------------------------------

export type StepFamily = {
  id: string;
  verbs: readonly string[];
  steps: readonly [string, string, string];
};

export const MAX_TOPIC_LENGTH = 60;

export const GENERIC_STEPS: readonly [string, string, string] = [
  'Gerekenleri bir araya getir',
  'İlk 2 dakikalık adımı yap',
  'Bitir ve işaretle',
];

/** Sıra önemlidir: ilk eşleşen kazanır. verbs katlanmış (foldTr) emir/mastar biçimleridir. Her adım <= 45 karakter. */
export const STEP_FAMILIES: readonly StepFamily[] = [
  {
    id: 'prepare',
    verbs: ['hazirla', 'hazirlamak'],
    steps: [
      'Gerekenleri tek bir yere topla',
      'İlk taslağı 10 dakikada çıkar',
      'Gözden geçir ve bitir',
    ],
  },
  {
    id: 'write',
    verbs: ['yaz', 'yazmak'],
    steps: [
      'Ana fikri tek cümleyle yaz',
      'Kaba taslağı çıkar',
      'Düzelt ve bitir',
    ],
  },
  {
    id: 'send',
    verbs: ['gonder', 'gondermek', 'yolla', 'yollamak', 'ilet', 'iletmek'],
    steps: [
      'Göndereceğin şeyi hazır et',
      'Alıcıyı ve içeriği kontrol et',
      'Gönder ve işaretle',
    ],
  },
  {
    id: 'pay',
    verbs: ['ode', 'odemek'],
    steps: [
      'Ödeme bilgisini bul',
      'Ödemeyi yap',
      'Dekontu sakla',
    ],
  },
  {
    id: 'call',
    verbs: ['ara', 'aramak', 'basvur', 'basvurmak'],
    steps: [
      'Numarayı ya da formu bul',
      'Aramayı ya da başvuruyu yap',
      'Sonucu not et',
    ],
  },
  {
    id: 'clean',
    verbs: ['temizle', 'temizlemek', 'topla', 'toplamak', 'duzenle', 'duzenlemek', 'toparla', 'toparlamak'],
    steps: [
      'Tek bir köşe seç',
      'O köşeyi 10 dakikada bitir',
      'Kalanı için sıradaki adımı belirle',
    ],
  },
  {
    id: 'study',
    verbs: ['oku', 'okumak', 'ogren', 'ogrenmek', 'calis', 'calismak', 'incele', 'incelemek', 'arastir', 'arastirmak'],
    steps: [
      'Kaynağı aç',
      '25 dakika odaklanıp ilerle',
      'Aklında kalan üç şeyi not et',
    ],
  },
];

/** Başlığı kod noktası ve sözcük sınırında MAX_TOPIC_LENGTH'e kısaltır; üç nokta eklemez. */
export function shortTopic(title: string, max: number = MAX_TOPIC_LENGTH): string {
  const collapsed = title.trim().replace(/\s+/g, ' ');
  if (!collapsed || max <= 0) return '';

  const cps = Array.from(collapsed);
  if (cps.length <= max && collapsed.length <= max) return collapsed;

  let acc = '';
  let cpCount = 0;
  for (const cp of cps) {
    if (cpCount + 1 > max || acc.length + cp.length > max) break;
    acc += cp;
    cpCount += 1;
  }

  const nextCp = cps[cpCount];
  if (nextCp !== undefined && nextCp !== ' ') {
    const lastSpace = acc.lastIndexOf(' ');
    if (lastSpace > 0) {
      return acc.slice(0, lastSpace).trim();
    }
  }
  return acc.trim();
}

/** Başlığın SON sözcüğüne göre aile; eşleşme yoksa GENERIC_STEPS. */
export function deriveSplitSteps(title: string): readonly [string, string, string] {
  const cleaned = title.trim().replace(/[.,!?;:'"()[\]{}…]+$/g, '').trim();
  if (!cleaned) return GENERIC_STEPS;
  const parts = cleaned.split(/\s+/);
  const lastWord = foldTr(parts[parts.length - 1] ?? '');
  if (!lastWord) return GENERIC_STEPS;

  const matched = STEP_FAMILIES.find((fam) => fam.verbs.includes(lastWord));
  return matched ? matched.steps : GENERIC_STEPS;
}

/**
 * Builds today's deterministic subtask proposal for a parent task title and
 * duration preset. Returns `unknown` on purpose so every caller still passes
 * the output through `validateSubtaskProposal`.
 */
export function buildLocalSplitProposal(taskTitle: string, minutes: number): unknown {
  const steps = deriveSplitSteps(taskTitle);
  const topic = shortTopic(taskTitle);
  const blockMin = Number.isFinite(minutes) && minutes > 0 ? Math.round(minutes) : 25;

  return {
    subtasks: steps.map((step, i) => ({
      title: topic ? `${step} — ${topic}` : step,
      description:
        i === 0
          ? `2 dk · ilk adım · ${blockMin} dk blok (1/${steps.length})`
          : `${blockMin} dk blok (${i + 1}/${steps.length})`,
    })),
  };
}

// ---------------------------------------------------------------------------
// Assembly -- turning a VALIDATED proposal into a real insert payload
// ---------------------------------------------------------------------------

export type ParentTaskContext = Pick<Task, 'priority' | 'due_date' | 'project_id' | 'list_type'> & {
  id?: string | null;
};

export type SplitTaskInputLike = {
  title: string;
  description: string;
  status: 'pending';
  priority: Task['priority'];
  due_date: string | null;
  project_id: string | null;
  list_type: Task['list_type'];
  completed: boolean;
  parent_task_id: string | null;
  is_subtask: true;
};

export function toSplitTaskInputs(
  proposal: SubtaskDecompositionProposal,
  parent: ParentTaskContext,
): SplitTaskInputLike[] {
  return proposal.subtasks.map((s) => ({
    title: s.title,
    description: s.description ?? '',
    status: 'pending' as const,
    priority: parent.priority,
    due_date: parent.due_date ?? null,
    project_id: parent.project_id ?? null,
    list_type: parent.list_type,
    completed: false,
    parent_task_id: parent.id ?? null,
    is_subtask: true,
  }));
}
