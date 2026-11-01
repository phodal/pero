// One explicit campaign owner; the reservation remains charged after failures.
import assert from 'node:assert/strict';
import { open, readFile, rename, rm } from 'node:fs/promises';

export class CampaignLedger {
  constructor(path, lock, data, scrub) { Object.assign(this, { path, lock, data, scrub }); }

  static async acquire(path, scrub = String) {
    const lock = await open(path + '.lock', 'wx', 0o600);
    try {
      const data = JSON.parse(await readFile(path, 'utf8'));
      assert.equal(data.schema, 'paper-study-provider-ledger.v1');
      assert.equal(data.owner, 'validate_go_skill_trajectories');
      assert.equal(data.maxSessions, null, 'This campaign has no additional session cap');
      assert.equal(data.status, 'idle', 'Reconcile a prior reservation before starting another session');
      assert.equal(data.startedSessions, data.sessions.length);
      return new CampaignLedger(path, lock, data, scrub);
    } catch (error) {
      try { await lock.close(); } finally { await rm(path + '.lock'); }
      throw error;
    }
  }

  async save() {
    const temporary = this.path + '.new';
    const file = await open(temporary, 'w', 0o600);
    try { await file.writeFile(this.scrub(JSON.stringify(this.data, null, 2)) + '\n'); await file.sync(); }
    finally { await file.close(); }
    await rename(temporary, this.path);
  }

  async reserve(scene, directory, startedAt) {
    assert(!this.reservation, 'Only one model session per invocation');
    this.reservation = { session: ++this.data.startedSessions, scene, directory, startedAt,
      status: 'reserved-before-agent-start', httpAttempts: null };
    this.data.sessions.push(this.reservation); this.data.status = 'running';
    await this.save();
  }

  async finish({ httpAttempts, passed, finishedAt, usage }) {
    assert(this.reservation, 'Reserve before starting an Agent');
    assert(httpAttempts === null || Number.isSafeInteger(httpAttempts) && httpAttempts >= 0);
    Object.assign(this.reservation, { httpAttempts, status: passed ? 'automated-checks-passed' : 'failed-or-aborted', finishedAt, usage });
    this.data.httpAttempts = this.data.sessions.some(session => session.httpAttempts === null) ? null
      : this.data.sessions.reduce((sum, session) => sum + session.httpAttempts, 0);
    this.data.status = this.data.httpAttempts === null ? 'audit-reconciliation-required' : 'idle';
    await this.save();
  }

  async close() {
    try { await this.lock.close(); } finally { await rm(this.path + '.lock'); }
  }
}
