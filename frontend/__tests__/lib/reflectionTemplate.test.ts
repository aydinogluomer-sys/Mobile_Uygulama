import {
  REFLECTION_DISCLAIMER,
  REFLECTION_FIELDS,
  REFLECTION_FIELD_MAX,
  appendBlock,
  emptyReflection,
  formatReflection,
  hasReflectionText,
} from '../../lib/reflectionTemplate';

describe('F37 — lib/reflectionTemplate', () => {
  it('(+) formats all three populated fields in order and collapses newlines/whitespace', () => {
    const out = formatReflection({
      happened: '  Toplantı   uzadı\nve yoruldum. ',
      thought: 'Yetiştiremeyeceğim\r\ndiye düşündüm.',
      alternative: 'Bir adımını bugün, kalanını yarın yapabilirim.',
    });
    expect(out).toBe(
      [
        'Ne oldu: Toplantı uzadı ve yoruldum.',
        'Aklımdan geçen: Yetiştiremeyeceğim diye düşündüm.',
        'Başka nasıl bakabilirim: Bir adımını bugün, kalanını yarın yapabilirim.',
      ].join('\n'),
    );
  });

  it('(+) skips empty fields, clamps each field to 500 chars, and returns empty string when all blank', () => {
    expect(
      formatReflection({
        happened: '   ',
        thought: 'Sadece bu alan dolu',
        alternative: '\n\t ',
      }),
    ).toBe('Aklımdan geçen: Sadece bu alan dolu');

    expect(formatReflection(emptyReflection())).toBe('');
    expect(
      formatReflection({
        happened: '   ',
        thought: '\n',
        alternative: '\t',
      }),
    ).toBe('');

    const longFormatted = formatReflection({
      happened: 'k'.repeat(600),
      thought: '',
      alternative: '',
    });
    expect(longFormatted).toBe(`Ne oldu: ${'k'.repeat(REFLECTION_FIELD_MAX)}`);
  });

  it('(+) hasReflectionText is false for empty/whitespace-only drafts and true when any field has text', () => {
    expect(hasReflectionText(emptyReflection())).toBe(false);
    expect(hasReflectionText({ happened: '  ', thought: '\n', alternative: '\t' })).toBe(false);
    expect(hasReflectionText({ happened: '', thought: '', alternative: 'küçük bir adım' })).toBe(true);
  });

  it('(+) appendBlock handles empty content, trims trailing whitespace before \\n\\n, and ignores empty block', () => {
    expect(appendBlock('', 'Ne oldu: Yağmur')).toBe('Ne oldu: Yağmur');
    expect(appendBlock('   \n ', 'Ne oldu: Yağmur')).toBe('Ne oldu: Yağmur');
    expect(appendBlock('Sabah kahvesi.  \n\n ', 'Ne oldu: Yağmur')).toBe(
      'Sabah kahvesi.\n\nNe oldu: Yağmur',
    );
    expect(appendBlock('Mevcut metin', '')).toBe('Mevcut metin');
  });

  it('(-) enforces exact non-clinical disclaimer and bans clinical/diagnostic/scoring terms in fields', () => {
    expect(REFLECTION_DISCLAIMER).toBe('Bu bir yansıtma aracıdır, terapi değildir.');
    const clinicalPattern =
      /tedavi|teşhis|tanı\b|klinik|depresyon|anksiyete|bozukluk|iyileştir|şifa|ilaç|DEHB|ADHD|puan|skor|eşik|terapi/i;
    for (const field of REFLECTION_FIELDS) {
      expect(field.label).not.toMatch(clinicalPattern);
      expect(field.placeholder).not.toMatch(clinicalPattern);
    }
  });
});
