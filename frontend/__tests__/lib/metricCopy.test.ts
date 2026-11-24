/**
 * F13 — Calm-Tech Turkish copy and absence of shaming/alarmist wording (DOM-23, INT-07).
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '../helpers/sourceText';
import {
  BACKLOG_BADGE_PARTIAL,
  BACKLOG_BADGE_PENDING,
  DIGEST_PREAMBLE,
  INSUFFICIENT_COPY,
  RETURN_NUDGE_TITLE,
  backlogMoreLabel,
  insufficientText,
  returnNudgeMany,
  returnNudgeOne,
} from '../../lib/metricCopy';

const ROOT = join(__dirname, '..', '..');
const FORBIDDEN_ROOTS = ['kaçırıldı', 'kaçtı', 'kaçıyor', 'kaçırma', 'zincir', 'başarısız', 'ceza'] as const;

function lowerTr(s: string): string {
  return s.toLocaleLowerCase('tr-TR');
}

describe('F13 DOM-23 — metricCopy exports exact calm Turkish wording with zero shaming roots', () => {
  it('renders exact return-nudge, badge, and pagination strings', () => {
    expect(RETURN_NUDGE_TITLE).toBe('Küçük bir dönüş');
    expect(returnNudgeOne('Su içmek', 3)).toBe(
      '"Su içmek" için son 3 gün boş geçti. İstersen bugün küçük bir adımla yeniden başla.',
    );
    expect(returnNudgeMany(4)).toBe(
      '4 alışkanlıkta birkaç gündür kayıt yok. Küçük bir adım, yeniden başlamak için yeter.',
    );
    expect(BACKLOG_BADGE_PENDING).toBe('Bekleyen');
    expect(BACKLOG_BADGE_PARTIAL).toBe('Kısmi');
    expect(backlogMoreLabel(5)).toBe('Daha fazla göster (5)');
  });

  it('insufficientText returns Turkish copy when kind is given, and falls back to raw reason when undefined', () => {
    expect(insufficientText('trend', 'only 1 week')).toBe(INSUFFICIENT_COPY.trend);
    expect(insufficientText('weekday', 'no weekday has data')).toBe(INSUFFICIENT_COPY.weekday);
    expect(insufficientText('rate', 'no scheduled days')).toBe(INSUFFICIENT_COPY.rate);
    expect(insufficientText('strength', 'need >= 10')).toBe(INSUFFICIENT_COPY.strength);
    expect(insufficientText('fragility', 'need >= 3')).toBe(INSUFFICIENT_COPY.fragility);
    expect(insufficientText('recovery', 'no resolved')).toBe(INSUFFICIENT_COPY.recovery);
    expect(insufficientText(undefined, 'ham neden')).toBe('ham neden');
  });

  it('no exported copy in metricCopy.ts contains any forbidden shaming root or leaked English reason words', () => {
    const samples = [
      ...Object.values(INSUFFICIENT_COPY),
      DIGEST_PREAMBLE,
      RETURN_NUDGE_TITLE,
      returnNudgeOne('Yürüyüş', 2),
      returnNudgeMany(3),
      BACKLOG_BADGE_PENDING,
      BACKLOG_BADGE_PARTIAL,
      backlogMoreLabel(12),
    ];

    for (const text of samples) {
      const low = lowerTr(text);
      for (const root of FORBIDDEN_ROOTS) {
        expect(low).not.toContain(root);
      }
    }

    for (const val of Object.values(INSUFFICIENT_COPY)) {
      expect(val).not.toMatch(/\bno\b|\bneed\b|\bsample\b/i);
    }
  });
});

describe('F13 DOM-23 — recovery.tsx source (stripped of comments) carries no shaming roots and no alert warnBanner', () => {
  const raw = readFileSync(join(ROOT, 'app/screens/recovery.tsx'), 'utf8');
  const code = stripComments(raw);

  it('contains none of the forbidden roots anywhere in code/JSX', () => {
    const low = lowerTr(code);
    for (const root of FORBIDDEN_ROOTS) {
      expect(low).not.toContain(root);
    }
  });

  it('warnBanner does not carry accessibilityRole="alert"', () => {
    expect(code).not.toMatch(/warnBanner[\s\S]{0,80}accessibilityRole\s*=\s*["']alert["']/);
    expect(code).not.toMatch(/accessibilityRole\s*=\s*["']alert["']/);
  });
});
