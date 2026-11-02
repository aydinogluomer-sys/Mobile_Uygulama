/**
 * F06 (NAV-04) — the onboarding gate has a way out.
 *
 * Before F06 "Tekrar dene" was its only control: a user whose session could not be read, or who
 * opened the app for the first time without a connection, could not leave it. Now a session
 * problem leads with "Tekrar giriş yap", a connection problem keeps "Tekrar dene" first with
 * "Oturumu kapat" beside it, and both reach the F04 sign-out through `onSignOut`.
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import OnboardingGate, { classifyGateError } from '../../components/onboarding/OnboardingGate';
import BootGate from '../../components/BootGate';

jest.setTimeout(30_000); // the first render of the ui barrel alone takes ~2 s on this machine

type R = TestRenderer.ReactTestRenderer;
const noop = () => undefined;

const texts = (r: R): string[] =>
  r.root.findAll((n) => typeof n.props.children === 'string' && (n.type as unknown) === 'Text').map((n) => n.props.children as string);
/** One node per button: the touchable passes the same props to an inner node, so only the outermost match counts. */
const buttons = (r: R) => {
  const all = r.root.findAll((n) => n.props.accessibilityRole === 'button' && typeof n.props.onPress === 'function' && typeof n.props.accessibilityLabel === 'string');
  const inside = (n: TestRenderer.ReactTestInstance): boolean => {
    for (let p = n.parent; p; p = p.parent) if (all.includes(p)) return true;
    return false;
  };
  return all.filter((n) => !inside(n));
};
const button = (r: R, label: string) => {
  const found = buttons(r).filter((n) => n.props.accessibilityLabel === label);
  expect({ label, count: found.length }).toEqual({ label, count: 1 });
  return found[0];
};

async function render(props: Partial<React.ComponentProps<typeof OnboardingGate>> = {}): Promise<R> {
  let r!: R;
  await act(async () => {
    r = TestRenderer.create(<OnboardingGate error="TypeError: Network request failed" onRetry={noop} {...props} />);
  });
  return r;
}

it('(+) a connection problem: "Tekrar dene" first, "Oturumu kapat" beside it, each wired to its handler', async () => {
  const onRetry = jest.fn();
  const onSignOut = jest.fn();
  const r = await render({ onRetry, onSignOut });
  expect(buttons(r).map((b) => b.props.accessibilityLabel)).toEqual(['Tekrar dene', 'Oturumu kapat']);
  expect(texts(r)).toEqual(expect.arrayContaining(['Hesabın hazırlanamadı']));
  act(() => { button(r, 'Oturumu kapat').props.onPress(); });
  act(() => { button(r, 'Tekrar dene').props.onPress(); });
  expect([onSignOut.mock.calls.length, onRetry.mock.calls.length]).toEqual([1, 1]);
  act(() => r.unmount());
});

it('(+) "Oturum bulunamadı.": "Tekrar giriş yap" signs out, "Tekrar dene" retries', async () => {
  const onRetry = jest.fn();
  const onSignOut = jest.fn();
  const r = await render({ error: 'Oturum bulunamadı.', onRetry, onSignOut });
  expect(buttons(r).map((b) => b.props.accessibilityLabel)).toEqual(['Tekrar giriş yap', 'Tekrar dene']);
  expect(texts(r)).toEqual(expect.arrayContaining(['Oturumunu yenilemek gerekiyor']));
  act(() => { button(r, 'Tekrar giriş yap').props.onPress(); });
  expect(onSignOut).toHaveBeenCalledTimes(1);
  expect(onRetry).not.toHaveBeenCalled();
  act(() => { button(r, 'Tekrar dene').props.onPress(); });
  expect(onRetry).toHaveBeenCalledTimes(1);
  act(() => r.unmount());
});

it('(+) while signing out both buttons are disabled, and say so to assistive tech', async () => {
  for (const error of ['TypeError: Network request failed', 'Oturum bulunamadı.']) {
    const r = await render({ error, onSignOut: noop, signingOut: true });
    const all = buttons(r);
    expect(all).toHaveLength(2);
    for (const b of all) {
      expect({ label: b.props.accessibilityLabel, disabled: b.props.disabled, a11y: b.props.accessibilityState?.disabled })
        .toEqual({ label: b.props.accessibilityLabel, disabled: true, a11y: true });
    }
    act(() => r.unmount());
  }
});

it('(-) without onSignOut there is no sign-out button (as before F06)', async () => {
  for (const error of ['TypeError: Network request failed', 'Oturum bulunamadı.', null]) {
    const r = await render({ error });
    expect(buttons(r).map((b) => b.props.accessibilityLabel)).toEqual(['Tekrar dene']);
    act(() => r.unmount());
  }
});

it('(+) the title is a header, the error box is a polite live region, every button has a role, a label and a hint', async () => {
  const r = await render({ onSignOut: noop });
  expect(r.root.findAll((n) => n.props.accessibilityRole === 'header' && (n.type as unknown) === 'Text')).toHaveLength(1);
  expect(r.root.findAll((n) => n.props.accessibilityLiveRegion === 'polite').length).toBeGreaterThanOrEqual(1);
  for (const b of buttons(r)) {
    expect(b.props.accessibilityRole).toBe('button');
    expect(b.props.accessibilityLabel).toBeTruthy();
    expect(b.props.accessibilityHint).toBeTruthy();
  }
  expect(texts(r)).toEqual(expect.arrayContaining(['TypeError: Network request failed']));
  act(() => r.unmount());
});

it('the copy is calm: no exclamation mark, no blame', async () => {
  for (const error of ['TypeError: Network request failed', 'Oturum bulunamadı.']) {
    const r = await render({ error, onSignOut: noop });
    const shown = texts(r).filter((t) => t !== error).join(' ');
    expect(shown).not.toMatch(/!/);
    expect(shown).not.toMatch(/hata yaptın|suçun|başarısız oldun/i);
    act(() => r.unmount());
  }
});

describe('classifyGateError', () => {
  it.each([
    ['Oturum bulunamadı.', 'session'],
    ['Çevrimdışısın; oturum bağlantı gelince yenilenecek.', 'network'],
    ['Network request failed', 'network'],
    ['TypeError: Failed to fetch', 'network'],
    ['Sunucuya ulaşılamadı.', 'network'],
    ['permission denied', 'other'],
    ['JWT expired', 'other'],
  ] as const)('%s -> %s', (error, kind) => {
    expect(classifyGateError(error)).toBe(kind);
  });

  it('null -> network', () => {
    expect(classifyGateError(null)).toBe('network');
  });
});

describe('BootGate (F06: a boot that runs long, a build without configuration)', () => {
  it('stalled: a calm header and one "Tekrar dene" with a hint, wired to onRetry', async () => {
    const onRetry = jest.fn();
    let r!: R;
    await act(async () => { r = TestRenderer.create(<BootGate variant="stalled" onRetry={onRetry} />); });
    expect(texts(r)).toEqual(expect.arrayContaining(['Açılış beklenenden uzun sürüyor', 'Bağlantın yavaş olabilir. Yazdıkların kaybolmadı.']));
    expect(r.root.findAll((n) => n.props.accessibilityRole === 'header' && (n.type as unknown) === 'Text')).toHaveLength(1);
    const all = buttons(r);
    expect(all.map((b) => b.props.accessibilityLabel)).toEqual(['Tekrar dene']);
    expect(all[0].props.accessibilityHint).toBe('Açılışı yeniden başlatır.');
    act(() => { all[0].props.onPress(); });
    expect(onRetry).toHaveBeenCalledTimes(1);
    act(() => r.unmount());
  });

  it('config: the detail, and no button (nothing the user can do fixes it)', async () => {
    let r!: R;
    await act(async () => { r = TestRenderer.create(<BootGate variant="config" detail="EXPO_PUBLIC_SUPABASE_URL ve EXPO_PUBLIC_SUPABASE_ANON_KEY tanımlı değil." />); });
    expect(texts(r)).toEqual(expect.arrayContaining(['Uygulama yapılandırması eksik', 'EXPO_PUBLIC_SUPABASE_URL ve EXPO_PUBLIC_SUPABASE_ANON_KEY tanımlı değil.']));
    expect(buttons(r)).toHaveLength(0);
    act(() => r.unmount());
  });
});
