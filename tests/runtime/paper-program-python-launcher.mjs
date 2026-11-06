// App process shim only: all routes and research behavior belong to the real Python backend.
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const config = JSON.parse(await readFile(new URL('./fixture.json', import.meta.url), 'utf8'));
const child = spawn(config.python, ['-s', '-u', '-B', fileURLToPath(new URL('./backend.py', import.meta.url))],
  { env: process.env, windowsHide: true, stdio: ['pipe', 'inherit', 'inherit'] });
child.on('error', error => { console.error(error); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code || 0; });
process.on('SIGTERM', () => child.stdin.end());
process.on('SIGINT', () => child.stdin.end());
