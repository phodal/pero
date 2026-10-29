import assert from 'node:assert/strict';
import test from 'node:test';
import { manifests, agentSandboxVersion, agentSandboxCommit } from '../render.mjs';
const config = {
  namespace: 'pero-runtime', name: 'reviewed-v1', image: `example.invalid/pero@sha256:${'a'.repeat(64)}`,
  workspaceRevision: 'b'.repeat(40), workspaceKey: 'repo', agentID: 'dsh',
  cloudURL: 'https://control.example.invalid', providerEndpoint: 'https://model.example.invalid/v1', model: 'reviewed-model',
  workerSecret: 'existing-worker', providerSecret: 'existing-provider', dnsCIDR: '10.96.0.10/32', egress: [{ cidr: '192.0.2.10/32', port: 443 }],
};
test('fixed template describes a trusted outbound-only Worker with local ACP, not a desktop', () => {
  const { items: [cm, template, pool] } = manifests(config);
  assert.equal(agentSandboxVersion, 'v1.0.2'); assert.equal(agentSandboxCommit, '9a85153590e54cb980f3241f9e7a9228449412c9');
  assert.equal(cm.immutable, true);
  const worker = JSON.parse(cm.data['worker.json']), [agent] = JSON.parse(cm.data['agents.json']);
  assert.deepEqual(worker.workspaces, { repo: '/workspace/repo' }); assert(!worker.native_approvals);
  assert.equal(agent.command, '/usr/local/bin/pero-agent-acp'); assert.deepEqual(agent.env, {});
  assert(agent.args.includes('ask')); assert(!agent.args.includes('--enable-shell')); assert(!agent.args.includes('--approval never'));
  assert.equal(template.apiVersion, 'extensions.agents.x-k8s.io/v1beta1');
  assert.equal(template.spec.service, false); assert.equal(template.spec.envVarsInjectionPolicy, 'Disallowed'); assert.equal(template.spec.volumeClaimTemplatesPolicy, 'Disallowed');
  assert.deepEqual(template.spec.networkPolicy.ingress, []); assert.equal(template.spec.networkPolicy.egress.length, 2);
  const pod = template.spec.podTemplate.spec, [container] = pod.containers;
  assert.equal(pod.restartPolicy, 'Never'); assert.equal(pod.automountServiceAccountToken, false); assert.equal(pod.enableServiceLinks, false); assert(!pod.runtimeClassName);
  assert.deepEqual(pod.securityContext, { runAsNonRoot: true, runAsUser: 10001, runAsGroup: 10001, fsGroup: 10001, seccompProfile: { type: 'RuntimeDefault' } });
  assert.deepEqual(container.securityContext, { allowPrivilegeEscalation: false, readOnlyRootFilesystem: true, capabilities: { drop: ['ALL'] } });
  assert.equal(container.image, config.image); assert(!container.ports); assert(!pod.hostNetwork); assert(!pod.hostPID);
  assert(pod.volumes.every(v => !v.hostPath && !v.projected));
  assert.equal(container.env.find(e => e.name === 'PERO_RUNTIME_POD_UID').valueFrom.fieldRef.fieldPath, 'metadata.uid');
  assert.equal(container.env.find(e => e.name === 'PERO_WORKER_TOKEN').valueFrom.secretKeyRef.name, 'existing-worker');
  assert(!JSON.stringify(cm).includes('secret')); assert(!JSON.stringify(template).includes('kubeconfig'));
  assert.equal(pool.spec.replicas, 1); assert.equal(pool.spec.sandboxTemplateRef.name, template.metadata.name);
});
test('invalid or unreviewed deployment inputs fail before emitting a manifest', () => {
  for (const change of [
    { image: 'example.invalid/pero:latest' }, { workspaceRevision: 'main' }, { cloudURL: 'http://control.example.invalid' },
    { providerEndpoint: 'https://user:secret@model.example.invalid/v1' }, { namespace: 'a/b' }, { runtimeClassName: 'a/b' },
    { workerToken: 'must-not-be-an-input' }, { egress: [] }, { egress: [{ cidr: 'bad', port: 443 }] }, { dnsCIDR: '10.0.0.1/33' },
    { egress: [{ cidr: '192.0.2.10/32', port: 443, another: true }] },
  ]) assert.throws(() => manifests({ ...config, ...change }));
  assert.equal(manifests({ ...config, runtimeClassName: 'operator-verified-kata' }).items[1].spec.podTemplate.spec.runtimeClassName, 'operator-verified-kata');
});

test('image starts in the mounted volume root before preparing the repository directory', async () => {
  const { readFile } = await import('node:fs/promises');
  const dockerfile = await readFile(new URL('../Dockerfile', import.meta.url), 'utf8');
  assert.match(dockerfile, /^WORKDIR \/workspace$/m);
  assert.doesNotMatch(dockerfile, /^WORKDIR \/workspace\/repo$/m);
  assert.match(dockerfile, /^USER 10001:10001$/m);
});
