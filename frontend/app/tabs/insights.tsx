import { useEffect, useState } from 'react';
import { View, StyleSheet, TouchableOpacity, Text, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import SegmentedTabs, { type Segment } from '../../components/SegmentedTabs';
import ObsidianExportModal from '../../components/ObsidianExportModal';
import { colors, radius, alphaHex } from '../../lib/tokens';
import { navigateTo } from '../../lib/destinations';
import { useTabParam } from '../../hooks/useTabParams';
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
export const INSIGHTS_MAIN_TABS = ['reports', 'journal', 'coach'] as const;
export const INSIGHTS_REPORT_TABS = ['stats', 'recovery', 'behaviour', 'weekly', 'monthly'] as const;
export const INSIGHTS_JOURNAL_TABS = ['write', 'archive', 'insights'] as const;
const INSIGHTS_SUB_TABS = [...INSIGHTS_REPORT_TABS, ...INSIGHTS_JOURNAL_TABS] as const;

type MainTab = (typeof INSIGHTS_MAIN_TABS)[number];
type ReportTab = (typeof INSIGHTS_REPORT_TABS)[number];
type JournalTab = (typeof INSIGHTS_JOURNAL_TABS)[number];

function isReportTab(v: string | null): v is ReportTab {
  return v !== null && (INSIGHTS_REPORT_TABS as readonly string[]).includes(v);
}

function isJournalTab(v: string | null): v is JournalTab {
  return v !== null && (INSIGHTS_JOURNAL_TABS as readonly string[]).includes(v);
}

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
  const { value: mainParam, stamp } = useTabParam(INSIGHTS_MAIN_TABS, 'tab');
  const { value: subParam } = useTabParam(INSIGHTS_SUB_TABS, 'sub');

  const [mainTab, setMainTab] = useState<MainTab>(() => mainParam ?? 'reports');
  const [reportTab, setReportTab] = useState<ReportTab>(() =>
    isReportTab(subParam) ? subParam : 'stats',
  );
  const [journalTab, setJournalTab] = useState<JournalTab>(() =>
    isJournalTab(subParam) ? subParam : 'write',
  );
  const [showObsidianModal, setShowObsidianModal] = useState(false);

  useEffect(() => {
    if (mainParam) setMainTab(mainParam);
    if (isReportTab(subParam)) setReportTab(subParam);
    if (isJournalTab(subParam)) setJournalTab(subParam);
  }, [mainParam, subParam, stamp]);

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
            onPress={() => navigateTo(router, 'credit-history')}
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
