import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import type { StartRepl } from './repl.ts';

export const startJavaScriptRepl: StartRepl = (receive, fail) => {
  const worker = new Worker(join(__dirname, 'javascript-repl.cjs'));
  worker.on('message', receive);
  worker.once('error', fail);
  worker.once('exit', () => fail(new Error('JavaScript REPL worker exited.')));
  return { send: message => worker.postMessage(message), stop: () => { void worker.terminate(); } };
};
