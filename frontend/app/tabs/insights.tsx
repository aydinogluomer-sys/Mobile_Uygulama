import { useState } from 'react';
import { View, StyleSheet, TouchableOpacity, Text, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import SegmentedTabs, { type Segment } from '../../components/SegmentedTabs';
import ObsidianExportModal from '../../components/ObsidianExportModal';
import { colors, radius, alphaHex } from '../../lib/tokens';
import StatsScreen from './stats';
import WeeklyReviewScreen from '../screens/weekly-review';
import MonthlyReviewScreen from '../screens/monthly-review';
import InsightsDetailScreen from '../screens/insights';
import RecoveryScreen from '../screens/recovery';
import JournalScreen from '../screens/journal';
import JournalArchiveScreen from '../screens/journal-archive';
import JournalInsightsScreen from '../screens/journal-insights';
import AICoachScreen from '../screens/ai-coach';

/**
 * İÇGÖRÜLER & DEĞERLENDİRME (Calm Tech 3 Sütun):
 * 1. Özet & Telafi (Genel İstatistik, Telafi Kalkanı, Davranış Korelasyonu, Haftalık/Aylık İnceleme)
 * 2. Zihin & Günlük (Günlük Yaz, Arşiv, AI Analizi + Obsidian Markdown Aktarımı)
 * 3. AI Koç (Kanıt Satırlı Akıllı Koç + Odak Puanı / Kredi Geçmişi Kısayolu)
 */
type MainTab = 'reports' | 'journal' | 'coach';
type ReportTab = 'stats' | 'recovery' | 'behaviour' | 'weekly' | 'monthly';
type JournalTab = 'write' | 'archive' | 'insights';

const MAIN_SEGMENTS: readonly Segment<MainTab>[] = [
  { key: 'reports', label: 'Özet & Telafi' },
  { key: 'journal', label: 'Zihin & Günlük' },
  { key: 'coach', label: 'AI Koç' },
];

const REPORT_SEGMENTS: readonly { key: ReportTab; label: string }[] = [
  { key: 'stats', label: 'Genel' },
  { key: 'recovery', label: 'Telafi Kalkanı' },
  { key: 'behaviour', label: 'Davranış' },
  { key: 'weekly', label: 'Haftalık' },
  { key: 'monthly', label: 'Aylık' },
];

export default function InsightsHubScreen() {
  const router = useRouter();
  const [mainTab, setMainTab] = useState<MainTab>('reports');
  const [reportTab, setReportTab] = useState<ReportTab>('stats');
  const [journalTab, setJournalTab] = useState<JournalTab>('write');
  const [showObsidianModal, setShowObsidianModal] = useState(false);

  return (
    <View style={s.root}>
      <SegmentedTabs segments={MAIN_SEGMENTS} value={mainTab} onChange={setMainTab} />

      {mainTab === 'reports' && (
        <View style={s.subBarContainer}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={s.subBarContent}
          >
            {REPORT_SEGMENTS.map((seg) => {
              const active = reportTab === seg.key;
              return (
                <TouchableOpacity
                  key={seg.key}
                  style={[s.subPill, active && s.subPillActive]}
                  onPress={() => setReportTab(seg.key)}
                  accessibilityRole="button"
                  accessibilityLabel={seg.label}
                >
                  <Text style={[s.subPillText, active && s.subPillTextActive]}>
                    {seg.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      )}

      {mainTab === 'journal' && (
        <View style={s.subBarContainer}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.subBarContent}>
            <TouchableOpacity
              style={[s.subPill, journalTab === 'write' && s.subPillActive]}
              onPress={() => setJournalTab('write')}
              accessibilityRole="button"
              accessibilityLabel="Günlük yaz"
            >
              <Text style={[s.subPillText, journalTab === 'write' && s.subPillTextActive]}>
                ✍️ Günlük Yaz
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.subPill, journalTab === 'archive' && s.subPillActive]}
              onPress={() => setJournalTab('archive')}
              accessibilityRole="button"
              accessibilityLabel="Geçmiş günlüğü ve arşivi görüntüle"
            >
              <Text style={[s.subPillText, journalTab === 'archive' && s.subPillTextActive]}>
                📖 Arşiv
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.subPill, journalTab === 'insights' && s.subPillActive]}
              onPress={() => setJournalTab('insights')}
              accessibilityRole="button"
              accessibilityLabel="AI Günlük Analizi ve İçgörüleri"
            >
              <Text style={[s.subPillText, journalTab === 'insights' && s.subPillTextActive]}>
                🧠 AI Analizi
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={s.obsidianPill}
              onPress={() => setShowObsidianModal(true)}
              accessibilityRole="button"
              accessibilityLabel="Obsidian Markdown olarak dışa aktar"
            >
              <Ionicons name="document-text-outline" size={12} color="#8b5cf6" />
              <Text style={s.obsidianPillText}>Obsidian</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      )}

      {mainTab === 'coach' && (
        <View style={s.coachTopStrip}>
          <Text style={s.coachStripHint}>Kanıta dayalı eylem önerileri · Onayınızla uygulanır</Text>
          <TouchableOpacity
            style={s.creditHistoryBtn}
            onPress={() => router.push('/screens/credit-history' as any)}
            accessibilityRole="button"
            accessibilityLabel="Odak Puanı ve Kredi Geçmişini Gör"
          >
            <Ionicons name="diamond-outline" size={12} color={colors.warning} />
            <Text style={s.creditHistoryText}>Puan Geçmişi →</Text>
          </TouchableOpacity>
        </View>
      )}

      <View style={s.body}>
        {mainTab === 'reports' && (
          <>
            {reportTab === 'stats' && <StatsScreen />}
            {reportTab === 'weekly' && <WeeklyReviewScreen />}
            {reportTab === 'monthly' && <MonthlyReviewScreen />}
            {reportTab === 'behaviour' && <InsightsDetailScreen />}
            {reportTab === 'recovery' && <RecoveryScreen />}
          </>
        )}
        {mainTab === 'journal' && (
          journalTab === 'write' ? (
            <JournalScreen />
          ) : journalTab === 'archive' ? (
            <JournalArchiveScreen />
          ) : (
            <JournalInsightsScreen />
          )
        )}
        {mainTab === 'coach' && <AICoachScreen />}
      </View>

      <ObsidianExportModal
        visible={showObsidianModal}
        onClose={() => setShowObsidianModal(false)}
      />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  subBarContainer: {
    backgroundColor: colors.bgElevated,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
    paddingVertical: 6,
  },
  subBarContent: {
    paddingHorizontal: 12,
    flexDirection: 'row',
    gap: 6,
    alignItems: 'center',
  },
  subPill: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
  },
  subPillActive: {
    backgroundColor: alphaHex(colors.primary, '20'),
    borderColor: colors.primary,
  },
  subPillText: {
    fontSize: 12,
    fontWeight: '500',
    color: colors.textFaint,
  },
  subPillTextActive: {
    color: colors.primary,
    fontWeight: '600',
  },
  obsidianPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.full,
    backgroundColor: alphaHex('#8b5cf6', '16'),
    borderWidth: 1,
    borderColor: alphaHex('#8b5cf6', '40'),
  },
  obsidianPillText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#8b5cf6',
  },
  coachTopStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 6,
    backgroundColor: colors.bgElevated,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
  },
  coachStripHint: {
    fontSize: 11,
    color: colors.textFaint,
  },
  creditHistoryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.sm,
    backgroundColor: alphaHex(colors.warning, '16'),
  },
  creditHistoryText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.warning,
  },
  body: { flex: 1 },
});
