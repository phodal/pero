// Isolate renderer outputs so concurrent development builds cannot replace a benchmark.
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
  symlink,
  lstat,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, relative, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { run } from './lib/run.mjs';
import { root } from './lib/paths.mjs';
const parent = await mkdtemp(join(tmpdir(), 'pero-content-release-'));
const isolated = join(parent, 'pero');
await mkdir(isolated, { recursive: true });
const out = resolve(root, 'test-results/content-reader');
await mkdir(out, { recursive: true });
const sources = [];
const fingerprints = async (base) =>
  Object.fromEntries(
    await Promise.all(
      sources.map(async (path) => [
        path,
        createHash('sha256')
          .update(await readFile(resolve(base, path)))
          .digest('hex'),
      ]),
    ),
  );
for (const path of [
  'Cargo.toml',
  'Cargo.lock',
  'crates',
  'scripts/cargo.mjs',
  'scripts/build/apps.mjs',
  'scripts/build/reader.mjs',
  'scripts/lib',
  'patches',
  'desktop/src',
  'desktop/package.json',
  'web/src',
  'web/public',
  'web/index.html',
  'web/chat.html',
  'web/reader.html',
  'web/vite.config.ts',
  'locales',
  'protocol/generated',
  'packages/product',
  'packages/content-source',
  'packages/icons',
  'packages/app-sdk/src',
  'apps/virtual-cell',
  'tests/fixtures/acp-agent.mjs',
]) {
  await cp(resolve(root, path), resolve(isolated, path), {
    recursive: true,
    filter: async (path) => {
      if (/[\\/](node_modules|__pycache__|dist)([\\/]|$)/.test(path) ||
          /[\\/]web[\\/]src[\\/](wasm|chat-wasm|reader-wasm|content-wasm)([\\/]|$)/.test(path)) return false;
      if ((await lstat(path)).isFile()) sources.push(relative(root, path).split(sep).join('/'));
      return true;
    },
  });
}
sources.sort();
await symlink(
  resolve(root, 'node_modules'),
  join(isolated, 'node_modules'),
  'dir',
);
await mkdir(join(isolated,'target/debug'),{recursive:true});
await run(process.execPath,[resolve(isolated,'scripts/cargo.mjs'),'build','--locked','-p','pero-host'],{cwd:isolated,env:{...process.env,CARGO_TARGET_DIR:resolve(root,'target'),PERO_GPUI_KIT_PATH:process.env.PERO_GPUI_KIT_PATH||resolve(root,'../../test/gpui-kit')}});
await cp(resolve(root,'target/debug/pero-host'),join(isolated,'target/debug/pero-host'));
const before = await fingerprints(isolated);

await run(
  process.execPath,
  [
    resolve(isolated, 'scripts/cargo.mjs'),
    '+nightly-2026-10-28',
    'build',
    '--locked',
    '--release',
    '-p',
    'pero-ui',
    '-p',
    'pero-chat-web',
    '-p',
    'pero-reader-web',
    '-p',
    'pero-content-worker',
    '--target',
    'wasm32-unknown-unknown',
  ],
  {
    cwd: isolated,
    env: {
      ...process.env,
      CARGO_TARGET_DIR:resolve(root,'target'),
      PERO_GPUI_KIT_PATH: process.env.PERO_GPUI_KIT_PATH || resolve(root, '../../test/gpui-kit'),
    },
  },
);
await Promise.all(
  [
    ['pero_ui', 'wasm'],
    ['pero_chat_web', 'chat-wasm'],
    ['pero_reader_web', 'reader-wasm'],
    ['pero_content_worker', 'content-wasm'],
  ].map(async ([artifact, folder]) => {
    const directory = join(isolated, 'web/src', folder);
    await mkdir(directory, { recursive: true });
    await run(resolve(root, 'target/tools/bin/wasm-bindgen'), [
      resolve(root, `target/wasm32-unknown-unknown/release/${artifact}.wasm`),
      '--target',
      'web',
      '--out-dir',
      directory,
    ]);
    if (process.argv.includes('--functional')) return;
    const wasm = join(directory, `${artifact}_bg.wasm`);
    await run('npm', [
      'exec',
      '--yes',
      '--package=binaryen@132.0.0',
      '--',
      'wasm-opt',
      wasm,
      '-Oz',
      '--strip-debug',
      '--strip-producers',
      '-o',
      `${wasm}.optimized`,
    ]);
    const { rename } = await import('node:fs/promises');
    await rename(`${wasm}.optimized`, wasm);
  }),
);
await run(resolve(root, 'node_modules/.bin/vite'), [
  'build',
  join(isolated, 'web'),
  '--config',
  join(isolated, 'web/vite.config.ts'),
]);
if(process.argv.includes('--app-documents')) {
  await symlink(resolve(root,'apps/virtual-cell/node_modules'),join(isolated,'apps/virtual-cell/node_modules'),'dir');
  await run(process.execPath,[resolve(isolated,'scripts/build/apps.mjs'),'--app','virtual-cell','--reader-dist',join(isolated,'web/dist')],{cwd:isolated});
}
await build({
  entryPoints: {
    main: join(isolated, 'desktop/src/main/index.ts'),
    preload: join(isolated, 'desktop/src/preload/index.ts'),
  },
  outdir: join(isolated, 'desktop/dist'),
  outExtension: { '.js': '.cjs' },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: ['electron'],
});
const after = await fingerprints(isolated);
if (JSON.stringify(before) !== JSON.stringify(after))
  throw new Error(
    'Reader source changed during compilation; rerun this isolated verification.',
  );
await writeFile(
  join(out, 'source-fingerprints.json'),
  JSON.stringify({ isolated, files: after }, null, 2),
);
await writeFile(join(out, 'release-root.txt'), isolated + '\n');
if (!process.argv.includes('--build-only')) {
await run(
  process.execPath,
  [
    resolve(
      root,
      process.argv.includes('--web-documents') ? 'tests/e2e/web-documents.mjs' : process.argv.includes('--app-documents') ? 'tests/e2e/app-documents.mjs' : process.argv.includes('--file-documents') ? 'tests/e2e/file-documents.mjs' : process.argv.includes('--workspace-documents')
        ? 'tests/e2e/workspace-documents.mjs'
        : 'tests/e2e/content-reader.mjs',
    ),
    ...process.argv.slice(2),
  ],
  {
    env: {
      ...process.env,
      PERO_CONTENT_TEST_ROOT: isolated,
      PERO_CONTENT_BUILD_KIND: process.argv.includes('--functional')
        ? 'release'
        : 'release-Oz',
    },
  },
);
}
