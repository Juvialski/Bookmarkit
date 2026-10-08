import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Public HTTPS proxy URL only. Local dotenv settings must not leak into a phone build.
const backend = process.env.EXPO_PUBLIC_BOOK_API_BASE_URL || '';
if (backend && new URL(backend).protocol !== 'https:') throw new Error('Phone builds require an HTTPS book API URL');
const env = { ...process.env, CI: '1', EXPO_NO_DOTENV: '1', EXPO_PUBLIC_BOOK_API_BASE_URL: backend };
function run(command, args, cwd = process.cwd()) {
  const result = spawnSync(command, args, { cwd, env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status}`);
}
const packageBefore = readFileSync('package.json');
try {
  run(process.execPath, ['node_modules/expo/bin/cli', 'prebuild', '--platform', 'android', '--no-install', ...(process.argv.includes('--clean') ? ['--clean'] : [])]);
} finally {
  // Expo may rewrite development scripts; APK generation should leave them intact.
  writeFileSync('package.json', packageBefore);
}
const windows = process.platform === 'win32';
run(windows ? 'cmd.exe' : './gradlew', windows
  ? ['/d', '/c', 'gradlew.bat', ':app:assembleRelease', '--no-daemon', '--max-workers=2']
  : [':app:assembleRelease', '--no-daemon', '--max-workers=2'], resolve('android'));
const source = resolve('android/app/build/outputs/apk/release/app-release.apk');
if (statSync(source).size < 1_000_000) throw new Error('Release APK is unexpectedly small');
mkdirSync('dist', { recursive: true });
const target = resolve('dist/bookmarkit-android-test.apk');
copyFileSync(source, target);
const digest = createHash('sha256').update(readFileSync(target)).digest('hex');
writeFileSync(`${target}.sha256`, `${digest}  bookmarkit-android-test.apk\n`);
console.log(`Android test APK: ${target}\nSHA256: ${digest}`);
