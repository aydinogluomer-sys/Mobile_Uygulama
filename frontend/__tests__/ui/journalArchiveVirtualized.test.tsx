import { readFileSync } from 'fs';
import { join } from 'path';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { stripComments } from '../helpers/sourceText';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}));
const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
  useLocalSearchParams: () => ({}),
}));
jest.mock('../../lib/supabase', () => ({ supabase: {} }));
jest.mock('../../components/MoodHabitCard', () => () => null);
jest.mock('../../lib/date', () => ({
  ...jest.requireActual('../../lib/date'),
  todayLocal: () => '2026-12-31',
}));

import { addDaysLocal, ymd } from '../../lib/date';
import { computeJournalStats } from '../../lib/journalStats';
import type { JournalEntry } from '../../store/journalStore';

function build365Entries(): JournalEntry[] {
  const start = new Date(2026, 11, 31); // 2026-12-31 backwards 365 days -> 2026-01-01
  return Array.from({ length: 365 }, (_, idx) => {
    const date = ymd(addDaysLocal(start, -idx));
    const special =
      idx === 300
        ? 'DERİN ARŞİV BULGUSU #nadirEtiket'
        : `Günlük notu sıra-${idx} #genel`;
    return {
      id: `j-${idx}`,
      user_id: 'u1',
      date,
      content: `${special} ${'uzun-metin-'.repeat(30)}`,
      mood: ((idx % 5) + 1),
      ai_summary: idx % 10 === 0,
      created_at: `${date}T20:00:00Z`,
    };
  });
}

const mockAllEntries = build365Entries();
let mockTruncated = true;

jest.mock('../../store/journalStore', () => {
  const fetchEntries = jest.fn(async () => undefined);
  const state = () => ({ entries: mockAllEntries, fetchEntries, truncated: mockTruncated });
  const useJournalStore: any = (sel?: any) => (sel ? sel(state()) : state());
  useJournalStore.getState = state;
  return { useJournalStore };
});

import JournalArchiveScreen from '../../app/screens/journal-archive';
import ArchiveRow from '../../components/journal/ArchiveRow';
import { ARCHIVE_PREVIEW_CHARS, previewOf, sourceLabelOf, toArchiveRowModel } from '../../lib/archiveRow';

const ROOT = join(__dirname, '..', '..');

function textOf(r: TestRenderer.ReactTestRenderer): string {
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

const countMountedArchiveRows = (r: TestRenderer.ReactTestRenderer): number =>
  r.root.findAll((n) => typeof n.type === 'string' && n.props?.testID === 'archive-row').length;

describe('journal-archive virtualization & ArchiveRow privacy contract (PRF-20)', () => {
  const mounted: TestRenderer.ReactTestRenderer[] = [];

  beforeEach(() => {
    mockTruncated = true;
    mockPush.mockClear();
  });

  afterEach(async () => {
    while (mounted.length > 0) {
      const inst = mounted.pop()!;
      await act(async () => {
        inst.unmount();
      });
    }
  });

  it('(+) ArchiveRow is a React.memo component and 365 entries mount <= 12 ArchiveRow instances initially', async () => {
    expect((ArchiveRow as unknown as { $$typeof?: symbol }).$$typeof).toBe(
      Symbol.for('react.memo'),
    );

    let r!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      r = TestRenderer.create(<JournalArchiveScreen />);
    });
    mounted.push(r);

    const mountedCount = countMountedArchiveRows(r);
    expect(mountedCount).toBeGreaterThan(0);
    expect(mountedCount).toBeLessThanOrEqual(12);

    // Stats still count all 365 entries, and truncated note is shown
    expect(computeJournalStats(mockAllEntries).total).toBe(365);
    expect(textOf(r)).toContain('365');
    expect(textOf(r)).toContain('Son 365 kayıt gösteriliyor.');
  });

  it('(+) search and tag filter find the 300th (off-window) entry, and typing preserves the exact TextInput instance', async () => {
    let r!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      r = TestRenderer.create(<JournalArchiveScreen />);
    });
    mounted.push(r);

    const inputBefore = r.root.findAll(
      (n) => n.props?.accessibilityLabel === 'Günlükte ara' && typeof n.props.onChangeText === 'function',
    )[0];
    expect(inputBefore).toBeDefined();

    // 300th entry is off-window before search
    expect(textOf(r)).not.toContain('DERİN ARŞİV BULGUSU');

    // Typing query finds the 300th entry and keeps the exact same TextInput fiber node (no focus loss!)
    await act(async () => {
      inputBefore.props.onChangeText('DERİN ARŞİV');
    });
    const inputAfter = r.root.findAll(
      (n) => n.props?.accessibilityLabel === 'Günlükte ara' && typeof n.props.onChangeText === 'function',
    )[0];
    expect(inputAfter).toBe(inputBefore);
    expect(textOf(r)).toContain('DERİN ARŞİV BULGUSU');

    // Clear query and filter by #nadiretiket tag
    await act(async () => {
      inputAfter.props.onChangeText('');
    });
    const rareTagBtn = r.root.findAll(
      (n) => n.props?.accessibilityLabel === '#nadiretiket etiketli 1 kayıt' && typeof n.props.onPress === 'function',
    )[0];
    expect(rareTagBtn).toBeDefined();
    await act(async () => {
      rareTagBtn.props.onPress();
    });
    expect(textOf(r)).toContain('DERİN ARŞİV BULGUSU');
    expect(countMountedArchiveRows(r)).toBe(1);
  });

  it('(-) ArchiveRowModel omits content, previewOf caps at <= 240 code points without ellipsis, calendar hides empty list state, and ScrollView body / inline ListHeaderComponent arrow are gone', async () => {
    const longEmojiText = `[Haftalık Rapor]\n${'🌿'.repeat(260)}`;
    expect(sourceLabelOf(longEmojiText)).toBe('Haftalık Rapor');
    const prev = previewOf(longEmojiText);
    expect(Array.from(prev).length).toBe(ARCHIVE_PREVIEW_CHARS);
    expect(prev.endsWith('…')).toBe(false);
    expect(prev.endsWith('...')).toBe(false);
    expect(prev).not.toContain('\n');
    expect(prev.startsWith('[Haftalık Rapor] ')).toBe(true);

    const row = toArchiveRowModel(mockAllEntries[0]);
    expect('content' in row).toBe(false);
    expect(Array.from(row.preview).length).toBeLessThanOrEqual(240);

    // Calendar view hides list rows and list empty state
    let r!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      r = TestRenderer.create(<JournalArchiveScreen />);
    });
    mounted.push(r);
    const input = r.root.findAll(
      (n) => n.props?.accessibilityLabel === 'Günlükte ara' && typeof n.props.onChangeText === 'function',
    )[0];
    await act(async () => {
      input.props.onChangeText('eşleşmeyen-sorgu-xyz');
    });
    expect(textOf(r)).toContain('Bu aramayla kayıt yok');

    const calBtn = r.root.findAll(
      (n) => n.props?.accessibilityLabel === 'Takvim' && typeof n.props.onPress === 'function',
    )[0];
    await act(async () => {
      calBtn.props.onPress();
    });
    expect(textOf(r)).not.toContain('Bu aramayla kayıt yok');
    expect(countMountedArchiveRows(r)).toBe(0);

    // Source scan invariants
    const archiveSrc = stripComments(
      readFileSync(join(ROOT, 'app', 'screens', 'journal-archive.tsx'), 'utf8'),
    );
    expect(archiveSrc).toContain('<SectionList');
    expect(archiveSrc).not.toMatch(/ListHeaderComponent=\{\s*\(\s*\)\s*=>/);
    expect(archiveSrc).not.toMatch(/<ScrollView(?!\s+horizontal)/);
  });
});
