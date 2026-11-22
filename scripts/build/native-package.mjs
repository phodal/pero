// Portable macOS GPUI bundle. The builder accepts a verified official Node runtime.
import { cpSync, mkdirSync, readFileSync, writeFileSync, rmSync, statSync, existsSync, mkdtempSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { Product } from '../../packages/product/product.ts';
import { stageWorkbenchRuntime } from './workbench-payload.mjs';
import { writeIcns } from '../lib/macos-icon.mjs';
import { createMacOSDmg } from '../lib/macos-dmg.mjs';
import { signNativeCode, stageComputerApp } from './computer-app.mjs';
const root = resolve(import.meta.dirname, '../..');
if (process.platform !== 'darwin') throw new Error('Native packaging requires macOS.');
const runtime = process.env.PERO_NATIVE_NODE_ROOT;
if (!runtime || !existsSync(join(runtime, 'bin/node')) || !existsSync(join(runtime, 'LICENSE'))) throw new Error('Set PERO_NATIVE_NODE_ROOT to the verified official Node runtime.');
const product = Product.parse(JSON.parse(readFileSync(join(root, 'products/pero.json'), 'utf8')));
const directory = join(root, 'target/native-package');
const app = join(directory, 'Pero Native.app');
rmSync(app, { recursive: true, force: true });
mkdirSync(join(app, 'Contents/MacOS'), { recursive: true });
const payload = join(app, 'Contents/Resources/app');
await stageWorkbenchRuntime(payload, product, join(runtime, 'bin/node'));
mkdirSync(join(payload, 'products'), { recursive: true });
cpSync(join(root, 'products/pero.json'), join(payload, 'products/pero.json'));
cpSync(join(runtime, 'LICENSE'), join(payload, 'Node.LICENSE'));
if (existsSync(join(root, 'desktop/dist/release.json'))) {
  mkdirSync(join(payload, 'desktop/dist'), { recursive: true });
  cpSync(join(root, 'desktop/dist/release.json'), join(payload, 'desktop/dist/release.json'));
}
cpSync(join(root, 'target/release/pero-native'), join(app, 'Contents/MacOS/pero-native'));
const icon = join(app, 'Contents/Resources/AppIcon.icns');
writeIcns(join(root, 'resources/app-icon.svg'), icon);
const signingIdentity = process.env.PERO_MACOS_SIGN_IDENTITY || '-';
const bundledWorker = join(payload, 'bin/pero-computer');
const helper = join(directory, 'Pero Computer Use.app');
stageComputerApp(helper, bundledWorker, {
  identifier: 'com.openpero.computer-use', version: product.version, icon, signingIdentity,
});
rmSync(bundledWorker);
writeFileSync(join(app, 'Contents/Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>com.openpero.native</string>
<key>CFBundleName</key><string>Pero Native</string>
<key>CFBundleDisplayName</key><string>Pero Native</string>
<key>CFBundleExecutable</key><string>pero-native</string>
<key>CFBundleIconFile</key><string>AppIcon.icns</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>${product.version}</string>
<key>CFBundleVersion</key><string>1</string>
<key>NSHighResolutionCapable</key><true/>
<key>CFBundleURLTypes</key><array><dict><key>CFBundleURLName</key><string>Pero Native</string><key>CFBundleURLSchemes</key><array><string>pero</string></array></dict></array>
</dict></plist>`);
execFileSync('/usr/bin/plutil', ['-lint', join(app, 'Contents/Info.plist')], { stdio: 'inherit' });
signNativeCode(app, signingIdentity);
execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', app], { stdio: 'pipe' });
const archive = join(directory, `Pero-Native-macos-${process.arch}.dmg`);
// Both apps must be siblings on disk. Screen Capture can attribute a nested
// executable to the outer app even when Accessibility uses the nested identity.
const staging = mkdtempSync(join(directory, '.image-'));
try {
  cpSync(app, join(staging, 'Pero Native.app'), { recursive: true, verbatimSymlinks: true });
  cpSync(helper, join(staging, 'Pero Computer Use.app'), { recursive: true, verbatimSymlinks: true });
  createMacOSDmg(staging, 'Pero Native', archive);
} finally {
  rmSync(staging, { recursive: true, force: true });
}
writeFileSync(join(directory, 'size.json'), JSON.stringify({ app, helper, dmg: archive, dmgBytes: statSync(archive).size, bundledNode: '22.23.4', bundledAgentCLIs: false }, null, 2) + '\n');
console.log(archive);
