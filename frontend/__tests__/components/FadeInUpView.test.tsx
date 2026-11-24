/**
 * F08 (BLD-10) — FadeInUpView, the react-native-animatable `fadeInUp` replacement.
 * Animated.timing is spied so the test sees exactly what is started and stopped.
 */
import React from 'react';
import { Animated, Text } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import FadeInUpView, { FADE_IN_UP_MAX_MS } from '../../components/motion/FadeInUpView';

type R = TestRenderer.ReactTestRenderer;

type Started = { config: Animated.TimingAnimationConfig; start: jest.Mock; stop: jest.Mock };
let started: Started[];
let timingSpy: jest.SpyInstance;

beforeEach(() => {
  started = [];
  timingSpy = jest.spyOn(Animated, 'timing').mockImplementation((_value, config) => {
    const entry: Started = { config, start: jest.fn(), stop: jest.fn() };
    started.push(entry);
    return { start: entry.start, stop: entry.stop, reset: jest.fn() } as unknown as Animated.CompositeAnimation;
  });
});
afterEach(() => timingSpy.mockRestore());

async function render(el: React.ReactElement): Promise<R> {
  let r!: R;
  await act(async () => {
    r = TestRenderer.create(el);
  });
  return r;
}

/** The Animated.View host node and its flattened animated style. */
function animatedStyle(r: R): { opacity: unknown; transform: { translateY: unknown }[] } {
  const host = r.root.findAll((n) => Array.isArray(n.props.style) || typeof n.props.style === 'object')[0];
  const flat = Object.assign({}, ...[host.props.style].flat(Infinity).filter(Boolean));
  return flat;
}

const num = (v: unknown): number => {
  const anyV = v as { __getValue?: () => number };
  return typeof anyV?.__getValue === 'function' ? anyV.__getValue() : Number(v);
};

it('(+) not disabled: one native-driver timing to 1 over 250 ms starts, from opacity 0 / translateY 12; children render', async () => {
  const r = await render(
    <FadeInUpView>
      <Text>XP +10</Text>
    </FadeInUpView>,
  );
  expect(started).toHaveLength(1);
  expect(started[0].config).toEqual(expect.objectContaining({ toValue: 1, duration: 250, useNativeDriver: true }));
  expect(started[0].start).toHaveBeenCalledTimes(1);
  const style = animatedStyle(r);
  expect(num(style.opacity)).toBe(0);
  expect(num(style.transform[0].translateY)).toBe(12);
  expect(r.root.findAll((n) => n.props.children === 'XP +10').length).toBeGreaterThan(0);
  act(() => r.unmount());
});

it('(+) a duration over 400 ms is clamped; a custom one under it is kept', async () => {
  const r1 = await render(<FadeInUpView duration={1000} />);
  const r2 = await render(<FadeInUpView duration={180} />);
  expect(started.map((s) => s.config.duration)).toEqual([FADE_IN_UP_MAX_MS, 180]);
  act(() => {
    r1.unmount();
    r2.unmount();
  });
});

it('(-) disabled (Reduce Motion): nothing is started and the start values ARE the end values', async () => {
  const r = await render(
    <FadeInUpView disabled>
      <Text>Geri al</Text>
    </FadeInUpView>,
  );
  expect(started).toHaveLength(0);
  const style = animatedStyle(r);
  expect(num(style.opacity)).toBe(1);
  expect(num(style.transform[0].translateY)).toBe(0);
  act(() => r.unmount());
});

it('(-) unmount stops the running animation (no timer is left behind)', async () => {
  timingSpy.mockRestore();
  const realTiming = Animated.timing.bind(Animated);
  let stopSpy!: jest.SpyInstance;
  timingSpy = jest.spyOn(Animated, 'timing').mockImplementation((value, config) => {
    const anim = realTiming(value, config);
    stopSpy = jest.spyOn(anim, 'stop');
    return anim;
  });

  jest.useFakeTimers();
  try {
    const r = await render(<FadeInUpView />);
    const style = animatedStyle(r);
    expect(num(style.opacity)).toBe(0);
    expect(stopSpy).toBeDefined();
    expect(stopSpy).not.toHaveBeenCalled();
    act(() => {
      r.unmount();
    });
    expect(stopSpy).toHaveBeenCalledTimes(1);
    act(() => {
      jest.advanceTimersByTime(300);
      jest.runAllTimers();
    });
    // Had the animation timer survived unmount, advancing 300 ms would have driven opacity to 1.
    expect(num(style.opacity)).toBe(0);
    expect(jest.getTimerCount()).toBe(0);
  } finally {
    jest.useRealTimers();
  }
});
