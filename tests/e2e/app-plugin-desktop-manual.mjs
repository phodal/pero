// Visible production Electron App shell. Approval decisions must be clicked in UI.
// stdin commands only prepare a session, inspect evidence, and stop the owned app.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { _electron } from '@playwright/test';
import { parseEnv } from 'node:util';
import { createInterface } from 'node:readline';
import { cp, mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { productShellStyle } from '../../scripts/build/shell-style.mjs';

const root = resolve(import.meta.dirname, '../..');
const temp = await mkdtemp(join(tmpdir(), 'pero-plugin-desktop-'));
const distribution = join(temp, 'distribution'), profile = join(temp, 'profile');
const output = resolve(root, 'test-results/app-plugin-desktop');
const local = parseEnv(await readFile(join(root, '.env'), 'utf8'));
const credential = process.env.DEEPSEEK_API_KEY || local.DEEPSEEK_API_KEY;
assert(credential, 'A real provider credential is required');
await mkdir(join(distribution, 'desktop/dist'), { recursive: true });
await mkdir(join(distribution, 'bin')); await mkdir(profile); await mkdir(output, { recursive: true });
await cp(join(root, 'target/debug/pero-host'), join(distribution, 'bin/pero-host'));
await cp(join(root, 'web/dist'), join(distribution, 'web/chat'), { recursive: true });
await build({ entryPoints: { product: join(root, 'desktop/src/main/product.ts'), 'product-preload': join(root, 'desktop/src/product/preload.ts') }, outdir: join(distribution, 'desktop/dist'), outExtension: { '.js': '.cjs' }, bundle: true, platform: 'node', format: 'cjs', external: ['electron'] });
const shell = await build({ entryPoints: [join(root, 'desktop/src/product/shell.ts')], bundle: true, platform: 'browser', format: 'iife', write: false });
await writeFile(join(distribution, 'desktop/dist/product.html'), `<html><head><meta charset="utf-8"><style>${productShellStyle(root)}</style></head><body><script>${shell.outputFiles[0].text}</script></body></html>`);
await writeFile(join(distribution, 'package.json'), JSON.stringify({ main: 'desktop/dist/product.cjs' }));
await writeFile(join(distribution, 'product.json'), JSON.stringify({ schemaVersion: 1, id: 'com.openpero.approval-verification', name: 'Plugin Approval - Pero Desktop', version: '1.0.0', shell: 'app', apps: ['approval'], entry: { app: 'approval', panel: 'main' }, python: 'system', node: 'system', chat: true }));
const source = join(distribution, 'apps/approval'); await mkdir(join(source, 'dist'), { recursive: true });
await writeFile(join(source, 'app.json'), JSON.stringify({ schemaVersion: 1, name: 'approval', version: '1', displayName: 'Approval verification', permissions: { host: ['agent','agent-plugin'] }, backend: { type: 'node', entry: 'server.mjs' }, contributes: {
  panels: [{ id: 'main', title: 'Approval verification', entry: 'dist/index.html' }],
  writes: [{ name: 'save', description: 'Save one synthetic observation to this isolated test App.', path: '/api/save', schema: { type: 'object', properties: { observation: { type: 'string' } }, required: ['observation'] } }],
  agentPlugin: { schema: 'pero.app-agent-plugin.v1', instructions: 'Save only the synthetic observation requested by the user. If permission is denied, stop and report the denial without retrying.', tools: ['save'], maxCalls: 1 },
} }));
await writeFile(join(source, 'server.mjs'), `import {createServer} from 'node:http';import{appendFile,readFile}from'node:fs/promises';import{join}from'node:path';const path=join(process.env.PERO_APP_DATA,'saved.jsonl');const s=createServer(async(q,r)=>{if(q.headers['x-pero-app-token']!==process.env.PERO_APP_TOKEN){r.writeHead(403).end();return;}r.setHeader('content-type','application/json');if(q.method==='GET'){r.end(JSON.stringify({records:(await readFile(path,'utf8').catch(()=>'' )).trim().split('\\n').filter(Boolean).map(JSON.parse)}));return;}let b='';for await(const c of q)b+=c;await appendFile(path,b+'\\n');r.end(JSON.stringify({saved:true,observation:JSON.parse(b).observation}));});s.listen(0,'127.0.0.1',()=>console.log(JSON.stringify({port:s.address().port})));`);
const panelHTML = `<!doctype html><meta charset="utf-8"><style>body{font:16px system-ui;padding:28px;color:#222;background:#fafafa}button{padding:9px 15px;margin-right:10px}pre{white-space:pre-wrap}</style><h1>Plugin approval verification</h1><p>Isolated test data · Real Go Harness · deepseek-flash</p><button id="draft">Prepare observation</button><button id="refresh">Refresh saved records</button><pre id="records">No records loaded</pre><script>let scenario='allow';window.addEventListener('message',e=>{if(e.data.type==='verification-scenario')scenario=e.data.scenario;});document.querySelector('#draft').onclick=()=>parent.postMessage({type:'pero:app:chat',options:{message:'Please call the App save tool exactly once with observation '+scenario+'-ui-evidence. This is synthetic acceptance data. If approval is denied, stop and report the denial; do not retry. Give a brief confirmation.',mode:'replace'}},'*');document.querySelector('#refresh').onclick=async()=>{document.querySelector('#records').textContent=JSON.stringify(await(await fetch('/api/records')).json(),null,2)};parent.postMessage({type:'pero:app:ready'},'*');</script>`;
const panelScript=panelHTML.split('<script>')[1].split('</script>')[0];
await writeFile(join(source,'dist/panel.js'),panelScript);
await writeFile(join(source,'dist/index.html'),panelHTML.replace(/<script>[\s\S]*<\/script>/,'<script src="panel.js"></script>'));
await writeFile(join(temp, 'agents.json'), JSON.stringify([{ id:'harness', name:'Pero Harness (deepseek-flash)', command:join(root,'target/debug/pero-agent-acp'), args:['--endpoint','https://api.deepseek.com/v1','--model','deepseek-flash','--session-dir',join(temp,'sessions'),'--api-key-env','PLUGIN_UI_KEY','--approval','ask','--max-retries','0','--max-requests','6','--max-tokens','2048','--use-env-proxy'], env:{} }]));
await writeFile(join(profile,'runtime-settings.json'),JSON.stringify({chat_agent:'harness',computer_use:{enabled:false}}));
const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('PERO_')&&!/(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)/i.test(key)));
delete env.ELECTRON_RUN_AS_NODE;
const app=await _electron.launch({...(process.env.PLUGIN_UI_ELECTRON?{executablePath:process.env.PLUGIN_UI_ELECTRON}:{}),args:['--use-mock-keychain',distribution],cwd:root,env:{...env,PLUGIN_UI_KEY:credential,PERO_NODE_BINARY:process.execPath,PERO_DESKTOP_DATA_DIR:profile,PERO_SETTINGS_PATH:join(profile,'runtime-settings.json'),PERO_HISTORY_PATH:join(profile,'history.jsonl'),PERO_AGENTS_FILE:join(temp,'agents.json'),PERO_LOCALE:'en',PERO_TEST_BACKGROUND:'0'}});
const page=await app.firstWindow();
const events=[];await page.exposeFunction('recordVerificationEvent',e=>{events.push(e);if(['permission','turn_finished','session_error'].includes(e.kind))console.log(JSON.stringify({event:e.kind,thread:e.thread_id,text:e.text,data:e.kind==='permission'?e.data:undefined}));});
await page.evaluate(()=>window.product.onEvent(e=>window.recordVerificationEvent(e)));
const state=async()=>{const chat=page.frames().find(frame=>frame.url().startsWith('pero://chat/'));return chat?chat.evaluate(()=>JSON.parse(window.peroChatDiagnostics.snapshot())):null;};
console.log(JSON.stringify({ready:true,temp,output,pid:app.process().pid,title:await page.title()}));
for await(const line of createInterface({input:process.stdin})){
  const command=JSON.parse(line);
  if(command.action==='stop')break;
  if(command.action==='inspect')console.log(JSON.stringify({state:await state(),window:await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].getBounds())}));
  if(command.action==='prepare'){
    const current=await state();const id=current?.chats[current.activeChat]?.id;assert(id,'Open the ChatPanel first');

    const deadline=Date.now()+30000;while(!events.some(e=>e.thread_id===id&&e.kind==='session_ready')){assert(Date.now()<deadline);await new Promise(r=>setTimeout(r,50));}
    await page.evaluate(id=>window.product.sessionCommand({action:'configure',thread_id:id,config_id:'permission',value:'full-access'}),id);
    const frame=page.frames().find(frame=>frame.url().startsWith('pero-app://approval'));
    await frame.evaluate(scenario=>window.postMessage({type:'verification-scenario',scenario},'*'),command.scenario);
    console.log(JSON.stringify({prepared:id,state:await state()}));
  }
  if(command.action==='verify'){
    const records=(await readFile(join(profile,'app-data/approval/saved.jsonl'),'utf8').catch(error=>{if(error.code==='ENOENT')return '';throw error;})).trim().split('\n').filter(Boolean).map(JSON.parse);
    const snapshot=await state();const active=snapshot.chats[snapshot.activeChat];
    assert.equal(active.state,'idle');assert.equal(active.permission,null);assert.equal(active.tools.length,1);
    assert.equal(active.tools[0].status,command.scenario==='allow'?'completed':'failed');
    assert.deepEqual(records,[{observation:'allow-ui-evidence'}]);
    assert.equal(events.filter(e=>e.kind==='permission'&&e.thread_id===active.id).length,1);
    const summary={scenario:command.scenario,records,permissions:events.filter(e=>e.kind==='permission').map(e=>({thread:e.thread_id,id:e.data.permission_id,tool:e.data.toolCall})),state:snapshot};
    await writeFile(join(output,command.scenario+'-result.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary));
  }
}
const current=await state();
for(const chat of current?.chats||[])await page.evaluate(id=>window.product.sessionCommand({action:'close',thread_id:id}),chat.id);
const closing=Date.now()+10000;while((current?.chats||[]).some(chat=>!events.some(event=>event.kind==='session_closed'&&event.thread_id===chat.id))){assert(Date.now()<closing,'Session cleanup timed out');await new Promise(r=>setTimeout(r,50));}
await app.close();await rm(temp,{recursive:true,force:true});process.stdin.pause();
