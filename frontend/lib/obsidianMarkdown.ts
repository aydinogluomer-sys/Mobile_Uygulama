/**
 * F20 (GAP1-02, GAP1-06, GAP1-09, GAP1-16) — pure Obsidian Markdown builders.
 *
 * No React, no stores, no Date.now(): `today` and `nowIso` are passed in so
 * output is deterministic across timezones and unit tests.
 */
import { ymdFromIso } from './date';

export type ObsidianKind = 'daily' | 'all_habits' | 'notes_vault';

export type MdHabit = {
  id: string;
  name: string;
  life_area?: string | null;
  status?: string | null;
  streak_current?: number | null;
  current_streak?: number | null;
};

export type MdLog = { habit_id: string | null; state: string };

export type MdTask = {
  id: string;
  title: string;
  completed: boolean;
  completed_at?: string | null;
  due_date?: string | null;
};

export type MdJournal = { date: string; content: string; mood?: number | null };

export type MdNote = {
  id: string;
  title?: string | null;
  content: string;
  created_at?: string | null;
};

export const MD_PREVIEW_CHARS = 5000;
export const MD_MAX_PENDING_TASKS = 10;

/** `|` -> `\|`, newlines -> single space (for Markdown table cells). */
export function escapeMdCell(s: string): string {
  return s.replace(/\r?\n|\r/g, ' ').replace(/\|/g, '\\|');
}

/**
 * Escapes `\`, `*`, `_`, `` ` ``, `[`, `]`, `<`, `>` for user titles/names placed
 * inside bold or heading lines. Note and journal BODIES are never escaped.
 */
export function escapeMdInline(s: string): string {
  return s.replace(/([\\*_`[\]<>])/g, '\\$1');
}

function logRank(state: string): number {
  if (state === 'done') return 2;
  if (state === 'partial') return 1;
  return 0;
}

export function buildDailyNote(input: {
  today: string;
  habits: MdHabit[];
  todayLogs: MdLog[];
  tasks: MdTask[];
  tasksComplete: boolean;
  journal: MdJournal | null;
}): string {
  const { today, habits, todayLogs, tasks, tasksComplete, journal } = input;
  const stateByHabit = new Map<string, string>();
  for (const l of todayLogs) {
    if (!l.habit_id) continue;
    const prev = stateByHabit.get(l.habit_id);
    if (!prev || logRank(l.state) >= logRank(prev)) {
      stateByHabit.set(l.habit_id, l.state);
    }
  }

  let md = `---
type: aderyth-daily
date: ${today}
tags:
  - aderyth
  - daily-note
  - habits
---

# 📅 Aderyth Günlük Özeti — ${today}

## ⚡ Alışkanlıklar
`;

  for (const h of habits) {
    const st = stateByHabit.get(h.id);
    const mark = st === 'done' ? 'x' : st === 'partial' ? '/' : ' ';
    const streakCount = h.streak_current ?? h.current_streak ?? 0;
    const streakText = streakCount > 0 ? ` 🔥 ${streakCount} gün` : '';
    md += `- [${mark}] **${escapeMdInline(h.name)}**${streakText}\n`;
  }

  const doneTasks = tasks.filter((t) => t.completed && !!t.completed_at && ymdFromIso(t.completed_at) === today);
  const pendingAll = tasks.filter((t) => !t.completed && (!t.due_date || t.due_date <= today));
  const pendingShown = pendingAll.slice(0, MD_MAX_PENDING_TASKS);
  const extraPending = pendingAll.length - pendingShown.length;

  md += `\n## 🎯 Görevler\n`;
  if (doneTasks.length === 0 && pendingShown.length === 0) {
    md += `*Bugün için kayıtlı görev yok.*\n`;
  } else {
    for (const t of doneTasks) {
      md += `- [x] ${escapeMdInline(t.title)}\n`;
    }
    for (const t of pendingShown) {
      md += `- [ ] ${escapeMdInline(t.title)}${t.due_date ? ` ⏳ (Son: ${t.due_date})` : ''}\n`;
    }
    if (extraPending > 0) {
      md += `*+${extraPending} görev daha*\n`;
    }
  }
  if (!tasksComplete) {
    md += `*Not: görev listesi tam yüklenmedi; ilk görevler gösteriliyor.*\n`;
  }

  if (journal && journal.content.trim().length > 0) {
    md += `\n## ✍️ Günlük Yansıması\n`;
    if (journal.mood) md += `*Ruh Hali:* ${journal.mood}/5\n\n`;
    md += `${journal.content}\n`;
  }

  return md;
}

export function buildHabitsCatalog(input: { nowIso: string; habits: MdHabit[] }): string {
  const { nowIso, habits } = input;
  let md = `---
type: aderyth-habits-catalog
updated_at: ${nowIso}
tags:
  - aderyth
  - habits-vault
---

# 🏆 Alışkanlık Sistemi & Ritüeller

| Alışkanlık | Kategori | Durum | Seri |
|---|---|---|---|
`;
  for (const h of habits) {
    const streakCount = h.streak_current ?? h.current_streak ?? 0;
    md += `| ${escapeMdCell(h.name)} | ${escapeMdCell(h.life_area || 'Genel')} | ${escapeMdCell(h.status || 'active')} | ${streakCount} gün |\n`;
  }
  return md;
}

export function buildNotesVault(input: { today: string; notes: MdNote[]; complete: boolean }): string {
  const { today, notes, complete } = input;
  let md = `---
type: aderyth-notes-export
date: ${today}
tags:
  - aderyth
  - personal-knowledge
---

# 📚 Aderyth Bilgi Kütüphanesi & Notlar

`;
  if (!complete) {
    md += `*Not: bazı notlar yüklenemedi; bu dosya eksik.*\n\n`;
  }
  for (const n of notes) {
    md += `## 📝 ${escapeMdInline(n.title || 'İsimsiz Not')}\n`;
    md += `*Oluşturulma: ${n.created_at ? n.created_at.slice(0, 10) : today}*\n\n`;
    md += `${n.content}\n\n---\n\n`;
  }
  return md;
}

export function isMarkdownEmpty(kind: ObsidianKind, input: { habits: MdHabit[]; notes: MdNote[] }): boolean {
  if (kind === 'notes_vault') return input.notes.length === 0;
  if (kind === 'all_habits') return input.habits.length === 0;
  return false;
}

/** Kinds carrying free-text journal/note bodies require warning + second-tap confirmation. */
export function containsPersonalText(
  kind: ObsidianKind,
  input: { journal: MdJournal | null; notes: MdNote[] },
): boolean {
  if (kind === 'all_habits') return false;
  if (kind === 'daily') return Boolean(input.journal && input.journal.content.trim().length > 0);
  return input.notes.some((n) => Boolean(n.content && n.content.trim().length > 0));
}

export function previewOf(markdown: string, max = MD_PREVIEW_CHARS): { text: string; hiddenChars: number } {
  if (markdown.length <= max) return { text: markdown, hiddenChars: 0 };
  return { text: markdown.slice(0, max), hiddenChars: markdown.length - max };
}
