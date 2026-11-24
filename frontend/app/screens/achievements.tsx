import { useState, useMemo, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useShallow } from 'zustand/react/shallow';
import { alphaHex, radius, space, font, type Palette } from '../../lib/tokens';
import { useThemeColors, useThemedStyles } from '../../hooks/useThemeColors';
import { useProfileStore } from '../../store/profileStore';
import { useHabitStore } from '../../store/habitStore';
import { useLogStore } from '../../store/logStore';
import { useTaskStore } from '../../store/taskStore';
import { useDeepWorkStore } from '../../store/deepWorkStore';
import { useJournalStore } from '../../store/journalStore';
import { haptic } from '../../lib/haptics';
import { EmblemMedallion, TexturedSurface } from '../../components/ui';
import { AtmosphericScreenCanvas, ChapterDivider, EmbeddedFiligree } from '../../components/spatial';
import { CANVASES, DECOR, getAchievementBadge, TEXTURES } from '../../lib/visualAssets';

export type AchievementCategory = 'all' | 'habits' | 'streaks' | 'level' | 'focus';

export type AchievementItem = {
  id: string;
  title: string;
  description: string;
  icon: string;
  category: 'habits' | 'streaks' | 'level' | 'focus';
  current: number;
  target: number;
  unit: string;
  unlocked: boolean;
  xpReward: number;
  unlockedAt?: string | null;
};

export default function AchievementsScreen() {
  const colors = useThemeColors();
  const s = useThemedStyles(makeStyles);
  const { width } = useWindowDimensions();
  const { profile, badges, fetchProfile, fetchBadges } = useProfileStore(
    useShallow((st) => ({
      profile: st.profile,
      badges: st.badges,
      fetchProfile: st.fetchProfile,
      fetchBadges: st.fetchBadges,
    })),
  );
  const habits = useHabitStore((st) => st.habits);
  const logs = useLogStore((st) => st.logs);
  const tasks = useTaskStore((st) => st.tasks);
  const sessions = useDeepWorkStore((st) => st.sessions);
  const entries = useJournalStore((st) => st.entries);

  const [activeCategory, setActiveCategory] = useState<AchievementCategory>('all');

  useEffect(() => {
    fetchProfile();
    fetchBadges();
  }, [fetchProfile, fetchBadges]);

  const achievements: AchievementItem[] = useMemo(() => {
    const totalCompletions = logs.length;
    const maxStreak = Math.max(
      profile?.streak_record ?? 0,
      habits.reduce((max, h) => Math.max(max, h.streak_current ?? h.current_streak ?? 0), 0),
    );
    const activeHabitsCount = habits.filter((h) => h.status === 'active').length;
    const userLevel = profile?.level ?? 1;
    const completedTasksCount = tasks.filter((t) => t.completed).length;
    const deepWorkCount = sessions.length;
    const journalCount = entries.length;

    const list: AchievementItem[] = [
      {
        id: 'first_step',
        title: 'İlk Adım',
        description: 'İlk alışkanlığını tamamla ve yolculuğuna başla.',
        icon: 'footsteps-outline',
        category: 'habits',
        current: Math.min(totalCompletions, 1),
        target: 1,
        unit: 'tamamlama',
        unlocked: totalCompletions >= 1,
        xpReward: 50,
      },
      {
        id: 'week_streak',
        title: 'Haftalık Zincir',
        description: 'Herhangi bir alışkanlıkta 7 günlük seri yakala.',
        icon: 'flame-outline',
        category: 'streaks',
        current: Math.min(maxStreak, 7),
        target: 7,
        unit: 'günlük seri',
        unlocked: maxStreak >= 7,
        xpReward: 150,
      },
      {
        id: 'multitask_master',
        title: 'Çoklu Görev',
        description: '3 aktif alışkanlığı aynı anda başarıyla yönet.',
        icon: 'layers-outline',
        category: 'habits',
        current: Math.min(activeHabitsCount, 3),
        target: 3,
        unit: 'aktif alışkanlık',
        unlocked: activeHabitsCount >= 3,
        xpReward: 100,
      },
      {
        id: 'hundred_club',
        title: 'Yüzlükler Kulübü',
        description: 'Toplam 100 alışkanlık tamamlamasına ulaş.',
        icon: 'ribbon-outline',
        category: 'habits',
        current: Math.min(totalCompletions, 100),
        target: 100,
        unit: 'tamamlama',
        unlocked: totalCompletions >= 100,
        xpReward: 500,
      },
      {
        id: 'discipline_master',
        title: 'Disiplin Ustası',
        description: 'Karakterini geliştirerek 10. seviyeye ulaş.',
        icon: 'shield-checkmark-outline',
        category: 'level',
        current: Math.min(userLevel, 10),
        target: 10,
        unit: 'seviye',
        unlocked: userLevel >= 10,
        xpReward: 300,
      },
      {
        id: 'deep_diver',
        title: 'Derin Odak',
        description: 'En az 3 derin çalışma odak seansı tamamla.',
        icon: 'flash-outline',
        category: 'focus',
        current: Math.min(deepWorkCount, 3),
        target: 3,
        unit: 'seans',
        unlocked: deepWorkCount >= 3,
        xpReward: 200,
      },
      {
        id: 'task_slayer',
        title: 'Görev Avcısı',
        description: 'Planındaki 25 görevi başarıyla bitir.',
        icon: 'checkbox-outline',
        category: 'focus',
        current: Math.min(completedTasksCount, 25),
        target: 25,
        unit: 'görev',
        unlocked: completedTasksCount >= 25,
        xpReward: 250,
      },
      {
        id: 'journal_keeper',
        title: 'İçsel Yansıma',
        description: 'Zihnini berraklaştırmak için 5 günlük kaydı tut.',
        icon: 'book-outline',
        category: 'focus',
        current: Math.min(journalCount, 5),
        target: 5,
        unit: 'günlük',
        unlocked: journalCount >= 5,
        xpReward: 150,
      },
      {
        id: 'month_streak',
        title: 'Demir İrade',
        description: '30 günlük kesintisiz tamamlama serisi kur.',
        icon: 'trophy-outline',
        category: 'streaks',
        current: Math.min(maxStreak, 30),
        target: 30,
        unit: 'günlük seri',
        unlocked: maxStreak >= 30,
        xpReward: 1000,
      },
      {
        id: 'legend_rank',
        title: 'Efsane Rütbesi',
        description: '25. seviyeye ulaş ve zirveye yerleş.',
        icon: 'star-outline',
        category: 'level',
        current: Math.min(userLevel, 25),
        target: 25,
        unit: 'seviye',
        unlocked: userLevel >= 25,
        xpReward: 1500,
      },
    ];

    // Supabase profile_badges ile eşleştir
    return list.map((item) => {
      const dbMatch = badges.find(
        (b) => b.badge_name?.toLowerCase() === item.title.toLowerCase() || b.id === item.id,
      );
      if (dbMatch) {
        return {
          ...item,
          unlocked: true,
          unlockedAt: dbMatch.earned_at,
        };
      }
      return item;
    });
  }, [habits, logs, tasks, sessions, entries, profile, badges]);

  const filteredAchievements = useMemo(() => {
    if (activeCategory === 'all') return achievements;
    return achievements.filter((a) => a.category === activeCategory);
  }, [achievements, activeCategory]);

  const unlockedCount = achievements.filter((a) => a.unlocked).length;
  const progressPercent = Math.round((unlockedCount / achievements.length) * 100);
  const vitrineWidth = width >= 980 ? '31.8%' : '48.2%';

  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      <AtmosphericScreenCanvas
        source={CANVASES.pantheonHall}
        textureSource={TEXTURES.archivalPaper}
        scrim={0.62}
        tintColor={colors.warning}
      />
      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        {/* Başlık & İlerleme Kartı */}
        <View style={s.heroCard}>
          <TexturedSurface source={TEXTURES.topographic} textureOpacity={0.07} overlayOnly />
          <EmbeddedFiligree source={DECOR.guillocheWave} anchor="full-bleed" opacity={0.11} />
          <EmbeddedFiligree source={DECOR.cornerAstrolabe} anchor="top-right" opacity={0.18} size={112} />
          <View style={s.heroHeader}>
            <View>
              <Text style={s.heroTitle}>Başarım & Rozetler</Text>
              <Text style={s.heroSub}>
                {unlockedCount} / {achievements.length} Başarım Açıldı (%{progressPercent})
              </Text>
            </View>
            <View style={s.trophyWrap}>
              <Ionicons name="trophy" size={26} color={colors.warning} />
            </View>
          </View>

          {/* İlerleme Çubuğu */}
          <View style={s.progressBarTrack}>
            <View style={[s.progressBarFill, { width: `${progressPercent}%` }]} />
          </View>
        </View>

        {/* Kategori Filtreleri */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.filterRow}>
          {([
            { key: 'all', label: 'Tümü' },
            { key: 'habits', label: 'Alışkanlık' },
            { key: 'streaks', label: 'Seri' },
            { key: 'level', label: 'Seviye' },
            { key: 'focus', label: 'Odak & Zihin' },
          ] as const).map((cat) => {
            const active = activeCategory === cat.key;
            return (
              <TouchableOpacity
                key={cat.key}
                style={[s.filterChip, active && s.filterChipActive]}
                onPress={() => {
                  haptic.select();
                  setActiveCategory(cat.key);
                }}
                accessibilityRole="button"
                accessibilityLabel={`${cat.label} başarımlarını filtrele`}
              >
                <Text style={[s.filterChipText, active && s.filterChipTextActive]}>{cat.label}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        <ChapterDivider source={DECOR.dividerSundial} label="KOLEKSİYON VİTRİNİ" />

        {/* Kadife Koleksiyon Vitrini Izgarası (2-Sütun / Geniş Ekranda 3-Sütun) */}
        <View style={s.vitrineGrid}>
          {filteredAchievements.map((item) => {
            const pct = Math.min(100, Math.round((item.current / item.target) * 100));
            return (
              <View
                key={item.id}
                style={[
                  s.vitrineCard,
                  { width: vitrineWidth },
                  item.unlocked ? s.cardUnlocked : s.cardLocked,
                ]}
              >
                <EmbeddedFiligree
                  source={DECOR.cornerAstrolabe}
                  anchor="bottom-right"
                  opacity={item.unlocked ? 0.16 : 0.06}
                  size={88}
                />

                <View style={s.vitrineTopBar}>
                  <View style={[s.statusDot, item.unlocked ? s.statusDotOn : s.statusDotOff]} />
                  <View style={s.badgePill}>
                    <Text style={s.xpBadgeText}>+{item.xpReward} XP</Text>
                  </View>
                </View>

                <View style={s.pedestalStage}>
                  {item.unlocked ? <View style={s.medallionSpotlight} /> : null}
                  <EmblemMedallion
                    source={getAchievementBadge(item.id)}
                    size={62}
                    unlocked={item.unlocked}
                    accentColor={colors.warning}
                  />
                </View>

                <View style={s.cardBody}>
                  <Text style={[s.cardTitle, !item.unlocked && s.cardTitleLocked]} numberOfLines={1}>
                    {item.title}
                  </Text>
                  <Text style={s.cardDesc} numberOfLines={2}>{item.description}</Text>

                  {/* İlerleme Çubuğu veya Kazanıldı Bilgisi */}
                  {item.unlocked ? (
                    <View style={s.unlockedRow}>
                      <Ionicons name="checkmark-circle" size={14} color={colors.success} />
                      <Text style={s.unlockedText}>Kazanıldı</Text>
                    </View>
                  ) : (
                    <View style={s.progressCol}>
                      <View style={s.subProgressTrack}>
                        <View style={[s.subProgressFill, { width: `${pct}%` }]} />
                      </View>
                      <Text style={s.progressText}>
                        {item.current} / {item.target} {item.unit}
                      </Text>
                    </View>
                  )}
                </View>
              </View>
            );
          })}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.bg },
    content: { padding: space.lg, paddingBottom: space.hh, gap: space.md },

    heroCard: {
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      padding: space.lg,
      gap: space.md,
      overflow: 'hidden',
      position: 'relative',
    },
    heroHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    heroTitle: {
      ...font.title,
      fontSize: 20,
      fontWeight: '800',
      color: colors.text,
    },
    heroSub: {
      ...font.caption,
      color: colors.textDim,
      marginTop: 2,
    },
    trophyWrap: {
      width: 46,
      height: 46,
      borderRadius: 23,
      backgroundColor: alphaHex(colors.warning, '18'),
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: alphaHex(colors.warning, '35'),
    },
    progressBarTrack: {
      height: 8,
      backgroundColor: colors.surfaceAlt,
      borderRadius: radius.full,
      overflow: 'hidden',
    },
    progressBarFill: {
      height: '100%',
      backgroundColor: colors.warning,
      borderRadius: radius.full,
    },

    filterRow: {
      flexDirection: 'row',
      gap: space.sm,
      paddingVertical: space.xs,
    },
    filterChip: {
      paddingHorizontal: space.md,
      paddingVertical: space.sm,
      borderRadius: radius.full,
      backgroundColor: colors.surfaceAlt,
      borderWidth: 1,
      borderColor: colors.border,
    },
    filterChipActive: {
      backgroundColor: alphaHex(colors.primary, '20'),
      borderColor: colors.primary,
    },
    filterChipText: {
      ...font.caption,
      fontWeight: '600',
      color: colors.textDim,
    },
    filterChipTextActive: {
      color: colors.primary,
      fontWeight: '700',
    },

    vitrineGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: space.md,
      justifyContent: 'space-between',
    },
    vitrineCard: {
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      borderWidth: 1,
      padding: space.md,
      gap: space.sm,
      overflow: 'hidden',
      position: 'relative',
    },
    cardUnlocked: {
      borderColor: alphaHex(colors.warning, '45'),
      backgroundColor: alphaHex(colors.surface, '96'),
    },
    cardLocked: {
      borderColor: colors.borderSubtle,
      opacity: 0.88,
    },
    vitrineTopBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    statusDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
    },
    statusDotOn: {
      backgroundColor: colors.warning,
    },
    statusDotOff: {
      backgroundColor: colors.border,
    },
    pedestalStage: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 8,
      position: 'relative',
    },
    medallionSpotlight: {
      position: 'absolute',
      width: 84,
      height: 84,
      borderRadius: 42,
      backgroundColor: alphaHex(colors.warning, '16'),
    },
    cardBody: {
      gap: 5,
      alignItems: 'center',
    },
    cardTitle: {
      ...font.title,
      fontSize: 14,
      fontWeight: '800',
      color: colors.text,
      textAlign: 'center',
    },
    cardTitleLocked: {
      color: colors.textDim,
    },
    cardDesc: {
      ...font.body,
      fontSize: 11,
      color: colors.textFaint,
      lineHeight: 15,
      textAlign: 'center',
      minHeight: 30,
    },
    badgePill: {
      paddingHorizontal: 8,
      paddingVertical: 2,
      borderRadius: radius.sm,
      backgroundColor: alphaHex(colors.accent, '18'),
    },
    xpBadgeText: {
      fontSize: 10,
      fontWeight: '700',
      color: colors.accent,
    },
    unlockedRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 5,
      marginTop: 4,
      paddingHorizontal: 10,
      paddingVertical: 3,
      borderRadius: radius.full,
      backgroundColor: alphaHex(colors.success, '14'),
    },
    unlockedText: {
      fontSize: 11,
      fontWeight: '700',
      color: colors.success,
    },
    progressCol: {
      width: '100%',
      gap: 4,
      marginTop: 4,
    },
    subProgressTrack: {
      width: '100%',
      height: 5,
      backgroundColor: colors.surfaceAlt,
      borderRadius: radius.full,
      overflow: 'hidden',
    },
    subProgressFill: {
      height: '100%',
      backgroundColor: colors.primary,
      borderRadius: radius.full,
    },
    progressText: {
      fontSize: 10,
      fontWeight: '600',
      color: colors.textFaint,
      textAlign: 'center',
    },
  });
