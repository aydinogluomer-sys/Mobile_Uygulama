const mockUser: { id: string | null } = { id: 'u1' };

jest.mock('../../lib/session', () => ({
  currentUser: jest.fn(async () => (mockUser.id ? { id: mockUser.id, email: null } : null)),
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import { todayLocal } from '../../lib/date';
import { lowEnergySuggested, makeCheckin } from '../../lib/moods';
import { moodKey, useMoodStore } from '../../store/moodStore';

describe('F37 — store/moodStore energy axis', () => {
  beforeEach(async () => {
    mockUser.id = 'u1';
    await AsyncStorage.clear();
    useMoodStore.setState({ userId: null, definitions: [], checkins: [] });
  });

  it('(+) setCheckinEnergy writes low/high to moods.v1.u1, removes key on null, and returns false on unknown id', async () => {
    await useMoodStore.getState().hydrate();
    expect(useMoodStore.getState().checkIn('builtin-2', 2)).toBe(true);
    const first = useMoodStore.getState().checkins[0];
    expect(first).toBeDefined();
    expect('energy' in first).toBe(false);

    expect(useMoodStore.getState().setCheckinEnergy(first.id, 'low')).toBe(true);
    expect(useMoodStore.getState().checkins[0].energy).toBe('low');

    const savedLow = JSON.parse((await AsyncStorage.getItem(moodKey('u1'))) ?? '{}');
    expect(savedLow.v).toBe(1);
    expect(savedLow.checkins[0].energy).toBe('low');

    // null removes the energy property completely
    expect(useMoodStore.getState().setCheckinEnergy(first.id, null)).toBe(true);
    expect('energy' in useMoodStore.getState().checkins[0]).toBe(false);

    // unknown id -> false and state untouched
    const before = useMoodStore.getState().checkins;
    expect(useMoodStore.getState().setCheckinEnergy('non-existent', 'high')).toBe(false);
    expect(useMoodStore.getState().checkins).toBe(before);
  });

  it('(+) hydrate loads legacy v1 blobs without energy, strips invalid energy values, and keeps valid ones', async () => {
    const rawBlob = {
      v: 1,
      definitions: [
        { id: 'd-legacy', name: 'Dingin', icon: '🌿', valence: 4, builtIn: false, archived: false },
        { id: 'd-bad', name: 'Karışık', icon: '🌀', valence: 3, energy: 'medium', builtIn: false, archived: false },
        { id: 'd-good', name: 'Canlı', icon: '⚡', valence: 5, energy: 'high', builtIn: false, archived: false },
      ],
      checkins: [
        { id: 'c-legacy', at: '2026-10-10T08:00:00.000Z', day: '2026-10-10', moodId: 'builtin-3', label: 'Orta', valence: 3, intensity: 2 },
        { id: 'c-bad1', at: '2026-10-10T09:00:00.000Z', day: '2026-10-10', moodId: 'builtin-2', label: 'Yorgun', valence: 2, intensity: 2, energy: 'medium' },
        { id: 'c-bad2', at: '2026-10-10T09:30:00.000Z', day: '2026-10-10', moodId: 'builtin-2', label: 'Yorgun', valence: 2, intensity: 2, energy: 5 },
        { id: 'c-bad3', at: '2026-10-10T09:45:00.000Z', day: '2026-10-10', moodId: 'builtin-2', label: 'Yorgun', valence: 2, intensity: 2, energy: {} },
        { id: 'c-good', at: '2026-10-10T10:00:00.000Z', day: '2026-10-10', moodId: 'builtin-5', label: 'Harika', valence: 5, intensity: 3, energy: 'high' },
      ],
    };
    await AsyncStorage.setItem(moodKey('u1'), JSON.stringify(rawBlob));

    await useMoodStore.getState().hydrate();
    const { definitions, checkins } = useMoodStore.getState();

    expect('energy' in definitions.find((d) => d.id === 'd-legacy')!).toBe(false);
    expect('energy' in definitions.find((d) => d.id === 'd-bad')!).toBe(false);
    expect(definitions.find((d) => d.id === 'd-good')?.energy).toBe('high');

    expect('energy' in checkins.find((c) => c.id === 'c-legacy')!).toBe(false);
    expect('energy' in checkins.find((c) => c.id === 'c-bad1')!).toBe(false);
    expect('energy' in checkins.find((c) => c.id === 'c-bad2')!).toBe(false);
    expect('energy' in checkins.find((c) => c.id === 'c-bad3')!).toBe(false);
    expect(checkins.find((c) => c.id === 'c-good')?.energy).toBe('high');
  });

  it('(+) custom mood energy is snapshotted at check-in; updating definition later preserves past check-in energy', async () => {
    await useMoodStore.getState().hydrate();
    expect(useMoodStore.getState().addDefinition('Mayışık', '🫧', 2, 'low')).toEqual({ ok: true });
    const customDef = useMoodStore.getState().definitions[0];
    expect(customDef.energy).toBe('low');

    expect(useMoodStore.getState().checkIn(customDef.id, 1)).toBe(true);
    const snap = useMoodStore.getState().checkins[0];
    expect(snap.energy).toBe('low');

    expect(useMoodStore.getState().updateDefinition(customDef.id, 'Mayışık', '🫧', 2, 'high')).toEqual({ ok: true });
    expect(useMoodStore.getState().definitions[0].energy).toBe('high');
    expect(useMoodStore.getState().checkins[0].energy).toBe('low');

    // Explicit energy: null suppresses inheriting def.energy
    const cleared = makeCheckin(customDef, {
      id: 'c-explicit-null',
      at: new Date('2026-10-10T12:00:00.000Z'),
      day: '2026-10-10',
      intensity: 1,
      energy: null,
    });
    expect('energy' in cleared).toBe(false);

    // Built-in check-in carries no energy key
    expect(useMoodStore.getState().checkIn('builtin-2', 2)).toBe(true);
    expect('energy' in useMoodStore.getState().checkins[0]).toBe(false);
  });

  it('(-) clearing account state resets checkins so lowEnergySuggested becomes false', async () => {
    await useMoodStore.getState().hydrate();
    useMoodStore.getState().checkIn('builtin-1', 2);
    const id = useMoodStore.getState().checkins[0].id;
    useMoodStore.getState().setCheckinEnergy(id, 'low');
    const today = todayLocal();
    expect(lowEnergySuggested(useMoodStore.getState().checkins, today)).toBe(true);

    useMoodStore.setState({ userId: null, definitions: [], checkins: [] });
    expect(lowEnergySuggested(useMoodStore.getState().checkins, today)).toBe(false);
  });
});
