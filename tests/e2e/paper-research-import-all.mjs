// Broad deterministic UI states, then the actual Desktop/Host/Paper persistence path.
await import('./paper-research-import.mjs');
await import('./paper-research-import-host.mjs');

// Separate authorized observation, not a fixture assertion or scientific acceptance gate.
import { spawnSync } from 'node:child_process';
if (process.env.PERO_RESEARCH_LIVE_METADATA === '1') {
  const observed = spawnSync(process.env.PERO_APP_PYTHON || 'python3', [
    'apps/paper-agent/test/manual/research_metadata.py', '--allow-public-metadata',
    '--output', 'test-results/research-import/live-metadata.json',
  ], { stdio: 'inherit', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
  if (observed.error) throw observed.error;
  if (observed.status !== 0) throw new Error(`Metadata observation process failed (${observed.status})`);
}
