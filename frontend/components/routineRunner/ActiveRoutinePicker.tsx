/**
 * F34 (PS-30) — Active routine picker ("Şimdi hangisi?").
 *
 * Calm-tech / ADHD progressive disclosure:
 *  - Suggests one routine up front (user's active choice first, else current
 *    part-of-day match) with a single primary "Başla" action.
 *  - Never auto-starts anything during render.
 *  - Keeps remaining routines collapsed under "Diğer rutinler (N)" until opened.
 *  - Explicitly states that the active routine preference stays on this device.
 */
import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors, useThemedStyles } from '../../hooks/useThemeColors';
import {
  isUsableTemplate,
  latestVersion,
  runnerPartOfDay,
  suggestTemplate,
  type PartOfDay,
  type RoutineTemplate,
} from '../../lib/routineRunner';
import { font, radius, space, type Palette } from '../../lib/tokens';
import { DECOR } from '../../lib/visualAssets';
import { EmbeddedFiligree } from '../spatial';
import { Button, Card, Chip, IconButton } from '../ui';

export type ActiveRoutinePickerProps = {
  templates: readonly RoutineTemplate[];
  activeTemplateId: string | null;
  hour: number;
  onStart: (templateId: string) => void;
  onSetActive: (templateId: string | null) => void;
};

const PART_REASON_LABEL: Readonly<Record<PartOfDay, string>> = {
  morning: 'Sabah için önerildi',
  afternoon: 'Öğleden sonra için önerildi',
  evening: 'Akşam için önerildi',
};

export default function ActiveRoutinePicker(props: ActiveRoutinePickerProps): React.JSX.Element | null {
  const { templates, activeTemplateId, hour, onStart, onSetActive } = props;
  const c = useThemeColors();
  const s = useThemedStyles(makeStyles);
  const [othersOpen, setOthersOpen] = useState(false);

  const usable = useMemo(() => templates.filter(isUsableTemplate), [templates]);
  const suggestion = useMemo(
    () => suggestTemplate(usable, hour, activeTemplateId),
    [usable, hour, activeTemplateId],
  );

  if (usable.length === 0) return null;

  const suggested = suggestion ? usable.find((t) => t.id === suggestion.templateId) ?? null : null;

  const renderTemplateCard = (t: RoutineTemplate, featured: boolean, reasonLabel?: string) => {
    const verSteps = latestVersion(t)?.steps ?? [];
    const isActive = activeTemplateId === t.id;
    const toggleLabel = isActive ? 'Aktif rutini kaldır' : 'Aktif yap';

    return (
      <Card
        key={t.id}
        variant={featured ? 'elevated' : 'plain'}
        padding="lg"
        radiusKey="lg"
        selected={featured}
        accent={c.accent}
        style={s.card}
      >
        <EmbeddedFiligree source={DECOR.cornerBotanical} anchor="bottom-right" size={108} opacity={0.16} />
        <View style={s.cardTopRow}>
          <View style={s.titleCol}>
            {reasonLabel ? (
              <View style={s.reasonRow}>
                <Chip label={reasonLabel} color={c.accent} size="sm" dot />
              </View>
            ) : null}
            <View style={s.titleRow}>
              <Text style={s.cardTitle}>
                {t.name}
                {t.builtIn ? '' : ' · bu cihazda'}
              </Text>
              <View style={s.stepBadge}>
                <Text style={s.stepBadgeText}>{verSteps.length} adım</Text>
              </View>
            </View>
            <Text style={s.cardSub}>{verSteps.map((p) => p.title).join(' · ')}</Text>
          </View>
          <IconButton
            icon={isActive ? 'bookmark' : 'bookmark-outline'}
            label={featured ? toggleLabel : `${t.name}: ${toggleLabel}`}
            selected={isActive}
            color={isActive ? c.accent : c.textDim}
            onPress={() => onSetActive(isActive ? null : t.id)}
          />
        </View>
        <View style={s.actionRow}>
          <Button
            label="Başla"
            variant={featured ? 'primary' : 'secondary'}
            size="md"
            icon="play"
            full
            onPress={() => onStart(t.id)}
            accessibilityLabel={`${t.name} rutinini başlat, ${verSteps.length} adım`}
          />
        </View>
      </Card>
    );
  };

  if (!suggested || !suggestion) {
    return (
      <View style={s.stack}>
        <Text style={s.heading} accessibilityRole="header">
          Rutin başlat
        </Text>
        {usable.map((t) => renderTemplateCard(t, false))}
        <Text style={s.footnote}>
          Öneri yalnız öneridir; başlatmak için sen dokunursun. Aktif rutin seçimi bu cihazda saklanır.
        </Text>
      </View>
    );
  }

  const slot = suggested.partOfDay ?? runnerPartOfDay(hour);
  const reasonLabel =
    suggestion.reason === 'active' ? 'Aktif rutinin' : PART_REASON_LABEL[slot];
  const others = usable.filter((t) => t.id !== suggested.id);

  return (
    <View style={s.stack}>
      <Text style={s.heading} accessibilityRole="header">
        Şimdi hangisi?
      </Text>
      {renderTemplateCard(suggested, true, reasonLabel)}

      {others.length > 0 && (
        <View style={s.othersSection}>
          <Card
            padding="md"
            radiusKey="md"
            onPress={() => setOthersOpen((prev) => !prev)}
            accessibilityLabel={`Diğer rutinler (${others.length})`}
            accessibilityState={{ expanded: othersOpen }}
            style={s.othersHeader}
          >
            <Text style={s.othersHeaderText}>{`Diğer rutinler (${others.length})`}</Text>
            <Ionicons
              name={othersOpen ? 'chevron-up' : 'chevron-down'}
              size={18}
              color={c.textFaint}
            />
          </Card>
          {othersOpen && (
            <View style={s.othersList}>
              {others.map((t) => renderTemplateCard(t, false))}
            </View>
          )}
        </View>
      )}

      <Text style={s.footnote}>
        Öneri yalnız öneridir; başlatmak için sen dokunursun. Aktif rutin seçimi bu cihazda saklanır.
      </Text>
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    stack: {
      gap: space.sm,
    },
    heading: {
      ...font.h2,
      color: c.text,
      marginBottom: space.xs,
    },
    card: {
      overflow: 'hidden',
      position: 'relative',
      gap: space.md,
    },
    cardTopRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: space.sm,
    },
    titleCol: {
      flex: 1,
      gap: space.xs,
    },
    reasonRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: space.xs,
    },
    titleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: space.sm,
    },
    cardTitle: {
      ...font.h3,
      color: c.text,
    },
    stepBadge: {
      paddingHorizontal: space.sm,
      paddingVertical: space.xs,
      borderRadius: radius.full,
      backgroundColor: c.surfaceAlt,
      borderWidth: 1,
      borderColor: c.border,
    },
    stepBadgeText: {
      ...font.caption,
      color: c.accent,
      fontWeight: '700',
    },
    cardSub: {
      ...font.caption,
      color: c.textDim,
    },
    actionRow: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    othersSection: {
      gap: space.sm,
      marginTop: space.xs,
    },
    othersHeader: {
      minHeight: 44,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    othersHeaderText: {
      ...font.bodySm,
      color: c.textDim,
      fontWeight: '600',
    },
    othersList: {
      gap: space.sm,
    },
    footnote: {
      ...font.caption,
      color: c.textFaint,
      marginTop: space.xs,
    },
  });
