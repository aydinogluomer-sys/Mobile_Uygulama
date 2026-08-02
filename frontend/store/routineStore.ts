import { create } from 'zustand';
import { supabase, Routine } from '../lib/supabase';
import { useSubscriptionStore } from './subscriptionStore';

type GeneratedHabit = {
  name: string;
  icon: string;
  tracking_type: 'boolean' | 'numeric';
  unit: string | null;
  daily_goal: number | null;
  frequency_config: { kind: 'daily' | 'weekly' | 'monthly'; part_of_day?: string[] };
  willpower_cost: number;
};

type GeneratedRoutine = {
  name: string;
  description: string;
  items: GeneratedHabit[];
};

type RoutineStore = {
  routines: Routine[];
  generatedRoutine: GeneratedRoutine | null;
  generating: boolean;
  generateError: string | null;
  fetchRoutines: () => Promise<void>;
  generateRoutine: (prompt: string) => Promise<void>;
  clearGenerated: () => void;
  addGeneratedToHabits: (items: GeneratedHabit[]) => Promise<void>;
};

export const useRoutineStore = create<RoutineStore>((set) => ({
  routines: [],
  generatedRoutine: null,
  generating: false,
  generateError: null,

  fetchRoutines: async () => {
    const { data } = await supabase.from('routines').select('*').order('id');
    if (data) set({ routines: data as Routine[] });
  },

  generateRoutine: async (prompt) => {
    // Oturum kontrolü
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      set({ generateError: 'Bu özelliği kullanmak için giriş yapman gerekiyor.', generating: false });
      return;
    }

    set({ generating: true, generatedRoutine: null, generateError: null });
    try {
      const { data, error } = await supabase.functions.invoke('generate-routine', {
        body: { prompt },
      });

      if (error) {
        // FunctionsHttpError içinden sunucunun döndürdüğü mesajı çek
        let msg = 'Bir hata oluştu, tekrar deneyin.';
        try {
          const body = await (error as any).context?.json?.();
          if (body?.error) msg = body.error;
          if (typeof body?.balance === 'number') useSubscriptionStore.getState().setBalance(body.balance);
        } catch {
          if (error.message) msg = error.message;
        }
        set({ generateError: msg });
        return;
      }

      if (data?.error) {
        set({ generateError: data.error });
        return;
      }

      if (typeof data?.balance === 'number') useSubscriptionStore.getState().setBalance(data.balance);
      set({ generatedRoutine: data as GeneratedRoutine });
    } catch (err) {
      set({ generateError: err instanceof Error ? err.message : 'Sunucu hatası.' });
    } finally {
      set({ generating: false });
    }
  },

  clearGenerated: () => set({ generatedRoutine: null, generateError: null }),

  addGeneratedToHabits: async (items) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const inserts = items.map((item) => ({
      user_id: user.id,
      name: item.name,
      icon: item.icon,
      behavior_type: 'positive' as const,
      tracking_type: item.tracking_type ?? 'boolean',
      unit: item.unit ?? null,
      daily_goal: item.daily_goal ?? null,
      frequency_config: item.frequency_config ?? { kind: 'daily' },
      willpower_cost: item.willpower_cost ?? 3,
      status: 'waiting' as const,
      impact_level: 'medium' as const,
      urgency: 'not_urgent' as const,
      difficulty: 3,
      estimated_minutes: 0,
    }));
    await supabase.from('habits').insert(inserts);
  },
}));
