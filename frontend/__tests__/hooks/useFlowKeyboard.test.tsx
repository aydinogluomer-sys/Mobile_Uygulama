import React from 'react';
import { Platform } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import {
  isEditableTarget,
  useFlowKeyboard,
} from '../../hooks/useFlowKeyboard';

type KeyListener = (e: KeyboardEvent) => void;

describe('useFlowKeyboard (PRF-05)', () => {
  const origOs = Platform.OS;
  const origWindow = (globalThis as { window?: unknown }).window;
  let listeners: KeyListener[] = [];
  let addSpy: jest.Mock;
  let removeSpy: jest.Mock;

  function setPlatform(os: 'web' | 'ios' | 'android') {
    (Platform as { OS: string }).OS = os;
  }

  function dispatchKey(
    key: string,
    opts: {
      target?: unknown;
      metaKey?: boolean;
      ctrlKey?: boolean;
      altKey?: boolean;
      defaultPrevented?: boolean;
    } = {},
  ) {
    let prevented = Boolean(opts.defaultPrevented);
    const ev = {
      key,
      target: opts.target ?? null,
      metaKey: Boolean(opts.metaKey),
      ctrlKey: Boolean(opts.ctrlKey),
      altKey: Boolean(opts.altKey),
      get defaultPrevented() {
        return prevented;
      },
      preventDefault: jest.fn(() => {
        prevented = true;
      }),
    } as unknown as KeyboardEvent & { preventDefault: jest.Mock };

    for (const fn of [...listeners]) {
      fn(ev);
    }
    return ev;
  }

  beforeEach(() => {
    listeners = [];
    addSpy = jest.fn((type: string, fn: KeyListener) => {
      if (type === 'keydown') listeners.push(fn);
    });
    removeSpy = jest.fn((type: string, fn: KeyListener) => {
      if (type === 'keydown') {
        listeners = listeners.filter((l) => l !== fn);
      }
    });
    (globalThis as { window?: unknown }).window = {
      addEventListener: addSpy,
      removeEventListener: removeSpy,
    };
    setPlatform('web');
  });

  afterEach(() => {
    setPlatform(origOs as 'web' | 'ios' | 'android');
    (globalThis as { window?: unknown }).window = origWindow;
  });

  function Probe({
    enabled,
    onNext,
    onPrev,
  }: {
    enabled: boolean;
    onNext: () => void;
    onPrev: () => void;
  }) {
    useFlowKeyboard({ enabled, onNext, onPrev });
    return null;
  }

  it('(+) ArrowDown calls onNext and ArrowUp calls onPrev with preventDefault when enabled on web', () => {
    const onNext = jest.fn();
    const onPrev = jest.fn();

    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(
        <Probe enabled onNext={onNext} onPrev={onPrev} />,
      );
    });

    const down = dispatchKey('ArrowDown', { target: { tagName: 'DIV' } });
    expect(onNext).toHaveBeenCalledTimes(1);
    expect(onPrev).not.toHaveBeenCalled();
    expect(down.defaultPrevented).toBe(true);

    const up = dispatchKey('ArrowUp', { target: { tagName: 'DIV' } });
    expect(onPrev).toHaveBeenCalledTimes(1);
    expect(up.defaultPrevented).toBe(true);

    act(() => {
      tree.unmount();
    });
  });

  it('(-) does not attach listener or preventDefault when enabled=false, and cleans up on unmount', () => {
    const onNext = jest.fn();
    const onPrev = jest.fn();

    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(
        <Probe enabled={false} onNext={onNext} onPrev={onPrev} />,
      );
    });

    expect(addSpy).not.toHaveBeenCalled();
    const ev = dispatchKey('ArrowDown');
    expect(ev.defaultPrevented).toBe(false);
    expect(onNext).not.toHaveBeenCalled();

    act(() => {
      tree.update(<Probe enabled onNext={onNext} onPrev={onPrev} />);
    });
    expect(listeners).toHaveLength(1);

    act(() => {
      tree.unmount();
    });
    expect(removeSpy).toHaveBeenCalledTimes(1);
    expect(listeners).toHaveLength(0);

    const afterUnmount = dispatchKey('ArrowDown');
    expect(afterUnmount.defaultPrevented).toBe(false);
    expect(onNext).not.toHaveBeenCalled();
  });

  it('(-) ignores editable targets (input, textarea, select, contentEditable) and modifier keys without calling preventDefault', () => {
    const onNext = jest.fn();
    const onPrev = jest.fn();

    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(
        <Probe enabled onNext={onNext} onPrev={onPrev} />,
      );
    });

    const editableTargets = [
      { tagName: 'TEXTAREA' },
      { tagName: 'INPUT' },
      { tagName: 'SELECT' },
      { tagName: 'DIV', isContentEditable: true },
      { tagName: 'SPAN', contentEditable: 'true' },
    ];

    for (const target of editableTargets) {
      expect(isEditableTarget(target as unknown as EventTarget)).toBe(true);
      const e1 = dispatchKey('ArrowDown', { target });
      const e2 = dispatchKey('ArrowUp', { target });
      expect(e1.preventDefault).not.toHaveBeenCalled();
      expect(e2.preventDefault).not.toHaveBeenCalled();
    }

    expect(isEditableTarget({ tagName: 'DIV' } as unknown as EventTarget)).toBe(false);
    expect(isEditableTarget(null)).toBe(false);

    const metaEv = dispatchKey('ArrowDown', { metaKey: true });
    const ctrlEv = dispatchKey('ArrowUp', { ctrlKey: true });
    const altEv = dispatchKey('ArrowDown', { altKey: true });
    const prePrevented = dispatchKey('ArrowDown', { defaultPrevented: true });

    expect(metaEv.preventDefault).not.toHaveBeenCalled();
    expect(ctrlEv.preventDefault).not.toHaveBeenCalled();
    expect(altEv.preventDefault).not.toHaveBeenCalled();
    expect(prePrevented.preventDefault).not.toHaveBeenCalled();
    expect(onNext).not.toHaveBeenCalled();
    expect(onPrev).not.toHaveBeenCalled();

    act(() => {
      tree.unmount();
    });
  });

  it('(-) never calls window.addEventListener on non-web platforms', () => {
    setPlatform('ios');
    const onNext = jest.fn();
    const onPrev = jest.fn();

    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(
        <Probe enabled onNext={onNext} onPrev={onPrev} />,
      );
    });

    expect(addSpy).not.toHaveBeenCalled();
    act(() => {
      tree.unmount();
    });
  });
});
