import { colors } from '../lib/tokens';
import { View, Text, StyleSheet, TouchableOpacity, TextInput } from 'react-native';
import type { FrequencyConfig } from '../lib/supabase';
import {
  setFrequencyKind, setWeeklyMode, weeklyModeOf, toggleWeekday,
  setFrequencyCount, setIntervalDays, setRangeStart, setRangeEnd, countCeiling,
  frequencySummary, rangeSummary, INTERVAL_PRESETS,
  monthlyModeOf, setMonthlyMode, toggleMonthDay, setShortMonth, setYearlyDate, setLeapDay,
} from '../lib/frequencyForm';
import { MONTH_MAX_DAYS } from '../lib/routineProposal';
import { todayLocal, parseLocalDate, addDaysLocal, ymd as ymdOf } from '../lib/date';

/** R01.02 — month names for the yearly date. */
const MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
const KIND_LABEL: Record<FrequencyConfig['kind'], string> = { daily: 'Günlük', weekly: 'Haftalık', monthly: 'Aylık', yearly: 'Yıllık' };

/**
 * The frequency controls: kind, weekly sub-mode, which days / how many, the
 * interval, the date envelope, and the live summary.
 *
 * KD-09 — extracted from `HabitOnboarding` so the habit-detail editor uses the
 * SAME controls instead of a second copy. Every change goes through a pure
 * transition in `lib/frequencyForm.ts`; this component only renders and calls
 * `onChange` with the next config. What a change COSTS (the willpower cost) is
 * the caller's business -- the creation form recosts, the editor recosts on
 * save -- so it is deliberately not done here.
 *
 * `part_of_day` is not part of the schedule shape and stays with its caller.
 */
export const WEEKDAYS = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];
/** Full names, for screen readers: "Pzt" read aloud is not a word. */
export const WEEKDAY_NAMES = ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi', 'Pazar'];

export default function FrequencyEditor({
  value: freq,
  onChange,
}: {
  value: FrequencyConfig;
  onChange: (next: FrequencyConfig) => void;
}) {
  function updateFreq(next: FrequencyConfig) {
    if (next !== freq) onChange(next);
  }
  function setKind(kind: FrequencyConfig['kind']) { updateFreq(setFrequencyKind(freq, kind)); }
  function toggleDay(dayIdx: number) { updateFreq(toggleWeekday(freq, dayIdx)); }
  const weeklyMode = weeklyModeOf(freq);
  const countMax = countCeiling(freq.kind);
  const todayYmd = todayLocal();
  const rangeBase = freq.range_start ?? todayYmd;
  const plusDays = (from: string, n: number) => ymdOf(addDaysLocal(parseLocalDate(from) ?? new Date(), n));

  return (
    <>
      {/* R01.02-e:freq-controls:start */}
      <View style={styles.row} accessibilityRole="radiogroup" accessibilityLabel="Sıklık türü">
        {(['daily', 'weekly', 'monthly', 'yearly'] as const).map((k) => (
          <TouchableOpacity
            key={k}
            style={[styles.freqBtn, freq.kind === k && styles.freqBtnSelected]}
            onPress={() => setKind(k)}
            accessibilityRole="radio"
            accessibilityLabel={KIND_LABEL[k]}
            accessibilityState={{ selected: freq.kind === k, checked: freq.kind === k }}
          >
            <Text style={[styles.freqBtnText, freq.kind === k && styles.freqBtnTextSelected]}>
              {KIND_LABEL[k]}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {freq.kind === 'daily' && (
        <>
          {/* "Her N günde bir": 1 is plain daily, so "Her gün" REMOVES interval_days
              (setIntervalDays(null)); the field is never written as 1. */}
          <Text style={[styles.label, { marginTop: 20 }]}>Ne kadar sık?</Text>
          <View style={styles.daysRow} accessibilityRole="radiogroup" accessibilityLabel="Tekrar aralığı">
            {([null, ...INTERVAL_PRESETS] as (number | null)[]).map((n) => {
              const sel = (freq.interval_days ?? null) === n;
              const label = n === null ? 'Her gün' : `${n} günde bir`;
              return (
                <TouchableOpacity
                  key={String(n)}
                  style={[styles.dayBtn, styles.wideChip, sel && styles.dayBtnSelected]}
                  onPress={() => updateFreq(setIntervalDays(freq, n))}
                  accessibilityRole="radio"
                  accessibilityLabel={label}
                  accessibilityState={{ selected: sel, checked: sel }}
                >
                  <Text style={[styles.dayBtnText, sel && styles.dayBtnTextSelected]}>{label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <View style={[styles.row, { marginTop: 10, alignItems: 'center' }]}>
            <TextInput
              style={[styles.input, { flex: 1, marginBottom: 0 }]}
              placeholder="Başka: kaç günde bir? (2–365)"
              placeholderTextColor={colors.textFaint}
              keyboardType="numeric"
              accessibilityLabel="Kaç günde bir, 2 ile 365 arası"
              value={freq.interval_days && !(INTERVAL_PRESETS as readonly number[]).includes(freq.interval_days) ? String(freq.interval_days) : ''}
              onChangeText={(t) => updateFreq(setIntervalDays(freq, t.trim() === '' ? null : parseInt(t, 10)))}
            />
            <Text style={styles.endUnit}>günde bir</Text>
          </View>
        </>
      )}

      {freq.kind === 'weekly' && (
        <>
          {/* Days XOR count: scheduleKind reads `days` first and ignores a count
              beside it, so the two are separate modes, never both filled. */}
          <View style={[styles.row, { marginTop: 20 }]} accessibilityRole="radiogroup" accessibilityLabel="Haftalık tür">
            {(['count', 'days'] as const).map((m) => {
              const sel = weeklyMode === m;
              const label = m === 'count' ? 'Haftada N kez' : 'Belirli günler';
              return (
                <TouchableOpacity
                  key={m}
                  style={[styles.freqBtn, sel && styles.freqBtnSelected]}
                  onPress={() => updateFreq(setWeeklyMode(freq, m))}
                  accessibilityRole="radio"
                  accessibilityLabel={label}
                  accessibilityState={{ selected: sel, checked: sel }}
                >
                  <Text style={[styles.freqBtnText, sel && styles.freqBtnTextSelected]}>{label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          {weeklyMode === 'days' && (
            <>
              <Text style={[styles.label, { marginTop: 16 }]}>Hangi günler?</Text>
              <View style={styles.daysRow}>
                {WEEKDAYS.map((d, i) => {
                  const sel = (freq.days ?? []).includes(i);
                  return (
                    <TouchableOpacity
                      key={i}
                      style={[styles.dayBtn, sel && styles.dayBtnSelected]}
                      onPress={() => toggleDay(i)}
                      accessibilityRole="checkbox"
                      accessibilityLabel={WEEKDAY_NAMES[i]}
                      accessibilityState={{ checked: sel }}
                    >
                      <Text style={[styles.dayBtnText, sel && styles.dayBtnTextSelected]}>
                        {d}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              {(freq.days ?? []).length === 0 && (
                <Text style={styles.endHint} accessibilityLiveRegion="polite">Devam etmek için en az bir gün seç.</Text>
              )}
            </>
          )}
        </>
      )}

      {/* R01.02 — monthly: N a month XOR fixed days of the month. */}
      {freq.kind === 'monthly' && (
        <View style={[styles.row, { marginTop: 20 }]} accessibilityRole="radiogroup" accessibilityLabel="Aylık tür">
          {(['count', 'days'] as const).map((m) => {
            const sel = monthlyModeOf(freq) === m;
            const label = m === 'count' ? 'Ayda N kez' : 'Ayın günleri';
            return (
              <TouchableOpacity key={m} style={[styles.freqBtn, sel && styles.freqBtnSelected]} onPress={() => updateFreq(setMonthlyMode(freq, m))}
                accessibilityRole="radio" accessibilityLabel={label} accessibilityState={{ selected: sel, checked: sel }}>
                <Text style={[styles.freqBtnText, sel && styles.freqBtnTextSelected]}>{label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}
      {freq.kind === 'monthly' && monthlyModeOf(freq) === 'days' && (
        <>
          <Text style={[styles.label, { marginTop: 16 }]}>Ayın hangi günleri?</Text>
          <View style={styles.daysRow}>
            {Array.from({ length: MONTH_MAX_DAYS[0] }, (_, i) => i + 1).map((d) => {
              const on = (freq.month_days ?? []).includes(d);
              return (
                <TouchableOpacity key={d} style={[styles.dayBtn, on && styles.dayBtnSelected]} onPress={() => updateFreq(toggleMonthDay(freq, d))}
                  accessibilityRole="checkbox" accessibilityLabel={`Ayın ${d}. günü`} accessibilityState={{ checked: on }}>
                  <Text style={[styles.dayBtnText, on && styles.dayBtnTextSelected]}>{d}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          {(freq.month_days ?? []).some((d) => d > 28) && (
            <>
              <Text style={[styles.label, { marginTop: 12 }]}>Bu gün olmayan aylarda (ör. Şubat, Nisan)</Text>
              <View style={styles.row} accessibilityRole="radiogroup" accessibilityLabel="Kısa ay kuralı">
                {(['skip', 'last_day'] as const).map((p) => {
                  const sel = freq.short_month === p;
                  const label = p === 'skip' ? 'O ay atla' : 'Ayın son gününe al';
                  return (
                    <TouchableOpacity key={p} style={[styles.freqBtn, sel && styles.freqBtnSelected]} onPress={() => updateFreq(setShortMonth(freq, p))}
                      accessibilityRole="radio" accessibilityLabel={label} accessibilityState={{ selected: sel, checked: sel }}>
                      <Text style={[styles.freqBtnText, sel && styles.freqBtnTextSelected]}>{label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </>
          )}
        </>
      )}

      {/* R01.02 — yearly date; 29 February asks what happens in other years. */}
      {freq.kind === 'yearly' && (
        <>
          <Text style={[styles.label, { marginTop: 16 }]}>Hangi ay?</Text>
          <View style={styles.daysRow}>
            {MONTHS.map((name, i) => {
              const on = freq.month === i + 1;
              return (
                <TouchableOpacity key={name} style={[styles.dayBtn, on && styles.dayBtnSelected]} onPress={() => updateFreq(setYearlyDate(freq, i + 1, freq.day ?? 1))}
                  accessibilityRole="radio" accessibilityLabel={name} accessibilityState={{ selected: on, checked: on }}>
                  <Text style={[styles.dayBtnText, on && styles.dayBtnTextSelected]}>{name.slice(0, 3)}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <View style={[styles.row, { marginTop: 12, alignItems: 'center' }]}>
            <TouchableOpacity style={styles.dayBtn} onPress={() => updateFreq(setYearlyDate(freq, freq.month ?? 1, (freq.day ?? 1) - 1))}
              disabled={(freq.day ?? 1) <= 1}
              accessibilityRole="button" accessibilityLabel="Günü bir azalt" accessibilityState={{ disabled: (freq.day ?? 1) <= 1 }}>
              <Text style={styles.dayBtnText}>−</Text>
            </TouchableOpacity>
            <Text style={[styles.endUnit, { minWidth: 110, textAlign: 'center' }]} accessibilityLiveRegion="polite">
              {freq.day ?? 1} {MONTHS[(freq.month ?? 1) - 1]}
            </Text>
            <TouchableOpacity style={styles.dayBtn} onPress={() => updateFreq(setYearlyDate(freq, freq.month ?? 1, (freq.day ?? 1) + 1))}
              disabled={(freq.day ?? 1) >= MONTH_MAX_DAYS[(freq.month ?? 1) - 1]}
              accessibilityRole="button" accessibilityLabel="Günü bir artır" accessibilityState={{ disabled: (freq.day ?? 1) >= MONTH_MAX_DAYS[(freq.month ?? 1) - 1] }}>
              <Text style={styles.dayBtnText}>+</Text>
            </TouchableOpacity>
          </View>
          {freq.month === 2 && freq.day === 29 && (
            <>
              <Text style={[styles.label, { marginTop: 12 }]}>Artık yıl olmayan yıllarda</Text>
              <View style={styles.row} accessibilityRole="radiogroup" accessibilityLabel="29 Şubat kuralı">
                {(['feb28', 'mar1', 'skip'] as const).map((p) => {
                  const sel = freq.leap_day === p;
                  const label = p === 'feb28' ? '28 Şubat' : p === 'mar1' ? '1 Mart' : 'O yıl atla';
                  return (
                    <TouchableOpacity key={p} style={[styles.freqBtn, sel && styles.freqBtnSelected]} onPress={() => updateFreq(setLeapDay(freq, p))}
                      accessibilityRole="radio" accessibilityLabel={label} accessibilityState={{ selected: sel, checked: sel }}>
                      <Text style={[styles.freqBtnText, sel && styles.freqBtnTextSelected]}>{label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </>
          )}
        </>
      )}

      {((freq.kind === 'monthly' && monthlyModeOf(freq) === 'count') || (freq.kind === 'weekly' && weeklyMode === 'count')) && (
        <View style={[styles.row, { marginTop: 16, alignItems: 'center' }]}>
          <TouchableOpacity
            style={[styles.dayBtn, (freq.count ?? 1) <= 1 && styles.buttonDisabled]}
            onPress={() => updateFreq(setFrequencyCount(freq, (freq.count ?? 1) - 1))}
            disabled={(freq.count ?? 1) <= 1}
            accessibilityRole="button"
            accessibilityLabel={freq.kind === 'monthly' ? 'Ayda bir kez azalt' : 'Haftada bir kez azalt'}
            accessibilityState={{ disabled: (freq.count ?? 1) <= 1 }}
          >
            <Text style={styles.dayBtnText}>−</Text>
          </TouchableOpacity>
          <Text
            style={[styles.endUnit, { minWidth: 110, textAlign: 'center' }]}
            accessibilityLiveRegion="polite"
          >
            {freq.kind === 'monthly' ? 'Ayda' : 'Haftada'} {freq.count ?? 1} kez
          </Text>
          <TouchableOpacity
            style={[styles.dayBtn, (freq.count ?? 1) >= countMax && styles.buttonDisabled]}
            onPress={() => updateFreq(setFrequencyCount(freq, (freq.count ?? 1) + 1))}
            disabled={(freq.count ?? 1) >= countMax}
            accessibilityRole="button"
            accessibilityLabel={freq.kind === 'monthly' ? 'Ayda bir kez artır' : 'Haftada bir kez artır'}
            accessibilityState={{ disabled: (freq.count ?? 1) >= countMax }}
          >
            <Text style={styles.dayBtnText}>+</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Tarih zarfı — bir ŞEKİL değil: her sıklık türüyle birleşir, kind
          değişince korunur (setFrequencyKind). Uçlar opsiyonel; bitiş
          başlangıçtan önce olamaz (setRangeEnd reddeder). */}
      <Text style={[styles.label, { marginTop: 20 }]}>Yalnızca şu tarihler arasında (isteğe bağlı)</Text>
      <View style={styles.daysRow} accessibilityRole="radiogroup" accessibilityLabel="Başlangıç tarihi">
        {([null, 7, 30] as (number | null)[]).map((n) => {
          const target = n === null ? null : plusDays(todayYmd, n);
          const sel = (freq.range_start ?? null) === target;
          const label = n === null ? 'Hemen' : n === 7 ? '1 hafta sonra' : '1 ay sonra';
          return (
            <TouchableOpacity
              key={String(n)}
              style={[styles.dayBtn, styles.wideChip, sel && styles.dayBtnSelected]}
              onPress={() => updateFreq(setRangeStart(freq, target))}
              accessibilityRole="radio"
              accessibilityLabel={`Başlangıç: ${label}`}
              accessibilityState={{ selected: sel, checked: sel }}
            >
              <Text style={[styles.dayBtnText, sel && styles.dayBtnTextSelected]}>{label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
      <View style={[styles.daysRow, { marginTop: 8 }]} accessibilityRole="radiogroup" accessibilityLabel="Bitiş tarihi">
        {([null, 7, 30, 90] as (number | null)[]).map((n) => {
          // "N gün boyunca": inclusive, so the end is base + N - 1.
          const target = n === null ? null : plusDays(rangeBase, n - 1);
          const sel = (freq.range_end ?? null) === target;
          const label = n === null ? 'Süresiz' : `${n} gün`;
          return (
            <TouchableOpacity
              key={String(n)}
              style={[styles.dayBtn, styles.wideChip, sel && styles.dayBtnSelected]}
              onPress={() => updateFreq(setRangeEnd(freq, target))}
              accessibilityRole="radio"
              accessibilityLabel={n === null ? 'Bitiş: süresiz' : `Bitiş: ${n} gün boyunca`}
              accessibilityState={{ selected: sel, checked: sel }}
            >
              <Text style={[styles.dayBtnText, sel && styles.dayBtnTextSelected]}>{label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
      {rangeSummary(freq) !== '' && <Text style={styles.endHint}>Aralık: {rangeSummary(freq)}</Text>}

      <Text style={[styles.endHint, { marginTop: 12 }]} accessibilityLiveRegion="polite">
        Özet: {frequencySummary(freq)}
      </Text>
      {/* R01.02-e:freq-controls:end */}
    </>
  );
}

// Copied from HabitOnboarding's sheet so the controls look identical in both
// places; HabitOnboarding still uses several of these for its other steps.
const styles = StyleSheet.create({
  label: { fontSize: 15, fontWeight: '600', color: colors.white, marginBottom: 10 },
  input: {
    backgroundColor: colors.surface, borderRadius: 12, padding: 14, fontSize: 15,
    color: colors.white, marginBottom: 14, borderWidth: 1, borderColor: colors.border,
  },
  row: { flexDirection: 'row', gap: 12, marginBottom: 8 },
  freqBtn: {
    flex: 1, backgroundColor: colors.surface, borderRadius: 12, padding: 12,
    alignItems: 'center', borderWidth: 2, borderColor: colors.border,
  },
  freqBtnSelected: { borderColor: colors.accent, backgroundColor: colors.selectedTint },
  freqBtnText: { color: colors.textDim, fontSize: 13, fontWeight: '600' },
  freqBtnTextSelected: { color: colors.accent },
  daysRow: { flexDirection: 'row', gap: 6 },
  dayBtn: {
    flex: 1, backgroundColor: colors.surface, borderRadius: 8, paddingVertical: 10,
    alignItems: 'center', borderWidth: 1, borderColor: colors.border,
  },
  dayBtnSelected: { backgroundColor: colors.accent, borderColor: colors.accent },
  wideChip: { paddingHorizontal: 4 },
  dayBtnText: { fontSize: 11, color: colors.textDim, fontWeight: '600' },
  dayBtnTextSelected: { color: colors.white },
  buttonDisabled: { opacity: 0.4 },
  endHint: { fontSize: 12, color: colors.accent, marginTop: 10, fontWeight: '600' },
  endUnit: { fontSize: 13, color: colors.textDim, marginLeft: 10 },
});
