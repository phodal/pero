import assert from 'node:assert/strict';

export function fixtureExhaustionVerified(failure, cleanup, evidence) {
  return Boolean(!failure && cleanup.allExited && evidence.recordedHttpAttemptsTotal === 6 &&
    evidence.fixtureHttpRequests === 6 && evidence.sessions?.length === 1 && evidence.sessions[0].validated && evidence.sessions[0].budgetExhausted);
}

// Interpret the Go harness's persisted events, never the model's self-report.
export function inspectSession(events, skillName, digest, experimentId, requiredActions = ['read', 'search', 'lock', 'verify']) {
  const headers = events.filter(event => event.type === 'request/header');
  const tools = [...new Set(headers.flatMap(event => (event.data.tools || []).map(tool => tool.name)))].sort();
  const disabled = new Set(['shell', 'read_file', 'write_file', 'edit_file', 'list_directory', 'search_files', 'glob', 'grep', 'subagent', 'todo_write']);
  assert.ok(!tools.some(name => disabled.has(name)), 'A disabled native, coding or subagent tool was advertised');
  const calls = events.filter(event => event.type === 'tool/call');
  const results = new Map(events.filter(event => event.type === 'tool/result').map(event => [event.data.toolCallId, event.data]));
  const successful = call => { const result = results.get(call.data.callId); return result && !result.isError; };
  const list = calls.find(call => call.data.name === 'skill' && Object.keys(call.data.arguments || {}).length === 0 && successful(call));
  const read = calls.find(call => call.data.name === 'skill' && call.data.arguments?.name === skillName && call.data.arguments?.digest === digest && successful(call));
  assert.ok(list && read && list.seq < read.seq, 'Agent must list skills and then read the selected launch digest');
  const payload = call => JSON.parse(results.get(call.data.callId).content.find(item => item.type === 'text').text);
  assert.ok(payload(list).some(item => item.name === skillName && item.digest === digest), 'Skill list digest differs');
  const selected = payload(read);
  assert.equal(selected.name, skillName); assert.equal(selected.digest, digest); assert.ok(selected.content);
  const appCalls = calls.filter(call => call.data.name === 'mcp__pero-app-use__app_write');
  for (const call of appCalls) assert.equal(call.data.arguments?.document?.experimentId, experimentId, 'App call targets another experiment');
  for (const action of requiredActions)
    assert.ok(appCalls.some(call => call.data.arguments?.document?.action === action && successful(call)), `No successful ${action} tool call`);
  assert.ok(!calls.some(call => /(?:^|__)(?:computer_use|shell|write_file|read_file|delegate|subagent)(?:$|__)/.test(call.data.name)), 'Disallowed tool was invoked');
  return { tools, calls: calls.map(call => ({ ...call.data, succeeded: Boolean(successful(call)) })), skill: { name: skillName, digest },
    usage: events.filter(event => event.type === 'assistant/message').map(event => event.data.usage ?? 'unknown') };
}
