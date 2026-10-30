// Actual Desktop/Host writes; OS picker return values and ACP output are explicit fixtures.
import {expect} from '@playwright/test';
import {electron} from './electron.mjs';
import {mkdtemp,mkdir,writeFile,readFile,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
const root=resolve(process.env.PERO_CONTENT_TEST_ROOT||resolve(import.meta.dirname,'../..'));
const out=resolve(root,'test-results/save-as'),temp=await mkdtemp(resolve(tmpdir(),'pero-save-as-'));
await mkdir(out,{recursive:true});
const original=resolve(temp,'original.md'),target=resolve(temp,'copy.md'),other=resolve(temp,'other.md');
const baseline='# Original\n\n原始 source\n',draft='# Saved draft\n\n中文 and 9007199254740993.\n';
await writeFile(original,baseline);await writeFile(other,'# Other baseline\n');
const code='// Exact source 中文\npub fn value() -> u64 { 9007199254740993 }';
await writeFile(resolve(temp,'content.txt'),'```rust\n'+code+'\n```');
await writeFile(resolve(temp,'settings.json'),JSON.stringify({chat_agent:'fixture'}));
await writeFile(resolve(temp,'agents.json'),JSON.stringify([{id:'fixture',name:'Save As fixture',command:process.execPath,args:[resolve(root,'tests/fixtures/acp-agent.mjs'),`--content-file=${resolve(temp,'content.txt')}`,'--content-title=Code result']}]));
const env={...process.env,PERO_DESKTOP_DATA_DIR:resolve(temp,'desktop'),PERO_LOCALE:'en',PERO_APPS_ROOT:resolve(temp,'apps'),PERO_SETTINGS_PATH:resolve(temp,'settings.json'),PERO_HISTORY_PATH:resolve(temp,'history.jsonl'),PERO_AGENTS_FILE:resolve(temp,'agents.json')};delete env.ELECTRON_RUN_AS_NODE;
const app=await electron.launch({args:['--use-mock-keychain',resolve(root,'desktop')],cwd:root,env});
const modifier=process.platform==='darwin'?'Meta':'Control';let page;
try {
  page=await app.firstWindow();const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const state=()=>page.evaluate(()=>JSON.parse(window.peroDiagnostics.snapshot()));
  const current=()=>state().then(s=>s.documents.find(doc=>doc.item.value.source===s.activeContent?.value?.source));
  const paint=()=>page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
  const screen=name=>page.screenshot({scale:'css',path:resolve(out,name+'.png')});
  const open=async file=>{await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});},file);await page.keyboard.press(`${modifier}+o`);await expect.poll(async()=>(await state()).activeContent?.value?.source).toBe(file);};
  const picker=async path=>app.evaluate(({dialog},file)=>{globalThis.__saveCalls=0;dialog.showSaveDialog=async(_window,options)=>{globalThis.__saveCalls++;globalThis.__saveOptions=options;return file?{canceled:false,filePath:file}:{canceled:true};};},path);
  const saveAs=()=>page.keyboard.press(`${modifier}+Shift+s`);
  const edit=async text=>{
    let r=(await current()).reader,b=r.bounds;
    if(!r.source){await page.mouse.click(b.x+100,b.y+16);await expect.poll(async()=>(await current()).reader.source).toBe(true);}
    b=(await current()).reader.bounds;await page.mouse.click(b.x+170,b.y+90);await page.keyboard.press(`${modifier}+a`);await page.keyboard.insertText(text);
    await expect.poll(async()=>(await current()).reader.editorBytes).toBe(Buffer.byteLength(text));
  };
  await page.waitForFunction(()=>window.peroDiagnostics&&JSON.parse(window.peroDiagnostics.snapshot()).connected&&!document.getElementById('loading'),undefined,{timeout:60000});
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1488,1086));
  await paint();await page.mouse.click(500,300);await open(original);await edit(draft);
  await page.keyboard.press(`${modifier}+f`);await page.keyboard.insertText('draft');await expect.poll(async()=>(await current()).reader.search.query).toBe('draft');await page.keyboard.press('Escape');
  await picker(null);await saveAs();await expect.poll(()=>app.evaluate(()=>globalThis.__saveCalls)).toBe(1);
  expect((await current()).reader.dirty).toBe(true);expect(await readFile(original,'utf8')).toBe(baseline);
  await picker(target);await saveAs();await expect.poll(()=>readFile(target,'utf8')).toBe(draft);
  await expect.poll(async()=>(await state()).activeContent.value.source).toBe(target);
  expect((await state()).documents.length).toBe(1);expect((await current()).reader.dirty).toBe(false);
  expect((await current()).reader.search.query).toBe('draft');expect(await readFile(original,'utf8')).toBe(baseline);
  expect((await app.evaluate(()=>globalThis.__saveOptions)).properties).toContain('showOverwriteConfirmation');
  await screen('file-source-migrated');
  // Normal Save after migration writes only the new target.
  const newer=draft+'Further edit\n';await edit(newer);await page.keyboard.press(`${modifier}+s`);
  await expect.poll(()=>readFile(target,'utf8')).toBe(newer);expect(await readFile(original,'utf8')).toBe(baseline);
  await open(other);await edit('# Unsaved destination\n');
  await expect.poll(async()=>(await current()).reader.dirty).toBe(true);
  await page.keyboard.press('Control+Shift+Tab');await expect.poll(async()=>(await state()).activeContent.value.source).toBe(target);
  await picker(other);await saveAs();await expect.poll(async()=>(await state()).error).toContain('unsaved');
  expect(await readFile(other,'utf8')).toBe('# Other baseline\n');expect((await state()).documents.length).toBe(2);
  await screen('dirty-destination-protected');
  // Once the destination buffer is clean, an external disk edit still conflicts.
  await page.keyboard.press('Control+Tab');await edit('# Other baseline\n');
  await expect.poll(async()=>(await current()).reader.dirty).toBe(false);
  await writeFile(other,'# External target edit\n');await page.keyboard.press('Control+Shift+Tab');
  await picker(other);await saveAs();await expect.poll(()=>app.evaluate(()=>globalThis.__saveCalls)).toBe(1);
  await expect.poll(async()=>(await state()).error).toContain('changed');
  expect(await readFile(other,'utf8')).toBe('# External target edit\n');
  await picker(resolve(temp,'missing/out.md'));await saveAs();await expect.poll(async()=>(await state()).error).toContain('Could not open or save');
  expect((await state()).activeContent.value.source).toBe(target);
  await expect(stat(resolve(temp,'missing/out.md'))).rejects.toThrow();
  // Refresh a clean destination baseline, then overwrite with the OS-selected target.
  await open(other);await page.keyboard.press('Control+Shift+Tab');await picker(other);await saveAs();
  await expect.poll(()=>readFile(other,'utf8')).toBe(newer);await expect.poll(async()=>(await state()).documents.length).toBe(1);
  expect((await current()).reader.dirty).toBe(false);expect(await readFile(target,'utf8')).toBe(newer);
  // A synthetic ACP result stays immutable while its copy becomes a writable File.
  await page.mouse.click(100,28);await expect.poll(async()=>(await state()).composerFocused).toBe(true);
  await page.keyboard.type('contentview');await page.keyboard.press('Enter');
  await expect.poll(async()=>(await state()).chats[0].state,{timeout:15000}).toBe('idle');
  const toggle=(await state()).toolBounds[0].bounds;await page.mouse.click(toggle.x+80,toggle.y+12);await paint();
  await expect.poll(async()=>(await state()).contentReaders.length).toBe(1);
  const inline=(await state()).contentReaders[0].bounds;await page.mouse.click(inline.x+100,inline.y-15);
  await expect.poll(async()=>(await current())?.reader.editable).toBe(false);
  const readonly=(await current()).item;
  const exported=resolve(temp,'export.rs');await picker(exported);await saveAs();
  await expect.poll(()=>readFile(exported,'utf8')).toBe(code);
  await expect.poll(async()=>(await current()).reader.editable).toBe(true);
  expect((await state()).documents.some(doc=>JSON.stringify(doc.item)===JSON.stringify(readonly))).toBe(true);
  expect((await state()).chats[0].tools.length).toBe(1);
  await screen('readonly-source-copied');
  expect(errors).toEqual([]);
  await writeFile(resolve(out,'result.json'),JSON.stringify({checks:['OS picker cancel preserves dirty source','File Save As migrates identity and reading state','original disk untouched','new target normal Save','OS overwrite confirmation requested','dirty target protected','external target conflict','write failure retains source','existing clean target overwrite and tab merge','readonly ACP source copied without authority change'],errors},null,2));
  console.log('Verified complete Save As, copy authority, target conflicts and picker cancellation.');
} catch(error){if(page&&!page.isClosed()){await page.screenshot({scale:'css',path:resolve(out,'failure.png')});await writeFile(resolve(out,'failure.json'),await page.evaluate(()=>window.peroDiagnostics.snapshot()));}throw error;}
finally {await app.evaluate(({dialog})=>{dialog.showMessageBoxSync=()=>1;}).catch(()=>{});await app.close();}
