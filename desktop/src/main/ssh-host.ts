import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { z } from 'zod';
import { quoteSshArgument, sshDestination, sshPath, trustedSsh } from './ssh-desktop.ts';

const profileSchema = z.object({
  host: sshDestination,
  workspace: sshPath,
  executable: sshPath,
  desktop: sshPath.optional(),
  data: sshPath.optional(),
}).strict();
export type SshHostProfile = z.infer<typeof profileSchema>;

export function readSshHostProfile(file: string): SshHostProfile {
  return profileSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
}

/** Attach the existing Host protocol to an authenticated Linux account. */
export async function openSshHost(profile: SshHostProfile, mcp: { PERO_APP_USE_URL: string; PERO_APP_USE_TOKEN: string }) {
  const local = new URL(mcp.PERO_APP_USE_URL);
  // Pass the capability over stdin after OpenSSH allocates the reverse port.
  // It stays out of the shell command, stderr, SSH config and process arguments.
  const program = [
    'set -eu',
    'IFS= read -r PERO_APP_USE_TOKEN',
    'IFS= read -r port',
    'umask 077',
    profile.data ? `config=${quoteSshArgument(profile.data)}` : 'config="${XDG_CONFIG_HOME:-$HOME/.config}/pero"',
    'mkdir -p "$config"',
    'export PERO_SETTINGS_PATH="$config/runtime-settings.json"',
    'export PERO_AGENTS_FILE="$config/agents.json"',
    'export PERO_HISTORY_PATH="$config/history.jsonl"',
    'export PERO_MCP_EXTERNAL=1 PERO_APP_USE_TOKEN',
    'export PERO_APP_USE_URL="http://127.0.0.1:$port/mcp"',
    `cd -- ${quoteSshArgument(profile.workspace)}`,
    `exec ${quoteSshArgument(profile.executable)} --stdio`,
  ].join('\n');
  const child = spawn('/usr/bin/ssh', [...trustedSsh, '-o', 'ExitOnForwardFailure=yes', '-o', 'GatewayPorts=no',
    '-R', `127.0.0.1:0:127.0.0.1:${local.port}`, '--', profile.host, `sh -c ${quoteSshArgument(program)}`],
  { stdio: 'pipe', env: { ...process.env, LC_ALL: 'C' } });
  const stderr = createInterface({ input: child.stderr });
  try {
    const port = await new Promise<string>((resolve, reject) => {
      const deadline = AbortSignal.timeout(15_000);
      const abort = () => reject(new Error('SSH did not establish the Host control channel.'));
      deadline.addEventListener('abort', abort, { once: true });
      child.once('error', reject);
      child.once('exit', () => reject(new Error('SSH disconnected before the remote Host started.')));
      stderr.on('line', line => {
        const result = /^Allocated port (\d+) for remote forward to 127\.0\.0\.1:(\d+)$/.exec(line);
        if (result?.[2] === local.port) resolve(result[1]);
        else if (line) console.error(line);
      });
    });
    await new Promise<void>((resolve, reject) => child.stdin.write(`${mcp.PERO_APP_USE_TOKEN}\n${port}\n`,
      error => error ? reject(error) : resolve()));
    return child;
  } catch (error) {
    child.kill();
    throw error;
  } finally { stderr.close(); }
}
