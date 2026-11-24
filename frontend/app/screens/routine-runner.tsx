/**
 * R05.02 / F34 / U06 / U14 — the routine runner: pick a template, then one step at a time.
 *
 * Only the user completes a step: a timed step whose time runs out says so
 * and waits. A skipped step is not done; any step's mark can be changed from
 * the list. Edits made here (add, remove, reorder, re-time) change THIS
 * session; "Şablona uygula" is the separate, explicit act that writes them
 * to the template as a new version (a built-in becomes the user's copy).
 *
 * R05.05 / U14: the next step is announced to the screen reader and a
 * time-up cue respects quiet hours and screen-reader state.
 */
import { useEffect, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  AccessibilityInfo,
  AppState,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { confirm } from '../../lib/dialog';
import { toRouterHref } from '../../lib/destinations';
import { useRoutineRunnerStore } from '../../store/routineRunnerStore';
import { useHabitStore } from '../../store/habitStore';
import {
  currentStep,
  staleLogs,
  summarize,
  validateStep,
  type StepKind,
} from '../../lib/routineRunner';
import {
  DEFAULT_ROUTINE_CUE_SETTINGS,
  parseReminderQuietPrefs,
  resolveRoutineStepCue,
} from '../../lib/routineCuePolicy';
import { isMeasurableTracking } from '../../lib/habitEngine';
import { alphaHex, font, hexA, onColor, radius, space, type Palette } from '../../lib/tokens';
import { useThemeColors, useThemedStyles } from '../../hooks/useThemeColors';
import { haptic } from '../../lib/haptics';
import { Button, Chip, EditorialBanner, EmblemMedallion } from '../../components/ui';
import { AtmosphericScreenCanvas, ChapterDivider, EmbeddedFiligree } from '../../components/spatial';
import ActiveRoutinePicker from '../../components/routineRunner/ActiveRoutinePicker';
import {
  RunnerClock,
  RunnerEtaText,
  RunnerTimerText,
  RunnerTimeUp,
  useRunnerClock,
} from '../../components/routineRunner/RunnerClock';
import { CANVASES, DECOR, FOCUS_COMPLETE_GONG, SCREEN_BANNERS, TEXTURES } from '../../lib/visualAssets';
import { useTimerAnnouncements } from '../../hooks/useTimerAnnouncements';

function RunningStepAnnouncer({
  running,
  stepId,
  stepTitle,
}: {
  running: boolean;
  stepId: string;
  stepTitle: string;
}) {
  const clock = useRunnerClock();
  const secondsLeft = Math.max(0, Math.ceil((clock.remainingMs ?? 0) / 1000));
  useTimerAnnouncements({
    running,
    secondsLeft,
    phaseKey: stepId,
    phaseLabel: stepTitle,
  });
  return null;
}

function StaleLogNotice({
  habitName,
  onFix,
  onDismiss,
  styles,
}: {
  habitName: string;
  onFix: () => void;
  onDismiss: () => void;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <View style={styles.staleBox} accessibilityLiveRegion="polite">
      <Text style={styles.staleText}>
        {`“${habitName}” alışkanlığı bugün hâlâ yapıldı görünüyor; bu adımı geri aldın.`}
      </Text>
      <View style={styles.staleActions}>
        <Button
          label="Düzelt"
          variant="secondary"
          size="md"
          onPress={onFix}
          accessibilityLabel={`${habitName} alışkanlık kaydını düzelt`}
        />
        <Button
          label="Kalsın"
          variant="ghost"
          size="md"
          onPress={onDismiss}
          accessibilityLabel={`${habitName} alışkanlığı yapıldı olarak kalsın`}
        />
      </View>
    </View>
  );
}

export default function RoutineRunnerScreen() {
  const router = useRouter();
  const c = useThemeColors();
  const x = useThemedStyles(makeStyles);
  const st = useRoutineRunnerStore(
    useShallow((state) => ({
      session: state.session,
      logged: state.logged,
      staleDismissed: state.staleDismissed,
      error: state.error,
      history: state.history,
      activeTemplateId: state.activeTemplateId,
      hydrate: state.hydrate,
      dismissStale: state.dismissStale,
      allTemplates: state.allTemplates,
      start: state.start,
      setActive: state.setActive,
      applyToTemplate: state.applyToTemplate,
      discard: state.discard,
      addStep: state.addStep,
      setDuration: state.setDuration,
      complete: state.complete,
      back: state.back,
      pause: state.pause,
      resume: state.resume,
      skip: state.skip,
      mark: state.mark,
      moveStep: state.moveStep,
      removeStep: state.removeStep,
      finish: state.finish,
    })),
  );
  const habits = useHabitStore((state) => state.habits);
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftKind, setDraftKind] = useState<StepKind>('check');
  const [draftMin, setDraftMin] = useState(5);
  const [draftHabit, setDraftHabit] = useState<string | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);
  const announcedFor = useRef<string | null>(null);
  const lastTapRef = useRef(0);
  const cuePrefsRef = useRef({
    quietStart: DEFAULT_ROUTINE_CUE_SETTINGS.quietStart,
    quietEnd: DEFAULT_ROUTINE_CUE_SETTINGS.quietEnd,
    hidePrivateStepTitles: DEFAULT_ROUTINE_CUE_SETTINGS.hidePrivateStepTitles,
  });
  const screenReaderRef = useRef(false);

  const guarded = (fn: () => void) => () => {
    const t = Date.now();
    if (t - lastTapRef.current < 600) return;
    lastTapRef.current = t;
    fn();
  };

  const hydrate = st.hydrate;
  useEffect(() => { void hydrate(); }, [hydrate]);

  useEffect(() => {
    let active = true;
    AsyncStorage.getItem('reminders.settings.v1')
      .then((raw) => {
        if (active) cuePrefsRef.current = parseReminderQuietPrefs(raw);
      })
      .catch(() => {});

    if (typeof AccessibilityInfo.isScreenReaderEnabled === 'function') {
      AccessibilityInfo.isScreenReaderEnabled()
        .then((enabled) => {
          if (active) screenReaderRef.current = Boolean(enabled);
        })
        .catch(() => {});
    }
    const srSub =
      typeof AccessibilityInfo.addEventListener === 'function'
        ? AccessibilityInfo.addEventListener('screenReaderChanged', (enabled) => {
            screenReaderRef.current = Boolean(enabled);
          })
        : null;

    return () => {
      active = false;
      srSub?.remove?.();
    };
  }, []);

  const s = st.session;
  const running = s?.status === 'running';

  // Heartbeat every 15s and on backgrounding while running; 1s tick lives in RunnerClock.
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      useRoutineRunnerStore.getState().heartbeat();
    }, 15_000);
    const sub = AppState.addEventListener('change', (next) => {
      if (next !== 'active') useRoutineRunnerStore.getState().heartbeat();
    });
    return () => {
      clearInterval(id);
      sub.remove();
    };
  }, [running]);

  const step = s ? currentStep(s) : undefined;
  const nextStep = s ? s.steps[s.index + 1] : undefined;

  useEffect(() => {
    if (step && announcedFor.current !== step.id) {
      announcedFor.current = step.id;
      AccessibilityInfo.announceForAccessibility(`Sıradaki adım: ${step.title}`);
    }
  }, [step]);

  const linkable = habits.filter((h) => h.status === 'active' && !isMeasurableTracking(h.tracking_type));
  const stale = s ? staleLogs(s, st.logged, st.staleDismissed) : [];

  const renderStaleNotices = () =>
    stale.map((id) => {
      const habitName = habits.find((h) => h.id === id)?.name ?? 'Alışkanlık';
      return (
        <StaleLogNotice
          key={id}
          habitName={habitName}
          styles={x}
          onFix={() => router.push(toRouterHref({ pathname: '/screens/habit-detail', params: { id } }))}
          onDismiss={() => st.dismissStale(id)}
        />
      );
    });

  // ---- Act 1: no session — pick a template ----
  if (!s) {
    return (
      <SafeAreaView style={x.safe} edges={['bottom']}>
        <AtmosphericScreenCanvas
          source={CANVASES.runnerZenGarden}
          textureSource={TEXTURES.botanical}
          scrim={0.58}
          tintColor={c.accent}
        />
        <ScrollView contentContainerStyle={x.scroll}>
          <EditorialBanner
            source={SCREEN_BANNERS.runnerSteppingStones}
            textureSource={TEXTURES.botanical}
            eyebrow="ADIM ADIM AKIŞ"
            title="Rutin Yürütücü"
            subtitle="Tek seferde tek bir adım; acele etmeden ritmini tamamla."
            accentColor={c.accent}
            minHeight={96}
          />
          {st.error && <Text style={x.error} accessibilityRole="alert">{st.error}</Text>}
          <ActiveRoutinePicker
            templates={st.allTemplates()}
            activeTemplateId={st.activeTemplateId}
            hour={new Date().getHours()}
            onStart={(id) => {
              haptic.light();
              st.start(id);
            }}
            onSetActive={st.setActive}
          />
          {st.history.length > 0 && (
            <>
              <ChapterDivider source={DECOR.dividerSundial} label="SON OTURUMLAR" accentColor={c.accent} />
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
          tintColor={c.success}
        />
        <ScrollView contentContainerStyle={x.scroll}>
          <View style={x.ceremonyCard}>
            <EmbeddedFiligree source={DECOR.guillocheWave} anchor="full-bleed" opacity={0.14} />
            <EmblemMedallion
              source={FOCUS_COMPLETE_GONG}
              size={76}
              unlocked
              accentColor={c.accent}
            />
            <Text style={x.h1} accessibilityRole="header">{s.templateName} bitti</Text>
            <Text style={x.big}>{sum.done}/{sum.total} adım yapıldı</Text>
            <Text style={[x.cardSub, { textAlign: 'center' }]}>
              {sum.skipped} geçildi · {sum.open} işaretlenmedi · {Math.round(sum.activeMs / 60000)} dk aktif (molalar hariç)
            </Text>
            {st.logged.length > 0 && stale.length === 0 && (
              <Text style={[x.cardSub, { color: c.success, fontWeight: '600' }]}>
                {st.logged.length} alışkanlık bugün için yapıldı olarak kaydedildi.
              </Text>
            )}
          </View>
          {renderStaleNotices()}
          {s.edited && (
            <Button
              label="Değişiklikleri şablona uygula"
              variant="secondary"
              size="md"
              onPress={() => st.applyToTemplate()}
              accessibilityLabel="Bu oturumdaki değişiklikleri şablona uygula"
            />
          )}
          <Button
            label="Kapat"
            variant="primary"
            size="lg"
            onPress={() => st.discard()}
            accessibilityLabel="Kapat"
          />
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ---- Act 2: running / paused — Zen Stepping-Stone Stage ----
  const marked = Object.keys(s.results).length;

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
        tintColor={c.accent}
      />
      <RunnerClock session={s} running={Boolean(running)}>
        <ScrollView contentContainerStyle={x.scroll}>
          <View style={x.topStatusRow}>
            <View style={{ flex: 1 }}>
              <Text style={x.label}>{s.templateName.toLocaleUpperCase('tr-TR')} · {marked}/{s.steps.length}{s.status === 'paused' ? ' · DURAKLATILDI' : ''}</Text>
              <RunnerEtaText style={x.etaBadge} />
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

          {s.status === 'paused' && (
            <View
              testID="runner-paused-banner"
              style={x.pausedBanner}
              accessibilityRole="summary"
              accessibilityLiveRegion="polite"
            >
              <Ionicons name="pause-circle-outline" size={18} color={c.warning} />
              <Text style={x.pausedBannerText}>Oturum duraklatıldı — geçen süre donduruldu</Text>
            </View>
          )}

          {step ? (
            <View style={x.stepCard} accessible accessibilityLabel={`Sıradaki adım: ${step.title}`}>
              <RunningStepAnnouncer
                running={Boolean(running && step.kind === 'timed')}
                stepId={step.id}
                stepTitle={step.title}
              />
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
                    <Ionicons name="time-outline" size={13} color={c.accent} />
                    <Text style={x.extendBtnText}>+2 Dk Uzat</Text>
                  </TouchableOpacity>
                )}
              </View>
              <Text style={x.stepTitle}>{step.title}</Text>
              <RunnerTimerText style={x.timer} warnStyle={{ color: c.warning }} />
              {nextStep && (
                <Text testID="runner-next-step-preview" style={x.nextStepPreview} numberOfLines={1}>
                  {`Sonra: ${nextStep.title}`}
                </Text>
              )}
              <RunnerTimeUp
                onTimeUp={() => {
                  const nowDate = new Date();
                  const nowHm = `${String(nowDate.getHours()).padStart(2, '0')}:${String(nowDate.getMinutes()).padStart(2, '0')}`;
                  const cue = resolveRoutineStepCue({
                    stepId: step.id,
                    stepTitle: step.title,
                    remainingSec: 0,
                    nowHm,
                    event: 'time_up',
                    settings: {
                      soundCueEnabled: true,
                      hapticEnabled: true,
                      quietStart: cuePrefsRef.current.quietStart,
                      quietEnd: cuePrefsRef.current.quietEnd,
                      hidePrivateStepTitles: cuePrefsRef.current.hidePrivateStepTitles,
                      screenReaderActive: screenReaderRef.current,
                    },
                  });
                  if (cue.playHaptic) {
                    try {
                      if (cue.hapticStyle === 'light') haptic.light();
                      else haptic.warning();
                    } catch {
                      /* yoksay */
                    }
                  }
                }}
              >
                <Text style={x.upNote}>Süre doldu. Tamamlamak sana kalmış — yaptıysan işaretle.</Text>
              </RunnerTimeUp>
              <View style={x.row}>
                <TouchableOpacity
                  style={x.primary}
                  onPress={guarded(() => { haptic.success(); void st.complete(); })}
                  accessibilityRole="button"
                  accessibilityLabel="Adımı tamamla"
                >
                  <Text style={x.primaryText}>Tamamla</Text>
                </TouchableOpacity>
              </View>
              <View style={x.row}>
                <TouchableOpacity style={x.ghost} onPress={() => st.back()} disabled={s.index === 0} accessibilityRole="button" accessibilityLabel="Önceki adıma dön"><Text style={x.ghostText}>Geri</Text></TouchableOpacity>
                <TouchableOpacity style={x.ghost} onPress={() => (running ? st.pause() : st.resume())} accessibilityRole="button" accessibilityLabel={running ? 'Duraklat' : 'Sürdür'}><Text style={x.ghostText}>{running ? 'Duraklat' : 'Sürdür'}</Text></TouchableOpacity>
                <TouchableOpacity style={x.ghost} onPress={guarded(() => st.skip())} accessibilityRole="button" accessibilityLabel="Adımı geç; yapılmış sayılmaz"><Text style={x.ghostText}>Geç</Text></TouchableOpacity>
              </View>
            </View>
          ) : (
            <Text style={x.cardSub}>Bütün adımlar işaretlendi.</Text>
          )}

          {renderStaleNotices()}

          <View style={x.listHead}>
            <Text style={x.label}>ADIMLAR</Text>
            <TouchableOpacity onPress={() => setEditing((e) => !e)} accessibilityRole="button" accessibilityLabel={editing ? 'Düzenlemeyi bitir' : 'Bu oturumu düzenle'}>
              <Text style={x.link}>{editing ? 'Bitti' : 'Bu oturumu düzenle'}</Text>
            </TouchableOpacity>
          </View>
          {s.steps.map((p, i) => {
            const r = s.results[p.id];
            const icon =
              r?.mark === 'done'
                ? 'checkmark-circle'
                : r?.mark === 'skipped'
                  ? 'play-skip-forward-circle-outline'
                  : 'ellipse-outline';
            const iconColor =
              r?.mark === 'done' ? c.success : r?.mark === 'skipped' ? c.warning : c.textFaint;
            const nextMark = r?.mark === 'done' ? 'skipped' : r?.mark === 'skipped' ? null : 'done';
            return (
              <View key={p.id} style={[x.stepRow, i === s.index && x.stepRowNow]}>
                <TouchableOpacity
                  onPress={() => st.mark(p.id, nextMark)}
                  accessibilityRole="button"
                  accessibilityLabel={`${p.title}: ${r?.mark === 'done' ? 'yapıldı' : r?.mark === 'skipped' ? 'atlandı (yapılmadı)' : 'açık'}. Değiştirmek için dokun.`}
                >
                  <Ionicons name={icon} size={20} color={iconColor} />
                </TouchableOpacity>
                <Text style={x.stepRowTitle} numberOfLines={1}>{p.title}{p.kind === 'timed' && p.durationSec ? ` · ${Math.round(p.durationSec / 60)} dk` : ''}{p.habitId ? ' · alışkanlık' : ''}</Text>
                {r?.mark === 'done' && (
                  <Chip size="sm" label="Yapıldı" color={c.success} />
                )}
                {r?.mark === 'skipped' && (
                  <Chip size="sm" label="Atlandı (yapılmadı)" color={c.warning} />
                )}
                {editing && (
                  <View style={x.editRow}>
                    {p.kind === 'timed' && (
                      <>
                        <TouchableOpacity onPress={() => st.setDuration(p.id, Math.max(60, (p.durationSec ?? 60) - 60))} accessibilityRole="button" accessibilityLabel={`${p.title} süresini bir dakika azalt`}><Ionicons name="remove" size={18} color={c.textDim} /></TouchableOpacity>
                        <TouchableOpacity onPress={() => st.setDuration(p.id, (p.durationSec ?? 0) + 60)} accessibilityRole="button" accessibilityLabel={`${p.title} süresini bir dakika artır`}><Ionicons name="add" size={18} color={c.textDim} /></TouchableOpacity>
                      </>
                    )}
                    <TouchableOpacity onPress={() => st.moveStep(p.id, -1)} accessibilityRole="button" accessibilityLabel={`${p.title} yukarı`}><Ionicons name="arrow-up" size={18} color={c.textDim} /></TouchableOpacity>
                    <TouchableOpacity onPress={() => st.moveStep(p.id, 1)} accessibilityRole="button" accessibilityLabel={`${p.title} aşağı`}><Ionicons name="arrow-down" size={18} color={c.textDim} /></TouchableOpacity>
                    <TouchableOpacity onPress={() => st.removeStep(p.id)} accessibilityRole="button" accessibilityLabel={`${p.title} adımını bu oturumdan çıkar`}><Ionicons name="close" size={18} color={c.textFaint} /></TouchableOpacity>
                  </View>
                )}
              </View>
            );
          })}

          {editing && (
            <View style={x.addBox}>
              <TextInput style={x.input} value={draftTitle} onChangeText={(t) => { setDraftTitle(t); setDraftError(null); }}
                placeholder="Yeni adım" placeholderTextColor={c.textFaint} maxLength={80} accessibilityLabel="Yeni adım adı" />
              <View style={x.row}>
                {(['check', 'timed'] as const).map((k) => (
                  <TouchableOpacity key={k} style={[x.chip, draftKind === k && x.chipOn]} onPress={() => setDraftKind(k)} accessibilityRole="button" accessibilityState={{ selected: draftKind === k }} accessibilityLabel={k === 'check' ? 'İşaretle adımı' : `Süreli adım, ${draftMin} dakika`}>
                    <Text style={x.chipText}>{k === 'check' ? 'İşaretle' : `Süreli · ${draftMin} dk`}</Text>
                  </TouchableOpacity>
                ))}
                {draftKind === 'timed' && (
                  <>
                    <TouchableOpacity onPress={() => setDraftMin((m) => Math.max(1, m - 1))} accessibilityRole="button" accessibilityLabel="Bir dakika azalt"><Ionicons name="remove" size={18} color={c.textDim} /></TouchableOpacity>
                    <TouchableOpacity onPress={() => setDraftMin((m) => Math.min(180, m + 1))} accessibilityRole="button" accessibilityLabel="Bir dakika artır"><Ionicons name="add" size={18} color={c.textDim} /></TouchableOpacity>
                  </>
                )}
              </View>
              {linkable.length > 0 && (
                <ScrollView horizontal contentContainerStyle={{ gap: space.sm }}>
                  {linkable.map((h) => (
                    <TouchableOpacity key={h.id} style={[x.chip, draftHabit === h.id && x.chipOn]} onPress={() => setDraftHabit((cur) => (cur === h.id ? null : h.id))}
                      accessibilityRole="button" accessibilityState={{ selected: draftHabit === h.id }} accessibilityLabel={`${h.name} alışkanlığına bağla`}>
                      <Text style={x.chipText}>{h.name}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              )}
              {draftError && <Text style={x.error} accessibilityRole="alert">{draftError}</Text>}
              <Button
                label="Bu oturuma ekle"
                variant="secondary"
                size="md"
                onPress={addDraft}
                accessibilityLabel="Adımı bu oturuma ekle"
              />
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
      </RunnerClock>
    </SafeAreaView>
  );
}

const makeStyles = (c: Palette) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.bg },
  scroll: { width: '100%', maxWidth: 840, alignSelf: 'center', padding: space.lg, gap: space.sm, paddingBottom: space.xxl },
  h1: { ...font.title, fontWeight: '700', color: c.text, marginBottom: space.xs },
  big: { ...font.display, fontWeight: '700', color: c.text },
  label: { ...font.overline, color: c.textFaint, marginTop: space.md },
  cardSub: { ...font.caption, color: c.textDim, lineHeight: 17 },
  histCard: {
    paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.md,
    backgroundColor: hexA(c.surface, 0.85), borderWidth: 1, borderColor: c.borderSubtle,
  },
  hist: { ...font.caption, color: c.textDim },
  note: { ...font.caption, color: c.textFaint, lineHeight: 17, marginTop: space.sm },
  ceremonyCard: {
    alignItems: 'center', gap: space.sm, padding: space.xl,
    overflow: 'hidden', position: 'relative',
    borderRadius: radius.xl, borderWidth: 1, borderColor: hexA(c.accent, 0.38),
    backgroundColor: hexA(c.bgElevated, 0.92), marginVertical: space.sm,
  },
  stonePathRow: {
    flexDirection: 'row', alignItems: 'center', gap: space.xs, marginVertical: space.xs,
  },
  stoneNode: {
    flex: 1, height: 6, borderRadius: radius.full,
    backgroundColor: hexA(c.surfaceAlt, 0.9), borderWidth: 1, borderColor: c.border,
  },
  stoneNodeDone: {
    backgroundColor: c.success, borderColor: c.success,
  },
  stoneNodeSkipped: {
    backgroundColor: hexA(c.warning, 0.28), borderColor: c.warning,
  },
  stoneNodeCurrent: {
    height: 9, backgroundColor: c.accent, borderColor: c.accent,
  },
  pausedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.md,
    backgroundColor: hexA(c.warning, 0.14),
    borderWidth: 1,
    borderColor: hexA(c.warning, 0.36),
  },
  pausedBannerText: {
    flex: 1,
    ...font.bodySm,
    fontWeight: '600',
    color: c.warning,
  },
  stepCard: {
    padding: space.lg, borderRadius: radius.lg,
    overflow: 'hidden', position: 'relative',
    backgroundColor: hexA(c.bgElevated, 0.94), borderWidth: 1, borderColor: hexA(c.accent, 0.34),
    gap: space.sm,
  },
  stepEyebrow: { ...font.overline, color: c.accent },
  stepTitle: { ...font.title, fontWeight: '700', color: c.text },
  timer: { ...font.display, fontWeight: '700', color: c.text, fontVariant: ['tabular-nums'] },
  nextStepPreview: { ...font.bodySm, color: c.textDim },
  upNote: { ...font.bodySm, color: c.warning },
  row: { flexDirection: 'row', gap: space.sm, alignItems: 'center', flexWrap: 'wrap' },
  primary: {
    flex: 1, minHeight: 48, justifyContent: 'center', alignItems: 'center',
    backgroundColor: c.accent, borderRadius: radius.md, paddingVertical: space.md, marginTop: space.sm,
  },
  primaryText: { ...font.body, color: onColor(c.accent), fontWeight: '700' },
  ghost: {
    flex: 1, minHeight: 44, justifyContent: 'center', alignItems: 'center',
    borderWidth: 1, borderColor: c.border, borderRadius: radius.md, paddingVertical: space.sm,
    backgroundColor: hexA(c.surface, 0.6),
  },
  ghostText: { ...font.bodySm, color: c.textDim, fontWeight: '600' },
  listHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  link: { ...font.caption, color: c.accent, fontWeight: '700', marginTop: space.md },
  stepRow: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm,
    paddingVertical: space.sm, paddingHorizontal: space.sm,
    borderRadius: radius.sm, borderBottomWidth: 1, borderBottomColor: c.borderSubtle,
  },
  stepRowNow: { backgroundColor: hexA(c.surfaceAlt, 0.9) },
  stepRowTitle: { flex: 1, ...font.bodySm, color: c.text },
  editRow: { flexDirection: 'row', gap: space.sm },
  addBox: {
    gap: space.sm, marginTop: space.md, padding: space.md, borderRadius: radius.md,
    backgroundColor: hexA(c.surface, 0.9), borderWidth: 1, borderColor: c.border,
  },
  input: { borderWidth: 1, borderColor: c.border, borderRadius: radius.md, padding: space.md, color: c.text },
  chip: { minHeight: 44, justifyContent: 'center', paddingVertical: space.xs, paddingHorizontal: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: c.border },
  chipOn: { borderColor: c.accent, backgroundColor: c.surfaceAlt },
  chipText: { ...font.caption, color: c.textDim },
  error: { ...font.caption, color: c.error },
  finish: { minHeight: 44, justifyContent: 'center', alignItems: 'center', marginTop: space.xl, paddingVertical: space.md },
  finishText: { ...font.bodySm, color: c.textFaint, fontWeight: '700' },
  topStatusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  etaBadge: { ...font.caption, fontWeight: '600', color: c.accent, marginTop: space.xs },
  extendBtn: {
    minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: space.xs,
    paddingHorizontal: space.sm, paddingVertical: space.xs, borderRadius: radius.sm,
    backgroundColor: alphaHex(c.accent, '15'), borderWidth: 1, borderColor: alphaHex(c.accent, '35'),
  },
  extendBtnText: { ...font.caption, fontWeight: '700', color: c.accent },
  staleBox: {
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.border,
    gap: space.sm,
  },
  staleText: {
    ...font.bodySm,
    color: c.textDim,
  },
  staleActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
  },
});
