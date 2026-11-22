// macOS permission identity for the same Rust Computer Use worker.
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

export function stageComputerApp(bundle, binary, { identifier, version, icon, signingIdentity = '-' }) {
  const macos = join(bundle, 'Contents/MacOS');
  rmSync(bundle, { recursive: true, force: true });
  mkdirSync(macos, { recursive: true });
  cpSync(binary, join(macos, 'pero-computer'));
  if (icon) {
    mkdirSync(join(bundle, 'Contents/Resources'), { recursive: true });
    cpSync(icon, join(bundle, 'Contents/Resources/AppIcon.icns'));
  }
  const plist = join(bundle, 'Contents/Info.plist');
  writeFileSync(plist, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>${identifier}</string>
<key>CFBundleName</key><string>Pero Computer Use</string>
<key>CFBundleDisplayName</key><string>Pero Computer Use</string>
<key>CFBundleExecutable</key><string>pero-computer</string>
${icon ? '<key>CFBundleIconFile</key><string>AppIcon.icns</string>' : ''}
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>${version}</string>
<key>CFBundleVersion</key><string>1</string>
<key>LSUIElement</key><true/>
<key>NSAccessibilityUsageDescription</key><string>Pero Computer Use reads and operates the application window selected in your Pero conversation.</string>
<key>NSScreenCaptureUsageDescription</key><string>Pero Computer Use captures the application window selected in your Pero conversation.</string>
</dict></plist>`);
  execFileSync('/usr/bin/plutil', ['-lint', plist]);
  signNativeCode(bundle, signingIdentity);
  execFileSync('/usr/bin/codesign', ['--verify', '--strict', bundle]);
}

export function signNativeCode(path, identity) {
  const release = identity === '-' ? [] : ['--options', 'runtime', '--timestamp'];
  execFileSync('/usr/bin/codesign', ['--force', '--sign', identity, ...release, path], { stdio: 'pipe' });
}
