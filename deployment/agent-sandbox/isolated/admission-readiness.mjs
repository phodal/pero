// Observation only: no Kubernetes mutation or policy weakening in this helper.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function verifyAdmissionTargets(manifest, binding, namespace) {
 const wanted = manifest.items.find(o => o.kind === 'ValidatingAdmissionPolicyBinding');
 const ns = manifest.items.find(o => o.kind === 'Namespace');
 assert.equal(binding.apiVersion, wanted.apiVersion);
 assert.equal(binding.kind, wanted.kind);
 assert.equal(binding.metadata.name, wanted.metadata.name);
 assert.ok(binding.metadata.uid && binding.metadata.deletionTimestamp == null);
 const spec = structuredClone(binding.spec);
 // These are API defaults, not permission to add matching exclusions.
 spec.matchResources.matchPolicy ??= 'Equivalent';
 spec.matchResources.objectSelector ??= {};
 assert.deepEqual(spec, {...wanted.spec, matchResources: {
  matchPolicy: 'Equivalent', objectSelector: {}, ...wanted.spec.matchResources,
 }});
 assert.equal(namespace.kind, 'Namespace');
 assert.equal(namespace.metadata.name, ns.metadata.name);
 assert.ok(namespace.metadata.uid && namespace.metadata.deletionTimestamp == null);
 for (const [key, value] of Object.entries({...ns.metadata.labels, 'kubernetes.io/metadata.name': ns.metadata.name})) {
  assert.equal(namespace.metadata.labels[key], value, `namespace label ${key}`);
 }
}

export function admissionActivation(policy, status, output) {
 assert.match(policy, /^pero-isolated-[a-z0-9-]+$/);
 assert.ok(Number.isInteger(status) && status >= 0 && status <= 255);
 if (status === 0) return 'pending'; // Dry-run only; never an accepted live Pod.
 const denial = `ValidatingAdmissionPolicy '${policy}' with binding '${policy}' denied request: Pod violates the fixed Pero isolated-Agent envelope`;
 if (output.includes(denial)) return 'ready';
 throw Error('Admission activation failed without the exact policy/binding denial');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
 const [mode, a, b, c] = process.argv.slice(2);
 if (mode === 'targets') {
  const read = path => JSON.parse(readFileSync(path, 'utf8'));
  verifyAdmissionTargets(read(a), read(b), read(c));
 } else if (mode === 'activation') {
  const state = admissionActivation(a, Number(b), readFileSync(c, 'utf8'));
  process.stdout.write(JSON.stringify({state, exit_status: Number(b)}) + '\n');
  process.exitCode = state === 'ready' ? 0 : 3;
 } else throw Error('expected targets or activation');
}
