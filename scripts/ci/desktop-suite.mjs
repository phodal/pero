// Explicit coverage manifest: no path filters or optional/skipped acceptance.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
export const suites = Object.freeze({
  workbench: ['workbench'], toolcalls: ['toolcalls'], data: ['data'], 'data-product': ['data-product'],
  'control-lab': ['control-lab'], 'control-lab-app-use': ['control-lab-app-use'], 'control-lab-live': ['control-lab-live'],
  'virtual-cell-comparison': ['virtual-cell-comparison'], 'virtual-cell-dataset-download': ['virtual-cell-dataset-download'],
  'app-use': ['app-use'], 'app-use-workbench': ['app-use-workbench'],
  'mcp-lifecycle': ['mcp-settings', '--scenario', 'lifecycle'],
  'mcp-persistence': ['mcp-settings', '--scenario', 'persistence'],
  'mcp-transport': ['mcp-settings', '--scenario', 'transport'],
});
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const name = process.argv[2];
  if (!Object.hasOwn(suites, name)) throw new Error(`Unknown acceptance suite: ${name}`);
  const [script, ...args] = suites[name];
  const env = { ...process.env };
  if (name.startsWith('control-lab')) env.PERO_APP_PYTHON = resolve(process.env.RUNNER_TEMP, 'control-lab-python/bin/python');
  if (name === 'control-lab-live') {
    const agent = resolve('target/debug/pero-agent-acp');
    Object.assign(env, { PERO_CONTROL_LAB_REAL_MODEL: '1', PERO_CONTROL_LAB_LOCAL_FIXTURE: '1',
      PERO_CONTROL_LAB_LIVE_SCENE: 'p-golden', PERO_CONTROL_LAB_LIVE_AGENT: agent,
      PERO_CONTROL_LAB_LIVE_AGENT_SHA256: createHash('sha256').update(readFileSync(agent)).digest('hex'),
      PERO_CONTROL_LAB_LIVE_RESERVATION: '6', DEEPSEEK_API_KEY: 'local-control-lab-fixture' });
  }
  // A deadline diagnoses a stuck test; it does not turn the ten-minute goal into a timeout.
  const result = spawnSync(process.execPath, ['scripts/ci/run-acceptance.mjs', '--name', name, '--timeout-seconds', '360', '--',
    'xvfb-run', '-a', '-s', '-screen 0 1920x1200x24', process.execPath, `tests/e2e/${script}.mjs`, ...args], { env, stdio: 'inherit' });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
