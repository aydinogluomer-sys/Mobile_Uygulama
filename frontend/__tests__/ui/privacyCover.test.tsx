/**
 * R06.05 — "Mevcut hassas içerik gizleme tercihlerini bildirim ve uygulama
 * önizlemesine uygula." The "hide titles" preference now also covers the
 * app-switcher preview; off, nothing changes.
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { AppState } from 'react-native';
import * as fs from 'fs';
import * as path from 'path';

const mockSettings = { hideTitles: true };
jest.mock('../../services/reminderService', () => ({
  loadReminderSettings: jest.fn(async () => ({ quietStart: null, quietEnd: null, hideTitles: mockSettings.hideTitles })),
}));

import PrivacyCover, { shouldCover } from '../../components/PrivacyCover';

let listener: ((s: string) => void) | null = null;
beforeEach(() => {
  listener = null;
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((_e: string, fn: (s: string) => void) => { listener = fn; return { remove: () => undefined }; }) as never);
});
afterEach(() => jest.restoreAllMocks());

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

it('the rule: cover only with the preference on and the app not in front', () => {
  expect(shouldCover(true, 'inactive')).toBe(true);
  expect(shouldCover(true, 'background')).toBe(true);
  expect(shouldCover(true, 'active')).toBe(false);
  expect(shouldCover(false, 'background')).toBe(false);
});

it('preference on: covered while switching away, gone when back', async () => {
  mockSettings.hideTitles = true;
  let r!: TestRenderer.ReactTestRenderer;
  await act(async () => { r = TestRenderer.create(<PrivacyCover />); });
  await flush();
  expect(r.toJSON()).toBeNull();
  await act(async () => { listener!('inactive'); });
  await flush();
  expect(JSON.stringify(r.toJSON())).toMatch(/Aderyth/);
  await act(async () => { listener!('active'); });
  expect(r.toJSON()).toBeNull();
});

it('preference off: never covered', async () => {
  mockSettings.hideTitles = false;
  let r!: TestRenderer.ReactTestRenderer;
  await act(async () => { r = TestRenderer.create(<PrivacyCover />); });
  await act(async () => { listener!('background'); });
  await flush();
  expect(r.toJSON()).toBeNull();
});

it('is mounted once, at the root, above every screen', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../app/_layout.tsx'), 'utf8');
  expect((src.match(/<PrivacyCover \/>/g) ?? []).length).toBe(1);
});
