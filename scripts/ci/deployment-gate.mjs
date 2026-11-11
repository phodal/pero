// Pages and Release may build only a commit whose trusted CI complete succeeded.
// Callers pass the immutable SHA and the runs they observed. This module does
// not read the clock, the network, or the default-branch tip.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const trustedEvents = new Set(['push', 'schedule', 'workflow_dispatch']);
const rejectedConclusions = new Set(['failure', 'cancelled', 'timed_out', 'startup_failure', 'action_required', 'skipped', 'stale', 'neutral']);
const completeJob = /^(?:Linux|Full-platform) CI gate$/;
const shaPattern = /^[0-9a-f]{40}$/;

function reject(reason, extra = {}) {
  return { ok: false, reason, ...extra };
}

function sourceGate(source, { repository, trustedBranch }) {
  if (!trustedEvents.has(source.event)) return reject('untrusted-event');
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
 *   trustedBranch?: string,
 *   trigger?: { event: string, headSha: string, headBranch: string, headRepository: string, status: string, conclusion: string | null } | null,
 *   runs?: Array<{ id: number, headSha: string, event: string, headBranch: string, headRepository: string, status: string, conclusion: string | null, createdAt: string, jobs?: Array<{ name: string, status: string, conclusion: string | null }> }>
 * }} input
 */
export function decideDeployment({ repository, targetSha, trustedBranch = 'master', trigger = null, runs = [] }) {
  if (!shaPattern.test(targetSha ?? '')) return reject('invalid-sha');
  if (trigger) {
    const triggerSource = sourceGate(trigger, { repository, trustedBranch });
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
  const trusted = observed.filter(run => run.headSha === targetSha && sourceGate(run, { repository, trustedBranch }).ok);
  if (!trusted.length) return reject('missing');
  if (trusted.some(run => run.status !== 'completed')) return reject('pending');
  const latest = [...trusted].sort(byNewest)[0];
  if (latest.conclusion !== 'success') return reject(rejectedConclusions.has(latest.conclusion) ? latest.conclusion : 'failure');
  if (!latest.jobs) return { ok: false, reason: 'needs-jobs', sha: targetSha, candidateRunId: latest.id };
  const complete = latest.jobs.filter(job => completeJob.test(job.name));
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

export function releaseManifestsMatch(sha, manifests) {
  if (!shaPattern.test(sha ?? '')) return reject('invalid-sha');
  if (!Array.isArray(manifests) || manifests.length === 0) return reject('missing-manifest');
  if (!manifests.every(item => item?.sourceRevision === sha)) return reject('wrong-sha');
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
  let decision = decideDeployment({ repository, targetSha, trigger, runs });
  if (decision.reason === 'needs-jobs') {
    const jobs = jobsFor(repository, decision.candidateRunId);
    if (trigger && trigger.id === decision.candidateRunId) trigger.jobs = jobs;
    decision = decideDeployment({
      repository, targetSha, trigger,
      runs: runs.map(run => run.id === decision.candidateRunId ? { ...run, jobs } : run),
    });
  }
  if (!decision.ok) return fail(decision);
  output('sha', decision.sha);
  console.log(`trusted CI ${decision.runId} for ${decision.sha}`);
}

function manifests() {
  const sha = process.env.GATE_TARGET_SHA || '';
  const directory = resolve(process.argv[3] || 'release-assets');
  const manifests = readdirSync(directory).filter(name => name.endsWith('.build.json')).map(name => JSON.parse(readFileSync(resolve(directory, name), 'utf8')));
  const decision = releaseManifestsMatch(sha, manifests);
  if (!decision.ok) return fail(decision);
  console.log(`manifests match ${decision.sha}`);
}

function main() {
  const command = process.argv[2] || 'ci';
  if (command === 'pin-tag') pinTag();
  else if (command === 'ci') proveCi();
  else if (command === 'manifests') manifests();
  else throw new Error(`Unknown deployment gate command: ${command}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
