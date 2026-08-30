import { colors } from '../lib/tokens';
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { IntegrationItem } from '../constants/integrations';
import IntegrationStatusBadge from './IntegrationStatusBadge';

type IntegrationItemCardProps = {
  item: IntegrationItem;
  onPress?: () => void;
  accentColor?: string;
};

export default function IntegrationItemCard({
  item,
  onPress,
  accentColor = colors.accent,
}: IntegrationItemCardProps) {
  const { title, description, status, iconName = 'ellipse-outline' } = item;
  const isPressable = Boolean(onPress) && status === 'available';
  const showChevron = isPressable;

  const content = (
    <>
      <View style={styles.settingLeft}>
        <View style={[styles.settingIcon, { backgroundColor: `${accentColor}20` }]}>
          <Ionicons name={iconName as keyof typeof Ionicons.glyphMap} size={20} color={accentColor} />
        </View>
        <View style={styles.settingInfo}>
          <Text style={styles.settingTitle}>{title}</Text>
          <Text style={styles.settingSubtitle} numberOfLines={2}>
            {description}
          </Text>
        </View>
      </View>
      <View style={styles.settingRight}>
        <IntegrationStatusBadge status={status} />
        {showChevron ? (
          <Ionicons name="chevron-forward" size={20} color="#827E72" />
        ) : (
          <View style={styles.chevronPlaceholder} />
        )}
      </View>
    </>
  );

  if (isPressable && onPress) {
    return (
      <TouchableOpacity
        style={styles.settingItem}
        onPress={onPress}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={`${title}, Kur`}
      >
        {content}
      </TouchableOpacity>
    );
  }

  const statusLabel =
    status === 'connected' ? 'Bağlı' : status === 'available' ? 'Kur' : 'Yakında';

  return (
    <View
      style={[styles.settingItem, status === 'comingSoon' && styles.settingItemDisabled]}
      accessibilityRole="text"
      accessibilityLabel={`${title}, ${statusLabel}`}
    >
      {content}
    </View>
  );
}

const styles = StyleSheet.create({
  settingItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  settingItemDisabled: {
    opacity: 0.85,
  },
  settingLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 8,
  },
  settingIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  settingInfo: {
    flex: 1,
  },
  settingTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.white,
    marginBottom: 4,
  },
  settingSubtitle: {
    fontSize: 13,
    color: colors.textDim,
  },
  settingRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  chevronPlaceholder: {
    width: 20,
    height: 20,
  },
});
