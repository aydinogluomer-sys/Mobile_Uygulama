import { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { space, radius, font, onColor, type Palette } from '../lib/tokens';
import { useThemeColors, useThemedStyles } from '../hooks/useThemeColors';
import { haptic } from '../lib/haptics';
import {
  parseQuickAdd,
  type QuickAddFields,
  type QuickAddProject,
  type QuickAddResult,
  type QuickAddTokenKind,
} from '../lib/taskQuickAdd';
import { splitAtSelection, useSpeechInput } from '../hooks/useSpeechInput';
import Chip from './ui/Chip';
import IconButton from './ui/IconButton';

export type InlineComposerProps = {
  placeholder?: string;
  /** Ham başlık ve (quickAdd açıksa) çip alanları. İkinci parametre yoksa davranış bugünküyle aynıdır. */
  onSubmit?: (title: string, quick?: QuickAddFields) => void | Promise<void>;
  /** Yapılandırılmış ayrıştırma çıktısını doğrudan almak isteyen çağıranlar için isteğe bağlı geri çağrı. */
  onSubmitTask?: (parsed: QuickAddResult) => void | Promise<void>;
  /** Verilirse canlı çip önizlemesi açılır ve gönderilen başlık çıkarılmış başlıktır. */
  quickAdd?: boolean | { projects?: readonly QuickAddProject[]; now?: () => Date };
  /** quickAdd={true} kısa yazımıyla kullanılabilen isteğe bağlı aktif proje listesi. */
  projects?: readonly QuickAddProject[];
  /** true: mikrofon düğmesi (yalnız destek varsa ve izin kalıcı reddedilmemişse). */
  voice?: boolean;
};

const KIND_LABELS: Readonly<Record<QuickAddTokenKind, string>> = {
  date: 'Tarih',
  time: 'Saat',
  duration: 'Süre',
  priority: 'Öncelik',
  project: 'Proje',
};

const KIND_ICONS: Readonly<Record<QuickAddTokenKind, keyof typeof Ionicons.glyphMap>> = {
  date: 'calendar-outline',
  time: 'time-outline',
  duration: 'timer-outline',
  priority: 'flag-outline',
  project: 'folder-outline',
};

/** Modalsız tek-satır hızlı ekleyici — Enter veya gönder düğmesi ile ekler; isteğe bağlı Türkçe çip ve dikte destekler. */
export default function InlineComposer({
  placeholder = 'Hızlı görev ekle…',
  onSubmit,
  onSubmitTask,
  quickAdd,
  projects,
  voice,
}: InlineComposerProps) {
  const c = useThemeColors();
  const s = useThemedStyles(makeStyles);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() => new Set());

  const valueRef = useRef('');
  const selectionRef = useRef<{ start: number; end: number } | null>(null);

  useEffect(() => {
    valueRef.current = value;
    if (!value) selectionRef.current = null;
  }, [value]);

  const speech = useSpeechInput(setValue, {
    enabled: Boolean(voice),
    getBase: () => splitAtSelection(valueRef.current, selectionRef.current),
    maxLength: 200,
  });

  const quickEnabled = Boolean(quickAdd);
  const resolvedProjects = useMemo(() => {
    if (typeof quickAdd === 'object' && quickAdd !== null && quickAdd.projects) {
      return quickAdd.projects;
    }
    return projects ?? [];
  }, [quickAdd, projects]);

  const nowFn = typeof quickAdd === 'object' && quickAdd !== null ? quickAdd.now : undefined;

  const parsed = useMemo(() => {
    if (!quickEnabled || !value.trim()) return null;
    const now = nowFn ? nowFn() : new Date();
    return parseQuickAdd(value, { now, projects: resolvedProjects }, dismissed);
  }, [quickEnabled, value, nowFn, resolvedProjects, dismissed]);

  function handleChangeText(next: string) {
    valueRef.current = next;
    if (!next) selectionRef.current = null;
    setValue(next);
    if (!next.trim() && dismissed.size > 0) {
      setDismissed(new Set());
    }
  }

  async function submit() {
    const t = value.trim();
    if (!t || busy) return;
    setBusy(true);
    try {
      if (quickEnabled) {
        const now = nowFn ? nowFn() : new Date();
        const fresh = parseQuickAdd(value, { now, projects: resolvedProjects }, dismissed);
        if (onSubmitTask) await onSubmitTask(fresh);
        if (onSubmit) await onSubmit(fresh.title, fresh.fields);
      } else {
        if (onSubmitTask) await onSubmitTask({ title: t, fields: {}, tokens: [] });
        if (onSubmit) await onSubmit(t);
      }
      if (speech.listening) speech.stop();
      setValue('');
      selectionRef.current = null;
      if (dismissed.size > 0) setDismissed(new Set());
      haptic.light();
    } finally {
      setBusy(false);
    }
  }

  const canSubmit = value.trim().length > 0;
  const showMic = Boolean(voice) && speech.available && !speech.blocked;
  const statusLine = voice
    ? speech.listening
      ? 'Dinliyorum. Bitince mikrofona tekrar dokun.'
      : speech.error
    : null;

  return (
    <View style={s.wrap}>
      <View style={s.row}>
        <Ionicons
          name="add-outline"
          size={18}
          color={c.textFaint}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        />
        <TextInput
          style={s.input}
          value={value}
          onChangeText={handleChangeText}
          onSelectionChange={(e) => {
            selectionRef.current = e.nativeEvent.selection;
          }}
          placeholder={placeholder}
          placeholderTextColor={c.textFaint}
          returnKeyType="done"
          onSubmitEditing={submit}
          blurOnSubmit={false}
          maxLength={200}
        />
        {showMic && (
          <IconButton
            icon={speech.listening ? 'stop' : 'mic-outline'}
            size={18}
            color={speech.listening ? c.accent : c.textDim}
            label={speech.listening ? 'Dinlemeyi durdur' : 'Sesle ekle'}
            hint="Söylediklerin yazı kutusuna geçer; eklemeden önce düzenleyebilirsin"
            selected={speech.listening}
            disabled={busy}
            onPress={() => {
              if (speech.listening) speech.stop();
              else void speech.start();
            }}
          />
        )}
        {canSubmit && (
          <TouchableOpacity
            onPress={submit}
            disabled={busy}
            style={s.addBtn}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Görevi ekle"
            accessibilityState={{ disabled: busy }}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          >
            <Ionicons name="arrow-up" size={16} color={onColor(c.primary)} />
          </TouchableOpacity>
        )}
      </View>

      {parsed && parsed.tokens.length > 0 && (
        <View style={s.chipRow} accessibilityLiveRegion="polite">
          {parsed.tokens.map((tok) => (
            <Chip
              key={tok.key}
              icon={KIND_ICONS[tok.kind]}
              label={`${tok.label} ×`}
              color={c.accent}
              onPress={() => {
                haptic.select();
                setDismissed((prev) => {
                  const next = new Set(prev);
                  next.add(tok.key);
                  return next;
                });
              }}
              accessibilityLabel={`${KIND_LABELS[tok.kind]}: ${tok.label}. Kaldırmak için çift dokun.`}
              style={s.chip}
            />
          ))}
        </View>
      )}

      {statusLine ? (
        <Text style={s.statusText} accessibilityLiveRegion="polite">
          {statusLine}
        </Text>
      ) : null}
    </View>
  );
}

function makeStyles(c: Palette) {
  return StyleSheet.create({
    wrap: {
      gap: space.xs,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.sm,
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: radius.md,
      paddingHorizontal: space.md,
      paddingVertical: space.xs,
      minHeight: 44,
    },
    input: {
      flex: 1,
      ...font.body,
      color: c.text,
      paddingVertical: space.xs,
    },
    addBtn: {
      minWidth: 44,
      minHeight: 44,
      borderRadius: radius.sm,
      backgroundColor: c.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    chipRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: space.xs,
      paddingTop: space.xs,
    },
    chip: {
      minHeight: 44,
    },
    statusText: {
      ...font.caption,
      color: c.textDim,
      paddingHorizontal: space.xs,
    },
  });
}
