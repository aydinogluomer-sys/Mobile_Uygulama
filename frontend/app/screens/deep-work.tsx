import { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, Modal, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useDeepWorkStore } from '../../store/deepWorkStore';

const QUICK_DURATIONS = [25, 45, 60, 90];

export default function DeepWorkScreen() {
  const { sessions, loading, loadSessions, addSession, removeSession, todayMinutes, weekMinutes } = useDeepWorkStore();
  const [modal, setModal] = useState(false);
  const [subject, setSubject] = useState('');
  const [minutes, setMinutes] = useState('60');

  useEffect(() => { loadSessions(); }, []);

  async function handleAdd() {
    const m = parseInt(minutes, 10);
    if (!subject.trim() || isNaN(m) || m <= 0) return;
    await addSession(subject.trim(), m);
    setSubject('');
    setMinutes('60');
    setModal(false);
  }

  function formatMins(m: number) {
    if (m < 60) return `${m}dk`;
    const h = Math.floor(m / 60);
    const rem = m % 60;
    return rem > 0 ? `${h}s ${rem}dk` : `${h}s`;
  }

  const todayM = todayMinutes();
  const weekM = weekMinutes();

  const today = new Date().toISOString().split('T')[0];
  const todaySessions = sessions.filter((s) => s.date === today);
  const pastSessions = sessions.filter((s) => s.date !== today);

  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      <ScrollView contentContainerStyle={s.scroll}>

        {/* Özet kartları */}
        <View style={s.metrics}>
          <View style={[s.metricCard, { borderColor: '#7C97C540' }]}>
            <Ionicons name="today-outline" size={18} color="#7C97C5" />
            <Text style={s.metricValue}>{formatMins(todayM)}</Text>
            <Text style={s.metricLabel}>Bugün</Text>
          </View>
          <View style={[s.metricCard, { borderColor: '#D9775740' }]}>
            <Ionicons name="calendar-outline" size={18} color="#D97757" />
            <Text style={s.metricValue}>{formatMins(weekM)}</Text>
            <Text style={s.metricLabel}>Bu Hafta</Text>
          </View>
          <View style={[s.metricCard, { borderColor: '#87A67840' }]}>
            <Ionicons name="layers-outline" size={18} color="#87A678" />
            <Text style={s.metricValue}>{todaySessions.length}</Text>
            <Text style={s.metricLabel}>Seans</Text>
          </View>
        </View>

        {/* Bugünkü seanslar */}
        <View style={s.section}>
          <View style={s.sectionHeader}>
            <Text style={s.sectionTitle}>BUGÜN</Text>
            <TouchableOpacity style={s.addBtn} onPress={() => setModal(true)}>
              <Ionicons name="add" size={16} color="#7C97C5" />
              <Text style={s.addBtnText}>Seans Ekle</Text>
            </TouchableOpacity>
          </View>

          {todaySessions.length === 0 ? (
            <View style={s.emptyCard}>
              <Ionicons name="flash-outline" size={28} color="#383528" />
              <Text style={s.emptyText}>Henüz seans yok</Text>
              <Text style={s.emptyHint}>Derin çalışma seanslarını buraya kaydet</Text>
            </View>
          ) : (
            todaySessions.map((sess) => (
              <View key={sess.id} style={s.sessionRow}>
                <View style={[s.sessionDot, { backgroundColor: '#7C97C5' }]} />
                <View style={{ flex: 1 }}>
                  <Text style={s.sessionSubject}>{sess.subject}</Text>
                </View>
                <Text style={[s.sessionDuration, { color: '#7C97C5' }]}>{formatMins(sess.duration_minutes)}</Text>
                <TouchableOpacity
                  style={s.deleteBtn}
                  onPress={() => Alert.alert('Sil', 'Bu seans silinsin mi?', [
                    { text: 'İptal' },
                    { text: 'Sil', style: 'destructive', onPress: () => removeSession(sess.id) },
                  ])}
                >
                  <Ionicons name="trash-outline" size={14} color="#56544B" />
                </TouchableOpacity>
              </View>
            ))
          )}
        </View>

        {/* Geçmiş seanslar */}
        {pastSessions.length > 0 && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>GEÇMİŞ (30 GÜN)</Text>
            {pastSessions.slice(0, 20).map((sess) => (
              <View key={sess.id} style={s.sessionRow}>
                <View style={[s.sessionDot, { backgroundColor: '#56544B' }]} />
                <View style={{ flex: 1 }}>
                  <Text style={s.sessionSubject}>{sess.subject}</Text>
                  <Text style={s.sessionDate}>{sess.date}</Text>
                </View>
                <Text style={s.sessionDuration}>{formatMins(sess.duration_minutes)}</Text>
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      {/* Seans ekle modal */}
      <Modal visible={modal} transparent animationType="slide" onRequestClose={() => setModal(false)}>
        <View style={s.modalBg}>
          <View style={s.modalCard}>
            <View style={s.modalHead}>
              <Text style={s.modalTitle}>Seans Ekle</Text>
              <TouchableOpacity onPress={() => setModal(false)}>
                <Ionicons name="close" size={20} color="#827E72" />
              </TouchableOpacity>
            </View>

            <Text style={s.fieldLabel}>Konu / Proje</Text>
            <TextInput
              style={s.input}
              placeholder="Ne üzerine çalıştın?"
              placeholderTextColor="#56544B"
              value={subject}
              onChangeText={setSubject}
              autoFocus
            />

            <Text style={s.fieldLabel}>Süre</Text>
            <View style={s.quickRow}>
              {QUICK_DURATIONS.map((d) => (
                <TouchableOpacity
                  key={d}
                  style={[s.quickBtn, minutes === String(d) && s.quickBtnActive]}
                  onPress={() => setMinutes(String(d))}
                >
                  <Text style={[s.quickBtnText, minutes === String(d) && s.quickBtnTextActive]}>
                    {d}dk
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <TextInput
              style={s.input}
              placeholder="Dakika (özel)"
              placeholderTextColor="#56544B"
              value={minutes}
              onChangeText={setMinutes}
              keyboardType="numeric"
            />

            <TouchableOpacity
              style={[s.saveBtn, (!subject.trim() || !minutes) && s.saveBtnDisabled]}
              onPress={handleAdd}
              disabled={!subject.trim() || !minutes}
            >
              <Text style={s.saveBtnText}>Kaydet</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#15140F' },
  scroll: { padding: 16, paddingBottom: 40 },

  metrics: { flexDirection: 'row', gap: 10, marginBottom: 24 },
  metricCard: {
    flex: 1, alignItems: 'center', gap: 6, padding: 16,
    backgroundColor: '#1D1C17', borderRadius: 14, borderWidth: 1,
  },
  metricValue: { fontSize: 20, fontWeight: '700', color: '#fff' },
  metricLabel: { fontSize: 11, color: '#827E72' },

  section: { marginBottom: 24 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  sectionTitle: { fontSize: 11, fontWeight: '700', color: '#827E72', letterSpacing: 1 },
  addBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#7C97C515', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6,
  },
  addBtnText: { fontSize: 13, color: '#7C97C5', fontWeight: '600' },

  sessionRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#1D1C17', borderRadius: 12, padding: 12,
    borderWidth: 1, borderColor: '#383528', marginBottom: 6,
  },
  sessionDot: { width: 8, height: 8, borderRadius: 4, flexShrink: 0 },
  sessionSubject: { fontSize: 14, color: '#EDEAE0', fontWeight: '500' },
  sessionDate: { fontSize: 11, color: '#827E72', marginTop: 2 },
  sessionDuration: { fontSize: 13, color: '#BFBBAE', fontWeight: '600' },
  deleteBtn: { padding: 4 },

  emptyCard: {
    alignItems: 'center', gap: 6, padding: 32,
    backgroundColor: '#1D1C17', borderRadius: 14, borderWidth: 1, borderColor: '#383528',
  },
  emptyText: { fontSize: 14, color: '#56544B', fontWeight: '600' },
  emptyHint: { fontSize: 12, color: '#56544B', textAlign: 'center' },

  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: '#1D1C17', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, borderWidth: 1, borderColor: '#383528' },
  modalHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  modalTitle: { fontSize: 18, fontWeight: '700', color: '#fff' },

  fieldLabel: { fontSize: 12, color: '#827E72', marginBottom: 8, fontWeight: '600' },
  input: {
    backgroundColor: '#111', borderRadius: 10, padding: 14,
    fontSize: 15, color: '#fff', borderWidth: 1, borderColor: '#383528', marginBottom: 16,
  },

  quickRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  quickBtn: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8,
    backgroundColor: '#111', borderWidth: 1, borderColor: '#383528',
  },
  quickBtnActive: { backgroundColor: '#7C97C520', borderColor: '#7C97C5' },
  quickBtnText: { fontSize: 13, color: '#827E72' },
  quickBtnTextActive: { color: '#7C97C5', fontWeight: '700' },

  saveBtn: { backgroundColor: '#7C97C5', borderRadius: 12, padding: 15, alignItems: 'center', marginTop: 4 },
  saveBtnDisabled: { opacity: 0.4 },
  saveBtnText: { fontSize: 15, fontWeight: '700', color: '#fff' },
});
