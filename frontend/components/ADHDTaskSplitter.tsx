import { alphaHex, hexA, space, radius, font, type Palette } from '../lib/tokens';
import { useThemeColors, useThemedStyles } from '../hooks/useThemeColors';
import { TexturedSurface } from './ui';
import { EmbeddedFiligree } from './spatial';
import { DECOR, TEXTURES } from '../lib/visualAssets';
import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  Switch,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Task } from '../store/taskStore';
import { createSubtasks as insertSplitTasks } from '../services/taskService';
import { reportError } from '../lib/crashReporting';
import {
  buildLocalSplitProposal,
  validateSubtaskProposal,
  toSplitTaskInputs,
  type SubtaskDecompositionProposal,
} from '../lib/taskDecomposition';

interface ADHDTaskSplitterProps {
  task: Task;
  visible: boolean;
  onClose: () => void;
  onSplit: (subtasks: Task[], options?: { archiveParent: boolean }) => void;
}

type Phase = 'select' | 'preview' | 'done';

export default function ADHDTaskSplitter({
  task,
  visible,
  onClose,
  onSplit,
}: ADHDTaskSplitterProps) {
  const colors = useThemeColors();
  const styles = useThemedStyles(makeStyles);
  const [phase, setPhase] = useState<Phase>('select');
  const [proposal, setProposal] = useState<SubtaskDecompositionProposal | null>(null);
  const [proposalError, setProposalError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [subtasks, setSubtasks] = useState<Task[]>([]);
  const [archiveParent, setArchiveParent] = useState(true);

  // Phase 1: local decomposition proposes, this gate validates. Never writes anything.
  const handlePick = (minutes: number) => {
    const raw = buildLocalSplitProposal(task.title, minutes);
    const result = validateSubtaskProposal(raw);
    if (!result.ok) {
      setProposalError(
        result.errors.map((e) => e.message).join(' '),
      );
      return;
    }
    setProposalError(null);
    setProposal(result.proposal);
    setPhase('preview');
  };

  // Phase 2 -> 3: the ONLY path that reaches the database, and only after
  // an explicit user tap on an already-validated proposal. Repository
  // devralır: supabase.tasks tablosuna insert eder (bkz.
  // repositories/taskRepository.ts) -- this component never queries the
  // database directly itself (Rule 4).
  const handleConfirm = async () => {
    if (!proposal || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const rows = toSplitTaskInputs(proposal, {
        id: task.id,
        priority: task.priority,
        due_date: task.due_date ?? null,
        project_id: task.project_id ?? null,
        list_type: task.list_type,
      });
      const res = await insertSplitTasks(rows);
      if (!res.ok) {
        setSaveError(res.error);
        return;
      }
      setSubtasks(res.data);
      onSplit(res.data, { archiveParent });
      setPhase('done');
    } catch (error) {
      // R10.03 — through the scrubbing funnel, never raw to the device log.
      reportError(error, 'manual', 'task-split');
      setSaveError(error instanceof Error ? error.message : 'Görev bölünürken bir hata oluştu.');
    } finally {
      setSaving(false);
    }
  };

  const handleBackToSelect = () => {
    setPhase('select');
    setProposal(null);
    setSaveError(null);
    setArchiveParent(true);
  };

  const handleClose = () => {
    setPhase('select');
    setProposal(null);
    setProposalError(null);
    setSaveError(null);
    setSubtasks([]);
    setArchiveParent(true);
    onClose();
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={true}
      onRequestClose={handleClose}
    >
      <View style={styles.overlay}>
        <View style={styles.content}>
          <TexturedSurface source={TEXTURES.sacredGrid} textureOpacity={0.05} overlayOnly />
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <Ionicons name="flash" size={24} color={colors.warning} />
              <Text style={styles.title}>ADHD Modu</Text>
            </View>
            <TouchableOpacity
              onPress={handleClose}
              accessibilityRole="button"
              accessibilityLabel="ADHD görev bölme penceresini kapat"
            >
              <Ionicons name="close" size={28} color={colors.textDim} />
            </TouchableOpacity>
          </View>

          <Text style={styles.description}>
            Büyük görevinizi daha küçük, yönetilebilir parçalara bölelim!
          </Text>

          <View style={styles.taskCard}>
            <EmbeddedFiligree source={DECOR.cornerBlueprint} size={96} opacity={0.16} />
            <Text style={styles.taskTitle}>{task.title}</Text>
            {task.description && (
              <Text style={styles.taskDescription}>{task.description}</Text>
            )}
          </View>

          {phase === 'select' && (
            <View style={styles.options}>
              <Text style={styles.optionsTitle}>Odaklanma süresi seçin:</Text>

              {proposalError && (
                <View style={styles.errorBox}>
                  <Ionicons name="warning-outline" size={16} color={colors.error} />
                  <Text style={styles.errorText}>{proposalError}</Text>
                </View>
              )}

              <TouchableOpacity
                style={styles.optionButton}
                onPress={() => handlePick(15)}
                accessibilityRole="button"
                accessibilityLabel="Kısa Sprint, 15 dakikalık bloklara böl"
              >
                <Ionicons name="timer-outline" size={24} color={colors.success} />
                <View style={styles.optionText}>
                  <Text style={styles.optionTitle}>Kısa Sprint</Text>
                  <Text style={styles.optionSubtitle}>15 dakikalık bloklara böl</Text>
                </View>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.optionButton}
                onPress={() => handlePick(25)}
                accessibilityRole="button"
                accessibilityLabel="Pomodoro, 25 dakikalık bloklara böl"
              >
                <Ionicons name="time-outline" size={24} color={colors.accent} />
                <View style={styles.optionText}>
                  <Text style={styles.optionTitle}>Pomodoro</Text>
                  <Text style={styles.optionSubtitle}>25 dakikalık bloklara böl</Text>
                </View>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.optionButton}
                onPress={() => handlePick(45)}
                accessibilityRole="button"
                accessibilityLabel="Derin Odaklanma, 45 dakikalık bloklara böl"
              >
                <Ionicons name="hourglass-outline" size={24} color={colors.accent} />
                <View style={styles.optionText}>
                  <Text style={styles.optionTitle}>Derin Odaklanma</Text>
                  <Text style={styles.optionSubtitle}>45 dakikalık bloklara böl</Text>
                </View>
              </TouchableOpacity>
            </View>
          )}

          {phase === 'preview' && proposal && (
            <View style={styles.subtasks}>
              <Text style={styles.previewTitle}>Önizleme -- eklemeden önce gözden geçir</Text>
              <ScrollView style={styles.subtasksList}>
                {proposal.subtasks.map((subtask, index) => (
                  <View key={`${subtask.title}-${index}`} style={styles.subtaskCard}>
                    <View style={styles.subtaskNumber}>
                      <Text style={styles.subtaskNumberText}>{index + 1}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.subtaskTitle}>{subtask.title}</Text>
                      {subtask.description && (
                        <Text style={styles.subtaskDescription}>{subtask.description}</Text>
                      )}
                    </View>
                  </View>
                ))}
              </ScrollView>

              <View style={styles.archiveRow}>
                <View style={styles.archiveTextCol}>
                  <Text style={styles.archiveLabel}>Ana görev listemden kalksın</Text>
                  <Text style={styles.archiveHint}>
                    Adımlar onun yerini alır. Ana görev silinmez, arşivde durur.
                  </Text>
                </View>
                <Switch
                  value={archiveParent}
                  onValueChange={setArchiveParent}
                  accessibilityRole="switch"
                  accessibilityLabel="Ana görev listemden kalksın"
                  accessibilityState={{ checked: archiveParent }}
                  trackColor={{ false: colors.border, true: alphaHex(colors.accent, '60') }}
                  thumbColor={archiveParent ? colors.accent : colors.textDim}
                />
              </View>

              {saveError && (
                <View style={styles.errorBox}>
                  <Ionicons name="warning-outline" size={16} color={colors.error} />
                  <Text style={styles.errorText}>{saveError}</Text>
                </View>
              )}

              <View style={styles.previewActions}>
                <TouchableOpacity
                  style={styles.backButton}
                  onPress={handleBackToSelect}
                  disabled={saving}
                  accessibilityRole="button"
                  accessibilityLabel="Vazgeç"
                  accessibilityState={{ disabled: saving }}
                >
                  <Text style={styles.backButtonText}>Vazgeç</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.confirmButton, saving && styles.confirmButtonDisabled]}
                  onPress={handleConfirm}
                  disabled={saving}
                  accessibilityRole="button"
                  accessibilityLabel="Onayla ve Ekle"
                  accessibilityState={{ disabled: saving, busy: saving }}
                >
                  {saving ? (
                    <ActivityIndicator size="small" color={colors.white} />
                  ) : (
                    <Text style={styles.confirmButtonText}>Onayla ve Ekle</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          )}

          {phase === 'done' && (
            <View style={styles.subtasks}>
              <Text style={styles.subtasksTitle}>Görev başarıyla bölündü! 🎯</Text>
              <Text style={styles.doneSubtitle}>
                {archiveParent
                  ? 'Ana görev arşive alındı; adımlar listende.'
                  : 'Adımlar ana görevin yanında duruyor.'}
              </Text>
              <ScrollView style={styles.subtasksList}>
                {subtasks.map((subtask, index) => (
                  <View key={subtask.id} style={styles.subtaskCard}>
                    <View style={styles.subtaskNumber}>
                      <Text style={styles.subtaskNumberText}>{index + 1}</Text>
                    </View>
                    <Text style={styles.subtaskTitle}>{subtask.title}</Text>
                  </View>
                ))}
              </ScrollView>
              <TouchableOpacity
                style={styles.doneButton}
                onPress={handleClose}
                accessibilityRole="button"
                accessibilityLabel="Tamam"
              >
                <Text style={styles.doneButtonText}>Tamam</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: hexA(colors.black, 0.8),
      justifyContent: 'flex-end',
    },
    content: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      padding: 24,
      minHeight: '70%',
      overflow: 'hidden',
      position: 'relative',
    },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 16,
    },
    headerLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    title: {
      fontSize: 24,
      fontWeight: 'bold',
      color: colors.white,
    },
    description: {
      fontSize: 15,
      color: colors.textDim,
      marginBottom: 20,
      lineHeight: 22,
    },
    taskCard: {
      overflow: 'hidden',
      position: 'relative',
      backgroundColor: colors.surface,
      borderRadius: 12,
      padding: 16,
      marginBottom: 24,
      borderWidth: 1,
      borderColor: colors.border,
    },
    taskTitle: {
      fontSize: 16,
      fontWeight: '600',
      color: colors.white,
      marginBottom: 4,
    },
    taskDescription: {
      fontSize: 14,
      color: colors.textDim,
    },
    options: {
      gap: 12,
    },
    optionsTitle: {
      fontSize: 16,
      fontWeight: '600',
      color: colors.white,
      marginBottom: 8,
    },
    optionButton: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderRadius: 12,
      padding: 16,
      gap: 16,
      borderWidth: 1,
      borderColor: colors.border,
    },
    optionText: {
      flex: 1,
    },
    optionTitle: {
      fontSize: 16,
      fontWeight: '600',
      color: colors.white,
      marginBottom: 4,
    },
    optionSubtitle: {
      fontSize: 13,
      color: colors.textDim,
    },
    errorBox: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 8,
      backgroundColor: alphaHex(colors.error, '15'),
      borderColor: alphaHex(colors.error, '30'),
      borderWidth: 1,
      borderRadius: 12,
      padding: 12,
      marginBottom: 4,
    },
    errorText: {
      flex: 1,
      fontSize: 13,
      color: colors.error,
      lineHeight: 18,
    },
    subtasks: {
      flex: 1,
    },
    previewTitle: {
      fontSize: 15,
      fontWeight: '700',
      color: colors.warning,
      marginBottom: 14,
      textAlign: 'center',
    },
    subtasksTitle: {
      fontSize: 18,
      fontWeight: 'bold',
      color: colors.success,
      marginBottom: space.xs,
      textAlign: 'center',
    },
    doneSubtitle: {
      ...font.bodySm,
      color: colors.textDim,
      textAlign: 'center',
      marginBottom: space.md,
    },
    subtasksList: {
      maxHeight: 260,
    },
    subtaskCard: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderRadius: 12,
      padding: 16,
      marginBottom: 12,
      gap: 12,
      borderWidth: 1,
      borderColor: colors.border,
    },
    subtaskNumber: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: colors.accent,
      alignItems: 'center',
      justifyContent: 'center',
    },
    subtaskNumberText: {
      fontSize: 14,
      fontWeight: 'bold',
      color: colors.white,
    },
    subtaskTitle: {
      fontSize: 15,
      color: colors.white,
      flex: 1,
    },
    subtaskDescription: {
      fontSize: 12,
      color: colors.textFaint,
      marginTop: 2,
    },
    archiveRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: space.md,
      minHeight: 44,
      paddingHorizontal: space.md,
      paddingVertical: space.sm,
      marginTop: space.sm,
      borderRadius: radius.md,
      backgroundColor: colors.surfaceAlt,
      borderWidth: 1,
      borderColor: colors.border,
    },
    archiveTextCol: {
      flex: 1,
      gap: space.xs,
    },
    archiveLabel: {
      ...font.bodySm,
      fontWeight: '600',
      color: colors.text,
    },
    archiveHint: {
      ...font.caption,
      color: colors.textDim,
    },
    previewActions: {
      flexDirection: 'row',
      gap: 10,
      marginTop: 16,
    },
    backButton: {
      flex: 1,
      backgroundColor: colors.surface,
      borderRadius: 12,
      padding: 16,
      alignItems: 'center',
      borderWidth: 1,
      borderColor: colors.border,
    },
    backButtonText: {
      fontSize: 15,
      fontWeight: '600',
      color: colors.textDim,
    },
    confirmButton: {
      flex: 2,
      backgroundColor: colors.accent,
      borderRadius: 12,
      padding: 16,
      alignItems: 'center',
    },
    confirmButtonDisabled: {
      opacity: 0.6,
    },
    confirmButtonText: {
      fontSize: 15,
      fontWeight: 'bold',
      color: colors.white,
    },
    doneButton: {
      backgroundColor: colors.accent,
      borderRadius: 12,
      padding: 16,
      alignItems: 'center',
      marginTop: 20,
    },
    doneButtonText: {
      fontSize: 16,
      fontWeight: 'bold',
      color: colors.white,
    },
  });
