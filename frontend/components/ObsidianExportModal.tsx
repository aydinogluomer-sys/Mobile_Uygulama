import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, Modal, TouchableOpacity, ScrollView, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, alphaHex, radius, space, font } from '../lib/tokens';
import { useHabitStore } from '../store/habitStore';
import { useTaskStore } from '../store/taskStore';
import { useJournalStore } from '../store/journalStore';
import { loadDay } from '../services/habitLogService';
import { collectAllNotes } from '../services/exportService';
import { CLIPBOARD_WIPE_MS, copyTextWithWipe } from '../lib/shareFile';
import {
  MD_PREVIEW_CHARS,
  buildDailyNote,
  buildHabitsCatalog,
  buildNotesVault,
  containsPersonalText,
  isMarkdownEmpty,
  previewOf,
  type MdLog,
  type MdNote,
  type ObsidianKind,
} from '../lib/obsidianMarkdown';
import { todayLocal } from '../lib/date';
import { haptic } from '../lib/haptics';
import { EmbeddedFiligree } from './spatial';
import { DECOR } from '../lib/visualAssets';

interface ObsidianExportModalProps {
  visible: boolean;
  onClose: () => void;
}

type Load = { state: 'idle' | 'loading' | 'ready' | 'error'; error: string | null };

const LOAD_ERROR_TEXT = 'Veriler yüklenemedi; bağlantını kontrol edip yeniden dene.';

export default function ObsidianExportModal({ visible, onClose }: ObsidianExportModalProps) {
  const { habits, fetchHabits } = useHabitStore();
  const { tasks, hasMore: tasksHasMore, fetchTasks } = useTaskStore();
  const { entries, fetchEntries } = useJournalStore();

  const [exportType, setExportType] = useState<ObsidianKind>('daily');
  const [copied, setCopied] = useState(false);
  const [copying, setCopying] = useState(false);
  const [load, setLoad] = useState<Load>({ state: 'idle', error: null });
  const [confirming, setConfirming] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [todayLogs, setTodayLogs] = useState<MdLog[]>([]);
  const [vaultNotes, setVaultNotes] = useState<MdNote[]>([]);
  const [vaultComplete, setVaultComplete] = useState(true);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runId = useRef(0);

  const loadFor = useCallback(async (kind: ObsidianKind, myRun: number): Promise<Load> => {
    try {
      if (kind === 'daily') {
        const [, , , dayRes] = await Promise.all([
          fetchHabits(),
          fetchTasks(),
          fetchEntries(),
          loadDay(todayLocal()),
        ]);
        if (!dayRes.ok) return { state: 'error', error: LOAD_ERROR_TEXT };
        if (runId.current === myRun) {
          setTodayLogs(dayRes.logs.map((l) => ({ habit_id: l.habit_id, state: l.state })));
        }
        return { state: 'ready', error: null };
      }
      if (kind === 'all_habits') {
        await fetchHabits();
        return { state: 'ready', error: null };
      }
      const res = await collectAllNotes();
      if (!res.ok) {
        if (runId.current === myRun) {
          setVaultNotes([]);
          setVaultComplete(false);
        }
        return { state: 'error', error: LOAD_ERROR_TEXT };
      }
      if (runId.current === myRun) {
        setVaultNotes(
          res.data.rows.map((r) => ({
            id: String(r.id ?? ''),
            title: r.title == null ? null : String(r.title),
            content: String(r.content ?? ''),
            created_at: r.created_at == null ? null : String(r.created_at),
          })),
        );
        setVaultComplete(!res.data.truncated);
      }
      return { state: 'ready', error: null };
    } catch {
      return { state: 'error', error: LOAD_ERROR_TEXT };
    }
  }, [fetchEntries, fetchHabits, fetchTasks]);

  const triggerLoad = useCallback((kind: ObsidianKind) => {
    const my = ++runId.current;
    setLoad({ state: 'loading', error: null });
    setConfirming(false);
    setStatus(null);
    void loadFor(kind, my).then((res) => {
      if (runId.current === my) setLoad(res);
    });
  }, [loadFor]);

  useEffect(() => {
    if (!visible) {
      runId.current += 1;
      setConfirming(false);
      setStatus(null);
      return;
    }
    triggerLoad(exportType);
    return () => {
      runId.current += 1;
      if (copiedTimer.current) {
        clearTimeout(copiedTimer.current);
        copiedTimer.current = null;
      }
    };
  }, [visible, exportType, triggerLoad]);

  const today = todayLocal();
  const todayJournal = useMemo(() => {
    const found = entries.find((e) => e.date === today);
    return found ? { date: found.date, content: found.content, mood: found.mood ?? null } : null;
  }, [entries, today]);

  const markdownContent = useMemo(() => {
    if (exportType === 'daily') {
      return buildDailyNote({
        today,
        habits,
        todayLogs,
        tasks,
        tasksComplete: !tasksHasMore,
        journal: todayJournal,
      });
    }
    if (exportType === 'all_habits') {
      return buildHabitsCatalog({
        nowIso: `${today}T00:00:00.000Z`,
        habits,
      });
    }
    return buildNotesVault({
      today,
      notes: vaultNotes,
      complete: vaultComplete,
    });
  }, [exportType, habits, tasks, tasksHasMore, today, todayJournal, todayLogs, vaultComplete, vaultNotes]);

  const empty = useMemo(
    () => isMarkdownEmpty(exportType, { habits, notes: vaultNotes }),
    [exportType, habits, vaultNotes],
  );
  const needsConfirm = useMemo(
    () => containsPersonalText(exportType, { journal: todayJournal, notes: vaultNotes }),
    [exportType, todayJournal, vaultNotes],
  );
  const preview = useMemo(() => previewOf(markdownContent, MD_PREVIEW_CHARS), [markdownContent]);
  const disabled = load.state !== 'ready' || empty || copying;

  async function onCopyPress() {
    if (disabled) return;
    if (needsConfirm && !confirming) {
      setConfirming(true);
      return;
    }
    setCopying(true);
    const res = await copyTextWithWipe(markdownContent, { wipeAfterMs: CLIPBOARD_WIPE_MS });
    setCopying(false);
    setConfirming(false);
    if (!res.ok) {
      setStatus(res.error);
      return;
    }
    haptic.success();
    setCopied(true);
    setStatus('Panoya kopyalandı. Obsidian kasanda bir nota yapıştırabilirsin; pano 60 sn sonra temizlenmeye çalışılır.');
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => {
      copiedTimer.current = null;
      setCopied(false);
    }, 2000);
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.backdrop}>
        <View style={s.card}>
          <EmbeddedFiligree source={DECOR.obsidianPrism} anchor="top-right" opacity={0.18} size={138} />
          {/* Header */}
          <View style={s.header}>
            <View style={s.headerLeft}>
              <View style={s.iconBox}>
                <Ionicons name="document-text" size={22} color={colors.accent} />
              </View>
              <View>
                <Text style={s.title}>Obsidian Markdown Aktarımı</Text>
                <Text style={s.sub}>Obsidian Vault ile uyumlu Markdown çıktısı</Text>
              </View>
            </View>
            <TouchableOpacity onPress={onClose} style={s.closeBtn} accessibilityRole="button" accessibilityLabel="Kapat">
              <Ionicons name="close" size={20} color={colors.textFaint} />
            </TouchableOpacity>
          </View>

          {/* Dışa Aktarma Tipi Seçimi */}
          <View style={s.tabRow}>
            {(
              [
                { key: 'daily', label: 'Bugünün Notu' },
                { key: 'all_habits', label: 'Alışkanlıklar' },
                { key: 'notes_vault', label: 'Tüm Notlar' },
              ] as const
            ).map((tab) => {
              const active = exportType === tab.key;
              return (
                <TouchableOpacity
                  key={tab.key}
                  style={[s.tabBtn, active && s.tabBtnActive]}
                  onPress={() => {
                    haptic.select();
                    setExportType(tab.key);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={tab.label}
                >
                  <Text style={[s.tabText, active && s.tabTextActive]}>{tab.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={s.plainNotice}>Bu içerik panoya düz metin olarak kopyalanır.</Text>

          {load.state === 'loading' && (
            <View style={s.loadingRow}>
              <ActivityIndicator size="small" color={colors.accent} />
              <Text style={s.statusText}>Notlar yükleniyor.</Text>
            </View>
          )}

          {load.state === 'error' && (
            <View style={s.noticeBox} accessibilityRole="alert">
              <Text style={s.errorText}>{load.error}</Text>
              <TouchableOpacity
                style={s.secondaryBtn}
                onPress={() => triggerLoad(exportType)}
                accessibilityRole="button"
                accessibilityLabel="Yeniden dene"
              >
                <Text style={s.secondaryBtnText}>Yeniden dene</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Önizleme Alanı */}
          <View style={s.previewHeader}>
            <Text style={s.previewLabel}>MARKDOWN ÖNİZLEME</Text>
            <Text style={s.charCount}>{markdownContent.length} karakter</Text>
          </View>
          <View style={s.previewWrap}>
            <EmbeddedFiligree source={DECOR.obsidianPrism} anchor="bottom-right" opacity={0.12} size={110} />
            <ScrollView style={s.previewBox} contentContainerStyle={{ padding: space.sm }}>
              <Text style={s.codeText}>{preview.text}</Text>
              {preview.hiddenChars > 0 && (
                <Text style={s.truncNotice}>
                  +{preview.hiddenChars} karakter daha var; kopya tam metni içerir.
                </Text>
              )}
            </ScrollView>
          </View>

          {load.state === 'ready' && empty && (
            <Text style={s.statusText}>
              {exportType === 'all_habits' ? 'Dışa aktarılacak alışkanlık yok.' : 'Dışa aktarılacak not yok.'}
            </Text>
          )}

          {confirming && (
            <View style={s.noticeBox} accessibilityRole="alert">
              <Text style={s.noticeText}>
                Günlük ve not içeriğin panoya düz metin olarak kopyalanacak. Pano diğer uygulamalar ve klavye yöneticileri tarafından okunabilir. Devam edersen 60 sn sonra, başka bir şey kopyalamadıysan, pano temizlenmeye çalışılır.
              </Text>
              <View style={s.confirmActions}>
                <TouchableOpacity
                  style={s.secondaryBtn}
                  onPress={() => setConfirming(false)}
                  accessibilityRole="button"
                  accessibilityLabel="Vazgeç"
                >
                  <Text style={s.secondaryBtnText}>Vazgeç</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[s.secondaryBtn, s.confirmBtn]}
                  onPress={() => { void onCopyPress(); }}
                  accessibilityRole="button"
                  accessibilityLabel="Yine de kopyala"
                >
                  <Text style={s.confirmBtnText}>Yine de kopyala</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {status !== null && (
            <Text style={s.statusText} accessibilityLiveRegion="polite">{status}</Text>
          )}

          {/* Alt Aksiyon Butonu */}
          <TouchableOpacity
            style={[s.copyBtn, copied && s.copyBtnDone, disabled && s.copyBtnDisabled]}
            onPress={() => { void onCopyPress(); }}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityLabel="Obsidian Markdown formatında panoya kopyala"
            accessibilityHint={
              load.state === 'loading'
                ? 'Notlar yükleniyor'
                : empty
                  ? 'Dışa aktarılacak not yok'
                  : undefined
            }
            accessibilityState={{ disabled }}
          >
            <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={18} color={colors.white} />
            <Text style={s.copyBtnText}>
              {copied ? 'Kopyalandı!' : 'Obsidian Markdown Kopyala'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'flex-end',
  },
  card: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.lg,
    paddingBottom: space.xxl,
    gap: space.sm,
    maxHeight: '88%',
    overflow: 'hidden',
    position: 'relative',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    flex: 1,
  },
  iconBox: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: alphaHex(colors.accent, '20'),
  },
  title: {
    ...font.title,
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
  },
  sub: {
    ...font.caption,
    color: colors.textDim,
    marginTop: 1,
  },
  closeBtn: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },

  tabRow: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    padding: 4,
    gap: 4,
  },
  tabBtn: {
    flex: 1,
    minHeight: 44,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
  },
  tabBtnActive: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tabText: {
    fontSize: 12,
    color: colors.textFaint,
    fontWeight: '600',
  },
  tabTextActive: {
    color: colors.text,
    fontWeight: '700',
  },

  plainNotice: {
    fontSize: 11,
    color: colors.textFaint,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statusText: {
    fontSize: 12,
    color: colors.textDim,
    lineHeight: 17,
  },
  errorText: {
    fontSize: 12,
    color: colors.error,
    lineHeight: 17,
  },
  noticeBox: {
    gap: 8,
    padding: space.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
  },
  noticeText: {
    fontSize: 12,
    color: colors.textDim,
    lineHeight: 17,
  },
  confirmActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    flexWrap: 'wrap',
  },
  secondaryBtn: {
    minHeight: 44,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textDim,
  },
  confirmBtn: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  confirmBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.white,
  },

  previewHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 2,
  },
  previewLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: colors.textFaint,
    letterSpacing: 1,
  },
  charCount: {
    fontSize: 10,
    color: colors.textFaint,
  },
  previewWrap: {
    backgroundColor: colors.bg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    position: 'relative',
  },
  previewBox: {
    maxHeight: 210,
  },
  codeText: {
    fontFamily: 'monospace',
    fontSize: 11,
    color: colors.textDim,
    lineHeight: 16,
  },
  truncNotice: {
    marginTop: 6,
    fontSize: 11,
    color: colors.textFaint,
    fontStyle: 'italic',
  },

  copyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 48,
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: space.md,
    marginTop: 4,
  },
  copyBtnDone: {
    backgroundColor: colors.success,
  },
  copyBtnDisabled: {
    opacity: 0.5,
  },
  copyBtnText: {
    color: colors.white,
    fontWeight: '700',
    fontSize: 14,
  },
});
