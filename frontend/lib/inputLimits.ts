/**
 * Free-text and HTTP URL bounds for review reflections and reading-list links.
 * Uses pure regular expressions rather than global `URL` (incomplete in React Native).
 * (F14; GAP1-14)
 */

export const MAX_REFLECTION_CHARS = 2000;
export const MAX_URL_CHARS = 2048;

export type UrlProblem = 'too_long' | 'bad_scheme' | 'malformed';

export type UrlCheck =
  | { ok: true; url: string | null }
  | { ok: false; problem: UrlProblem };

export const URL_PROBLEM_TR: Readonly<Record<UrlProblem, string>> = {
  too_long: 'Bağlantı çok uzun (en çok 2048 karakter).',
  bad_scheme: 'Yalnız web bağlantıları (http veya https) eklenebilir.',
  malformed: 'Geçerli bir web adresi yaz, örn. https://ornek.com',
};

const EXPLICIT_SCHEME_SLASHES_RE = /^([A-Za-z][A-Za-z0-9+.-]*):\/\//;
const NON_HTTP_COLON_SCHEME_RE = /^(?!https?:\/\/)[A-Za-z][A-Za-z0-9+-]*:(?![0-9]+(?:[/?#]|$))/i;
const HTTP_AUTHORITY_RE = /^https?:\/\/([^/?#]+)([/?#][\s\S]*)?$/i;

function isValidHost(host: string): boolean {
  if (!host || host.startsWith('.') || host.endsWith('.') || host.includes('..')) {
    return false;
  }
  if (host.toLowerCase() === 'localhost') return true;
  if (!host.includes('.')) return false;
  const labels = host.split('.');
  if (labels.some((lbl) => !lbl || lbl.startsWith('-') || lbl.endsWith('-'))) {
    return false;
  }
  const tld = labels[labels.length - 1];
  return tld.length >= 2 && !/^\d+$/.test(tld);
}

/** Empty -> { ok: true, url: null }. Schemeless "ornek.com/x" -> "https://ornek.com/x". Only http/https. */
export function checkHttpUrl(raw: string): UrlCheck {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: true, url: null };
  if (trimmed.length > MAX_URL_CHARS) {
    return { ok: false, problem: 'too_long' };
  }
  if (/[\s\u0000-\u001F\u007F]/.test(trimmed)) {
    return { ok: false, problem: 'malformed' };
  }

  const slashScheme = EXPLICIT_SCHEME_SLASHES_RE.exec(trimmed);
  if (slashScheme) {
    const scheme = slashScheme[1].toLowerCase();
    if (scheme !== 'http' && scheme !== 'https') {
      return { ok: false, problem: 'bad_scheme' };
    }
  } else if (NON_HTTP_COLON_SCHEME_RE.test(trimmed)) {
    return { ok: false, problem: 'bad_scheme' };
  }

  const candidate = slashScheme ? trimmed : `https://${trimmed}`;
  if (candidate.length > MAX_URL_CHARS) {
    return { ok: false, problem: 'too_long' };
  }

  const parsed = HTTP_AUTHORITY_RE.exec(candidate);
  if (!parsed) {
    return { ok: false, problem: 'malformed' };
  }

  const authority = parsed[1];
  if (authority.includes('@')) {
    return { ok: false, problem: 'malformed' };
  }

  const hostPort = /^([^:]+)(?::(\d{1,5}))?$/.exec(authority);
  if (!hostPort || !isValidHost(hostPort[1])) {
    return { ok: false, problem: 'malformed' };
  }
  if (hostPort[2] !== undefined) {
    const port = Number(hostPort[2]);
    if (port < 1 || port > 65535) {
      return { ok: false, problem: 'malformed' };
    }
  }

  return { ok: true, url: candidate };
}
