// Operator-installed safety envelope, not CNI/runtime proof. The corresponding
// actual backend probes must pass before workloads are admitted for production.
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

export function admission(c) {
  const dns = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
  for (const k of ['namespace', 'runtimeClass', 'agentServiceAccount', 'collectorServiceAccount']) {
    if (!dns.test(c[k])) throw new Error(`invalid fixed ${k}`);
  }
  for (const k of ['agentImage', 'collectorImage']) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9:./_-]*@sha256:[a-f0-9]{64}$/.test(c[k])) throw new Error(`manifest digest required for ${k}`);
  }
  const q = JSON.stringify;
  const name = `pero-isolated-${c.namespace}`;
  const expression = [
    `has(object.spec.runtimeClassName) && object.spec.runtimeClassName == ${q(c.runtimeClass)}`,
    'has(object.spec.automountServiceAccountToken) && object.spec.automountServiceAccountToken == false',
    'size(object.spec.containers) == 1',
    '!has(object.spec.initContainers) || size(object.spec.initContainers) == 0',
    '!has(object.spec.ephemeralContainers) || size(object.spec.ephemeralContainers) == 0',
    `((object.spec.serviceAccountName == ${q(c.agentServiceAccount)} && object.spec.containers[0].name == 'agent' && object.spec.containers[0].image == ${q(c.agentImage)}) || (object.spec.serviceAccountName == ${q(c.collectorServiceAccount)} && object.spec.containers[0].name == 'collector' && object.spec.containers[0].image == ${q(c.collectorImage)}))`,
    `object.spec.volumes.all(v, has(v.persistentVolumeClaim) || has(v.emptyDir) || (has(v.projected) && v.projected.sources.all(s, has(s.serviceAccountToken) && s.serviceAccountToken.audience in ['pero-runtime', 'pero-export'])))`,
    `object.spec.containers.all(c, !has(c.envFrom) && (!has(c.env) || c.env.all(e, !has(e.valueFrom))))`,
    `object.spec.restartPolicy == 'Never'`,
  ];
  return { apiVersion: 'v1', kind: 'List', items: [
    {apiVersion:'v1',kind:'Namespace',metadata:{name:c.namespace,labels:{'pero.dev/isolation-profile':'isolated-agent-v1','pod-security.kubernetes.io/enforce':'restricted','pod-security.kubernetes.io/enforce-version':'v1.36'}}},
    {apiVersion:'admissionregistration.k8s.io/v1',kind:'ValidatingAdmissionPolicy',metadata:{name},spec:{failurePolicy:'Fail',matchConstraints:{resourceRules:[{apiGroups:[''],apiVersions:['v1'],operations:['CREATE','UPDATE'],resources:['pods','pods/ephemeralcontainers']}]},validations:expression.map(e=>({expression:e,message:'Pod violates the fixed Pero isolated-Agent envelope'}))}},
    {apiVersion:'admissionregistration.k8s.io/v1',kind:'ValidatingAdmissionPolicyBinding',metadata:{name},spec:{policyName:name,validationActions:['Deny'],matchResources:{namespaceSelector:{matchLabels:{'kubernetes.io/metadata.name':c.namespace}}}}},
    {apiVersion:'v1',kind:'ResourceQuota',metadata:{name:'pero-isolated-budget',namespace:c.namespace},spec:{hard:{pods:'4','count/persistentvolumeclaims':'4','requests.storage':'16Gi','requests.cpu':'4','requests.memory':'4Gi','limits.cpu':'8','limits.memory':'8Gi'}}},
  ]};
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stdout.write(`${JSON.stringify(admission(JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))), null, 2)}\n`);
}
