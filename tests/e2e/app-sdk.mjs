// Real browser verification of the App SDK. Host lifecycle has separate stdio contracts.
import { existsSync } from 'node:fs';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { appSdkAliases } from '../../scripts/build/app-sdk.mjs';
const root = resolve(import.meta.dirname,'../..');
const directory = await mkdtemp(join(tmpdir(),'pero-sdk-browser-'));
const output = resolve(root,'test-results/app-sdk');
await mkdir(output,{recursive:true});
await build({stdin:{resolveDir:root,loader:'tsx',contents:`
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {AppApiProvider,applyTheme,useTheme,AppConversation,AppDesktop,AppProjectRunConversation} from '@pero/app-sdk';
import {Button,Icon,FileTree,Table,Select,Checkbox,Switch,TimeField,Field,Input,Dialog,DropdownMenu,DropdownMenuTrigger,DropdownMenuContent,DropdownMenuItem,Tabs,TabsList,TabsTrigger,TabsContent,CodeViewer,ResultView,MarkdownText,Progress,Split,SplitPane,Feedback} from '@pero/app-sdk/ui';
import {DocumentChart,TimeSeriesLanes} from '@pero/app-sdk/chart';
const host={appName:'sdk-lab',allowedApiPaths:[],allowedEvents:[],subscribeFn:()=>()=>{},navigateFn:()=>{},notifyFn:()=>{}};
const rows=[{id:'ACCOUNT',lines:124,status:'Checked'},{id:'PAYMENT',lines:82,status:'Review'},{id:'CUSTOMER',lines:219,status:'Checked'}];
const chart={schemaVersion:1,title:'Source lines',chart:{type:'bar',x:'name',y:'lines'},rows:rows.map(row=>({name:row.id,lines:row.lines})),source:{label:'Local source files'}};
const source='       IDENTIFICATION DIVISION.\\n       PROGRAM-ID. ACCOUNT.\\n       DATA DIVISION.\\n       WORKING-STORAGE SECTION.\\n       01 AMOUNT PIC 9(7)V99.\\n       PROCEDURE DIVISION.\\n       MAIN.\\n           MOVE 100 TO AMOUNT.\\n           DISPLAY AMOUNT.\\n           GOBACK.';
function Lab(){
 const [file,setFile]=useState('src/ACCOUNT.cbl'),[db,setDb]=useState('sqlite'),[checked,setChecked]=useState(false),[enabled,setEnabled]=useState(true),[time,setTime]=useState('09:30'),[dialog,setDialog]=useState(false),[tab,setTab]=useState('source'),[message,setMessage]=useState('Ready');const theme=useTheme();
 return <main><header><div><h1>App SDK</h1><p>Source analysis workbench</p></div><div className="actions"><Select label="Theme" value={theme.id} onChange={id=>applyTheme(id)} options={[{value:'pero-light',label:'Light'},{value:'pero-dark',label:'Dark'},{value:'pero-high-contrast',label:'High contrast'}]}/><Button onClick={()=>setDialog(true)}>Configure</Button><DropdownMenu><DropdownMenuTrigger asChild><Button>Actions</Button></DropdownMenuTrigger><DropdownMenuContent><DropdownMenuItem onSelect={()=>setMessage('Exported')}>Export results</DropdownMenuItem><DropdownMenuItem disabled>Delete locked source</DropdownMenuItem></DropdownMenuContent></DropdownMenu></div></header>
 <div className="filters"><Field label="Database">{props=><Select {...props} label="Database" value={db} onChange={setDb} searchable searchLabel="Find database" options={[{value:'sqlite',label:'SQLite'},{value:'postgres',label:'PostgreSQL'},{value:'db2',label:'Db2',disabled:true}]}/>}</Field><label><Checkbox checked={checked} onCheckedChange={v=>setChecked(v===true)}/> Include copybooks</label><label><Switch checked={enabled} onCheckedChange={setEnabled}/> Live analysis</label><TimeField label="Run at" locale="en" value={time} onChange={setTime}/><output aria-label="Database value">{db}</output></div>
 <Split storageKey="sdk-lab-layout" collapseBelow={720} className="workspace"><SplitPane id="files" size={230} min={160} resizeLabel="Files pane"><h2>Files</h2><FileTree label="Project files" paths={['src/ACCOUNT.cbl','src/PAYMENT.cbl','copybooks/CUSTOMER.cpy']} selectedPath={file} onSelect={setFile}/><h2>Programs</h2><Table label="Programs" rows={rows} rowId={row=>row.id} columns={[{id:'program',header:'Program',size:120,minSize:100,cell:row=>row.id},{id:'lines',header:'Lines',size:80,minSize:60,cell:row=>row.lines,meta:{align:'end'}}]}/><Progress label="Files analyzed" value={3} max={3}/></SplitPane><SplitPane id="content" min={300}><Tabs value={tab} onValueChange={setTab}><TabsList aria-label="Analysis views"><TabsTrigger value="source">Source</TabsTrigger><TabsTrigger value="charts">Charts</TabsTrigger><TabsTrigger value="results">Results</TabsTrigger></TabsList><TabsContent value="source"><h2>{file}</h2><div className="source"><CodeViewer label="COBOL source" language="cobol" text={source} lineMarks={[{startLine:8,endLine:8,className:'analysis-mark'}]} ranges={[{startLine:7,endLine:10}]}/></div><MarkdownText text={'### Analysis\\nThe **AMOUNT** field uses fixed decimal precision.\\n\\n- Preserve decimal behavior.\\n- Keep evidence linked to source.'}/></TabsContent><TabsContent value="charts"><DocumentChart document={chart}/><TimeSeriesLanes lanes={[{key:'latency',label:'Analysis duration',unit:'ms',points:[[0,2,0],[1,4,1],null,[3,3,3],[4,5,4]]}]} range={[0,4]} options={{formatX:value=>value.toFixed(1)}}/></TabsContent><TabsContent value="results"><ResultView result={{version:1,kind:'table',title:'Analysis results',columns:['Program','Lines','Status'],rows:rows.map(row=>[row.id,row.lines,row.status]),provenance:{kind:'calculated',label:'Local source analysis'}}}/><AppConversation fallback={<Feedback>Conversation unavailable in this browser fixture.</Feedback>}/><AppDesktop fallback={<Feedback>Desktop target unavailable in this browser fixture.</Feedback>}/></TabsContent></Tabs></SplitPane></Split>
 <footer role="status">{message}</footer>{dialog&&<Dialog title="Analysis settings" onClose={()=>setDialog(false)} footer={<Button onClick={()=>setDialog(false)}>Save settings</Button>}><Field label="Workspace name">{props=><Input {...props} defaultValue="Source review"/>}</Field><Select label="Dialog database" value={db} onChange={setDb} options={[{value:'sqlite',label:'SQLite'},{value:'postgres',label:'PostgreSQL'}]}/></Dialog>}</main>
}
createRoot(document.getElementById('app')).render(<AppApiProvider {...host}><Lab/></AppApiProvider>);
`},outfile:join(directory,'index.js'),bundle:true,format:'esm',platform:'browser',jsx:'automatic',alias:{...appSdkAliases(root),react:resolve(root,'node_modules/react'),'react-dom':resolve(root,'node_modules/react-dom')},loader:{'.woff2':'file'}});
await writeFile(join(directory,'index.html'),`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="index.css"><style>body{margin:0}main{padding:20px;max-width:1400px;margin:auto}header{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:20px}h1{font-size:22px;margin:0}header p{margin:6px 0;color:var(--pero-text-secondary)}h2{font-size:14px;font-weight:600;margin:18px 0 10px}.actions,.filters{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.filters{padding:12px 0 20px}.filters>label{display:flex;align-items:center;gap:8px}.filters .pero-ui-field{width:180px}.workspace{height:640px;border-block:1px solid var(--pero-border);padding-top:10px}.workspace>section,.workspace>aside,.workspace>div{min-width:0}.source{height:310px}.analysis-mark{border-left:3px solid var(--pero-warning);background:var(--pero-warning-bg)}footer{padding-top:12px;color:var(--pero-text-secondary)}@media(max-width:720px){main{padding:12px}header{align-items:flex-start;flex-wrap:wrap}.actions{gap:8px}.workspace{height:auto;min-height:900px}.source{height:290px}}</style></head><body><div id="app"></div><script type="module" src="index.js"></script></body></html>`);
const server=createServer(async(req,res)=>{
 const name=req.url==='/'?'index.html':req.url.slice(1);
 if(!/^[\w.-]+$/.test(name)){res.writeHead(404).end();return;}
 const data=await readFile(join(directory,name)).catch(()=>null);
 if(!data){res.writeHead(404).end();return;}
 res.writeHead(200,{'Content-Type':name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html'}).end(data);
});
let browser,page;
const errors=[];
try{
 server.listen(0,'127.0.0.1');await once(server,'listening');
 const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
 const executablePath = process.env.PERO_CHROMIUM_EXECUTABLE || (process.platform === 'darwin' && existsSync(chrome) ? chrome : undefined);
 browser=await chromium.launch({headless:true,...(executablePath ? {executablePath} : {})});
 page=await browser.newPage({viewport:{width:1280,height:960}});page.setDefaultTimeout(10000);
 page.on('pageerror',error=>errors.push(error.message));
 await page.goto('http://127.0.0.1:'+server.address().port);
 await page.getByRole('textbox',{name:'COBOL source'}).waitFor();
 await page.getByRole('checkbox',{name:'Include copybooks'}).check();
 assert.equal(await page.getByRole('checkbox',{name:'Include copybooks'}).getAttribute('aria-checked'),'true');
 await page.getByRole('button',{name:'Database',exact:true}).click();
 await page.getByRole('combobox',{name:'Find database'}).fill('post');
 await page.getByRole('option',{name:'PostgreSQL'}).click();
 assert.equal(await page.getByLabel('Database value').textContent(),'postgres');
 await page.getByRole('button',{name:'Configure',exact:true}).click();
 assert.equal(await page.getByRole('textbox',{name:'Workspace name'}).inputValue(),'Source review');
 await page.getByRole('button',{name:'Dialog database'}).click();
 assert.equal(await page.getByRole('dialog',{name:'Analysis settings'}).getByRole('listbox').count(),1);
 await page.keyboard.press('Escape');await page.keyboard.press('Escape');
 await page.getByRole('button',{name:'Configure',exact:true}).waitFor({state:'visible'});
 await page.getByRole('button',{name:'Actions',exact:true}).click();
 await page.getByRole('menuitem',{name:'Export results'}).click();
 await page.getByRole('status').filter({hasText:'Exported'}).waitFor();
 await page.screenshot({path:join(output,'light.png'),fullPage:true});
 await page.getByRole('tab',{name:'Charts',exact:true}).click();
 await page.locator('[data-pero-document-chart][data-state=ready]').waitFor();
 assert.equal(await page.locator('[data-segments="2"][data-drawn-segments="2"]').count(),1);
 await page.getByRole('button',{name:'Theme',exact:true}).click();await page.getByRole('option',{name:'Dark',exact:true}).click();
 await page.screenshot({path:join(output,'dark.png'),fullPage:true});
 assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--pero-text').trim()),'#EAF1F8');
 await page.getByRole('tab',{name:'Results',exact:true}).click();
 await page.getByRole('table',{name:'Analysis results'}).waitFor();
 await page.setViewportSize({width:565,height:950});
 await page.screenshot({path:join(output,'narrow.png'),fullPage:true});
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Narrow layout must not overflow');
 assert.deepEqual(errors,[]);
 await writeFile(join(output,'verification.json'),JSON.stringify({scope:'Real browser SDK UI fixture; Host lifecycle verified separately',checks:['checkbox intent','searchable selector','dialog focus and nested portal','Escape dismissal','menu action','source rendering','SVG document chart','time-series null gaps','dark theme','narrow overflow'],errors},null,2));
 console.log('App SDK browser verification passed: '+output);
}catch(error){if(page){await page.screenshot({path:join(output,'failure.png'),fullPage:true});console.error(JSON.stringify({errors,chartError:await page.locator('.pero-doc-chart__error').getAttribute('title').catch(()=>null),body:(await page.locator('body').innerText()).slice(0,4000)}));}throw error;}finally{await browser?.close();server.closeAllConnections();await new Promise(done=>server.close(done));await rm(directory,{recursive:true,force:true});}
