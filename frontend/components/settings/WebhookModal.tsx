import React, { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';
import { alphaHex, font, radius, space, type Palette } from '../../lib/tokens';
import { useThemeColors, useThemedStyles } from '../../hooks/useThemeColors';
import type { WebhookRow } from '../../services/webhookService';
import Button from '../ui/Button';

type WebhookModalProps = {
  visible: boolean;
  webhooks: WebhookRow[];
  loading: boolean;
  busy: boolean;
  url: string;
  error: string | null;
  signingSecret: string | null;
  onChangeUrl: (next: string) => void;
  onAdd: () => void;
  onRemove: (id: string) => void;
  onClose: () => void;
};

export default function WebhookModal({
  visible,
  webhooks,
  loading,
  busy,
  url,
  error,
  signingSecret,
  onChangeUrl,
  onAdd,
  onRemove,
  onClose,
}: WebhookModalProps) {
  const c = useThemeColors();
  const styles = useThemedStyles(makeStyles);
  const [copied, setCopied] = useState(false);

  if (!visible) return null;

  const handleCopy = async () => {
    if (!signingSecret) return;
    try {
      await Clipboard.setStringAsync(signingSecret);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <View style={styles.headerText}>
              <Text style={styles.title}>Webhook Bildirimleri</Text>
              <Text style={styles.subtitle}>
                Alışkanlık ve görev tamamlamalarını kendi https alıcına imzalı olarak iletir.
              </Text>
            </View>
            <Button
              label="Kapat"
              variant="ghost"
              size="md"
              accessibilityLabel="Webhook penceresini kapat"
              onPress={onClose}
            />
          </View>

          <ScrollView style={styles.body} keyboardShouldPersistTaps="handled">
            <View style={styles.formBlock}>
              <Text style={styles.inputLabel}>Alıcı adresi (https://)</Text>
              <TextInput
                value={url}
                onChangeText={(v) => {
                  setCopied(false);
                  onChangeUrl(v);
                }}
                placeholder="https://ornek.alanadi.com/webhook"
                placeholderTextColor={c.textFaint}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                editable={!busy}
                accessibilityLabel="Webhook https adresi"
                style={styles.input}
              />
              {error ? (
                <Text style={styles.errorText} accessibilityLiveRegion="polite">
                  {error}
                </Text>
              ) : null}
              <Button
                label="Webhook Ekle"
                variant="primary"
                size="md"
                icon="add-circle-outline"
                loading={busy}
                disabled={busy || !url.trim()}
                accessibilityLabel="Webhook ekle"
                onPress={onAdd}
              />
            </View>

            {signingSecret ? (
              <View
                style={styles.secretCard}
                accessibilityLabel="İmza anahtarı, bir daha gösterilmez"
              >
                <View style={styles.secretHead}>
                  <Ionicons name="key-outline" size={18} color={c.warning} />
                  <Text style={styles.secretTitle}>
                    İmza anahtarın, bir daha gösterilmez; alıcıda doğrulamak için kaydet.
                  </Text>
                </View>
                <Text selectable style={styles.secretValue}>
                  {signingSecret}
                </Text>
                <View style={styles.secretActions}>
                  <Button
                    label={copied ? 'Kopyalandı' : 'Kopyala'}
                    variant="tonal"
                    size="md"
                    icon={copied ? 'checkmark-outline' : 'copy-outline'}
                    color={c.accent}
                    accessibilityLabel="İmza anahtarını kopyala"
                    onPress={() => {
                      void handleCopy();
                    }}
                  />
                </View>
              </View>
            ) : null}

            <View style={styles.listBlock}>
              <Text style={styles.listTitle}>Kayıtlı adresler</Text>
              {loading ? (
                <Text style={styles.emptyText}>Yükleniyor...</Text>
              ) : webhooks.length === 0 ? (
                <Text style={styles.emptyText}>Henüz kayıtlı bir webhook adresi yok.</Text>
              ) : (
                webhooks.map((w) => (
                  <View key={w.id} style={styles.webhookRow}>
                    <View style={styles.webhookInfo}>
                      <Text style={styles.webhookUrl} selectable>
                        {w.url}
                      </Text>
                      <Text style={styles.webhookMeta}>
                        {w.event_types.join(', ')}
                      </Text>
                    </View>
                    <Button
                      label="Sil"
                      variant="ghost"
                      size="md"
                      color={c.error}
                      disabled={busy}
                      accessibilityLabel={`Webhook sil: ${w.url}`}
                      onPress={() => onRemove(w.id)}
                    />
                  </View>
                ))
              )}
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: alphaHex(c.black, '99'),
      justifyContent: 'center',
      padding: space.md,
    },
    sheet: {
      backgroundColor: c.surface,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: c.border,
      padding: space.lg,
      gap: space.md,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: space.md,
    },
    headerText: {
      flex: 1,
      gap: space.xs,
    },
    title: {
      ...font.h3,
      fontWeight: '700',
      color: c.text,
    },
    subtitle: {
      ...font.bodySm,
      color: c.textDim,
    },
    body: {
      flexGrow: 0,
    },
    formBlock: {
      gap: space.sm,
      marginBottom: space.md,
    },
    inputLabel: {
      ...font.bodySm,
      fontWeight: '600',
      color: c.text,
    },
    input: {
      ...font.body,
      color: c.text,
      backgroundColor: c.bg,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: radius.md,
      paddingHorizontal: space.md,
      paddingVertical: space.md,
      minHeight: 44,
    },
    errorText: {
      ...font.caption,
      color: c.error,
    },
    secretCard: {
      backgroundColor: alphaHex(c.warning, '14'),
      borderWidth: 1,
      borderColor: alphaHex(c.warning, '55'),
      borderRadius: radius.md,
      padding: space.md,
      gap: space.sm,
      marginBottom: space.md,
    },
    secretHead: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: space.sm,
    },
    secretTitle: {
      ...font.bodySm,
      fontWeight: '600',
      color: c.text,
      flex: 1,
    },
    secretValue: {
      ...font.bodySm,
      color: c.text,
      backgroundColor: c.bg,
      borderRadius: radius.sm,
      borderWidth: 1,
      borderColor: c.border,
      padding: space.sm,
    },
    secretActions: {
      flexDirection: 'row',
      justifyContent: 'flex-start',
    },
    listBlock: {
      gap: space.sm,
    },
    listTitle: {
      ...font.body,
      fontWeight: '600',
      color: c.text,
    },
    emptyText: {
      ...font.bodySm,
      color: c.textDim,
    },
    webhookRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: space.sm,
      backgroundColor: c.bg,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: c.border,
      padding: space.md,
    },
    webhookInfo: {
      flex: 1,
      gap: space.xs,
    },
    webhookUrl: {
      ...font.bodySm,
      fontWeight: '600',
      color: c.text,
    },
    webhookMeta: {
      ...font.caption,
      color: c.textFaint,
    },
  });
