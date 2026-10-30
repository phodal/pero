// Managed Data Agent -> dataset -> GPUI Kit chart -> provenance and persistence.
import {expect} from '@playwright/test';
import {electron} from './electron.mjs';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {tmpdir} from 'node:os';

const root=resolve(import.meta.dirname,'../..');
const distribution=resolve(process.env.PERO_CONTENT_TEST_ROOT||root);
const output=resolve(root,'test-results/data-chart');
await mkdir(output,{recursive:true});
const temp=await mkdtemp(join(tmpdir(),'pero-data-chart-'));
const fixture=join(temp,'observations.json');
const rows=[{period:'A',target:'B',value:10,open:8,high:12,low:7,close:10},{period:'B',target:'C',value:20,open:10,high:23,low:8,close:19},{period:'C',target:'D',value:15,open:19,high:22,low:14,close:16}];
await writeFile(fixture,JSON.stringify(rows,null,2));
const agents=join(temp,'agents.json');await writeFile(agents,JSON.stringify([{id:'codex',name:'Data fixture',command:process.execPath,args:[join(root,'tests/fixtures/data-agent-acp.mjs')]}]));
const settings=join(temp,'settings.json');await writeFile(settings,JSON.stringify({chat_agent:'codex'}));
const env={...process.env,PERO_BUILTIN_APPS:[...JSON.parse(await readFile(join(root,'products/pero.json'),'utf8')).apps,'data-agent'].join(','),PERO_DESKTOP_DATA_DIR:join(temp,'profile'),PERO_SETTINGS_PATH:settings,PERO_HISTORY_PATH:join(temp,'history.jsonl'),PERO_AGENTS_FILE:agents,PERO_LOCALE:'en'};
let app=await electron.launch({args:['--use-mock-keychain',join(distribution,'desktop')],cwd:distribution,env});
let page;const errors=[],checks=[],logs=[];app.process().stderr?.on('data',data=>logs.push(String(data)));
try {
  page=await app.firstWindow();page.on('pageerror',error=>errors.push(error.message));
  const state=()=>page.evaluate(()=>JSON.parse(window.peroDiagnostics.snapshot()));
  await page.waitForFunction(()=>window.peroDiagnostics&&!document.getElementById('loading'),undefined,{timeout:60000});
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1488,1086));
  await expect.poll(async()=>(await state()).apps?.some(value=>value.name==='data-agent')).toBe(true);
  await page.mouse.click(80,await page.evaluate(()=>innerHeight-52));
  await expect.poll(async()=>(await state()).navigation).toBe(7);
  await expect.poll(async()=>(await state()).appsLoading).toBe(false);
  const index=(await state()).apps.findIndex(value=>value.name==='data-agent');
  // GPUI's catalog is canvas-based. Calculate the row from the live catalog,
  // then assert that the requested App, not another row, actually opens.
  await page.mouse.click(1317,128+58*index);
  let frame=page.frameLocator('iframe[title="data-agent"]');
  await expect(frame.getByRole('button',{name:'Open example',exact:true})).toBeVisible({timeout:30000});
  await frame.locator('input[type=file]').first().setInputFiles(fixture);
  await expect(frame.locator('.data-grid tbody tr')).toHaveCount(3);
  await frame.getByLabel('Chart data',{exact:true}).selectOption('records');
  async function stableScreenshot(locator,path) {
    let previous;
    await expect.poll(async()=>{const current=await locator.screenshot({scale:'css'});const same=previous?.equals(current)??false;previous=current;return same;},{timeout:7000,intervals:[250,250,500]}).toBe(true);
    await writeFile(path,previous);
  }
  const select=(name,value)=>frame.getByLabel(name,{exact:true}).selectOption(value);
  let panel=frame.locator('.data-chart-panel');
  for(const kind of ['line','bar','area','pie','radar','candlestick','sankey']) {
    await select('Chart type',kind);
    await select(kind==='sankey'?'Source':'X / category','period');
    if(kind==='candlestick') for(const field of ['Open','High','Low','Close']) await select(field,field.toLowerCase());
    else { if(kind==='sankey') await select('Target','target'); await select('Value','value'); }
    await frame.getByRole('button',{name:'Create chart',exact:true}).click();
    await expect(frame.getByRole('button',{name:'Export chart JSON',exact:true})).toBeVisible({timeout:30000});
    await frame.locator('iframe[data-pero-chart]').evaluate(element=>element.scrollIntoView({block:'center'}));
    const chartFrame=frame.frameLocator('iframe[data-pero-chart]');
    await expect(chartFrame.locator('canvas').first()).toBeVisible({timeout:60000});
    await expect(chartFrame.locator('#loading')).toHaveCount(0,{timeout:60000});
    await expect.poll(()=>chartFrame.locator('canvas').first().evaluate(canvas=>canvas.width>0&&canvas.height>0)).toBe(true);
    await stableScreenshot(frame.locator('iframe[data-pero-chart]'),join(output,`${kind}.png`));
    await expect(panel.locator('[role=alert]')).toHaveCount(0);
    checks.push(`${kind}: GPUI canvas rendered`);
  }
  await panel.locator('summary').filter({hasText:'Chart source'}).click();
  await expect(panel.locator('.data-chart-source')).toContainText('Source digest');
  await expect(panel.locator('.data-chart-source')).toContainText('View:');
  await panel.locator('summary').filter({hasText:'Source records'}).click();
  await expect(panel.locator('.data-chart-source')).toContainText('/0');
  await expect(panel.locator('.data-chart-source')).toContainText('/1');
  const exported=join(temp,'chart.json');
  await app.evaluate(({BrowserWindow},path)=>{BrowserWindow.getAllWindows()[0].webContents.session.once('will-download',(_,item)=>item.setSavePath(path));},exported);
  await frame.getByRole('button',{name:'Export chart JSON',exact:true}).click();
  await expect.poll(async()=>{try{return JSON.parse(await readFile(exported,'utf8')).chart.type;}catch{return '';}}).toBe('sankey');
  const document=JSON.parse(await readFile(exported,'utf8'));
  expect(document.rows).toHaveLength(3);expect(document.source.records).toHaveLength(3);
  await panel.locator('summary').filter({hasText:'Saved charts'}).click();
  let saved=frame.getByLabel('Open saved chart',{exact:true});
  await expect.poll(()=>saved.locator('option').count()).toBeGreaterThan(1);
  const sankey=await saved.locator('option').evaluateAll(options=>options.find(option=>option.textContent.includes('(sankey)'))?.value);
  expect(sankey).toBeTruthy();await saved.selectOption(sankey);
  await expect(frame.frameLocator('iframe[data-pero-chart]').locator('canvas').first()).toBeVisible({timeout:60000});
  await frame.locator('input[aria-label="Open chart JSON"]').setInputFiles(exported);
  await expect(frame.getByRole('button',{name:'Export chart JSON',exact:true})).toBeVisible({timeout:30000});
  await expect(frame.frameLocator('iframe[data-pero-chart]').locator('canvas').first()).toBeVisible({timeout:60000});
  checks.push('Dataset provenance survives export, saved chart reopening and chart JSON reimport');
  const invalid=join(temp,'invalid.json');await writeFile(invalid,JSON.stringify({...document,source:{label:'fixture'},rows:[{period:'A',target:'B',value:null}]}));
  await frame.locator('input[aria-label="Open chart JSON"]').setInputFiles(invalid);
  await expect(panel.locator('[role=alert]')).toContainText('missing values cannot be plotted');
  await expect(frame.getByRole('button',{name:'Export chart JSON',exact:true})).toHaveCount(0);
  checks.push('Missing values show an error without presenting a stale result');
  await frame.locator('input[aria-label="Open chart JSON"]').setInputFiles(exported);
  await expect(frame.frameLocator('iframe[data-pero-chart]').locator('canvas').first()).toBeVisible({timeout:60000});
  for(const dark of [false,true]) {
    await page.evaluate(dark=>window.pero.sessionCommand({method:'settings.workbench',preferences:{...JSON.parse(window.peroDiagnostics.snapshot()).preferences,appearance:dark?'dark':'light'}}),dark);
    await expect.poll(async()=>(await state()).appearance.dark).toBe(dark);
    await expect(frame.frameLocator('iframe[data-pero-chart]').locator('html')).toHaveCSS('color-scheme',dark?'dark':'light');
    await frame.locator('iframe[data-pero-chart]').scrollIntoViewIfNeeded();
    await page.screenshot({path:join(output,dark?'dark.png':'light.png'),scale:'css'});
  }
  checks.push('Chart iframe receives light and dark appearance');
  const pointExample=join(root,'tests/fixtures/data-chart-point.json');
  await frame.locator('input[aria-label="Open chart JSON"]').setInputFiles(pointExample);
  await expect(frame.getByRole('button',{name:'Export chart JSON',exact:true})).toBeVisible({timeout:30000});
  const pointChart=frame.locator('iframe[data-pero-chart]');
  await pointChart.evaluate(element=>element.scrollIntoView({block:'center'}));
  await expect(frame.frameLocator('iframe[data-pero-chart]').locator('canvas').first()).toBeVisible({timeout:60000});
  await expect(frame.frameLocator('iframe[data-pero-chart]').locator('#loading')).toHaveCount(0,{timeout:60000});
  await stableScreenshot(pointChart,join(output,'point-multiseries.png'));
  await panel.locator('summary').filter({hasText:'Chart data'}).click();
  await expect(panel.locator('.data-chart-table')).toContainText('Team');
  await expect(panel.locator('.data-chart-table')).toContainText('—');
  checks.push('Point multi-series JSON renders; missing Team observation remains missing in chart data');
  await app.evaluate(({BrowserWindow})=>{for(const window of BrowserWindow.getAllWindows())window.destroy();});await app.close();
  app=await electron.launch({args:['--use-mock-keychain',join(distribution,'desktop')],cwd:distribution,env});
  page=await app.firstWindow();page.on('pageerror',error=>errors.push(error.message));
  await page.waitForFunction(()=>window.peroDiagnostics&&!document.getElementById('loading'),undefined,{timeout:60000});
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1488,1086));
  await expect.poll(async()=>(await state()).apps?.some(value=>value.name==='data-agent')).toBe(true);
  await page.mouse.click(80,await page.evaluate(()=>innerHeight-52));await expect.poll(async()=>(await state()).navigation).toBe(7);
  await expect.poll(async()=>(await state()).appsLoading).toBe(false);
  const restartIndex=(await state()).apps.findIndex(value=>value.name==='data-agent');
  await page.mouse.click(1317,128+((await state()).contentTabs.length?30:0)+58*restartIndex);
  frame=page.frameLocator('iframe[title="data-agent"]');panel=frame.locator('.data-chart-panel');saved=frame.getByLabel('Open saved chart',{exact:true});
  await expect(frame.getByRole('button',{name:'Open example',exact:true})).toBeVisible({timeout:30000});
  await panel.locator('summary').filter({hasText:'Saved charts'}).click();
  await expect.poll(()=>saved.locator('option').count()).toBeGreaterThan(1);
  const restartedSankey=await saved.locator('option').evaluateAll(options=>options.find(option=>option.textContent.includes('(sankey)'))?.value);
  expect(restartedSankey).toBeTruthy();await saved.selectOption(restartedSankey);
  await expect(frame.getByRole('button',{name:'Export chart JSON',exact:true})).toBeVisible({timeout:30000});
  await panel.locator('summary').filter({hasText:'Chart source'}).click();
  await panel.locator('summary').filter({hasText:'Source records'}).click();
  await panel.locator('.data-chart-source button').first().click();
  await expect.poll(async()=>(await state()).documents?.some(value=>value.item.value.origin?.app==='data-agent'&&value.reader.source)).toBe(true);
  checks.push('Saved chart survives Desktop restart and its original record opens in the shared source reader');
  expect(errors).toEqual([]);
  await writeFile(join(output,'result.json'),JSON.stringify({checks,errors,logs},null,2));
  console.log('Data Agent chart, provenance, persistence and theme checks passed.');
} catch(error) {
  await writeFile(join(output,'failure-log.json'),JSON.stringify({checks,errors,logs},null,2));
  if(page){await page.screenshot({path:join(output,'failure.png'),scale:'css'});await writeFile(join(output,'failure-state.json'),await page.evaluate(()=>window.peroDiagnostics?.snapshot()||'{}'));}
  throw error;
} finally {await app.evaluate(({BrowserWindow})=>{for(const window of BrowserWindow.getAllWindows())window.destroy();}).catch(()=>{});await app.close();}
