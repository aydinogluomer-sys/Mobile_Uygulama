/**
 * F34 (PS-30) — `ActiveRoutinePicker` UI contract:
 *  - Suggests morning/afternoon/evening or user's active routine up front
 *  - Collapses remaining templates under "Diğer rutinler (N)" (`expanded` state)
 *  - Never calls `onStart` during render
 *  - Flat list when no suggestion exists; `null` on empty template list
 *  - Every pressable target >= 44pt (`minHeight + hitSlop >= 44`)
 */
import React from 'react';
import { Text } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';

const mockReact = React;

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('../../components/spatial', () => ({
  EmbeddedFiligree: (props: Record<string, unknown>) => mockReact.createElement('EmbeddedFiligree', props),
}));

import ActiveRoutinePicker from '../../components/routineRunner/ActiveRoutinePicker';
import { BUILT_IN_TEMPLATES, type RoutineTemplate } from '../../lib/routineRunner';

function allText(root: TestRenderer.ReactTestInstance): string {
  return root
    .findAllByType(Text)
    .map((n) => (Array.isArray(n.props.children) ? n.props.children.join('') : String(n.props.children ?? '')))
    .join(' | ');
}

describe('F34 PS-30 — ActiveRoutinePicker', () => {
  it('(+) at 08:00 shows "Şimdi hangisi?", "Sabah için önerildi", collapsed "Diğer rutinler (2)", and Başla calls onStart("builtin-morning")', () => {
    const onStart = jest.fn();
    const onSetActive = jest.fn();

    let r!: TestRenderer.ReactTestRenderer;
    act(() => {
      r = TestRenderer.create(
        <ActiveRoutinePicker
          templates={BUILT_IN_TEMPLATES}
          activeTemplateId={null}
          hour={8}
          onStart={onStart}
          onSetActive={onSetActive}
        />,
      );
    });

    // (-) Never auto-starts on render
    expect(onStart).not.toHaveBeenCalled();

    const text = allText(r.root);
    expect(text).toContain('Şimdi hangisi?');
    expect(text).toContain('Sabah için önerildi');
    expect(text).toContain('Sabah');
    expect(text).toContain('Diğer rutinler (2)');
    expect(text).toContain('Öneri yalnız öneridir; başlatmak için sen dokunursun. Aktif rutin seçimi bu cihazda saklanır.');

    // Other routines collapsed by default
    expect(text).not.toContain('Çalışma başlangıcı');

    const othersBtn = r.root.find(
      (n) => typeof n.props?.onPress === 'function' && n.props?.accessibilityLabel === 'Diğer rutinler (2)',
    );
    expect(othersBtn.props.accessibilityState).toMatchObject({ expanded: false });

    // Start primary suggested routine
    const startBtn = r.root.find(
      (n) => typeof n.props?.onPress === 'function' && String(n.props?.accessibilityLabel ?? '').startsWith('Sabah rutinini başlat'),
    );
    act(() => {
      startBtn.props.onPress();
    });
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onStart).toHaveBeenCalledWith('builtin-morning');

    // Expand "Diğer rutinler (2)"
    act(() => {
      othersBtn.props.onPress();
    });
    expect(othersBtn.props.accessibilityState).toMatchObject({ expanded: true });
    expect(allText(r.root)).toContain('Çalışma başlangıcı');
    expect(allText(r.root)).toContain('Akşam');

    act(() => {
      r.unmount();
    });
  });

  it('(+) activeTemplateId shows "Aktif rutinin"; "Aktif yap" calls onSetActive(id) and "Aktif rutini kaldır" calls onSetActive(null)', () => {
    const onStart = jest.fn();
    const onSetActive = jest.fn();

    let r!: TestRenderer.ReactTestRenderer;
    act(() => {
      r = TestRenderer.create(
        <ActiveRoutinePicker
          templates={BUILT_IN_TEMPLATES}
          activeTemplateId={null}
          hour={8}
          onStart={onStart}
          onSetActive={onSetActive}
        />,
      );
    });

    const setActiveBtn = r.root.find(
      (n) => typeof n.props?.onPress === 'function' && n.props?.accessibilityLabel === 'Aktif yap',
    );
    act(() => {
      setActiveBtn.props.onPress();
    });
    expect(onSetActive).toHaveBeenCalledWith('builtin-morning');

    // Re-render with activeTemplateId='builtin-evening' even at 08:00
    act(() => {
      r.update(
        <ActiveRoutinePicker
          templates={BUILT_IN_TEMPLATES}
          activeTemplateId="builtin-evening"
          hour={8}
          onStart={onStart}
          onSetActive={onSetActive}
        />,
      );
    });

    expect(allText(r.root)).toContain('Aktif rutinin');
    expect(allText(r.root)).toContain('Akşam');

    const clearActiveBtn = r.root.find(
      (n) => typeof n.props?.onPress === 'function' && n.props?.accessibilityLabel === 'Aktif rutini kaldır',
    );
    act(() => {
      clearActiveBtn.props.onPress();
    });
    expect(onSetActive).toHaveBeenCalledWith(null);

    act(() => {
      r.unmount();
    });
  });

  it('(-) empty template list returns null; unknown activeTemplateId is ignored; no suggestion renders flat list; all buttons >= 44pt', () => {
    let emptyRenderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      emptyRenderer = TestRenderer.create(
        <ActiveRoutinePicker
          templates={[]}
          activeTemplateId={null}
          hour={8}
          onStart={jest.fn()}
          onSetActive={jest.fn()}
        />,
      );
    });
    expect(emptyRenderer.toJSON()).toBeNull();
    act(() => {
      emptyRenderer.unmount();
    });

    const customTemplates: RoutineTemplate[] = [
      {
        id: 'u-1',
        name: 'Esnek Akış',
        builtIn: false,
        versions: [{ version: 1, createdAt: 'x', steps: [{ id: 'a', title: 'Başla', kind: 'check' }] }],
      },
      {
        id: 'u-2',
        name: 'Hafta Sonu',
        builtIn: false,
        versions: [{ version: 1, createdAt: 'x', steps: [{ id: 'b', title: 'Yürüyüş', kind: 'check' }] }],
      },
    ];

    let flatRenderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      flatRenderer = TestRenderer.create(
        <ActiveRoutinePicker
          templates={customTemplates}
          activeTemplateId="unknown-template-id"
          hour={10}
          onStart={jest.fn()}
          onSetActive={jest.fn()}
        />,
      );
    });

    const flatText = allText(flatRenderer.root);
    expect(flatText).toContain('Rutin başlat');
    expect(flatText).not.toContain('Şimdi hangisi?');
    expect(flatText).not.toContain('Aktif rutinin');
    expect(flatText).toContain('Esnek Akış · bu cihazda');
    expect(flatText).toContain('Hafta Sonu · bu cihazda');

    // Check every interactive touchable in expanded picker has minHeight + hitSlop >= 44
    let fullRenderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      fullRenderer = TestRenderer.create(
        <ActiveRoutinePicker
          templates={BUILT_IN_TEMPLATES}
          activeTemplateId={null}
          hour={14}
          onStart={jest.fn()}
          onSetActive={jest.fn()}
        />,
      );
    });
    const othersBtn = fullRenderer.root.find(
      (n) => typeof n.props?.onPress === 'function' && n.props?.accessibilityLabel === 'Diğer rutinler (2)',
    );
    act(() => {
      othersBtn.props.onPress();
    });

    const pressables = fullRenderer.root.findAll(
      (n) => typeof n.props?.onPress === 'function' && n.props?.accessibilityRole === 'button' && n.props?.style,
    );
    expect(pressables.length).toBeGreaterThanOrEqual(4);
    for (const p of pressables) {
      const style = Object.assign({}, ...[p.props.style].flat(4).filter(Boolean));
      const slop = p.props.hitSlop ?? { top: 0, bottom: 0 };
      const effectiveHeight = (style.minHeight ?? 0) + (slop.top ?? 0) + (slop.bottom ?? 0);
      expect(effectiveHeight).toBeGreaterThanOrEqual(44);
    }

    act(() => {
      flatRenderer.unmount();
      fullRenderer.unmount();
    });
  });
});
