// ACP launcher used only by the opt-in Control Lab acceptance. Every process
// reserves its entire provider limit in the same durable ledger before launch.
// Arguments identify local, non-secret test resources; credentials stay in env.
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { reserveAttempts } from './attempt-ledger.mjs';
import { providerEndpoint } from './live-config.mjs';

const root = resolve(import.meta.dirname, '../../..');
const [agent, expectedHash, sessions, reservation, mode, fixtureEndpoint, fixtureLedger] = process.argv.slice(2);
const fixture = mode === 'fixture';
const ledger = fixture ? fixtureLedger : resolve(root, 'test-results/control-lab-live/attempt-ledger.json');
const count = Number(reservation);
try {
  if (!((mode === 'real' && process.argv.length === 7) || (fixture && process.argv.length === 9)) || !isAbsolute(agent) || !isAbsolute(sessions) ||
      !/^[a-f0-9]{64}$/.test(expectedHash) || !Number.isInteger(count) || count < 1 || count > 6 ||
      !process.env.DEEPSEEK_API_KEY)
    throw new Error('Invalid live-agent configuration');
  const endpoint = providerEndpoint({ fixture, key: process.env.DEEPSEEK_API_KEY,
    endpoint: fixtureEndpoint, ledger, outputRoot: resolve(root, 'test-results/control-lab-live') });
  const hash = createHash('sha256').update(await readFile(agent)).digest('hex');
  if (hash !== expectedHash) throw new Error('Agent binary hash mismatch');
  await reserveAttempts(ledger, count);
  const child = spawn(agent, ['--endpoint', endpoint, '--model', 'deepseek-chat',
    '--session-dir', sessions, '--api-key-env', 'DEEPSEEK_API_KEY', '--max-requests', String(count),
    '--max-tokens', '8192', '--max-retries', '0', '--disable-thinking',
    '--http-attempt-audit', `${ledger}.attempts`,
    '--skills-root', resolve(root, 'apps/control-lab/skills')], { stdio: 'inherit' });
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => child.kill(signal));
  child.on('error', () => { process.stderr.write('Failed to launch live ACP agent\n'); process.exitCode = 1; });
  child.on('exit', (code, signal) => { process.exitCode = signal ? 1 : (code ?? 1); });
} catch (error) {
  process.stderr.write(`Live ACP agent refused: ${error.message}\n`);
  process.exitCode = 1;
}
