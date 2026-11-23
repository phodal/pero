import { once } from 'node:events';
import { createServer } from 'node:http';

export async function listenJson(handler, errors) {
  const server = createServer((request, response) => void (async () => {
    try {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = Buffer.concat(chunks);
      await handler(request, response, body.length ? JSON.parse(body) : {}, body);
    } catch (error) {
      errors.push(error.message);
      if (!response.headersSent) response.writeHead(500);
      response.end('Loopback fixture error');
    }
  })());
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}

export const closeLoopback = server => new Promise(done => {
  server.close(done);
  server.closeAllConnections();
});

export const jsonReply = (response, id, result) => response.writeHead(200, { 'Content-Type': 'application/json' })
  .end(JSON.stringify({ jsonrpc: '2.0', id, result }));

export const streamCompletion = (response, { id, model, delta, finish = 'stop' }) => {
  response.writeHead(200, { 'Content-Type': 'text/event-stream' });
  response.end(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', model,
    choices: [{ index: 0, delta, finish_reason: finish }] })}\n\ndata: [DONE]\n\n`);
};
