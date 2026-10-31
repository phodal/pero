import { posix, win32 } from 'node:path';

const fail = code => Object.assign(new Error(code), { code });

/** Host configuration contract, independent of the OS-specific service launcher.
 * A Windows adapter must implement the same bounded stream/closed/terminate
 * endpoint; it must not advertise readiness before owned-tree cleanup works. */
export function mcpServiceReadiness({ backend = 'portable', platform = process.platform } = {}) {
  if (!['xpc', 'portable'].includes(backend)) return { ready: false, code: 'MCP_BACKEND_UNSUPPORTED' };
  if (backend === 'xpc') return { ready: false, backend, code: 'MCP_XPC_UNAVAILABLE' };
  if (!['linux', 'darwin'].includes(platform)) return { ready: false, backend, code: 'MCP_PLATFORM_UNSUPPORTED',
    reason: platform === 'win32' ? 'Windows requires a verified owned-process-tree adapter (Job Objects)' : 'Portable MCP runtime requires macOS or Linux' };
  return { ready: true, backend, transport: 'stdio', control: 'host-registry', credentials: false, transports: ['builtin', 'stdio', 'http'] };
}

export function validateMCPServiceConfig({ executable, backend = 'portable', registry, managedConnectors = false, credentialStoreExecutable, channelExecutable, credentialStoreSha256, channelSha256 }, { platform = process.platform } = {}) {
  const paths = platform === 'win32' ? win32 : posix;
  if (typeof executable !== 'string' || !paths.isAbsolute(executable) || /[\0\r\n]/.test(executable)) throw fail('MCP_CONFIG');
  if (!['xpc', 'portable'].includes(backend)) throw fail('MCP_BACKEND_UNSUPPORTED');
  if (backend === 'portable') {
    if (typeof registry !== 'string' || !paths.isAbsolute(registry) || /[\0\r\n]/.test(registry)) throw fail('MCP_CONFIG');
    if (typeof managedConnectors !== 'boolean') throw fail('MCP_CONFIG');
    for (const helper of [credentialStoreExecutable, channelExecutable]) if (helper !== undefined && (typeof helper !== 'string' || !paths.isAbsolute(helper) || /[\0\r\n]/.test(helper))) throw fail('MCP_CONFIG');
    for (const [helper, digest] of [[credentialStoreExecutable, credentialStoreSha256], [channelExecutable, channelSha256]]) if (digest !== undefined && (helper === undefined || typeof digest !== 'string' || !/^[a-f0-9]{64}$/.test(digest))) throw fail('MCP_CONFIG');
  } else if (registry !== undefined || credentialStoreExecutable !== undefined || channelExecutable !== undefined || credentialStoreSha256 !== undefined || channelSha256 !== undefined) throw fail('MCP_CONFIG');
  const readiness = mcpServiceReadiness({ backend, platform });
  if (!readiness.ready) throw Object.assign(fail(readiness.code), { message: readiness.reason ?? readiness.code });
  return Object.freeze({ executable, backend, ...(registry === undefined ? {} : { registry }), ...(credentialStoreExecutable === undefined ? {} : { credentialStoreExecutable }), ...(channelExecutable === undefined ? {} : { channelExecutable }), ...(credentialStoreSha256 === undefined ? {} : { credentialStoreSha256 }), ...(channelSha256 === undefined ? {} : { channelSha256 }) });
}
