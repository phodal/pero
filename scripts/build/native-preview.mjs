// Development preview: retains the compiled-in checkout for local ACP adapters.
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { writeIcns } from '../lib/macos-icon.mjs';
const root = resolve(import.meta.dirname, '../..');
if (process.platform !== 'darwin') throw new Error('This preview bundle is for macOS.');
const app = resolve(root, 'target/native/Pero Native.app');
rmSync(app, { recursive: true, force: true });
mkdirSync(resolve(app, 'Contents/MacOS'), { recursive: true });
cpSync(resolve(root, 'target/release/pero-native'), resolve(app, 'Contents/MacOS/pero-native'));
writeIcns(resolve(root, 'resources/app-icon.svg'), resolve(app, 'Contents/Resources/AppIcon.icns'));
writeFileSync(resolve(app, 'Contents/Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>com.openpero.native-preview</string>
<key>CFBundleName</key><string>Pero Native</string>
<key>CFBundleDisplayName</key><string>Pero Native Preview</string>
<key>CFBundleExecutable</key><string>pero-native</string>
<key>CFBundleIconFile</key><string>AppIcon.icns</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleVersion</key><string>1</string>
<key>CFBundleShortVersionString</key><string>0.1.0</string>
<key>NSHighResolutionCapable</key><true/>
<key>CFBundleURLTypes</key><array><dict>
<key>CFBundleURLName</key><string>Pero Desktop</string>
<key>CFBundleURLSchemes</key><array><string>pero</string></array>
</dict></array>
</dict></plist>`);
execFileSync('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'pipe' });
console.log(app);
