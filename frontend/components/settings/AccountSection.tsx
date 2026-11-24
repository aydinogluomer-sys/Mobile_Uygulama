import { View, Text, StyleSheet, Linking } from 'react-native';
import { useRouter } from 'expo-router';
import { font, space, type Palette } from '../../lib/tokens';
import { useThemeColors, useThemedStyles } from '../../hooks/useThemeColors';
import { PUBLIC_SITE_URLS_LIVE, PUBLIC_SITE_URLS } from '../../lib/featureGates';
import { navigateTo } from '../../lib/destinations';
import { t } from '../../lib/i18n';
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
      <Text style={styles.sectionTitle}>{t('settings.account.title')}</Text>

      <SettingRow
        icon="shield-checkmark-outline"
        label={t('settings.account.privacy.label')}
        hint={t('settings.account.privacy.hint')}
        tone={c.info}
        onPress={() => navigateTo(router, 'privacy')}
      />

      {PUBLIC_SITE_URLS_LIVE && (
        <SettingRow
          icon="help-buoy-outline"
          label={t('settings.account.support.label')}
          hint={t('settings.account.support.hint')}
          tone={c.teal}
          onPress={() => {
            Linking.openURL(PUBLIC_SITE_URLS.support).catch(() => {});
          }}
        />
      )}

      {/* F04 (NAV-02): signing out of THIS device, above the permanent deletion */}
      <SettingRow
        icon="log-out-outline"
        label={t('settings.account.signOut.label')}
        hint={email ?? t('settings.account.signOut.fallbackHint')}
        tone={c.info}
        disabled={deletingAccount || signingOut}
        busy={signingOut}
        accessibilityLabel={t('settings.account.signOut.a11y')}
        accessibilityHint={t('settings.account.signOutHint.a11y')}
        onPress={onSignOut}
      />

      <SettingRow
        icon="trash-outline"
        label={t('settings.account.delete.label')}
        hint={t('settings.account.delete.hint')}
        destructive
        disabled={deletingAccount}
        busy={deletingAccount}
        accessibilityLabel={t('settings.account.delete.a11y')}
        accessibilityHint={t('settings.account.deleteHint.a11y')}
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
