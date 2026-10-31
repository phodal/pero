import { realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { scienceSpecs, scienceVersion } from './specs.mjs';
import { pinScienceFile, scienceTreeDigest } from './runtime.mjs';

export const scienceBundleCandidates = [];
export async function discoverScience(provider, { nodes, home, bundles = scienceBundleCandidates }) {
  const found = { command: nodes.filter(node => node.executable).slice(0, 1), matlabRoot: [], extensionFile: [], setupError: null };
  const spec = scienceSpecs.find(item => item.providerId === provider.providerId);
  let bundle;
  for (const path of bundles) { try { bundle = await pinScienceFile(path); break; } catch { /* not built here */ } }
  if (!spec || !bundle || !found.command.length) { found.setupError = !bundle ? 'SCIENCE_ADAPTER_MISSING' : 'SCIENCE_NODE_MISSING'; return { found, definition: null }; }
  try {
    const root = await realpath(join(home, '.claude-science/runtime', scienceVersion, 'mcp-servers'));
    await pinScienceFile(join(root, spec.domain === 'ketcher' ? 'ketcher-chemistry/server.js' : `bio-tools/lib/mcp_${spec.domain}/server.py`));
    if (spec.domain !== 'ketcher') await pinScienceFile(join(root, 'bio-tools/run_server.py'));
    const digest = await scienceTreeDigest(root);
    const python = spec.domain === 'ketcher' ? null : await pinScienceFile(join(home, '.claude-science/conda/envs/claude-science-mcp/bin/python'));
    if (python && !python.executable) throw new Error('SCIENCE_PYTHON_NOT_EXECUTABLE');
    return { found, definition: {
      transport: 'stdio', command: found.command[0].path, sha256: found.command[0].sha256, args: [bundle.path, '--domain', spec.domain],
      files: [{ path: bundle.path, sha256: bundle.sha256 }, ...(python ? [{ path: python.path, sha256: python.sha256 }] : [])],
      env: { POINT_SCIENCE_ROOT: root, POINT_SCIENCE_SOURCE_SHA256: digest,
        ...(python ? { POINT_SCIENCE_PYTHON: python.path, POINT_SCIENCE_PYTHON_SHA256: python.sha256 } : {}) },
      initializeTimeoutMs: 45000, callTimeoutMs: 45000, tools: [...spec.tools],
    } };
  } catch { found.setupError = 'SCIENCE_RUNTIME_MISSING_OR_INVALID'; return { found, definition: null }; }
}
