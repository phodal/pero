import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { setTimeout as delay } from 'node:timers/promises';
import { WebSocket as NodeWebSocket } from 'ws';
import { z } from 'zod';
import { COMPUTER_TOOL, DesktopComputer, computerTreePreview } from './computer.ts';
import { LinuxDesktop } from './linux-desktop.ts';
import { LinuxDesktopVnc } from './linux-desktop-vnc.ts';
import { createDesktopPair, relayOrigin } from './linux-desktop-share.ts';
import { connectPair, publishRfb } from '../linux-desktop/paired-transport.ts';

const identitySchema = z.object({ id: z.string().regex(/^run_[a-f0-9]{32}$/), generation: z.number().int().positive(),
  instance_id: z.string().uuid(), url: z.string().url(), token: z.string().min(1) }).strict();
const commandSchema = z.object({ command: z.object({ id: z.string(), mode: z.enum(['watch', 'control', 'release']) }).nullable() });

async function runDesktop() {
  if (process.platform !== 'linux') throw new Error('A Blender desktop requires a Linux Worker.');
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
  const lines = input[Symbol.asyncIterator]();
  const { value } = await lines.next();
  if (value === undefined) throw new Error('Missing Run desktop authority.');
  const { id, url, token, ...execution } = identitySchema.parse(JSON.parse(value));
  const relay = relayOrigin() || '';
  if (!relay) throw new Error('Configure the Worker desktop relay origin.');
  process.env.PERO_REMOTE_DESKTOP_IMAGE = 'pero/linux-desktop:blender';
  process.env.PERO_REMOTE_DESKTOP_DOCKER_SOCKET ??= '/var/run/docker.sock';
  const root = await mkdtemp(join(tmpdir(), 'pero-run-desktop-'));
  const computer = new DesktopComputer('/usr/local/bin/pero-computer', root, () => {}, { applicationGrants: false });
  const vnc = new LinuxDesktopVnc(dirname(process.argv[1]));
  const desktop = new LinuxDesktop(vnc, () => computer.enabled, () => {});
  const lifetime = new AbortController();
  const access = randomUUID();
  const handoffs: { mode: string; at: string }[] = [];
  let peer: (() => void) | undefined;
  let lastImage: string | undefined;

  const endpoint = new URL(`/api/worker/v1/runs/${id}/desktop`, url);
  async function cloud(suffix: string, body: object | Buffer, binary = false) {
    const response = await fetch(endpoint.href + suffix, { method: binary ? 'PUT' : 'POST', redirect: 'error',
      signal: AbortSignal.timeout(2000), headers: { authorization: `Bearer ${token}`,
        'content-type': binary ? 'application/octet-stream' : 'application/json',
        'x-pero-generation': String(execution.generation), 'x-pero-instance': execution.instance_id },
      body: binary ? new Uint8Array(body as Buffer) : JSON.stringify({ ...execution, ...body }) });
    if (!response.ok) { await response.body?.cancel(); return { status: response.status, value: undefined }; }
    return { status: response.status, value: await response.json() };
  }

  const mcp = createServer(async (request, response) => {
    if (request.method !== 'POST' || request.url !== '/mcp' || request.headers.authorization !== `Bearer ${access}`) {
      response.writeHead(403).end();
      return;
    }
    let requestID: unknown;
    try {
      let size = 0;
      const chunks: Buffer[] = [];
      for await (const chunk of request) {
        const bytes = Buffer.from(chunk);
        size += bytes.length;
        if (size > 128 * 1024) { response.writeHead(413).end(); return; }
        chunks.push(bytes);
      }
      const message = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      requestID = message.id;
      if (requestID === undefined) { response.writeHead(202).end(); return; }
      let result: object;
      switch (message.method) {
        case 'initialize': result = { protocolVersion: message.params?.protocolVersion ?? '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'pero-run-desktop', version: '1' } }; break;
        case 'ping': result = {}; break;
        case 'tools/list': result = { tools: [COMPUTER_TOOL] }; break;
        case 'tools/call': {
          if (message.params?.name !== COMPUTER_TOOL.name) throw new Error('Unknown desktop tool.');
          const answer = await computer.call(id, message.params.arguments, lifetime.signal);
          const content = [];
          if (answer.kind === 'observation') {
            const { image, observation } = answer;
            content.push({ type: 'text', text: JSON.stringify({ kind: answer.kind, observation: { ...observation, elements: [] }, summary: computerTreePreview(answer) }) });
            if (image && observation.screenshot) {
              lastImage = `${observation.screenshot.id}.${image.media_type === 'image/png' ? 'png' : 'jpg'}`;
              content.push({ type: 'image', data: image.data, mimeType: image.media_type });
            }
          } else content.push({ type: 'text', text: JSON.stringify(answer) });
          result = { content, isError: answer.kind === 'receipt' && answer.receipt.outcome.status !== 'executed' };
          break;
        }
        default: response.writeHead(200, {'content-type':'application/json'}).end(JSON.stringify({jsonrpc:'2.0', id:requestID, error:{code:-32601,message:'Method not found'}})); return;
      }
      response.writeHead(200, {'content-type':'application/json'}).end(JSON.stringify({jsonrpc:'2.0', id:requestID, result}));
    } catch (error) {
      response.writeHead(200, {'content-type':'application/json'}).end(JSON.stringify({jsonrpc:'2.0', id:requestID ?? null,
        result:{isError:true,content:[{type:'text',text:error instanceof Error ? error.message : 'Desktop request failed.'}]}}));
    }
  });

  async function serve() {
    while (!lifetime.signal.aborted) {
      try {
        const { status, value } = await cloud('/poll', {});
        if (status === 403 || status === 409) { await desktop.returnControl(); break; }
        if (status === 200) {
          const { command } = commandSchema.parse(value);
          if (command) {
            let invitation: string | undefined;
            try {
              const previous = peer;
              peer = undefined;
              previous?.();
              await desktop.returnControl();
              if (command.mode !== 'release') {
                if (command.mode === 'control') await desktop.handoff(true);
                const display = await desktop.share();
                const pair = await createDesktopPair(display.viewOnly, relay);
                invitation = pair.invite;
                let closeDisplay: (() => void) | undefined;
                let closePair: (() => void) | undefined;
                const expired = setTimeout(() => close(), 9000);
                const close = () => {
                  clearTimeout(expired);
                  closePair?.();
                  closeDisplay?.();
                  if (peer !== close) return;
                  peer = undefined;
                  handoffs.push({mode:'disconnected',at:new Date().toISOString()});
                  void desktop.returnControl().catch(console.error);
                };
                closePair = connectPair(pair, 'owner', channel => {
                  clearTimeout(expired);
                  closeDisplay = publishRfb(display.endpoint, channel, close, address => {
                    const origin = new URL(address);
                    origin.protocol = 'http:';
                    return new NodeWebSocket(address, { origin: origin.origin }) as unknown as WebSocket;
                  });
                }, close);
                peer = close;
              }
              const reply = await cloud('', { id: command.id, invitation });
              if (reply.status !== 200) peer?.();
              else handoffs.push({ mode: command.mode, at: new Date().toISOString() });
            } catch {
              await desktop.returnControl();
              await cloud('', { id: command.id, error: 'Could not open the current desktop. Retry from this Run.' });
            }
          }
        }
      } catch { /* The Worker supervisor owns its execution deadline. */ }
      await delay(300);
    }
  }

  async function publish() {
    const journal = join(root, createHash('sha256').update(id).digest('hex'));
    const receipts = [];
    for (const file of await readdir(journal).catch(() => [])) {
      if (!file.endsWith('.json')) continue;
      const record = JSON.parse(await readFile(join(journal, file), 'utf8'));
      receipts.push(record.receipt ?? {request_id:record.action.request_id, outcome:{status:'unknown'}});
    }
    const files = new Map<string, Buffer>([['actions.json', Buffer.from(JSON.stringify({ run_id:id, ...execution, receipts, handoffs }, null, 2))]]);
    if (lastImage) files.set(lastImage.endsWith('.png') ? 'screenshot.png' : 'screenshot.jpg', await readFile(join(journal, 'images', lastImage)));
    for (const file of ['result.blend', 'result.obj'] as const) {
      try { files.set(file, await desktop.model(file)); }
      catch { console.error(`Run desktop artifact unavailable: ${file}`); }
    }
    const uploaded = [];
    for (const [file, bytes] of files) {
      for (let attempt = 0; attempt < 2; attempt++) {
        const result = await cloud(`/files/${file}`, bytes, true).catch(() => undefined);
        if (result?.status === 200) { uploaded.push(file); break; }
        if (result && result.status < 500 && result.status !== 429) break;
      }
    }
    return uploaded;
  }

  let serving: Promise<void> | undefined;
  try {
    await computer.restore(true);
    await vnc.open();
    await desktop.start();
    if (desktop.state.phase !== 'watching') throw new Error(desktop.state.error ?? 'Run desktop failed to start.');
    desktop.attach(id);
    computer.linuxRoute = thread => desktop.route(thread);
    mcp.listen(0, '127.0.0.1');
    await once(mcp, 'listening');
    serving = serve();
    const address = mcp.address();
    if (!address || typeof address === 'string') throw new Error('MCP listener unavailable.');
    process.stdout.write(JSON.stringify({ url:`http://127.0.0.1:${address.port}/mcp`, access }) + '\n');
    const finish = await lines.next();
    lifetime.abort();
    await serving;
    const previous = peer;
    peer = undefined;
    previous?.();
    await desktop.returnControl();
    const files = finish.value === 'finish' ? await publish() : [];
    await desktop.stop();
    if (desktop.state.hasGuest) throw new Error(desktop.state.error ?? 'Guest cleanup could not be confirmed.');
    process.stdout.write(JSON.stringify({ files }) + '\n');
  } finally {
    lifetime.abort();
    mcp.close();
    await serving;
    peer?.();
    await desktop.stop();
    await vnc.close();
    await rm(root, { recursive:true, force:true });
    input.close();
  }
}

runDesktop().catch(error => { console.error(error instanceof Error ? error.message : 'Run desktop failed.'); process.exitCode = 1; });
