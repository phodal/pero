// Hold the real Host's startup output until the acceptance runner releases it.
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {watch,existsSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
const [host,gate]=process.argv.slice(2);
const child=spawn(host,['--stdio'],{stdio:'pipe',env:process.env});
process.stdin.pipe(child.stdin);child.stderr.pipe(process.stderr);
let released=false;const pending=[];
const release=()=>{if(!existsSync(join(gate,'release-host')))return;released=true;watcher.close();for(const line of pending)process.stdout.write(line+'\n');pending.length=0;};
const watcher=watch(gate,release);release();
createInterface({input:child.stdout}).on('line',line=>{
 if(released)process.stdout.write(line+'\n');else pending.push(line);
 if(JSON.parse(line).kind==='ready')writeFileSync(join(gate,'host-held'),'ready');
});
child.on('error',error=>{console.error(error);process.exit(1);});
child.on('exit',code=>process.exit(code??1));
process.on('SIGTERM',()=>child.kill('SIGTERM'));
