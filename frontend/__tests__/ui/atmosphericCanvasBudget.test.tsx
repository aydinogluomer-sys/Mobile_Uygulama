import React from 'react';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { AccessibilityInfo, Animated, AppState, Platform, TouchableOpacity, type AppStateStatus } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';

const mockReact = React;

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-image', () => ({
  Image: (props: Record<string, unknown>) => mockReact.createElement('ExpoImage', props),
}));
jest.mock('../../lib/haptics', () => ({
  haptic: { select: jest.fn(), light: jest.fn(), success: jest.fn() },
}));

import { stripComments } from '../helpers/sourceText';
import AtmosphericScreenCanvas, { effectiveScrim } from '../../components/spatial/AtmosphericScreenCanvas';
import MorphingPillTabs from '../../components/motion/MorphingPillTabs';
import SeasonalMotion from '../../components/seasonalMotion/SeasonalMotion';
import { resetReducedMotionForTests } from '../../components/seasonalMotion/useReducedMotion';
import { resetAppActiveForTests } from '../../hooks/useScreenActive';

const ROOT = join(__dirname, '..', '..');

function walkTsx(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) out.push(...walkTsx(rel));
    else if (/\.(?:ts|tsx)$/.test(e.name)) out.push(rel);
  }
  return out;
}

describe('F25 (PRF-07, PRF-11, GEM-09) — AtmosphericScreenCanvas, SeasonalMotion, and MorphingPillTabs budget', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalOS = Platform.OS;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    Object.defineProperty(Platform, 'OS', { value: originalOS, configurable: true });
    resetReducedMotionForTests();
    resetAppActiveForTests();
    jest.restoreAllMocks();
  });

  it('(+) active={false} unmounts Image and SeasonalMotion; active={true} mounts Image', () => {
    let rInactive!: TestRenderer.ReactTestRenderer;
    act(() => {
      rInactive = TestRenderer.create(
        <AtmosphericScreenCanvas source={1} textureSource={2} ambientMotion active={false} />,
      );
    });
    expect(rInactive.root.findAll((n) => (n.type as string) === 'ExpoImage')).toHaveLength(0);
    expect(rInactive.root.findAllByType(SeasonalMotion)).toHaveLength(0);
    act(() => {
      rInactive.unmount();
    });

    let rActive!: TestRenderer.ReactTestRenderer;
    act(() => {
      rActive = TestRenderer.create(
        <AtmosphericScreenCanvas source={1} textureSource={2} ambientMotion active={true} />,
      );
    });
    expect(rActive.root.findAll((n) => (n.type as string) === 'ExpoImage')).toHaveLength(2);
    act(() => {
      rActive.unmount();
    });
  });

  it('(+) effectiveScrim enforces >= 0.90 in light mode and preserves scrim in dark mode', () => {
    expect(effectiveScrim(0.62, 'light')).toBe(0.9);
    expect(effectiveScrim(0.94, 'light')).toBe(0.94);
    expect(effectiveScrim(0.62, 'dark')).toBe(0.62);
  });

  it('(+) SeasonalMotion returns null when AppState enters background and resumes on active', () => {
    let appStateHandler: ((s: AppStateStatus) => void) | null = null;
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_evt, handler) => {
      appStateHandler = handler as (s: AppStateStatus) => void;
      return { remove: jest.fn() } as unknown as ReturnType<typeof AppState.addEventListener>;
    });
    resetAppActiveForTests();

    let r!: TestRenderer.ReactTestRenderer;
    act(() => {
      r = TestRenderer.create(
        <SeasonalMotion month="Ocak" intensity="normal" reduceMotion={false} isVisible={true} />,
      );
    });
    expect(r.toJSON()).not.toBeNull();

    act(() => {
      appStateHandler?.('background');
    });
    expect(r.toJSON()).toBeNull();

    act(() => {
      appStateHandler?.('active');
    });
    expect(r.toJSON()).not.toBeNull();

    act(() => {
      r.unmount();
    });
  });

  it('(+) MorphingPillTabs animates translateX and scaleX with useNativeDriver: true on native platforms', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
    process.env.NODE_ENV = 'production';
    resetReducedMotionForTests();

    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
    jest.spyOn(AccessibilityInfo, 'addEventListener').mockReturnValue({
      remove: jest.fn(),
    } as unknown as ReturnType<typeof AccessibilityInfo.addEventListener>);
    jest.spyOn(AppState, 'addEventListener').mockReturnValue({
      remove: jest.fn(),
    } as unknown as ReturnType<typeof AppState.addEventListener>);

    const springSpy = jest.spyOn(Animated, 'spring').mockImplementation(
      () =>
        ({
          start: (cb?: (res: { finished: boolean }) => void) => cb?.({ finished: true }),
          stop: jest.fn(),
          reset: jest.fn(),
        }) as unknown as Animated.CompositeAnimation,
    );

    const segments = [
      { key: 'a', label: 'Sekme A' },
      { key: 'b', label: 'Sekme B' },
    ] as const;

    let r!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      r = TestRenderer.create(
        <MorphingPillTabs segments={segments} value="a" onChange={jest.fn()} />,
      );
      await Promise.resolve();
    });

    const tabs = r.root.findAllByType(TouchableOpacity);
    act(() => {
      tabs[0].props.onLayout({ nativeEvent: { layout: { x: 3, width: 80, y: 0, height: 32 } } });
      tabs[1].props.onLayout({ nativeEvent: { layout: { x: 87, width: 120, y: 0, height: 32 } } });
    });

    springSpy.mockClear();
    await act(async () => {
      r.update(<MorphingPillTabs segments={segments} value="b" onChange={jest.fn()} />);
    });

    expect(springSpy).toHaveBeenCalledTimes(2);
    expect(springSpy.mock.calls[0][1].useNativeDriver).toBe(true);
    expect(springSpy.mock.calls[1][1].useNativeDriver).toBe(true);

    act(() => {
      r.unmount();
    });
  });

  it('(-) default canvas in test environment (active omitted) renders neither Image nor SeasonalMotion', () => {
    let r!: TestRenderer.ReactTestRenderer;
    act(() => {
      r = TestRenderer.create(<AtmosphericScreenCanvas source={1} ambientMotion />);
    });
    expect(r.root.findAll((n) => (n.type as string) === 'ExpoImage')).toHaveLength(0);
    expect(r.root.findAllByType(SeasonalMotion)).toHaveLength(0);
    act(() => {
      r.unmount();
    });
  });

  it('(-) source guards: today.tsx gates ambientMotion on !lowEnergyFilter, no bare isVisible in canvas, and useNativeDriver: false only in FloatingLabelInput', () => {
    const today = stripComments(readFileSync(join(ROOT, 'app/tabs/today.tsx'), 'utf8'));
    expect(today).toContain('ambientMotion={!lowEnergyFilter}');
    expect(today).not.toMatch(/\bambientMotion\s*(?:\/>|\n)/);

    const canvas = stripComments(
      readFileSync(join(ROOT, 'components/spatial/AtmosphericScreenCanvas.tsx'), 'utf8'),
    );
    expect(canvas).not.toMatch(/\bisVisible\s*(?:\/>|\n)/);
    expect(canvas).toContain('isVisible={ambientMotion && isActive}');

    const nonNativeDriverFiles = walkTsx('components').filter((rel) => {
      const code = stripComments(readFileSync(join(ROOT, rel), 'utf8'));
      return /useNativeDriver\s*:\s*false/.test(code);
    });
    expect(nonNativeDriverFiles).toEqual(['components/ui/FloatingLabelInput.tsx']);
  });
});
