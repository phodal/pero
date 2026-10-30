// Offline-only operator manifest renderer. It never reads credentials or contacts Kubernetes.
import { readFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import { pathToFileURL } from 'node:url';

export const agentSandboxVersion = 'v1.0.2';
export const agentSandboxCommit = '9a85153590e54cb980f3241f9e7a9228449412c9';
const apiVersion = 'extensions.agents.x-k8s.io/v1beta1';
const namePattern = /^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?$/;
const keyPattern = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
const imagePattern = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]*@sha256:[a-f0-9]{64}$/;
function requireValue(ok, message) { if (!ok) throw new Error(message); }
function cidr(value) {
  requireValue(typeof value === 'string', 'CIDR must be text');
  const parts = value.split('/');
  const family = isIP(parts[0]);
  requireValue(parts.length === 2 && family && /^\d+$/.test(parts[1]) && Number(parts[1]) <= (family === 4 ? 32 : 128), 'Invalid reviewed egress CIDR');
  return value;
}
function https(value, originOnly) {
  const url = new URL(value);
  requireValue(url.protocol === 'https:' && !url.username && !url.password && !url.hash && !url.search && (!originOnly || url.pathname === '/'), 'Expected credential-free HTTPS URL');
  return value.replace(/\/$/, '');
}
export function manifests(input) {
  requireValue(input && typeof input === 'object' && !Array.isArray(input), 'Expected operator configuration');
  const fields = new Set(['namespace', 'name', 'image', 'workspaceRevision', 'workspaceKey', 'agentID', 'cloudURL', 'providerEndpoint', 'model', 'workerSecret', 'providerSecret', 'dnsCIDR', 'egress', 'runtimeClassName']);
  requireValue(Object.keys(input).every(key => fields.has(key)), 'Unknown operator configuration field');
  const c = { ...input };
  for (const key of ['namespace', 'name', 'workerSecret', 'providerSecret']) requireValue(typeof c[key] === 'string' && namePattern.test(c[key]), `Invalid ${key}`);
  for (const key of ['workspaceKey', 'agentID']) requireValue(typeof c[key] === 'string' && keyPattern.test(c[key]), `Invalid ${key}`);
  requireValue(imagePattern.test(c.image || ''), 'Worker image must be pinned by manifest sha256 digest');
  requireValue(/^[a-f0-9]{40}$/.test(c.workspaceRevision || ''), 'Workspace revision must be a full reviewed Git commit');
  requireValue(typeof c.model === 'string' && c.model.length > 0 && c.model.length <= 128 && !/[\r\n\x00]/.test(c.model), 'Invalid fixed model');
  c.cloudURL = https(c.cloudURL, true); c.providerEndpoint = https(c.providerEndpoint, false);
  if (c.runtimeClassName !== undefined) requireValue(namePattern.test(c.runtimeClassName), 'Invalid explicit RuntimeClass');
  requireValue(Array.isArray(c.egress) && c.egress.length > 0 && c.egress.length <= 16, 'Reviewed egress CIDR/port rules are required');
  const egress = c.egress.map(rule => {
    requireValue(rule && Object.keys(rule).length === 2 && Number.isInteger(rule.port) && rule.port > 0 && rule.port <= 65535, 'Expected egress cidr and port');
    return { to: [{ ipBlock: { cidr: cidr(rule.cidr) } }], ports: [{ protocol: 'TCP', port: rule.port }] };
  });
  egress.push({ to: [{ ipBlock: { cidr: cidr(c.dnsCIDR) } }], ports: [{ protocol: 'UDP', port: 53 }, { protocol: 'TCP', port: 53 }] });
  const configName = `${c.name}-config`, templateName = `${c.name}-template`, poolName = `${c.name}-pool`;
  const metadata = name => ({ name, namespace: c.namespace });
  const secret = (name, secretName, key) => ({ name, valueFrom: { secretKeyRef: { name: secretName, key } } });
  const config = {
    apiVersion: 'v1', kind: 'ConfigMap', metadata: metadata(configName), immutable: true,
    data: {
      'worker.json': JSON.stringify({ workspaces: { [c.workspaceKey]: '/workspace/repo' }, agents_file: '/etc/pero/agents.json', allowed_agents: { [c.workspaceKey]: [c.agentID] } }),
      'agents.json': JSON.stringify([{ id: c.agentID, name: 'Pero ACP', command: '/usr/local/bin/pero-agent-acp', args: ['--endpoint', c.providerEndpoint, '--model', c.model, '--session-dir', '/state/sessions', '--workspace', '/workspace/repo', '--approval', 'ask'], env: {} }]),
    },
  };
  const podSpec = {
    automountServiceAccountToken: false, enableServiceLinks: false,
    restartPolicy: 'Never', terminationGracePeriodSeconds: 30,
    ...(c.runtimeClassName ? { runtimeClassName: c.runtimeClassName } : {}),
    securityContext: { runAsNonRoot: true, runAsUser: 10001, runAsGroup: 10001, fsGroup: 10001, seccompProfile: { type: 'RuntimeDefault' } },
    containers: [{ name: 'worker', image: c.image, imagePullPolicy: 'IfNotPresent',
      securityContext: { allowPrivilegeEscalation: false, readOnlyRootFilesystem: true, capabilities: { drop: ['ALL'] } },
      env: [
        { name: 'PERO_RUNTIME_POD_UID', valueFrom: { fieldRef: { fieldPath: 'metadata.uid' } } },
        { name: 'PERO_WORKSPACE_REVISION', value: c.workspaceRevision },
        { name: 'PERO_CLOUD_URL', value: c.cloudURL },
        { name: 'PERO_WORKER_CONFIG', value: '/etc/pero/worker.json' },
        { name: 'PERO_WORKER_STATE', value: '/state/worker.json' },
        secret('PERO_WORKER_TOKEN', c.workerSecret, 'token'),
        secret('AGENT_PROVIDER_API_KEY', c.providerSecret, 'api-key'),
      ],
      resources: { requests: { cpu: '250m', memory: '256Mi', 'ephemeral-storage': '1Gi' }, limits: { cpu: '2', memory: '2Gi', 'ephemeral-storage': '6Gi' } },
      volumeMounts: [{ name: 'config', mountPath: '/etc/pero', readOnly: true }, { name: 'workspace', mountPath: '/workspace' }, { name: 'state', mountPath: '/state' }, { name: 'tmp', mountPath: '/tmp' }, { name: 'home', mountPath: '/home/pero' }],
    }],
    volumes: [{ name: 'config', configMap: { name: configName, defaultMode: 292 } }, { name: 'workspace', emptyDir: { sizeLimit: '4Gi' } }, { name: 'state', emptyDir: { sizeLimit: '1Gi' } }, { name: 'tmp', emptyDir: { sizeLimit: '256Mi' } }, { name: 'home', emptyDir: { sizeLimit: '32Mi' } }],
  };
  return { apiVersion: 'v1', kind: 'List', items: [config, {
    apiVersion, kind: 'SandboxTemplate', metadata: metadata(templateName),
    spec: { service: false, envVarsInjectionPolicy: 'Disallowed', volumeClaimTemplatesPolicy: 'Disallowed', networkPolicyManagement: 'Managed', networkPolicy: { ingress: [], egress }, podTemplate: { metadata: { labels: { 'pero.dev/runtime': c.name } }, spec: podSpec } },
  }, {
    apiVersion, kind: 'SandboxWarmPool', metadata: metadata(poolName),
    spec: { replicas: 1, updateStrategy: { type: 'OnReplenish' }, sandboxTemplateRef: { name: templateName } },
  }] };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 3) throw new Error('Usage: node deployment/agent-sandbox/render.mjs operator-config.json');
  process.stdout.write(`${JSON.stringify(manifests(JSON.parse(await readFile(process.argv[2], 'utf8'))), null, 2)}\n`);
}
