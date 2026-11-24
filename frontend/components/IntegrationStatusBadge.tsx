import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { alphaHex, type Palette } from '../lib/tokens';
import { useThemeColors, useThemedStyles } from '../hooks/useThemeColors';
import type { IntegrationStatus } from '../constants/integrations';

type IntegrationStatusBadgeProps = {
  status: IntegrationStatus;
};

function getStatusConfig(
  colors: Palette,
  status: IntegrationStatus,
): { label: string; backgroundColor: string; color: string } {
  switch (status) {
    case 'available':
      return {
        label: 'Kur',
        backgroundColor: alphaHex(colors.accent, '20'),
        color: colors.accent,
      };
    case 'connected':
      return {
        label: 'Bağlı',
        backgroundColor: alphaHex(colors.success, '20'),
        color: colors.success,
      };
    case 'comingSoon':
      return {
        label: 'Yakında',
        backgroundColor: colors.surface,
        color: colors.textDim,
      };
  }
}

export default function IntegrationStatusBadge({ status }: IntegrationStatusBadgeProps) {
  const colors = useThemeColors();
  const styles = useThemedStyles(makeStyles);
  const config = getStatusConfig(colors, status);

  return (
    <View
      style={[styles.badge, { backgroundColor: config.backgroundColor }]}
      accessibilityRole="text"
      accessibilityLabel={config.label}
    >
      <Text style={[styles.badgeText, { color: config.color }]}>{config.label}</Text>
    </View>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    badge: {
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.border,
    },
    badgeText: {
      fontSize: 12,
      fontWeight: '600',
    },
  });
