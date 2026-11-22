import { View, Text, StyleSheet, Linking } from 'react-native';
import { useRouter } from 'expo-router';
import { font, space, type Palette } from '../../lib/tokens';
import { useThemeColors, useThemedStyles } from '../../hooks/useThemeColors';
import { PUBLIC_SITE_URLS_LIVE, PUBLIC_SITE_URLS } from '../../lib/featureGates';
import { navigateTo } from '../../lib/destinations';
import SettingRow from './SettingRow';

export type AccountSectionProps = {
  email: string | null;
  onSignOut: () => void;
  onDeleteAccount: () => void;
  signingOut?: boolean;
  deletingAccount?: boolean;
};

export default function AccountSection({
  email,
  onSignOut,
  onDeleteAccount,
  signingOut = false,
  deletingAccount = false,
}: AccountSectionProps) {
  const c = useThemeColors();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Hesap</Text>

      <SettingRow
        icon="shield-checkmark-outline"
        label="Gizlilik Politikası"
        hint="Hangi verilerin saklanıyor ve neden"
        tone={c.info}
        onPress={() => navigateTo(router, 'privacy')}
      />

      {PUBLIC_SITE_URLS_LIVE && (
        <SettingRow
          icon="help-buoy-outline"
          label="Destek"
          hint="Yardım, hesap ve teknik sorunlar"
          tone={c.teal}
          onPress={() => {
            Linking.openURL(PUBLIC_SITE_URLS.support).catch(() => {});
          }}
        />
      )}

      {/* F04 (NAV-02): signing out of THIS device, above the permanent deletion */}
      <SettingRow
        icon="log-out-outline"
        label="Oturumu Kapat"
        hint={email ?? 'Bu cihazdan çık'}
        tone={c.info}
        disabled={deletingAccount || signingOut}
        busy={signingOut}
        accessibilityLabel="Oturumu kapat"
        accessibilityHint="Hesabını bu cihazdan çıkarır"
        onPress={onSignOut}
      />

      <SettingRow
        icon="trash-outline"
        label="Hesabı Sil"
        hint="Hesabın ve verilerin kalıcı olarak silinir. Geri alınamaz."
        destructive
        disabled={deletingAccount}
        busy={deletingAccount}
        accessibilityLabel="Hesabı sil"
        accessibilityHint="Hesabını ve kişisel verilerini kalıcı olarak siler"
        onPress={onDeleteAccount}
      />
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    section: {
      marginBottom: space.xxl,
    },
    sectionTitle: {
      ...font.h3,
      fontWeight: 'bold',
      color: c.text,
      marginBottom: space.md,
    },
  });
