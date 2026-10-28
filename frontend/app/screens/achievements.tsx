import { useState, useMemo, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors, alphaHex, radius, space, font } from '../../lib/tokens';
import { useProfileStore } from '../../store/profileStore';
import { useHabitStore } from '../../store/habitStore';
import { useLogStore } from '../../store/logStore';
import { useTaskStore } from '../../store/taskStore';
import { useDeepWorkStore } from '../../store/deepWorkStore';
import { useJournalStore } from '../../store/journalStore';
import { haptic } from '../../lib/haptics';

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
  const { profile, badges, fetchProfile, fetchBadges } = useProfileStore();
  const { habits } = useHabitStore();
  const { logs } = useLogStore();
  const { tasks } = useTaskStore();
  const { sessions } = useDeepWorkStore();
  const { entries } = useJournalStore();

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
        (b) => b.badge_name?.toLowerCase() === item.title.toLowerCase() || b.id === item.id
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

  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        {/* Başlık & İlerleme Kartı */}
        <View style={s.heroCard}>
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
          {[
            { key: 'all', label: 'Tümü' },
            { key: 'habits', label: 'Alışkanlık' },
            { key: 'streaks', label: 'Seri' },
            { key: 'level', label: 'Seviye' },
            { key: 'focus', label: 'Odak & Zihin' },
          ].map((cat) => {
            const active = activeCategory === cat.key;
            return (
              <TouchableOpacity
                key={cat.key}
                style={[s.filterChip, active && s.filterChipActive]}
                onPress={() => {
                  haptic.select();
                  setActiveCategory(cat.key as AchievementCategory);
                }}
                accessibilityRole="button"
                accessibilityLabel={`${cat.label} başarımlarını filtrele`}
              >
                <Text style={[s.filterChipText, active && s.filterChipTextActive]}>{cat.label}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* Başarımlar Listesi */}
        <View style={s.list}>
          {filteredAchievements.map((item) => {
            const pct = Math.min(100, Math.round((item.current / item.target) * 100));
            return (
              <View
                key={item.id}
                style={[
                  s.card,
                  item.unlocked ? s.cardUnlocked : s.cardLocked,
                ]}
              >
                <View
                  style={[
                    s.iconWrap,
                    item.unlocked ? s.iconWrapUnlocked : s.iconWrapLocked,
                  ]}
                >
                  <Ionicons
                    name={item.icon as any}
                    size={24}
                    color={item.unlocked ? colors.warning : colors.textFaint}
                  />
                </View>

                <View style={s.cardBody}>
                  <View style={s.cardTopRow}>
                    <Text style={[s.cardTitle, !item.unlocked && s.cardTitleLocked]}>
                      {item.title}
                    </Text>
                    <View style={s.badgePill}>
                      <Text style={s.xpBadgeText}>+{item.xpReward} XP</Text>
                    </View>
                  </View>

                  <Text style={s.cardDesc}>{item.description}</Text>

                  {/* İlerleme Çubuğu veya Kazanıldı Bilgisi */}
                  {item.unlocked ? (
                    <View style={s.unlockedRow}>
                      <Ionicons name="checkmark-circle" size={14} color={colors.success} />
                      <Text style={s.unlockedText}>Kazanıldı</Text>
                    </View>
                  ) : (
                    <View style={s.progressRow}>
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

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space.lg, paddingBottom: space.hh, gap: space.md },

  heroCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.lg,
    gap: space.md,
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

  list: {
    gap: space.md,
  },
  card: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: space.md,
    gap: space.md,
    alignItems: 'center',
  },
  cardUnlocked: {
    borderColor: alphaHex(colors.warning, '35'),
    backgroundColor: alphaHex(colors.surface, '90'),
  },
  cardLocked: {
    borderColor: colors.borderSubtle,
    opacity: 0.85,
  },
  iconWrap: {
    width: 50,
    height: 50,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconWrapUnlocked: {
    backgroundColor: alphaHex(colors.warning, '20'),
    borderWidth: 1,
    borderColor: alphaHex(colors.warning, '40'),
  },
  iconWrapLocked: {
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  cardBody: {
    flex: 1,
    gap: 4,
  },
  cardTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardTitle: {
    ...font.title,
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
  },
  cardTitleLocked: {
    color: colors.textDim,
  },
  cardDesc: {
    ...font.body,
    fontSize: 12,
    color: colors.textFaint,
    lineHeight: 16,
  },
  badgePill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radius.sm,
    backgroundColor: alphaHex(colors.accent, '18'),
  },
  xpBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.accent,
  },
  unlockedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 4,
  },
  unlockedText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.success,
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginTop: 6,
  },
  subProgressTrack: {
    flex: 1,
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
  },
});
