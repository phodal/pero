#!/usr/bin/env node
// The one GitHub CLI seam for contribution e2e. Git/checkout/commit/push remain real.
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const args = process.argv.slice(2);
const base = process.env.CONTRIBUTION_FIXTURE_STATE;
const fork = process.env.CONTRIBUTION_FIXTURE_FORK;
if (!base || !fork) throw new Error('GitHub fixture requires an explicit isolated environment');
appendFileSync(base + '.calls', JSON.stringify(args) + '\n');
const out = text => process.stdout.write(text + '\n');
if (args[0] === '--version') {
  if (existsSync(base + '.missing')) process.exit(1);
  out('gh contribution-fixture');
}
else if (args[0] === 'auth' && args[1] === 'status') {
  if (existsSync(base + '.unauthenticated')) process.exit(1);
  out('Authenticated fixture account');
} else if (args[0] === 'api' && args[1] === 'user') out('alice');
else if (args[0] === 'repo' && args[1] === 'fork') {
  if (JSON.stringify(args.slice(2)) !== JSON.stringify(['--remote', '--remote-name', 'origin'])) throw new Error('Fork must resolve the prepared local repository');
  if (execFileSync('git', ['config', '--get', 'remote.upstream.gh-resolved'], { encoding: 'utf8' }).trim() !== 'base') throw new Error('Fork source is not fixed to upstream');
  const remotes = execFileSync('git', ['remote'], { encoding: 'utf8' }).trim().split('\n');
  if (!remotes.includes('origin')) execFileSync('git', ['remote', 'add', 'origin', fork]);
  out('Created isolated fixture fork');
} else if (args[0] === 'pr' && args[1] === 'list') out(existsSync(base + '.pr') ? readFileSync(base + '.pr', 'utf8').trim() : '');
else if (args[0] === 'pr' && args[1] === 'create') {
  const field = name => args[args.indexOf(name) + 1];
  if (!args.includes('--draft') || field('--repo') !== 'acme/repo') throw new Error('Unexpected publication target');
  const body = readFileSync(field('--body-file'), 'utf8');
  if (!body.includes('\n\nSource: https://github.com/acme/repo/issues/9')) throw new Error('PR body lost source or newlines');
  writeFileSync(base + '.body', body);
  const url = 'https://github.com/acme/repo/pull/17';
  writeFileSync(base + '.pr', url);
  out(url);
} else {
  process.stderr.write(`Unsupported fixture gh command: ${args.slice(0, 2).join(' ')}\n`);
  process.exit(2);
}
