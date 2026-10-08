/**
 * R02.03 / R02.05 through the REAL note and journal stores and the REAL core
 * outbox: offline writes are kept and shown, and a conflicting edit of the
 * same note / the same day keeps both versions until the user chooses
 * (T08: "aynı notta çatışan sürümü koru").
 */
/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports; require is the only way in */
jest.mock('../../lib/session', () => require('../helpers/fakeCoreServer').session);
jest.mock('../../repositories/noteRepository', () => require('../helpers/fakeCoreServer').noteRepo);
jest.mock('../../repositories/journalRepository', () => require('../helpers/fakeCoreServer').journalRepo);
jest.mock('../../lib/supabase', () => ({ supabase: { from: jest.fn(), auth: { getUser: jest.fn(), getSession: jest.fn() } } }));
/* eslint-enable @typescript-eslint/no-require-imports */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { server, stamp } from '../helpers/fakeCoreServer';
import { coreOutbox } from '../../services/coreOutbox';
import { useNoteStore } from '../../store/noteStore';
import { useJournalStore } from '../../store/journalStore';

beforeEach(async () => {
  server.reset();
  coreOutbox.reset();
  await AsyncStorage.clear();
  useNoteStore.setState({ notes: [], error: null });
  useJournalStore.setState({ entries: [] });
});

describe('notes', () => {
  it('offline: a new note is shown at once, kept on the device, and delivered later with the same id', async () => {
    server.online = false;
    const n = await useNoteStore.getState().addNote('Uçakta', 'bulutlar');
    expect(n).not.toBeNull();
    expect(useNoteStore.getState().notes.map((x) => x.title)).toEqual(['Uçakta']);
    expect(server.notes.size).toBe(0);
    server.online = true;
    await coreOutbox.flush();
    expect(server.notes.get(n!.id)?.content).toBe('bulutlar');
  });

  it('a refetch while a change is unsent still shows the change', async () => {
    const n = (await useNoteStore.getState().addNote('A', 'a'))!;
    server.online = false;
    await useNoteStore.getState().updateNote(n.id, { content: 'yerel' });
    server.online = true;
    // stop delivery for the refetch: the command is still in the outbox
    const box = coreOutbox.state()!;
    expect(box.commands).toHaveLength(1);
    await useNoteStore.getState().fetchNotes();
    expect(useNoteStore.getState().notes.find((x) => x.id === n.id)?.content).toBe('yerel');
  });

  async function conflictingNote() {
    const n = (await useNoteStore.getState().addNote('Plan', 'v1'))!;
    await useNoteStore.getState().fetchNotes(); // learn the server version
    server.notes.set(n.id, { ...server.notes.get(n.id)!, content: 'öteki cihaz', updated_at: stamp() });
    await useNoteStore.getState().updateNote(n.id, { content: 'bu cihaz' });
    return n;
  }

  it('T08: an edit over a note changed elsewhere is held as a conflict -- the server note is not overwritten', async () => {
    const n = await conflictingNote();
    expect(server.notes.get(n.id)!.content).toBe('öteki cihaz');
    expect(useNoteStore.getState().conflicts().map((c) => c.entityId)).toEqual([n.id]);
  });

  it('T08 "both": the other note stays, and this device\'s text becomes a "(çakışan sürüm)" note', async () => {
    const n = await conflictingNote();
    expect(await useNoteStore.getState().resolveConflict(n.id, 'both')).toBe(true);
    const all = [...server.notes.values()];
    expect(all.find((x) => x.id === n.id)!.content).toBe('öteki cihaz');
    const copy = all.find((x) => x.id !== n.id)!;
    expect(copy).toMatchObject({ title: 'Plan (çakışan sürüm)', content: 'bu cihaz' });
    expect(useNoteStore.getState().conflicts()).toEqual([]);
  });

  it('T08 "mine" writes this device\'s text; "theirs" drops it', async () => {
    const a = await conflictingNote();
    await useNoteStore.getState().resolveConflict(a.id, 'mine');
    expect(server.notes.get(a.id)!.content).toBe('bu cihaz');
    const b = await conflictingNote();
    const before = server.notes.size;
    await useNoteStore.getState().resolveConflict(b.id, 'theirs');
    expect(server.notes.get(b.id)!.content).toBe('öteki cihaz');
    expect(server.notes.size).toBe(before); // "theirs" makes no copy
    expect(useNoteStore.getState().conflicts()).toEqual([]);
  });

  it('a second edit after a delivered one is NOT a conflict with itself', async () => {
    const n = (await useNoteStore.getState().addNote('S', '1'))!;
    await useNoteStore.getState().updateNote(n.id, { content: '2' });
    await useNoteStore.getState().updateNote(n.id, { content: '3' });
    expect(server.notes.get(n.id)!.content).toBe('3');
    expect(useNoteStore.getState().conflicts()).toEqual([]);
  });
});

describe('journal', () => {
  it('offline: the day is saved on the device, shown, and delivered later', async () => {
    server.online = false;
    expect(await useJournalStore.getState().saveEntry('2026-10-08', 'çevrimdışı', 4)).toEqual({ ok: true });
    expect(useJournalStore.getState().getByDate('2026-10-08')?.content).toBe('çevrimdışı');
    server.online = true;
    await coreOutbox.flush();
    expect(server.journal.get('2026-10-08')).toEqual({ content: 'çevrimdışı', mood: 4 });
  });

  it('a second save of the same day after delivery is not a conflict with itself', async () => {
    await useJournalStore.getState().saveEntry('2026-10-05', 'bir', 3);
    await useJournalStore.getState().saveEntry('2026-10-05', 'bir iki', 3);
    expect(server.journal.get('2026-10-05')!.content).toBe('bir iki');
    expect(useJournalStore.getState().conflicts()).toEqual([]);
  });

  it('T08 "both": a day written on two devices keeps both texts', async () => {
    await useJournalStore.getState().fetchEntries();
    server.journal.set('2026-10-04', { content: 'telefon', mood: 2 });
    await useJournalStore.getState().saveEntry('2026-10-04', 'tablet', 2);
    expect(server.journal.get('2026-10-04')!.content).toBe('telefon');
    expect(useJournalStore.getState().conflicts().map((c) => c.entityId)).toEqual(['2026-10-04']);
    expect(await useJournalStore.getState().resolveConflict('2026-10-04', 'both')).toBe(true);
    const text = server.journal.get('2026-10-04')!.content;
    expect(text).toContain('telefon');
    expect(text).toContain('tablet');
    expect(text.indexOf('telefon')).toBeLessThan(text.indexOf('tablet'));
  });

  it('appendEntry offline appends to what this device holds instead of dropping the text', async () => {
    await useJournalStore.getState().saveEntry('2026-10-03', 'ilk', 3);
    server.online = false;
    await useJournalStore.getState().appendEntry('2026-10-03', 'koçtan not');
    expect(useJournalStore.getState().getByDate('2026-10-03')?.content).toBe('ilk\n\nkoçtan not');
    server.online = true;
    await coreOutbox.flush();
    expect(server.journal.get('2026-10-03')!.content).toBe('ilk\n\nkoçtan not');
  });
});
