import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  TextInput,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface HabitOnboardingProps {
  visible: boolean;
  onClose: () => void;
  onSubmit: (habitData: any) => void;
  initialData?: any;
}

const PRIORITIES = [
  { id: 'urgent_important', label: 'Acil ve Önemli', icon: '🔥', color: '#ef4444', description: 'Hemen yapılması gereken kritik şeyler' },
  { id: 'important_not_urgent', label: 'Önemli ama Acil Değil', icon: '⭐', color: '#6366f1', description: 'Uzun vadeli hedefler' },
  { id: 'urgent_not_important', label: 'Acil ama Önemli Değil', icon: '⚡', color: '#f59e0b', description: 'Hızlı yapılabilir şeyler' },
  { id: 'neither', label: 'Ne Acil Ne Önemli', icon: '📋', color: '#6b7280', description: 'Sonra yapılabilir' },
];

const INITIAL_CATEGORIES = [
  { id: 'health', label: 'Sağlık', icon: 'fitness-outline', color: '#10b981' },
  { id: 'work', label: 'İş', icon: 'briefcase-outline', color: '#3b82f6' },
  { id: 'learning', label: 'Öğrenme', icon: 'book-outline', color: '#8b5cf6' },
  { id: 'personal', label: 'Kişisel', icon: 'person-outline', color: '#f59e0b' },
];

const CATEGORY_COLORS = [
  '#10b981', '#3b82f6', '#8b5cf6', '#f59e0b', '#ef4444', '#ec4899', '#06b6d4', '#84cc16'
];

export default function HabitOnboarding({
  visible,
  onClose,
  onSubmit,
  initialData,
}: HabitOnboardingProps) {
  const [step, setStep] = useState(1);
  const [categories, setCategories] = useState(INITIAL_CATEGORIES);
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newCategoryColor, setNewCategoryColor] = useState('#6366f1');
  const [habitData, setHabitData] = useState({
    name: initialData?.name || '',
    description: initialData?.description || '',
    category: initialData?.category || 'general',
    color: initialData?.color || '#6366f1',
    impact: initialData?.impact || 3,
    difficulty: initialData?.difficulty || 3,
    priority: initialData?.priority || 'important_not_urgent',
  });

  const handleAddCategory = () => {
    if (!newCategoryName.trim()) return;
    
    const newCategory = {
      id: newCategoryName.toLowerCase().replace(/\s+/g, '_'),
      label: newCategoryName,
      icon: 'star-outline' as any,
      color: newCategoryColor,
    };
    
    setCategories([...categories, newCategory]);
    setHabitData({ ...habitData, category: newCategory.id, color: newCategory.color });
    setShowCategoryModal(false);
    setNewCategoryName('');
    setNewCategoryColor('#6366f1');
  };

  const handleSubmit = () => {
    onSubmit(habitData);
    setStep(1);
    setHabitData({
      name: '',
      description: '',
      category: 'general',
      color: '#6366f1',
      impact: 3,
      difficulty: 3,
      priority: 'important_not_urgent',
    });
  };

  const renderStep1 = () => (
    <View style={styles.stepContent}>
      <Text style={styles.stepTitle}>Alışkanlığın Nedir?</Text>
      <Text style={styles.stepSubtitle}>Başlamak istediğin alışkanlığı tanımla</Text>

      <TextInput
        style={styles.input}
        placeholder="Örn: Sabah Sporu"
        placeholderTextColor="#6b7280"
        value={habitData.name}
        onChangeText={(text) => setHabitData({ ...habitData, name: text })}
        autoFocus
      />

      <TextInput
        style={[styles.input, styles.textArea]}
        placeholder="Açıklama (opsiyonel)"
        placeholderTextColor="#6b7280"
        value={habitData.description}
        onChangeText={(text) => setHabitData({ ...habitData, description: text })}
        multiline
        numberOfLines={3}
      />

      <Text style={styles.label}>Kategori</Text>
      <View style={styles.categoryGrid}>
        {categories.map((cat) => (
          <TouchableOpacity
            key={cat.id}
            style={[
              styles.categoryItem,
              habitData.category === cat.id && styles.categoryItemSelected,
              { borderColor: cat.color }
            ]}
            onPress={() => setHabitData({ ...habitData, category: cat.id, color: cat.color })}
          >
            <Ionicons name={cat.icon as any} size={24} color={cat.color} />
            <Text style={styles.categoryLabel}>{cat.label}</Text>
          </TouchableOpacity>
        ))}
        
        {/* Kategori Ekle Butonu */}
        <TouchableOpacity
          style={styles.addCategoryButton}
          onPress={() => setShowCategoryModal(true)}
        >
          <Ionicons name="add-circle-outline" size={28} color="#6366f1" />
          <Text style={styles.addCategoryText}>Kategori Ekle</Text>
        </TouchableOpacity>
      </View>

      {/* Kategori Ekleme Modal */}
      <Modal
        visible={showCategoryModal}
        animationType="fade"
        transparent={true}
        onRequestClose={() => setShowCategoryModal(false)}
      >
        <View style={styles.categoryModalOverlay}>
          <View style={styles.categoryModalContent}>
            <Text style={styles.categoryModalTitle}>Yeni Kategori</Text>
            
            <TextInput
              style={styles.input}
              placeholder="Kategori adı"
              placeholderTextColor="#6b7280"
              value={newCategoryName}
              onChangeText={setNewCategoryName}
            />

            <Text style={styles.label}>Renk Seç</Text>
            <View style={styles.colorGrid}>
              {CATEGORY_COLORS.map((color) => (
                <TouchableOpacity
                  key={color}
                  style={[
                    styles.colorItem,
                    { backgroundColor: color },
                    newCategoryColor === color && styles.colorItemSelected
                  ]}
                  onPress={() => setNewCategoryColor(color)}
                >
                  {newCategoryColor === color && (
                    <Ionicons name="checkmark" size={20} color="#fff" />
                  )}
                </TouchableOpacity>
              ))}
            </View>

            <View style={styles.categoryModalButtons}>
              <TouchableOpacity
                style={styles.categoryModalCancel}
                onPress={() => {
                  setShowCategoryModal(false);
                  setNewCategoryName('');
                  setNewCategoryColor('#6366f1');
                }}
              >
                <Text style={styles.categoryModalCancelText}>İptal</Text>
              </TouchableOpacity>
              
              <TouchableOpacity
                style={styles.categoryModalAdd}
                onPress={handleAddCategory}
              >
                <Text style={styles.categoryModalAddText}>Ekle</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );

  const renderStep2 = () => (
    <View style={styles.stepContent}>
      <Text style={styles.stepTitle}>Etki: Ne Kadar Değiştirici?</Text>
      <Text style={styles.stepSubtitle}>Bu alışkanlık hayatını ne kadar değiştirecek?</Text>

      <View style={styles.scaleContainer}>
        {[1, 2, 3, 4, 5].map((value) => (
          <TouchableOpacity
            key={value}
            style={[
              styles.scaleItem,
              habitData.impact === value && styles.scaleItemSelected
            ]}
            onPress={() => setHabitData({ ...habitData, impact: value })}
          >
            <Text style={[
              styles.scaleValue,
              habitData.impact === value && styles.scaleValueSelected
            ]}>
              {value}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.scaleLabels}>
        <Text style={styles.scaleLabelText}>Az</Text>
        <Text style={styles.scaleLabelText}>Çok Yüksek</Text>
      </View>

      <View style={styles.infoBox}>
        <Ionicons name="information-circle" size={20} color="#6366f1" />
        <Text style={styles.infoText}>
          Yüksek etki = Sağlık, kariyer, ilişkiler gibi temel alanlar
        </Text>
      </View>
    </View>
  );

  const renderStep3 = () => (
    <View style={styles.stepContent}>
      <Text style={styles.stepTitle}>Zorluk: Ne Kadar İrade Gerekir?</Text>
      <Text style={styles.stepSubtitle}>Bunu yapmak ne kadar zor?</Text>

      <View style={styles.scaleContainer}>
        {[1, 2, 3, 4, 5].map((value) => (
          <TouchableOpacity
            key={value}
            style={[
              styles.scaleItem,
              habitData.difficulty === value && styles.scaleItemSelected
            ]}
            onPress={() => setHabitData({ ...habitData, difficulty: value })}
          >
            <Text style={[
              styles.scaleValue,
              habitData.difficulty === value && styles.scaleValueSelected
            ]}>
              {value}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.scaleLabels}>
        <Text style={styles.scaleLabelText}>Kolay</Text>
        <Text style={styles.scaleLabelText}>Çok Zor</Text>
      </View>

      <View style={styles.infoBox}>
        <Ionicons name="flame" size={20} color="#f59e0b" />
        <Text style={styles.infoText}>
          Yüksek zorluk = Fazla irade tüketir, dikkatli ol!
        </Text>
      </View>
    </View>
  );

  const renderStep4 = () => (
    <View style={styles.stepContent}>
      <Text style={styles.stepTitle}>Öncelik: Ne Kadar Acil?</Text>
      <Text style={styles.stepSubtitle}>Eisenhower Matrix'e göre sınıflandır</Text>

      <ScrollView style={styles.priorityList}>
        {PRIORITIES.map((pri) => (
          <TouchableOpacity
            key={pri.id}
            style={[
              styles.priorityItem,
              habitData.priority === pri.id && styles.priorityItemSelected,
              { borderLeftColor: pri.color, borderLeftWidth: 4 }
            ]}
            onPress={() => setHabitData({ ...habitData, priority: pri.id })}
          >
            <View style={styles.priorityLeft}>
              <Text style={styles.priorityIcon}>{pri.icon}</Text>
              <View style={styles.priorityInfo}>
                <Text style={styles.priorityLabel}>{pri.label}</Text>
                <Text style={styles.priorityDescription}>{pri.description}</Text>
              </View>
            </View>
            {habitData.priority === pri.id && (
              <Ionicons name="checkmark-circle" size={24} color={pri.color} />
            )}
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );

  const renderStep5 = () => {
    const selectedPriority = PRIORITIES.find(p => p.id === habitData.priority);
    const focusScore = (habitData.impact * 1.5) - habitData.difficulty + 
      (habitData.priority === 'urgent_important' ? 3 : 
       habitData.priority === 'important_not_urgent' ? 2 : 
       habitData.priority === 'urgent_not_important' ? 1 : 0);

    return (
      <View style={styles.stepContent}>
        <Text style={styles.stepTitle}>Özet ve Öneri</Text>
        <Text style={styles.stepSubtitle}>İşte analizimiz</Text>

        <View style={styles.summaryCard}>
          <Text style={styles.summaryHabitName}>{habitData.name}</Text>
          
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Etki:</Text>
            <Text style={styles.summaryValue}>{habitData.impact}/5</Text>
          </View>
          
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Zorluk:</Text>
            <Text style={styles.summaryValue}>{habitData.difficulty}/5</Text>
          </View>
          
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Öncelik:</Text>
            <View style={styles.summaryPriority}>
              <Text style={styles.summaryPriorityIcon}>{selectedPriority?.icon}</Text>
              <Text style={styles.summaryPriorityText}>{selectedPriority?.label}</Text>
            </View>
          </View>

          <View style={styles.focusScoreBox}>
            <Text style={styles.focusScoreLabel}>Odak Skoru</Text>
            <Text style={styles.focusScoreValue}>{focusScore.toFixed(1)}</Text>
          </View>
        </View>

        <View style={styles.recommendationBox}>
          <Ionicons name="bulb" size={24} color="#10b981" />
          <Text style={styles.recommendationText}>
            {focusScore > 4 
              ? "Mükemmel! Bu alışkanlık senin için çok değerli. Hemen aktif listene eklemeyi öneriyoruz."
              : focusScore > 2
              ? "İyi bir seçim! Aktif alışkanlıkların arasında dengeli bir yer bulacak."
              : "Bu alışkanlık şu an için beklemede kalabilir. Önce daha yüksek etkili alışkanlıklara odaklan."}
          </Text>
        </View>
      </View>
    );
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={true}
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <View style={styles.container}>
          {/* Header */}
          <View style={styles.header}>
            <TouchableOpacity onPress={onClose}>
              <Ionicons name="close" size={28} color="#fff" />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>Yeni Alışkanlık</Text>
            <View style={{ width: 28 }} />
          </View>

          {/* Progress */}
          <View style={styles.progressContainer}>
            {[1, 2, 3, 4, 5].map((s) => (
              <View
                key={s}
                style={[
                  styles.progressDot,
                  s <= step && styles.progressDotActive
                ]}
              />
            ))}
          </View>

          {/* Content */}
          <ScrollView style={styles.content}>
            {step === 1 && renderStep1()}
            {step === 2 && renderStep2()}
            {step === 3 && renderStep3()}
            {step === 4 && renderStep4()}
            {step === 5 && renderStep5()}
          </ScrollView>

          {/* Footer */}
          <View style={styles.footer}>
            {step > 1 && (
              <TouchableOpacity
                style={styles.backButton}
                onPress={() => setStep(step - 1)}
              >
                <Ionicons name="arrow-back" size={20} color="#fff" />
                <Text style={styles.backButtonText}>Geri</Text>
              </TouchableOpacity>
            )}
            
            {step < 5 ? (
              <TouchableOpacity
                style={[styles.nextButton, !habitData.name && step === 1 && styles.buttonDisabled]}
                onPress={() => setStep(step + 1)}
                disabled={!habitData.name && step === 1}
              >
                <Text style={styles.nextButtonText}>Devam</Text>
                <Ionicons name="arrow-forward" size={20} color="#fff" />
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={styles.submitButton}
                onPress={handleSubmit}
              >
                <Text style={styles.submitButtonText}>Alışkanlığı Ekle</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.9)',
    justifyContent: 'flex-end',
  },
  container: {
    backgroundColor: '#1a1a1a',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    height: '90%',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a2a',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#fff',
  },
  progressContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    gap: 8,
  },
  progressDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#2a2a2a',
  },
  progressDotActive: {
    backgroundColor: '#6366f1',
    width: 24,
  },
  content: {
    flex: 1,
    padding: 20,
  },
  stepContent: {
    flex: 1,
  },
  stepTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 8,
  },
  stepSubtitle: {
    fontSize: 15,
    color: '#9ca3af',
    marginBottom: 24,
  },
  input: {
    backgroundColor: '#0f0f0f',
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    color: '#fff',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  textArea: {
    height: 80,
    textAlignVertical: 'top',
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 12,
  },
  categoryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  categoryItem: {
    width: '47%',
    aspectRatio: 2,
    backgroundColor: '#0f0f0f',
    borderRadius: 12,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  categoryItemSelected: {
    borderWidth: 3,
  },
  categoryLabel: {
    fontSize: 14,
    color: '#9ca3af',
  },
  scaleContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  scaleItem: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#0f0f0f',
    borderWidth: 2,
    borderColor: '#2a2a2a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scaleItemSelected: {
    backgroundColor: '#6366f1',
    borderColor: '#6366f1',
  },
  scaleValue: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#9ca3af',
  },
  scaleValueSelected: {
    color: '#fff',
  },
  scaleLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 24,
  },
  scaleLabelText: {
    fontSize: 13,
    color: '#6b7280',
  },
  infoBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0f0f0f',
    borderRadius: 12,
    padding: 16,
    gap: 12,
  },
  infoText: {
    flex: 1,
    fontSize: 14,
    color: '#9ca3af',
    lineHeight: 20,
  },
  priorityList: {
    flex: 1,
  },
  priorityItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#0f0f0f',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  priorityItemSelected: {
    backgroundColor: '#1a1f2e',
  },
  priorityLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 12,
  },
  priorityIcon: {
    fontSize: 32,
  },
  priorityInfo: {
    flex: 1,
  },
  priorityLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 4,
  },
  priorityDescription: {
    fontSize: 13,
    color: '#9ca3af',
  },
  summaryCard: {
    backgroundColor: '#0f0f0f',
    borderRadius: 16,
    padding: 20,
    marginBottom: 20,
  },
  summaryHabitName: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 20,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  summaryLabel: {
    fontSize: 15,
    color: '#9ca3af',
  },
  summaryValue: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  summaryPriority: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  summaryPriorityIcon: {
    fontSize: 20,
  },
  summaryPriorityText: {
    fontSize: 14,
    color: '#fff',
  },
  focusScoreBox: {
    alignItems: 'center',
    marginTop: 20,
    paddingTop: 20,
    borderTopWidth: 1,
    borderTopColor: '#2a2a2a',
  },
  focusScoreLabel: {
    fontSize: 14,
    color: '#9ca3af',
    marginBottom: 8,
  },
  focusScoreValue: {
    fontSize: 48,
    fontWeight: 'bold',
    color: '#6366f1',
  },
  recommendationBox: {
    flexDirection: 'row',
    backgroundColor: '#10b98120',
    borderRadius: 12,
    padding: 16,
    gap: 12,
    alignItems: 'flex-start',
  },
  recommendationText: {
    flex: 1,
    fontSize: 14,
    color: '#10b981',
    lineHeight: 20,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 20,
    borderTopWidth: 1,
    borderTopColor: '#2a2a2a',
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: '#2a2a2a',
  },
  backButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  nextButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: '#6366f1',
    flex: 1,
    marginLeft: 12,
    justifyContent: 'center',
  },
  nextButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  submitButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: '#10b981',
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitButtonText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#fff',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
});
