import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync, existsSync } from 'node:fs';
import { resolve, join, sep, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
import { Product } from '../../packages/product/product.ts';
import { readAppBundle, stageAppBundle } from './app-bundle.mjs';
import { stageAgentAdapters } from './agent-adapters.mjs';
const root = resolve(import.meta.dirname, '../..');
const args = process.argv.slice(2);
const option = flag => {
  if (!args.includes(flag)) return undefined;
  const value = args[args.indexOf(flag) + 1];
  if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}`);
  return value;
};
const name = option('--product');
if (!option('--config') && (!name || !/^[a-z0-9-]+$/.test(name))) throw new Error('Use --product name or --config /external/product.json');
const config = option('--config') ? resolve(option('--config')) : resolve(root, 'products', name, 'product.json');
const product = Product.parse(JSON.parse(readFileSync(config, 'utf8')));
const icon = product.icon ? resolve(dirname(config), product.icon) : undefined;
if (icon && !existsSync(icon)) throw new Error(`Product icon missing: ${icon}`);
if (product.shell !== 'app') throw new Error('Use the existing package:macos command for the workbench');
const output = resolve(option('--output') || resolve(root, 'target/products', name || product.id));
const external = new Map();
for (let index = 0; index < args.length; index++) {
  if (args[index] !== '--app-bundle') continue;
  const directory = args[++index];
  if (!directory || directory.startsWith('--')) throw new Error('Missing directory for --app-bundle');
  const input = readAppBundle(directory);
  if (!product.apps.includes(input.bundle.name) || external.has(input.bundle.name)) throw new Error('AppBundle must match one included App exactly once');
  external.set(input.bundle.name, input);
}
const inputs = product.apps.map(app => {
  const input = external.get(app);
  const source = input?.root || resolve(root, 'apps', app);
  // Never clear a caller's App source or overwrite files inside an input bundle.
  if (source === output || source.startsWith(output + sep) || output.startsWith(source + sep) ||
    root === output || root.startsWith(output + sep)) throw new Error('Product output overlaps source directories');
  const manifest = input?.manifest || JSON.parse(readFileSync(resolve(source, 'app.json'), 'utf8'));
  if (manifest.name !== app || (app === product.entry.app && !manifest.contributes.panels.some(panel => panel.id === product.entry.panel))) throw new Error(`Product entry does not exist in ${app}`);
  if (manifest.backend?.type === 'node' && !product.node) throw new Error(`App ${app} requires an explicit Product node policy`);
  return { app, input };
});
// Check runtime inputs before building or clearing an existing distribution.
const runtimes = [];
for (const [kind, policy, executable] of [['python', product.python, 'python3'], ['node', product.node, 'node']]) {
  if (policy !== 'bundled') continue;
  const directory = option(`--${kind}`) || process.env[`PERO_PRODUCT_${kind.toUpperCase()}_ROOT`];
  if (!directory || !existsSync(resolve(directory, 'bin', executable))) throw new Error(`Bundled ${kind} requires --${kind} /path/to/relocatable/runtime (including licenses)`);
  const source = resolve(directory);
  if (source === output || source.startsWith(output + sep) || output.startsWith(source + sep)) throw new Error('Product output overlaps runtime input');
  runtimes.push({ kind, executable, source });
}
for (const { app, input } of inputs) {
  if (!input) execFileSync(process.execPath, [resolve(root, 'scripts/build/apps.mjs'), '--app', app], { stdio: 'inherit' });
}
execFileSync(process.execPath, [resolve(root, 'scripts/cargo.mjs'), 'build', '--release', '--locked', '-p', 'pero-host', '-p', 'pero-worker'], { stdio: 'inherit' });
if (product.chat) {
  execFileSync(process.execPath, [resolve(root, 'scripts/build/computer.mjs'), '--release'], { stdio: 'inherit' });
  execFileSync(process.execPath, [resolve(root, 'scripts/build/wasm.mjs'), '--chat-only'], { stdio: 'inherit' });
  execFileSync(process.execPath, [resolve(root, 'node_modules/vite/bin/vite.js'), 'build', '--outDir', resolve(root, 'web/dist-chat')], {
    cwd: resolve(root, 'web'), stdio: 'inherit', env: { ...process.env, PERO_CHAT_ONLY: '1' },
  });
}
rmSync(output, { recursive: true, force: true });
mkdirSync(join(output, 'desktop/dist'), { recursive: true });
mkdirSync(join(output, 'bin'), { recursive: true });
await build({ entryPoints: { product: resolve(root, 'desktop/src/main/product.ts'), 'product-preload': resolve(root, 'desktop/src/product/preload.ts') }, outdir: join(output, 'desktop/dist'), outExtension: { '.js': '.cjs' }, bundle: true, platform: 'node', format: 'cjs', external: ['electron'] });
const script = await build({ entryPoints: [resolve(root, 'desktop/src/product/shell.ts')], bundle: true, platform: 'browser', format: 'iife', write: false, minify: true });
const style = readFileSync(resolve(root, 'desktop/src/product/shell.css'), 'utf8');
writeFileSync(join(output, 'desktop/dist/product.html'), `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${style}</style></head><body><script>${script.outputFiles[0].text}</script></body></html>`);
if (icon) {
  mkdirSync(dirname(join(output, product.icon)), { recursive: true });
  cpSync(icon, join(output, product.icon));
}
if (existsSync(resolve(root, 'desktop/dist/release.json'))) cpSync(resolve(root, 'desktop/dist/release.json'), join(output, 'desktop/dist/release.json'));
writeFileSync(join(output, 'product.json'), JSON.stringify(product, null, 2));
writeFileSync(join(output, 'package.json'), JSON.stringify({ name: name || product.entry.app, version: product.version, main: 'desktop/dist/product.cjs' }));
const host = process.platform === 'win32' ? 'pero-host.exe' : 'pero-host';
cpSync(resolve(root, 'target/release', host), join(output, 'bin', host));
if (product.chat) {
  cpSync(resolve(root, 'target/release', process.platform === 'win32' ? 'pero-computer.exe' : 'pero-computer'), join(output, 'bin', process.platform === 'win32' ? 'pero-computer.exe' : 'pero-computer'));
  cpSync(resolve(root, 'target/release/computer-source.json'), join(output, 'bin/computer-source.json'));
  cpSync(resolve(root, 'use/computer/NOTICE.md'), join(output, 'Computer-Use-NOTICE.md'));
  cpSync(resolve(root, 'web/dist-chat'), join(output, 'web/chat'), { recursive: true });
  // The Chat Wasm embeds its fonts. Avoid shipping Vite's duplicate public copy.
  rmSync(join(output, 'web/chat/fonts'), { recursive: true, force: true });
  await stageAgentAdapters(output);
}
for (const { app, input } of inputs) {
  if (input) {
    stageAppBundle(input, join(output, 'apps', app));
    continue;
  }
  for (const entry of ['app.json', 'dist', 'backend', 'examples', 'evidence', 'THIRD_PARTY_NOTICES.md', 'README.md', 'licenses']) {
    const source = resolve(root, 'apps', app, entry);
    if (existsSync(source)) cpSync(source, join(output, 'apps', app, entry), { recursive: true, filter: path => !path.includes('__pycache__') });
  }
}
for (const { kind, executable, source } of runtimes) {
  const destination = join(output, 'runtime', kind);
  cpSync(source, destination, { recursive: true, verbatimSymlinks: true });
  const check = kind === 'python' ? ['-I', '-c', 'import json, http.server, ssl; print("Bundled Python ready")'] : ['--version'];
  execFileSync(join(destination, 'bin', executable), check, { stdio: 'inherit', env: { PATH: '/usr/bin:/bin' } });
}
console.log(`Product staged: ${output}`);
if (args.includes('--package')) execFileSync(process.execPath, [resolve(root, 'scripts/build/macos-package.mjs')], { stdio: 'inherit', env: { ...process.env, PERO_PRODUCT_PAYLOAD: output } });
