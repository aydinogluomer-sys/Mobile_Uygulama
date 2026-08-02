import { create } from 'zustand';

type CommandStore = {
  visible: boolean;
  open: () => void;
  close: () => void;
};

export const useCommandStore = create<CommandStore>((set) => ({
  visible: false,
  open: () => set({ visible: true }),
  close: () => set({ visible: false }),
}));
