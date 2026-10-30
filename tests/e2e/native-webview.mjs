// Actual native Wry engine with a hidden GPUI workspace; no credentials or external network.
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {copyFile,mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {tmpdir} from 'node:os';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'../..');
const out=resolve(root,'test-results/native-webview');
const temp=await mkdtemp(resolve(tmpdir(),'pero-native-webview-'));
await mkdir(out,{recursive:true});
const server=createServer((request,response)=>{
  const title=request.url==='/b'?'Native second':'Native first';
  response.setHeader('Content-Type','text/html; charset=utf-8');response.setHeader('X-Frame-Options','DENY');
  response.end(`<title>${title}</title><h1>${title}</h1><input id="draft"><a id="next" href="/b">Next</a>`);
});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const binary=resolve(temp,process.platform==='win32'?'pero-native-probe.exe':'pero-native-probe');
const receipt=resolve(temp,'result.json');
await copyFile(resolve(root,'target/debug',process.platform==='win32'?'pero-native.exe':'pero-native'),binary);
assert((await readFile(binary)).includes(Buffer.from('Native Web view acceptance failed')),'Build the opt-in native-probe binary before running this suite');
const child=spawn(binary,['--verify-webview',`http://127.0.0.1:${server.address().port}/a`,receipt],{cwd:root,env:{...process.env,PERO_NATIVE_BUNDLED:'1',PERO_NATIVE_DATA_DIR:resolve(temp,'data')},stdio:['ignore','pipe','pipe']});
let log='';child.stdout.on('data',value=>{log+=value;});child.stderr.on('data',value=>{log+=value;});
const timer=setTimeout(()=>child.kill('SIGKILL'),45000);
try {
  const exit=await new Promise((done,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>done({code,signal}));});
  await writeFile(resolve(out,'native.log'),log);
  assert.equal(exit.signal,null,'Native probe ended from a signal; inspect native.log');
  const value=JSON.parse(await readFile(receipt,'utf8'));
  await writeFile(resolve(out,'result.json'),JSON.stringify(value,null,2));
  assert.equal(exit.code,0,'Native process failed during teardown');
  assert.equal(value.passed,true,JSON.stringify(value));assert.equal(value.window_active,false);assert.equal(value.released,true);
  console.log('Native Wry passed: page DOM, authority, retention, history and teardown in a hidden GPUI workspace.');
} finally {clearTimeout(timer);child.kill();await new Promise(done=>server.close(done));}
