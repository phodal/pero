// Real Desktop/App/public engines; synthetic examples and ACP, never a provider.
import {expect} from '@playwright/test';
import {execFileSync} from 'node:child_process';
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
const python = process.env.PERO_APP_PYTHON || 'python3';
const engine = JSON.parse(execFileSync(python,['-E','-s','-c','import json,sys; from rdkit import rdBase; from importlib.metadata import version; print(json.dumps({"root":sys.prefix,"version":rdBase.rdkitVersion,"paperRenderer":version("pypdfium2")}))'],{encoding:'utf8',timeout:30000}));
expect(engine.version).toBe('2026.09.1');
expect(engine.paperRenderer).toBe('5.0.0');
await writeFile(env.PERO_SETTINGS_PATH,JSON.stringify({app_python:{apps:{'scientific-viewer':engine.root,'paper-agent':engine.root}}}));
delete env.ELECTRON_RUN_AS_NODE;delete env.POINT_ROOT;delete env.PERO_POINT_ROOT;delete env.PERO_APPS_ROOT;
let app,page,frame,phase='startup';
const recordPageError=error=>errors.push({phase,name:error.name,message:error.message,stack:error.stack,completedChecks:[...checks]});
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
 app=await electron.launch({args:[resolve(root,'desktop')],cwd:root,env});page=await app.firstWindow();page.on('pageerror',recordPageError);await open();
 for(const example of examples){
  phase=`example:${example.name}`;
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
   const exportPath=resolve(out,'evidence.zip');await rm(exportPath,{force:true});
   // Electron owns App-frame downloads; Playwright Page does not receive this event.
   await app.evaluate(({session},path)=>{
    globalThis.viewerEvidenceDownload={state:'waiting',filename:null};
    session.defaultSession.once('will-download',(_event,item)=>{
     globalThis.viewerEvidenceDownload={state:'started',filename:item.getFilename()};
     item.setSavePath(path);
     item.once('done',(_event,state)=>{globalThis.viewerEvidenceDownload.state=state;});
    });
   },exportPath);
   await frame.getByRole('button',{name:'Export evidence',exact:true}).click();
   await expect.poll(()=>app.evaluate(()=>globalThis.viewerEvidenceDownload),{timeout:30000}).toEqual({state:'completed',filename:'scientific-evidence.zip'});
   const archive=unzipSync(await readFile(exportPath));expect(Buffer.from(archive['source/document.pdf'])).toEqual(Buffer.from(example.text));const manifest=JSON.parse(new TextDecoder().decode(archive['manifest.json']));expect(manifest.quotes).toHaveLength(1);expect(manifest.crops).toHaveLength(1);expect(manifest.review.status).toBe('completed');expect(manifest.review.text).toContain('Synthetic transport review.');
  }checks.push(example.name);
 }
 phase='structure-input-isolation';
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
 await expect(frame.getByRole('alert')).toContainText('No molecule records');await expect(frame.getByText('Preparing molecule preview…',{exact:true})).toHaveCount(0);
 await frame.getByLabel('Import file',{exact:true}).setInputFiles({name:'model.weights',mimeType:'application/octet-stream',buffer:Buffer.from('opaque synthetic model')});await expect(frame.getByText(/Metadata only/)).toBeVisible();
 // Removal is explicit, defaults to Cancel, and affects only the App copy.
 phase='local-copy-removal';
 const removalPath=resolve(temp,'removal-check.json'),removalBytes=Buffer.from('{"synthetic":"local copy removal"}');
 await writeFile(removalPath,removalBytes);
 await frame.getByLabel('Import file',{exact:true}).setInputFiles(removalPath);
 await expect(frame.getByRole('heading',{name:'removal-check.json',exact:true})).toBeVisible();
 const removal=frame.getByRole('group',{name:'Confirm local copy removal',exact:true});
 await frame.getByRole('button',{name:'Remove local copy',exact:true}).click();
 await expect(removal).toContainText('removal-check.json');await expect(removal.getByRole('button',{name:'Cancel',exact:true})).toBeFocused();
 await removal.getByRole('button',{name:'Cancel',exact:true}).click();await expect(removal).toHaveCount(0);
 await expect(frame.getByRole('button',{name:'removal-check.json',exact:true})).toBeVisible();
 await frame.getByRole('button',{name:'Remove local copy',exact:true}).click();await page.keyboard.press('Escape');await expect(removal).toHaveCount(0);
 await frame.getByRole('button',{name:'Remove local copy',exact:true}).click();
 await frame.getByRole('button',{name:'model.weights',exact:true}).click();await expect(removal).toHaveCount(0);
 await frame.getByRole('button',{name:'removal-check.json',exact:true}).click();
 await frame.getByRole('button',{name:'Remove local copy',exact:true}).click();await removal.getByRole('button',{name:'Confirm removal',exact:true}).click();
 await expect(frame.getByRole('button',{name:'removal-check.json',exact:true})).toHaveCount(0);
 await expect(frame.getByRole('button',{name:'model.weights',exact:true})).toBeVisible();expect(await readFile(removalPath)).toEqual(removalBytes);
 checks.push('confirmed local-copy removal; original disk file retained');
 phase='restart-and-restore';
 await closeOwnedElectron(app);app=undefined;app=await electron.launch({args:[resolve(root,'desktop')],cwd:root,env});page=await app.firstWindow();page.on('pageerror',recordPageError);await open();await frame.getByRole('button',{name:'sample.pdf',exact:true}).click();await expect(frame.getByText('1 quotations, 1 figure crops. Unreviewed.',{exact:true})).toBeVisible();await expect(frame.locator('summary').filter({hasText:'Agent review — completed — unreviewed'})).toBeVisible();expect((await readFile(capture,'utf8')).trim().split('\n')).toHaveLength(1);
 await expect(frame.getByRole('button',{name:'removal-check.json',exact:true})).toHaveCount(0);expect(await readFile(removalPath)).toEqual(removalBytes);
 await frame.getByRole('button',{name:'model.weights',exact:true}).click();await expect(frame.getByText(/Metadata only/)).toBeVisible();await setAppearance(page,'dark');const narrowSize=await app.evaluate(({BrowserWindow})=>{const window=BrowserWindow.getAllWindows()[0];window.setSize(800,700);return window.getContentSize();});
 await page.waitForFunction(([width,height])=>{const canvas=document.querySelector('canvas');return innerWidth===width&&innerHeight===height&&canvas?.width===Math.round(width*devicePixelRatio)&&canvas.height===Math.round(height*devicePixelRatio);},narrowSize);
 await expect.poll(()=>frame.locator('html').evaluate(node=>node.scrollWidth<=node.clientWidth+1)).toBe(true);
 phase='open-paper-app';
 await frame.getByRole('button',{name:'Open Paper App',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>JSON.parse(window.peroDiagnostics.snapshot()).activeApp)).toMatchObject({name:'paper-agent',panel:'main'});
 const paper=page.frameLocator('iframe[title="paper-agent"]');
 await expect(paper.locator('.pa-library-screen')).toBeVisible();
 await expect(paper.getByRole('button',{name:'Add papers',exact:true})).toBeVisible();await open();
 await page.screenshot({path:resolve(out,'viewer.png')});expect(errors).toEqual([]);await writeFile(resolve(out,'result.json'),JSON.stringify({checks,errors,synthetic:true,independentPublicEngines:true,scope:'local scientific previews and evidence; no physical validity claim'},null,2));
}catch(error){await writeFile(resolve(out,'failure.json'),JSON.stringify({phase,checks,errors,failure:{name:error.name,message:error.message,stack:error.stack}},null,2));if(page)await page.screenshot({path:resolve(out,'failure.png')}).catch(()=>{});throw error;}
finally{if(app)await closeOwnedElectron(app);await rm(temp,{recursive:true,force:true});}
