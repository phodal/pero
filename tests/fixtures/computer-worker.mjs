// A second process implementation of the native seam, for transport failures.
import { createInterface } from 'node:readline';
import { appendFileSync, readFileSync } from 'node:fs';
const [output, mode] = process.argv.slice(2);
const fixture = JSON.parse(readFileSync(new URL('../contracts/computer-use.json',import.meta.url),'utf8'));
const status = { available: true, accessibility: 'granted', screen_recording: 'granted', message: 'Fixture' };
for await (const line of createInterface({input:process.stdin})) {
  const {id,request} = JSON.parse(line);
  let value;
  if(request.operation==='status') value={kind:'status',status};
  else if(request.operation==='targets') value={kind:'targets',capabilities:fixture.capabilities,targets:[fixture.target]};
  else if(request.operation==='observe') value={kind:'observation',observation:fixture.observation,image:null};
  else if(request.operation==='act') {
    appendFileSync(output,JSON.stringify({pid:process.pid,action:request.action})+'\n');
    if(mode==='interrupt') continue; // The caller observes the effect before cancelling.
    value={kind:'receipt',receipt:{request_id:request.action.request_id,target:request.action.target,observation_id:request.action.observation_id,outcome:{status:'executed'}}};
  }
  process.stdout.write(JSON.stringify({id,value})+'\n');
}
