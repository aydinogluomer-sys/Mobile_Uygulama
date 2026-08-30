import { View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, space, radius, font, fontFamily, hexA } from '../../lib/tokens';
import Button from './Button';

type Props = {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  hint?: string;
  ctaLabel?: string;
  onCta?: () => void;
  color?: string;
  compact?: boolean;
  /** 'editorial' → ikon kabı yok, serif italik başlık (Atlas sakin boş durum) */
  variant?: 'default' | 'editorial';
};

/** Sakin empty state — ikon kabı + başlık + alt metin + opsiyonel tek net CTA. */
export default function EmptyState({
  icon, title, hint, ctaLabel, onCta, color = colors.primary, compact, variant = 'default',
}: Props) {
  if (variant === 'editorial') {
    return (
      <View style={{ alignItems: 'center', paddingVertical: compact ? space.lg : space.xxl, gap: space.sm }}>
        <Text style={{ fontFamily: fontFamily.serif, fontStyle: 'italic', fontSize: 19, color: colors.text, textAlign: 'center' }}>
          {title}
        </Text>
        {hint && (
          <Text style={{ ...font.bodySm, color: colors.textFaint, textAlign: 'center', maxWidth: 300, lineHeight: 20 }}>
            {hint}
          </Text>
        )}
        {ctaLabel && onCta && (
          <Button label={ctaLabel} onPress={onCta} variant="tonal" size="sm" icon="add" color={color} style={{ marginTop: space.sm }} />
        )}
      </View>
    );
  }
  return (
    <View style={{ alignItems: 'center', paddingVertical: compact ? space.xl : space.h, gap: space.md }}>
      <View
        style={{
          width: compact ? 52 : 64, height: compact ? 52 : 64, borderRadius: radius.lg,
          backgroundColor: hexA(color, 0.1), alignItems: 'center', justifyContent: 'center',
        }}
      >
        {/* Süsleme: hemen altındaki başlık + ipucu metni durumu zaten anlatıyor;
            ikon glifi ekran okuyucuda anlamsız bir durak üretirdi. */}
        <Ionicons
          name={icon}
          size={compact ? 26 : 32}
          color={hexA(color, 0.8)}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        />
      </View>
      <View style={{ alignItems: 'center', gap: 4 }}>
        <Text style={{ ...font.title, fontSize: 20, color: colors.text }}>{title}</Text>
        {hint && (
          <Text style={{ ...font.bodySm, color: colors.textFaint, textAlign: 'center', maxWidth: 260, lineHeight: 19 }}>
            {hint}
          </Text>
        )}
      </View>
      {ctaLabel && onCta && (
        <Button label={ctaLabel} onPress={onCta} variant="tonal" size="sm" icon="add" color={color} style={{ marginTop: space.xs }} />
      )}
    </View>
  );
}
