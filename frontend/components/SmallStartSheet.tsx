/**
 * R03.03 & U04 — "Küçük başla": write or review the first concrete step of a
 * piece of work, optionally capture a quick topic, shrink or swap the
 * suggestion, and start a short focus session for it.
 *
 * The parent is shown, never completed or shrunk by starting/finishing this step.
 */
import { useCallback, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  SHRINK_MINUTE_STEPS,
  deterministicSuggestionId,
  type ActionSuggestion,
} from '../lib/actionSuggestion';
import { CLARIFICATION_QUESTION, buildFallbackFirstStep } from '../lib/aiFirstStepAdapter';
import { FLOW_COPY } from '../lib/flowCopy';
import {
  MAX_STEP_TITLE,
  SMALL_STEP_MINUTES,
  draftFor,
  normalizeSuggestionId,
  stepPlaceholder,
  validateSmallStep,
  type SmallStepDraft,
  type SmallStepParent,
} from '../lib/smallStart';
import { describeEstimateSource } from '../lib/taskDuration';
import type { Task } from '../lib/taskTypes';
import { hexA, onColor, radius, space, type Palette } from '../lib/tokens';
import { TEXTURES } from '../lib/visualAssets';
import { useSpeechInput } from '../hooks/useSpeechInput';
import { useThemeColors, useThemedStyles } from '../hooks/useThemeColors';
import { TexturedSurface } from './ui';

export interface SmallStartSheetProps {
  parent: SmallStepParent | null;
  onClose: () => void;
  /** Start the step. Returns false when it could not start (e.g. a session is already open). */
  onStart: (parent: SmallStepParent, draft: SmallStepDraft) => boolean;
  suggestion?: ActionSuggestion | null;
  onShrink?: () => void;
  onSwap?: () => void;
  allowQuickCapture?: boolean;
  clarificationCandidates?: readonly { id: string; title: string }[];
  onSelectCandidate?: (id: string) => void;
  openTasks?: readonly Task[];
  userId?: string | null;
  localDayKey?: string;
  calmNote?: string;
}

function resolveValidSmallStepMinutes(suggestion?: ActionSuggestion | null): number {
  if (!suggestion) return 10;
  if (suggestion.estimate.source === 'none' || suggestion.estimate.minutes === null) {
    return 5;
  }
  if (suggestion.estimate.isMissingEstimate && suggestion.estimate.minutes >= 15) {
    return 5;
  }
  const raw = suggestion.estimate.minutes;
  for (let i = SMALL_STEP_MINUTES.length - 1; i >= 0; i -= 1) {
    if (SMALL_STEP_MINUTES[i] <= raw) {
      return SMALL_STEP_MINUTES[i];
    }
  }
  return SMALL_STEP_MINUTES[0];
}

function buildInitialDraft(
  parent: SmallStepParent | null,
  suggestion?: ActionSuggestion | null,
): SmallStepDraft {
  if (!parent) return { title: '', minutes: 10 };
  if (suggestion) {
    return {
      title: suggestion.firstStepTitle,
      minutes: resolveValidSmallStepMinutes(suggestion),
      suggestionId: suggestion.suggestionId,
    };
  }
  return draftFor(parent);
}

function stepDownSmallMinutes(current: number): number {
  for (const step of SHRINK_MINUTE_STEPS) {
    if (step < current) return step;
  }
  return SMALL_STEP_MINUTES[0];
}

function suggestionSignature(suggestion?: ActionSuggestion | null): string | null {
  if (!suggestion) return null;
  return `${suggestion.suggestionId}|${suggestion.estimate.minutes ?? 'null'}|${suggestion.firstStepTitle}`;
}

function formatEstimateSourceNote(suggestion: ActionSuggestion): string {
  if (suggestion.estimate.isMissingEstimate || suggestion.estimate.source === 'none') {
    return `${describeEstimateSource('none')} · varsayılan 5 dk seçildi, değiştirebilirsin`;
  }
  const label = describeEstimateSource(suggestion.estimate.source);
  if (suggestion.estimate.minutes !== null) {
    return `${label} · ${suggestion.estimate.minutes} dk`;
  }
  return label;
}

export default function SmallStartSheet({
  parent,
  onClose,
  onStart,
  suggestion,
  onShrink,
  onSwap,
  allowQuickCapture,
  clarificationCandidates,
  onSelectCandidate,
  openTasks,
  userId,
  localDayKey,
  calmNote,
}: SmallStartSheetProps) {
  const colors = useThemeColors();
  const s = useThemedStyles(makeStyles);

  const curSig = suggestionSignature(suggestion);
  const [prevParent, setPrevParent] = useState<SmallStepParent | null>(parent);
  const [prevSig, setPrevSig] = useState<string | null>(curSig);
  const [draft, setDraft] = useState<SmallStepDraft>(() => buildInitialDraft(parent, suggestion));
  const [captureText, setCaptureText] = useState('');
  const [capturedParent, setCapturedParent] = useState<SmallStepParent | null>(null);
  const [localCandidates, setLocalCandidates] = useState<readonly { id: string; title: string }[]>([]);
  const [error, setError] = useState<string | null>(null);

  if (prevParent !== parent) {
    setPrevParent(parent);
    setPrevSig(curSig);
    setCaptureText('');
    setCapturedParent(null);
    setLocalCandidates([]);
    setError(null);
    if (parent) {
      setDraft(buildInitialDraft(parent, suggestion));
    }
  } else if (prevSig !== curSig) {
    const prevId = prevSig ? prevSig.split('|')[0] : null;
    setPrevSig(curSig);
    if (parent && suggestion) {
      if (prevId === suggestion.suggestionId) {
        const clamped = Math.min(draft.minutes, resolveValidSmallStepMinutes(suggestion));
        setDraft((d) => ({
          ...d,
          minutes: clamped,
          suggestionId: suggestion.suggestionId,
        }));
      } else {
        setCaptureText('');
        setCapturedParent(null);
        setLocalCandidates([]);
        setDraft(buildInitialDraft(parent, suggestion));
      }
      setError(null);
    }
  }

  const showQuickCapture = Boolean(allowQuickCapture || parent?.id === 'draft');
  const resolvedDayKey = localDayKey ?? suggestion?.localDayKey ?? '2026-01-01';
  const resolvedUserId = (userId ?? suggestion?.userId ?? 'local') || 'local';

  const applyQuickCapture = useCallback(
    (rawText: string) => {
      setCaptureText(rawText);
      setError(null);
      const trimmed = rawText.trim();
      if (!trimmed) {
        setCapturedParent(null);
        setLocalCandidates([]);
        if (parent) {
          setDraft(buildInitialDraft(parent, suggestion));
        }
        return;
      }

      const fallback = buildFallbackFirstStep(
        {
          userId: resolvedUserId,
          localDayKey: resolvedDayKey,
          requestId: 'small-start-quick-capture',
          userPrompt: trimmed,
          openTasks: openTasks ?? [],
        },
        'offline',
      );

      if (fallback.ambiguousCandidates.length > 1) {
        setLocalCandidates(
          fallback.ambiguousCandidates.map((c) => ({ id: c.id, title: c.title })),
        );
      } else {
        setLocalCandidates([]);
      }

      const nextParent: SmallStepParent = {
        kind: 'task',
        id: fallback.taskId ?? 'draft',
        title: fallback.parentTitle,
      };
      const nextSuggestionId = deterministicSuggestionId({
        userId: userId ?? suggestion?.userId ?? null,
        localDayKey: resolvedDayKey,
        kind: 'start_small',
        sourceEntity: fallback.taskId ? 'task' : 'draft',
        sourceId: fallback.taskId ?? 'draft',
        stepTitle: fallback.stepTitle,
      });

      setCapturedParent(nextParent);
      setDraft((prev) => ({
        title: fallback.stepTitle,
        minutes: prev.minutes,
        suggestionId: nextSuggestionId,
      }));
    },
    [openTasks, parent, resolvedDayKey, resolvedUserId, suggestion, userId],
  );

  const speech = useSpeechInput(applyQuickCapture, {
    enabled: Boolean(parent) && showQuickCapture,
    maxLength: MAX_STEP_TITLE,
  });

  if (!parent) return null;

  const effectiveParent = capturedParent ?? parent;
  const effectiveCandidates =
    clarificationCandidates && clarificationCandidates.length > 0
      ? clarificationCandidates
      : localCandidates;
  const showSecondaryActions = Boolean(suggestion || onShrink || onSwap);
  const showMic = showQuickCapture && speech.available && !speech.blocked;

  function handleSelectCandidate(candidate: { id: string; title: string }) {
    onSelectCandidate?.(candidate.id);
    setLocalCandidates([]);
    setError(null);
    const matchedTask = (openTasks ?? []).find((t) => t.id === candidate.id);
    const fallback = buildFallbackFirstStep(
      {
        userId: resolvedUserId,
        localDayKey: resolvedDayKey,
        requestId: `candidate-${candidate.id}`,
        userPrompt: matchedTask ? matchedTask.title : candidate.title,
        openTasks: matchedTask ? [matchedTask] : [],
      },
      'offline',
    );
    const nextParent: SmallStepParent = {
      kind: 'task',
      id: candidate.id,
      title: candidate.title,
    };
    const nextSuggestionId = deterministicSuggestionId({
      userId: userId ?? suggestion?.userId ?? null,
      localDayKey: resolvedDayKey,
      kind: 'start_small',
      sourceEntity: 'task',
      sourceId: candidate.id,
      stepTitle: fallback.stepTitle,
    });
    setCapturedParent(nextParent);
    setDraft((prev) => ({
      title: fallback.stepTitle,
      minutes: prev.minutes,
      suggestionId: nextSuggestionId,
    }));
  }

  function handleShrink() {
    const stepped = stepDownSmallMinutes(draft.minutes);
    setDraft((d) => ({ ...d, minutes: stepped }));
    setError(null);
    onShrink?.();
  }

  function handleStart() {
    const resolvedSuggestionId = normalizeSuggestionId(
      draft.suggestionId ?? suggestion?.suggestionId,
    );
    const finalDraft: SmallStepDraft =
      resolvedSuggestionId !== null
        ? { title: draft.title, minutes: draft.minutes, suggestionId: resolvedSuggestionId }
        : { title: draft.title, minutes: draft.minutes };

    const check = validateSmallStep(effectiveParent, finalDraft);
    if (!check.ok) {
      setError(check.reason);
      return;
    }
    if (!onStart(effectiveParent, finalDraft)) {
      setError('Devam eden bir odak oturumu var. Önce onu bitir ya da sıfırla.');
    }
  }

  const ready = draft.title.trim().length > 0;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={s.backdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={s.sheet} testID="small-start-sheet">
          <TexturedSurface source={TEXTURES.botanical} textureOpacity={0.05} overlayOnly />
          <View style={s.head}>
            <Text style={s.title} accessibilityRole="header">
              Küçük başla
            </Text>
            <TouchableOpacity
              onPress={onClose}
              style={s.iconTouch}
              accessibilityRole="button"
              accessibilityLabel="Kapat"
            >
              <Ionicons name="close" size={20} color={colors.textFaint} />
            </TouchableOpacity>
          </View>

          <ScrollView
            style={s.scrollArea}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {calmNote ? <Text style={s.calmNote}>{calmNote}</Text> : null}

            {showQuickCapture && (
              <View style={s.captureBlock} testID="small-start-capture-block">
                <Text style={s.label}>HIZLI KONU VEYA GÖREV</Text>
                <View style={s.captureRow}>
                  <TextInput
                    testID="small-start-quick-capture"
                    style={s.captureInput}
                    value={captureText}
                    onChangeText={applyQuickCapture}
                    placeholder="Örn. Rapor yaz, teklifi hazırla…"
                    placeholderTextColor={colors.textFaint}
                    maxLength={MAX_STEP_TITLE}
                    autoFocus
                    accessibilityLabel="Hızlı konu veya görev"
                  />
                  {showMic && (
                    <TouchableOpacity
                      testID="small-start-dictate"
                      style={s.iconTouch}
                      onPress={() => {
                        if (speech.listening) speech.stop();
                        else void speech.start();
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={speech.listening ? 'Dinlemeyi durdur' : 'Sesle yaz'}
                    >
                      <Ionicons
                        name={speech.listening ? 'stop-circle-outline' : 'mic-outline'}
                        size={20}
                        color={speech.listening ? colors.accent : colors.textDim}
                      />
                    </TouchableOpacity>
                  )}
                </View>
                {speech.error ? <Text style={s.hint}>{speech.error}</Text> : null}
              </View>
            )}

            {effectiveCandidates.length > 0 && (
              <View style={s.clarificationBox} testID="small-start-clarification">
                <Text style={s.clarificationQuestion}>{CLARIFICATION_QUESTION}</Text>
                <View style={s.chips}>
                  {effectiveCandidates.map((cand) => (
                    <TouchableOpacity
                      key={cand.id}
                      testID={`small-start-candidate-${cand.id}`}
                      style={s.chip}
                      onPress={() => handleSelectCandidate(cand)}
                      accessibilityRole="button"
                      accessibilityLabel={`${cand.title} görevini seç`}
                    >
                      <Text style={s.chipText} numberOfLines={1}>
                        {cand.title}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            )}

            <Text style={s.label}>ASIL İŞ</Text>
            <Text style={s.parent} testID="small-start-parent-title" numberOfLines={2}>
              {effectiveParent.title}
            </Text>

            {suggestion && !capturedParent && (
              <View style={s.reasonBox} testID="small-start-reason-box">
                <Text style={s.reasonLabel}>Neden şimdi</Text>
                <Text style={s.reasonBody} testID="small-start-display-reason">
                  {suggestion.displayReason}
                </Text>
                <Text style={s.estimateNote} testID="small-start-estimate-note">
                  {formatEstimateSourceNote(suggestion)}
                </Text>
              </View>
            )}

            <Text style={s.label}>İLK ADIM</Text>
            <TextInput
              testID="small-start-step-input"
              style={s.input}
              value={draft.title}
              onChangeText={(nextTitle) => {
                setDraft((d) => ({ ...d, title: nextTitle }));
                setError(null);
              }}
              placeholder={stepPlaceholder(effectiveParent)}
              placeholderTextColor={colors.textFaint}
              maxLength={MAX_STEP_TITLE}
              autoFocus={!showQuickCapture}
              accessibilityLabel="İlk adım"
            />
            <Text style={s.hint}>{FLOW_COPY.firstStep}</Text>

            <Text style={s.label}>SÜRE</Text>
            <View style={s.chips}>
              {SMALL_STEP_MINUTES.map((m) => (
                <TouchableOpacity
                  key={m}
                  testID={`small-start-min-${m}`}
                  style={[s.chip, draft.minutes === m && s.chipOn]}
                  onPress={() => {
                    setDraft((d) => ({ ...d, minutes: m }));
                    setError(null);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`${m} dakika`}
                  accessibilityState={{ selected: draft.minutes === m }}
                >
                  <Text style={[s.chipText, draft.minutes === m && s.chipTextOn]}>{m} dk</Text>
                </TouchableOpacity>
              ))}
            </View>

            {showSecondaryActions && (
              <View style={s.secondaryRow}>
                <TouchableOpacity
                  testID="small-start-shrink"
                  style={s.secondaryBtn}
                  onPress={handleShrink}
                  accessibilityRole="button"
                  accessibilityLabel="Daha küçük yap"
                >
                  <Ionicons name="contract-outline" size={15} color={colors.accent} />
                  <Text style={s.secondaryBtnText}>Daha küçük yap</Text>
                </TouchableOpacity>

                {onSwap && (
                  <TouchableOpacity
                    testID="small-start-swap"
                    style={s.secondaryBtn}
                    onPress={() => {
                      setError(null);
                      onSwap();
                    }}
                    accessibilityRole="button"
                    accessibilityLabel="Öneriyi değiştir"
                  >
                    <Ionicons name="swap-horizontal-outline" size={15} color={colors.textDim} />
                    <Text style={s.secondaryBtnText}>Değiştir</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}

            <Text style={s.note} testID="small-start-guarantee">
              Bu adım asıl işi tamamlamaz ya da küçültmez; bittiğinde yalnız bu odak oturumu kaydedilir.
            </Text>

            {error && (
              <Text style={s.error} testID="small-start-error" accessibilityRole="alert">
                {error}
              </Text>
            )}
          </ScrollView>

          <TouchableOpacity
            testID="small-start-submit"
            style={[s.cta, !ready && s.ctaOff]}
            onPress={handleStart}
            disabled={!ready}
            accessibilityRole="button"
            accessibilityLabel={`${draft.minutes} dakika başlat`}
            accessibilityState={{ disabled: !ready }}
          >
            <Ionicons name="play" size={16} color={onColor(colors.accent)} />
            <Text style={s.ctaText}>{draft.minutes} dk başlat</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    backdrop: {
      flex: 1,
      justifyContent: 'flex-end',
      backgroundColor: hexA(colors.black, 0.55),
    },
    sheet: {
      backgroundColor: colors.bgElevated,
      borderTopLeftRadius: radius.lg,
      borderTopRightRadius: radius.lg,
      padding: space.lg,
      gap: 6,
      overflow: 'hidden',
      position: 'relative',
      maxHeight: '88%',
    },
    scrollArea: {
      flexGrow: 0,
    },
    head: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: space.xs,
    },
    iconTouch: {
      minWidth: 44,
      minHeight: 44,
      alignItems: 'center',
      justifyContent: 'center',
    },
    title: { fontSize: 18, fontWeight: '700', color: colors.text },
    calmNote: {
      fontSize: 13,
      color: colors.textDim,
      lineHeight: 18,
      marginBottom: space.xs,
    },
    captureBlock: {
      marginBottom: space.xs,
      gap: 4,
    },
    captureRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.xs,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.md,
      paddingLeft: space.md,
      paddingRight: space.xs,
      backgroundColor: colors.surface,
      minHeight: 44,
    },
    captureInput: {
      flex: 1,
      color: colors.text,
      fontSize: 14,
      paddingVertical: space.sm,
    },
    clarificationBox: {
      marginTop: space.xs,
      padding: space.md,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      gap: space.sm,
    },
    clarificationQuestion: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.text,
    },
    label: {
      fontSize: 10,
      letterSpacing: 1,
      color: colors.textFaint,
      fontWeight: '700',
      marginTop: space.sm,
      marginBottom: 2,
    },
    parent: { fontSize: 14, color: colors.textDim, fontWeight: '600' },
    reasonBox: {
      marginTop: space.sm,
      padding: space.md,
      borderRadius: radius.md,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      gap: 4,
    },
    reasonLabel: {
      fontSize: 11,
      fontWeight: '700',
      color: colors.accent,
    },
    reasonBody: {
      fontSize: 13,
      color: colors.text,
      lineHeight: 18,
    },
    estimateNote: {
      fontSize: 12,
      color: colors.textFaint,
      lineHeight: 16,
    },
    input: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.md,
      padding: space.md,
      color: colors.text,
      fontSize: 15,
      minHeight: 44,
    },
    hint: { fontSize: 12, color: colors.textFaint, lineHeight: 17, marginTop: 4 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: 4 },
    chip: {
      minHeight: 44,
      paddingVertical: 8,
      paddingHorizontal: 14,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    chipOn: { borderColor: colors.accent, backgroundColor: colors.surfaceAlt },
    chipText: { fontSize: 13, color: colors.textDim, fontWeight: '600' },
    chipTextOn: { color: colors.text },
    secondaryRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: space.sm,
      marginTop: space.sm,
    },
    secondaryBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      minHeight: 44,
      paddingHorizontal: space.md,
      paddingVertical: space.xs,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    secondaryBtnText: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.text,
    },
    note: { fontSize: 12, color: colors.textDim, lineHeight: 17, marginTop: space.sm },
    error: { fontSize: 12, color: colors.error, marginTop: 4 },
    cta: {
      marginTop: space.md,
      minHeight: 48,
      flexDirection: 'row',
      gap: 8,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.accent,
      borderRadius: radius.md,
      paddingVertical: 14,
    },
    ctaOff: { opacity: 0.4 },
    ctaText: { color: onColor(colors.accent), fontWeight: '700', fontSize: 15 },
  });
