import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Modal,
  TextInput,
  Alert,
  Share,
  ActivityIndicator,
  Linking,
  Switch,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useThemeStore } from '../../store/themeStore';
import { ACCENTS, type AccentKey } from '../../lib/tokens';
import type { SeasonalMotionIntensity } from '../../components/seasonalMotion/types';
import { webhookAPI, exportAPI } from '../../utils/api';

const SEASONAL_OPTIONS: { v: SeasonalMotionIntensity; l: string }[] = [
  { v: 'off', l: 'Kapalı' },
  { v: 'subtle', l: 'Hafif' },
  { v: 'normal', l: 'Normal' },
];
import { Webhook } from '../../types';
import BadHabitsTracker from '../../components/BadHabitsTracker';
import { seedDemoData, isSeedingAllowed } from '../../lib/demoSeed';
import IntegrationCategoryCard from '../../components/IntegrationCategoryCard';
import IntegrationItemCard from '../../components/IntegrationItemCard';
import {
  INTEGRATION_CATEGORIES,
  type IntegrationCategoryId,
} from '../../constants/integrations';
import { CURRENT_FEATURES, UPCOMING_FEATURES, type FeatureHighlight } from '../../constants/features';

export default function SettingsScreen() {
  const { isDark, toggle: toggleTheme } = useThemeStore();
  const seasonalMotion = useThemeStore((st) => st.seasonalMotion);
  const setSeasonalMotion = useThemeStore((st) => st.setSeasonalMotion);
  const accent = useThemeStore((st) => st.accent);
  const setAccent = useThemeStore((st) => st.setAccent);
  const [showWebhookModal, setShowWebhookModal] = useState(false);
  const [selectedCategoryId, setSelectedCategoryId] = useState<IntegrationCategoryId | null>(
    null
  );
  const [categoryDetailVisible, setCategoryDetailVisible] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState('');
  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [showBadHabitsTracker, setShowBadHabitsTracker] = useState(false);
  const [exportingFormat, setExportingFormat] = useState<string | null>(null);
  const [seedingDemo, setSeedingDemo] = useState(false);

  const loadWebhooks = async () => {
    try {
      const data = await webhookAPI.getAll();
      setWebhooks(data);
    } catch (error) {
      console.error('Webhook\'lar yüklenirken hata:', error);
    }
  };

  const handleAddWebhook = async () => {
    try {
      if (!webhookUrl.trim()) {
        Alert.alert('Hata', 'Lütfen geçerli bir URL girin');
        return;
      }

      await webhookAPI.create({
        url: webhookUrl,
        event_types: ['habit_completed', 'task_completed'],
      });

      Alert.alert('Başarılı', 'Webhook eklendi!');
      setWebhookUrl('');
      setShowWebhookModal(false);
      await loadWebhooks();
    } catch (error) {
      Alert.alert('Hata', 'Webhook eklenirken bir hata oluştu');
      console.error('Webhook eklenirken hata:', error);
    }
  };

  const handleExportData = async (format: 'json' | 'excel' | 'csv') => {
    try {
      setExportingFormat(format);
      
      if (format === 'json') {
        const data = await exportAPI.exportAll();
        const jsonString = JSON.stringify(data, null, 2);
        await Share.share({
          message: jsonString,
          title: 'Atlas Veri Yedeği',
        });
      } else {
        // For Excel and CSV, open download URL
        const baseURL = process.env.EXPO_PUBLIC_BACKEND_URL || 'http://localhost:8000';
        const endpoint = format === 'excel' ? '/api/data/export/excel' : '/api/data/export/csv';
        const url = `${baseURL}${endpoint}`;
        
        // On web, it will download automatically
        // On mobile, open in browser
        const supported = await Linking.canOpenURL(url);
        if (supported) {
          await Linking.openURL(url);
          Alert.alert(
            'Başarılı',
            `${format.toUpperCase()} dosyanız hazırlanıyor. İndirmeler klasörünüze kaydedilecek.`
          );
        } else {
          Alert.alert('Hata', 'URL açılamadı');
        }
      }
    } catch (error) {
      Alert.alert('Hata', 'Veriler dışa aktarılırken bir hata oluştu');
      console.error('Export hatası:', error);
    } finally {
      setExportingFormat(null);
    }
  };

  const handleOpenWebhookFromDetail = () => {
    setCategoryDetailVisible(false);
    setTimeout(() => {
      setSelectedCategoryId(null);
      loadWebhooks();
      setShowWebhookModal(true);
    }, 280);
  };

  const handleSeedDemoData = async () => {
    try {
      setSeedingDemo(true);
      const result = await seedDemoData();
      Alert.alert(
        'Demo veri hazir',
        `Projeler: +${result.projects}\nGorevler: +${result.tasks}\nAliskanliklar: +${result.habits}\nLoglar: +${result.logs}\nOdak gorevleri: +${result.focusTasks}\nTelafi planlari: +${result.recoveryPlans}\nGunluk girdileri: +${result.journalEntries}`
      );
    } catch (error) {
      Alert.alert('Hata', 'Demo verileri eklenirken bir hata olustu.');
      console.error('Demo seed error:', error);
    } finally {
      setSeedingDemo(false);
    }
  };

  const selectedCategory = selectedCategoryId
    ? INTEGRATION_CATEGORIES.find((c) => c.id === selectedCategoryId) ?? null
    : null;

  const renderFeatureItem = (item: FeatureHighlight) => (
    <View key={item.id} style={styles.featureItem}>
      <View style={[styles.featureIcon, { backgroundColor: `${item.color}20` }]}>
        <Ionicons name={item.icon as any} size={20} color={item.color} />
      </View>
      <View style={styles.featureInfo}>
        <Text style={styles.featureTitle}>{item.title}</Text>
        <Text style={styles.featureDescription}>{item.description}</Text>
      </View>
    </View>
  );

  const renderSettingItem = (
    icon: string,
    title: string,
    subtitle: string,
    onPress: () => void,
    color = '#D97757'
  ) => (
    <TouchableOpacity style={styles.settingItem} onPress={onPress}>
      <View style={styles.settingLeft}>
        <View style={[styles.settingIcon, { backgroundColor: color + '20' }]}>
          <Ionicons name={icon as any} size={24} color={color} />
        </View>
        <View style={styles.settingInfo}>
          <Text style={styles.settingTitle}>{title}</Text>
          <Text style={styles.settingSubtitle}>{subtitle}</Text>
        </View>
      </View>
      <Ionicons name="chevron-forward" size={20} color="#827E72" />
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView style={styles.scrollView}>
        <View style={styles.content}>
          <Text style={styles.title}>Ayarlar</Text>
          <Text style={styles.subtitle}>Uygulamanızı özelleştirin</Text>

          {/* Görünüm */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Görünüm</Text>
            <View style={styles.themeRow}>
              <View style={styles.themeLeft}>
                <Ionicons
                  name={isDark ? 'moon-outline' : 'sunny-outline'}
                  size={20}
                  color={isDark ? '#D97757' : '#D4A84A'}
                />
                <View>
                  <Text style={styles.themeLabel}>{isDark ? 'Koyu Tema' : 'Açık Tema'}</Text>
                  <Text style={styles.themeSubLabel}>
                    {isDark ? 'AMOLED dostu koyu arka plan' : 'Gündüz için açık arka plan'}
                  </Text>
                </View>
              </View>
              <Switch
                value={isDark}
                onValueChange={toggleTheme}
                trackColor={{ false: '#383528', true: '#D9775740' }}
                thumbColor={isDark ? '#D97757' : '#BFBBAE'}
              />
            </View>

            {/* Mevsimsel arka plan animasyonları (contract §13) */}
            <View style={styles.motionBlock}>
              <View style={styles.motionHead}>
                <Ionicons name="sparkles-outline" size={18} color="#D97757" />
                <View style={{ flex: 1 }}>
                  <Text style={styles.themeLabel}>Arka plan animasyonları</Text>
                  <Text style={styles.themeSubLabel}>
                    Aylık takvim arka planlarında hafif mevsimsel hareketler gösterir.
                  </Text>
                </View>
              </View>
              <View style={styles.segRow}>
                {SEASONAL_OPTIONS.map((o) => {
                  const on = seasonalMotion === o.v;
                  return (
                    <TouchableOpacity
                      key={o.v}
                      style={[styles.segBtn, on && styles.segBtnOn]}
                      onPress={() => setSeasonalMotion(o.v)}
                    >
                      <Text style={[styles.segText, on && styles.segTextOn]}>{o.l}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            {/* Aksan rengi (Atlas: clay/moss/slate/amber) */}
            <View style={styles.motionBlock}>
              <View style={styles.motionHead}>
                <Ionicons name="color-palette-outline" size={18} color={ACCENTS[accent].primary} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.themeLabel}>Aksan rengi</Text>
                  <Text style={styles.themeSubLabel}>
                    Birincil butonlar, sekme çubuğu ve Bugün başlığında kullanılır.
                  </Text>
                </View>
              </View>
              <View style={styles.accentRow}>
                {(Object.keys(ACCENTS) as AccentKey[]).map((k) => {
                  const a = ACCENTS[k];
                  const on = accent === k;
                  return (
                    <TouchableOpacity
                      key={k}
                      style={styles.accentItem}
                      onPress={() => setAccent(k)}
                      activeOpacity={0.8}
                    >
                      <View style={[styles.accentDot, { backgroundColor: a.primary }, on && styles.accentDotOn]}>
                        {on && <Ionicons name="checkmark" size={16} color="#fff" />}
                      </View>
                      <Text style={[styles.accentLabel, on && { color: a.primary, fontWeight: '700' }]}>{a.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          </View>

          {/* Data & Privacy */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Veri ve Gizlilik</Text>
            
            <View style={styles.exportContainer}>
              <Text style={styles.exportTitle}>Verilerinizi İndirin</Text>
              <Text style={styles.exportSubtitle}>
                Power BI, Excel veya diğer analiz araçlarında kullanabilirsiniz
              </Text>
              
              <View style={styles.exportButtons}>
                <TouchableOpacity
                  style={[styles.exportButton, exportingFormat === 'json' && styles.exportButtonLoading]}
                  onPress={() => handleExportData('json')}
                  disabled={exportingFormat !== null}
                >
                  {exportingFormat === 'json' ? (
                    <ActivityIndicator size="small" color="#D97757" />
                  ) : (
                    <>
                      <Ionicons name="code-outline" size={20} color="#D97757" />
                      <Text style={styles.exportButtonText}>JSON</Text>
                    </>
                  )}
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.exportButton, exportingFormat === 'excel' && styles.exportButtonLoading]}
                  onPress={() => handleExportData('excel')}
                  disabled={exportingFormat !== null}
                >
                  {exportingFormat === 'excel' ? (
                    <ActivityIndicator size="small" color="#87A678" />
                  ) : (
                    <>
                      <Ionicons name="document-outline" size={20} color="#87A678" />
                      <Text style={styles.exportButtonText}>Excel</Text>
                    </>
                  )}
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.exportButton, exportingFormat === 'csv' && styles.exportButtonLoading]}
                  onPress={() => handleExportData('csv')}
                  disabled={exportingFormat !== null}
                >
                  {exportingFormat === 'csv' ? (
                    <ActivityIndicator size="small" color="#D4A84A" />
                  ) : (
                    <>
                      <Ionicons name="list-outline" size={20} color="#D4A84A" />
                      <Text style={styles.exportButtonText}>CSV</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            </View>

            {/* DEMO-001B - sadece gelistirme derlemesinde. Kaynak koruma
                lib/demoSeed.ts icindedir; bu yalnizca calismayacak bir
                kontrolu kullaniciya gostermemek icin. */}
            {isSeedingAllowed() && (
              <TouchableOpacity
                style={[styles.settingItem, seedingDemo && styles.seedBtnDisabled]}
                onPress={handleSeedDemoData}
                disabled={seedingDemo}
              >
                <View style={styles.settingLeft}>
                  <View style={[styles.settingIcon, { backgroundColor: '#87A67820' }]}>
                    <Ionicons name="flask-outline" size={24} color="#87A678" />
                  </View>
                  <View style={styles.settingInfo}>
                    <Text style={styles.settingTitle}>Demo verileri doldur</Text>
                    <Text style={styles.settingSubtitle}>Test icin gorev, aliskanlik, gunluk ve odak verisi ekler</Text>
                  </View>
                </View>
                {seedingDemo ? <ActivityIndicator size="small" color="#87A678" /> : <Ionicons name="chevron-forward" size={20} color="#827E72" />}
              </TouchableOpacity>
            )}
          </View>

          {/* Tracking */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Takip</Text>
            
            {renderSettingItem(
              'ban',
              'Bıraktığım Alışkanlıklar',
              'Tasarruf ve ilerlemenizi görün',
              () => setShowBadHabitsTracker(true),
              '#C76A6A'
            )}
          </View>

          {/* Integrations */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Entegrasyonlar</Text>

            {INTEGRATION_CATEGORIES.map((category) => (
              <IntegrationCategoryCard
                key={category.id}
                category={category}
                onPress={() => {
                  setSelectedCategoryId(category.id);
                  setCategoryDetailVisible(true);
                }}
              />
            ))}
          </View>

          {/* About */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Hakkında</Text>
            
            <View style={styles.infoCard}>
              <Text style={styles.appName}>Atlas</Text>
              <Text style={styles.appVersion}>Versiyon 1.0.0</Text>
              <Text style={styles.appDescription}>
                Minimalist, bilimsel temelli alışkanlık takip uygulaması.
                Verileriniz tamamen sizin kontrolünüzde.
              </Text>
            </View>
          </View>

          {/* Features */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Özellikler</Text>
            <Text style={styles.featureSectionIntro}>
              Atlas’ın kendi alışkanlık motoru. Dış bağlantılar için Entegrasyonlar
              bölümüne bakın.
            </Text>
            <View style={styles.featureCard}>
              <Text style={styles.featureGroupTitle}>Şu an kullanabileceğiniz</Text>
              {CURRENT_FEATURES.map(renderFeatureItem)}
              <View style={styles.featureDivider} />
              <Text style={styles.featureGroupTitle}>Yakında</Text>
              {UPCOMING_FEATURES.map(renderFeatureItem)}
            </View>
          </View>
        </View>
      </ScrollView>

      {/* Webhook Modal */}
      <Modal
        visible={showWebhookModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowWebhookModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Webhook Ekle</Text>
              <TouchableOpacity onPress={() => setShowWebhookModal(false)}>
                <Ionicons name="close" size={28} color="#BFBBAE" />
              </TouchableOpacity>
            </View>

            <Text style={styles.modalDescription}>
              {`Alışkanlık veya görev tamamlandığında otomatik olarak bu URL'e POST isteği gönderilecek.`}
            </Text>

            <TextInput
              style={styles.input}
              placeholder="https://hooks.n8n.cloud/webhook/..."
              placeholderTextColor="#827E72"
              value={webhookUrl}
              onChangeText={setWebhookUrl}
              autoCapitalize="none"
              autoCorrect={false}
            />

            {webhooks.length > 0 && (
              <View style={styles.webhookList}>
                <Text style={styles.webhookListTitle}>{`Mevcut Webhook'lar:`}</Text>
                {webhooks.map((webhook) => (
                  <View key={webhook._id} style={styles.webhookItem}>
                    <Text style={styles.webhookUrl} numberOfLines={1}>
                      {webhook.url}
                    </Text>
                    <TouchableOpacity
                      onPress={async () => {
                        if (webhook._id) {
                          await webhookAPI.delete(webhook._id);
                          await loadWebhooks();
                        }
                      }}
                    >
                      <Ionicons name="trash-outline" size={20} color="#C76A6A" />
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}

            <TouchableOpacity style={styles.addButton} onPress={handleAddWebhook}>
              <Text style={styles.addButtonText}>Webhook Ekle</Text>
            </TouchableOpacity>

            <Text style={styles.helpText}>
              💡 Örnek Payload:{' \n'}
              {JSON.stringify(
                {
                  event: 'habit_completed',
                  data: { habit_name: 'Spor', strength_score: 85 },
                },
                null,
                2
              )}
            </Text>
          </View>
        </View>
      </Modal>

      {/* Category Detail Modal */}
      <Modal
        visible={categoryDetailVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => {
          setCategoryDetailVisible(false);
          setSelectedCategoryId(null);
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <TouchableOpacity
                onPress={() => {
                  setCategoryDetailVisible(false);
                  setSelectedCategoryId(null);
                }}
                accessibilityRole="button"
                accessibilityLabel="Geri"
              >
                <Ionicons name="chevron-back" size={28} color="#BFBBAE" />
              </TouchableOpacity>
              {selectedCategory ? (
                <View style={styles.categoryModalHeaderText}>
                  <Text style={styles.modalTitle}>{selectedCategory.title}</Text>
                  <Text style={styles.modalDescription} numberOfLines={2}>
                    {selectedCategory.description}
                  </Text>
                </View>
              ) : null}
              <View style={styles.categoryModalHeaderSpacer} />
            </View>

            {selectedCategory ? (
              <ScrollView
                style={styles.categoryDetailScroll}
                showsVerticalScrollIndicator={false}
              >
                {selectedCategory.items.map((item) => (
                  <IntegrationItemCard
                    key={item.id}
                    item={item}
                    accentColor={selectedCategory.accentColor}
                    onPress={
                      item.id === 'webhook' && item.status === 'available'
                        ? handleOpenWebhookFromDetail
                        : undefined
                    }
                  />
                ))}
              </ScrollView>
            ) : null}
          </View>
        </View>
      </Modal>

      {/* Bad Habits Tracker */}
      <BadHabitsTracker
        visible={showBadHabitsTracker}
        onClose={() => setShowBadHabitsTracker(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  themeRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#1D1C17', borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: '#383528',
  },
  themeLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  themeLabel: { fontSize: 15, fontWeight: '600', color: '#fff' },
  themeSubLabel: { fontSize: 12, color: '#827E72', marginTop: 2 },
  motionBlock: {
    backgroundColor: '#1D1C17', borderRadius: 12, padding: 14, marginTop: 12,
    borderWidth: 1, borderColor: '#383528', gap: 12,
  },
  motionHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  segRow: { flexDirection: 'row', gap: 8 },
  segBtn: {
    flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 10,
    borderWidth: 1, borderColor: '#383528', backgroundColor: '#15140F',
  },
  segBtnOn: { backgroundColor: '#D9775722', borderColor: '#D97757' },
  segText: { fontSize: 13, fontWeight: '700', color: '#827E72' },
  segTextOn: { color: '#D97757' },
  accentRow: { flexDirection: 'row', gap: 8 },
  accentItem: { flex: 1, alignItems: 'center', gap: 6 },
  accentDot: {
    width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: 'transparent',
  },
  accentDotOn: { borderColor: '#EDEAE0' },
  accentLabel: { fontSize: 12, fontWeight: '600', color: '#827E72' },
  container: {
    flex: 1,
    backgroundColor: '#15140F',
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: 16,
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 16,
    color: '#BFBBAE',
    marginBottom: 24,
  },
  section: {
    marginBottom: 32,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 12,
  },
  settingItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#1D1C17',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#383528',
  },
  settingLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  settingIcon: {
    width: 48,
    height: 48,
    borderRadius: 12,
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
    color: '#fff',
    marginBottom: 4,
  },
  settingSubtitle: {
    fontSize: 13,
    color: '#BFBBAE',
  },
  infoCard: {
    backgroundColor: '#1D1C17',
    borderRadius: 12,
    padding: 20,
    borderWidth: 1,
    borderColor: '#383528',
    alignItems: 'center',
  },
  appName: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 4,
  },
  appVersion: {
    fontSize: 14,
    color: '#D97757',
    marginBottom: 12,
  },
  appDescription: {
    fontSize: 14,
    color: '#BFBBAE',
    textAlign: 'center',
    lineHeight: 20,
  },
  featureSectionIntro: {
    fontSize: 13,
    color: '#BFBBAE',
    marginBottom: 12,
    lineHeight: 18,
  },
  featureCard: {
    backgroundColor: '#1D1C17',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#383528',
  },
  featureGroupTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 8,
  },
  featureDivider: {
    height: 1,
    backgroundColor: '#383528',
    marginVertical: 12,
  },
  featureItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 10,
  },
  featureIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  featureInfo: {
    flex: 1,
  },
  featureTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 2,
  },
  featureDescription: {
    fontSize: 13,
    color: '#BFBBAE',
    lineHeight: 18,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#1D1C17',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    minHeight: '60%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
  },
  modalDescription: {
    fontSize: 14,
    color: '#BFBBAE',
    marginBottom: 20,
    lineHeight: 20,
  },
  input: {
    backgroundColor: '#1D1C17',
    borderRadius: 12,
    padding: 16,
    fontSize: 14,
    color: '#fff',
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#383528',
  },
  webhookList: {
    marginBottom: 20,
  },
  webhookListTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#BFBBAE',
    marginBottom: 12,
  },
  webhookItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#1D1C17',
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#383528',
  },
  webhookUrl: {
    fontSize: 12,
    color: '#d1d5db',
    flex: 1,
    marginRight: 8,
  },
  addButton: {
    backgroundColor: '#D97757',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginBottom: 16,
  },
  addButtonText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#fff',
  },
  helpText: {
    fontSize: 11,
    color: '#827E72',
    fontFamily: 'monospace',
    backgroundColor: '#1D1C17',
    padding: 12,
    borderRadius: 8,
    lineHeight: 16,
  },
  exportContainer: {
    backgroundColor: '#1D1C17',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#383528',
  },
  exportTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 4,
  },
  exportSubtitle: {
    fontSize: 13,
    color: '#BFBBAE',
    marginBottom: 16,
  },
  exportButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  exportButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#1D1C17',
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 12,
    borderWidth: 2,
    borderColor: '#383528',
  },
  exportButtonLoading: {
    opacity: 0.6,
  },
  exportButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },
  seedBtnDisabled: {
    opacity: 0.7,
  },
  categoryModalHeaderText: {
    flex: 1,
    marginHorizontal: 8,
  },
  categoryModalHeaderSpacer: {
    width: 28,
  },
  categoryDetailScroll: {
    flex: 1,
  },
});
