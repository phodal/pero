import { cpSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { build } from 'esbuild';
const root = resolve(import.meta.dirname, '../..');
export async function stageAgentAdapters(payload) {
  // Adapters are small JavaScript bundles; neither native Agent CLI is included.
  const adapters = join(payload, 'adapters');
  mkdirSync(adapters, { recursive: true });
  for (const [name, entry, external] of [
    ['codex-acp', '@agentclientprotocol/codex-acp', []],
    ['claude-agent-acp', '@agentclientprotocol/claude-agent-acp', ['@anthropic-ai/claude-agent-sdk']],
  ]) {
    const packageRoot = resolve(root, 'node_modules', entry);
    await build({ entryPoints: [join(packageRoot, 'dist/index.js')], outfile: join(adapters, `${name}.mjs`),
      bundle: true, minify: true, platform: 'node', format: 'esm', external,
      banner: { js: "import { createRequire as packageRequire } from 'node:module'; const require = packageRequire(import.meta.url);" } });
    cpSync(join(packageRoot, 'LICENSE'), join(adapters, `${name}.LICENSE`));
  }
  const sdk = join(payload, 'node_modules/@anthropic-ai/claude-agent-sdk');
  mkdirSync(resolve(sdk, '..'), { recursive: true });
  cpSync(resolve(root, 'node_modules/@anthropic-ai/claude-agent-sdk'), sdk, { recursive: true,
    filter: path => !path.endsWith('.map') && !path.endsWith('.d.ts') });
  if (process.platform === 'win32') return;
  // Unix launchers remain available to external clients of the bundled adapters.
  const electron = process.platform === 'darwin' ? '$base/MacOS/Pero' : '$base/pero';
  writeFileSync(join(payload, 'bin/node'), '#!/bin/sh\nbase="$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)"\nexport ELECTRON_RUN_AS_NODE=1\nexec "' + electron + '" "$@"\n', { mode: 0o755 });
  mkdirSync(join(payload, 'node_modules/.bin'), { recursive: true });
  for (const [name, key, executable] of [['codex-acp', 'CODEX_PATH', 'codex'], ['claude-agent-acp', 'CLAUDE_CODE_EXECUTABLE', 'claude']]) {
    writeFileSync(join(payload, 'bin', name), `#!/bin/sh\nbase="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"\nexport ${key}="\${${key}:-${executable}}"\nexec "$base/bin/node" "$base/adapters/${name}.mjs" "$@"\n`, { mode: 0o755 });
    symlinkSync(`../../bin/${name}`, join(payload, 'node_modules/.bin', name));
  }
}
