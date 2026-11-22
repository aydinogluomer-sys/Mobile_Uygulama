import React from 'react';
import { Appearance, StyleSheet, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import TestRenderer, { act } from 'react-test-renderer';
import { ACCENTS_LIGHT, palettes, type Palette } from '../../lib/tokens';
import { applyColorScheme, useThemeStore } from '../../store/themeStore';
import { useThemeColors, useThemedStyles, useThemeMode } from '../../hooks/useThemeColors';

describe('F25 (DSA-01) — useThemeColors, useThemedStyles, and themeStore persistence', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    useThemeStore.setState({ isDark: true, accent: 'clay', seasonalMotion: 'subtle' });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('(+) while LIGHT_THEME_ENABLED is false, useThemeMode and useThemeColors stay dark even if isDark=false', () => {
    useThemeStore.setState({ isDark: false });
    let capturedMode = '';
    let capturedBg = '';

    function Probe() {
      capturedMode = useThemeMode();
      capturedBg = useThemeColors().bg;
      return <View />;
    }

    let r!: TestRenderer.ReactTestRenderer;
    act(() => {
      r = TestRenderer.create(<Probe />);
    });
    expect(capturedMode).toBe('dark');
    expect(capturedBg).toBe(palettes.dark.bg);
    act(() => {
      r.unmount();
    });
  });

  it('(+) when LIGHT_THEME_ENABLED is true (isolated module), isDark=false resolves light palette and light accent', () => {
    jest.isolateModules(() => {
      jest.doMock('react', () => React);
      jest.doMock('../../lib/featureGates', () => ({
        ...jest.requireActual('../../lib/featureGates'),
        LIGHT_THEME_ENABLED: true,
      }));
      /* eslint-disable @typescript-eslint/no-require-imports -- jest.isolateModules requires CJS require */
      const { useThemeStore: isolatedStore } =
        require('../../store/themeStore') as typeof import('../../store/themeStore');
      const { useThemeColors: isolatedColors, useThemeMode: isolatedMode } =
        require('../../hooks/useThemeColors') as typeof import('../../hooks/useThemeColors');
      const { useAccent: isolatedAccent } =
        require('../../lib/useAccent') as typeof import('../../lib/useAccent');
      /* eslint-enable @typescript-eslint/no-require-imports */

      isolatedStore.setState({ isDark: false, accent: 'clay' });
      let mode = '';
      let bg = '';
      let accentPrimary = '';

      function LightProbe() {
        mode = isolatedMode();
        bg = isolatedColors().bg;
        accentPrimary = isolatedAccent().primary;
        return <View />;
      }

      let r!: TestRenderer.ReactTestRenderer;
      act(() => {
        r = TestRenderer.create(<LightProbe />);
      });
      expect(mode).toBe('light');
      expect(bg).toBe(palettes.light.bg);
      expect(accentPrimary).toBe(ACCENTS_LIGHT.clay.primary);
      act(() => {
        r.unmount();
      });
    });
  });

  it('(+) useThemedStyles memoizes the factory output across re-renders for the same mode', () => {
    let factoryCalls = 0;
    const makeStyles = (c: Palette) => {
      factoryCalls += 1;
      return StyleSheet.create({ box: { backgroundColor: c.surface } });
    };

    const seen: ReturnType<typeof makeStyles>[] = [];
    function StyledProbe({ tick }: { tick: number }) {
      const styles = useThemedStyles(makeStyles);
      seen.push(styles);
      return <View testID={String(tick)} style={styles.box} />;
    }

    let r!: TestRenderer.ReactTestRenderer;
    act(() => {
      r = TestRenderer.create(<StyledProbe tick={1} />);
    });
    act(() => {
      r.update(<StyledProbe tick={2} />);
    });

    expect(factoryCalls).toBe(1);
    expect(seen).toHaveLength(2);
    expect(seen[0]).toBe(seen[1]);
    act(() => {
      r.unmount();
    });
  });

  it('(+) setDark and load persist app_theme_mode, delete legacy app_theme_dark, and invoke Appearance.setColorScheme("dark") while gated', async () => {
    const colorSchemeSpy = jest.fn();
    Object.defineProperty(Appearance, 'setColorScheme', {
      value: colorSchemeSpy,
      configurable: true,
      writable: true,
    });

    useThemeStore.getState().setDark(false);
    expect(useThemeStore.getState().isDark).toBe(false);
    expect(await AsyncStorage.getItem('app_theme_mode')).toBe('light');
    expect(colorSchemeSpy).toHaveBeenLastCalledWith('dark');

    // Legacy key cleanup + reload
    await AsyncStorage.setItem('app_theme_dark', '0');
    await AsyncStorage.setItem('app_theme_mode', 'light');
    useThemeStore.setState({ isDark: true });

    await useThemeStore.getState().load();
    expect(useThemeStore.getState().isDark).toBe(false);
    expect(await AsyncStorage.getItem('app_theme_dark')).toBeNull();
    expect(colorSchemeSpy).toHaveBeenCalledWith('dark');
  });

  it('(-) applyColorScheme never throws when Appearance.setColorScheme is undefined (web), and corrupt storage falls back to dark', async () => {
    const origSetColorScheme = Appearance.setColorScheme;
    Object.defineProperty(Appearance, 'setColorScheme', {
      value: undefined,
      configurable: true,
      writable: true,
    });

    expect(() => applyColorScheme('dark')).not.toThrow();
    expect(() => applyColorScheme('light')).not.toThrow();

    Object.defineProperty(Appearance, 'setColorScheme', {
      value: origSetColorScheme,
      configurable: true,
      writable: true,
    });

    await AsyncStorage.setItem('app_theme_mode', 'x');
    useThemeStore.setState({ isDark: false });
    await useThemeStore.getState().load();
    expect(useThemeStore.getState().isDark).toBe(true);
  });
});
