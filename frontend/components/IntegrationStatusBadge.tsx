import { colors } from '../lib/tokens';
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { IntegrationStatus } from '../constants/integrations';

type IntegrationStatusBadgeProps = {
  status: IntegrationStatus;
};

const STATUS_CONFIG: Record<
  IntegrationStatus,
  { label: string; backgroundColor: string; color: string }
> = {
  available: {
    label: 'Kur',
    backgroundColor: '#D9775720',
    color: colors.accent,
  },
  connected: {
    label: 'Bağlı',
    backgroundColor: '#87A67820',
    color: colors.success,
  },
  comingSoon: {
    label: 'Yakında',
    backgroundColor: colors.surface,
    color: colors.textDim,
  },
};

export default function IntegrationStatusBadge({ status }: IntegrationStatusBadgeProps) {
  const config = STATUS_CONFIG[status];

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

const styles = StyleSheet.create({
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
