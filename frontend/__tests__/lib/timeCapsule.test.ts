import { readFileSync } from 'fs';
import { join } from 'path';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { endAccountScope, registeredAccountStorage } from '../../lib/accountScope';
import { addDaysLocal, parseLocalDate, todayLocal, ymd } from '../../lib/date';
import {
  CAPSULE_COPY,
  CAPSULE_MAX_CHARS,
  CAPSULE_MAX_ITEMS,
  addCapsule,
  eligibleCapsule,
  loadCapsules,
  markOpened,
  parseCapsules,
  removeCapsule,
  saveCapsules,
  timeCapsuleKey,
  waitingCount,
  type TimeCapsule,
} from '../../lib/timeCapsule';

describe('F37 — lib/timeCapsule', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  describe('addCapsule', () => {
    const now = new Date('2026-10-10T14:30:00.000Z');
    const today = '2026-10-10';

    it('(+) trims text, records local day and ISO createdAt, and does not mutate input array', () => {
      const existing: readonly TimeCapsule[] = Object.freeze([]);
      const res = addCapsule(existing, {
        id: 'c1',
        text: '  Yarın zor olabilir, yürüyüşe çık.  ',
        now,
        today,
      });
      expect(res).toEqual({
        ok: true,
        items: [
          {
            id: 'c1',
            text: 'Yarın zor olabilir, yürüyüşe çık.',
            day: '2026-10-10',
            createdAt: '2026-10-10T14:30:00.000Z',
          },
        ],
      });
      expect(existing).toHaveLength(0);
    });

    it('(-) rejects empty/whitespace, > 280 chars, and > 5 items (including opened ones)', () => {
      expect(addCapsule([], { id: 'e1', text: '   \n\t ', now, today })).toEqual({
        ok: false,
        reason: 'empty',
      });

      expect(
        addCapsule([], {
          id: 'e2',
          text: 'a'.repeat(CAPSULE_MAX_CHARS + 1),
          now,
          today,
        }),
      ).toEqual({
        ok: false,
        reason: 'too_long',
      });

      const five: TimeCapsule[] = Array.from({ length: CAPSULE_MAX_ITEMS }, (_, i) => ({
        id: `id-${i}`,
        text: `Not ${i}`,
        day: '2026-10-08',
        createdAt: `2026-10-08T10:0${i}:00.000Z`,
        ...(i === 0 ? { openedAt: '2026-10-09T09:00:00.000Z' } : {}),
      }));
      expect(addCapsule(five, { id: 'id-6', text: 'Altıncı not', now, today })).toEqual({
        ok: false,
        reason: 'full',
      });
    });
  });

  describe('eligibleCapsule & waitingCount (local-day & DST-safe)', () => {
    it('(+) returns null for same-day notes, picks oldest unread note from a prior day, and skips opened notes', () => {
      const today = '2026-10-10';
      const sameDay: TimeCapsule = {
        id: 'same',
        text: 'Bugün yazıldı',
        day: '2026-10-10',
        createdAt: '2026-10-10T08:00:00.000Z',
      };
      expect(eligibleCapsule([sameDay], today)).toBeNull();
      expect(waitingCount([sameDay], today)).toBe(1);

      const older: TimeCapsule = {
        id: 'old',
        text: 'İlk yazılan',
        day: '2026-10-08',
        createdAt: '2026-10-08T09:00:00.000Z',
      };
      const newer: TimeCapsule = {
        id: 'new',
        text: 'Sonra yazılan',
        day: '2026-10-09',
        createdAt: '2026-10-09T09:00:00.000Z',
      };
      const openedOldest: TimeCapsule = {
        id: 'opened',
        text: 'Daha önce okundu',
        day: '2026-10-01',
        createdAt: '2026-10-01T09:00:00.000Z',
        openedAt: '2026-10-05T12:00:00.000Z',
      };

      expect(eligibleCapsule([newer, older, openedOldest, sameDay], today)).toEqual(older);
      expect(waitingCount([newer, older, openedOldest, sameDay], today)).toBe(3);

      const allOpened = [openedOldest, { ...older, openedAt: '2026-10-10T07:00:00.000Z' }];
      expect(eligibleCapsule(allOpened, today)).toBeNull();
      expect(waitingCount(allOpened, today)).toBe(0);
    });

    it('(+) breaks createdAt ties deterministically by id and unlocks across DST spring-forward / fall-back boundaries', () => {
      const tieB: TimeCapsule = {
        id: 'b-note',
        text: 'B',
        day: '2026-03-29',
        createdAt: '2026-03-29T01:30:00.000Z',
      };
      const tieA: TimeCapsule = {
        id: 'a-note',
        text: 'A',
        day: '2026-03-29',
        createdAt: '2026-03-29T01:30:00.000Z',
      };
      // Spring-forward / fall-back local-day progression via parseLocalDate + addDaysLocal
      const writtenLocal = parseLocalDate('2026-03-29')!;
      const sameLocalDay = todayLocal(new Date(writtenLocal.getFullYear(), writtenLocal.getMonth(), writtenLocal.getDate(), 23, 59, 0));
      const nextLocalDay = ymd(addDaysLocal(writtenLocal, 1));

      expect(eligibleCapsule([tieB, tieA], sameLocalDay)).toBeNull();
      expect(eligibleCapsule([tieB, tieA], nextLocalDay)?.id).toBe('a-note');
    });
  });

  describe('markOpened & removeCapsule', () => {
    const base: TimeCapsule[] = [
      { id: 'c1', text: 'Bir', day: '2026-10-08', createdAt: '2026-10-08T10:00:00.000Z' },
      { id: 'c2', text: 'İki', day: '2026-10-09', createdAt: '2026-10-09T10:00:00.000Z' },
    ];

    it('(+) markOpened stamps openedAt once and is idempotent on repeat calls', () => {
      const t1 = new Date('2026-10-10T08:00:00.000Z');
      const t2 = new Date('2026-10-11T09:30:00.000Z');
      const once = markOpened(base, 'c1', t1);
      expect(once[0].openedAt).toBe('2026-10-10T08:00:00.000Z');
      expect(once[1].openedAt).toBeUndefined();

      const twice = markOpened(once, 'c1', t2);
      expect(twice).toEqual(once);
      expect(twice[0].openedAt).toBe('2026-10-10T08:00:00.000Z');
    });

    it('(+) removeCapsule removes only the matching id and leaves list intact for unknown id', () => {
      expect(removeCapsule(base, 'c1').map((c) => c.id)).toEqual(['c2']);
      expect(removeCapsule(base, 'missing')).toEqual(base);
    });
  });

  describe('parseCapsules resilience', () => {
    it('(-) never throws on corrupt JSON, null, wrong version, missing fields, long text, duplicate ids, or > 5 items', () => {
      expect(parseCapsules(null)).toEqual([]);
      expect(parseCapsules('')).toEqual([]);
      expect(parseCapsules('{bozuk json')).toEqual([]);
      expect(parseCapsules('[]')).toEqual([]);
      expect(
        parseCapsules(
          JSON.stringify({
            v: 2,
            items: [{ id: 'c1', text: 'x', day: '2026-10-08', createdAt: '2026-10-08T00:00:00Z' }],
          }),
        ),
      ).toEqual([]);

      const messy = JSON.stringify({
        v: 1,
        items: [
          null,
          { id: 'missing-day', text: 'x', createdAt: '2026-10-08T00:00:00Z' },
          { id: 'bad-day', text: 'x', day: '2026-02-30', createdAt: '2026-10-08T00:00:00Z' },
          { id: 'empty-text', text: '   ', day: '2026-10-08', createdAt: '2026-10-08T00:00:00Z' },
          { id: 'dup', text: 'b'.repeat(400), day: '2026-10-01', createdAt: '2026-10-01T00:00:00Z' },
          { id: 'dup', text: 'İkinci kopya atılmalı', day: '2026-10-02', createdAt: '2026-10-02T00:00:00Z' },
          { id: 'n2', text: 'İki', day: '2026-10-02', createdAt: '2026-10-02T00:00:00Z' },
          { id: 'n3', text: 'Üç', day: '2026-10-03', createdAt: '2026-10-03T00:00:00Z' },
          { id: 'n4', text: 'Dört', day: '2026-10-04', createdAt: '2026-10-04T00:00:00Z' },
          { id: 'n5', text: 'Beş', day: '2026-10-05', createdAt: '2026-10-05T00:00:00Z' },
          { id: 'n6', text: 'Altı kesilmeli', day: '2026-10-06', createdAt: '2026-10-06T00:00:00Z' },
        ],
      });

      const parsed = parseCapsules(messy);
      expect(parsed).toHaveLength(CAPSULE_MAX_ITEMS);
      expect(parsed.map((c) => c.id)).toEqual(['dup', 'n2', 'n3', 'n4', 'n5']);
      expect(parsed[0].text).toHaveLength(CAPSULE_MAX_CHARS);
    });
  });

  describe('AsyncStorage persistence & accountScope registration', () => {
    it('(+) isolates capsules per userId, survives sign-out (transient: false), and returns false on write failure', async () => {
      expect(registeredAccountStorage()).toContain('timeCapsule');

      const sample: TimeCapsule[] = [
        { id: 'cA', text: 'Kendine nazik ol.', day: '2026-10-08', createdAt: '2026-10-08T10:00:00.000Z' },
      ];
      expect(await saveCapsules('A', sample)).toBe(true);
      expect(await loadCapsules('A')).toEqual(sample);
      expect(await loadCapsules('B')).toEqual([]);

      // transient: false -> kept on signed_out, wiped on account_deleted
      await endAccountScope('signed_out', 'A');
      expect(await AsyncStorage.getItem(timeCapsuleKey('A'))).not.toBeNull();

      await endAccountScope('account_deleted', 'A');
      expect(await AsyncStorage.getItem(timeCapsuleKey('A'))).toBeNull();

      const setItemMock = AsyncStorage.setItem as jest.Mock;
      const origImpl = setItemMock.getMockImplementation();
      setItemMock.mockRejectedValueOnce(new Error('quota'));
      try {
        expect(await saveCapsules('A', sample)).toBe(false);
      } finally {
        if (origImpl) setItemMock.mockImplementation(origImpl);
      }
    });
  });

  describe('purity & calm copy invariants', () => {
    it('(+) has no ambient clock calls (new Date() / Date.now()) in lib/timeCapsule.ts and uses calm copy', () => {
      const src = readFileSync(join(__dirname, '../../lib/timeCapsule.ts'), 'utf8');
      expect(src).not.toMatch(/new Date\(\s*\)/);
      expect(src).not.toMatch(/Date\.now\(\s*\)/);
      expect(CAPSULE_COPY.cardTitle).toBe('Geçmişten bir not');
      expect(CAPSULE_COPY.waiting(2)).toBe('2 not bekliyor');
    });
  });
});
