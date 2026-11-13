// The staged provider must run beside its own browser assets, away from the checkout.
import assert from 'node:assert/strict';
import test from 'node:test';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createInterface} from 'node:readline';
import {buildMcpHost} from '../../scripts/build/mcp-assets.mjs';

test('staged MCP provider serves its own renderer assets from a foreign working directory',{timeout:15000},async t=>{
  const home=await mkdtemp(join(tmpdir(),'pero-staged-mcp-'));
  const assets=join(home,'desktop/dist');await buildMcpHost(assets);
  const provider=spawn(process.execPath,[join(assets,'mcp-provider.cjs'),'--stdio','--config',join(home,'servers.json')],{cwd:home,stdio:'pipe'});
  const lines=createInterface({input:provider.stdout}),iterator=lines[Symbol.asyncIterator]();
  let stderr='';provider.stderr.on('data',chunk=>{stderr+=chunk;});
  t.after(async()=>{
    if(provider.exitCode===null){const exited=once(provider,'exit');provider.kill();await exited;}
    lines.close();await rm(home,{recursive:true,force:true});
  });
  assert.equal(JSON.parse((await iterator.next()).value).kind,'mcp_ready',stderr);
  provider.stdin.write(JSON.stringify({action:'open',request_id:'staged-panel',mode:'standalone'})+'\n');
  const opened=JSON.parse((await iterator.next()).value);assert.equal(opened.kind,'mcp_sources',stderr);
  const panel=await fetch(opened.data.url);assert.equal(panel.status,200);
  const html=await panel.text();assert.match(html,/\/panel\.css/);assert.match(html,/\/panel\.js/);
  for(const [path,type]of [['/panel.js','text/javascript'],['/panel.css','text/css']]){
    const asset=await fetch(new URL(path,opened.data.url));assert.equal(asset.status,200);assert.equal(asset.headers.get('content-type'),type);
  }
  const sandboxOrigin=panel.headers.get('content-security-policy').match(/frame-src (http:\/\/127\.0\.0\.1:\d+)/)[1];
  const sandbox=await fetch(new URL('/sandbox.js',sandboxOrigin));assert.equal(sandbox.status,200);assert.equal(sandbox.headers.get('content-type'),'text/javascript');
  const exited=once(provider,'exit');provider.stdin.write(JSON.stringify({action:'shutdown'})+'\n');provider.stdin.end();
  assert.equal((await exited)[0],0,stderr);
});
