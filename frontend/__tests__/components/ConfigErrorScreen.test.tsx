/**
 * F08 (BLD-02) — the calm screen a build without its public Supabase configuration shows.
 * Names only, never values; no button (the error is in the build, "try again" would be empty).
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import ConfigErrorScreen, { CONFIG_ERROR_BODY, CONFIG_ERROR_TITLE } from '../../components/ConfigErrorScreen';

type R = TestRenderer.ReactTestRenderer;

const texts = (r: R): string[] =>
  r.root
    .findAll((n) => typeof n.props.children === 'string' && (n.type as unknown) === 'Text')
    .map((n) => n.props.children as string);

let errorSpy: jest.SpyInstance;
beforeEach(() => {
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => errorSpy.mockRestore());

async function render(props: React.ComponentProps<typeof ConfigErrorScreen>): Promise<R> {
  let r!: R;
  await act(async () => {
    r = TestRenderer.create(<ConfigErrorScreen {...props} />);
  });
  return r;
}

it('(+) shows the title, the calm body and the missing names, announced as an alert', async () => {
  const r = await render({ missing: ['EXPO_PUBLIC_SUPABASE_URL', 'EXPO_PUBLIC_SUPABASE_ANON_KEY'] });
  expect(texts(r)).toEqual([
    'Yapılandırma eksik',
    'Bu sürüm gerekli ayarlar olmadan oluşturulmuş. Uygulamayı güncellemeyi dene; sorun sürerse bize bildir.',
    'EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_ANON_KEY',
  ]);
  expect(CONFIG_ERROR_TITLE).toBe('Yapılandırma eksik');
  expect(CONFIG_ERROR_BODY).toContain('sorun sürerse bize bildir');
  expect(r.root.findAll((n) => n.props.accessibilityRole === 'alert').length).toBeGreaterThan(0);
  expect(errorSpy).toHaveBeenCalledWith('[config] Eksik ortam değişkeni: EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_ANON_KEY');
  act(() => r.unmount());
});

it('(-) renders only variable NAMES: a value smuggled in as a prop or in the list is never shown', async () => {
  const secret = 'https://leak-me.supabase.co sb_publishable_SECRET';
  const props = { missing: ['EXPO_PUBLIC_SUPABASE_URL', secret], value: secret } as unknown as React.ComponentProps<
    typeof ConfigErrorScreen
  >;
  const r = await render(props);
  const all = JSON.stringify(r.toJSON());
  expect(all).toContain('EXPO_PUBLIC_SUPABASE_URL');
  expect(all).not.toContain('leak-me');
  expect(all).not.toContain('SECRET');
  expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('leak-me');
  act(() => r.unmount());
});

it('(-) has no button or any pressable control', async () => {
  const r = await render({ missing: ['EXPO_PUBLIC_SUPABASE_ANON_KEY'] });
  expect(r.root.findAll((n) => n.props.accessibilityRole === 'button')).toHaveLength(0);
  expect(r.root.findAll((n) => typeof n.props.onPress === 'function')).toHaveLength(0);
  act(() => r.unmount());
});
