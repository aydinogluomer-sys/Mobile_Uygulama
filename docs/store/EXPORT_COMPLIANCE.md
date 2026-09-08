# Export Compliance — Technical Finding

**Result: `USES_NO_OR_ONLY_EXEMPT_ENCRYPTION`**

This is an engineering finding about what the binary contains. It is **not
legal advice**, and no `ITSEncryptionExportComplianceCode` has been invented.

## What was looked for

| Category | Found |
|---|---|
| Custom/proprietary cryptography implemented by the app | None |
| Crypto libraries (CryptoJS, node-forge, tweetnacl, libsodium, bcrypt, jose) | None |
| Custom TLS implementation | None |
| VPN / tunnelling in the shipped app | None |
| Cryptographic algorithms authored in app code | None |

Method: the full 39-entry runtime dependency list was read, and the whole
`.ts`/`.tsx` source tree was searched for `crypto.subtle`, `require('crypto')`,
`CryptoJS`, `node-forge`, `tweetnacl`, `libsodium`, `bcrypt`, `AES`, `RSA`,
`createCipher` and `pbkdf2`. The only hit is a **comment** in
`__tests__/edge/aiIdempotency.test.ts` describing the Deno edge function's
server-side fingerprint hash. That code runs on Supabase, not in the app, and
is not part of the submitted binary.

## What the app does use

- **HTTPS/TLS provided by the operating system**, via `@supabase/supabase-js`
  over `fetch`. Standard, and the ordinary exemption case.
- `expo-web-browser` and `react-native-webview` hand URLs to the OS
  browser/webview, which use OS TLS.

## Note on `@expo/ngrok`

`@expo/ngrok` appears in `dependencies` rather than `devDependencies`. It is a
**development tunnel** used by `expo start --tunnel`. No application code
imports it, so Metro never puts it in the JS bundle and it is not present in the
shipped app. Recorded here because "tunnelling" is an export-compliance
question and the honest answer is "present in the toolchain, absent from the
binary". Moving it to `devDependencies` is a hygiene improvement deliberately
not made during a store-configuration pass, to avoid churning the lockfile that
CI's `npm ci` depends on.

## Declaration set on that basis

`app.json` → `ios.infoPlist.ITSAppUsesNonExemptEncryption = false`

If the owner later adds any of: end-to-end encryption, an encrypted local
database, a custom crypto library, or a VPN feature — this finding must be
redone before the next submission.
