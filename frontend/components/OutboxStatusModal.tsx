import { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, Modal, TouchableOpacity, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, alphaHex, radius, space, font } from '../lib/tokens';
import { flushAllOutboxes, getUnifiedOutboxSummary, subscribeUnifiedOutbox } from '../services/unifiedOutbox';
import { haptic } from '../lib/haptics';
import type { OutboxSummary } from '../lib/outbox';
import { EmblemMedallion, TexturedSurface } from './ui';
import { EMPTY_VIGNETTES, TEXTURES } from '../lib/visualAssets';

interface OutboxStatusModalProps {
  visible: boolean;
  onClose: () => void;
}

export default function OutboxStatusModal({ visible, onClose }: OutboxStatusModalProps) {
  const [summary, setSummary] = useState<OutboxSummary>(() => getUnifiedOutboxSummary());
  const [isFlushing, setIsFlushing] = useState(false);
  const [flushMessage, setFlushMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setSummary(getUnifiedOutboxSummary());
    const unsub = subscribeUnifiedOutbox(() => {
      setSummary(getUnifiedOutboxSummary());
    });
    return unsub;
  }, [visible]);

  async function handleFlush() {
    haptic.medium();
    setIsFlushing(true);
    setFlushMessage(null);
    try {
      await flushAllOutboxes();
      setSummary(getUnifiedOutboxSummary());
      setFlushMessage('Tüm bekleyen işlemler sunucuya iletildi.');
    } catch {
      setFlushMessage('Senkronizasyon sırasında bir sorun oluştu.');
    } finally {
      setIsFlushing(false);
    }
  }

  const isClean = summary.pending === 0 && summary.dead === 0 && summary.conflict === 0;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
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
              <View>
                <Text style={s.title}>Çevrimdışı Senkronizasyon</Text>
                <Text style={s.sub}>
                  {isClean ? 'Tüm verileriniz güncel ve eşleşti.' : 'Bekleyen çevrimdışı işlemler var.'}
                </Text>
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

          {flushMessage && (
            <Text style={s.msgText}>{flushMessage}</Text>
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
    color: colors.primary,
    textAlign: 'center',
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
