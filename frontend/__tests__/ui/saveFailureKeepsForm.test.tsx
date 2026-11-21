import React from 'react';
import { Alert, Modal, TextInput, TouchableOpacity } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import { todayLocal } from '../../lib/date';

jest.setTimeout(30_000);
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: ({ children }: { children: React.ReactNode }) => children }));
jest.mock('../../lib/supabase', () => ({ supabase: {} }));
jest.mock('../../lib/session', () => ({ currentUser: jest.fn(async () => ({ id: 'u1', email: null })) }));

const mockNoteState = {
  notes: [] as { id: string; user_id: string; title: string; content: string; tags: string[]; created_at: string; updated_at: string }[],
  loading: false,
  loadingMore: false,
  hasMore: false,
  error: null as string | null,
  fetchNotes: jest.fn(async () => undefined),
  loadMore: jest.fn(async () => undefined),
  addNote: jest.fn(),
  updateNote: jest.fn(),
  removeNote: jest.fn(),
  search: jest.fn(async () => []),
  conflicts: () => [],
  resolveConflict: jest.fn(),
};

jest.mock('../../store/noteStore', () => {
  const useNoteStore: unknown = (sel?: (s: typeof mockNoteState) => unknown) =>
    sel ? sel(mockNoteState) : mockNoteState;
  (useNoteStore as { getState: () => typeof mockNoteState }).getState = () => mockNoteState;
  return { useNoteStore };
});

const mockProjectState = {
  projects: [] as { id: string; user_id: string; name: string; color: string; description: string | null; status: 'active'; created_at: string }[],
  hasMore: false,
  loadingMore: false,
  error: null as string | null,
  loadMore: jest.fn(),
  fetchProjects: jest.fn(async () => undefined),
  addProject: jest.fn(),
  removeProject: jest.fn(),
};

jest.mock('../../store/projectStore', () => {
  const useProjectStore: unknown = (sel?: (s: typeof mockProjectState) => unknown) =>
    sel ? sel(mockProjectState) : mockProjectState;
  (useProjectStore as { getState: () => typeof mockProjectState }).getState = () => mockProjectState;
  return { useProjectStore };
});

jest.mock('../../store/taskStore', () => {
  const st = { tasks: [], fetchTasks: jest.fn(async () => undefined), toggleDone: jest.fn(), addTask: jest.fn() };
  const useTaskStore: unknown = (sel?: (s: typeof st) => unknown) => (sel ? sel(st) : st);
  (useTaskStore as { getState: () => typeof st }).getState = () => st;
  return { useTaskStore };
});

const emptyTab = () => ({ items: [] as unknown[], cursor: null, hasMore: false, loading: false, loadingMore: false });
const mockReadingState = {
  tabs: { want_to_read: emptyTab(), reading: emptyTab(), completed: emptyTab() },
  counts: { want_to_read: 0, reading: 0, completed: 0 },
  error: null as string | null,
  fetchItems: jest.fn(async () => undefined),
  loadMore: jest.fn(async () => undefined),
  addItem: jest.fn(),
  updateStatus: jest.fn(),
  updateRating: jest.fn(),
  removeItem: jest.fn(),
};

jest.mock('../../store/readingListStore', () => {
  const useReadingListStore: unknown = (sel?: (s: typeof mockReadingState) => unknown) =>
    sel ? sel(mockReadingState) : mockReadingState;
  (useReadingListStore as { getState: () => typeof mockReadingState }).getState = () => mockReadingState;
  return { useReadingListStore };
});

const mockDeepWorkState = {
  sessions: [] as { id: string; user_id: string; subject: string; duration_minutes: number; date: string; created_at: string }[],
  loading: false,
  error: null as string | null,
  loadSessions: jest.fn(async () => undefined),
  addSession: jest.fn(),
  removeSession: jest.fn(),
  todayMinutes: () => 0,
  weekMinutes: () => 0,
};

jest.mock('../../store/deepWorkStore', () => {
  const useDeepWorkStore: unknown = (sel?: (s: typeof mockDeepWorkState) => unknown) =>
    sel ? sel(mockDeepWorkState) : mockDeepWorkState;
  (useDeepWorkStore as { getState: () => typeof mockDeepWorkState }).getState = () => mockDeepWorkState;
  return { useDeepWorkStore };
});

import NotesScreen from '../../app/screens/notes';
import ProjectsScreen from '../../app/screens/projects';
import ReadingListScreen from '../../app/screens/reading-list';
import DeepWorkScreen from '../../app/screens/deep-work';

function textOf(r: TestRenderer.ReactTestRenderer): string {
  const out: string[] = [];
  const walk = (n: unknown) => {
    if (n == null) return;
    if (typeof n === 'string') {
      out.push(n);
      return;
    }
    if (Array.isArray(n)) {
      n.forEach(walk);
      return;
    }
    walk((n as { children?: unknown }).children);
  };
  walk(r.toJSON());
  return out.join(' ');
}

describe('saveFailureKeepsForm — GAP1-07 & GAP1-08', () => {
  const mounted: TestRenderer.ReactTestRenderer[] = [];

  beforeEach(() => {
    jest.clearAllMocks();
    mockNoteState.notes = [];
    mockNoteState.error = null;
    mockProjectState.projects = [];
    mockProjectState.error = null;
    mockReadingState.tabs = { want_to_read: emptyTab(), reading: emptyTab(), completed: emptyTab() };
    mockReadingState.error = null;
    mockDeepWorkState.sessions = [];
    mockDeepWorkState.error = null;
  });

  afterEach(async () => {
    await act(async () => {
      while (mounted.length > 0) mounted.pop()!.unmount();
    });
  });

  async function render(el: React.ReactElement) {
    let r!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      r = TestRenderer.create(el);
    });
    mounted.push(r);
    return r;
  }

  it('NotesScreen keeps sheet open and text intact on addNote failure, then closes on retry; surfaces removeNote failure', async () => {
    const existingNote = {
      id: 'n1',
      user_id: 'u1',
      title: 'Mevcut Not',
      content: 'İçerik',
      tags: [],
      created_at: '2026-11-21T10:00:00Z',
      updated_at: '2026-11-21T10:00:00Z',
    };
    mockNoteState.notes = [existingNote];

    const r = await render(<NotesScreen />);

    // Open "Yeni not"
    const fab = r.root.findAllByType(TouchableOpacity).find((b) => b.props.accessibilityLabel === 'Yeni not')!;
    await act(async () => {
      fab.props.onPress();
    });

    const titleInput = r.root.findAllByType(TextInput).find((i) => i.props.placeholder === 'Başlık...')!;
    const bodyInput = r.root.findAllByType(TextInput).find((i) => i.props.placeholder === 'Notunu yaz...')!;
    await act(async () => {
      titleInput.props.onChangeText('Uzun Başlık');
      bodyInput.props.onChangeText('Kaybolmaması gereken uzun paragraf');
    });

    mockNoteState.addNote.mockImplementationOnce(async () => {
      mockNoteState.error = 'Ağ hatası: not yazılamadı';
      return null;
    });

    const saveBtn = r.root.findAllByType(TouchableOpacity).find((b) => b.props.accessibilityLabel === 'Kaydet')!;
    await act(async () => {
      await saveBtn.props.onPress();
    });

    // Sheet remains open, text intact, FormError shown
    const modal = r.root.findByType(Modal);
    expect(modal.props.visible).toBe(true);
    expect(bodyInput.props.value).toBe('Kaybolmaması gereken uzun paragraf');
    expect(textOf(r)).toContain('Ağ hatası: not yazılamadı');

    // Negative / recovery: next attempt succeeds -> sheet closes, FormError gone
    mockNoteState.addNote.mockImplementationOnce(async () => {
      mockNoteState.error = null;
      return { ...existingNote, id: 'n2', title: 'Uzun Başlık' };
    });
    await act(async () => {
      await saveBtn.props.onPress();
    });
    expect(r.root.findByType(Modal).props.visible).toBe(false);
    expect(textOf(r)).not.toContain('Ağ hatası: not yazılamadı');

    // Delete failure surfaces FormError in list header
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_title, _msg, buttons) => {
      const del = buttons?.find((b) => b.text === 'Sil');
      void del?.onPress?.();
    });
    mockNoteState.removeNote.mockImplementationOnce(async () => {
      mockNoteState.error = 'Not sunucudan silinemedi';
      return false;
    });

    const noteCard = r.root.findAllByType(TouchableOpacity).find((b) => b.props.accessibilityLabel === 'Mevcut Not')!;
    await act(async () => {
      noteCard.props.onLongPress();
      await Promise.resolve();
    });
    expect(textOf(r)).toContain('Not sunucudan silinemedi');
    alertSpy.mockRestore();
  });

  it('ProjectsScreen keeps sheet open on addProject failure and uses honest "Projeyi Arşivle" copy on long-press', async () => {
    mockProjectState.projects = [
      { id: 'p1', user_id: 'u1', name: 'Atlas Projesi', color: '#D97757', description: null, status: 'active', created_at: 'now' },
    ];
    const r = await render(<ProjectsScreen />);

    // Honest archive dialog
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const row = r.root.findAllByType(TouchableOpacity).find((b) => String(b.props.accessibilityLabel ?? '').startsWith('Atlas Projesi'))!;
    await act(async () => {
      row.props.onLongPress();
    });
    expect(alertSpy).toHaveBeenCalledWith(
      'Projeyi Arşivle',
      expect.stringContaining('arşivlensin mi'),
      expect.arrayContaining([expect.objectContaining({ text: 'Arşivle' })]),
    );
    alertSpy.mockRestore();

    // Failed addProject keeps sheet open + typed name
    const fab = r.root.findAllByType(TouchableOpacity).find((b) => b.props.accessibilityLabel === 'Yeni proje ekle')!;
    await act(async () => {
      fab.props.onPress();
    });

    const nameInput = r.root.findAllByType(TextInput).find((i) => i.props.placeholder === 'Proje adı...')!;
    await act(async () => {
      nameInput.props.onChangeText('Yeni Mimari');
    });

    mockProjectState.addProject.mockImplementationOnce(async () => {
      mockProjectState.error = 'Proje kaydı reddedildi';
      return null;
    });

    const createBtn = r.root.findAllByType(TouchableOpacity).find((b) => b.props.accessibilityLabel === 'Projeyi oluştur')!;
    await act(async () => {
      await createBtn.props.onPress();
    });

    const addModal = r.root.findAllByType(Modal)[0];
    expect(addModal.props.visible).toBe(true);
    expect(nameInput.props.value).toBe('Yeni Mimari');
    expect(textOf(r)).toContain('Proje kaydı reddedildi');

    mockProjectState.addProject.mockImplementationOnce(async () => {
      mockProjectState.error = null;
      return { id: 'p2', user_id: 'u1', name: 'Yeni Mimari', color: '#D97757', description: null, status: 'active' as const, created_at: 'now' };
    });
    await act(async () => {
      await createBtn.props.onPress();
    });
    expect(r.root.findAllByType(Modal)[0].props.visible).toBe(false);
  });

  it('ReadingListScreen keeps sheet open and typed title when addItem returns false', async () => {
    const r = await render(<ReadingListScreen />);

    const fab = r.root.findAllByType(TouchableOpacity).find((b) => b.props.accessibilityLabel === 'Okuma listesine yeni kayıt ekle')!;
    await act(async () => {
      fab.props.onPress();
    });

    const titleInput = r.root.findAllByType(TextInput).find((i) => i.props.placeholder === 'Başlık *')!;
    await act(async () => {
      titleInput.props.onChangeText('Atomik Alışkanlıklar');
    });

    mockReadingState.addItem.mockImplementationOnce(async () => {
      mockReadingState.error = 'Okuma kaydı başarısız';
      return false;
    });

    const addBtn = r.root
      .findByType(Modal)
      .findAllByType(TouchableOpacity)
      .find((b) => b.props.accessibilityLabel === 'Listeye ekle')!;
    await act(async () => {
      await addBtn.props.onPress();
    });

    expect(r.root.findByType(Modal).props.visible).toBe(true);
    expect(titleInput.props.value).toBe('Atomik Alışkanlıklar');
    expect(textOf(r)).toContain('Okuma kaydı başarısız');
  });

  it('DeepWorkScreen renders LoadErrorState when error && sessions is empty, and hides it when sessions exist (data > error)', async () => {
    mockDeepWorkState.error = 'Bağlantı koptu';
    mockDeepWorkState.sessions = [];
    const rEmptyErr = await render(<DeepWorkScreen />);
    expect(textOf(rEmptyErr)).toContain('Seanslar yüklenemedi');
    expect(textOf(rEmptyErr)).not.toContain('Henüz seans yok');

    mockDeepWorkState.sessions = [
      { id: 's1', user_id: 'u1', subject: 'Algoritma', duration_minutes: 45, date: todayLocal(), created_at: 'now' },
    ];
    const rWithData = await render(<DeepWorkScreen />);
    expect(textOf(rWithData)).not.toContain('Seanslar yüklenemedi');
    expect(textOf(rWithData)).toContain('Algoritma');
  });
});
