/**
 * F15 (TST-06): Time-zone test harness helpers and independent `Intl` wall-clock
 * oracle (`wallClockInZone`).
 */
export const TEST_ZONE: string = process.env.TEST_TZ || 'Europe/Istanbul';

export const IS_ISTANBUL: boolean = TEST_ZONE === 'Europe/Istanbul';

export const describeIstanbul: typeof describe = IS_ISTANBUL ? describe : describe.skip;

/** Intl.DateTimeFormat formatToParts ile bir anın verilen bölgedeki duvar saati (Node ICU). */
export function wallClockInZone(
  instantMs: number,
  zone: string,
): { y: number; m: number; d: number; hh: number; mm: number; ss: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(instantMs));
  const map: Record<string, number> = {};
  for (const p of parts) {
    if (p.type !== 'literal') map[p.type] = Number(p.value);
  }
  return {
    y: map.year,
    m: map.month,
    d: map.day,
    hh: map.hour,
    mm: map.minute,
    ss: map.second,
  };
}
