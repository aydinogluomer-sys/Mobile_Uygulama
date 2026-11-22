import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  NOTE_COUNTER_FROM,
  NOTE_MAX_LENGTH,
  markNoteHintSeen,
  normalizeNote,
  noteHintKey,
  previewNote,
  readNoteHintSeen,
} from '../../lib/habitNote';

const mockStore = new Map<string, string>();

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async (k: string) => mockStore.get(k) ?? null),
  setItem: jest.fn(async (k: string, v: string) => {
    mockStore.set(k, v);
  }),
}));

beforeEach(() => {
  mockStore.clear();
  jest.clearAllMocks();
});

describe('lib/habitNote (F31 — PS-03 private single-line habit note)', () => {
  it('(+) constants match spec (280 code points max, counter from 240)', () => {
    expect(NOTE_MAX_LENGTH).toBe(280);
    expect(NOTE_COUNTER_FROM).toBe(240);
  });

  it('(+) normalizeNote preserves undefined (do not touch) and turns null/blank into null (delete)', () => {
    expect(normalizeNote(undefined)).toBeUndefined();
    expect(normalizeNote(null)).toBeNull();
    expect(normalizeNote('')).toBeNull();
    expect(normalizeNote('   \n\t  ')).toBeNull();
  });

  it('(+) normalizeNote trims, converts newlines/tabs to single spaces, and applies NFC', () => {
    expect(normalizeNote('  yorgundum  ')).toBe('yorgundum');
    expect(normalizeNote('ilk satır\nikinci satır\r\nüçüncü\tsatır')).toBe(
      'ilk satır ikinci satır üçüncü satır',
    );
    // NFD 'i\u0307' / 's\u0327' -> NFC
    const decomposed = 'c\u0327ok mes\u0327guldu\u0308m';
    const out = normalizeNote(decomposed);
    expect(out).toBe('çok meşguldüm');
    expect(out).toBe(out?.normalize('NFC'));
  });

  it('(+) normalizeNote caps at 280 Unicode code points without splitting surrogate pairs', () => {
    const emoji = '🙂'; // 2 UTF-16 code units, 1 code point
    expect(emoji.length).toBe(2);
    const input = 'a'.repeat(279) + emoji + 'fazla';
    const out = normalizeNote(input)!;
    expect(Array.from(out)).toHaveLength(280);
    expect(out.endsWith(emoji)).toBe(true);
    // Ensure no lone surrogates exist
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(out)).toBe(
      false,
    );
  });

  it('(-) strips Unicode control characters and drops code point 281+', () => {
    expect(normalizeNote('mer\u0000ha\u0007ba\u200B')).toBe('merhaba');
    expect(normalizeNote('\u0000\u0001\u001F')).toBeNull();

    const exact281 = 'k'.repeat(280) + 'Z';
    const capped = normalizeNote(exact281)!;
    expect(capped).toHaveLength(280);
    expect(capped.includes('Z')).toBe(false);
  });

  it('(+) previewNote produces a clean single-line preview within max code points', () => {
    expect(previewNote(null)).toBe('');
    expect(previewNote(undefined)).toBe('');
    expect(previewNote('   ')).toBe('');
    expect(previewNote('kısa\nnot', 20)).toBe('kısa not');

    const long = 'b'.repeat(80);
    const prev = previewNote(long, 60);
    expect(Array.from(prev).length).toBeLessThanOrEqual(60);
    expect(prev.endsWith('…')).toBe(true);
  });

  it('(+) hint seen flag is scoped per userId in AsyncStorage', async () => {
    expect(noteHintKey('u-1')).toBe('habitNote.hint.v1.u-1');
    expect(noteHintKey('u-1')).not.toBe(noteHintKey('u-2'));

    expect(await readNoteHintSeen('u-1')).toBe(false);
    await markNoteHintSeen('u-1');
    expect(await readNoteHintSeen('u-1')).toBe(true);
    expect(await readNoteHintSeen('u-2')).toBe(false);
    expect(AsyncStorage.setItem).toHaveBeenCalledWith('habitNote.hint.v1.u-1', '1');
  });
});
