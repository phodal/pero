import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

for (const args of [[], ['--composer']]) {
  test(`presentation fixture accepts HTTP MCP without capture (${args[0] ?? 'default'})`, { timeout: 5000 }, async () => {
    const child = spawn(process.execPath, [fileURLToPath(new URL('./acp-agent.mjs', import.meta.url)), ...args], { stdio: ['pipe', 'pipe', 'pipe'] });
    const lines = createInterface({ input: child.stdout });
    const messages = lines[Symbol.asyncIterator]();
    const updates = [];
    const send = (id, method, params) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    const response = async id => {
      for (;;) {
        const line = await messages.next();
        assert.equal(line.done, false, 'fixture closed before its response');
        const message = JSON.parse(line.value);
        if (message.id === id) { assert.equal(message.error, undefined); return message.result; }
        updates.push(message);
      }
    };
    try {
      send(1, 'initialize', { protocolVersion: 1, clientCapabilities: {} });
      assert.equal((await response(1)).agentCapabilities.mcpCapabilities.http, true);
      send(2, 'session/new', { cwd: process.cwd(), mcpServers: [{ type: 'http', name: 'pero-connectors', url: 'http://127.0.0.1:1/mcp', headers: [] }] });
      const session = await response(2);
      assert.equal(session.sessionId, 'fixture-session');
      send(3, 'session/prompt', { sessionId: session.sessionId, prompt: [{ type: 'text', text: 'Inspect fixture context' }] });
      assert.equal((await response(3)).stopReason, 'end_turn');
      assert(updates.some(message => message.params?.update?.sessionUpdate === 'tool_call'));
      assert(updates.some(message => message.params?.update?.sessionUpdate === 'agent_message_chunk'));
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        const exited = once(child, 'exit');
        child.kill();
        await exited;
      }
      lines.close();
    }
  });
}
