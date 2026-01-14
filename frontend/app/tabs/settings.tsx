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
  Platform,
  ActivityIndicator,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { webhookAPI, exportAPI } from '../../utils/api';
import { Webhook } from '../../types';
import BadHabitsTracker from '../../components/BadHabitsTracker';

export default function SettingsScreen() {
  const [showWebhookModal, setShowWebhookModal] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState('');
  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [showBadHabitsTracker, setShowBadHabitsTracker] = useState(false);
  const [exportingFormat, setExportingFormat] = useState<string | null>(null);

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

  const handleExportData = async () => {
    try {
      const data = await exportAPI.exportAll();
      const jsonString = JSON.stringify(data, null, 2);
      
      // Share the data
      await Share.share({
        message: jsonString,
        title: 'CoreHabit Veri Yedeği',
      });
    } catch (error) {
      Alert.alert('Hata', 'Veriler dışa aktarılırken bir hata oluştu');
      console.error('Export hatası:', error);
    }
  };

  const renderSettingItem = (
    icon: string,
    title: string,
    subtitle: string,
    onPress: () => void,
    color = '#6366f1'
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
      <Ionicons name="chevron-forward" size={20} color="#6b7280" />
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView style={styles.scrollView}>
        <View style={styles.content}>
          <Text style={styles.title}>Ayarlar</Text>
          <Text style={styles.subtitle}>Uygulamanızı özelleştirin</Text>

          {/* Data & Privacy */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Veri ve Gizlilik</Text>
            
            {renderSettingItem(
              'cloud-upload-outline',
              'Verileri Dışa Aktar',
              'Tüm verilerinizi JSON formatında indirin',
              handleExportData,
              '#10b981'
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
              '#ef4444'
            )}
          </View>

          {/* Integrations */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Entegrasyonlar</Text>
            
            {renderSettingItem(
              'link-outline',
              'Webhook Yönetimi',
              'n8n veya diğer servislere bağlanın',
              () => {
                loadWebhooks();
                setShowWebhookModal(true);
              },
              '#f59e0b'
            )}
          </View>

          {/* About */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Hakkında</Text>
            
            <View style={styles.infoCard}>
              <Text style={styles.appName}>CoreHabit</Text>
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
            <View style={styles.featureCard}>
              <View style={styles.featureItem}>
                <Ionicons name="shield-checkmark" size={20} color="#10b981" />
                <Text style={styles.featureText}>Veri Özgürlüğü</Text>
              </View>
              <View style={styles.featureItem}>
                <Ionicons name="trending-up" size={20} color="#6366f1" />
                <Text style={styles.featureText}>Loop Algorithm</Text>
              </View>
              <View style={styles.featureItem}>
                <Ionicons name="git-network" size={20} color="#f59e0b" />
                <Text style={styles.featureText}>n8n Entegrasyonu</Text>
              </View>
              <View style={styles.featureItem}>
                <Ionicons name="analytics" size={20} color="#8b5cf6" />
                <Text style={styles.featureText}>GitHub Heatmap</Text>
              </View>
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
                <Ionicons name="close" size={28} color="#9ca3af" />
              </TouchableOpacity>
            </View>

            <Text style={styles.modalDescription}>
              Alışkanlık veya görev tamamlandığında otomatik olarak bu URL\'e
              POST isteği gönderilecek.
            </Text>

            <TextInput
              style={styles.input}
              placeholder="https://hooks.n8n.cloud/webhook/..."
              placeholderTextColor="#6b7280"
              value={webhookUrl}
              onChangeText={setWebhookUrl}
              autoCapitalize="none"
              autoCorrect={false}
            />

            {webhooks.length > 0 && (
              <View style={styles.webhookList}>
                <Text style={styles.webhookListTitle}>Mevcut Webhook\'lar:</Text>
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
                      <Ionicons name="trash-outline" size={20} color="#ef4444" />
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

      {/* Bad Habits Tracker */}
      <BadHabitsTracker
        visible={showBadHabitsTracker}
        onClose={() => setShowBadHabitsTracker(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0c0c0c',
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
    color: '#9ca3af',
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
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#2a2a2a',
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
    color: '#9ca3af',
  },
  infoCard: {
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 20,
    borderWidth: 1,
    borderColor: '#2a2a2a',
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
    color: '#6366f1',
    marginBottom: 12,
  },
  appDescription: {
    fontSize: 14,
    color: '#9ca3af',
    textAlign: 'center',
    lineHeight: 20,
  },
  featureCard: {
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  featureItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
  },
  featureText: {
    fontSize: 15,
    color: '#d1d5db',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#1a1a1a',
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
    color: '#9ca3af',
    marginBottom: 20,
    lineHeight: 20,
  },
  input: {
    backgroundColor: '#0f0f0f',
    borderRadius: 12,
    padding: 16,
    fontSize: 14,
    color: '#fff',
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  webhookList: {
    marginBottom: 20,
  },
  webhookListTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#9ca3af',
    marginBottom: 12,
  },
  webhookItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#0f0f0f',
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  webhookUrl: {
    fontSize: 12,
    color: '#d1d5db',
    flex: 1,
    marginRight: 8,
  },
  addButton: {
    backgroundColor: '#6366f1',
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
    color: '#6b7280',
    fontFamily: 'monospace',
    backgroundColor: '#0f0f0f',
    padding: 12,
    borderRadius: 8,
    lineHeight: 16,
  },
});
