import React from 'react';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { Platform, Text } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import {
  HAPTICS_KEY,
  HAPTIC_DEBOUNCE_MS,
  getHapticsEnabled,
  haptic,
  loadHapticsPreference,
  resetHapticsForTests,
  setHapticsEnabled,
  useHapticsEnabled,
} from '../../lib/haptics';
import { stripComments } from '../helpers/sourceText';

const ROOT = join(__dirname, '..', '..');
jest.setTimeout(30_000);

function HookProbe() {
  const enabled = useHapticsEnabled();
  return React.createElement(Text, null, enabled ? 'on' : 'off');
}

function walkProdFiles(dir: string): string[] {
  const abs = join(ROOT, dir);
  if (!existsSync(abs)) return [];
  const out: string[] = [];
  for (const e of readdirSync(abs, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '__tests__' || e.name.startsWith('.')) continue;
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) out.push(...walkProdFiles(rel));
    else if (/\.(?:ts|tsx)$/.test(e.name) && !e.name.endsWith('.d.ts')) out.push(rel);
  }
  return out;
}

describe('F26 (DSA-12) — haptics preference store and 150ms debounce', () => {
  const origOS = Platform.OS;
  let impactSpy: jest.SpyInstance;
  let notifSpy: jest.SpyInstance;
  let selectSpy: jest.SpyInstance;

  beforeEach(async () => {
    Platform.OS = 'ios';
    await AsyncStorage.clear();
    resetHapticsForTests();
    impactSpy = jest.spyOn(Haptics, 'impactAsync').mockResolvedValue(undefined);
    notifSpy = jest.spyOn(Haptics, 'notificationAsync').mockResolvedValue(undefined);
    selectSpy = jest.spyOn(Haptics, 'selectionAsync').mockResolvedValue(undefined);
  });

  afterEach(() => {
    Platform.OS = origOS;
    jest.restoreAllMocks();
  });

  it('(+) defaults to enabled, persists app_haptics, updates useHapticsEnabled, and suppresses all haptics when disabled', async () => {
    expect(HAPTICS_KEY).toBe('app_haptics');
    expect(HAPTIC_DEBOUNCE_MS).toBe(150);
    expect(getHapticsEnabled()).toBe(true);

    let r!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      r = TestRenderer.create(React.createElement(HookProbe));
    });
    expect(r.toJSON()).toMatchObject({ children: ['on'] });

    await act(async () => {
      setHapticsEnabled(false);
    });
    expect(getHapticsEnabled()).toBe(false);
    expect(r.toJSON()).toMatchObject({ children: ['off'] });
    expect(await AsyncStorage.getItem(HAPTICS_KEY)).toBe('0');

    haptic.light();
    haptic.medium();
    haptic.success();
    haptic.warning();
    haptic.error();
    haptic.select();
    expect(impactSpy).not.toHaveBeenCalled();
    expect(notifSpy).not.toHaveBeenCalled();
    expect(selectSpy).not.toHaveBeenCalled();

    resetHapticsForTests();
    expect(getHapticsEnabled()).toBe(true);
    await loadHapticsPreference();
    expect(getHapticsEnabled()).toBe(false);

    await act(async () => {
      r.unmount();
    });
  });

  it('(+) debounces light() and select() within 150ms while allowing medium/success/warning/error without throttling', () => {
    let now = 10_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);

    haptic.light();
    now += 100;
    haptic.light();
    expect(impactSpy).toHaveBeenCalledTimes(1);

    now += 51; // 151ms since first call
    haptic.light();
    expect(impactSpy).toHaveBeenCalledTimes(2);

    haptic.select();
    now += 149;
    haptic.select();
    expect(selectSpy).toHaveBeenCalledTimes(1);
    now += 2;
    haptic.select();
    expect(selectSpy).toHaveBeenCalledTimes(2);

    // Semantic feedback is never swallowed by debounce
    haptic.success();
    haptic.success();
    haptic.error();
    haptic.error();
    expect(notifSpy).toHaveBeenCalledTimes(4);
  });

  it('(-) falls back to enabled on corrupt storage, emits nothing on web, and keeps expo-haptics isolated to lib/haptics.ts', async () => {
    await AsyncStorage.setItem(HAPTICS_KEY, 'corrupt-value');
    await loadHapticsPreference();
    expect(getHapticsEnabled()).toBe(true);

    Platform.OS = 'web';
    haptic.light();
    haptic.success();
    haptic.select();
    expect(impactSpy).not.toHaveBeenCalled();
    expect(notifSpy).not.toHaveBeenCalled();
    expect(selectSpy).not.toHaveBeenCalled();

    const prodDirs = ['app', 'components', 'hooks', 'lib', 'services', 'store', 'repositories'];
    const importers = prodDirs
      .flatMap(walkProdFiles)
      .filter((rel) => /['"]expo-haptics['"]/.test(stripComments(readFileSync(join(ROOT, rel), 'utf8'))));
    expect(importers).toEqual(['lib/haptics.ts']);
  });
});
