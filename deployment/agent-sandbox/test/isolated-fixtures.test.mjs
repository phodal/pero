import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { baseline, probeJob, namespaces } from '../isolated/fixtures.mjs';
const image=`127.0.0.1:1234/probe@sha256:${'a'.repeat(64)}`;
test('canaries isolate source egress without a destination-denial false positive',()=>{
 const b=baseline(image);const policies=b.items.filter(o=>o.kind==='NetworkPolicy');
 for(const ns of [namespaces.a,namespaces.b,namespaces.runtime]) {
  assert.deepEqual(policies.find(o=>o.metadata.namespace===ns&&o.metadata.name==='default-deny').spec,{podSelector:{},policyTypes:['Ingress','Egress']});
  assert.deepEqual(policies.find(o=>o.metadata.namespace===ns&&o.metadata.name==='canary-target-ingress').spec.ingress,[{}]);
 }
 const targets=[{name:'relay',ip:'10.96.0.2',port:8080},{name:'neighbor-b',ip:'10.96.0.3',port:8080},{name:'synthetic-dns',ip:'10.96.0.2',port:53,protocol:'dns'}];
 for(const mode of ['positive-control','isolated']){
  const r=probeJob({mode,image,targets});const config=JSON.parse(r.items.find(o=>o.kind==='ConfigMap').data['config.json']);
  assert.deepEqual(config.targets.map(t=>t.allow),mode==='isolated'?[true,false,false]:[true,true,true]);
  const job=r.items.find(o=>o.kind==='Job');assert.equal(job.spec.backoffLimit,0);assert.equal(job.spec.template.spec.runtimeClassName,'runsc');assert.equal(job.spec.template.spec.automountServiceAccountToken,false);
 }
});
test('fixture rejects mutable image tags and ambiguous targets',()=>{
 assert.throws(()=>baseline('probe:latest'));
 const c={mode:'isolated',image,targets:[{name:'relay',ip:'10.96.0.2',port:8080}]};
 for(const targets of [[],[{name:'relay',ip:'example.com',port:80}],[...c.targets,...c.targets],[{name:'relay',ip:'10.96.0.2',port:0}]])assert.throws(()=>probeJob({...c,targets}));
});
test('tool downloads are versioned and digest pinned',async()=>{
 const pins=JSON.parse(await readFile(new URL('../isolated/pins.json',import.meta.url),'utf8'));
 for(const name of ['kind','helm','gvisor','cilium','cniPlugins','agentSandbox']){
  assert.match(pins[name].sha256,/^[a-f0-9]{64}$/);assert.match(pins[name].url,/^https:\/\//);assert.doesNotMatch(pins[name].url,/latest/);
 }
 assert.match(pins.minio.commit,/^[a-f0-9]{40}$/);
});

test('real acceptance cannot pass with missing, skipped, or failed subtests',async()=>{
 const {requireTestPass}=await import('../isolated/require-test-pass.mjs');
 const pass={Test:'TestReal',Action:'pass'};
 const lines=rs=>rs.map(r=>JSON.stringify(r)).join('\n');
 requireTestPass(lines([{Test:'TestReal/case',Action:'pass'},pass]),'TestReal');
 for(const records of [[],[{Test:'TestReal',Action:'skip'}],[pass,pass],[{Test:'TestReal/case',Action:'skip'},pass],[{Test:'TestReal/case',Action:'fail'},pass]])assert.throws(()=>requireTestPass(lines(records),'TestReal'));
});

test('live fixture refuses execution outside its separately authorized CI gate',async()=>{
 const {spawnSync}=await import('node:child_process');
 const env={...process.env};delete env.GITHUB_ACTIONS;delete env.PERO_ISOLATED_ACCEPTANCE;
 const r=spawnSync('bash',[new URL('../isolated-kind.sh',import.meta.url).pathname],{env,encoding:'utf8'});
 assert.equal(r.status,2);assert.match(r.stderr,/separately authorized isolated CI gate/);
 const probe=spawnSync('bash',[new URL('../isolated/probe-pod.sh',import.meta.url).pathname],{env,encoding:'utf8'});assert.equal(probe.status,2);
});


test('IPv4 CNI prerequisite fixes plugin order, exact sysctls and immutable source',async()=>{
 const {conflist,configMap,allowlist,verifyInstalled}=await import('../isolated/ipv4-cni.mjs');
 const valid=conflist();
 verifyInstalled(valid,allowlist,'05-cilium.conflist\n');
 assert.equal(configMap().immutable,true);
 assert.deepEqual(JSON.parse(configMap().data['cni-config']),valid);
 assert.deepEqual(valid.plugins.map(p=>p.type),['cilium-cni','tuning']);
 const rules=allowlist.trim().split('\n').map(r=>new RegExp(r));
 for(const key of ['net.ipv6.conf.all.disable_ipv6','net.ipv6.conf.default.disable_ipv6'])assert.ok(rules.some(r=>r.test(key)));
 for(const key of ['net.ipv6.conf.eth0.disable_ipv6','net.ipv4.ip_forward','kernel.domainname','netXipv6.conf.all.disable_ipv6','net.ipv6.conf.all.disable_ipv6.extra'])assert.ok(!rules.some(r=>r.test(key)));
 for(const change of [
  c=>c.plugins.reverse(), c=>c.plugins.pop(),
  c=>c.plugins[1].sysctl['net.ipv6.conf.all.disable_ipv6']='0',
  c=>c.plugins[1].sysctl['kernel.domainname']='unexpected',
  c=>c.plugins[1].args={cni:{sysctl:{'net.ipv6.conf.all.disable_ipv6':'0'}}},
  c=>c.plugins[1].runtimeConfig={mac:'02:00:00:00:00:01'},
  c=>c.plugins[1].capabilities={mac:true}, c=>c.plugins[1].mtu=1200,
 ]) {const changed=structuredClone(valid);change(changed);assert.throws(()=>verifyInstalled(changed,allowlist,'05-cilium.conflist'));}
 for(const rules of ['', '.*\n', allowlist+'^net\\.ipv4.*$\n'])assert.throws(()=>verifyInstalled(valid,rules,'05-cilium.conflist'));
 for(const files of ['', '05-cilium.conflist\n10-other.conf', '10-other.conflist'])assert.throws(()=>verifyInstalled(valid,allowlist,files));
});
