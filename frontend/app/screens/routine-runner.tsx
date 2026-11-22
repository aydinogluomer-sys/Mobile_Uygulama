/**
 * R05.02 — the routine runner: pick a template, then one step at a time.
 *
 * Only the user completes a step: a timed step whose time runs out says so
 * and waits. A skipped step is not done; any step's mark can be changed from
 * the list. Edits made here (add, remove, reorder, re-time) change THIS
 * session; "Şablona uygula" is the separate, explicit act that writes them
 * to the template as a new version (a built-in becomes the user's copy).
 *
 * R05.05 (partial): the next step is announced to the screen reader and a
 * time-up gives one haptic.
 */
import { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, AccessibilityInfo, AppState } from 'react-native';
import { confirm } from '../../lib/dialog';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRoutineRunnerStore } from '../../store/routineRunnerStore';
import { useHabitStore } from '../../store/habitStore';
import { currentStep, latestVersion, stepActiveMs, summarize, timeUp, validateStep, type StepKind } from '../../lib/routineRunner';
import { isMeasurableTracking } from '../../lib/habitEngine';
import { colors, space, radius, alphaHex, hexA } from '../../lib/tokens';
import { haptic } from '../../lib/haptics';
import { EditorialBanner, EmblemMedallion } from '../../components/ui';
import { AtmosphericScreenCanvas, ChapterDivider, EmbeddedFiligree } from '../../components/spatial';
import { CANVASES, DECOR, FOCUS_COMPLETE_GONG, SCREEN_BANNERS, TEXTURES } from '../../lib/visualAssets';

const mmss = (ms: number) => {
  const t = Math.max(0, Math.round(ms / 1000));
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
};

export default function RoutineRunnerScreen() {
  const st = useRoutineRunnerStore();
  const { habits } = useHabitStore();
  const [, setTick] = useState(0);
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftKind, setDraftKind] = useState<StepKind>('check');
  const [draftMin, setDraftMin] = useState(5);
  const [draftHabit, setDraftHabit] = useState<string | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);
  const announcedFor = useRef<string | null>(null);
  const buzzedFor = useRef<string | null>(null);

  useEffect(() => { void st.hydrate(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const s = st.session;
  const running = s?.status === 'running';

  // Re-render each second while running; the time itself comes from the clock.
  useEffect(() => {
    if (!running) return;
    let n = 0;
    const id = setInterval(() => {
      setTick((cnt) => cnt + 1);
      n += 1;
      if (n % 15 === 0) useRoutineRunnerStore.getState().heartbeat();
    }, 1000);
    const sub = AppState.addEventListener('change', (next) => { if (next !== 'active') useRoutineRunnerStore.getState().heartbeat(); });
    return () => { clearInterval(id); sub.remove(); };
  }, [running]);

  const step = s ? currentStep(s) : undefined;
  const now = Date.now();
  const up = s && running ? timeUp(s, now) : false;

  useEffect(() => {
    if (step && announcedFor.current !== step.id) {
      announcedFor.current = step.id;
      AccessibilityInfo.announceForAccessibility(`Sıradaki adım: ${step.title}`);
    }
  }, [step]);
  useEffect(() => {
    if (up && step && buzzedFor.current !== step.id) {
      buzzedFor.current = step.id;
      try { haptic.warning(); } catch { /* yoksay */ }
    }
  }, [up, step]);

  const linkable = habits.filter((h) => h.status === 'active' && !isMeasurableTracking(h.tracking_type));

  // ---- Act 1: no session — pick a template ----
  if (!s) {
    return (
      <SafeAreaView style={x.safe} edges={['bottom']}>
        <AtmosphericScreenCanvas
          source={CANVASES.runnerZenGarden}
          textureSource={TEXTURES.botanical}
          scrim={0.58}
          tintColor={colors.accent}
        />
        <ScrollView contentContainerStyle={x.scroll}>
          <EditorialBanner
            source={SCREEN_BANNERS.runnerSteppingStones}
            textureSource={TEXTURES.botanical}
            eyebrow="ADIM ADIM AKIŞ"
            title="Rutin Yürütücü"
            subtitle="Tek seferde tek bir adım; acele etmeden ritmini tamamla."
            accentColor={colors.accent}
            minHeight={96}
          />
          <Text style={x.h1} accessibilityRole="header">Rutin başlat</Text>
          {st.allTemplates().map((t) => {
            const verSteps = latestVersion(t).steps;
            return (
              <TouchableOpacity
                key={t.id}
                style={x.card}
                activeOpacity={0.82}
                onPress={() => { haptic.light(); st.start(t.id); }}
                accessibilityRole="button"
                accessibilityLabel={`${t.name} rutinini başlat, ${verSteps.length} adım`}
              >
                <EmbeddedFiligree source={DECOR.cornerBotanical} anchor="bottom-right" size={108} opacity={0.16} />
                <View style={{ flex: 1, gap: 4 }}>
                  <View style={x.templateTitleRow}>
                    <Text style={x.cardTitle}>{t.name}{t.builtIn ? '' : ' · bu cihazda'}</Text>
                    <View style={x.stepCountPill}>
                      <Text style={x.stepCountText}>{verSteps.length} adım</Text>
                    </View>
                  </View>
                  <Text style={x.cardSub}>{verSteps.map((p) => p.title).join(' · ')}</Text>
                </View>
                <Ionicons name="play-circle" size={30} color={colors.accent} />
              </TouchableOpacity>
            );
          })}
          {st.history.length > 0 && (
            <>
              <ChapterDivider source={DECOR.dividerSundial} label="SON OTURUMLAR" accentColor={colors.accent} />
              {st.history.slice(0, 5).map((h) => (
                <View key={h.id} style={x.histCard}>
                  <Text style={x.hist}>
                    {h.templateName}: {h.summary.done}/{h.summary.total} yapıldı · {h.summary.skipped} geçildi · {Math.round(h.summary.activeMs / 60000)} dk aktif
                  </Text>
                </View>
              ))}
            </>
          )}
          <Text style={x.note}>Kendi düzenlediğin şablonlar şimdilik yalnız bu cihazda saklanır (sunucu güncellemesi bekleniyor).</Text>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ---- Act 3: finished — ceremonial summary ----
  if (s.status === 'finished') {
    const sum = summarize(s);
    return (
      <SafeAreaView style={x.safe} edges={['bottom']}>
        <AtmosphericScreenCanvas
          source={CANVASES.runnerZenGarden}
          textureSource={TEXTURES.botanical}
          scrim={0.56}
          tintColor={colors.success}
        />
        <ScrollView contentContainerStyle={x.scroll}>
          <View style={x.ceremonyCard}>
            <EmbeddedFiligree source={DECOR.guillocheWave} anchor="full-bleed" opacity={0.14} />
            <EmblemMedallion
              source={FOCUS_COMPLETE_GONG}
              size={76}
              unlocked
              accentColor={colors.accent}
            />
            <Text style={x.h1} accessibilityRole="header">{s.templateName} bitti</Text>
            <Text style={x.big}>{sum.done}/{sum.total} adım yapıldı</Text>
            <Text style={[x.cardSub, { textAlign: 'center' }]}>
              {sum.skipped} geçildi · {sum.open} işaretlenmedi · {Math.round(sum.activeMs / 60000)} dk aktif (molalar hariç)
            </Text>
            {st.logged.length > 0 && (
              <Text style={[x.cardSub, { color: colors.success, fontWeight: '600' }]}>
                {st.logged.length} alışkanlık bugün için yapıldı olarak kaydedildi.
              </Text>
            )}
          </View>
          {s.edited && (
            <TouchableOpacity style={x.secondary} onPress={() => st.applyToTemplate()} accessibilityRole="button" accessibilityLabel="Bu oturumdaki değişiklikleri şablona uygula">
              <Text style={x.secondaryText}>Değişiklikleri şablona uygula</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={x.primary} onPress={() => st.discard()} accessibilityRole="button" accessibilityLabel="Kapat">
            <Text style={x.primaryText}>Kapat</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ---- Act 2: running / paused — Zen Stepping-Stone Stage ----
  const marked = Object.keys(s.results).length;
  const elapsed = stepActiveMs(s, now);
  const remaining = step?.kind === 'timed' && step.durationSec ? step.durationSec * 1000 - elapsed : null;

  const remainingTotalMs = s.steps.reduce((acc, p, idx) => {
    if (s.results[p.id]) return acc;
    if (idx === s.index) {
      if (p.kind === 'timed' && p.durationSec) return acc + Math.max(0, p.durationSec * 1000 - elapsed);
      return acc + 120000;
    }
    return acc + ((p.kind === 'timed' && p.durationSec ? p.durationSec : 120) * 1000);
  }, 0);
  const etaDate = new Date(now + remainingTotalMs);
  const etaLabel = `${String(etaDate.getHours()).padStart(2, '0')}:${String(etaDate.getMinutes()).padStart(2, '0')}`;

  function addDraft() {
    const d = { title: draftTitle, kind: draftKind, durationSec: draftKind === 'timed' ? draftMin * 60 : undefined, habitId: draftHabit };
    const v = validateStep(d);
    if (!v.ok) { setDraftError(v.reason); return; }
    st.addStep(d);
    setDraftTitle(''); setDraftHabit(null); setDraftError(null);
  }

  return (
    <SafeAreaView style={x.safe} edges={['bottom']}>
      <AtmosphericScreenCanvas
        source={CANVASES.runnerZenGarden}
        textureSource={TEXTURES.botanical}
        scrim={0.56}
        tintColor={colors.accent}
      />
      <ScrollView contentContainerStyle={x.scroll}>
        <View style={x.topStatusRow}>
          <View style={{ flex: 1 }}>
            <Text style={x.label}>{s.templateName.toLocaleUpperCase('tr-TR')} · {marked}/{s.steps.length}{s.status === 'paused' ? ' · DURAKLATILDI' : ''}</Text>
            <Text style={x.etaBadge}>⏱ Tahmini Bitiş: {etaLabel} (~{Math.max(1, Math.ceil(remainingTotalMs / 60000))} dk kaldı)</Text>
          </View>
        </View>

        {/* Görsel Basamak Taşları (Stepping-Stone Path) */}
        <View style={x.stonePathRow}>
          {s.steps.map((p, idx) => {
            const mark = s.results[p.id]?.mark;
            const isCurrent = idx === s.index;
            return (
              <View
                key={p.id}
                style={[
                  x.stoneNode,
                  mark === 'done' && x.stoneNodeDone,
                  mark === 'skipped' && x.stoneNodeSkipped,
                  isCurrent && x.stoneNodeCurrent,
                ]}
              />
            );
          })}
        </View>

        {step ? (
          <View style={x.stepCard} accessible accessibilityLabel={`Sıradaki adım: ${step.title}`}>
            <EmbeddedFiligree source={DECOR.cornerBotanical} anchor="bottom-right" size={136} opacity={0.17} />
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={x.stepEyebrow}>SIRADAKİ ADIM · {s.index + 1}/{s.steps.length}</Text>
              {step.kind === 'timed' && (
                <TouchableOpacity
                  style={x.extendBtn}
                  onPress={() => { haptic.light(); st.setDuration(step.id, (step.durationSec ?? 60) + 120); }}
                  accessibilityRole="button"
                  accessibilityLabel="Bu adıma 2 dakika ekle"
                >
                  <Ionicons name="time-outline" size={13} color={colors.accent} />
                  <Text style={x.extendBtnText}>+2 Dk Uzat</Text>
                </TouchableOpacity>
              )}
            </View>
            <Text style={x.stepTitle}>{step.title}</Text>
            <Text style={[x.timer, up && { color: colors.warning }]}>
              {remaining !== null ? mmss(remaining) : mmss(elapsed)}
            </Text>
            {up && <Text style={x.upNote}>Süre doldu. Tamamlamak sana kalmış — yaptıysan işaretle.</Text>}
            <View style={x.row}>
              <TouchableOpacity style={x.primary} onPress={() => { haptic.success(); void st.complete(); }} accessibilityRole="button" accessibilityLabel="Adımı tamamla">
                <Text style={x.primaryText}>Tamamla</Text>
              </TouchableOpacity>
            </View>
            <View style={x.row}>
              <TouchableOpacity style={x.ghost} onPress={() => st.back()} disabled={s.index === 0} accessibilityRole="button" accessibilityLabel="Önceki adıma dön"><Text style={x.ghostText}>Geri</Text></TouchableOpacity>
              <TouchableOpacity style={x.ghost} onPress={() => (running ? st.pause() : st.resume())} accessibilityRole="button" accessibilityLabel={running ? 'Duraklat' : 'Sürdür'}><Text style={x.ghostText}>{running ? 'Duraklat' : 'Sürdür'}</Text></TouchableOpacity>
              <TouchableOpacity style={x.ghost} onPress={() => st.skip()} accessibilityRole="button" accessibilityLabel="Adımı geç; yapılmış sayılmaz"><Text style={x.ghostText}>Geç</Text></TouchableOpacity>
            </View>
          </View>
        ) : (
          <Text style={x.cardSub}>Bütün adımlar işaretlendi.</Text>
        )}

        <View style={x.listHead}>
          <Text style={x.label}>ADIMLAR</Text>
          <TouchableOpacity onPress={() => setEditing((e) => !e)} accessibilityRole="button" accessibilityLabel={editing ? 'Düzenlemeyi bitir' : 'Bu oturumu düzenle'}>
            <Text style={x.link}>{editing ? 'Bitti' : 'Bu oturumu düzenle'}</Text>
          </TouchableOpacity>
        </View>
        {s.steps.map((p, i) => {
          const r = s.results[p.id];
          const icon = r?.mark === 'done' ? 'checkmark-circle' : r?.mark === 'skipped' ? 'remove-circle-outline' : 'ellipse-outline';
          const nextMark = r?.mark === 'done' ? 'skipped' : r?.mark === 'skipped' ? null : 'done';
          return (
            <View key={p.id} style={[x.stepRow, i === s.index && x.stepRowNow]}>
              <TouchableOpacity onPress={() => st.mark(p.id, nextMark)} accessibilityRole="button"
                accessibilityLabel={`${p.title}: ${r?.mark === 'done' ? 'yapıldı' : r?.mark === 'skipped' ? 'geçildi' : 'açık'}. Değiştirmek için dokun.`}>
                <Ionicons name={icon} size={20} color={r?.mark === 'done' ? colors.success : colors.textFaint} />
              </TouchableOpacity>
              <Text style={x.stepRowTitle} numberOfLines={1}>{p.title}{p.kind === 'timed' && p.durationSec ? ` · ${Math.round(p.durationSec / 60)} dk` : ''}{p.habitId ? ' · alışkanlık' : ''}</Text>
              {editing && (
                <View style={x.editRow}>
                  {p.kind === 'timed' && (
                    <>
                      <TouchableOpacity onPress={() => st.setDuration(p.id, Math.max(60, (p.durationSec ?? 60) - 60))} accessibilityRole="button" accessibilityLabel={`${p.title} süresini bir dakika azalt`}><Ionicons name="remove" size={18} color={colors.textDim} /></TouchableOpacity>
                      <TouchableOpacity onPress={() => st.setDuration(p.id, (p.durationSec ?? 0) + 60)} accessibilityRole="button" accessibilityLabel={`${p.title} süresini bir dakika artır`}><Ionicons name="add" size={18} color={colors.textDim} /></TouchableOpacity>
                    </>
                  )}
                  <TouchableOpacity onPress={() => st.moveStep(p.id, -1)} accessibilityRole="button" accessibilityLabel={`${p.title} yukarı`}><Ionicons name="arrow-up" size={18} color={colors.textDim} /></TouchableOpacity>
                  <TouchableOpacity onPress={() => st.moveStep(p.id, 1)} accessibilityRole="button" accessibilityLabel={`${p.title} aşağı`}><Ionicons name="arrow-down" size={18} color={colors.textDim} /></TouchableOpacity>
                  <TouchableOpacity onPress={() => st.removeStep(p.id)} accessibilityRole="button" accessibilityLabel={`${p.title} adımını bu oturumdan çıkar`}><Ionicons name="close" size={18} color={colors.textFaint} /></TouchableOpacity>
                </View>
              )}
            </View>
          );
        })}

        {editing && (
          <View style={x.addBox}>
            <TextInput style={x.input} value={draftTitle} onChangeText={(t) => { setDraftTitle(t); setDraftError(null); }}
              placeholder="Yeni adım" placeholderTextColor={colors.textFaint} maxLength={80} accessibilityLabel="Yeni adım adı" />
            <View style={x.row}>
              {(['check', 'timed'] as const).map((k) => (
                <TouchableOpacity key={k} style={[x.chip, draftKind === k && x.chipOn]} onPress={() => setDraftKind(k)} accessibilityRole="button" accessibilityState={{ selected: draftKind === k }}>
                  <Text style={x.chipText}>{k === 'check' ? 'İşaretle' : `Süreli · ${draftMin} dk`}</Text>
                </TouchableOpacity>
              ))}
              {draftKind === 'timed' && (
                <>
                  <TouchableOpacity onPress={() => setDraftMin((m) => Math.max(1, m - 1))} accessibilityRole="button" accessibilityLabel="Bir dakika azalt"><Ionicons name="remove" size={18} color={colors.textDim} /></TouchableOpacity>
                  <TouchableOpacity onPress={() => setDraftMin((m) => Math.min(180, m + 1))} accessibilityRole="button" accessibilityLabel="Bir dakika artır"><Ionicons name="add" size={18} color={colors.textDim} /></TouchableOpacity>
                </>
              )}
            </View>
            {linkable.length > 0 && (
              <ScrollView horizontal contentContainerStyle={{ gap: space.sm }}>
                {linkable.map((h) => (
                  <TouchableOpacity key={h.id} style={[x.chip, draftHabit === h.id && x.chipOn]} onPress={() => setDraftHabit((c) => (c === h.id ? null : h.id))}
                    accessibilityRole="button" accessibilityState={{ selected: draftHabit === h.id }} accessibilityLabel={`${h.name} alışkanlığına bağla`}>
                    <Text style={x.chipText}>{h.name}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}
            {draftError && <Text style={x.error} accessibilityRole="alert">{draftError}</Text>}
            <TouchableOpacity style={x.secondary} onPress={addDraft} accessibilityRole="button" accessibilityLabel="Adımı bu oturuma ekle"><Text style={x.secondaryText}>Bu oturuma ekle</Text></TouchableOpacity>
            <Text style={x.note}>Bu değişiklikler yalnız bu oturum için. Şablona yazmak bitişte ayrıca sorulur.</Text>
          </View>
        )}

        {st.error && <Text style={x.error} accessibilityRole="alert">{st.error}</Text>}

        <TouchableOpacity style={x.finish}
          onPress={async () => {
            if (await confirm({ title: 'Rutini bitir', message: 'İşaretlenmemiş adımlar işaretlenmemiş kalır.', confirmText: 'Bitir' })) {
              st.finish();
            }
          }}
          accessibilityRole="button" accessibilityLabel="Rutini bitir">
          <Text style={x.finishText}>Bitir</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const x = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { width: '100%', maxWidth: 840, alignSelf: 'center', padding: space.lg, gap: space.sm, paddingBottom: space.xxl },
  h1: { fontSize: 22, fontWeight: '700', color: colors.text, marginBottom: space.xs },
  big: { fontSize: 28, fontWeight: '700', color: colors.text },
  label: { fontSize: 10, letterSpacing: 1, fontWeight: '700', color: colors.textFaint, marginTop: space.md },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md,
    overflow: 'hidden', position: 'relative',
    borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    backgroundColor: hexA(colors.bgElevated, 0.92),
  },
  templateTitleRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' },
  stepCountPill: {
    paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.full,
    backgroundColor: hexA(colors.accent, 0.14), borderWidth: 1, borderColor: hexA(colors.accent, 0.34),
  },
  stepCountText: { fontSize: 10.5, fontWeight: '700', color: colors.accent },
  cardTitle: { fontSize: 15, fontWeight: '700', color: colors.text },
  cardSub: { fontSize: 12, color: colors.textDim, lineHeight: 17 },
  histCard: {
    paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.md,
    backgroundColor: hexA(colors.surface, 0.85), borderWidth: 1, borderColor: colors.borderSubtle,
  },
  hist: { fontSize: 12, color: colors.textDim },
  note: { fontSize: 12, color: colors.textFaint, lineHeight: 17, marginTop: space.sm },
  ceremonyCard: {
    alignItems: 'center', gap: space.sm, padding: space.xl,
    overflow: 'hidden', position: 'relative',
    borderRadius: radius.xl, borderWidth: 1, borderColor: hexA(colors.accent, 0.38),
    backgroundColor: hexA(colors.bgElevated, 0.92), marginVertical: space.sm,
  },
  stonePathRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginVertical: space.xs,
  },
  stoneNode: {
    flex: 1, height: 6, borderRadius: radius.full,
    backgroundColor: hexA(colors.surfaceAlt, 0.9), borderWidth: 1, borderColor: colors.border,
  },
  stoneNodeDone: {
    backgroundColor: colors.success, borderColor: colors.success,
  },
  stoneNodeSkipped: {
    backgroundColor: hexA(colors.textGhost, 0.4), borderColor: colors.textGhost,
  },
  stoneNodeCurrent: {
    height: 9, backgroundColor: colors.accent, borderColor: colors.accent,
  },
  stepCard: {
    padding: space.lg, borderRadius: radius.lg,
    overflow: 'hidden', position: 'relative',
    backgroundColor: hexA(colors.bgElevated, 0.94), borderWidth: 1, borderColor: hexA(colors.accent, 0.34),
    gap: space.sm,
  },
  stepEyebrow: { fontSize: 10, letterSpacing: 1, fontWeight: '700', color: colors.accent },
  stepTitle: { fontSize: 22, fontWeight: '700', color: colors.text },
  timer: { fontSize: 44, fontWeight: '700', color: colors.text, fontVariant: ['tabular-nums'] },
  upNote: { fontSize: 13, color: colors.warning },
  row: { flexDirection: 'row', gap: space.sm, alignItems: 'center', flexWrap: 'wrap' },
  primary: { flex: 1, alignItems: 'center', backgroundColor: colors.accent, borderRadius: radius.md, paddingVertical: 14, marginTop: space.sm },
  primaryText: { color: colors.bg, fontWeight: '700', fontSize: 15 },
  secondary: { alignItems: 'center', borderWidth: 1, borderColor: colors.accent, borderRadius: radius.md, paddingVertical: 12, marginTop: space.sm },
  secondaryText: { color: colors.accent, fontWeight: '700' },
  ghost: { flex: 1, alignItems: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: 10, backgroundColor: hexA(colors.surface, 0.6) },
  ghostText: { color: colors.textDim, fontWeight: '600' },
  listHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  link: { fontSize: 12, color: colors.accent, fontWeight: '700', marginTop: space.md },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: 10, paddingHorizontal: space.sm, borderRadius: radius.sm, borderBottomWidth: 1, borderBottomColor: colors.borderSubtle },
  stepRowNow: { backgroundColor: hexA(colors.surfaceAlt, 0.9) },
  stepRowTitle: { flex: 1, fontSize: 14, color: colors.text },
  editRow: { flexDirection: 'row', gap: space.sm },
  addBox: { gap: space.sm, marginTop: space.md, padding: space.md, borderRadius: radius.md, backgroundColor: hexA(colors.surface, 0.9), borderWidth: 1, borderColor: colors.border },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: space.md, color: colors.text },
  chip: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  chipOn: { borderColor: colors.accent, backgroundColor: colors.surfaceAlt },
  chipText: { fontSize: 12, color: colors.textDim },
  error: { fontSize: 12, color: colors.error },
  finish: { alignItems: 'center', marginTop: space.xl, paddingVertical: 12 },
  finishText: { color: colors.textFaint, fontWeight: '700' },
  topStatusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  etaBadge: { fontSize: 12, fontWeight: '600', color: colors.accent, marginTop: 3 },
  extendBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.sm,
    backgroundColor: alphaHex(colors.accent, '15'), borderWidth: 1, borderColor: alphaHex(colors.accent, '35'),
  },
  extendBtnText: { fontSize: 11, fontWeight: '700', color: colors.accent },
});
