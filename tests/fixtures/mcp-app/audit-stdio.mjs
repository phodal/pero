// Transparent transport audit. The upstream example server and HTML stay unchanged.
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {appendFileSync} from 'node:fs';

const [entry,receipt]=process.argv.slice(2);
if(!entry||!receipt)throw new Error('Usage: audit-stdio.mjs OFFICIAL_ENTRY RECEIPT');
const server=spawn(process.execPath,[entry,'--stdio'],{stdio:['pipe','inherit','inherit']});
const lines=createInterface({input:process.stdin});
lines.on('line',line=>{
  const request=JSON.parse(line);
  if(request.method==='tools/call')appendFileSync(receipt,JSON.stringify({id:request.id,name:request.params.name})+'\n');
});
process.stdin.pipe(server.stdin);
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>server.kill(signal));
server.once('error',error=>{console.error(error);process.exitCode=1;});
server.once('exit',(code,signal)=>{lines.close();process.stdin.destroy();if(signal)process.kill(process.pid,signal);else process.exitCode=code??1;});
