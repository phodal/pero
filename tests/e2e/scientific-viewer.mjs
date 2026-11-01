// Real Desktop/App/public engines; synthetic examples and ACP, never a provider.
import {expect} from '@playwright/test';
import {mkdir,mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {resolve} from 'node:path';import {tmpdir} from 'node:os';import {createRequire} from 'node:module';
import {electron} from './electron.mjs';import {closeOwnedElectron} from './owned-electron-close.mjs';
import {clickAppShortcut,setAppearance} from './sidebar-controls.mjs';
import {examples} from '../../apps/scientific-viewer/ui-src/examples.ts';
const {unzipSync}=createRequire(new URL('../../apps/scientific-viewer/package.json',import.meta.url))('fflate');
const root=resolve(import.meta.dirname,'../..'),out=resolve(root,'test-results/scientific-viewer');await mkdir(out,{recursive:true});
const temp=await mkdtemp(resolve(tmpdir(),'pero-viewer-')),errors=[],checks=[];
const capture=resolve(temp,'agent-prompts.jsonl'),agents=resolve(temp,'agents.json');
await writeFile(agents,JSON.stringify([
 ...['pero','claude','copilot','grok','qoder','opencode'].map(id=>({id,name:id,command:resolve(temp,`unavailable-${id}`)})),
 {id:'codex',name:'Synthetic evidence review',command:process.execPath,args:[resolve(root,'apps/scientific-viewer/test/agent-fixture.mjs'),capture]},
]));
const env={...process.env,PERO_AGENTS_FILE:agents,PERO_DESKTOP_DATA_DIR:resolve(temp,'profile'),PERO_SETTINGS_PATH:resolve(temp,'settings.json'),PERO_HISTORY_PATH:resolve(temp,'history.jsonl'),PERO_BUILTIN_APPS:'scientific-viewer,paper-agent',PERO_REQUIRED_APPS:'scientific-viewer',PERO_LOCALE:'en'};
delete env.ELECTRON_RUN_AS_NODE;delete env.POINT_ROOT;delete env.PERO_POINT_ROOT;delete env.PERO_APPS_ROOT;
let app,page,frame;
async function open(){
 await page.waitForFunction(()=>window.peroDiagnostics&&!document.getElementById('loading'),undefined,{timeout:60000});
 await expect.poll(()=>page.evaluate(()=>JSON.parse(window.peroDiagnostics.snapshot()).apps?.some(app=>app.name==='scientific-viewer'&&app.enabled))).toBe(true);
 await page.waitForFunction(()=>{const canvas=document.querySelector('canvas');return canvas?.width===Math.round(innerWidth*devicePixelRatio)&&canvas.height===Math.round(innerHeight*devicePixelRatio);});
 // Enabled catalog Apps also have a direct sidebar shortcut, measured at paint.
 await clickAppShortcut(page,'scientific-viewer');
 await expect.poll(()=>page.evaluate(()=>JSON.parse(window.peroDiagnostics.snapshot()).activeApp)).toMatchObject({name:'scientific-viewer',panel:'viewer'});
 frame=page.frameLocator('iframe[title="scientific-viewer"]');
 await expect(frame.getByRole('heading',{name:'Scientific Viewer',exact:true})).toBeVisible();
}
try{
 app=await electron.launch({args:[resolve(root,'desktop')],cwd:root,env});page=await app.firstWindow();page.on('pageerror',error=>errors.push(error.message));await open();
 for(const example of examples){
  await frame.getByLabel('Example',{exact:true}).selectOption(example.name);await expect(frame.getByRole('heading',{name:example.name,exact:true})).toBeVisible();await expect(frame.getByText('Synthetic example · Unverified',{exact:true})).toBeVisible();
  if(example.name.endsWith('.csv')){
   await expect(frame.getByRole('table')).toBeVisible();if(example.name!=='quoted-table.csv'){await frame.getByRole('button',{name:'Spectrum',exact:true}).click();await expect(frame.getByRole('img',{name:'Spectrum from first two columns'})).toBeVisible();}
   if(example.name==='invalid-spectrum.csv')await expect(frame.getByRole('alert')).toContainText('2 missing or nonnumeric pairs');
  }
  if(example.name.endsWith('.pdb')){await expect(frame.getByRole('status')).toContainText('Structure ready',{timeout:45000});await expect(frame.locator('.molecule-view canvas').first()).toBeVisible();}
  if(example.name.endsWith('.smi')){await expect(frame.getByRole('img',{name:'Molecule 1',exact:true})).toBeVisible({timeout:45000});if(example.name.startsWith('invalid'))await expect(frame.getByRole('alert')).toContainText('Invalid molecule');}
  if(example.name.endsWith('.pdf')){
   const canvas=frame.getByLabel('PDF page 1',{exact:true});await expect(canvas).toBeVisible();await expect(frame.getByLabel('PDF page text')).toContainText('Synthetic scientific evidence.');
   await frame.getByLabel('Find quotation').fill('invented quotation');await expect(frame.getByRole('button',{name:'Save quotation',exact:true})).toBeDisabled();
   await frame.getByLabel('Find quotation').fill('Synthetic scientific evidence.');await frame.getByRole('button',{name:'Save quotation',exact:true}).click();await expect(frame.getByText('1 quotations, 0 figure crops. Unreviewed.',{exact:true})).toBeVisible();
   const box=await canvas.boundingBox();expect(box).not.toBeNull();await page.mouse.move(box.x+20,box.y+20);await page.mouse.down();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.up();await frame.getByRole('button',{name:'Save figure crop',exact:true}).click();await expect(frame.getByText('1 quotations, 1 figure crops. Unreviewed.',{exact:true})).toBeVisible();
   await frame.getByLabel('Review Agent',{exact:true}).selectOption('codex');await frame.getByRole('button',{name:'Review selected quotations',exact:true}).click();await expect(frame.locator('summary').filter({hasText:'Agent review — completed — unreviewed'})).toBeVisible({timeout:30000});await expect(frame.getByText('Synthetic transport review. The quotation is present; scientific validity is not assessed.',{exact:true})).toBeVisible();
   const prompts=(await readFile(capture,'utf8')).trim().split('\n').map(JSON.parse);expect(prompts).toHaveLength(1);expect(prompts[0].every(item=>item.type==='text')).toBe(true);expect(JSON.stringify(prompts)).not.toContain('%PDF');
   const download=page.waitForEvent('download');await frame.getByRole('button',{name:'Export evidence',exact:true}).click();await(await download).saveAs(resolve(out,'evidence.zip'));const archive=unzipSync(await readFile(resolve(out,'evidence.zip')));expect(Buffer.from(archive['source/document.pdf'])).toEqual(Buffer.from(example.text));const manifest=JSON.parse(new TextDecoder().decode(archive['manifest.json']));expect(manifest.quotes).toHaveLength(1);expect(manifest.crops).toHaveLength(1);expect(manifest.review.status).toBe('completed');expect(manifest.review.text).toContain('Synthetic transport review.');
  }checks.push(example.name);
 }
 // Harmless markup markers prove that user structure text never becomes DOM.
 const marker="data_marker\n_struct.title '<b id=viewer-marker>untrusted</b>'\n";
 await frame.getByLabel('Import file',{exact:true}).setInputFiles({name:'marker.cif',mimeType:'text/plain',buffer:Buffer.from(marker)});
 await expect(frame.getByRole('alert')).toContainText('preview blocked');await expect(frame.locator('#viewer-marker')).toHaveCount(0);
 await frame.getByRole('button',{name:'water.pdb',exact:true}).click();await expect(frame.getByRole('status')).toContainText('Structure ready',{timeout:45000});
 const transfer=await frame.locator('.molecule-view').evaluateHandle((_node,text)=>{const data=new DataTransfer();data.items.add(new File([text],'marker.cif',{type:'text/plain'}));return data;},marker);
 await frame.locator('.msp-layout-standard').dispatchEvent('dragenter',{dataTransfer:transfer});
 await expect(frame.locator('.msp-drag-drop-overlay')).toBeVisible();
 await frame.locator('.msp-drag-drop-overlay').dispatchEvent('drop',{dataTransfer:transfer});await transfer.dispose();
 await expect(frame.getByRole('heading',{name:'water.pdb',exact:true})).toBeVisible();
 await expect(frame.locator('.molecule-view canvas').first()).toBeVisible();
 await expect(frame.getByRole('alert')).toContainText('Import file');await expect(frame.locator('#viewer-marker')).toHaveCount(0);
 await frame.getByLabel('Import file',{exact:true}).setInputFiles({name:'empty.smi',mimeType:'text/plain',buffer:Buffer.from(' \n\t\n')});
 await expect(frame.getByRole('alert')).toContainText('No molecule records');await expect(frame.getByText('Loading RDKit…',{exact:true})).toHaveCount(0);
 await frame.getByLabel('Import file',{exact:true}).setInputFiles({name:'model.weights',mimeType:'application/octet-stream',buffer:Buffer.from('opaque synthetic model')});await expect(frame.getByText(/Metadata only/)).toBeVisible();
 await closeOwnedElectron(app);app=undefined;app=await electron.launch({args:[resolve(root,'desktop')],cwd:root,env});page=await app.firstWindow();page.on('pageerror',error=>errors.push(error.message));await open();await frame.getByRole('button',{name:'sample.pdf',exact:true}).click();await expect(frame.getByText('1 quotations, 1 figure crops. Unreviewed.',{exact:true})).toBeVisible();await expect(frame.locator('summary').filter({hasText:'Agent review — completed — unreviewed'})).toBeVisible();expect((await readFile(capture,'utf8')).trim().split('\n')).toHaveLength(1);
 await frame.getByRole('button',{name:'model.weights',exact:true}).click();await expect(frame.getByText(/Metadata only/)).toBeVisible();await setAppearance(page,'dark');await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(800,700));expect(await frame.locator('html').evaluate(node=>node.scrollWidth<=node.clientWidth+1)).toBe(true);
 await frame.getByRole('button',{name:'Open Paper App',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>JSON.parse(window.peroDiagnostics.snapshot()).activeApp)).toMatchObject({name:'paper-agent',panel:'main'});
 await expect(page.frameLocator('iframe[title="paper-agent"]').getByRole('heading',{name:'Papers',exact:true})).toBeVisible();await open();
 await page.screenshot({path:resolve(out,'viewer.png')});expect(errors).toEqual([]);await writeFile(resolve(out,'result.json'),JSON.stringify({checks,errors,synthetic:true,independentPublicEngines:true,scope:'local scientific previews and evidence; no physical validity claim'},null,2));
}catch(error){if(page)await page.screenshot({path:resolve(out,'failure.png')}).catch(()=>{});throw error;}
finally{if(app)await closeOwnedElectron(app);await rm(temp,{recursive:true,force:true});}
