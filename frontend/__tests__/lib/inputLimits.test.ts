import {
  MAX_REFLECTION_CHARS,
  MAX_URL_CHARS,
  URL_PROBLEM_TR,
  checkHttpUrl,
} from '../../lib/inputLimits';

describe('inputLimits — reflection & HTTP URL bounds (GAP1-14)', () => {
  it('defines canonical character ceilings and calm Turkish problem messages', () => {
    expect(MAX_REFLECTION_CHARS).toBe(2000);
    expect(MAX_URL_CHARS).toBe(2048);
    expect(URL_PROBLEM_TR.too_long.length).toBeGreaterThan(5);
    expect(URL_PROBLEM_TR.bad_scheme.length).toBeGreaterThan(5);
    expect(URL_PROBLEM_TR.malformed.length).toBeGreaterThan(5);
  });

  it('accepts empty strings, valid http/https URLs, schemeless domains, and 2048-char URLs', () => {
    expect(checkHttpUrl('')).toEqual({ ok: true, url: null });
    expect(checkHttpUrl('   ')).toEqual({ ok: true, url: null });
    expect(checkHttpUrl('https://ornek.com/a')).toEqual({
      ok: true,
      url: 'https://ornek.com/a',
    });
    expect(checkHttpUrl('http://ornek.com/kitap?b=1#ozet')).toEqual({
      ok: true,
      url: 'http://ornek.com/kitap?b=1#ozet',
    });
    expect(checkHttpUrl('ornek.com/x')).toEqual({
      ok: true,
      url: 'https://ornek.com/x',
    });

    const prefix = 'https://ornek.com/';
    const maxLenUrl = prefix + 'a'.repeat(MAX_URL_CHARS - prefix.length);
    expect(maxLenUrl).toHaveLength(2048);
    expect(checkHttpUrl(maxLenUrl)).toEqual({ ok: true, url: maxLenUrl });
  });

  it('rejects dangerous/non-http schemes, oversize URLs, missing hosts, and embedded whitespace', () => {
    expect(checkHttpUrl('javascript:alert(1)')).toEqual({
      ok: false,
      problem: 'bad_scheme',
    });
    expect(checkHttpUrl('ftp://x.com')).toEqual({
      ok: false,
      problem: 'bad_scheme',
    });
    expect(checkHttpUrl('data:text/html,<h1>x</h1>')).toEqual({
      ok: false,
      problem: 'bad_scheme',
    });

    const overLenUrl = 'https://ornek.com/' + 'a'.repeat(MAX_URL_CHARS);
    expect(overLenUrl.length).toBeGreaterThan(2048);
    expect(checkHttpUrl(overLenUrl)).toEqual({
      ok: false,
      problem: 'too_long',
    });

    expect(checkHttpUrl('http://')).toEqual({
      ok: false,
      problem: 'malformed',
    });
    expect(checkHttpUrl('https://')).toEqual({
      ok: false,
      problem: 'malformed',
    });
    expect(checkHttpUrl('https://ornek.com/bosluk var')).toEqual({
      ok: false,
      problem: 'malformed',
    });
    expect(checkHttpUrl('sadecekelime')).toEqual({
      ok: false,
      problem: 'malformed',
    });
  });
});
