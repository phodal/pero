// Actual Electron, Virtual Cell and ACP -> MCP -> App Use. No model login.
import { expect } from '@playwright/test';
import { electron } from './electron.mjs';
import { build } from 'esbuild';
import { cp, mkdir, mkdtemp, readFile, realpath, readdir, rm, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import {createHash} from 'node:crypto';

const root = resolve(import.meta.dirname, '../..');
const temp = await realpath(await mkdtemp(join(tmpdir(), 'pero-app-use-')));
const output = resolve(root, 'test-results/app-use');
const distribution = join(temp, 'distribution');
await mkdir(output, { recursive: true });
await rm(join(output, 'result.json'), { force: true });
await mkdir(join(distribution, 'desktop/dist'), { recursive: true });
await mkdir(join(distribution, 'bin'), { recursive: true });
const host = process.platform === 'win32' ? 'pero-host.exe' : 'pero-host';
if(process.platform==='win32')await cp(resolve(root,'target/debug',host),join(distribution,'bin',host));
else {
  const realHost=join(distribution,'bin',host+'.real');
  await cp(resolve(root,'target/debug',host),realHost);
  const quote=value=>"'"+value.replace(/'/g,"'\\''")+"'";
  await writeFile(join(distribution,'bin',host),'#!/bin/sh\nexec '+[process.execPath,resolve(root,'tests/fixtures/app-use-host.mjs'),realHost,temp].map(quote).join(' ')+'\n',{mode:0o755});
}
await cp(resolve(root, 'web/dist'), join(distribution, 'web/chat'), { recursive: true });
await build({ entryPoints: { product: resolve(root, 'desktop/src/main/product.ts'), 'product-preload': resolve(root, 'desktop/src/product/preload.ts') },
  outdir: join(distribution, 'desktop/dist'), outExtension: { '.js': '.cjs' }, bundle: true, platform: 'node', format: 'cjs', external: ['electron'] });
const script = await build({ entryPoints: [resolve(root, 'desktop/src/product/shell.ts')], bundle: true, platform: 'browser', format: 'iife', write: false });
const style = await readFile(resolve(root, 'desktop/src/product/shell.css'), 'utf8');
await writeFile(join(distribution, 'desktop/dist/product.html'), `<!doctype html><html><head><meta charset="utf-8"><style>${style}</style></head><body><script>${script.outputFiles[0].text}</script></body></html>`);
await writeFile(join(distribution, 'package.json'), JSON.stringify({ main: 'desktop/dist/product.cjs' }));
await writeFile(join(distribution, 'product.json'), JSON.stringify({ schemaVersion: 1, id: 'com.openpero.appusefixture', name: 'App Use Fixture', version: '1.0.0', shell: 'app',
  apps: ['virtual-cell'], entry: { app: 'virtual-cell', panel: 'main' }, python: 'system', chat: true }));
await cp(resolve(root, 'apps/virtual-cell'), join(distribution, 'apps/virtual-cell'), { recursive: true,
  filter: path => !path.includes('/node_modules') && !path.includes('/__pycache__') });
const agents = join(temp, 'agents.json');
await writeFile(agents, JSON.stringify(['codex', 'claude', 'copilot', 'grok'].map(id => ({ id, name: `App Use fixture (${id})`, command: process.execPath, args: [resolve(root, 'tests/fixtures/app-use-agent.mjs')], env: { PERO_APP_USE_FIXTURE_OUTPUT: output,PERO_APP_USE_FIXTURE_INPUT:join(temp,'inputs.json') } }))));
const env = { ...process.env, PERO_DESKTOP_DATA_DIR: join(temp, 'profile'), PERO_AGENTS_FILE: agents, PERO_LOCALE: 'en' };
delete env.ELECTRON_RUN_AS_NODE;
let app;
const errors = [];const runtimeLog=[];
const checks = [];
try {
  app = await electron.launch({ requiresNativeWindow: true, args: [...(process.platform === 'darwin' ? ['--use-mock-keychain'] : []), distribution], env });
  app.process().stderr.on('data',chunk=>runtimeLog.push(String(chunk)));
  const page = await app.firstWindow();
  await page.evaluate(()=>{window.approvalEvents=[];window.product.onEvent(event=>{if(event.kind==='permission')window.approvalEvents.push(event.data.permission_id);});});
  page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1488, 1086));
  let startingDraft;
  if(process.platform!=='win32'){
  await expect.poll(async()=>{try{return await readFile(join(temp,'host-held'),'utf8');}catch{return '';}}).toBe('ready');
  await expect.poll(()=>page.frames().some(frame=>frame.url().startsWith('pero://chat/'))).toBe(true);
  const startingChat=page.frames().find(frame=>frame.url().startsWith('pero://chat/'));
  await startingChat.waitForFunction(()=>window.peroChatDiagnostics&&JSON.parse(window.peroChatDiagnostics.snapshot()).chats.length===1,undefined,{timeout:60000});
  startingDraft=await startingChat.evaluate(()=>{const state=JSON.parse(window.peroChatDiagnostics.snapshot());return state.chats[state.activeChat].id;});
  await writeFile(join(temp,'release-host'),'release');
  }
  const frame = page.frameLocator('iframe[title="virtual-cell"]');
  await expect(frame.getByRole('tab', { name: 'Cells & perturbations' })).toBeVisible({ timeout: 20000 });
  await expect(frame.getByText('660 / 660 Cells', { exact: false }).first()).toBeVisible();
  await expect.poll(() => page.frames().some(frame => frame.url().startsWith('pero://chat/'))).toBe(true);
  const chat = page.frames().find(frame => frame.url().startsWith('pero://chat/'));
  await chat.waitForFunction(() => window.peroChatDiagnostics && JSON.parse(window.peroChatDiagnostics.snapshot()).connected, undefined, { timeout: 60000 });
  const state = () => chat.evaluate(() => JSON.parse(window.peroChatDiagnostics.snapshot()));
  const active = async () => { const snapshot = await state(); return snapshot.chats[snapshot.activeChat]; };
  await expect.poll(async () => (await state()).agents?.length || 0).toBeGreaterThan(0);
  if(startingDraft){expect((await active()).id).toBe(startingDraft);expect((await active()).state).toBe('draft');expect((await active()).error).toBeNull();checks.push('Chat draft initializes before the real Host startup signal and remains usable when the Host is released');}
  let expectedScenario;
  const submit = async (prompt, approval = false) => {
    expectedScenario = prompt.replace(/^app-use:/, '');
    await frame.locator('body').evaluate((_, text) => parent.postMessage({ type: 'pero:app:chat', text }, '*'), prompt);
    await expect.poll(async () => (await state()).composer).toBe(prompt);
    const bounds = await chat.locator('canvas').boundingBox();
    await page.mouse.click(bounds.x + 150, bounds.y + bounds.height - 70);
    await page.keyboard.press('Enter');
    if (approval) await expect.poll(async () => Boolean((await active())?.permission)).toBe(true);
  };
  const choose = async allow => {
    const permission = (await active()).permission;
    const options = permission.options;
    const index = options.findIndex(option => allow ? option.kind === 'allow_once' : option.kind === 'reject_once');
    expect(index).toBeGreaterThanOrEqual(0);
    const bounds = await chat.locator('canvas').boundingBox();
    // GPUI renders these buttons into its canvas, in the order from the Host.
    // This fixture has no usage row and the Composer has two empty text lines.
    const preceding = options.slice(0, index).reduce((width, option) => width + Math.max(64, option.name.length * 7 + 24) + 8, 0);
    await page.mouse.click(bounds.x + 42 + preceding + 25, bounds.y + bounds.height - 138);
    await expect.poll(async () => (await active()).permission).toBeNull();
  };
  const result = async () => {
    await expect.poll(async () => (await active())?.messages.filter(message => message.role === 'assistant').at(-1)?.text || '', { timeout: 30000 }).toContain(`\"scenario\":\"${expectedScenario}\"`);
    await expect.poll(async () => (await active())?.state, { timeout: 30000 }).toBe('idle');
    const message = (await active()).messages.filter(value => value.role === 'assistant').at(-1)?.text || '';
    const marker = 'APP_USE_RESULT:';
    expect(message).toContain(marker);
    return JSON.parse(message.slice(message.indexOf(marker) + marker.length));
  };
  await submit('app-use:deny',true);
  await page.screenshot({ path: join(output, 'approval.png') });
  await choose(false);
  const denied = await result();
  expect(denied.error).toBeUndefined(); expect(denied.denied).toBe(true);
  await expect(frame.getByRole('tab', { name: 'Cells & perturbations' })).toHaveAttribute('aria-selected', 'true');
  await expect(frame.getByLabel('Find gene', { exact: true })).toHaveValue('');
  checks.push('The Agent policy can ask in the existing Chat permission card; denial prevents an App effect');

  await submit('app-use:full');
  const full = await result();
  expect(full.error).toBeUndefined();
  expect(new Set(full.steps.map(step => step.action))).toEqual(new Set(['inventory', 'start', 'describe', 'observe', 'capture', 'act', 'wait', 'verify', 'stop', 'runPlan']));
  expect(full.steps.filter(step => step.action === 'capture').every(step => step.images === 1)).toBe(true);
  expect(full.steps.some(step => step.error === 'APP_REF_STALE')).toBe(true);
  expect(full.steps.filter(step => step.action === 'verify').every(step => step.result.verdict === 'pass')).toBe(true);
  await expect(frame.getByRole('tab', { name: 'Cells & perturbations' })).toHaveAttribute('aria-selected', 'true');
  await expect(frame.getByLabel('Find gene', { exact: true })).toHaveValue('MS4A1');
  await expect(frame.locator('.vc-gene-list').getByRole('button', { name: 'MS4A1', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.screenshot({ path: join(output, 'operated.png') });
  checks.push('Agent observes declared state, invokes select_view, captures pixels and verifies before bounded DOM fill');
  checks.push('actual Virtual Cell retains the Agent-filled gene filter and its visible gene result');
  // Real SDK object handoff, trusted parent capture, removable chips, frozen draft context.
  await frame.getByRole('button',{name:'Discuss context',exact:true}).click();
  await expect.poll(async()=>(await state()).attachments.length).toBe(1);
  const usersBefore=(await active()).messages.filter(message=>message.role==='user').length;
  await page.getByRole('button',{name:'Capture to chat',exact:true}).click();
  await expect.poll(async()=>(await state()).attachments.length).toBe(3);
  expect((await active()).messages.filter(message=>message.role==='user')).toHaveLength(usersBefore);
  await page.screenshot({path:join(output,'frozen-draft.png')});
  {const bounds=await chat.locator('canvas').boundingBox();await page.mouse.click(bounds.x+320,bounds.y+bounds.height-129);}
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('textbox',{name:'Annotation note'}).fill('Inspect the selected cells in this frozen frame');
  await page.getByRole('button',{name:'Mark whole image'}).click();await page.getByRole('button',{name:'Undo region'}).click();
  await expect(page.getByRole('button',{name:'Undo region'})).toBeDisabled();
  await page.getByRole('button',{name:'Mark whole image'}).click();
  await page.screenshot({path:join(output,'annotation-editor.png')});
  await page.getByRole('button',{name:'Add annotations to draft'}).click();
  await expect.poll(async()=>(await state()).attachments.length).toBe(4);
  await frame.getByRole('tab',{name:'Reactions & simulation'}).click();
  await frame.locator('body').evaluate(()=>parent.postMessage({type:'pero:app:chat',text:'app-use:context'},'*'));
  await expect.poll(async()=>(await state()).composer).toContain('app-use:context');
  expectedScenario='context';
  {const bounds=await chat.locator('canvas').boundingBox();await page.mouse.click(bounds.x+150,bounds.y+bounds.height-70);await page.keyboard.press('Enter');}
  const frozen=await result();expect(frozen.error).toBeUndefined();
  expect(frozen.contexts.find(context=>context.schema==='pero.app-object.v1').state.view).toBe('cells');expect(frozen.images).toBe(1);expect(frozen.contexts.find(context=>context.schema==='pero.app-annotations.v1')).toMatchObject({note:'Inspect the selected cells in this frozen frame',regions:[{x:0,y:0}]});
  await frame.getByRole('tab',{name:'Cells & perturbations'}).click();
  checks.push('SDK object refs and parent-cropped screenshot enter the draft without sending, preserve revisions after App changes, and reach ACP as frozen JSON plus pixels');
  await expect.poll(()=>page.evaluate(async()=>(await window.peroAppUse({scope:{app:'virtual-cell',panel:'main'},request:{action:'status'}})).value.operable)).toBe(true);
  const inputFile=join(temp,'inputs.json'),content=await frame.locator('body').evaluate(async()=>{const response=await fetch('/api/example');return (await response.json()).content;});
  await writeFile(inputFile,content);
  const fileContext={id:'selected-input',kind:'file',label:'selected-输入.json',source:inputFile,content:{type:'text',text:content}};
  await page.evaluate(({thread_id,fileContext})=>{const child=document.querySelector('iframe[data-pero-chat]');child.contentWindow.postMessage({type:'pero:chat:event',event:{version:1,kind:'compose_context',request_id:null,text:'',data:{thread_id,contexts:[fileContext]}}},'pero://chat');},{thread_id:(await active()).id,fileContext});
  await expect.poll(async()=>(await state()).attachments.length).toBe(1);
  await frame.locator('body').evaluate(()=>parent.postMessage({type:'pero:app:chat',text:'app-use:input'},'*'));
  await expect.poll(async()=>(await state()).composer).toContain('app-use:input');expectedScenario='input';
  {const bounds=await chat.locator('canvas').boundingBox();await page.mouse.click(bounds.x+150,bounds.y+bounds.height-70);await page.keyboard.press('Enter');}
  const imported=await result();expect(imported.error).toBeUndefined();
  expect(await frame.locator('body').evaluate(async(_,id)=>(await (await fetch('/api/artifacts/'+id)).json()).kind,imported.inputId)).toBe('inputs');
  checks.push('An explicitly attached conversation file is fetched through its temporary App/task grant, imported by the actual App action and read back from the real backend');
  await writeFile(inputFile,content.replace('\"max_candidates\": 2','\"max_candidates\": 1'));
  const beforeWrites=await frame.locator('body').evaluate(async()=>(await(await fetch('/api/inputs')).json()).items.length);
  await submit('app-use:write-deny',true);await choose(false);const writeDenied=await result();expect(writeDenied.error).toBeUndefined();
  expect(await frame.locator('body').evaluate(async()=>(await(await fetch('/api/inputs')).json()).items.length)).toBe(beforeWrites);
  await submit('app-use:write');
  const written=await result();expect(written.error).toBeUndefined();expect(written.written.result.id).not.toBe(imported.inputId);expect(await frame.locator('body').evaluate(async()=>(await(await fetch('/api/inputs')).json()).items.length)).toBe(beforeWrites+1);
  checks.push('Agent approval owns write denial; allowed app_write executes automatically through the fixed declared route and persists a distinct validated document');
  await submit('app-use:standing');
  const standing = await result();
  expect(standing.error).toBeUndefined();
  expect(standing.steps.filter(step => step.action === 'start')).toHaveLength(2);
  const revoke = page.getByRole('button', { name: /^Revoke .* App Use$/ });
  await expect(revoke).toBeVisible();
  await page.screenshot({ path: join(output, 'standing-read.png') });
  await revoke.click();
  await expect(revoke).toBeHidden();
  await submit('app-use:standing-after-revoke');
  const revoked = await result();
  expect(revoked.error).toBeUndefined(); expect(revoked.restarted).toBe(true);
  checks.push('Standing read grants and new tasks follow automatic Agent approval; Revoke ends the current grant before a new user turn creates another bounded task');
  await app.evaluate(({ nativeTheme, BrowserWindow }) => { nativeTheme.themeSource = 'light'; BrowserWindow.getAllWindows()[0].setSize(800, 700); });
  await expect(page.locator('#pero-app-surface')).toBeHidden();
  await expect.poll(async () => (await state()).dark).toBe(false);
  await submit('app-use:hidden', false);
  const hidden = await result();
  expect(hidden.error).toBeUndefined();
  expect(hidden.steps.filter(step => step.error === 'APP_SURFACE_HIDDEN')).toHaveLength(2);
  await page.screenshot({ path: join(output, 'hidden-narrow.png') });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1488, 1086));
  await expect(page.locator('#pero-app-surface')).toBeVisible();
  await page.screenshot({ path: join(output, 'light.png') });
  await app.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = 'dark'; });
  await expect.poll(async () => (await state()).dark).toBe(true);
  await page.screenshot({ path: join(output, 'dark.png') });
  checks.push('retained hidden panel remains readable while capture and operation are refused; light, dark and narrow layouts');
  const evidenceRoot=join(temp,'profile/app-use-evidence'),receipts=[];
  for(const file of await readdir(evidenceRoot))if(file.endsWith('.json')){
    const receipt=JSON.parse(await readFile(join(evidenceRoot,file),'utf8')),png=await readFile(join(evidenceRoot,receipt.id+'.png'));
    expect(receipt.sha256).toBe(createHash('sha256').update(png).digest('hex'));
    expect(receipt).toMatchObject({schema:'pero.app-capture.v1',threadId:expect.any(String),agentId:expect.any(String),taskId:expect.any(String),instance:expect.any(String),capturedAt:expect.any(String),scope:{app:'virtual-cell',panel:'main'}});
    expect(receipt.rect.x+receipt.rect.width).toBeLessThanOrEqual((await page.locator('#product-chat').boundingBox()).x);
    receipts.push(receipt);
  }
  expect(receipts.length).toBeGreaterThanOrEqual(3);await writeFile(join(output,'capture-receipts.json'),JSON.stringify(receipts,null,2));
  checks.push('Durable receipt JSONs match the actual PNG SHA-256 and preserve conversation, agent, task, App, instance, crop and time');
  const permissionIds=await page.evaluate(()=>window.approvalEvents);expect(permissionIds).toHaveLength(2);expect(permissionIds.every(id=>id.startsWith('permission-'))).toBe(true);checks.push('All App operations, captures, file transfers and writes finish without an additional Desktop approval; only explicit Agent policy questions appear');
  expect(errors).toEqual([]);
  for(const file of ['failure-state.json','failure.png','runtime.log'])await rm(join(output,file),{force:true});
  await writeFile(join(output, 'result.json'), JSON.stringify({ checks, errors, denied, full, frozen, imported, written, writeDenied, standing, revoked, hidden, state: await state() }, null, 2));
} catch (error) {
  await writeFile(join(output,'runtime.log'),runtimeLog.join(''));
  if (app) {
    const page = await app.firstWindow();
    const chat = page.frames().find(frame => frame.url().startsWith('pero://chat/'));
    if (chat) await writeFile(join(output, 'failure-state.json'), await chat.evaluate(() => window.peroChatDiagnostics?.snapshot() || '{}'));
    await page.screenshot({ path: join(output, 'failure.png') });
  }
  throw error;
} finally {
  if (app) await app.close();
  await rm(temp, { recursive: true, force: true });
}
