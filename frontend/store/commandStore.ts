import { create } from 'zustand';

/**
 * Two quick actions in the command palette open a modal that does not live in
 * the palette: "Yeni alışkanlık ekle" (`HabitOnboarding`, owned by the
 * habits/timeline screens) and "AI Rutin oluştur" (`AIRoutineModal`, owned by
 * `tabs/habits.tsx`).
 *
 * The palette used to receive those as `onOpenHabitForm` / `onOpenAIModal`
 * props, which only worked while it was rendered BY the screen owning the
 * modal. Mounted once at the tab-layout level — the only place where the
 * header button that opens it also lives — those props have no caller, and
 * the two actions would have become the thing this whole change exists to
 * remove: a visible row that does nothing.
 *
 * So the intent is handed over instead of the callback. The palette records
 * what the user asked for and navigates; the screen that owns the modal
 * consumes the intent on arrival and opens it.
 *
 * `consumeIntent` clears as it reads, deliberately. A screen that re-renders
 * (or a second screen that also watches) must not reopen the modal a second
 * time, and an intent that outlived its navigation would fire on an unrelated
 * later visit.
 */
export type CommandIntent = 'new-habit' | 'ai-routine';

type CommandStore = {
  visible: boolean;
  open: () => void;
  close: () => void;
  /** Set by the palette just before it navigates; null once consumed. */
  pendingIntent: CommandIntent | null;
  requestIntent: (intent: CommandIntent) => void;
  /** Returns the pending intent and clears it in the same step. */
  consumeIntent: () => CommandIntent | null;
};

export const useCommandStore = create<CommandStore>((set, get) => ({
  visible: false,
  open: () => set({ visible: true }),
  close: () => set({ visible: false }),

  pendingIntent: null,
  requestIntent: (intent) => set({ pendingIntent: intent }),
  consumeIntent: () => {
    const intent = get().pendingIntent;
    if (intent) set({ pendingIntent: null });
    return intent;
  },
}));
