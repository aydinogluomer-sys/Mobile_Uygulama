import { useState, useEffect, type ComponentProps } from 'react';
import {
  View, Text, StyleSheet, Modal, TouchableOpacity, TextInput,
  ScrollView, Switch,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { alphaHex, hexA, radius, space, font, type Palette } from '../lib/tokens';
import { useThemeColors, useThemedStyles } from '../hooks/useThemeColors';
import { notify } from '../lib/dialog';
import { haptic } from '../lib/haptics';
import type { IntegrationItem } from '../constants/integrations';

interface IntegrationDetailModalProps {
  item: IntegrationItem | null;
  visible: boolean;
  onClose: () => void;
  accentColor?: string;
}

export default function IntegrationDetailModal({
  item,
  visible,
  onClose,
  accentColor: accentColorProp,
}: IntegrationDetailModalProps) {
  const colors = useThemeColors();
  const s = useThemedStyles(makeStyles);
  const accentColor = accentColorProp ?? colors.primary;
  const [apiKey, setApiKey] = useState('');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [autoSync, setAutoSync] = useState(true);
  const [isConfigured, setIsConfigured] = useState(false);

  useEffect(() => {
    if (!item || !visible) return;
    const storageKey = `integration.config.${item.id}`;
    AsyncStorage.getItem(storageKey).then((raw) => {
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          setApiKey(parsed.apiKey ?? '');
          setWebhookUrl(parsed.webhookUrl ?? '');
          setAutoSync(parsed.autoSync ?? true);
          setIsConfigured(parsed.isConfigured ?? false);
        } catch {
          setIsConfigured(false);
        }
      } else {
        setApiKey('');
        setWebhookUrl('');
        setAutoSync(true);
        setIsConfigured(false);
      }
    });
  }, [item, visible]);

  if (!item) return null;

  async function handleSave() {
    haptic.success();
    const storageKey = `integration.config.${item?.id}`;
    const payload = {
      apiKey,
      webhookUrl,
      autoSync,
      isConfigured: true,
      updatedAt: new Date().toISOString(),
    };
    await AsyncStorage.setItem(storageKey, JSON.stringify(payload));
    setIsConfigured(true);
    void notify('✅ Entegrasyon Kaydedildi', `${item?.title} entegrasyon ayarları başarıyla cihazınıza kaydedildi.`);
  }

  function handleTestTrigger() {
    haptic.medium();
    const trimmed = webhookUrl.trim();
    let validHttps = false;
    if (trimmed.length > 0) {
      try {
        const parsed = new URL(trimmed);
        validHttps = parsed.protocol === 'https:' && parsed.hostname.length > 0;
      } catch {
        validHttps = false;
      }
    }
    if (validHttps) {
      void notify(
        'Adres kontrol edildi',
        'Adres geçerli görünüyor. Bu sürümde ayarların yalnız bu cihazda saklanır; dış servise test olayı gönderilmez.',
      );
    } else {
      void notify(
        'Adres geçerli görünmüyor',
        'https ile başlayan tam bir adres gir.',
      );
    }
  }

  async function handleDisconnect() {
    haptic.light();
    const storageKey = `integration.config.${item?.id}`;
    await AsyncStorage.removeItem(storageKey);
    setIsConfigured(false);
    setApiKey('');
    setWebhookUrl('');
    void notify('Bağlantı Kesildi', `${item?.title} ayarları temizlendi.`);
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.backdrop}>
        <View style={s.card}>
          {/* Header */}
          <View style={s.header}>
            <View style={s.headerLeft}>
              <View style={[s.iconBox, { backgroundColor: alphaHex(accentColor, '20') }]}>
                <Ionicons
                  name={(item.iconName as ComponentProps<typeof Ionicons>['name']) || 'extension-puzzle-outline'}
                  size={24}
                  color={accentColor}
                />
              </View>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={s.title}>{item.title}</Text>
                  {isConfigured && (
                    <View style={s.activeBadge}>
                      <Text style={s.activeBadgeText}>● Aktif</Text>
                    </View>
                  )}
                </View>
                <Text style={s.sub}>{isConfigured ? 'Cihazda yapılandırıldı' : 'Entegrasyon Yapılandırması'}</Text>
              </View>
            </View>
            <TouchableOpacity onPress={onClose} style={s.closeBtn} accessibilityRole="button" accessibilityLabel="Kapat">
              <Ionicons name="close" size={22} color={colors.textFaint} />
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: space.md, paddingVertical: space.xs }}>
            {/* Açıklama */}
            <View style={s.descBox}>
              <Text style={s.descText}>{item.description}</Text>
            </View>

            {/* Olay Tetikleyicileri Bilgisi */}
            <View style={s.box}>
              <Text style={s.boxTitle}>DESTEKLENEN OLAYLAR</Text>
              <View style={{ gap: 6, marginTop: 4 }}>
                {[
                  '⚡ Alışkanlık tamamlandığında (habit.completed)',
                  '🔥 Seri korunduğunda / yeni rekor (streak.milestone)',
                  '🎯 Hedef veya görev bittiğinde (task.done)',
                ].map((txt) => (
                  <Text key={txt} style={s.eventRowText}>{txt}</Text>
                ))}
              </View>
            </View>

            {/* Ayarlar Formu */}
            <View style={s.box}>
              <Text style={s.boxTitle}>BAĞLANTI PARAMETRELERİ</Text>

              <Text style={s.inputLabel}>Webhook URL / Endpoint</Text>
              <TextInput
                style={s.input}
                value={webhookUrl}
                onChangeText={setWebhookUrl}
                placeholder="https://api.yourdomain.com/webhook"
                placeholderTextColor={colors.textFaint}
                autoCapitalize="none"
              />

              <Text style={[s.inputLabel, { marginTop: 8 }]}>API Anahtarı / Bot Token (Opsiyonel)</Text>
              <TextInput
                style={s.input}
                value={apiKey}
                onChangeText={setApiKey}
                placeholder="Örn: bot123456:ABC-DEF..."
                placeholderTextColor={colors.textFaint}
                secureTextEntry
                autoCapitalize="none"
              />

              <View style={s.switchRow}>
                <View style={{ flex: 1 }}>
                  <Text style={s.switchLabel}>Otomatik Senkronizasyon</Text>
                  <Text style={s.switchSub}>Olaylar gerçekleştiğinde otomatik ilet</Text>
                </View>
                <Switch
                  value={autoSync}
                  onValueChange={setAutoSync}
                  trackColor={{ false: colors.surfaceAlt, true: accentColor }}
                  thumbColor={colors.white}
                />
              </View>
            </View>

            {/* Butonlar */}
            <View style={{ gap: 8, marginTop: 4 }}>
              <TouchableOpacity
                style={[s.primaryBtn, { backgroundColor: accentColor }]}
                onPress={handleSave}
                accessibilityRole="button"
                accessibilityLabel="Yapılandırmayı Kaydet"
              >
                <Ionicons name="checkmark-outline" size={18} color={colors.white} />
                <Text style={s.primaryBtnText}>Yapılandırmayı Kaydet</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={s.secondaryBtn}
                onPress={handleTestTrigger}
                accessibilityRole="button"
                accessibilityLabel="Adresi kontrol et"
              >
                <Ionicons name="checkmark-circle-outline" size={16} color={colors.text} />
                <Text style={s.secondaryBtnText}>Adresi kontrol et</Text>
              </TouchableOpacity>

              {isConfigured && (
                <TouchableOpacity
                  style={s.disconnectBtn}
                  onPress={handleDisconnect}
                  accessibilityRole="button"
                  accessibilityLabel="Entegrasyon Bağlantısını Temizle"
                >
                  <Text style={s.disconnectText}>Yapılandırmayı Temizle</Text>
                </TouchableOpacity>
              )}
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: hexA(colors.black, 0.65),
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
    gap: space.md,
    maxHeight: '90%',
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
    width: 44,
    height: 44,
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
  activeBadge: {
    backgroundColor: alphaHex(colors.success, '20'),
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  activeBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.success,
  },
  closeBtn: {
    padding: 6,
  },

  descBox: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    padding: space.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  descText: {
    fontSize: 12,
    color: colors.textDim,
    lineHeight: 17,
  },

  box: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    padding: space.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    gap: 6,
  },
  boxTitle: {
    fontSize: 10,
    fontWeight: '800',
    color: colors.textFaint,
    letterSpacing: 1,
  },
  eventRowText: {
    fontSize: 11,
    color: colors.textDim,
  },

  inputLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textFaint,
    marginTop: 4,
  },
  input: {
    backgroundColor: colors.bg,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: space.sm,
    paddingVertical: 8,
    fontSize: 13,
    color: colors.text,
  },

  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
  },
  switchLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.text,
  },
  switchSub: {
    fontSize: 10,
    color: colors.textFaint,
  },

  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: radius.md,
    paddingVertical: space.md,
  },
  primaryBtnText: {
    color: colors.white,
    fontWeight: '700',
    fontSize: 14,
  },

  secondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: space.md,
  },
  secondaryBtnText: {
    color: colors.text,
    fontWeight: '600',
    fontSize: 13,
  },

  disconnectBtn: {
    paddingVertical: space.sm,
    alignItems: 'center',
  },
  disconnectText: {
    fontSize: 12,
    color: colors.error,
    fontWeight: '600',
  },
});
