// Pages and Release admit a commit only from master push CI.
// Push runs the Linux CI gate. Schedule and manual CI run the full desktop
// matrix. Those classes are not interchangeable: a pending or failed full run
// does not veto a successful Linux push, and a full success is not a Linux
// push. The release workflow's own package smoke remains the packaging
// guarantee; daily full acceptance is not a publish precondition.
// A newer push that is still running, red, or cancelled does veto an older
// successful push. workflow_run types:[completed] fires again when that push
// later completes, including after it was pending and on re-runs.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rejectedConclusions = new Set(['failure', 'cancelled', 'timed_out', 'startup_failure', 'action_required', 'skipped', 'stale', 'neutral']);
const linuxPushJob = 'Linux CI gate';
const shaPattern = /^[0-9a-f]{40}$/;

/** Dispatch publication is the four native packages. Virtual Cell stays a canary. */
export const dispatchReleaseArchives = Object.freeze([
  'Pero-macos-arm64.dmg',
  'Pero-Native-macos-arm64.dmg',
  'Pero-linux-x64.tar.gz',
  'Pero-windows-x64.zip',
]);

function reject(reason, extra = {}) {
  return { ok: false, reason, ...extra };
}

function linuxPushSource(source, { repository, trustedBranch }) {
  if (source.event !== 'push') return reject('untrusted-event');
  if (!source.headRepository || source.headRepository !== repository) return reject('untrusted-repository');
  if (source.headBranch !== trustedBranch) return reject('untrusted-branch');
  return { ok: true };
}

function byNewest(left, right) {
  const time = run => Date.parse(run.createdAt || '') || 0;
  return time(right) - time(left) || Number(right.id) - Number(left.id);
}

/**
 * @param {{
 *   repository: string,
 *   targetSha: string,
 *   policy?: 'linux-push',
 *   trustedBranch?: string,
 *   trigger?: { event: string, headSha: string, headBranch: string, headRepository: string, status: string, conclusion: string | null } | null,
 *   runs?: Array<{ id: number, headSha: string, event: string, headBranch: string, headRepository: string, status: string, conclusion: string | null, createdAt: string, jobs?: Array<{ name: string, status: string, conclusion: string | null }> }>
 * }} input
 */
export function decideDeployment({ repository, targetSha, policy = 'linux-push', trustedBranch = 'master', trigger = null, runs = [] }) {
  if (policy !== 'linux-push') return reject('unknown-policy');
  if (!shaPattern.test(targetSha ?? '')) return reject('invalid-sha');
  if (trigger) {
    const triggerSource = linuxPushSource(trigger, { repository, trustedBranch });
    if (!triggerSource.ok) return triggerSource;
    if (trigger.headSha !== targetSha) return reject('wrong-sha');
    if (trigger.status !== 'completed') return reject('pending');
    if (trigger.conclusion !== 'success') return reject(rejectedConclusions.has(trigger.conclusion) ? trigger.conclusion : 'failure');
  }
  // The triggering run may not be listed yet. It still cannot outvote a newer
  // trusted run for the same SHA.
  const observed = trigger?.id && !runs.some(run => run.id === trigger.id)
    ? [...runs, {
        id: trigger.id, headSha: trigger.headSha, event: trigger.event, headBranch: trigger.headBranch,
        headRepository: trigger.headRepository, status: trigger.status, conclusion: trigger.conclusion,
        createdAt: trigger.createdAt || '', jobs: trigger.jobs,
      }]
    : runs;
  const trusted = observed.filter(run => run.headSha === targetSha && linuxPushSource(run, { repository, trustedBranch }).ok);
  if (!trusted.length) return reject('missing');
  if (trusted.some(run => run.status !== 'completed')) return reject('pending');
  const latest = [...trusted].sort(byNewest)[0];
  if (latest.conclusion !== 'success') return reject(rejectedConclusions.has(latest.conclusion) ? latest.conclusion : 'failure');
  if (!latest.jobs) return { ok: false, reason: 'needs-jobs', sha: targetSha, candidateRunId: latest.id };
  const complete = latest.jobs.filter(job => job.name === linuxPushJob);
  if (complete.length !== 1 || complete[0].status !== 'completed' || complete[0].conclusion !== 'success') return reject('missing-complete');
  return { ok: true, sha: targetSha, runId: latest.id };
}

/** Peel an annotated tag. A lightweight tag's own object is the commit. */
export function commitFromTagRefs(tag, refs) {
  if (!/^[A-Za-z0-9._-]+$/.test(tag ?? '')) return reject('missing-tag');
  const named = refs.find(item => item.ref === `refs/tags/${tag}`);
  if (!named) return reject('missing-tag');
  const peeled = refs.find(item => item.ref === `refs/tags/${tag}^{}`);
  const sha = (peeled ?? named).sha;
  if (!shaPattern.test(sha ?? '')) return reject('invalid-sha');
  return { ok: true, sha };
}

export function samePinnedSha(pinned, resolved) {
  if (!shaPattern.test(pinned ?? '') || !shaPattern.test(resolved ?? '')) return reject('invalid-sha');
  if (pinned !== resolved) return reject('tag-moved');
  return { ok: true, sha: pinned };
}

/**
 * Records come from git ancestry, not from SHA text order.
 * `descendant: null` or `trusted: null` means the query did not answer.
 */
export function newerTrustedFromRecords(targetSha, records) {
  if (!shaPattern.test(targetSha ?? '')) return null;
  for (const record of records) {
    if (!record || record.sha === targetSha) continue;
    if (record.descendant == null) return null;
    if (record.descendant === true && record.trusted == null) return null;
  }
  return records.some(record => record && record.sha !== targetSha && record.descendant === true && record.trusted === true);
}

/**
 * Automatic Pages may publish the target only when no newer master descendant
 * already has a trusted Linux push success or a successful Pages deployment.
 * Equality with the master tip does not need that scan. Query gaps refuse.
 * Manual rollback is a workflow_dispatch input only.
 */
export function pagesCurrentDecision({ targetSha, masterTip, relation, newerTrusted = null, manualRollback = false, event = 'workflow_run' }) {
  if (!shaPattern.test(targetSha ?? '')) return reject('invalid-sha');
  if (manualRollback && event !== 'workflow_dispatch') return reject('rollback-forbidden');
  if (!shaPattern.test(masterTip ?? '')) return reject('tip-unknown');
  if (targetSha === masterTip || relation === 'same') return { ok: true, sha: targetSha, rollback: false };
  if (relation !== 'ancestor') return reject(relation === 'unknown' ? 'ancestry-unknown' : 'not-on-master');
  if (newerTrusted == null) return reject('history-unknown');
  if (newerTrusted && !manualRollback) return reject('superseded');
  return { ok: true, sha: targetSha, rollback: Boolean(manualRollback && newerTrusted) };
}

function archiveStem(name) {
  return name.endsWith('.tar.gz') ? name.slice(0, -'.tar.gz'.length) : name.replace(/\.(dmg|zip)$/, '');
}

/** Each required archive must have its own manifest, the admitted SHA, and matching bytes. */
export function releaseAssetsMatch(sha, requiredArchives, entries) {
  if (!shaPattern.test(sha ?? '')) return reject('invalid-sha');
  if (!requiredArchives?.length) return reject('missing-manifest');
  const byName = new Map(entries.map(entry => [entry.name, entry]));
  for (const archive of requiredArchives) {
    const manifestEntry = byName.get(`${archiveStem(archive)}.build.json`);
    const archiveEntry = byName.get(archive);
    if (!manifestEntry?.manifest) return reject('missing-manifest');
    if (!archiveEntry) return reject('missing-archive');
    if (manifestEntry.manifest.sourceRevision !== sha || manifestEntry.manifest.archive !== archive) return reject('wrong-sha');
    if (!manifestEntry.manifest.archiveSha256 || manifestEntry.manifest.archiveSha256 !== archiveEntry.sha256) return reject('checksum-mismatch');
  }
  return { ok: true, sha };
}

function output(name, value) {
  if (!process.env.GITHUB_OUTPUT) return;
  execFileSync('sh', ['-c', 'printf "%s=%s\\n" "$1" "$2" >> "$GITHUB_OUTPUT"', 'gate', name, value]);
}

function fail(decision) {
  console.error(`deployment gate: ${decision.reason}`);
  process.exitCode = 1;
}

function gitLines(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
}

function pinTag() {
  const tag = process.env.RELEASE_TAG || '';
  const remote = gitLines(['ls-remote', 'origin', `refs/tags/${tag}`, `refs/tags/${tag}^{}`]);
  const refs = remote.map(line => {
    const [sha, ref] = line.split(/\s+/);
    return { sha, ref };
  });
  const peeled = commitFromTagRefs(tag, refs);
  if (!peeled.ok) return fail(peeled);
  const expected = process.env.RELEASE_SHA || '';
  if (expected) {
    const same = samePinnedSha(expected, peeled.sha);
    if (!same.ok) return fail(same);
  }
  output('sha', peeled.sha);
  console.log(`pinned ${tag} ${peeled.sha}`);
}

function ghJson(path) {
  return JSON.parse(execFileSync('gh', ['api', path], { encoding: 'utf8', env: process.env }));
}

function ciRuns(repository, sha) {
  const runs = [];
  for (let page = 1; page <= 10; page += 1) {
    const body = ghJson(`repos/${repository}/actions/workflows/ci.yml/runs?head_sha=${sha}&per_page=100&page=${page}`);
    const batch = body.workflow_runs ?? [];
    runs.push(...batch);
    if (batch.length < 100) break;
  }
  return runs.map(run => ({
    id: run.id,
    headSha: run.head_sha,
    event: run.event,
    headBranch: run.head_branch,
    headRepository: run.head_repository?.full_name ?? '',
    status: run.status,
    conclusion: run.conclusion,
    createdAt: run.created_at,
  }));
}

function jobsFor(repository, id) {
  const jobs = [];
  for (let page = 1; page <= 10; page += 1) {
    const body = ghJson(`repos/${repository}/actions/runs/${id}/jobs?per_page=100&page=${page}`);
    const batch = body.jobs ?? [];
    jobs.push(...batch);
    if (batch.length < 100) break;
  }
  return jobs.map(job => ({ name: job.name, status: job.status, conclusion: job.conclusion }));
}

function triggerFromEnv() {
  const event = process.env.GATE_TRIGGER_EVENT || '';
  if (!event || event === 'null') return null;
  return {
    id: Number(process.env.GATE_TRIGGER_ID || 0) || undefined,
    event,
    headSha: process.env.GATE_TRIGGER_SHA || '',
    headBranch: process.env.GATE_TRIGGER_BRANCH || '',
    headRepository: process.env.GATE_TRIGGER_REPOSITORY || '',
    status: process.env.GATE_TRIGGER_STATUS || '',
    conclusion: process.env.GATE_TRIGGER_CONCLUSION || '',
    createdAt: process.env.GATE_TRIGGER_CREATED_AT || '',
  };
}

function proveCi() {
  const repository = process.env.GATE_REPOSITORY || '';
  const targetSha = process.env.GATE_TARGET_SHA || '';
  const trigger = triggerFromEnv();
  const runs = ciRuns(repository, targetSha);
  let decision = decideDeployment({ repository, targetSha, policy: 'linux-push', trigger, runs });
  if (decision.reason === 'needs-jobs') {
    const jobs = jobsFor(repository, decision.candidateRunId);
    if (trigger && trigger.id === decision.candidateRunId) trigger.jobs = jobs;
    decision = decideDeployment({
      repository, targetSha, policy: 'linux-push', trigger,
      runs: runs.map(run => run.id === decision.candidateRunId ? { ...run, jobs } : run),
    });
  }
  if (!decision.ok) return fail(decision);
  output('sha', decision.sha);
  console.log(`trusted CI ${decision.runId} for ${decision.sha}`);
}

function gitExit(args) {
  try {
    execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return 0;
  } catch (error) {
    if (typeof error.status === 'number') return error.status;
    throw error;
  }
}

function masterTip() {
  const line = execFileSync('git', ['ls-remote', 'origin', 'refs/heads/master'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean)[0] || '';
  const sha = line.split(/\s+/)[0] || '';
  if (!shaPattern.test(sha)) throw new Error('master tip missing');
  return sha;
}

function ghFailedClosed(error) {
  const text = `${error.stderr || ''} ${error.message || ''}`;
  return error.status === 404 || text.includes('404');
}

function ghList(path) {
  try {
    const body = ghJson(path);
    return Array.isArray(body) ? body : (body.workflow_runs ?? []);
  } catch (error) {
    if (ghFailedClosed(error)) return [];
    throw error;
  }
}

function commitTrusted(repository, sha) {
  const runs = ciRuns(repository, sha).filter(run => run.headSha === sha && run.event === 'push' && run.headBranch === 'master' && run.headRepository === repository && run.status === 'completed' && run.conclusion === 'success');
  for (const run of runs) {
    const jobs = jobsFor(repository, run.id);
    if (jobs.filter(job => job.name === linuxPushJob && job.status === 'completed' && job.conclusion === 'success').length === 1) return true;
  }
  const deployments = ghList(`repos/${repository}/deployments?environment=github-pages&sha=${sha}&per_page=20`);
  for (const deployment of deployments) {
    if (deployment.sha !== sha) continue;
    const statuses = ghList(`repos/${repository}/deployments/${deployment.id}/statuses?per_page=10`);
    if (statuses.some(status => status.state === 'success')) return true;
  }
  return false;
}

function pagesCurrent() {
  const repository = process.env.GATE_REPOSITORY || '';
  const targetSha = process.env.GATE_TARGET_SHA || '';
  const event = process.env.GATE_EVENT || 'workflow_run';
  const manualRollback = process.env.GATE_MANUAL_ROLLBACK === 'true';
  let tip;
  try { tip = masterTip(); } catch { return fail({ reason: 'tip-unknown' }); }
  if (tip === targetSha) {
    const decision = pagesCurrentDecision({ targetSha, masterTip: tip, relation: 'same', newerTrusted: false, manualRollback, event });
    if (!decision.ok) return fail(decision);
    output('publish', 'true');
    output('rollback', 'false');
    console.log(`pages current ${targetSha}`);
    return;
  }
  let ancestorStatus;
  try {
    execFileSync('git', ['fetch', '--no-tags', '--depth=50', 'origin', 'master'], { stdio: 'inherit' });
    if (execFileSync('git', ['rev-parse', 'origin/master'], { encoding: 'utf8' }).trim() !== tip) return fail({ reason: 'tip-unknown' });
    ancestorStatus = gitExit(['merge-base', '--is-ancestor', targetSha, tip]);
  } catch { return fail({ reason: 'ancestry-unknown' }); }
  const relation = ancestorStatus === 0 ? 'ancestor' : ancestorStatus === 1 ? 'not-ancestor' : 'unknown';
  let newerTrusted = null;
  if (relation === 'ancestor') {
    let commits;
    try {
      commits = execFileSync('git', ['rev-list', '--first-parent', `${targetSha}..${tip}`], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
    } catch { return fail({ reason: 'history-unknown' }); }
    if (commits.length > 20) return fail({ reason: 'history-unknown' });
    try {
      newerTrusted = newerTrustedFromRecords(targetSha, commits.map(sha => ({ sha, descendant: true, trusted: commitTrusted(repository, sha) })));
    } catch { return fail({ reason: 'history-unknown' }); }
  }
  const decision = pagesCurrentDecision({ targetSha, masterTip: tip, relation, newerTrusted, manualRollback, event });
  if (!decision.ok && decision.reason === 'superseded') {
    output('publish', 'false');
    output('rollback', 'false');
    console.log(`pages superseded ${targetSha}; not publishing`);
    return;
  }
  if (!decision.ok) return fail(decision);
  output('publish', 'true');
  output('rollback', decision.rollback ? 'true' : 'false');
  console.log(decision.rollback ? `manual rollback ${targetSha}` : `pages current ${targetSha}`);
}

function manifests() {
  const sha = process.env.GATE_TARGET_SHA || '';
  const required = (process.env.GATE_REQUIRED_ARCHIVES || dispatchReleaseArchives.join(',')).split(',').map(name => name.trim()).filter(Boolean);
  const directory = resolve(process.argv[3] || 'release-assets');
  const entries = readdirSync(directory).map(name => {
    const bytes = readFileSync(resolve(directory, name));
    const entry = { name, sha256: createHash('sha256').update(bytes).digest('hex') };
    if (name.endsWith('.build.json')) entry.manifest = JSON.parse(bytes.toString('utf8'));
    return entry;
  });
  const decision = releaseAssetsMatch(sha, required, entries);
  if (!decision.ok) return fail(decision);
  console.log(`manifests match ${decision.sha}`);
}

function main() {
  const command = process.argv[2] || 'ci';
  if (command === 'pin-tag') pinTag();
  else if (command === 'ci') proveCi();
  else if (command === 'pages-current') pagesCurrent();
  else if (command === 'manifests') manifests();
  else throw new Error(`Unknown deployment gate command: ${command}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
