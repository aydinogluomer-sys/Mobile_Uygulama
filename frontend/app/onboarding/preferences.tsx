import { View, Text, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, font, space } from '../../lib/tokens';
import OnboardingScaffold from '../../components/onboarding/OnboardingScaffold';
import SelectableTile from '../../components/onboarding/SelectableTile';
import { useOnboardingStore } from '../../store/onboardingStore';
import {
  DAYPART_EMOJI, DAYPART_IDS, DAYPART_LABELS, PACES, canAdvanceFromPreferences,
} from '../../lib/onboarding';

/**
 * Step 2 — how much, when, and whether to be reminded.
 *
 * ## The notification card is the delicate one
 *
 * Choosing "Evet, hatırlat" is the ONLY thing in this app that triggers the
 * OS permission prompt from onboarding, and it happens in that handler, not
 * on mount. A screen that asks the system the moment it renders spends the
 * user's one-shot permission before they have decided anything — and on iOS
 * a denial is close to permanent.
 *
 * What is then displayed is the OUTCOME, not the wish. Wanting reminders and
 * having denied the permission is a real, common state, and the card says so
 * rather than showing a tick.
 */
export default function OnboardingPreferencesScreen() {
  const router = useRouter();
  const answers = useOnboardingStore((s) => s.answers);
  const setPace = useOnboardingStore((s) => s.setPace);
  const toggleDaypart = useOnboardingStore((s) => s.toggleDaypart);
  const setReminderIntent = useOnboardingStore((s) => s.setReminderIntent);
  const requestPermission = useOnboardingStore((s) => s.requestNotificationPermission);
  const permission = useOnboardingStore((s) => s.permission);
  const saveProgress = useOnboardingStore((s) => s.saveProgress);
  const generatePlan = useOnboardingStore((s) => s.generatePlan);
  const saving = useOnboardingStore((s) => s.saving);
  const saveError = useOnboardingStore((s) => s.saveError);

  async function handleReminderYes() {
    setReminderIntent(true);
    // Explicit consent, then the system prompt. Never the other way round.
    await requestPermission();
  }

  function handleReminderNo() {
    setReminderIntent(false);
    // Deliberately does NOT call requestPermission — "no" must never produce
    // a prompt.
  }

  async function handleGenerate() {
    const ok = await saveProgress('preferences');
    if (!ok) return;
    // Local, deterministic, offline-safe. No provider call, so this cannot
    // fail because Anthropic is out of credit.
    generatePlan();
    router.push('/onboarding/plan');
  }

  const permissionNote = (() => {
    if (answers.reminderIntent !== true) return null;
    switch (permission) {
      case 'granted': return { icon: 'checkmark-circle' as const, color: colors.success, text: 'Bildirim izni verildi.' };
      case 'denied': return { icon: 'alert-circle' as const, color: colors.warning, text: 'Bildirim izni verilmedi. Hatırlatmalar çalışmayacak; cihaz ayarlarından izin verebilirsin.' };
      case 'unsupported': return { icon: 'information-circle' as const, color: colors.textFaint, text: 'Bu platformda bildirim desteklenmiyor. Tercihini kaydettik; mobil uygulamada geçerli olacak.' };
      default: return null;
    }
  })();

  return (
    <OnboardingScaffold
      step={2}
      totalSteps={3}
      title="Sana göre ayarlayalım"
      subtitle="Günlük rutinine uygun bir başlangıç planı oluşturalım."
      primaryLabel="Planımı oluştur ✨"
      onPrimary={handleGenerate}
      primaryDisabled={!canAdvanceFromPreferences(answers) || saving}
      primaryLoading={saving}
      error={saveError}
    >
      <View style={s.section}>
        <Text style={s.sectionTitle}>Nasıl başlamak istersin?</Text>
        <View style={s.list}>
          {PACES.map((pace) => (
            <SelectableTile
              key={pace.id}
              role="radio"
              size="card"
              emoji={pace.emoji}
              label={pace.label}
              detail={pace.volume}
              meta={pace.detail}
              badge={pace.recommended ? 'Önerilen' : undefined}
              selected={answers.pace === pace.id}
              // Balanced is marked "Önerilen" but is NOT preselected: a
              // default written into the row before the user chose would be
              // stored as their answer and would shape their plan without
              // their having said anything.
              onPress={() => setPace(pace.id)}
            />
          ))}
        </View>
      </View>

      <View style={s.section}>
        <Text style={s.sectionTitle}>Rutinlerini en çok ne zaman yapmak istersin?</Text>
        <Text style={s.sectionHint}>Birden fazla seçebilirsin. Saatleri sonra tek tek ayarlayabilirsin.</Text>
        <View style={s.chipGrid}>
          {DAYPART_IDS.map((daypart) => (
            <View key={daypart} style={s.chipCell}>
              <SelectableTile
                role="checkbox"
                emoji={DAYPART_EMOJI[daypart]}
                label={DAYPART_LABELS[daypart]}
                selected={answers.preferredDayparts.includes(daypart)}
                onPress={() => toggleDaypart(daypart)}
              />
            </View>
          ))}
        </View>
      </View>

      <View style={s.section}>
        <Text style={s.sectionTitle}>Sana hatırlatalım mı?</Text>
        <View style={s.list}>
          <SelectableTile
            role="radio"
            size="card"
            emoji="🔔"
            label="Evet, hatırlat"
            meta="Rutinlerimin zamanında bildirim gönder."
            selected={answers.reminderIntent === true}
            onPress={handleReminderYes}
          />
          <SelectableTile
            role="radio"
            size="card"
            emoji="🔕"
            label="Şimdilik istemiyorum"
            meta="Bildirim gönderilmez. Ayarlar'dan sonra açabilirsin."
            selected={answers.reminderIntent === false}
            onPress={handleReminderNo}
          />
        </View>

        {!!permissionNote && (
          <View style={s.noteRow}>
            <Ionicons name={permissionNote.icon} size={15} color={permissionNote.color} />
            <Text style={[s.noteText, { color: permissionNote.color }]}>{permissionNote.text}</Text>
          </View>
        )}
      </View>
    </OnboardingScaffold>
  );
}

const s = StyleSheet.create({
  section: { gap: space.md },
  sectionTitle: { ...font.h2, color: colors.text },
  sectionHint: { ...font.bodySm, color: colors.textFaint, marginTop: -4 },
  list: { gap: space.sm },
  chipGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chipCell: { flexGrow: 1, flexBasis: '46%', minWidth: 150 },
  noteRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: space.xs },
  noteText: { ...font.caption, flex: 1, lineHeight: 18 },
});
