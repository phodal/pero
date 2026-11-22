import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { WebSocket, WebSocketServer } from 'ws';

const key = process.env.PERO_DESKTOP_RELAY_KEY;
if (!key || key.length < 32) throw new Error('Set PERO_DESKTOP_RELAY_KEY to a secret of at least 32 characters.');
const assets = resolve(import.meta.dirname, '../../desktop/dist');
const rooms = new Map();
const waitingForPong = new WeakSet();
const secretsMatch = (a, b) => typeof a === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) &&
  timingSafeEqual(Buffer.from(a), Buffer.from(b));
const token = () => randomBytes(32).toString('base64url');
const socketServer = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024, perMessageDeflate: false });
const files = new Map([
  ['/', ['linux-desktop-peer.html', 'text/html; charset=utf-8']],
  ['/linux-desktop-peer.js', ['linux-desktop-peer.js', 'text/javascript; charset=utf-8']],
  ['/linux-desktop-peer.css', ['linux-desktop-peer.css', 'text/css; charset=utf-8']],
]);

function drop(id) {
  const room = rooms.get(id);
  if (!room) return;
  rooms.delete(id);
  clearTimeout(room.expiry);
  for (const peer of Object.values(room.peers)) peer.terminate();
}

const server = createServer(async (request, response) => {
  if (request.url === '/api/pair' && request.method === 'POST') {
    request.resume();
    if (!secretsMatch(request.headers.authorization, `Bearer ${key}`)) { response.writeHead(401).end(); return; }
    if (rooms.size >= 64) { response.writeHead(429).end(); return; }
    const id = token();
    const owner = token(), viewer = token();
    rooms.set(id, { owner, viewer, peers: {}, viewOnly: request.headers['x-pero-desktop-mode'] !== 'control',
      expiry: setTimeout(() => drop(id), 120_000) });
    response.writeHead(201, { 'content-type': 'application/json', 'cache-control': 'no-store' })
      .end(JSON.stringify({ id, owner, viewer }));
    return;
  }
  const file = request.method === 'GET' && files.get(request.url);
  if (!file) { response.writeHead(404).end(); return; }
  try {
    response.writeHead(200, {
      'content-type': file[1], 'cache-control': 'no-store', 'referrer-policy': 'no-referrer',
      'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src data: blob:; connect-src 'self'; frame-ancestors 'none'",
    }).end(await readFile(resolve(assets, file[0])));
  } catch { response.destroy(); }
});

server.on('upgrade', (request, socket, head) => {
  const match = /^\/bridge\/([\w-]{43})\/(owner|viewer)$/.exec(request.url || '');
  const room = match && rooms.get(match[1]);
  if (!match || !room || room.peers[match[2]]) { socket.destroy(); return; }
  const [, id, role] = match;
  socketServer.handleUpgrade(request, socket, head, peer => {
    const deadline = setTimeout(() => peer.terminate(), 5000);
    const other = role === 'owner' ? 'viewer' : 'owner';
    peer.on('error', () => peer.terminate());
    peer.on('pong', () => waitingForPong.delete(peer));
    peer.on('close', () => {
      clearTimeout(deadline);
      if (room.peers[role] === peer) drop(id);
    });
    peer.once('message', (data, binary) => {
      if (binary || !secretsMatch(data.toString(), room[role]) || !rooms.has(id) || room.peers[role]) {
        peer.terminate();
        return;
      }
      clearTimeout(deadline);
      room[role] = '';
      room.peers[role] = peer;
      peer.on('message', (payload, isBinary) => {
        const destination = room.peers[other];
        if (destination?.readyState !== WebSocket.OPEN) return;
        if (destination.bufferedAmount > 8 * 1024 * 1024) { drop(id); return; }
        destination.send(payload, { binary: isBinary });
      });
      if (room.peers[other]) {
        clearTimeout(room.expiry);
        const turnUrl = process.env.PERO_DESKTOP_TURN_URL;
        const turnKey = process.env.PERO_DESKTOP_TURN_SECRET;
        const username = `${Math.floor(Date.now() / 1000) + 3600}:pero`;
        const iceServers = turnUrl && turnKey ? [{
          urls: turnUrl, username, credential: createHmac('sha1', turnKey).update(username).digest('base64'),
        }] : [];
        const relayOnly = iceServers.length > 0 && process.env.PERO_DESKTOP_TURN_ONLY === '1';
        const paired = JSON.stringify({ kind: 'paired', viewOnly: room.viewOnly, iceServers, relayOnly });
        peer.send(paired);
        room.peers[other].send(paired);
      }
    });
  });
});
const heartbeat = setInterval(() => {
  for (const [id, room] of rooms) {
    for (const peer of Object.values(room.peers)) {
      if (waitingForPong.has(peer)) { drop(id); break; }
      waitingForPong.add(peer);
      peer.ping();
    }
  }
}, 15_000);
heartbeat.unref();
server.listen(Number(process.env.PERO_DESKTOP_RELAY_PORT || 8789), '127.0.0.1', () => {
  console.log(`Pero desktop relay listening on ${server.address().port}`);
});
