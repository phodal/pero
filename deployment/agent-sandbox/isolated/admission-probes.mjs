// Server-side dry-run fixtures. None of these Pods is created or scheduled.
import { readFile } from 'node:fs/promises';
const [configPath,variant]=process.argv.slice(2);
if(!['valid','wrong-runtime','privileged','hostpath'].includes(variant))throw Error('Unknown admission probe');
const c=JSON.parse(await readFile(configPath,'utf8'));
const pod={apiVersion:'v1',kind:'Pod',metadata:{name:`pero-admission-${variant}`,namespace:c.namespace},spec:{
 runtimeClassName:c.runtimeClass,serviceAccountName:c.agentServiceAccount,automountServiceAccountToken:false,restartPolicy:'Never',
 securityContext:{runAsNonRoot:true,runAsUser:10001,runAsGroup:10001,seccompProfile:{type:'RuntimeDefault'}},
 containers:[{name:'agent',image:c.agentImage,securityContext:{allowPrivilegeEscalation:false,readOnlyRootFilesystem:true,capabilities:{drop:['ALL']}},resources:{requests:{cpu:'25m',memory:'16Mi'},limits:{cpu:'250m',memory:'128Mi'}},volumeMounts:[{name:'workspace',mountPath:'/workspace'}]}],
 volumes:[{name:'workspace',persistentVolumeClaim:{claimName:'dry-run-not-created'}}]
}};
// Omission selects the default runtime; do not use a nonexistent RuntimeClass
// whose lookup failure would make an absent admission policy look enforced.
if(variant==='wrong-runtime')delete pod.spec.runtimeClassName;
// Keep this unsafe probe API-valid: Kubernetes rejects privileged=true with
// allowPrivilegeEscalation=false before PSS/admission can evaluate it.
if(variant==='privileged')Object.assign(pod.spec.containers[0].securityContext,{privileged:true,allowPrivilegeEscalation:true});
if(variant==='hostpath')pod.spec.volumes=[{name:'workspace',hostPath:{path:'/tmp/never-mounted-by-dry-run'}}];
process.stdout.write(`${JSON.stringify(pod,null,2)}\n`);
