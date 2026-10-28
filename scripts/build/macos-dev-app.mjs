// Local, unsigned development bundle so macOS can deliver pero:// links.
import { cpSync, mkdirSync, readFileSync, writeFileSync, symlinkSync, existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
const root = resolve(import.meta.dirname, '../..');
if (process.platform !== 'darwin') throw new Error('This local bundle is for macOS.');
const output = resolve(root, 'target/local/Pero.app');
mkdirSync(resolve(root, 'target/local'), { recursive: true });
// Only this disposable generated bundle is replaced; source and user settings are outside it.
rmSync(output, { recursive: true, force: true });
cpSync(resolve(root, 'node_modules/electron/dist/Electron.app'), output, { recursive: true, verbatimSymlinks: true });
const plist = resolve(output, 'Contents/Info.plist');
let content = readFileSync(resolve(root, 'node_modules/electron/dist/Electron.app/Contents/Info.plist'), 'utf8');
content = content.replace('<string>com.github.Electron</string>', '<string>com.openpero.desktop.dev</string>')
  .replace(/(<key>CFBundle(?:DisplayName|Name)<\/key>\s*)<string>Electron<\/string>/g, '$1<string>Pero</string>')
  .replace('</dict>\n</plist>', `<key>CFBundleURLTypes</key><array><dict><key>CFBundleURLName</key><string>Pero Desktop</string><key>CFBundleURLSchemes</key><array><string>pero</string></array></dict></array></dict>\n</plist>`);
writeFileSync(plist, content);
const app = resolve(output, 'Contents/Resources/app');
if (!existsSync(app)) symlinkSync(resolve(root, 'desktop'), app, 'dir');
execFileSync('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', output], { stdio: 'pipe' });
console.log(output);
