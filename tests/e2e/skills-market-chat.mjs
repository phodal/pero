// Real UI installation -> market handoff and ordinary chat picker -> Go ACP -> loopback model.
// No installed-state seed and no global skill enable: the user selects the context.
import assert from 'node:assert/strict';
import {expect} from '@playwright/test';
import {electron} from './electron.mjs';
import {clickAppShortcut,clickNewChat} from './sidebar-controls.mjs';
import {buildForwarder, createSourceFixture} from '../runtime/skills-market-fixture.mjs';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {createHash} from 'node:crypto';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';

const root = resolve(import.meta.dirname,'../..');
const taskTemp = resolve(root,'target/task-temp'), goCache = resolve(root,'target/go-cache');
await mkdir(taskTemp,{recursive:true}); await mkdir(goCache,{recursive:true});
Object.assign(process.env,{TEMP:taskTemp,TMP:taskTemp,GOTMPDIR:taskTemp,GOCACHE:goCache});
const out = resolve(process.env.PERO_SKILLS_CHAT_OUTPUT || resolve(root,'test-results/skills-market/chat'));
await mkdir(out,{recursive:true}); await rm(resolve(out,'failure.png'),{force:true});
const profile = await mkdtemp(resolve(taskTemp,'skills-market-chat-'));
const suffix = process.platform === 'win32' ? '.exe' : '';
const hostPath = resolve(process.env.PERO_HOST_EXECUTABLE || resolve(root,`target/debug/pero-host${suffix}`));
const harnessPath = resolve(process.env.PERO_SKILLS_HARNESS_PATH || resolve(root,`target/debug/pero-agent-acp${suffix}`));
const fixture = await createSourceFixture(profile);
const forwarder = await buildForwarder(profile,{realHarness:harnessPath});
const requests = [], providerErrors = [], pageErrors = [], marker = 'MARKET_FAST_EVIDENCE';
const provider = createServer(async (request,response) => {
  try {
    assert.equal(request.url,'/v1/chat/completions');
    assert.equal(request.headers.authorization,'Bearer market-chat-fixture');
    let raw = ''; for await (const chunk of request) raw += chunk;
    const input = JSON.parse(raw); requests.push(input);
    const wire = JSON.stringify(input.messages);
    assert(wire.includes(marker),'Actual installed SKILL.md body must reach the provider');
    assert(wire.includes('Keep missing observations visible.'),'The complete selected skill instructions must be delivered');
    response.writeHead(200,{'content-type':'text/event-stream'});
    response.end('data: {"choices":[{"index":0,"delta":{"content":"Selected research skill received."},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
  } catch (error) {providerErrors.push(String(error));response.writeHead(500).end('Fixture rejected missing skill evidence');}
});
provider.listen(0,'127.0.0.1'); await once(provider,'listening');
const agents = resolve(profile,'agents.json'), settings = resolve(profile,'settings.json');
await writeFile(agents,JSON.stringify([{id:'pero',name:'Pero market chat fixture',command:forwarder.command,args:[
  '--endpoint',`http://127.0.0.1:${provider.address().port}/v1`,'--model','fixture',
  '--api-key-env','MARKET_FIXTURE_KEY','--session-dir',resolve(profile,'sessions'),
  '--workspace','{workspace}',
  '--max-requests','4','--max-retries','0','--max-tokens','512',
],env:{}}]));
await writeFile(settings,JSON.stringify({chat_agent:'pero',workbench:{appearance:'light'}}));
const env = {...process.env,...forwarder.env,GIT_CONFIG_GLOBAL:fixture.gitconfig,GIT_CONFIG_NOSYSTEM:'1',
  MARKET_FIXTURE_KEY:'market-chat-fixture',PERO_HOST_EXECUTABLE:hostPath,
  PERO_DESKTOP_DATA_DIR:profile,PERO_SETTINGS_PATH:settings,PERO_HISTORY_PATH:resolve(profile,'history.jsonl'),
  PERO_AGENTS_FILE:agents,PERO_SKILLS_CATALOG:fixture.catalogPath,PERO_LOCALE:'en',
  PERO_BUILTIN_APPS:'skills',PERO_REQUIRED_APPS:'skills'};
for (const key of ['ELECTRON_RUN_AS_NODE','PERO_APPS_ROOT','PERO_CLOUD_URL','PERO_CLIENT_TOKEN','PERO_OPERATOR_TOKEN']) delete env[key];
let app, page, marketFrame, stage = 'startup', lastSnapshot, installProof;
const state = async () => lastSnapshot = await page.evaluate(() => JSON.parse(window.peroDiagnostics.snapshot()));
const activeChat = async () => {const snapshot=await state();return snapshot.chats?.[snapshot.activeChat];};
const installed = async () => JSON.parse(await readFile(resolve(profile,'skill-market/state.json'),'utf8')).items;
async function frames() {await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));}
async function capture(name) {await frames();await page.screenshot({path:resolve(out,`${name}.png`)});}
async function appendComposer(text) {
  await frames();
  let bounds;
  await expect.poll(async () => {bounds=(await state()).composerBounds?.input;return bounds?.width > 0 && bounds?.height > 0;}).toBe(true);
  await page.mouse.click(bounds.x+bounds.width/2,bounds.y+bounds.height/2);
  // Preserve the skill chip supplied by the market handoff.
  await page.keyboard.press('End');
  const cdp=await page.context().newCDPSession(page);await cdp.send('Input.insertText',{text});await cdp.detach();
  await expect.poll(async () => (await state()).composer).toContain(text);
}
try {
  app=await electron.launch({args:[...(process.platform==='darwin'?['--use-mock-keychain']:[]),resolve(root,'desktop')],cwd:root,env});
  page=await app.firstWindow();page.on('pageerror',error=>pageErrors.push(error.message));
  await page.waitForFunction(()=>window.peroDiagnostics&&!document.getElementById('loading'),undefined,{timeout:60000});
  await expect.poll(async()=>(await state()).apps?.some(item=>item.name==='skills'),{timeout:30000}).toBe(true);
  await clickAppShortcut(page,'skills');marketFrame=page.frameLocator('iframe[title="skills"]');
  await expect(marketFrame.getByRole('region',{name:'Research skills',exact:true}).getByRole('article')).toHaveCount(2,{timeout:30000});
  await marketFrame.getByRole('searchbox',{name:'Search research skills'}).fill('fast');
  await marketFrame.getByRole('region',{name:'Research skills',exact:true}).getByRole('article').first().getByRole('button').first().press('Enter');
  await expect(marketFrame.getByRole('dialog',{name:'Skill details',exact:true}).getByRole('heading',{name:'fast',exact:true})).toBeVisible();
  stage='install through visible Skills App';
  await marketFrame.getByRole('dialog',{name:'Skill details',exact:true}).getByRole('button',{name:'Install',exact:true}).press('Enter');
  await expect(marketFrame.getByRole('tab',{name:'Installed (1)',exact:true})).toBeVisible({timeout:45000});
  await expect(marketFrame.getByRole('switch',{name:'Use in subsequent ordinary chats'})).not.toBeChecked();
  const record=(await installed())[fixture.fast.id];
  expect(record.revision).toBe(fixture.fast.source.commit);
  expect(record.enabled).toBe(false);expect(record.selected).toBe(false);
  installProof={id:record.id,revision:record.revision,enabled:record.enabled,selected:record.selected};
  await capture('installed-not-globally-selected');

  stage='market handoff creates an ordinary draft with the installed skill';
  await marketFrame.getByRole('button',{name:'Use in new chat',exact:true}).press('Enter');
  await expect.poll(async()=>(await state()).navigation).toBe(0);
  await expect.poll(async()=>(await activeChat())?.agent).toBe('pero');
  await expect.poll(async()=>['draft','idle'].includes((await activeChat())?.state),{timeout:30000}).toBe(true);
  expect((await activeChat()).scope).toBeNull();
  expect(requests).toHaveLength(0);
  await expect.poll(async()=>(await state()).attachments,{timeout:15000}).toContain('fast');
  expect((await installed())[fixture.fast.id].selected).toBe(false);
  expect((await installed())[fixture.fast.id].enabled).toBe(false);
  await capture('explicit-skill-chip');

  stage='a separately created ordinary chat still discovers installed skills';
  await clickNewChat(page);
  await expect.poll(async()=>['draft','idle'].includes((await activeChat())?.state),{timeout:30000}).toBe(true);
  await expect.poll(async()=>(await state()).attachments).toEqual([]);
  await appendComposer('@skill fast');
  await expect.poll(async()=>{const snapshot=await state();return snapshot.completion?.open&&!snapshot.completion.loading;},{timeout:15000}).toBe(true);
  await capture('installed-skill-picker');
  expect(lastSnapshot.completion.error).toBeFalsy();
  expect(lastSnapshot.completion.items,'New ordinary chats must offer the installed skill without global activation').toContain('fast');
  const choices=lastSnapshot.completion.items, selected=lastSnapshot.completion.selected;
  for(let step=0;step<(choices.indexOf('fast')-selected+choices.length)%choices.length;step++)await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect.poll(async()=>(await state()).attachments).toContain('fast');
  expect(requests).toHaveLength(0);

  stage='selected installed skill reaches actual Agent provider';
  await appendComposer(' Read the selected research skill and follow its evidence policy.');
  const count=(await activeChat()).messages.filter(message=>message.role==='user').length;
  await page.keyboard.press('Enter');
  await expect.poll(async()=>(await activeChat()).messages.filter(message=>message.role==='user').length).toBe(count+1);
  await expect.poll(async()=>(await activeChat()).state,{timeout:30000}).toBe('idle');
  expect(providerErrors).toEqual([]);expect(pageErrors).toEqual([]);expect(requests.length).toBeGreaterThan(0);
  expect(JSON.stringify(requests[0].messages)).toContain(marker);
  await capture('selected-skill-sent');
  const finalRecord=(await installed())[fixture.fast.id];
  expect(finalRecord.enabled).toBe(false);expect(finalRecord.selected).toBe(false);
  const result={passed:true,hostSHA256:createHash('sha256').update(await readFile(hostPath)).digest('hex'),skillRevision:record.revision,installProof,selectionAfterSend:{enabled:finalRecord.enabled,selected:finalRecord.selected},
    skill:fixture.fast.id,checks:['real visible market installation from local Git via Go Harness','installed remains globally disabled and unselected','Use in new chat opens an ordinary unsent draft','market handoff resolves the installed skill into a chip without global activation','separate ordinary chat picker still offers the installed skill','real ACP/provider receives installed source body marker'],providerRequests:requests.length,
    limitations:['Local Git and loopback model fixture; no paid model or scientific-effect claim. Other Apps, Native UI and signed packages are not covered.']};
  await writeFile(resolve(out,'result.json'),JSON.stringify(result,null,2));
  await writeFile(resolve(out,'provider-requests.json'),JSON.stringify(requests,null,2));
  console.log(`Installed skill → market handoff / ordinary picker → actual Agent provider passed (${requests.length} request).`);
} catch(error) {
  if(page){await capture('failure').catch(()=>{});await state().catch(()=>{});}
  await writeFile(resolve(out,'failure.json'),JSON.stringify({stage,error:String(error),installProof,snapshot:lastSnapshot,providerRequests:requests.length,providerErrors,pageErrors},null,2));
  throw error;
} finally {
  await app?.close();provider.closeAllConnections();await new Promise(done=>provider.close(done));
  await rm(profile,{recursive:true,force:true});
}
