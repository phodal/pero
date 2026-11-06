// Synthetic ACP controller; file effects are real and confined to the disposable test workspace.
import readline from 'node:readline';
import { writeFile, rename, rm, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
let workspace;
const send = message => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
const update = update => send({ method: 'session/update', params: { sessionId: 'changes-fixture', update } });
readline.createInterface({ input: process.stdin }).on('line', async line => {
  const { id, method, params } = JSON.parse(line);
  if (method === 'initialize') send({ id, result: { protocolVersion: 1, agentCapabilities: { mcpCapabilities: { http: true } }, agentInfo: { name: 'workspace-change-fixture', version: '1' } } });
  else if (method === 'session/new') { workspace = params.cwd; send({ id, result: { sessionId: 'changes-fixture', configOptions: [{ id: 'permission', name: 'Permission', category: 'mode', type: 'select', currentValue: 'auto-review', options: [{ value: 'auto-review', name: 'Auto-review' }] }] } }); }
  else if (method === 'session/prompt') {
    update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'I will update the files.' } });
    update({ sessionUpdate: 'tool_call', toolCallId: 'write', title: 'shell', kind: 'other', status: 'in_progress', rawInput: { command: 'apply fixture file edits' } });
    await writeFile(resolve(workspace, 'README.md'), 'one\nupdated\n');
    await writeFile(resolve(workspace, 'new.rs'), 'fn main() {}\n');
    await rename(resolve(workspace, 'move.txt'), resolve(workspace, 'renamed.txt'));
    await rm(resolve(workspace, 'remove.txt'));
    await writeFile(resolve(workspace, 'binary.bin'), Buffer.from([0, 1, 2, 3]));
    const original = await readFile(resolve(workspace, 'preexisting.txt'));
    await writeFile(resolve(workspace, 'preexisting.txt'), 'temporary mutation');
    await writeFile(resolve(workspace, 'preexisting.txt'), original);
    update({ sessionUpdate: 'tool_call_update', toolCallId: 'write', status: 'completed', content: [{ type: 'content', content: { type: 'text', text: 'Real fixture file mutations completed.' } }] });
    update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Updated the files. The recorded changes are available in Diff.' } });
    send({ id, result: { stopReason: 'end_turn' } });
  } else if (id !== undefined) send({ id, result: {} });
});
