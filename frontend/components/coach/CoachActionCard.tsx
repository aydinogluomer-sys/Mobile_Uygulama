/**
 * The confirmation barrier, as a screen the user actually reads.
 *
 * Nothing in AI Coach writes until a finger lands on a button in this card.
 * That is the entire contract: the model proposes, `lib/coachActions.ts`
 * validates, the habit is resolved against the user's OWN rows, and then this
 * card states — in plain words, not prose the model wrote — exactly what is
 * about to happen and to which habit on which day.
 *
 * Three rules shape everything here:
 *
 *   NAME THE TARGET  the card always shows the habit, the date and the
 *                    completion. "Evet" buried in a sentence is not consent
 *                    when the thing being consented to was inferred.
 *   NEVER GUESS      if two of the user's habits plausibly match, or if a
 *                    proposal is missing the target that makes it measurable,
 *                    this ASKS instead of picking. Writing to the wrong habit,
 *                    or installing a habit with a target nobody chose, is a
 *                    silent error the user may never notice.
 *   SHOW THE MEANING a preview that lists names only ("Kitap Oku, Yürüyüş")
 *                    is not a preview of what will be installed. Every habit
 *                    shows its target, its schedule and its time cost, because
 *                    those are the fields that decide what the habit DOES.
 */
import { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, TextInput } from 'react-native';
import { colors, alphaHex, hexA } from '../../lib/tokens';
import EmbeddedFiligree from '../spatial/EmbeddedFiligree';
import { DECOR } from '../../lib/visualAssets';
import type { Habit } from '../../lib/supabase';
import type { CoachLogCompletion } from '../../lib/coachActions';
import type { ProposalEvaluation, ProposalHabit } from '../../lib/routineProposal';
import { DOW_TR } from '../../lib/focusReport';
// The gap this card asks about is decided in one place, not two.
import type { MissingSemantic } from '../../lib/coachClarify';

export type { MissingSemantic };

export type StagedCoachAction =
  /**
   * A plan the model offered, not yet opened. One tap away from a preview and
   * two from a write -- three habits should not become a confirmation sheet
   * the instant the model answers a question the user only asked to see.
   */
  | { kind: 'planOffer'; title: string; goal: string; habits: ProposalHabit[] }
  /** A habit or plan, already staged in routineStore and capacity-evaluated. */
  | { kind: 'proposal'; title: string; habits: ProposalHabit[]; evaluation: ProposalEvaluation | null }
  /**
   * A proposal the model left genuinely underspecified. Asked, never guessed:
   * a default target changes what the habit means.
   */
  | { kind: 'clarify'; title: string; habits: ProposalHabit[]; index: number; missing: MissingSemantic }
  /** One resolved habit, ready to log. `derived` comes from the domain engine. */
  | { kind: 'log'; habit: Habit; date: string; completion: CoachLogCompletion; derived: 'done' | 'partial' | 'miss' }
  /** The value's unit disagrees with the habit's. Ask; do not reinterpret. */
  | { kind: 'unitMismatch'; habit: Habit; date: string; value: number; unit: string }
  /** Two or more of the user's habits matched. Ask, do not choose. */
  | { kind: 'ambiguous'; candidates: Habit[]; date: string; completion: CoachLogCompletion }
  /** Nothing matched. Offer to create rather than silently doing nothing. */
  | { kind: 'nomatch'; query: string }
  /** Validation refused the proposal. Say so; never fall through to a write. */
  | { kind: 'invalid'; reasons: string[] };

/** What a clarification answer supplies. One field at a time. */
export type ClarifyAnswer =
  | { missing: 'goal'; daily_goal: number; unit: string }
  /** "Hedefsiz" — the habit is a yes/no one after all. */
  | { missing: 'goal'; daily_goal: null; unit: null }
  | { missing: 'frequency'; frequency_config: ProposalHabit['frequency_config'] };

type Props = {
  staged: StagedCoachAction;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  onPickCandidate?: (habit: Habit) => void;
  onClarify?: (answer: ClarifyAnswer) => void;
  onAcceptPlan?: () => void;
};

/** Human date, without pulling in a formatter for three cases. */
function dateLabel(ymd: string, today: string, yesterday: string): string {
  if (ymd === today) return 'bugün';
  if (ymd === yesterday) return 'dün';
  return ymd;
}

/** Turkish for a derived log state. The engine decides it; this only names it. */
export function stateLabel(state: 'done' | 'partial' | 'miss'): string {
  return state === 'done' ? 'Tamamlandı' : state === 'partial' ? 'Kısmi' : 'Yapılmadı';
}

export function describeCompletion(c: CoachLogCompletion, habit: Habit): string {
  if (c.kind === 'state') {
    return c.state === 'done' ? 'tamamlandı'
      : c.state === 'partial' ? 'kısmen yapıldı'
      : c.state === 'skip' ? 'pas geçildi'
      : 'yapılmadı';
  }
  const unit = habit.unit ? ` ${habit.unit}` : '';
  const target = habit.daily_goal != null ? ` / ${habit.daily_goal}${unit}` : unit;
  return `${c.value}${target}`;
}

/** "20 dakika", or nothing at all for a habit with no measurable target. */
export function describeTarget(h: ProposalHabit): string | null {
  if (h.daily_goal == null) return null;
  const dir = h.target_direction === 'at_most' ? 'en fazla ' : '';
  return `${dir}${h.daily_goal}${h.unit ? ` ${h.unit}` : ''}`;
}

/**
 * "Her gün", "Pzt · Çrş · Cum", "Haftada 3".
 *
 * The weekday array is Monday = 0 (`lib/habitSchedule.ts`'s `weekdayIndex`),
 * which is also how `DOW_TR` is ordered — so this is an index, not a lookup
 * that could silently drift by one.
 */
export function describeFrequency(h: ProposalHabit): string {
  const fc = h.frequency_config;
  if (!fc || fc.kind === 'daily') return 'Her gün';
  if (fc.kind === 'weekly') {
    if (fc.days && fc.days.length > 0) return fc.days.map((d) => DOW_TR[d] ?? '?').join(' · ');
    if (fc.count) return `Haftada ${fc.count}`;
    return 'Haftalık';
  }
  return fc.count ? `Ayda ${fc.count}` : 'Aylık';
}

/** One habit's semantics, the way the preview must show them. */
function HabitFacts({ habit, badge }: { habit: ProposalHabit; badge?: 'active' | 'queued' }) {
  const target = describeTarget(habit);
  return (
    <View style={s.habitBlock}>
      <View style={s.factRow}>
        <Text style={s.factVal}>{habit.name}</Text>
        {badge === 'queued' ? <Text style={s.queued}>sırada</Text>
          : badge === 'active' ? <Text style={s.active}>aktif</Text> : null}
      </View>
      {!!target && <Text style={s.habitMeta}>{`Hedef: ${target}`}</Text>}
      <Text style={s.habitMeta}>{describeFrequency(habit)}</Text>
      <Text style={s.habitMeta}>{`Tahmini süre: ${habit.estimated_minutes} dk`}</Text>
    </View>
  );
}

/** The two questions the app is allowed to ask, and nothing else. */
function ClarifyBody({ habit, missing, onClarify }: {
  habit: ProposalHabit;
  missing: MissingSemantic;
  onClarify?: (a: ClarifyAnswer) => void;
}) {
  const [customOpen, setCustomOpen] = useState(false);
  const [customValue, setCustomValue] = useState('');
  const [customUnit, setCustomUnit] = useState('dakika');
  const [pickDays, setPickDays] = useState<number[] | null>(null);

  if (missing === 'goal') {
    const submitCustom = () => {
      const n = Number(customValue.replace(',', '.'));
      const unit = customUnit.trim();
      if (!Number.isFinite(n) || n <= 0 || !unit) return;
      onClarify?.({ missing: 'goal', daily_goal: n, unit });
    };
    return (
      <>
        <Text style={s.body}>“{habit.name}” için günlük hedef ne olsun?</Text>
        <View style={s.chipWrap}>
          {[10, 20, 30].map((n) => (
            <TouchableOpacity
              key={n}
              style={s.chip}
              onPress={() => onClarify?.({ missing: 'goal', daily_goal: n, unit: 'dakika' })}
              accessibilityRole="button"
              accessibilityLabel={`Hedef ${n} dakika`}
            >
              <Text style={s.chipText}>{n} dk</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity
            style={s.chip}
            onPress={() => setCustomOpen((v) => !v)}
            accessibilityRole="button"
            accessibilityLabel="Özel hedef gir"
          >
            <Text style={s.chipText}>Özel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={s.chip}
            onPress={() => onClarify?.({ missing: 'goal', daily_goal: null, unit: null })}
            accessibilityRole="button"
            accessibilityLabel="Hedefsiz, yap ya da yapma olarak ekle"
          >
            <Text style={s.chipText}>Hedefsiz</Text>
          </TouchableOpacity>
        </View>
        {customOpen && (
          <View style={s.customRow}>
            <TextInput
              style={s.customNum}
              value={customValue}
              onChangeText={setCustomValue}
              keyboardType="numeric"
              placeholder="20"
              placeholderTextColor={colors.textFaint}
              accessibilityLabel="Özel hedef değeri"
            />
            <TextInput
              style={s.customUnit}
              value={customUnit}
              onChangeText={setCustomUnit}
              placeholder="dakika"
              placeholderTextColor={colors.textFaint}
              maxLength={24}
              accessibilityLabel="Özel hedef birimi"
            />
            <TouchableOpacity style={s.chip} onPress={submitCustom} accessibilityRole="button" accessibilityLabel="Özel hedefi uygula">
              <Text style={s.chipText}>Tamam</Text>
            </TouchableOpacity>
          </View>
        )}
      </>
    );
  }

  const commitDays = () => {
    if (!pickDays || pickDays.length === 0) return;
    onClarify?.({ missing: 'frequency', frequency_config: { kind: 'weekly', days: [...pickDays].sort((a, b) => a - b) } });
  };
  return (
    <>
      <Text style={s.body}>“{habit.name}” hangi günler olsun?</Text>
      <View style={s.chipWrap}>
        <TouchableOpacity
          style={s.chip}
          onPress={() => onClarify?.({ missing: 'frequency', frequency_config: { kind: 'daily' } })}
          accessibilityRole="button"
          accessibilityLabel="Her gün"
        >
          <Text style={s.chipText}>Her gün</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={s.chip}
          // Pzt–Cum. Monday = 0, so weekdays are 0..4 — see describeFrequency.
          onPress={() => onClarify?.({ missing: 'frequency', frequency_config: { kind: 'weekly', days: [0, 1, 2, 3, 4] } })}
          accessibilityRole="button"
          accessibilityLabel="Hafta içi"
        >
          <Text style={s.chipText}>Hafta içi</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={s.chip}
          onPress={() => setPickDays((v) => (v === null ? [] : null))}
          accessibilityRole="button"
          accessibilityLabel="Belirli günler seç"
        >
          <Text style={s.chipText}>Belirli günler</Text>
        </TouchableOpacity>
      </View>
      {pickDays !== null && (
        <>
          <View style={s.chipWrap}>
            {DOW_TR.map((label, idx) => {
              const on = pickDays.includes(idx);
              return (
                <TouchableOpacity
                  key={label}
                  style={[s.dayChip, on && s.dayChipOn]}
                  onPress={() => setPickDays((v) => (v ?? []).includes(idx) ? (v ?? []).filter((d) => d !== idx) : [...(v ?? []), idx])}
                  accessibilityRole="button"
                  accessibilityLabel={`${label} günü`}
                  accessibilityState={{ selected: on }}
                >
                  <Text style={[s.chipText, on && s.dayChipTextOn]}>{label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <TouchableOpacity
            style={[s.chip, pickDays.length === 0 && s.btnDisabled]}
            onPress={commitDays}
            disabled={pickDays.length === 0}
            accessibilityRole="button"
            accessibilityLabel="Seçilen günleri uygula"
          >
            <Text style={s.chipText}>Bu günlerde</Text>
          </TouchableOpacity>
        </>
      )}
    </>
  );
}

export default function CoachActionCard({ staged, busy, onConfirm, onCancel, onPickCandidate, onClarify, onAcceptPlan }: Props) {
  if (staged.kind === 'planOffer') {
    return (
      <View style={s.card}>
        <EmbeddedFiligree source={DECOR.cornerAstrolabe} size={96} opacity={0.14} />
        <Text style={s.title}>{staged.title}</Text>
        <Text style={s.body}>
          {staged.habits.length} alışkanlıklık bir plan. Dönüştürmeden önce her birini
          hedefi ve günleriyle birlikte göreceksin.
        </Text>
        <View style={s.row}>
          <TouchableOpacity
            style={s.primaryBtn}
            onPress={onAcceptPlan}
            accessibilityRole="button"
            accessibilityLabel="Bu planı alışkanlıklara dönüştür"
          >
            <Text style={s.primaryText}>Bu Planı Alışkanlıklara Dönüştür</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.ghostBtn} onPress={onCancel} accessibilityRole="button" accessibilityLabel="Vazgeç">
            <Text style={s.ghostText}>Vazgeç</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (staged.kind === 'invalid') {
    return (
      <View style={[s.card, s.cardWarn]} accessibilityRole="alert">
        <Text style={s.warnTitle}>Bu öneri uygulanamadı</Text>
        {staged.reasons.slice(0, 3).map((r) => (
          <Text key={r} style={s.warnText}>• {r}</Text>
        ))}
        <View style={s.row}>
          <TouchableOpacity style={s.ghostBtn} onPress={onCancel} accessibilityRole="button" accessibilityLabel="Öneriyi kapat">
            <Text style={s.ghostText}>Kapat</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (staged.kind === 'nomatch') {
    return (
      <View style={s.card}>
        <EmbeddedFiligree source={DECOR.cornerAstrolabe} size={96} opacity={0.14} />
        <Text style={s.title}>Eşleşen alışkanlık yok</Text>
        <Text style={s.body}>
          “{staged.query}” adında bir alışkanlığın görünmüyor. Yazarak yeni bir alışkanlık isteyebilirsin.
        </Text>
        <View style={s.row}>
          <TouchableOpacity style={s.ghostBtn} onPress={onCancel} accessibilityRole="button" accessibilityLabel="Kapat">
            <Text style={s.ghostText}>Kapat</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (staged.kind === 'ambiguous') {
    return (
      <View style={s.card}>
        <EmbeddedFiligree source={DECOR.cornerAstrolabe} size={96} opacity={0.14} />
        <Text style={s.title}>Hangisini kastettin?</Text>
        <Text style={s.body}>Birden fazla alışkanlık eşleşti. Yanlışına işlememek için soruyorum.</Text>
        <View style={s.chipWrap}>
          {staged.candidates.map((h) => (
            <TouchableOpacity
              key={h.id}
              style={s.chip}
              onPress={() => onPickCandidate?.(h)}
              accessibilityRole="button"
              accessibilityLabel={`${h.name} alışkanlığını seç`}
            >
              <Text style={s.chipText}>{h.name}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <View style={s.row}>
          <TouchableOpacity style={s.ghostBtn} onPress={onCancel} accessibilityRole="button" accessibilityLabel="Vazgeç">
            <Text style={s.ghostText}>Vazgeç</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (staged.kind === 'unitMismatch') {
    return (
      <View style={s.card}>
        <EmbeddedFiligree source={DECOR.cornerAstrolabe} size={96} opacity={0.14} />
        <Text style={s.title}>Birim uyuşmuyor</Text>
        <Text style={s.body}>
          “{staged.habit.name}” {staged.habit.unit ?? '—'} cinsinden ölçülüyor, sen “{staged.unit}” dedin.
          Yanlış birime yazmamak için soruyorum: {staged.value} {staged.habit.unit ?? ''} olarak mı işleyeyim?
        </Text>
        <View style={s.row}>
          <TouchableOpacity
            style={[s.primaryBtn, busy && s.btnDisabled]}
            onPress={onConfirm}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={`${staged.value} ${staged.habit.unit ?? ''} olarak işle`}
            accessibilityState={{ disabled: !!busy, busy: !!busy }}
          >
            {busy ? <ActivityIndicator size="small" color={colors.white} /> : <Text style={s.primaryText}>Öyle işle</Text>}
          </TouchableOpacity>
          <TouchableOpacity style={s.ghostBtn} onPress={onCancel} disabled={busy} accessibilityRole="button" accessibilityLabel="Vazgeç">
            <Text style={s.ghostText}>Vazgeç</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (staged.kind === 'clarify') {
    const habit = staged.habits[staged.index];
    return (
      <View style={s.card}>
        <EmbeddedFiligree source={DECOR.cornerAstrolabe} size={96} opacity={0.14} />
        <Text style={s.title}>Bir şey eksik</Text>
        {!!habit && <ClarifyBody habit={habit} missing={staged.missing} onClarify={onClarify} />}
        <View style={s.row}>
          <TouchableOpacity style={s.ghostBtn} onPress={onCancel} accessibilityRole="button" accessibilityLabel="Vazgeç">
            <Text style={s.ghostText}>Vazgeç</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (staged.kind === 'log') {
    const today = new Date();
    const t = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const y = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
    const yStr = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, '0')}-${String(y.getDate()).padStart(2, '0')}`;
    return (
      <View style={s.card}>
        <EmbeddedFiligree source={DECOR.cornerAstrolabe} size={96} opacity={0.14} />
        <Text style={s.title}>Kaydı onayla</Text>
        {/* The four facts the user is actually consenting to. `Sonuç` is the
            engine's verdict on the value, shown BEFORE the write so "10 of 20"
            is visibly partial rather than discovered later in the habit list. */}
        <View style={s.factRow}><Text style={s.factKey}>Alışkanlık</Text><Text style={s.factVal}>{staged.habit.name}</Text></View>
        <View style={s.factRow}><Text style={s.factKey}>Tarih</Text><Text style={s.factVal}>{dateLabel(staged.date, t, yStr)}</Text></View>
        <View style={s.factRow}><Text style={s.factKey}>Durum</Text><Text style={s.factVal}>{describeCompletion(staged.completion, staged.habit)}</Text></View>
        <View style={s.factRow}><Text style={s.factKey}>Sonuç</Text><Text style={s.factVal}>{stateLabel(staged.derived)}</Text></View>
        <View style={s.row}>
          <TouchableOpacity
            style={[s.primaryBtn, busy && s.btnDisabled]}
            onPress={onConfirm}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel="Kaydı işle"
            accessibilityState={{ disabled: !!busy, busy: !!busy }}
          >
            {busy ? <ActivityIndicator size="small" color={colors.white} /> : <Text style={s.primaryText}>İşle</Text>}
          </TouchableOpacity>
          <TouchableOpacity style={s.ghostBtn} onPress={onCancel} disabled={busy} accessibilityRole="button" accessibilityLabel="Vazgeç">
            <Text style={s.ghostText}>Vazgeç</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // proposal
  const activate = staged.evaluation?.toActivate ?? [];
  const queue = staged.evaluation?.toQueue ?? [];
  return (
    <View style={s.card}>
      <Text style={s.title}>{staged.title}</Text>
      <Text style={s.body}>{staged.habits.length} alışkanlık eklenecek:</Text>
      {staged.habits.map((h) => (
        <HabitFacts
          key={h.name}
          habit={h}
          badge={queue.includes(h.name) ? 'queued' : activate.includes(h.name) ? 'active' : undefined}
        />
      ))}
      {queue.length > 0 && (
        // Not a warning: queueing is the capacity engine protecting the day,
        // and saying so is more honest than silently activating everything.
        <Text style={s.note}>Günlük yükü aşanlar “sırada” olarak eklenir, kapasite açılınca aktifleşir.</Text>
      )}
      <View style={s.row}>
        <TouchableOpacity
          style={[s.primaryBtn, busy && s.btnDisabled]}
          onPress={onConfirm}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel="Onayla ve alışkanlıkları ekle"
          accessibilityState={{ disabled: !!busy, busy: !!busy }}
        >
          {busy ? <ActivityIndicator size="small" color={colors.white} /> : <Text style={s.primaryText}>Onayla ve Ekle</Text>}
        </TouchableOpacity>
        <TouchableOpacity style={s.ghostBtn} onPress={onCancel} disabled={busy} accessibilityRole="button" accessibilityLabel="Vazgeç">
          <Text style={s.ghostText}>Vazgeç</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    alignSelf: 'stretch',
    backgroundColor: hexA(colors.surface, 0.94), overflow: 'hidden', position: 'relative',
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    gap: 8,
  },
  cardWarn: { backgroundColor: alphaHex(colors.error, '12'), borderColor: alphaHex(colors.error, '30') },
  title: { fontSize: 15, fontWeight: '700', color: colors.text },
  body: { fontSize: 13, color: colors.textDim, lineHeight: 18 },
  note: { fontSize: 12, color: colors.textFaint, lineHeight: 17 },
  warnTitle: { fontSize: 14, fontWeight: '700', color: colors.error },
  warnText: { fontSize: 12, color: colors.error, lineHeight: 17 },
  factRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  factKey: { fontSize: 12, color: colors.textFaint },
  factVal: { fontSize: 14, color: colors.text, fontWeight: '600', flexShrink: 1 },
  habitBlock: { gap: 2, paddingVertical: 4, borderTopWidth: 1, borderTopColor: colors.borderSubtle },
  habitMeta: { fontSize: 12, color: colors.textDim },
  active: { fontSize: 11, color: colors.success, fontWeight: '700' },
  queued: { fontSize: 11, color: colors.warning, fontWeight: '700' },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    borderWidth: 1, borderColor: colors.border, borderRadius: 999,
    paddingHorizontal: 12, paddingVertical: 7, backgroundColor: colors.surfaceAlt,
    minHeight: 36, justifyContent: 'center',
  },
  chipText: { fontSize: 13, color: colors.text, fontWeight: '600' },
  dayChip: {
    borderWidth: 1, borderColor: colors.border, borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 7, backgroundColor: colors.surfaceAlt,
    minWidth: 44, minHeight: 36, alignItems: 'center', justifyContent: 'center',
  },
  dayChipOn: { borderColor: colors.primary, backgroundColor: alphaHex(colors.primary, '22') },
  dayChipTextOn: { color: colors.primary },
  customRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  customNum: {
    borderWidth: 1, borderColor: colors.border, borderRadius: 8, minWidth: 64, minHeight: 40,
    paddingHorizontal: 10, color: colors.text, fontSize: 14,
  },
  customUnit: {
    borderWidth: 1, borderColor: colors.border, borderRadius: 8, flex: 1, minHeight: 40,
    paddingHorizontal: 10, color: colors.text, fontSize: 14,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 },
  primaryBtn: {
    backgroundColor: colors.primary, borderRadius: 10,
    paddingHorizontal: 16, paddingVertical: 10, minHeight: 44,
    alignItems: 'center', justifyContent: 'center', flexGrow: 1,
  },
  btnDisabled: { opacity: 0.6 },
  primaryText: { color: colors.white, fontWeight: '700', fontSize: 14 },
  ghostBtn: { paddingHorizontal: 14, paddingVertical: 10, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  ghostText: { color: colors.textDim, fontWeight: '600', fontSize: 14 },
});
