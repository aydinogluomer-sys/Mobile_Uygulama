import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));

import PasswordToggle from '../../components/auth/PasswordToggle';

describe('PasswordToggle — 44x44 pt dokunma hedefi, rol ve dinamik etiket (DSA-03)', () => {
  it('(+) gizli durumda "Şifreyi göster" etiketi, button rolü, 44x44 boyut ve eye-outline simgesi sunar', async () => {
    const onToggle = jest.fn();
    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(<PasswordToggle visible={false} onToggle={onToggle} />);
    });

    const btn = tree.root.findAll(
      (n) => n.props?.accessibilityRole === 'button' && typeof n.props?.onPress === 'function',
    )[0];
    expect(btn.props.accessibilityLabel).toBe('Şifreyi göster');
    const style = Object.assign({}, ...[btn.props.style].flat(3).filter(Boolean));
    expect(style.minWidth).toBeGreaterThanOrEqual(44);
    expect(style.minHeight).toBeGreaterThanOrEqual(44);

    const icon = tree.root.findByType('Ionicons' as never);
    expect(icon.props.name).toBe('eye-outline');
    expect(icon.props.size).toBe(20);

    await act(async () => { btn.props.onPress(); });
    expect(onToggle).toHaveBeenCalledTimes(1);
    await act(async () => { tree.unmount(); });
  });

  it('(+) görünür durumda özel showLabel/hideLabel ile "Şifre tekrarını gizle" ve eye-off-outline sunar', async () => {
    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(
        <PasswordToggle
          visible
          onToggle={() => {}}
          showLabel="Şifre tekrarını göster"
          hideLabel="Şifre tekrarını gizle"
        />,
      );
    });

    const btn = tree.root.findAll(
      (n) => n.props?.accessibilityRole === 'button' && typeof n.props?.onPress === 'function',
    )[0];
    expect(btn.props.accessibilityLabel).toBe('Şifre tekrarını gizle');
    const icon = tree.root.findByType('Ionicons' as never);
    expect(icon.props.name).toBe('eye-off-outline');
    await act(async () => { tree.unmount(); });
  });

  it('(-) kendi içinde durum tutmaz; üst bileşen visible değiştirmeden etiket değişmez', async () => {
    const onToggle = jest.fn();
    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(<PasswordToggle visible={false} onToggle={onToggle} />);
    });
    const btn = tree.root.findAll(
      (n) => n.props?.accessibilityRole === 'button' && typeof n.props?.onPress === 'function',
    )[0];
    await act(async () => { btn.props.onPress(); });
    expect(btn.props.accessibilityLabel).toBe('Şifreyi göster');
    await act(async () => { tree.unmount(); });
  });
});
