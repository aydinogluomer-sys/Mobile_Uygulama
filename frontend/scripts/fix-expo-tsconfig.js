const fs = require('fs');
const path = require('path');

try {
  // Fix expo-web-browser tsconfig.json
  const webBrowserTsconfig = path.join(__dirname, '../node_modules/expo-web-browser/tsconfig.json');
  if (fs.existsSync(webBrowserTsconfig)) {
    const webBrowserConfig = {
      compilerOptions: {
        rootDir: '.',
        outDir: './build',
        jsx: 'react-native',
        target: 'esnext',
        moduleResolution: 'bundler',
        module: 'esnext',
        esModuleInterop: true,
        skipLibCheck: true,
        strict: true,
      },
      include: ['./src'],
      exclude: ['**/__mocks__/*', '**/__tests__/*', '**/__rsc_tests__/*'],
    };
    fs.writeFileSync(webBrowserTsconfig, JSON.stringify(webBrowserConfig, null, 2));
    console.log('✓ Fixed expo-web-browser tsconfig.json');
  }

  // Fix expo-module-scripts package.json to include exports
  const moduleScriptsPkg = path.join(__dirname, '../node_modules/expo-module-scripts/package.json');
  if (fs.existsSync(moduleScriptsPkg)) {
    const pkg = JSON.parse(fs.readFileSync(moduleScriptsPkg, 'utf8'));
    if (!pkg.exports) {
      pkg.exports = {
        './tsconfig.*': './tsconfig.*.json',
        './tsconfig': './tsconfig.json',
        './package.json': './package.json',
      };
      fs.writeFileSync(moduleScriptsPkg, JSON.stringify(pkg, null, 2));
      console.log('✓ Fixed expo-module-scripts package.json exports');
    }
  }
} catch (err) {
  console.warn('⚠ Warning: Could not apply Expo tsconfig fixes:', err.message);
  process.exit(0); // Don't fail the install
}
