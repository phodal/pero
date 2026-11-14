// Scripted loopback model. The real Go harness, Host, MCP and shell own execution.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

export const projectAgentPrompts = Object.freeze({
  delegate: 'PROJECT_DELEGATE', wait: 'PROJECT_WAIT', fail: 'PROJECT_FAIL',
  summary: 'PROJECT_SUMMARY', followup: 'PROJECT_FOLLOWUP',
});
const plain = message => typeof message?.content === 'string' ? message.content
  : (message?.content || []).filter(part => part.type === 'text').map(part => part.text).join('\n');
function snapshotFromTool(text) {
  const value = JSON.parse(text);
  if (Array.isArray(value.sessions)) return value;
  for (const block of value.content || []) {
    if (block.type === 'text') {
      const snapshot = snapshotFromTool(block.text);
      if (snapshot) return snapshot;
    }
  }
}

export async function projectAgentProvider() {
  const calls = [], errors = [];
  const server = createServer(async (request, response) => {
    try {
      assert.equal(request.url, '/v1/chat/completions');
      let raw = ''; for await (const chunk of request) raw += chunk;
      const body = JSON.parse(raw); calls.push(body);
      const messages = body.messages || [];
      const userIndex = messages.findLastIndex(message => message.role === 'user');
      const prompt = plain(messages[userIndex]);
      const tools = body.tools || [];
      const projectTool = tools.find(tool => /project_work$/.test(tool.function?.name));
      const toolAfterUser = messages.slice(userIndex + 1).filter(message => message.role === 'tool');
      const callTool = (name, args) => ({ tool_calls: [{ index: 0, id: `project-fixture-${calls.length}`,
        type: 'function', function: { name, arguments: JSON.stringify(args) } }] });
      let delta, finish = 'stop';
      if (prompt.includes('PROJECT_CHILD_FAIL')) {
        response.writeHead(400, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ error: { message: 'PROJECT_FIXTURE_EXPECTED_PROVIDER_FAILURE', type: 'invalid_request_error' } }));
        return;
      }
      if (prompt.includes('PROJECT_CHILD_EVIDENCE') || prompt.includes('PROJECT_FOLLOWUP') || prompt.includes('PROJECT_CHILD_WAIT') || prompt.includes('PROJECT_CHILD_READONLY')) {
        if (!toolAfterUser.length) {
          assert(tools.some(tool => tool.function?.name === 'shell'), 'Child must retain the real shell tool');
          const command = prompt.includes('PROJECT_CHILD_READONLY')
            ? "printf 'must not write\\n' > read-only-proof.txt"
            : prompt.includes('PROJECT_CHILD_WAIT')
            ? `${JSON.stringify(process.execPath)} -e "require('fs').writeFileSync('slow-ready','ready');setInterval(()=>{},1000)"`
            : prompt.includes('PROJECT_FOLLOWUP')
              ? "printf 'followup evidence\\n' >> evidence.txt; cat evidence.txt; pwd"
              : "printf 'observed fixture evidence\\n' > evidence.txt; cat evidence.txt; pwd";
          delta = callTool('shell', { command }); finish = 'tool_calls';
        } else {
          const observed = toolAfterUser.map(plain).join('\n');
          if (prompt.includes('PROJECT_CHILD_READONLY')) {
            assert(/permission|denied|rejected|not permitted|not allowed/i.test(observed), observed);
            delta = { content: `PROJECT_READONLY_DENIED: no write was accepted. ${observed}` };
          } else {
            assert(observed.includes('observed fixture evidence') || prompt.includes('PROJECT_CHILD_WAIT'), observed);
            delta = { content: `PROJECT_CHILD_RESULT: evidence.txt is the executed shell evidence. ${observed}` };
          }
        }
      } else if (prompt.includes('PROJECT_DELEGATE') || prompt.includes('PROJECT_WAIT') || prompt.includes('PROJECT_FAIL')) {
        assert(projectTool, `Primary must have project_work: ${tools.map(tool => tool.function?.name).join(', ')}`);
        if (!toolAfterUser.length) {
          const wait = prompt.includes('PROJECT_WAIT'), fail = prompt.includes('PROJECT_FAIL');
          delta = callTool(projectTool.function.name, { action: 'delegate', title: wait ? 'Cancellation check' : fail ? 'Failed check' : 'Evidence check',
            prompt: wait ? 'PROJECT_CHILD_WAIT' : fail ? 'PROJECT_CHILD_FAIL' : 'PROJECT_CHILD_EVIDENCE' });
          finish = 'tool_calls';
        } else {
          const receipt = toolAfterUser.map(plain).join('\n');
          assert(receipt.includes('thread_id'), receipt);
          const snapshot = snapshotFromTool(plain(toolAfterUser.at(-1)));
          assert(snapshot, receipt);
          const child = snapshot.sessions.find(session => session.thread_id === snapshot.selected_thread)
            || snapshot.sessions.filter(session => session.binding.parent_thread).at(-1);
          assert(child, receipt);
          delta = { content: `PROJECT_DELEGATED: ${child.binding.label} · ${child.thread_id} · ${child.status}. Inspect the original child conversation for its execution evidence.` };
        }
      } else if (prompt.includes('PROJECT_SUMMARY') || /summariz|summary|汇总/i.test(prompt)) {
        assert(projectTool, 'Summary must use the original project tool');
        if (!toolAfterUser.length) {
          delta = callTool(projectTool.function.name, { action: 'list' }); finish = 'tool_calls';
        } else {
          const receipt = toolAfterUser.map(plain).join('\n');
          assert(receipt.includes('Evidence check'), receipt);
          assert(receipt.includes('evidence.txt'), receipt);
          const snapshot = snapshotFromTool(plain(toolAfterUser.at(-1)));
          assert(snapshot, receipt);
          const children = snapshot.sessions.filter(session => session.binding.parent_thread);
          const evidence = children.find(session => session.binding.label === 'Evidence check')?.evidence;
          assert(evidence?.some(item => item.tool_call_id && item.status === 'completed' && item.output.includes('observed fixture evidence')),
            'Primary summary must receive the observed completed shell receipt, not only a child claim');
          delta = { content: 'PROJECT_SUMMARY_VERIFIED: scripted model summary from original session receipts.\n'
            + children.map(session => `${session.binding.label}: ${session.status}; original session ${session.thread_id}; `
              + (session.evidence?.some(item => item.status === 'completed' && item.output.includes('observed fixture evidence'))
                ? `evidence ${session.workspace}/evidence.txt.` : 'no accepted file evidence.')).join('\n')
            + '\nScientific acceptance is unverified; cancelled and failed work has no accepted result.' };
        }
      } else {
        delta = { content: 'PROJECT_PRIMARY_READY: scripted model fixture; provide PROJECT_DELEGATE to execute the child evidence check.' };
      }
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      response.end(`data: ${JSON.stringify({ id: `project-fixture-${calls.length}`, object: 'chat.completion.chunk', model: 'project-agent-fixture',
        choices: [{ index: 0, delta, finish_reason: finish }] })}\n\ndata: [DONE]\n\n`);
    } catch (error) {
      errors.push(String(error)); response.writeHead(500).end('Project Agent provider fixture failed');
    }
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  return { calls, errors, endpoint: `http://127.0.0.1:${server.address().port}/v1`, close: async () => {
    server.closeAllConnections(); await new Promise(done => server.close(done));
  } };
}
