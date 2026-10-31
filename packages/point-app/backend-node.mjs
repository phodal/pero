// The original backend keeps Point's data/PORT/HMAC API; Host owns this process.
import { Server, createServer } from 'node:net';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const root = resolve(import.meta.dirname, 'point-source');
const app = JSON.parse(await readFile(resolve(root, 'app.json'), 'utf8'));
const reservation = createServer();
await new Promise((resolve, reject) => { reservation.once('error', reject); reservation.listen(0, '127.0.0.1', resolve); });
const port = reservation.address().port;
await new Promise((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()));
Object.assign(process.env, { PORT: String(port), POINT_APP_DATA: process.env.PERO_APP_DATA,
  POINT_APP_ROOT: root, POINT_APP_NAME: app.name, POINT_APP_PROXY_SECRET: process.env.PERO_APP_TOKEN });
process.chdir(root);
// Domain logs cannot replace the one private readiness record on stdout.
console.log = (...args) => console.error(...args);
const listen = Server.prototype.listen;
let reported = false;
Server.prototype.listen = function (...args) {
  this.once('listening', () => {
    const address = this.address();
    if (!reported && address && typeof address !== 'string' && address.address === '127.0.0.1' && address.port === port) {
      reported = true;
      process.stdout.write(JSON.stringify({ port: address.port }) + '\n');
    }
  });
  return listen.apply(this, args);
};
await import(pathToFileURL(resolve(root, app.backend.entryPoint)).href);
