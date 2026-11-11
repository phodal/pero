// Real Electron -> Host -> local Git -> Go Harness, with one observable held fetch.
import {expect} from '@playwright/test';
import {electron} from './electron.mjs';
import {clickAppShortcut} from './sidebar-controls.mjs';
import {buildForwarder, createSourceFixture} from '../runtime/skills-market-fixture.mjs';
import {access, mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';

const root=resolve(import.meta.dirname,'../..'), out=resolve(root,'test-results/skills-market/install');
const profiles=resolve(root,'target/skills-market-e2e');
await mkdir(profiles,{recursive:true});await mkdir(out,{recursive:true});
await rm(resolve(out,'failure.png'),{force:true});
const profile=await mkdtemp(resolve(profiles,'install-'));
const fixture=await createSourceFixture(profile,{generalName:'slow'});
const forwarder=await buildForwarder(profile,{realHarness:process.env.PERO_SKILLS_HARNESS_PATH || resolve(root,'target/debug/pero-agent-acp'+(process.platform==='win32'?'.exe':''))});
const agents=resolve(profile,'agents.json'),settings=resolve(profile,'settings.json');
await writeFile(agents,JSON.stringify([{id:'pero',name:'Pero install fixture',command:forwarder.command,args:[],env:{}}]));
await writeFile(settings,JSON.stringify({workbench:{appearance:'light'}}));
const env={...process.env,...forwarder.env,GIT_CONFIG_GLOBAL:fixture.gitconfig,GIT_CONFIG_NOSYSTEM:'1',
  PERO_DESKTOP_DATA_DIR:profile,PERO_SETTINGS_PATH:settings,PERO_HISTORY_PATH:resolve(profile,'history.jsonl'),
  PERO_AGENTS_FILE:agents,PERO_SKILLS_CATALOG:fixture.catalogPath,PERO_LOCALE:'en',PERO_BUILTIN_APPS:'skills',PERO_REQUIRED_APPS:'skills'};
for(const key of ['ELECTRON_RUN_AS_NODE','PERO_APPS_ROOT','PERO_CLOUD_URL','PERO_CLIENT_TOKEN','PERO_OPERATOR_TOKEN'])delete env[key];
let app,page,frame;
const errors=[];
const installed=async()=>JSON.parse(await readFile(resolve(profile,'skill-market/state.json'),'utf8')).items;
async function open(){
  app=await electron.launch({args:[...(process.platform==='darwin'?['--use-mock-keychain']:[]),resolve(root,'desktop')],cwd:root,env});
  page=await app.firstWindow();page.on('pageerror',error=>errors.push(error.message));
  await page.waitForFunction(()=>window.peroDiagnostics&&!document.getElementById('loading'),undefined,{timeout:60000});
  await expect.poll(async()=>JSON.parse(await page.evaluate(()=>window.peroDiagnostics.snapshot())).apps?.some(item=>item.name==='skills'),{timeout:30000}).toBe(true);
  await clickAppShortcut(page,'skills');frame=page.frameLocator('iframe[title="skills"]');
  await expect(frame.getByRole('region',{name:'Skill results',exact:true}).getByRole('article')).toHaveCount(2,{timeout:30000});
  await expect(frame.getByRole('button',{name:'Refresh',exact:true})).toBeEnabled();
}
async function closeDetails(){
  const close=frame.getByRole('button',{name:'Close details',exact:true});
  if(await close.count())await close.press('Enter');
}
async function choose(name){
  await closeDetails();
  await frame.getByRole('searchbox',{name:'Search skills'}).fill(name);
  await frame.getByRole('region',{name:'Skill results',exact:true}).getByRole('article').first().getByRole('button').first().press('Enter');
  await expect(frame.getByRole('dialog',{name:'Skill details',exact:true}).getByRole('heading',{name,exact:true})).toBeVisible();
}
async function capture(name){
  await frame.locator('body').evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
  await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
  await page.screenshot({path:resolve(out,`${name}.png`)});
}
async function startSlow(){
  await choose('slow');await frame.getByRole('dialog',{name:'Skill details',exact:true}).getByRole('button',{name:'Install',exact:true}).press('Enter');
  await expect.poll(async()=>{try{await access(forwarder.ready);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}},{timeout:15000}).toBe(true);
  await expect(frame.getByRole('dialog',{name:'Skill details',exact:true}).getByRole('button',{name:'Install',exact:true})).toBeDisabled();
  await closeDetails();
  await expect(frame.getByRole('button',{name:'Cancel slow',exact:true})).toBeVisible();
}
try{
  await open();
  await expect(frame.getByRole('link',{name:'#156',exact:true})).toHaveCount(0);
  await startSlow();
  await choose('fast');
  await expect(frame.getByRole('dialog',{name:'Skill details',exact:true}).getByRole('button',{name:'Install',exact:true})).toBeEnabled();
  await frame.getByRole('dialog',{name:'Skill details',exact:true}).getByRole('button',{name:'Install',exact:true}).press('Enter');
  await expect(frame.getByRole('tab',{name:'Installed (1)',exact:true})).toBeVisible({timeout:45000});
  await expect(frame.getByRole('switch',{name:'Use in subsequent ordinary chats'})).toBeVisible();
  await frame.getByRole('switch',{name:'Use in subsequent ordinary chats'}).press('Space');
  await expect(frame.getByRole('switch',{name:'Use in subsequent ordinary chats'})).toBeChecked();
  await closeDetails();
  await expect(frame.getByRole('button',{name:'Cancel slow',exact:true})).toBeVisible();
  await frame.getByRole('button',{name:'Refresh',exact:true}).press('Enter');
  await expect(frame.getByRole('button',{name:'Refresh',exact:true})).toBeEnabled();
  await expect(frame.getByRole('tab',{name:'Installed (1)',exact:true})).toBeVisible();
  await capture('fast-installed-while-slow-running');

  await frame.getByRole('button',{name:'Cancel slow',exact:true}).press('Enter');
  await expect(frame.getByRole('button',{name:'Cancel slow',exact:true})).toHaveCount(0,{timeout:15000});
  await expect(frame.getByRole('region',{name:'Installation tasks',exact:true})).toContainText(/cancel/i);
  expect((await installed())[fixture.fast.id].selected).toBe(true);
  expect((await installed())[fixture.slow.id]).toBeUndefined();

  await rm(forwarder.ready,{force:true});
  await startSlow();
  await writeFile(forwarder.release,'release observed acquisition');
  await expect(frame.getByRole('tab',{name:'Installed (2)',exact:true})).toBeVisible({timeout:45000});
  const saved=await installed();
  expect(Object.keys(saved).sort()).toEqual([fixture.slow.id,fixture.fast.id].sort());
  expect(saved[fixture.fast.id].selected).toBe(true);expect(saved[fixture.slow.id].enabled).toBe(false);
  await capture('both-installed');
  await app.close();app=undefined;await open();
  const tab=frame.getByRole('tab',{name:'Installed (2)',exact:true});
  await tab.press('Enter');
  await expect(tab).toHaveAttribute('aria-selected','true');
  await expect(frame.getByRole('region',{name:'Skill results',exact:true}).getByRole('article')).toHaveCount(2);
  expect(errors).toEqual([]);
  const result={passed:true,checks:['no issue link in product header','held real acquisition leaves another skill installable','second skill installs and enables before first is released','refresh stays available during acquisition','cancelling one skill preserves the other','retry after cancellation installs both without losing selection','two real acquisitions persist across restart'],limitations:['Source is an explicit local Git fixture with author/tags/dependencies metadata. One subprocess is delayed by a test-only forwarder. No model or scientific effect is tested.']};
  await writeFile(resolve(out,'result.json'),JSON.stringify(result,null,2));
  console.log(`Skills installation Electron/Host/Git passed: ${result.checks.length} checks.`);
}catch(error){if(page)await page.screenshot({path:resolve(out,'failure.png')}).catch(()=>{});throw error;}
finally{await app?.close();await rm(profile,{recursive:true,force:true});}
