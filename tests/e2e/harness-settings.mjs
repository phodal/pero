// Actual settings form, encrypted Host persistence, restart and Go harness routing.
import { expect } from '@playwright/test';
import { electron } from './electron.mjs';
import { openSettings, setAppearance } from './sidebar-controls.mjs';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, readFile, cp, symlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
const root = resolve(import.meta.dirname, '../..');
const temp = await mkdtemp(resolve(tmpdir(), 'pero-harness-settings-'));
const out = resolve(root, 'test-results/harness-settings');
await mkdir(out, { recursive: true });
const settings = resolve(temp, 'settings.json');
await writeFile(settings, JSON.stringify({ other: { retained: true } }));
// Keep this test's runtime independent of concurrent local builds.
const runtime = resolve(temp, 'runtime');
await mkdir(resolve(runtime, 'target/debug'), {recursive:true});
await cp(resolve(root,'desktop/dist'),resolve(runtime,'desktop/dist'),{recursive:true});
await cp(resolve(root,'desktop/package.json'),resolve(runtime,'desktop/package.json'));
for (const name of ['pero-host','pero-agent-acp','pero-computer']) {
  const executable = name + (process.platform === 'win32' ? '.exe' : '');
  await cp(resolve(root,'target/debug',executable),resolve(runtime,'target/debug',executable));
}
for (const name of ['web','apps','node_modules']) await symlink(resolve(root,name),resolve(runtime,name),process.platform === 'win32' ? 'junction' : 'dir');
const key = 'fixture-harness-settings-key';
const requests = [];
const server = createServer(async (req, res) => {
  let body = ''; for await (const chunk of req) body += chunk;
  requests.push({ model: JSON.parse(body).model, authenticated: req.headers.authorization === `Bearer ${key}` });
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  res.end('data: '+JSON.stringify({id:'fixture',object:'chat.completion.chunk',choices:[{index:0,delta:{content:'SETTINGS_OK'},finish_reason:null}]})+'\n\ndata: '+JSON.stringify({id:'fixture',object:'chat.completion.chunk',choices:[{index:0,delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const endpoint = `http://127.0.0.1:${server.address().port}/v1`;
let app, page;
const errors = [];
const state = () => page.evaluate(() => window.peroDiagnostics ? JSON.parse(window.peroDiagnostics.snapshot()) : {});
const frames = () => page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
async function launch() {
  app = await electron.launch({ args: [...(process.platform === 'darwin' ? ['--use-mock-keychain'] : []), resolve(runtime, 'desktop')], cwd: runtime,
    env: { ...process.env, PERO_DESKTOP_DATA_DIR: resolve(temp, 'profile'), PERO_SETTINGS_PATH: settings, PERO_HISTORY_PATH: resolve(temp, 'history.jsonl'), PERO_LOCALE: 'en', PERO_ENV_FILE: resolve(root,'.env') } });
  page = await app.firstWindow(); page.on('pageerror', e => { errors.push(e.message); console.error('renderer:', e.message); });
  page.on('console', m => { if (m.type() === 'error') console.error('console:', m.text()); });
  await expect.poll(async () => (await state()).agents?.[0]?.id, { timeout: 15000 }).toBe('pero');
  await page.waitForFunction(() => !document.getElementById('loading'));
}
async function form() {
  await openSettings(page); await page.keyboard.press('ArrowUp'); await page.keyboard.press('Enter');
  await expect.poll(async () => (await state()).settingsOpen).toBe(true);
  await expect.poll(async () => (await state()).settings?.harness?.status).toBeTruthy();
  await page.keyboard.insertText('Built-in Agent');
  await expect.poll(async () => (await state()).settings.matches).toEqual(['harness.title']);
  await frames();
  const b = (await state()).settings.bounds;
  await page.mouse.click(b.x+80,b.y+60);
  await expect.poll(async () => (await state()).settings.section).toBe('harness.title');
  await page.mouse.click(b.x+80,b.y+24);
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await page.keyboard.press('Backspace'); await frames();
}
async function field(index, value) {
  const b = (await state()).settings.harnessInputs[index];
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await page.keyboard.insertText(value); await frames();
}
async function save() {
  const b = (await state()).settings.harnessInputs[2];
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  await page.keyboard.press('Tab'); await frames(); await page.keyboard.press('Space');
}
async function closeForm() {
  const b = (await state()).settings.bounds;
  await page.mouse.click(b.x+b.width-26,b.y+16); await frames();
  await expect.poll(async () => (await state()).settingsOpen).toBe(false);
}
async function prompt() {
  await closeForm();
  await frames(); await page.mouse.click(100, 28);
  await expect.poll(async () => (await state()).chats?.[(await state()).activeChat]?.state).toBe('idle');
  await page.mouse.click(700, await page.evaluate(() => innerHeight - 75));
  await page.keyboard.insertText('Reply SETTINGS_OK'); await page.keyboard.press('Enter');
  await expect.poll(async () => { const s = await state(); return s.chats[s.activeChat]?.messages.filter(m => m.role === 'assistant').map(m => m.text).join(''); }, { timeout: 15000 }).toBe('SETTINGS_OK');
}
try {
  await launch(); await form();
  expect((await state()).settings.harness.source).toBe('env');
  await page.screenshot({path:resolve(out,'env.png')});
  await field(0, endpoint); await field(1, 'configured-model'); await field(2, key);
  expect(JSON.stringify(await state())).not.toContain(key);
  await save();
  await expect.poll(async () => (await state()).settings.harness.status).toBe('saved');
  await page.screenshot({path:resolve(out,'saved.png')});
  const stored = await readFile(settings, 'utf8');
  expect(stored).not.toContain(key); expect(JSON.parse(stored).other.retained).toBe(true);
  expect(JSON.parse(stored).harness.encrypted_api_key).toBeTruthy();
  await field(0, 'http://insecure.example.com'); await save();
  await expect.poll(async () => (await state()).settings.harness.error).toBe('harness.invalid_endpoint');
  await page.screenshot({path:resolve(out,'invalid.png')});
  await field(0, endpoint); await save();
  await expect.poll(async () => (await state()).settings.harness.status).toBe('saved');
  await prompt(); expect(requests).toEqual([{model:'configured-model',authenticated:true}]);
  await app.close(); await launch(); await form();
  expect((await state()).settings.harness).toMatchObject({endpoint,model:'configured-model',credentialConfigured:true,source:'settings'});
  await page.screenshot({path:resolve(out,'restored.png')});
  await closeForm();
  await setAppearance(page, 'dark'); await form();
  await page.screenshot({path:resolve(out,'dark.png')});
  await app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0].setSize(1000,788));
  await expect.poll(() => page.evaluate(() => innerWidth)).toBe(1000); await frames();
  await page.screenshot({path:resolve(out,'narrow.png')});
  const keyBounds = (await state()).settings.harnessInputs[2];
  await page.mouse.click(keyBounds.x+20,keyBounds.y+keyBounds.height/2);
  await page.keyboard.press('Tab'); await frames(); await page.keyboard.press('Tab'); await frames();
  await page.keyboard.press('Space'); await frames();
  expect((await state()).settings.harness.credentialConfigured).toBe(true);
  await page.screenshot({path:resolve(out,'confirm-remove.png')});
  await page.keyboard.press('Space');
  await expect.poll(async () => (await state()).settings.harness.credentialConfigured).toBe(false);
  expect(JSON.parse(await readFile(settings,'utf8')).harness.encrypted_api_key).toBe(null);
  await app.close(); await launch(); await form();
  expect((await state()).settings.harness).toMatchObject({source:'settings',credentialConfigured:false});
  expect(errors).toEqual([]);
  await writeFile(resolve(out,'result.json'),JSON.stringify({requests,errors,encrypted:true,restart:true},null,2));
  console.log({out,requests,errors});
} catch(error) {
  if(page) {await page.screenshot({path:resolve(out,'failure.png')}); console.error({state:await state(),errors});}
  throw error;
} finally {await app?.close(); await new Promise(done => server.close(done));}
