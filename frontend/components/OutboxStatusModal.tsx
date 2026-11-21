/**
 * The offline sync sheet.
 *
 * F05 (SYN-16): the message after "Şimdi Senkronize Et" is made from what is left in the queues
 * (`describeFlushOutcome`), never from the fact that the call returned: offline with 7 waiting it
 * used to say everything had been delivered. The success colour and icon appear only when the
 * queues are really empty.
 *
 * F05 (SYN-03): "Gönderilemeyenler" lists every change that will not go by itself, with a way out:
 * "Yeniden dene", and "Bu değişikliği bırak" behind an inline two-step confirmation (no
 * `Alert.alert`: it does nothing on the web). A conflict is resolved on its own screen, where both
 * versions can be seen, so its row only says so.
 */
import { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, Modal, TouchableOpacity, ActivityIndicator, ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, alphaHex, radius, space, font } from '../lib/tokens';
import {
  describeFlushOutcome,
  discardOutboxIssue,
  flushAllOutboxes,
  getUnifiedOutboxSummary,
  listOutboxIssues,
  retryOutboxIssue,
  subscribeUnifiedOutbox,
  type FlushOutcome,
  type OutboxIssue,
} from '../services/unifiedOutbox';
import { haptic } from '../lib/haptics';
import type { OutboxSummary } from '../lib/outbox';
import { countQuarantined } from '../lib/outboxStorage';
import { currentUser } from '../lib/session';
import { EmblemMedallion, TexturedSurface } from './ui';
import { EMPTY_VIGNETTES, TEXTURES } from '../lib/visualAssets';
import { useReducedMotion } from './seasonalMotion/useReducedMotion';

/** How long the "Emin misin?" state of "Bu değişikliği bırak" waits for the second tap. */
export const DISCARD_CONFIRM_MS = 4_000;
const DISCARD_LABEL = 'Bu değişikliği bırak';
const DISCARD_CONFIRM_LABEL = 'Emin misin? Dokun ve bırak';

const TONE_COLOR: Record<FlushOutcome['tone'], string> = {
  success: colors.success,
  waiting: colors.info,
  attention: colors.warning,
  auth: colors.warning,
};

interface OutboxStatusModalProps {
  visible: boolean;
  onClose: () => void;
}

export default function OutboxStatusModal({ visible, onClose }: OutboxStatusModalProps) {
  const reduceMotion = useReducedMotion();
  const [summary, setSummary] = useState<OutboxSummary>(() => getUnifiedOutboxSummary());
  const [issues, setIssues] = useState<OutboxIssue[]>(() => listOutboxIssues());
  const [isFlushing, setIsFlushing] = useState(false);
  const [flushOutcome, setFlushOutcome] = useState<FlushOutcome | null>(null);
  const [busyIssue, setBusyIssue] = useState<string | null>(null);
  const [confirmingDiscard, setConfirmingDiscard] = useState<string | null>(null);
  const [quarantined, setQuarantined] = useState(0);
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setSummary(getUnifiedOutboxSummary());
    setIssues(listOutboxIssues());
    void currentUser()
      .then((u) => (u ? countQuarantined(u.id) : 0))
      .then((n) => {
        if (!cancelled) setQuarantined(n);
      });
    const unsub = subscribeUnifiedOutbox(() => {
      setSummary(getUnifiedOutboxSummary());
      setIssues(listOutboxIssues());
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, [visible]);

  // the pending "Emin misin?" never outlives the sheet
  useEffect(() => () => {
    if (confirmTimer.current) clearTimeout(confirmTimer.current);
  }, []);
  useEffect(() => {
    if (visible) return;
    if (confirmTimer.current) clearTimeout(confirmTimer.current);
    confirmTimer.current = null;
    setConfirmingDiscard(null);
    setFlushOutcome(null);
  }, [visible]);

  async function handleFlush() {
    haptic.medium();
    setIsFlushing(true);
    setFlushOutcome(null);
    try {
      const after = await flushAllOutboxes();
      setSummary(after);
      setIssues(listOutboxIssues());
      setFlushOutcome(
        after.errors && Object.keys(after.errors).length > 0
          ? { tone: 'attention', message: 'Bazı değişiklikler gönderilemedi; kalanlar sonra tekrar denenecek.' }
          : describeFlushOutcome(after),
      );
    } catch {
      setFlushOutcome({ tone: 'attention', message: 'Senkronizasyon sırasında bir sorun oluştu.' });
    } finally {
      setIsFlushing(false);
    }
  }

  async function handleRetry(issue: OutboxIssue) {
    if (busyIssue) return;
    haptic.light();
    setBusyIssue(issue.id);
    setFlushOutcome(null);
    try {
      await retryOutboxIssue(issue);
    } finally {
      setBusyIssue(null);
      setSummary(getUnifiedOutboxSummary());
      setIssues(listOutboxIssues());
    }
  }

  async function handleDiscard(issue: OutboxIssue) {
    if (busyIssue) return;
    if (confirmingDiscard !== issue.id) {
      // first tap: ask in place; the question goes away by itself
      haptic.light();
      if (confirmTimer.current) clearTimeout(confirmTimer.current);
      setConfirmingDiscard(issue.id);
      confirmTimer.current = setTimeout(() => {
        confirmTimer.current = null;
        setConfirmingDiscard(null);
      }, DISCARD_CONFIRM_MS);
      return;
    }
    if (confirmTimer.current) clearTimeout(confirmTimer.current);
    confirmTimer.current = null;
    setConfirmingDiscard(null);
    haptic.medium();
    setBusyIssue(issue.id);
    setFlushOutcome(null);
    try {
      await discardOutboxIssue(issue);
    } finally {
      setBusyIssue(null);
      setSummary(getUnifiedOutboxSummary());
      setIssues(listOutboxIssues());
    }
  }

  const isClean = summary.pending === 0 && summary.dead === 0 && summary.conflict === 0;

  return (
    <Modal
      visible={visible}
      transparent
      animationType={reduceMotion ? 'none' : 'slide'}
      onRequestClose={onClose}
    >
      <View style={s.backdrop}>
        <View style={s.card}>
          <TexturedSurface source={TEXTURES.linen} textureOpacity={0.05} overlayOnly />
          {/* Header */}
          <View style={s.header}>
            <View style={s.headerLeft}>
              <View style={[s.iconBox, { backgroundColor: isClean ? alphaHex(colors.success, '20') : alphaHex(colors.warning, '20') }]}>
                <Ionicons
                  name={isClean ? 'cloud-done-outline' : 'cloud-offline-outline'}
                  size={22}
                  color={isClean ? colors.success : colors.warning}
                />
              </View>
              <View style={s.headerText}>
                <Text style={s.title}>Çevrimdışı Senkronizasyon</Text>
                <Text style={s.sub}>
                  {isClean ? 'Tüm verileriniz güncel ve eşleşti.' : 'Bekleyen çevrimdışı işlemler var.'}
                </Text>
                {quarantined > 0 && (
                  <Text style={s.quarantineNote} accessibilityLiveRegion="polite">
                    {`Okunamayan ${quarantined} kayıt güvenli yerde saklandı.`}
                  </Text>
                )}
              </View>
            </View>
            <TouchableOpacity onPress={onClose} style={s.closeBtn} accessibilityRole="button" accessibilityLabel="Kapat">
              <Ionicons name="close" size={20} color={colors.textFaint} />
            </TouchableOpacity>
          </View>

          {/* İstatistik Rozetleri */}
          <View style={s.statsRow}>
            <View style={s.statBox}>
              <Text style={s.statNum}>{summary.pending}</Text>
              <Text style={s.statLabel}>Bekleyen</Text>
            </View>
            <View style={s.statBox}>
              <Text style={[s.statNum, summary.dead > 0 && { color: colors.error }]}>{summary.dead}</Text>
              <Text style={s.statLabel}>Eşitlenemedi</Text>
            </View>
            <View style={s.statBox}>
              <Text style={[s.statNum, summary.conflict > 0 && { color: colors.warning }]}>{summary.conflict}</Text>
              <Text style={s.statLabel}>Çakışma</Text>
            </View>
          </View>

          {/* Durum Açıklaması */}
          <View style={s.infoBanner}>
            <EmblemMedallion
              source={EMPTY_VIGNETTES.offline}
              size={38}
              unlocked
              accentColor={isClean ? colors.success : colors.warning}
            />
            <Text style={s.infoText}>
              İnternet bağlantınız koptuğunda aldığınız notlar, tamamlanan alışkanlıklar ve günlükler cihazda güvenle saklanır; bağlantı gelince otomatik eşitlenir.
            </Text>
          </View>

          {flushOutcome && (
            <Text
              style={[s.msgText, { color: TONE_COLOR[flushOutcome.tone] }]}
              accessibilityLiveRegion="polite"
            >
              {flushOutcome.message}
            </Text>
          )}

          {issues.length > 0 && (
            <View style={s.issuesBox}>
              <Text style={s.issuesHead} accessibilityRole="header">Gönderilemeyenler · {issues.length}</Text>
              <ScrollView style={s.issuesScroll} nestedScrollEnabled>
                {issues.map((issue) => {
                  const busy = busyIssue === issue.id;
                  const confirming = confirmingDiscard === issue.id;
                  return (
                    <View key={`${issue.channel}:${issue.id}`} style={s.issueRow}>
                      <View
                        style={s.issueText}
                        accessible
                        accessibilityLabel={`${issue.label}. ${issue.reason}`}
                      >
                        <Text style={s.issueLabel} numberOfLines={1}>{issue.label}</Text>
                        <Text style={s.issueReason} numberOfLines={2}>{issue.reason}</Text>
                      </View>
                      {issue.status === 'conflict' ? (
                        <Text style={s.issueNote}>İlgili ekranda çözülür</Text>
                      ) : (
                        <View style={s.issueActions}>
                          <TouchableOpacity
                            style={s.issueBtn}
                            onPress={() => { void handleRetry(issue); }}
                            disabled={busy}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                            accessibilityRole="button"
                            accessibilityLabel={`${issue.label}: yeniden dene`}
                            accessibilityState={{ disabled: busy, busy }}
                          >
                            {busy ? (
                              <ActivityIndicator size="small" color={colors.accent} />
                            ) : (
                              <Text style={s.retryText}>Yeniden dene</Text>
                            )}
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={s.issueBtn}
                            onPress={() => { void handleDiscard(issue); }}
                            disabled={busy}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                            accessibilityRole="button"
                            accessibilityLabel={`${issue.label}: ${confirming ? DISCARD_CONFIRM_LABEL : 'bu değişikliği bırak'}`}
                            accessibilityState={{ disabled: busy }}
                          >
                            <Text style={[s.discardText, confirming && { color: colors.error }]}>
                              {confirming ? DISCARD_CONFIRM_LABEL : DISCARD_LABEL}
                            </Text>
                          </TouchableOpacity>
                        </View>
                      )}
                    </View>
                  );
                })}
              </ScrollView>
            </View>
          )}

          {/* Alt Aksiyon Butonları */}
          <View style={s.btnRow}>
            <TouchableOpacity
              style={[s.flushBtn, isFlushing && { opacity: 0.6 }]}
              onPress={handleFlush}
              disabled={isFlushing}
              accessibilityRole="button"
              accessibilityLabel="Şimdi Senkronize Et"
            >
              {isFlushing ? (
                <ActivityIndicator size="small" color={colors.white} />
              ) : (
                <Ionicons name="refresh-outline" size={16} color={colors.white} />
              )}
              <Text style={s.flushBtnText}>
                {isFlushing ? 'Eşitleniyor…' : 'Şimdi Senkronize Et'}
              </Text>
            </TouchableOpacity>
          </View>
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
    overflow: 'hidden',
    position: 'relative',
    gap: space.md,
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
  },
  headerText: {
    flex: 1,
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
  quarantineNote: {
    ...font.caption,
    color: colors.textDim,
    marginTop: 2,
  },
  closeBtn: {
    padding: 6,
  },

  statsRow: {
    flexDirection: 'row',
    gap: space.sm,
  },
  statBox: {
    flex: 1,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: space.sm,
    alignItems: 'center',
  },
  statNum: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.text,
  },
  statLabel: {
    fontSize: 10,
    color: colors.textFaint,
    marginTop: 2,
    fontWeight: '600',
  },

  infoBanner: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    padding: space.md,
    gap: space.sm,
    alignItems: 'flex-start',
  },
  infoText: {
    flex: 1,
    fontSize: 11,
    color: colors.textDim,
    lineHeight: 16,
  },
  msgText: {
    fontSize: 12,
    textAlign: 'center',
    fontWeight: '600',
  },

  issuesBox: {
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    borderRadius: radius.md,
    padding: space.sm,
    gap: space.xs,
  },
  issuesHead: {
    fontSize: 11,
    letterSpacing: 0.5,
    fontWeight: '700',
    color: colors.warning,
  },
  issuesScroll: {
    maxHeight: 240,
  },
  issueRow: {
    paddingVertical: space.xs,
    gap: 2,
  },
  issueText: {
    gap: 2,
  },
  issueLabel: {
    fontSize: 13,
    color: colors.text,
    fontWeight: '600',
  },
  issueReason: {
    fontSize: 12,
    color: colors.textFaint,
  },
  issueNote: {
    fontSize: 12,
    color: colors.textDim,
    fontStyle: 'italic',
    paddingVertical: space.xs,
  },
  issueActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.md,
  },
  issueBtn: {
    minHeight: 44,
    minWidth: 44,
    justifyContent: 'center',
  },
  retryText: {
    fontSize: 13,
    color: colors.accent,
    fontWeight: '700',
  },
  discardText: {
    fontSize: 13,
    color: colors.textDim,
    fontWeight: '600',
  },

  btnRow: {
    marginTop: space.xs,
  },
  flushBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: space.md,
  },
  flushBtnText: {
    color: colors.white,
    fontWeight: '700',
    fontSize: 14,
  },
});
