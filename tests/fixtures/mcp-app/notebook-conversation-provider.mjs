// Local model fixture. The Notebook read still runs through the real MCP tool.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';

export const notebookConversationPrompt = 'Open the pinned Notebook revision in the Inspector.';
export const notebookInitialAnswer = 'NOTEBOOK_INSPECTOR_PINNED_OK';

export async function notebookConversationProvider(entryId) {
  const calls = [], errors = [];
  const server = createServer(async (request, response) => {
    try {
      assert.equal(request.url, '/v1/chat/completions');
      let text = '';
      for await (const chunk of request) text += chunk;
      const body = JSON.parse(text);
      calls.push(body);
      const latestUser = body.messages.filter(message => message.role === 'user').at(-1);
      const prompt = typeof latestUser?.content === 'string' ? latestUser.content
        : latestUser?.content?.filter(part => part.type === 'text').map(part => part.text).join('\n') || '';
      let delta, finish;
      if (calls.length === 1) {
        assert(prompt.includes(notebookConversationPrompt));
        const tool = body.tools.find(item => item.function?.name?.includes('read-entry')
          || item.function?.description?.includes('saved Notebook revision'));
        assert(tool, `Missing Notebook read tool: ${body.tools.map(item => item.function?.name).join(', ')}`);
        delta = {tool_calls: [{index: 0, id: 'notebook-read-call', type: 'function', function: {
          name: tool.function.name,
          arguments: JSON.stringify({entryId, revision: 1}),
        }}]};
        finish = 'tool_calls';
      } else {
        assert.equal(calls.length, 2, 'The pinned read must reach exactly one following model request');
        const result = JSON.stringify(body.messages.filter(message => message.role === 'tool'));
        assert(result.includes('12.5'), 'The model did not receive the pinned Notebook text');
        assert(!result.includes('13.0'), 'The model received a later Notebook revision');
        delta = {content: notebookInitialAnswer};
        finish = 'stop';
      }
      response.writeHead(200, {'Content-Type': 'text/event-stream'});
      response.end(`data: ${JSON.stringify({id: `notebook-${calls.length}`, object: 'chat.completion.chunk', model: 'fixture', choices: [{index: 0, delta, finish_reason: finish}]})}\n\ndata: [DONE]\n\n`);
    } catch (error) {
      errors.push(String(error));
      response.writeHead(500).end('Notebook conversation fixture failed');
    }
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  return {calls, errors, endpoint: `http://127.0.0.1:${server.address().port}/v1`,
    close: async () => { server.closeAllConnections(); await new Promise(done => server.close(done)); }};
}
