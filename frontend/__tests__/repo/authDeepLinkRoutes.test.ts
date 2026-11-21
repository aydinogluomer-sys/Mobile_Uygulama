import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { PUBLIC_SITE_URLS_LIVE } from '../../lib/featureGates';
import { stripComments } from '../helpers/sourceText';

const FRONTEND = join(__dirname, '..', '..');
const raw = (rel: string) => readFileSync(join(FRONTEND, rel), 'utf8');
const code = (rel: string) => stripComments(raw(rel));

function walkTsFiles(dirs: string[]): { rel: string; code: string; raw: string }[] {
  const out: { rel: string; code: string; raw: string }[] = [];
  const visit = (dir: string) => {
    const absDir = join(FRONTEND, dir);
    if (!existsSync(absDir)) return;
    for (const entry of readdirSync(absDir)) {
      if (entry === 'node_modules' || entry === '__tests__' || entry.startsWith('.')) continue;
      const rel = `${dir}/${entry}`;
      const abs = join(FRONTEND, rel);
      if (statSync(abs).isDirectory()) visit(rel);
      else if (/\.tsx?$/.test(entry)) {
        const r = raw(rel);
        out.push({ rel, raw: r, code: stripComments(r) });
      }
    }
  };
  for (const d of dirs) visit(d);
  return out;
}

describe('F22 derin bağlantı rotaları, tek oturum tüketicisi ve SPA rewrite kuralları', () => {
  it('(+) hedef auth rotaları ve app.json şema/SPA çıktı ayarları mevcuttur', () => {
    expect(existsSync(join(FRONTEND, 'app/(auth)/reset-password.tsx'))).toBe(true);
    expect(existsSync(join(FRONTEND, 'app/(auth)/login.tsx'))).toBe(true);

    const appJson = JSON.parse(raw('app.json')) as {
      expo: { scheme: string; web: { output: string } };
    };
    expect(appJson.expo.scheme).toBe('atlas');
    expect(appJson.expo.web.output).toBe('single');
  });

  it('(+) frontend/vercel.json geçerli JSON olup yalnızca SPA rewrite kuralını içerir (GAP2-09)', () => {
    expect(existsSync(join(FRONTEND, 'vercel.json'))).toBe(true);
    const vercelText = raw('vercel.json');
    const parsed = JSON.parse(vercelText) as Record<string, unknown>;
    expect(Object.keys(parsed)).toEqual(['rewrites']);
    expect(parsed.rewrites).toEqual([{ source: '/(.*)', destination: '/index.html' }]);
  });

  it('(+) lib/supabase.ts detectSessionInUrl: false kullanır ve e-posta akışları yönlendirme adresi taşır', () => {
    const supa = code('lib/supabase.ts');
    expect(supa).toContain('detectSessionInUrl: false');

    const register = code('app/(auth)/register.tsx');
    const signUpAt = register.indexOf('supabase.auth.signUp(');
    const resendAt = register.indexOf('supabase.auth.resend(');
    expect(signUpAt).toBeGreaterThan(-1);
    expect(resendAt).toBeGreaterThan(-1);
    expect(register.slice(signUpAt, register.indexOf('});', signUpAt) + 3)).toContain('emailRedirectTo');
    expect(register.slice(resendAt, register.indexOf('});', resendAt) + 3)).toContain('emailRedirectTo');

    const login = code('app/(auth)/login.tsx');
    const loginResendAt = login.indexOf('supabase.auth.resend(');
    expect(loginResendAt).toBeGreaterThan(-1);
    expect(login.slice(loginResendAt, login.indexOf('});', loginResendAt) + 3)).toContain('emailRedirectTo');

    const forgot = code('app/(auth)/forgot-password.tsx');
    expect(forgot).toContain('redirectTo: recoveryRedirectUrl()');
  });

  it('(+) authDeepLink.ts içindeki rota adları gerçek dosya adlarıyla eşleşir ve recovery şablonu korunur', () => {
    const deepLink = code('lib/authDeepLink.ts');
    for (const routeName of ['reset-password', 'login']) {
      expect(deepLink).toContain(`'${routeName}'`);
      expect(existsSync(join(FRONTEND, `app/(auth)/${routeName}.tsx`))).toBe(true);
    }

    const recoveryTemplate = raw('supabase-password-recovery-template.html');
    expect(recoveryTemplate).toContain('{{ .Token }}');
    expect(recoveryTemplate).toContain('href="{{ .ConfirmationURL }}"');
  });

  it('(-) vercel.json alan adı, https:// ya da headers içermez; PUBLIC_SITE_URLS_LIVE false kalır', () => {
    const vercelText = raw('vercel.json');
    expect(vercelText).not.toContain('aderyth.com');
    expect(vercelText).not.toContain('https://');
    expect(vercelText).not.toContain('"headers"');
    expect(PUBLIC_SITE_URLS_LIVE).toBe(false);
  });

  it('(-) app/ ve components/ altında setSession, exchangeCodeForSession ve token_hash kullanılmaz (GAP2-08)', () => {
    const uiFiles = walkTsFiles(['app', 'components']);
    expect(uiFiles.length).toBeGreaterThan(60);

    // Member calls only (`supabase.auth.setSession(`): the root layout's React state setter
    // `setSession(session)` is a different thing and must not count.
    const offenders = uiFiles
      .filter((f) => /\.setSession\s*\(|\.exchangeCodeForSession\s*\(|\btoken_hash\b/.test(f.code))
      .map((f) => f.rel);
    expect(offenders).toEqual([]);

    // The scan itself is checked: a screen that spends a link by itself is caught.
    const synthetic = "await supabase.auth.setSession({ access_token: a, refresh_token: b });";
    expect(/\.setSession\s*\(/.test(synthetic)).toBe(true);
    expect(/\.setSession\s*\(/.test('setSession(session);')).toBe(false);
  });

  it('(-) detectSessionInUrl: Platform.OS === "web" hiçbir kaynak dosyada kalmamıştır ve yeni dosyalarda eski marka adı geçmez', () => {
    const allFiles = walkTsFiles(['app', 'components', 'lib', 'hooks', 'services', 'store', 'repositories']);
    const detectOffenders = allFiles
      .filter((f) => /detectSessionInUrl\s*:\s*Platform\.OS/.test(f.code))
      .map((f) => f.rel);
    expect(detectOffenders).toEqual([]);

    const newFiles = [
      'lib/authErrors.ts',
      'lib/authDeepLink.ts',
      'hooks/useResendCooldown.ts',
      'components/auth/PasswordToggle.tsx',
    ];
    for (const rel of newFiles) {
      expect(existsSync(join(FRONTEND, rel))).toBe(true);
      expect(raw(rel)).not.toMatch(/Atlas/i);
    }
  });
});
