import { execFile, spawn } from 'node:child_process';
import { access, readFile, realpath } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { z } from 'zod';
import type { StartRepl } from './repl.ts';

const event = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('call'), cell: z.string(), id: z.string(),
    capability: z.enum(['browser', 'computer']), input: z.unknown() }),
  z.strictObject({ type: z.literal('write'), cell: z.string(), text: z.string() }),
  z.strictObject({ type: z.literal('image'), cell: z.string(), id: z.string() }),
  z.strictObject({ type: z.literal('done'), cell: z.string(), error: z.string().optional() }),
]);

export function pythonRepl(helpers: string, bundledPython?: string): StartRepl {
  const sandbox = '/usr/bin/sandbox-exec';
  let config: { interpreter: string; profile: string; source: string } | undefined;
  return async (receive, fail) => {
    if (!config) {
      let interpreter: string, runtime: string;
      try {
        await access(sandbox);
        if (bundledPython) {
          interpreter = await realpath(bundledPython);
          runtime = dirname(dirname(interpreter));
        } else {
          const { stdout } = await promisify(execFile)('/usr/bin/xcrun', ['--find', 'python3'], {
            env: {}, timeout: 2_000,
          });
          runtime = dirname(dirname(await realpath(stdout.trim())));
          interpreter = join(runtime, 'Resources/Python.app/Contents/MacOS/Python');
        }
        await access(interpreter);
      } catch {
        throw new Error(bundledPython
          ? 'The Native REPL could not start its bundled Python or the macOS sandbox launcher.'
          : 'The Native development REPL requires Apple Python 3 from Xcode or Command Line Tools and the macOS sandbox launcher.');
      }
      const source = await readFile(join(helpers, 'python-repl.py'), 'utf8');
      const profile = `(version 1)
        (deny default)
        (allow process-exec (literal ${JSON.stringify(interpreter)}))
        (allow sysctl-read)
        (allow file-read* (subpath ${JSON.stringify(runtime)}) (subpath "/System/Library")
          (subpath "/usr/lib") (literal "/") (literal "/dev/null") (literal "/dev/urandom"))`;
      config = { interpreter, profile, source };
    }
    const { interpreter, profile, source } = config;
    const child = spawn(sandbox, ['-p', profile, interpreter, '-I', '-S', '-u', '-c', source], {
      cwd: '/', env: {}, stdio: ['pipe', 'pipe', 'pipe'],
    });
    let line = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      const lines = (line + chunk).split('\n');
      line = lines.pop()!;
      if (line.length > 400_000 || lines.some(value => value.length > 400_000)) {
        fail(new Error('Python REPL produced an oversized protocol message.'));
        return;
      }
      for (const value of lines) {
        try {
          receive(event.parse(JSON.parse(value)));
        } catch {
          fail(new Error('Python REPL produced an invalid protocol message.'));
          return;
        }
      }
    });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr = (stderr + chunk).slice(-1000); });
    child.stdin.on('error', fail);
    child.once('error', fail);
    child.once('close', (code, signal) => fail(new Error(
      `Sandboxed Python REPL exited (${code ?? signal}).${stderr ? ' ' + stderr.trim() : ''}`,
    )));
    return {
      send: message => { child.stdin.write(JSON.stringify(message) + '\n'); },
      stop: () => { child.stdin.destroy(); child.kill('SIGKILL'); },
    };
  };
}
