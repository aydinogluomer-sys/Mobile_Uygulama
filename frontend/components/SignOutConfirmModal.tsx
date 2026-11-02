/**
 * F04 (NAV-02, SYN-22) — the sign-out confirmation.
 *
 * A real modal, not `Alert.alert`: on React Native Web `Alert.alert` does nothing (GAP2-01), and a
 * sign-out that silently does nothing on the web is exactly the kind of promise this release
 * stopped making. Calm-Tech copy: the unsent-changes line informs, it does not alarm -- those
 * changes stay on this device for the same account. "Önce eşitle" is offered, never required.
 */
import { useEffect, useState } from 'react';
import {
  AccessibilityInfo, ActivityIndicator, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, alphaHex, radius, space, font } from '../lib/tokens';
import { signOutNotice } from '../services/accountService';

export type SignOutConfirmModalProps = {
  visible: boolean;
  /** Changes on this device the server has not received yet (accountService.unsentChangeCount). */
  unsent: number;
  /** Signing out: buttons disabled, a spinner shows. */
  busy: boolean;
  /** The previous attempt's error; not shown when null. */
  error: string | null;
  /** "Önce eşitle": only while unsent > 0. */
  onSyncFirst: () => void;
  onConfirm: () => void;
  onCancel: () => void;
};

export default function SignOutConfirmModal({
  visible, unsent, busy, error, onSyncFirst, onConfirm, onCancel,
}: SignOutConfirmModalProps) {
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((on) => { if (alive) setReduceMotion(on); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, []);

  const notice = signOutNotice(unsent);

  return (
    <Modal
      visible={visible}
      transparent
      animationType={reduceMotion ? 'none' : 'fade'}
      onRequestClose={onCancel}
    >
      <View style={s.backdrop}>
        <View style={s.card} accessibilityViewIsModal>
          <ScrollView contentContainerStyle={s.body} bounces={false}>
            <View style={s.iconBox}>
              <Ionicons name="log-out-outline" size={22} color={colors.info} />
            </View>
            <Text style={s.title} accessibilityRole="header">Oturumu kapatalım mı?</Text>
            <Text style={s.text}>
              Hesabın bu cihazdan çıkarılır. Verilerin sunucuda güvende kalır; tekrar girdiğinde kaldığın yerden devam edersin.
            </Text>
            {notice ? <Text style={s.notice}>{notice}</Text> : null}
            {error ? (
              <Text style={s.error} accessibilityLiveRegion="polite" accessibilityRole="alert">{error}</Text>
            ) : null}
          </ScrollView>

          <View style={s.actions}>
            {unsent > 0 ? (
              <TouchableOpacity
                style={[s.btn, s.btnSecondary, busy && s.btnDisabled]}
                onPress={onSyncFirst}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel="Önce eşitle"
                accessibilityHint="Bekleyen değişiklikleri sunucuya göndermeyi dener"
                accessibilityState={{ disabled: busy }}
              >
                <Text style={s.btnSecondaryText}>Önce eşitle</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity
              style={[s.btn, s.btnPrimary, busy && s.btnDisabled]}
              onPress={onConfirm}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel="Oturumu kapat"
              accessibilityHint="Hesabını bu cihazdan çıkarır"
              accessibilityState={{ disabled: busy, busy }}
            >
              {busy
                ? <ActivityIndicator size="small" color={colors.bg} />
                : <Text style={s.btnPrimaryText}>Oturumu kapat</Text>}
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.btn, s.btnGhost, busy && s.btnDisabled]}
              onPress={onCancel}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel="Vazgeç"
              accessibilityState={{ disabled: busy }}
            >
              <Text style={s.btnGhostText}>Vazgeç</Text>
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
    backgroundColor: alphaHex(colors.bg, 'D9'),
    justifyContent: 'center',
    padding: space.lg,
  },
  card: {
    alignSelf: 'center',
    width: '100%',
    maxWidth: 440,
    maxHeight: '90%',
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.lg,
    gap: space.md,
  },
  body: {
    gap: space.sm,
  },
  iconBox: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: alphaHex(colors.info, '20'),
  },
  title: {
    ...font.title,
    fontSize: 20,
    color: colors.text,
  },
  text: {
    ...font.body,
    color: colors.textDim,
    lineHeight: 22,
  },
  notice: {
    ...font.bodySm,
    color: colors.text,
    lineHeight: 20,
    backgroundColor: alphaHex(colors.info, '14'),
    borderRadius: radius.md,
    padding: space.md,
  },
  error: {
    ...font.bodySm,
    color: colors.warning,
    lineHeight: 20,
  },
  actions: {
    gap: space.sm,
  },
  btn: {
    minHeight: 48,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.lg,
  },
  btnPrimary: {
    backgroundColor: colors.primary,
  },
  btnPrimaryText: {
    ...font.h3,
    // dark on clay: 5.9:1 (light text on the same clay is 2.6:1, below AA)
    color: colors.bg,
  },
  btnSecondary: {
    borderWidth: 1,
    borderColor: colors.info,
  },
  btnSecondaryText: {
    ...font.h3,
    color: colors.info,
  },
  btnGhost: {
    backgroundColor: 'transparent',
  },
  btnGhostText: {
    ...font.h3,
    color: colors.textDim,
  },
  btnDisabled: {
    opacity: 0.6,
  },
});
