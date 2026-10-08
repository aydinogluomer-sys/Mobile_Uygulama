import { colors, alphaHex } from '../lib/tokens';
import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
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
  onSplit: (subtasks: Task[]) => void;
}

/**
 * ADHD Task Splitter V2.  (Phase 3, CODER-L, plan §15)
 *
 * BEFORE this change: tapping a duration button built three rows straight
 * from a hard-coded label table and called `insertSplitTasks` immediately --
 * no validation step, no preview, the "result" screen showed
 * already-inserted database rows. Plan §15's architecture is
 *
 *   task -> task decomposition service -> AI -> validated subtasks -> preview -> save
 *
 * so this component now goes through three phases instead of one:
 *
 *  1. 'select'  -- unchanged duration presets (same Turkish copy, same
 *     three options). Tapping one calls `lib/taskDecomposition.ts`'s
 *     `buildLocalSplitProposal` (today's stand-in for a real AI call -- see
 *     that function's own doc) and immediately runs the result through
 *     `validateSubtaskProposal`, exactly as a real AI response would have
 *     to be. A rejection (should never happen with today's trusted
 *     generator, but the gate applies unconditionally) surfaces an inline
 *     Turkish error and leaves 'select' fully usable -- nothing is written.
 *  2. 'preview' -- the validated subtasks are shown for review, NOT yet
 *     saved. The user must explicitly tap "Onayla ve Ekle" to proceed, or
 *     "Vazgeç" to go back and pick a different duration. This is the step
 *     that did not exist before.
 *  3. 'done'    -- unchanged success screen, now showing the rows the
 *     repository actually returned after the explicit confirm.
 *
 * Nothing reaches `insertSplitTasks` (the only DB write in this component)
 * except from an explicit `handleConfirm()` tap on an already-validated
 * proposal -- matching plan §13's rule for AI output in general, applied
 * here even though today's proposal source is the deterministic local
 * generator, not a live AI call (see `buildLocalSplitProposal`'s doc for
 * why the gate still applies).
 */

type Phase = 'select' | 'preview' | 'done';

export default function ADHDTaskSplitter({
  task,
  visible,
  onClose,
  onSplit,
}: ADHDTaskSplitterProps) {
  const [phase, setPhase] = useState<Phase>('select');
  const [proposal, setProposal] = useState<SubtaskDecompositionProposal | null>(null);
  const [proposalError, setProposalError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [subtasks, setSubtasks] = useState<Task[]>([]);

  // Phase 1: 'AI' (today: the local decomposition service) proposes, this
  // gate validates. Never writes anything -- see file doc.
  const handlePick = (minutes: number) => {
    const raw = buildLocalSplitProposal(task.title, minutes);
    const result = validateSubtaskProposal(raw);
    if (!result.ok) {
      // Gate D: a rejected/garbage proposal degrades gracefully -- an
      // inline Turkish message, 'select' stays fully usable, nothing about
      // to be written.
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
      onSplit(res.data);
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
  };

  const handleClose = () => {
    setPhase('select');
    setProposal(null);
    setProposalError(null);
    setSaveError(null);
    setSubtasks([]);
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
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <Ionicons name="flash" size={24} color={colors.warning} />
              <Text style={styles.title}>ADHD Modu</Text>
            </View>
            <TouchableOpacity onPress={handleClose}>
              <Ionicons name="close" size={28} color={colors.textDim} />
            </TouchableOpacity>
          </View>

          <Text style={styles.description}>
            Büyük görevinizi daha küçük, yönetilebilir parçalara bölelim!
          </Text>

          <View style={styles.taskCard}>
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
              >
                <Ionicons name="hourglass-outline" size={24} color="#8b5cf6" />
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
                >
                  <Text style={styles.backButtonText}>Vazgeç</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.confirmButton, saving && styles.confirmButtonDisabled]}
                  onPress={handleConfirm}
                  disabled={saving}
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
              <TouchableOpacity style={styles.doneButton} onPress={handleClose}>
                <Text style={styles.doneButtonText}>Tamam</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    justifyContent: 'flex-end',
  },
  content: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    minHeight: '70%',
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
    marginBottom: 16,
    textAlign: 'center',
  },
  subtasksList: {
    maxHeight: 300,
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
