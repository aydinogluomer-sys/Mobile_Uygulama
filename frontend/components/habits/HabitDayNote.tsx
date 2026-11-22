import { useEffect, useRef, useState, type JSX } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { font, radius, space, type Palette } from '../../lib/tokens';
import { useThemeColors, useThemedStyles } from '../../hooks/useThemeColors';
import Button from '../ui/Button';
import {
  NOTE_COUNTER_FROM,
  NOTE_MAX_LENGTH,
  markNoteHintSeen,
  normalizeNote,
  readNoteHintSeen,
} from '../../lib/habitNote';

export type HabitDayNoteProps = {
  variant: 'inline' | 'offer';
  dayLabel: string;
  initial: string | null;
  userId: string | null;
  onSave: (note: string | null) => Promise<{ ok: true } | { ok: false; error: string }>;
  onDismiss: () => void;
};

const TOUCH_MIN = space.hh + space.xs; // 44dp
const DEFAULT_ERROR = 'Not kaydedilemedi. Bağlantını kontrol edip tekrar dene.';

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    box: {
      gap: space.sm,
      padding: space.sm,
      borderRadius: radius.md,
      backgroundColor: c.surfaceAlt,
      borderWidth: 1,
      borderColor: c.border,
    },
    hint: {
      ...font.caption,
      color: c.textDim,
    },
    input: {
      ...font.bodySm,
      color: c.text,
      backgroundColor: c.surface,
      borderRadius: radius.sm,
      borderWidth: 1,
      borderColor: c.border,
      paddingHorizontal: space.md,
      paddingVertical: space.sm,
      minHeight: TOUCH_MIN,
    },
    metaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: space.sm,
    },
    counter: {
      ...font.caption,
      color: c.textFaint,
    },
    actions: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'flex-end',
      gap: space.sm,
      flex: 1,
    },
    actionBtn: {
      minWidth: TOUCH_MIN,
      minHeight: TOUCH_MIN,
    },
    error: {
      ...font.caption,
      color: c.error,
    },
  });

export default function HabitDayNote(props: HabitDayNoteProps): JSX.Element {
  const c = useThemeColors();
  const s = useThemedStyles(makeStyles);

  const [draft, setDraft] = useState<string>(props.initial ?? '');
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showHint, setShowHint] = useState(false);

  const inFlightRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    setDraft(props.initial ?? '');
    setErrorMsg(null);
  }, [props.initial, props.dayLabel]);

  useEffect(() => {
    let cancelled = false;
    if (props.variant !== 'offer' || !props.userId) {
      setShowHint(false);
      return;
    }
    const uid = props.userId;
    void readNoteHintSeen(uid).then((seen) => {
      if (cancelled || !mountedRef.current) return;
      if (!seen) {
        setShowHint(true);
        void markNoteHintSeen(uid);
      } else {
        setShowHint(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [props.variant, props.userId]);

  function handleChangeText(raw: string) {
    const cps = Array.from(raw);
    const bounded = cps.length > NOTE_MAX_LENGTH ? cps.slice(0, NOTE_MAX_LENGTH).join('') : raw;
    setDraft(bounded);
    if (errorMsg) setErrorMsg(null);
  }

  const normalizedInitial = normalizeNote(props.initial) ?? null;
  const normalizedDraft = normalizeNote(draft) ?? null;
  const isDirty = normalizedDraft !== normalizedInitial;
  const saveDisabled = saving || !isDirty;
  const cpLen = Array.from(draft).length;

  async function handleSave() {
    if (inFlightRef.current || saveDisabled) return;
    inFlightRef.current = true;
    setSaving(true);
    setErrorMsg(null);
    try {
      const res = await props.onSave(normalizedDraft);
      if (!mountedRef.current) return;
      if (!res.ok) {
        setErrorMsg(res.error || DEFAULT_ERROR);
      }
    } catch {
      if (mountedRef.current) {
        setErrorMsg(DEFAULT_ERROR);
      }
    } finally {
      inFlightRef.current = false;
      if (mountedRef.current) {
        setSaving(false);
      }
    }
  }

  return (
    <View style={s.box}>
      {showHint && (
        <Text style={s.hint}>İstersen nedenini tek satırda yaz. Yalnız sen görürsün.</Text>
      )}
      <TextInput
        style={s.input}
        value={draft}
        onChangeText={handleChangeText}
        maxLength={NOTE_MAX_LENGTH}
        returnKeyType="done"
        onSubmitEditing={() => {
          void handleSave();
        }}
        editable={!saving}
        placeholder="Kısa bir not (isteğe bağlı)"
        placeholderTextColor={c.textFaint}
        accessibilityLabel={`Not, ${props.dayLabel}`}
      />
      {errorMsg ? (
        <Text style={s.error} accessibilityLiveRegion="polite">
          {errorMsg}
        </Text>
      ) : null}
      <View style={s.metaRow}>
        {cpLen >= NOTE_COUNTER_FROM ? (
          <Text style={s.counter}>{`${cpLen}/${NOTE_MAX_LENGTH}`}</Text>
        ) : (
          <View />
        )}
        <View style={s.actions}>
          <Button
            label="Geç"
            variant="ghost"
            size="md"
            disabled={saving}
            onPress={props.onDismiss}
            accessibilityLabel="Geç"
            style={s.actionBtn}
          />
          <Button
            label="Kaydet"
            variant="primary"
            size="md"
            disabled={saveDisabled}
            onPress={() => {
              void handleSave();
            }}
            accessibilityLabel="Kaydet"
            style={s.actionBtn}
          />
        </View>
      </View>
    </View>
  );
}
