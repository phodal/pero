import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { admission } from '../isolated-admission.mjs';
const config={namespace:'fixture',runtimeClass:'runsc',agentServiceAccount:'agent',collectorServiceAccount:'collector',agentImage:`registry/image@sha256:${'a'.repeat(64)}`,collectorImage:`registry/collector@sha256:${'b'.repeat(64)}`};
test('isolated admission is deny-only fixed images/runtime and restricted namespace',()=>{
 const objects=admission(config).items;
 assert.equal(objects[0].metadata.labels['pod-security.kubernetes.io/enforce'],'restricted');
 assert.equal(objects[1].spec.failurePolicy,'Fail');
 assert.deepEqual(objects[2].spec.validationActions,['Deny']);
 assert.ok(objects[1].spec.validations.some(v=>v.expression.includes(config.agentImage)));
 assert.throws(()=>admission({...config,agentImage:'registry/image:latest'}));
});
test('isolated image holds no Worker and uses init with fresh volume initialization',()=>{
 const docker=fs.readFileSync(new URL('../Dockerfile.isolated',import.meta.url),'utf8');
 const entry=fs.readFileSync(new URL('../entrypoint.isolated.sh',import.meta.url),'utf8');
 assert.ok(docker.includes('ENTRYPOINT ["/usr/bin/tini", "--"'));
 assert.ok(!docker.includes('COPY --chmod=0555 pero-worker'));
 assert.ok(entry.includes('mkdir /workspace/.pero-initialized'));
 assert.ok(entry.includes('exec /usr/local/bin/pero-agent-connect'));
});
