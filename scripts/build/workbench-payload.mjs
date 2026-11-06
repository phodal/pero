// Shared workbench payload for native Electron distributions.
import { cpSync, mkdirSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { stageBuiltinApp, deduplicatePayload } from './builtin-app-payload.mjs';
import { stageAgentAdapters } from './agent-adapters.mjs';
const root = resolve(import.meta.dirname, '../..');

export function stageWorkbenchWeb(source, destination) {
  cpSync(source, destination, { recursive: true });
  // Workbench uses ChatPanel inside its existing runtime. Only App Products
  // load the separate Chat page; keep shared locale chunks for Workbench.
  rmSync(join(destination, 'chat.html'), { force: true });
  for (const name of readdirSync(join(destination, 'assets'))) {
    if (name.startsWith('chat-') || name.startsWith('pero_chat_web_bg-')) rmSync(join(destination, 'assets', name));
  }
}

export async function stageWorkbench(payload, product) {
  mkdirSync(join(payload, 'desktop/dist'), { recursive: true });
  mkdirSync(join(payload, 'bin'), { recursive: true });
  cpSync(resolve(root, 'desktop/dist'), join(payload, 'desktop/dist'), { recursive: true });
  stageWorkbenchWeb(resolve(root, 'web/dist'), join(payload, 'web/dist'));
  // GPUI embeds these fonts in Wasm; Vite's public copy is unused duplication.
  const fonts = join(payload, 'web/dist/fonts');
  for (const name of readdirSync(fonts)) {
    if (/\.(ttf|otf|woff2?)$/.test(name) || name === '.fonts-stamp.json') rmSync(join(fonts, name));
  }
  writeFileSync(join(payload, 'package.json'), JSON.stringify({ name: 'openpero', version: product.version, main: 'desktop/dist/main.cjs' }));
  cpSync(resolve(root, 'node_modules/electron/LICENSE'), join(payload, 'Electron.LICENSE'));
  cpSync(resolve(root, 'node_modules/electron/dist/LICENSES.chromium.html'), join(payload, 'LICENSES.chromium.html'));
  await stageWorkbenchRuntime(payload, product);
}

export async function stageWorkbenchRuntime(payload, product, node) {
  mkdirSync(payload, { recursive: true });
  cpSync(resolve(root, "web/public/licenses/scientific-math.txt"), join(payload, "Scientific-Math-NOTICE.txt"));
  mkdirSync(join(payload, 'bin'), { recursive: true });
  for (const appName of product.apps) stageBuiltinApp(resolve(root, 'apps', appName), appName, join(payload, 'apps', appName));
  const host = process.platform === 'win32' ? 'pero-host.exe' : 'pero-host';
  cpSync(resolve(root, 'target/release', host), join(payload, 'bin', host));
  const worker = process.platform === 'win32' ? 'pero-worker.exe' : 'pero-worker';
  cpSync(resolve(root, 'target/release', worker), join(payload, 'bin', worker));
  const computer = process.platform === 'win32' ? 'pero-computer.exe' : 'pero-computer';
  cpSync(resolve(root, 'target/release', computer), join(payload, 'bin', computer));
  cpSync(resolve(root, 'target/release/computer-source.json'), join(payload, 'bin/computer-source.json'));
  cpSync(resolve(root, 'use/computer/NOTICE.md'), join(payload, 'Computer-Use-NOTICE.md'));
  const connectors = process.platform === 'win32' ? 'pero-connector-worker.exe' : 'pero-connector-worker';
  cpSync(resolve(root, 'target/release', connectors), join(payload, 'bin', connectors));
  cpSync(resolve(root, 'packages/connectors/helpers'), join(payload, 'packages/connectors/helpers'), { recursive: true });
  cpSync(resolve(root, 'use/connectors/NOTICE.md'), join(payload, 'Connectors-NOTICE.md'));
  if (process.platform === 'darwin') {
    for (const binary of [host, worker, computer, connectors]) execFileSync('/usr/bin/strip', ['-x', join(payload, 'bin', binary)]);
  }
  await stageAgentAdapters(payload, node);
  deduplicatePayload(payload);
}
