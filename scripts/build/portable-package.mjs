// Native Linux/Windows portable packages; macOS retains its signed App/DMG builder.
import { cpSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { Product } from '../../packages/product/product.ts';
import { stageWorkbench } from './workbench-payload.mjs';

if (!['linux', 'win32'].includes(process.platform)) throw new Error('Use package:macos on macOS.');
const root = resolve(import.meta.dirname, '../..');
const product = Product.parse(JSON.parse(readFileSync(resolve(root, 'products/pero.json'), 'utf8')));
const platform = process.platform === 'win32' ? 'windows' : 'linux';
const name = `Pero-${platform}-${process.arch}`;
const destination = resolve(root, 'target/package');
const output = join(destination, name);
mkdirSync(destination, { recursive: true });
rmSync(output, { recursive: true, force: true });
cpSync(resolve(root, 'node_modules/electron/dist'), output, { recursive: true, verbatimSymlinks: true });
rmSync(join(output, 'resources/default_app.asar'), { force: true });
renameSync(join(output, process.platform === 'win32' ? 'electron.exe' : 'electron'), join(output, process.platform === 'win32' ? 'Pero.exe' : 'pero'));
await stageWorkbench(join(output, 'resources/app'), product);
// Keep Unix executable modes/symlinks in tar; Windows users extract the ZIP and run Pero.exe.
const archive = join(destination, name + (process.platform === 'win32' ? '.zip' : '.tar.gz'));
rmSync(archive, { force: true });
if (process.platform === 'win32') execFileSync(join(process.env.SystemRoot, 'System32', 'tar.exe'), ['-a', '-cf', archive, '-C', destination, name], { stdio: 'inherit' });
else execFileSync('tar', ['-czf', archive, '-C', destination, name], { stdio: 'inherit' });
console.log(`Portable package: ${archive}`);
