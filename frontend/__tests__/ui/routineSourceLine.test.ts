/**
 * R09.06 — "Yerel şablon fallback'i AI cevabı gibi sunma." The routine
 * preview names its source: a ready-made pack is the app's own template (no
 * AI, no FP), never presented as an AI answer.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '../helpers/sourceText';

jest.mock('../../lib/supabase', () => ({ supabase: {} }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));

import { sourceLine } from '../../components/AIRoutineModal';

it('each source says what it is; only the AI one says AI produced it', () => {
  expect(sourceLine('pack')).toBe('Hazır paket — uygulamanın kendi şablonu; AI üretmedi, FP harcanmadı.');
  expect(sourceLine('coach')).toMatch(/^Koçun önerisi/);
  expect(sourceLine('ai')).toMatch(/^AI önerisi/);
  expect(sourceLine('pack')).not.toMatch(/^AI/);
});

it('the preview renders the source line from the store\'s proposalSource', () => {
  const src = stripComments(readFileSync(join(__dirname, '..', '..', 'components', 'AIRoutineModal.tsx'), 'utf8'));
  const preview = src.slice(src.indexOf('{showPreview ? ('));
  expect(preview.slice(0, 800)).toMatch(/accessibilityLabel="Önerinin kaynağı">\{sourceLine\(proposalSource\)\}<\/Text>/);
  expect(src).toMatch(/\n {4}proposalSource,\n {2}\} = useRoutineStore\(\);/);
});
