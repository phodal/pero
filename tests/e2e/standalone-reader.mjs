// Bare HTTP App, actual Python data and the independently embedded GPUI reader.
import {expect} from '@playwright/test';
import {electron} from './electron.mjs';
import {createServer} from 'node:http';
import {spawn,execFileSync} from 'node:child_process';
import {createInterface} from 'node:readline';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {resolve,join,sep,extname} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
const root=resolve(import.meta.dirname,'../..'),out=join(root,'test-results/standalone-reader');await mkdir(out,{recursive:true});
const temp=await mkdtemp(join(tmpdir(),'pero-standalone-reader-'));
const assets=process.env.PERO_READER_TEST_ASSETS||join(root,'web/dist-reader');
execFileSync(process.execPath,[join(root,'scripts/build/apps.mjs'),'--app','data-agent','--reader-dist',assets],{cwd:root,stdio:'inherit'});
const token=randomUUID();
const backend=spawn('python3',['-E','-s','-u','-B',join(root,'apps/data-agent/backend/server.py')],{env:{...process.env,PERO_APP_DATA:join(temp,'data'),PERO_APP_TOKEN:token},stdio:['ignore','pipe','pipe']});
const port=await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(new Error('Python readiness timed out')),15000);
  const lines=createInterface({input:backend.stdout});lines.once('line',line=>{clearTimeout(timer);lines.close();resolve(JSON.parse(line).port);});backend.once('error',reject);
});
const directory=join(root,'apps/data-agent/dist');
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.json':'application/json','.svg':'image/svg+xml'};
const server=createServer(async(request,response)=>{
  try{
    const url=new URL(request.url,'http://localhost');
    if(url.pathname.startsWith('/api/')){
      const body=[];for await(const chunk of request)body.push(chunk);
      const result=await fetch(`http://127.0.0.1:${port}${url.pathname}`,{method:request.method,headers:{'X-Pero-App-Token':token,'Content-Type':'application/json'},body:request.method==='POST'?Buffer.concat(body):undefined});
      response.writeHead(result.status,{'Content-Type':'application/json'});response.end(Buffer.from(await result.arrayBuffer()));return;
    }
    const file=resolve(directory,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));
    if(!file.startsWith(directory+sep))throw new Error('Invalid static path');
    response.writeHead(200,{'Content-Type':types[extname(file)]||'application/octet-stream'});response.end(await readFile(file));
  }catch(error){response.writeHead(404);response.end('Not found');}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url=`http://127.0.0.1:${server.address().port}/`;
const main=join(temp,'main.cjs');await writeFile(main,`const{app,BrowserWindow}=require(${JSON.stringify(join(root,'node_modules/electron'))});app.setActivationPolicy?.('accessory');app.whenReady().then(()=>{const w=new BrowserWindow({show:false,width:1280,height:900,webPreferences:{backgroundThrottling:false,contextIsolation:true,nodeIntegration:false,sandbox:true}});w.loadURL(${JSON.stringify(url)});});app.on('window-all-closed',()=>app.quit());`);
// Electron modules are supplied by its runtime, not the npm executable package.
await writeFile(main,(await readFile(main,'utf8')).replace(`require(${JSON.stringify(join(root,'node_modules/electron'))})`,`require('electron')`));
let app,page;const errors=[],checks=[],logs=[];
try{
  app=await electron.launch({args:[main],cwd:root});page=await app.firstWindow();page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error'||message.type()==='warning')logs.push(message.text());});
  await page.getByRole('button',{name:'Open example',exact:true}).click();await expect(page.locator('.data-grid tbody tr')).toHaveCount(6);
  await expect(page.getByRole('button',{name:'Ask Agent',exact:true})).toBeDisabled();
  const source=await page.evaluate(async()=>{const value=await(await fetch('/api/datasets')).json();return(await(await fetch('/api/source/'+value.datasets[0].id)).json()).content;});
  await page.getByRole('button',{name:'Source',exact:true}).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect.poll(()=>page.frames().some(frame=>frame.url().includes('/_reader/reader.html'))).toBe(true);
  let reader=page.frames().find(frame=>frame.url().includes('/_reader/reader.html'));
  await reader.waitForFunction(()=>window.peroReaderDiagnostics&&JSON.parse(window.peroReaderDiagnostics.snapshot()).reader,undefined,{timeout:60000});
  const snapshot=()=>reader.evaluate(()=>JSON.parse(window.peroReaderDiagnostics.snapshot()));
  await expect.poll(async()=>(await snapshot()).reader.rows).toBe(6);expect((await snapshot()).reader.editable).toBe(false);
  const box=await page.locator('iframe[data-pero-reader]').boundingBox();
  await page.mouse.click(box.x+95,box.y+16);await expect.poll(async()=>(await snapshot()).reader.source).toBe(true);
  await page.keyboard.press(process.platform==='darwin'?'Meta+a':'Control+a');await page.keyboard.press(process.platform==='darwin'?'Meta+c':'Control+c');
  await expect.poll(()=>app.evaluate(({clipboard})=>clipboard.readText())).toBe(source);
  await page.screenshot({path:join(out,'bare-source.png'),scale:'css'});
  checks.push('Bare App uses the same structured GPUI reader, readonly source, native selection and exact complete copy');
  await page.getByRole('button',{name:'Close tab',exact:true}).click();
  await page.getByLabel('Show record source 3',{exact:true}).click();
  await expect.poll(()=>page.frames().some(frame=>frame.url().includes('/_reader/reader.html'))).toBe(true);
  reader=page.frames().find(frame=>frame.url().includes('/_reader/reader.html'));
  await reader.waitForFunction(()=>window.peroReaderDiagnostics&&JSON.parse(window.peroReaderDiagnostics.snapshot()).reader?.source,undefined,{timeout:60000});
  const located=JSON.parse(await reader.evaluate(()=>window.peroReaderDiagnostics.snapshot()));
  expect(located.reader.revision).toBe(1);expect(located.reader.selection.end).toBeGreaterThan(located.reader.selection.start);
  const selected=Buffer.from(source).subarray(located.reader.selection.start,located.reader.selection.end).toString();expect(selected).toContain('2026-08');expect(selected).toContain('East');
  checks.push('Closing and reopening retains source revision; record links resolve original source spans in the independent reader');
  await page.screenshot({path:join(out,'bare-record.png'),scale:'css'});
  expect(errors).toEqual([]);await writeFile(join(out,'result.json'),JSON.stringify({assets,checks,errors,realBackend:true,realModel:false},null,2));
  console.log('Standalone shared GPUI reader and original-record navigation passed.');
}catch(error){let frames=[];if(page){await page.screenshot({path:join(out,'failure.png'),scale:'css'});frames=await Promise.all(page.frames().map(async frame=>({url:frame.url(),body:await frame.locator('body').innerText().catch(()=>''),state:await frame.evaluate(()=>window.peroReaderDiagnostics?.snapshot()).catch(()=>undefined)})));}await writeFile(join(out,'failure.json'),JSON.stringify({checks,errors,logs,frames,error:String(error)},null,2));throw error;}
finally{if(app){await app.evaluate(({BrowserWindow})=>{for(const window of BrowserWindow.getAllWindows())window.destroy();}).catch(()=>{});await app.close();}server.closeAllConnections();await new Promise(resolve=>server.close(resolve));backend.kill('SIGTERM');}
