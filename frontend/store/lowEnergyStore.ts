import { create, type StoreApi, type UseBoundStore } from 'zustand';
import { registerAccountScoped, registerAccountStorage } from '../lib/accountScope';
import { todayLocal } from '../lib/date';

export function lowEnergyKey(uid: string): string {
  return `aderyth.lowEnergy.v1.${uid}`;
}

export type LowEnergyState = {
  on: boolean;
  day: string | null;
  set: (on: boolean, today?: string) => void;
};

export function isLowEnergyOn(
  s: Pick<LowEnergyState, 'on' | 'day'>,
  today: string,
): boolean {
  return Boolean(s.on) && s.day === today;
}

export const useLowEnergyStore: UseBoundStore<StoreApi<LowEnergyState>> =
  create<LowEnergyState>((set) => ({
    on: false,
    day: null,
    set: (on, today = todayLocal()) => {
      set({ on: Boolean(on), day: on ? today : null });
    },
  }));

registerAccountScoped({ name: 'lowEnergy', store: useLowEnergyStore });
registerAccountStorage({
  name: 'lowEnergy',
  transient: true,
  keysFor: (uid) => [lowEnergyKey(uid)],
});
