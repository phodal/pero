// Real Electron -> App capability -> Host. Uses the complete generated catalog.
// Management starts from explicit fixture state; Git acquisition is tested separately.
import {expect} from '@playwright/test';
import {electron} from './electron.mjs';
import {clickAppShortcut, setAppearance} from './sidebar-controls.mjs';
import {mkdtemp, mkdir, readFile, rename, rm, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';

const root = resolve(import.meta.dirname, '../..'), out = resolve(root, 'test-results/skills-market');
expect(JSON.parse(await readFile(resolve(root,'products/pero.json'),'utf8')).apps).toContain('skills');
const profiles = resolve(root,'target/skills-market-e2e');
await mkdir(profiles,{recursive:true});
const directory = await mkdtemp(resolve(profiles,'profile-'));
const catalogPath = resolve(directory, 'catalog.json');
const catalogText = await readFile(resolve(root, 'apps/skills/dist/market-catalog.json'), 'utf8');
const catalog = JSON.parse(catalogText);
expect(catalog.skills.length).toBeGreaterThan(40);
await writeFile(catalogPath, catalogText);
await mkdir(out, {recursive:true});
await rm(resolve(out,'failure.png'),{force:true});
await rm(resolve(out,'failure.json'),{force:true});
const settingsPath = resolve(directory, 'settings.json');
await writeFile(settingsPath, JSON.stringify({workbench:{appearance:'light'}}));
const env = {...process.env, PERO_DESKTOP_DATA_DIR:directory, PERO_SETTINGS_PATH:settingsPath,
  PERO_HISTORY_PATH:resolve(directory, 'history.jsonl'), PERO_SKILLS_CATALOG:catalogPath, PERO_LOCALE:'en',
  PERO_BUILTIN_APPS:'skills', PERO_REQUIRED_APPS:'skills'};
for (const key of ['ELECTRON_RUN_AS_NODE','PERO_APPS_ROOT','PERO_CLOUD_URL','PERO_CLIENT_TOKEN','PERO_OPERATOR_TOKEN']) delete env[key];
let app, page, frame;
const errors = [], checks = [];
const state = () => page.evaluate(() => JSON.parse(window.peroDiagnostics.snapshot()));
async function open() {
  app = await electron.launch({args:[...(process.platform === 'darwin' ? ['--use-mock-keychain'] : []),resolve(root,'desktop')], cwd:root, env});
  page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => window.peroDiagnostics && !document.getElementById('loading'), undefined, {timeout:60000});
  await expect.poll(async () => (await state()).apps?.some(item => item.name === 'skills'), {timeout:30000}).toBe(true);
  await clickAppShortcut(page,'skills');
  frame = page.frameLocator('iframe[title="skills"]');
  await expect(frame.getByRole('heading',{name:'Skills',exact:true})).toBeVisible({timeout:30000});
  await expect(frame.getByRole('region',{name:'Skill results',exact:true}).getByRole('article')).toHaveCount(12,{timeout:30000});
  await expect(frame.getByRole('button',{name:'Refresh',exact:true})).toBeEnabled();
}
async function capture(name) {
  await frame.locator('body').evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
  await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
  await page.screenshot({path:resolve(out,`${name}.png`)});
}
async function select(label,value) {
  const trigger=frame.getByRole('button',{name:label,exact:true});
  await trigger.press('ArrowDown');
  const list=frame.getByRole('listbox',{name:label,exact:true});
  await expect(list).toBeVisible();
  const choices=list.getByRole('option'), labels=await choices.allTextContents();
  const selected=await choices.evaluateAll(nodes=>nodes.findIndex(node=>node.getAttribute('aria-selected')==='true'));
  const target=labels.map(label=>label.trim()).indexOf(value);
  expect(target).toBeGreaterThanOrEqual(0);
  for(let step=0;step<(target-selected+labels.length)%labels.length;step++)await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(trigger).toHaveText(value);
}
async function search(query) {
  await frame.getByRole('searchbox',{name:'Search skills'}).fill(query);
}
try {
  await open();
  // A detail inspection is an explicit action and leaves the catalog available.
  await expect(frame.getByRole('dialog')).toHaveCount(0);
  await frame.getByRole('region',{name:'Skill results',exact:true}).getByRole('article').first().getByRole('button').first().press('Enter');
  await expect(frame.getByRole('dialog',{name:'Skill details',exact:true})).toBeVisible();
  await frame.getByRole('button',{name:'Close details',exact:true}).press('Enter');
  expect(await frame.locator('body').evaluate(() => typeof window.pero)).toBe('undefined');
  await expect(frame.locator('.skills-catalog-total')).toContainText(catalog.skills.length.toLocaleString('en'));
  await expect(frame.getByRole('link',{name:'#156',exact:true})).toHaveCount(0);
  const rows = frame.getByRole('region',{name:'Skill results',exact:true}).getByRole('article');
  const firstRows = await rows.allTextContents();
  const firstEntries = [];
  const displayedNames = await rows.locator('code').allTextContents();
  for (const [index,row] of firstRows.entries()) {
    const entry = catalog.skills.find(item=>item.name===displayedNames[index]);
    expect(entry,'Every visible row must identify an actual catalog entry').toBeTruthy();
    firstEntries.push(entry);
    expect(row).toContain(entry.name);
  }
  expect(new Set(firstEntries.map(item=>item.category)).size).toBeGreaterThan(1);
  await capture('catalog-light');
  await select('Skill scope','General');
  const generalCount = catalog.skills.filter(item=>item.kind==='general_skill'||item.discovery_scopes?.includes('general')).length;
  await expect(frame.locator('.skills-summary')).toContainText(`${generalCount} matches`);
  await capture('general-light');
  await select('Skill scope','Research');
  await expect(frame.locator('.skills-summary')).toContainText(`${catalog.skills.filter(item=>item.kind!=='general_skill').length.toLocaleString('en')} matches`);
  await select('Skill scope','All');
  const firstName = await frame.getByRole('region',{name:'Skill results',exact:true}).getByRole('article').getByRole('heading').first().textContent();
  await frame.getByRole('button',{name:'Next',exact:true}).press('Enter');
  expect(await frame.getByRole('region',{name:'Skill results',exact:true}).getByRole('article').getByRole('heading').first().textContent()).not.toBe(firstName);
  await frame.getByRole('button',{name:'Previous',exact:true}).press('Enter');
  await search('not-a-research-skill-156');
  await expect(frame.getByText('No matching skills',{exact:true})).toBeVisible();
  await frame.getByRole('button',{name:'Browse all skills',exact:true}).press('Enter');
  await expect(frame.getByRole('region',{name:'Skill results',exact:true}).getByRole('article')).toHaveCount(12);
  const category = catalog.skills.find(item => item.category)?.category;
  await select('Task category',category.replace(/[-_]/g,' '));
  await expect(frame.locator('.skills-summary')).toContainText(`${catalog.skills.filter(item=>item.category===category).length.toLocaleString('en')} matches`);
  await select('Task category','All categories');
  await frame.getByRole('checkbox',{name:'Ready to install',exact:true}).press('Space');
  const readyRows = await rows.allTextContents();
  expect(readyRows.length).toBeGreaterThan(0);
  await expect(rows.getByRole('button',{name:'View conditions',exact:true})).toHaveCount(0);
  await frame.getByRole('checkbox',{name:'Ready to install',exact:true}).press('Space');
  await select('Sort skills','Name');
  const orderedNames = await rows.locator('code').allTextContents();
  expect(orderedNames).toEqual([...orderedNames].sort((a,b)=>a.localeCompare(b,'en',{numeric:true})));
  await rows.first().getByRole('button').first().press('Enter');
  const detail=frame.getByRole('dialog',{name:'Skill details',exact:true});
  await expect(detail).toBeVisible();
  await expect(detail.getByRole('tab',{name:'Overview',exact:true})).toHaveAttribute('aria-selected','true');
  await detail.getByRole('tab',{name:'Examples',exact:true}).press('Enter');
  await expect(detail.getByRole('tab',{name:'Examples',exact:true})).toHaveAttribute('aria-selected','true');
  await detail.getByRole('tab',{name:'Source and version',exact:true}).press('Enter');
  await expect(detail.getByRole('link').first()).toBeVisible();
  await capture('detail-light-keyboard');
  await detail.getByRole('button',{name:'Close details',exact:true}).press('Escape');
  await expect(detail).not.toBeVisible();
  checks.push('actual Host, full catalog, 12-row paging, search recovery, categories, installable filtering, sort and explicit detail tabs/keyboard close');

  await rename(catalogPath,`${catalogPath}.saved`);
  await frame.getByRole('button',{name:'Refresh',exact:true}).press('Enter');
  await expect(frame.getByRole('alert')).toContainText('Skill catalog is unavailable');
  await expect(frame.getByRole('region',{name:'Skill results',exact:true}).getByRole('article')).toHaveCount(12);
  await capture('refresh-error-retained');
  await rename(`${catalogPath}.saved`,catalogPath);
  await frame.getByRole('button',{name:'Retry',exact:true}).press('Enter');
  await expect(frame.getByRole('alert')).toHaveCount(0);
  await frame.getByRole('tab',{name:'Installed (0)',exact:true}).press('Enter');
  await expect(frame.getByText('No installed skills',{exact:true})).toBeVisible();
  checks.push('actual Host missing-catalog refresh failure retains content; restoring the file and retrying recovers; initial installed empty state');
  await app.close(); app = undefined;

  // A deliberately seeded local installation exercises UI persistence without
  // downloading third-party code. The profile is disposable; no Agent is run.
  const entry = catalog.skills.find(item=>item.kind==='research_skill' && item.source && item.name && item.inputs?.length && item.license?.spdx && ['declared_in_skill','directory_license'].includes(item.license.status));
  expect(entry,'a real licensed catalog entry with explicitly documented inputs').toBeTruthy();
  const revision = entry.source.commit, previous = revision === '1'.repeat(40) ? '2'.repeat(40) : '1'.repeat(40);
  const market = resolve(directory,'skill-market'), snapshot = resolve(market,'snapshots','ui-fixture');
  await mkdir(snapshot,{recursive:true});
  const invocation = `market-ui-fixture:${entry.name}`;
  const version = value => ({revision:value,sha256:entry.source.sha256,invocation,directory:snapshot,adapterVersion:1,entry:{...entry,source:{...entry.source,commit:value,url:entry.source.url.replace(revision,value)}}});
  await writeFile(resolve(market,'state.json'),JSON.stringify({items:{[entry.id]:{
    id:entry.id,revision,enabled:false,selected:false,previousRevision:previous,invocation,entry:{...entry,description:'OUTDATED_DESCRIPTION_FIXTURE',description_zh:'OUTDATED_DESCRIPTION_FIXTURE'},versions:[version(revision),version(previous)]
  }}}));
  await open();
  const installedTab = frame.getByRole('tab',{name:'Installed (1)',exact:true});
  await installedTab.focus(); await installedTab.press('Enter');
  await expect(installedTab).toHaveAttribute('aria-selected','true');
  await frame.getByRole('region',{name:'Skill results',exact:true}).getByRole('article').first().getByRole('button').first().press('Enter');
  const installedDetail=frame.getByRole('dialog',{name:'Skill details',exact:true});
  await expect(installedDetail.getByRole('heading',{name:entry.name,exact:true})).toBeVisible();
  for (const label of ['Inputs','Outputs','Dependencies']) await expect(installedDetail.getByRole('heading',{name:label,exact:true})).toBeVisible();
  const visibleInput = entry.inputs[0].text.split('```')[0].replace(/\s+/g,' ').trim().slice(0,40);
  await expect(installedDetail).toContainText(visibleInput);
  await expect(installedDetail).not.toContainText('OUTDATED_DESCRIPTION_FIXTURE');
  const enabled = frame.getByRole('switch',{name:'Use in subsequent ordinary chats'});
  await enabled.press('Space');
  await expect(enabled).toBeChecked();
  await installedDetail.getByRole('tab',{name:'Source and version',exact:true}).press('Enter');
  await expect(installedDetail).toContainText(entry.description || entry.description_zh);
  await installedDetail.getByRole('button',{name:'Roll back',exact:true}).press('Enter');
  await expect(installedDetail).toContainText(previous);
  await capture('installed-selection-light');
  // The detail drawer covers the workbench canvas. Close it before using the visible Settings control.
  await installedDetail.getByRole('button',{name:'Close details',exact:true}).press('Escape');
  await expect(installedDetail).not.toBeVisible();
  // Fractional devicePixelRatio on this display makes the canvas one pixel taller than
  // Math.round(innerHeight * dpr). Nudge the content height until that existing check matches.
  const [contentWidth, contentHeight] = await app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0].getContentSize());
  let aligned = false;
  for (let delta = 0; delta < 64 && !aligned; delta++) {
    const height = contentHeight + (delta % 2 === 0 ? delta / 2 : -((delta + 1) / 2));
    await app.evaluate(({BrowserWindow}, next) => BrowserWindow.getAllWindows()[0].setContentSize(next[0], next[1]), [contentWidth, height]);
    aligned = await page.evaluate(() => new Promise(resolve => {
      const started = performance.now();
      const tick = () => {
        const canvas = document.querySelector('canvas');
        const ok = !!canvas && canvas.width === Math.round(innerWidth * devicePixelRatio) && canvas.height === Math.round(innerHeight * devicePixelRatio);
        if (ok || performance.now() - started > 300) resolve(ok);
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }));
  }
  if (!aligned) throw new Error('canvas size did not match the settings control check');
  await setAppearance(page,'dark');
  await app.evaluate(({Menu})=>Menu.getApplicationMenu().getMenuItemById('locale-zh-CN').click());
  await frame.getByRole('region',{name:'技能列表',exact:true}).getByRole('article').first().getByRole('button').first().press('Enter');
  const narrowDetail = frame.getByRole('dialog',{name:'技能详情',exact:true});
  await expect(narrowDetail.getByRole('tab',{name:'来源与版本',exact:true})).toBeVisible();
  await narrowDetail.getByRole('tab',{name:'来源与版本',exact:true}).press('Enter');
  await app.evaluate(({BrowserWindow})=>{const window=BrowserWindow.getAllWindows()[0];window.setMinimumSize(480,600);window.setSize(720,850);});
  await expect(narrowDetail).toBeVisible();
  await expect(narrowDetail).toContainText(previous);
  expect(await frame.locator('html').evaluate(node=>node.scrollWidth <= node.clientWidth + 1)).toBe(true);
  await capture('installed-dark-narrow-zh');
  checks.push('keyboard management of fixture installed metadata through actual Host enable/rollback, live zh/dark/narrow and no document overflow');
  await frame.getByRole('tab',{name:'用途与条件',exact:true}).press('Enter');
  await frame.getByRole('button',{name:'移除本地安装',exact:true}).press('Enter');
  const dialog = frame.getByRole('dialog').last();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button',{name:'取消',exact:true}).press('Enter');
  await expect(frame.getByRole('dialog')).toHaveCount(1);
  await frame.getByRole('button',{name:'移除本地安装',exact:true}).press('Enter');
  await dialog.getByRole('button',{name:'移除',exact:true}).press('Enter');
  await expect(frame.getByText('尚未安装技能',{exact:true})).toBeVisible();
  const saved = JSON.parse(await readFile(resolve(market,'state.json'),'utf8'));
  expect(saved.items).toEqual({});
  checks.push('remove confirmation/cancel and actual profile removal persistence');
  expect(errors).toEqual([]);
  await writeFile(resolve(out,'result.json'),JSON.stringify({passed:true,checks,catalogSkills:catalog.skills.length,sourceCount:catalog.sources.length,limitations:['Only the Skills builtin is enabled; unrelated Apps are excluded from this suite. Installed management uses explicit local state fixtures; no third-party Git acquisition, model inference, scientific validation or Native/packaged acceptance in this suite.']},null,2));
  console.log(`Skills market Electron/Host UI passed: ${checks.length} groups, ${catalog.skills.length} real catalog entries.`);
} catch (error) {
  if (page) await capture('failure').catch(()=>{});
  await writeFile(resolve(out,'failure.json'),JSON.stringify({error:String(error),pageErrors:errors,appText:frame?await frame.locator('body').innerText().catch(()=>null):null},null,2));
  throw error;
} finally {await app?.close();await rm(directory,{recursive:true,force:true});}
