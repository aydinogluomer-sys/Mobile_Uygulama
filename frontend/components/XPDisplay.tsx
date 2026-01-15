import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { profileAPI } from '../utils/api';

interface XPDisplayProps {
  onProfileLoad?: (profile: any) => void;
}

export default function XPDisplay({ onProfileLoad }: XPDisplayProps) {
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadProfile();
  }, []);

  const loadProfile = async () => {
    try {
      const data = await profileAPI.getProfile();
      setProfile(data);
      if (onProfileLoad) onProfileLoad(data);
    } catch (error) {
      console.error('Profile yüklenirken hata:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading || !profile) {
    return null;
  }

  const getRankColor = (rank: string) => {
    const colors: any = {
      'Acemi': '#9ca3af',
      'Disiplinli': '#3b82f6',
      'Uzman': '#8b5cf6',
      'Master': '#f59e0b',
      'Efsane': '#ef4444',
    };
    return colors[rank] || '#6366f1';
  };

  const progressPercent = (profile.current_level_xp / profile.next_level_xp) * 100;

  return (
    <View style={styles.container}>
      <View style={styles.levelBadge}>
        <Text style={styles.levelLabel}>LVL</Text>
        <Text style={styles.levelNumber}>{profile.level}</Text>
      </View>

      <View style={styles.xpInfo}>
        <View style={styles.rankContainer}>
          <Text style={[styles.rankText, { color: getRankColor(profile.willpower_rank) }]}>
            {profile.willpower_rank}
          </Text>
        </View>
        
        <View style={styles.progressBarContainer}>
          <View style={styles.progressBarBg}>
            <View 
              style={[
                styles.progressBarFill, 
                { 
                  width: `${progressPercent}%`,
                  backgroundColor: getRankColor(profile.willpower_rank)
                }
              ]} 
            />
          </View>
          <Text style={styles.xpText}>
            {profile.current_level_xp}/{profile.next_level_xp} XP
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#0f0f0f',
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a2a',
  },
  levelBadge: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#6366f1',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#818cf8',
  },
  levelLabel: {
    fontSize: 9,
    fontWeight: 'bold',
    color: '#fff',
    opacity: 0.8,
  },
  levelNumber: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#fff',
  },
  xpInfo: {
    flex: 1,
  },
  rankContainer: {
    marginBottom: 4,
  },
  rankText: {
    fontSize: 13,
    fontWeight: '600',
  },
  progressBarContainer: {
    gap: 4,
  },
  progressBarBg: {
    height: 8,
    backgroundColor: '#2a2a2a',
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 4,
  },
  xpText: {
    fontSize: 11,
    color: '#9ca3af',
    fontWeight: '600',
  },
});
