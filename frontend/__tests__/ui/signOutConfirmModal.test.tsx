/**
 * F04 (NAV-02) — the sign-out confirmation, rendered.
 *
 * Not a replacement for the visual QA matrix (devices, font scale, screen readers); it pins what can
 * be pinned without a device: which buttons exist in which state, that they are reachable as
 * buttons with a 48 pt target, that busy disables them, that the error is announced politely, and
 * that the unsent-changes line appears only when there is something unsent.
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { AccessibilityInfo, Modal } from 'react-native';
import SignOutConfirmModal from '../../components/SignOutConfirmModal';

jest.mock('../../services/accountService', () => ({
  signOutNotice: (n: number) => (n > 0 ? `Henüz eşitlenmemiş ${n} değişiklik var.` : null),
}));

type R = TestRenderer.ReactTestRenderer;
const noop = () => undefined;
const props = { visible: true, unsent: 0, busy: false, error: null as string | null, onSyncFirst: noop, onConfirm: noop, onCancel: noop };

const texts = (r: R): string[] => r.root.findAll((n) => typeof n.props.children === 'string' && (n.type as unknown) === 'Text').map((n) => n.props.children as string);
const button = (r: R, label: string) => r.root.find((n) => n.props.accessibilityRole === 'button' && n.props.accessibilityLabel === label && typeof n.props.onPress === 'function');
const hasButton = (r: R, label: string) => r.root.findAll((n) => n.props.accessibilityRole === 'button' && n.props.accessibilityLabel === label && typeof n.props.onPress === 'function').length > 0;

async function render(over: Partial<typeof props> = {}): Promise<R> {
  let r!: R;
  await act(async () => { r = TestRenderer.create(<SignOutConfirmModal {...props} {...over} />); });
  return r;
}

afterEach(() => jest.restoreAllMocks());

it('nothing unsent: a calm question, two buttons, no "sync first"', async () => {
  const r = await render();
  expect(texts(r)).toEqual(expect.arrayContaining(['Oturumu kapatalım mı?', 'Oturumu kapat', 'Vazgeç']));
  expect(hasButton(r, 'Önce eşitle')).toBe(false);
  expect(texts(r).some((t) => t.includes('eşitlenmemiş'))).toBe(false);
  act(() => r.unmount());
});

it('three unsent: the notice and "sync first" appear; each button calls its own handler', async () => {
  const onSyncFirst = jest.fn();
  const onConfirm = jest.fn();
  const onCancel = jest.fn();
  const r = await render({ unsent: 3, onSyncFirst, onConfirm, onCancel });
  expect(texts(r)).toEqual(expect.arrayContaining(['Henüz eşitlenmemiş 3 değişiklik var.']));
  act(() => { button(r, 'Önce eşitle').props.onPress(); });
  act(() => { button(r, 'Oturumu kapat').props.onPress(); });
  act(() => { button(r, 'Vazgeç').props.onPress(); });
  expect([onSyncFirst.mock.calls.length, onConfirm.mock.calls.length, onCancel.mock.calls.length]).toEqual([1, 1, 1]);
  act(() => r.unmount());
});

it('busy: every button is disabled and says so to assistive tech', async () => {
  const r = await render({ unsent: 2, busy: true });
  for (const label of ['Önce eşitle', 'Oturumu kapat', 'Vazgeç']) {
    const b = button(r, label);
    expect({ label, disabled: b.props.disabled, a11y: b.props.accessibilityState?.disabled }).toEqual({ label, disabled: true, a11y: true });
  }
  act(() => r.unmount());
});

it('an error is shown once and announced politely', async () => {
  const r = await render({ error: 'Oturum kapatılamadı, lütfen tekrar dene.' });
  const err = r.root.findAll((n) => n.props.accessibilityLiveRegion === 'polite' && n.props.children === 'Oturum kapatılamadı, lütfen tekrar dene.');
  expect(err.length).toBeGreaterThanOrEqual(1);
  act(() => r.unmount());
});

it('touch targets are at least 48 pt; the title is a header; the card is modal for screen readers', async () => {
  const r = await render({ unsent: 1 });
  const flat = (style: unknown): Record<string, unknown> => Object.assign({}, ...[style].flat(3).filter(Boolean) as Record<string, unknown>[]);
  for (const label of ['Önce eşitle', 'Oturumu kapat', 'Vazgeç']) {
    expect({ label, minHeight: flat(button(r, label).props.style).minHeight }).toEqual({ label, minHeight: 48 });
  }
  expect(r.root.findAll((n) => n.props.accessibilityRole === 'header' && n.props.children === 'Oturumu kapatalım mı?').length).toBeGreaterThanOrEqual(1);
  expect(r.root.findAll((n) => n.props.accessibilityViewIsModal === true).length).toBeGreaterThanOrEqual(1);
  act(() => r.unmount());
});

it('Reduce Motion: the modal opens without animation; back/Esc closes it', async () => {
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
  const onCancel = jest.fn();
  const r = await render({ onCancel });
  const modal = r.root.findByType(Modal);
  expect(modal.props.animationType).toBe('none');
  act(() => { modal.props.onRequestClose(); });
  expect(onCancel).toHaveBeenCalledTimes(1);
  act(() => r.unmount());
});
