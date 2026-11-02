// Test-only controller for authored synthetic trajectories. Never a product grant.
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { scenes } from './scenarios.mjs';

const prefix = 'mcp__pero-app-use__app__paper-agent__';
export class FixtureApproval {
  constructor(scene) {
    assert(Object.hasOwn(scenes, scene) && !scenes[scene].publicRecording,
      'No synthetic approval policy for this scene; authentic-material replay requires separately reviewed permissions');
    this.scene = scene; this.phase = -1; this.decisions = []; this.errors = [];
    this.seen = new Set(); this.calls = new Map(); this.expected = new Map();
  }
  beginTurn(index) {
    assert.equal(index, this.phase + 1, 'Fixture phases advance once');
    assert(index <= 1); this.phase = index; this.expected.clear(); this.calls.clear();
  }
  finishTurn() {
    assert.equal(this.expected.size, 0, 'Every scripted Paper call must consume an actual permission request');
    if (this.phase === 0 || scenes[this.scene].source)
      assert(this.decisions.some(decision => decision.phase === this.phase && decision.allowed), 'No actual bounded permission decision in this phase');
    assert.deepEqual(this.errors, [], 'Unexpected permission requests');
  }
  permits(name, args) {
    if (!name.startsWith(prefix)) return false;
    const tool = name.slice(prefix.length);
    const spec = scenes[this.scene];
    if (this.phase === 0) return tool === 'inspect-research-link' ||
      (spec.analysis && tool === 'research-analysis' && ['context', 'propose'].includes(args.operation)) ||
      (!spec.inspectOnly && tool === 'commit-research-bundle' &&
        Object.keys(args).every(key => ['draftId', 'resourceIds'].includes(key)));
    if (this.phase !== 1 || !spec.source || spec.decline) return false;
    return tool === 'commit-research-bundle' ||
      (tool === 'research-source' && ['start', 'status'].includes(args.operation)) ||
      (tool === 'research-source-read' && (['list', 'read'].includes(args.operation) ||
        (spec.pdf && args.operation === 'compare') || (spec.vision && args.operation === 'image'))) ||
      (spec.pdf && (tool === 'prepare-research' ||
        (tool === 'research-pdf' && ['start', 'status'].includes(args.operation)) ||
        (tool === 'research-step' && ['read', 'finalize'].includes(args.action))));
  }
  // Only the authored in-process fixture plan calls this, before emitting its call.
  expect(id, name, args) {
    if (!name.startsWith(prefix)) return; // Skill/content_read need no mutation grant.
    assert(this.permits(name, args), `Scripted call outside phase: ${name}`);
    assert(!this.expected.has(id));
    this.expected.set(id, structuredClone({ name, args }));
  }
  observe(event, thread) {
    if (event.thread_id !== thread || event.kind !== 'session_update') return;
    const data = event.data;
    if (data?.sessionUpdate === 'tool_call') this.calls.set(data.toolCallId, structuredClone(data));
    if (data?.sessionUpdate === 'tool_call_update' && ['completed', 'failed'].includes(data.status)) this.calls.delete(data.toolCallId);
  }
  respond(event, thread) {
    const data = event.data || {}, id = data.permission_id, callId = data.toolCall?.toolCallId;
    const call = this.calls.get(callId), expected = this.expected.get(callId);
    // Go ACP requestApproval (harness/go/acp/server.go) sends an ID-only
    // ToolCallUpdate. Omitted fields retain the observed pending subject; an
    // explicitly supplied update must not contradict that subject.
    const subject = data.toolCall || {};
    const subjectMatches = expected &&
      (!Object.hasOwn(subject, 'title') || subject.title === expected.name) &&
      (!Object.hasOwn(subject, 'rawInput') || isDeepStrictEqual(subject.rawInput, expected.args));
    const allowed = event.kind === 'permission' && event.thread_id === thread && typeof id === 'string' &&
      this.decisions.length < 128 && !this.seen.has(id) && call && expected && call.status === 'in_progress' &&
      subjectMatches && call.title === expected.name && isDeepStrictEqual(call.rawInput, expected.args) && this.permits(call.title, call.rawInput);
    if (id) this.seen.add(id);
    this.expected.delete(callId); this.calls.delete(callId);
    const options = (data.options || []).filter(option => option.kind === (allowed ? 'allow_once' : 'reject_once'));
    const valid = options.length === 1 && typeof options[0].optionId === 'string';
    const accepted = Boolean(allowed && valid);
    this.decisions.push({ phase: this.phase, thread, requestId: id, callId, name: call?.title, allowed: accepted });
    if (!accepted) this.errors.push(`Unexpected synthetic permission: ${callId || 'missing call'} in phase ${this.phase}`);
    // Missing/malformed options cancel; never choose a persistent grant.
    return { action: 'permission', thread_id: event.thread_id, request_id: id, option_id: valid ? options[0].optionId : null };
  }
}
