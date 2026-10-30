// CI-only synthetic infrastructure probes; not production workload manifests.
import { readFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import { pathToFileURL } from 'node:url';
export const namespaces = { control: 'pero-isolation-control', a: 'pero-isolation-a', b: 'pero-isolation-b', runtime: 'pero-isolated-runtime' };
const metadata = (name, namespace, labels) => ({ name, ...(namespace ? { namespace } : {}), ...(labels ? { labels } : {}) });
const list = items => ({ apiVersion: 'v1', kind: 'List', items });
function image(value) { if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]*@sha256:[a-f0-9]{64}$/.test(value)) throw Error('Expected observed registry image digest'); return value; }
function hardened(name, img, args, extra = {}) {
 return { name, image: image(img), args, securityContext: { allowPrivilegeEscalation: false, readOnlyRootFilesystem: true, capabilities: { drop: ['ALL'] } }, resources: { requests: { cpu: '25m', memory: '16Mi' }, limits: { cpu: '250m', memory: '128Mi' } }, ...extra };
}
const podSpec = containers => ({ runtimeClassName: 'runsc', automountServiceAccountToken: false, enableServiceLinks: false, restartPolicy: 'Never', securityContext: { runAsNonRoot: true, runAsUser: 10001, runAsGroup: 10001, seccompProfile: { type: 'RuntimeDefault' } }, containers });
export function baseline(img) {
 image(img);
 const items = Object.entries(namespaces).map(([key,ns]) => ({ apiVersion: 'v1', kind: 'Namespace', metadata: metadata(ns, null, { 'pod-security.kubernetes.io/enforce': key === 'control' ? 'privileged' : 'restricted', 'pod-security.kubernetes.io/enforce-version': 'v1.36', 'pero.dev/isolated-fixture': 'true' }) }));
 for (const ns of [namespaces.a,namespaces.b,namespaces.runtime]) {
  items.push({ apiVersion:'networking.k8s.io/v1',kind:'NetworkPolicy',metadata:metadata('default-deny',ns),spec:{podSelector:{},policyTypes:['Ingress','Egress']} });
  // These contain only a synthetic listener. Allow ingress so an egress-denial
  // result cannot be a false positive caused by the destination blocking it.
  items.push({ apiVersion:'networking.k8s.io/v1',kind:'NetworkPolicy',metadata:metadata('canary-target-ingress',ns),spec:{podSelector:{matchLabels:{role:'canary-target'}},policyTypes:['Ingress'],ingress:[{}]} });
 }
 for (const [name,ns] of [['relay',namespaces.control],['neighbor-a',namespaces.a],['neighbor-b',namespaces.b],['product-neighbor',namespaces.runtime]]) {
  const labels={role:'canary-target',app:name};const spec=podSpec([hardened('target',img,['--mode=serve'])]);spec.restartPolicy='Always';
  spec.containers[0].readinessProbe={httpGet:{path:'/healthz',port:8080},periodSeconds:1};
  items.push({apiVersion:'apps/v1',kind:'Deployment',metadata:metadata(name,ns),spec:{replicas:1,selector:{matchLabels:labels},template:{metadata:{labels},spec}}});
  items.push({apiVersion:'v1',kind:'Service',metadata:metadata(name,ns),spec:{selector:labels,ports:[{port:8080,targetPort:8080,name:'http'},{port:53,targetPort:18053,protocol:'UDP',name:'dns'}]}});
 }
 // Owned-node listener proves node/link-local/documentation-IP targets are
 // reachable from the positive control. It has no tokens, mounts or host PID.
 items.push({apiVersion:'apps/v1',kind:'DaemonSet',metadata:metadata('node-target',namespaces.control),spec:{selector:{matchLabels:{app:'node-target'}},template:{metadata:{labels:{app:'node-target'}},spec:{automountServiceAccountToken:false,enableServiceLinks:false,hostNetwork:true,securityContext:{runAsNonRoot:true,runAsUser:10001,runAsGroup:10001,seccompProfile:{type:'RuntimeDefault'}},tolerations:[{operator:'Exists'}],containers:[hardened('target',img,['--mode=serve','--listen=:18080'],{readinessProbe:{httpGet:{path:'/healthz',port:18080},periodSeconds:1}})]}}}});
 return list(items);
}
export function probeJob(c) {
 if (!c || !['positive-control','isolated'].includes(c.mode) || !Array.isArray(c.targets) || !c.targets.length || c.targets.length>16) throw Error('Invalid probe configuration');
 image(c.image);
 const names=new Set();
 for (const t of c.targets) {
  if (!t || !/^[a-z][a-z0-9-]{0,63}$/.test(t.name) || names.has(t.name) || !isIP(t.ip) || (t.protocol!==undefined&&!['tcp','dns'].includes(t.protocol)) || !Number.isInteger(t.port)||t.port<1||t.port>65535) throw Error('Invalid canary target');
  names.add(t.name);
 }
 if (!c.targets.some(t=>t.name==='relay'&&(t.protocol??'tcp')==='tcp')) throw Error('Positive relay control is required');
 const ns=c.mode==='isolated'?namespaces.a:namespaces.control;
 const config={targets:c.targets.map(t=>({name:t.name,protocol:t.protocol??'tcp',address:isIP(t.ip)===6?`[${t.ip}]:${t.port}`:`${t.ip}:${t.port}`,allow:c.mode==='positive-control'||(t.name==='relay'&&(t.protocol??'tcp')==='tcp')}))};
 const name=`probe-${c.mode}`;
 const container=hardened('probe',c.image,['--mode=probe','--config=/fixture/config.json'],{volumeMounts:[{name:'fixture',mountPath:'/fixture',readOnly:true}]});
 const spec=podSpec([container]);spec.volumes=[{name:'fixture',configMap:{name}}];
 const items=[{apiVersion:'v1',kind:'ConfigMap',metadata:metadata(name,ns),immutable:true,data:{'config.json':JSON.stringify(config)}},{apiVersion:'batch/v1',kind:'Job',metadata:metadata(name,ns),spec:{backoffLimit:0,activeDeadlineSeconds:60,template:{metadata:{labels:{role:'canary-probe'}},spec}}}];
 if(c.mode==='isolated'){
  const relay=c.targets.find(t=>(t.name==='relay'&&(t.protocol??'tcp')==='tcp'));
  items.unshift({apiVersion:'networking.k8s.io/v1',kind:'NetworkPolicy',metadata:metadata('relay-only',ns),spec:{podSelector:{matchLabels:{role:'canary-probe'}},policyTypes:['Egress'],egress:[{to:[{namespaceSelector:{matchLabels:{'kubernetes.io/metadata.name':namespaces.control}},podSelector:{matchLabels:{app:'relay'}}}],ports:[{protocol:'TCP',port:relay.port}]}]}});
 }
 return list(items);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const [mode,arg]=process.argv.slice(2);
 const result=mode==='baseline'?baseline(arg):mode==='probe'?probeJob(JSON.parse(await readFile(arg,'utf8'))):(()=>{throw Error('Usage: fixtures.mjs baseline IMAGE | probe CONFIG');})();
 process.stdout.write(`${JSON.stringify(result,null,2)}\n`);
}
