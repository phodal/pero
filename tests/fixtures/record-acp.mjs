// Pass ACP stdio through unchanged. Session setup capture excludes credentials.
import { spawn } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { PassThrough } from 'node:stream';

const [record, executable, ...args] = process.argv.slice(2);
const peer = spawn(executable, args, { stdio: ['pipe', 'pipe', 'inherit'] });

function observe(stream, direction, capture) {
  const copy = new PassThrough();
  createInterface({ input: copy }).on('line', line => {
    const message = JSON.parse(line);
    const captured = capture(message, line);
    if (captured !== undefined) appendFileSync(record, JSON.stringify({ direction, line: captured }) + '\n', { mode: 0o600 });
  });
  stream.pipe(copy);
}

observe(process.stdin, 'host', (message, line) => {
  if (['initialize', 'session/prompt'].includes(message.method)) return line;
  if (['session/new', 'session/load'].includes(message.method)) {
    const loading = message.params._meta?.['pero.appToolLoading'];
    return JSON.stringify({ method: message.method, appToolLoading: loading && { app: loading.app, requiredServers: loading.requiredServers },
      mcpServerNames: (message.params.mcpServers ?? []).map(server => server.name) });
  }
});
observe(peer.stdout, 'harness', (message, line) => message.result?.agentCapabilities === undefined ? undefined : line);
process.stdin.pipe(peer.stdin);
peer.stdout.pipe(process.stdout);
peer.stdin.on('error', error => { if (error.code !== 'EPIPE') throw error; });
peer.once('error', error => { throw error; });
peer.once('close', (code, signal) => {
  process.stdin.destroy();
  process.exitCode = signal ? 1 : code ?? 1;
});
process.once('SIGTERM', () => peer.kill('SIGTERM'));
