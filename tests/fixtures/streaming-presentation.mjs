import readline from 'node:readline';
import { readFileSync } from 'node:fs';
const phasePath = process.argv[2];
const send = message => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
const update = update => send({ method: 'session/update', params: { sessionId: 'presentation', update } });
const text = text => ({ type: 'content', content: { type: 'text', text } });
let active, phase = 0, timer;
function tick() {
  const next = Number(readFileSync(phasePath, 'utf8'));
  if (next <= phase) return;
  phase = next;
  if (phase === 1) update({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: ' More reasoning arrived.' } });
  if (phase === 2) {
    const rawInput = { query: '杭州天气' };
    update({ sessionUpdate: 'session_info_update', title: '杭州天气检索' });
    update({ sessionUpdate: 'tool_call', toolCallId: 'search', title: 'Search 杭州天气', kind: 'search', rawInput, content: [text(JSON.stringify(rawInput))] });
  }
  if (phase === 3) {
    update({ sessionUpdate: 'tool_call_update', toolCallId: 'search', status: 'completed', content: [text('Weather sources:\n\n- [杭州天气](https://example.test/weather)\n- [本地预报](https://example.test/forecast)\n\nCloudy, 23°C.')], rawOutput: 'must not duplicate structured output' });
    const rawInput = { url: 'https://example.test/weather', prompt: 'Extract the weather forecast.' };
    update({ sessionUpdate: 'tool_call', toolCallId: 'fetch', title: 'Fetch weather source', kind: 'fetch', rawInput, content: [text(JSON.stringify(rawInput))] });
    send({ id: 'approval', method: 'session/request_permission', params: { sessionId: 'presentation', toolCall: { toolCallId: 'fetch', title: 'Fetch weather source' }, options: [{ optionId: 'once', name: 'Allow once', kind: 'allow_once' }, { optionId: 'reject', name: 'Reject', kind: 'reject_once' }] } });
  }
  if (phase === 4) {
    update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '杭州今天多云，23°C。' } });
    update({ sessionUpdate: 'session_info_update', updatedAt: '2026-10-29T12:00:00Z' });
    send({ id: active, result: { stopReason: 'end_turn' } });
    clearInterval(timer);
  }
}
readline.createInterface({ input: process.stdin }).on('line', line => {
  const { id, method, params } = JSON.parse(line);
  if (method === 'initialize') send({ id, result: { protocolVersion: 1, agentCapabilities: {}, agentInfo: { name: 'presentation-fixture', version: '1' } } });
  else if (method === 'session/new') send({ id, result: { sessionId: 'presentation', configOptions: [] } });
  else if (method === 'session/prompt') {
    active = id;
    update({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'Inspecting the weather sources.' } });
    timer = setInterval(tick, 20);
  } else if (id === 'approval' && params === undefined) {
    update({ sessionUpdate: 'tool_call_update', toolCallId: 'fetch', status: 'completed', content: [text('{"forecast":"Cloudy","temperature_c":23}')] });
    update({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'Checking the final answer.' } });
  } else if (id !== undefined) send({ id, result: {} });
});
