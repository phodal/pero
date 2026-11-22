import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { WebSocketServer, createWebSocketStream } from 'ws';
import type { LinuxDesktopGuest } from './linux-desktop-guest.ts';

/** One private viewer origin, with a fresh RFB endpoint after every handoff. */
export class LinuxDesktopVnc {
  private readonly path = `/${randomUUID()}/`;
  private readonly sockets = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024, perMessageDeflate: false });
  private readonly http;
  private origin = '';
  private target?: { guest: LinuxDesktopGuest; control: boolean; path: string };
  private client?: { close(): void; done: Promise<void> };

  constructor(assets: string) {
    const files = new Map([
      ['', ['linux-desktop.html', 'text/html; charset=utf-8']],
      ['linux-desktop.js', ['linux-desktop.js', 'text/javascript; charset=utf-8']],
      ['linux-desktop.css', ['linux-desktop.css', 'text/css; charset=utf-8']],
    ]);
    this.http = createServer(async (request, response) => {
      const file = request.method === 'GET' && request.headers.host === this.origin.slice('http://'.length) &&
        request.url?.startsWith(this.path) && files.get(request.url.slice(this.path.length));
      if (!file) { response.writeHead(404).end(); return; }
      try {
        const bytes = await readFile(join(assets, file[0]));
        response.writeHead(200, {
          'content-type': file[1], 'cache-control': 'no-store', 'referrer-policy': 'no-referrer',
          'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'",
        }).end(bytes);
      } catch { response.writeHead(404).end(); }
    });
    this.http.on('upgrade', (request, socket, head) => {
      const target = this.target;
      if (!target || this.client || request.url !== target.path || request.headers.origin !== this.origin ||
          request.headers.host !== this.origin.slice('http://'.length)) { socket.destroy(); return; }
      this.sockets.handleUpgrade(request, socket, head, peer => {
        const child = target.guest.vnc(target.control);
        const stream = createWebSocketStream(peer);
        child.stderr.resume();
        let deadline: ReturnType<typeof setTimeout> | undefined;
        const done = new Promise<void>(resolve => child.once('close', () => { clearTimeout(deadline); resolve(); }));
        const close = () => {
          peer.terminate();
          child.stdin.end();
          deadline ??= setTimeout(() => child.kill('SIGKILL'), 3000);
        };
        const client = { close, done };
        this.client = client;
        child.stdin.on('error', close);
        child.on('error', close);
        stream.on('error', close);
        stream.once('close', close);
        stream.pipe(child.stdin);
        child.stdout.pipe(stream);
        void client.done.then(() => {
          peer.terminate();
          if (this.client === client) this.client = undefined;
        });
      });
    });
  }

  async open() {
    this.http.listen(0, '127.0.0.1');
    await once(this.http, 'listening');
    this.origin = `http://127.0.0.1:${(this.http.address() as AddressInfo).port}`;
    return this.origin + this.path;
  }

  expose(guest: LinuxDesktopGuest, control: boolean) {
    this.target = { guest, control, path: `${this.path}rfb/${randomUUID()}` };
  }

  get endpoint() { return this.target && `${this.origin.replace('http:', 'ws:')}${this.target.path}`; }

  async revoke() {
    this.target = undefined;
    const client = this.client;
    if (!client) return;
    client.close();
    await client.done;
  }

  async close() {
    await this.revoke();
    this.sockets.close();
    this.http.close();
  }
}
