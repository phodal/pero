// Real Go harness + shared Python core + ACP + inline GPUI, with a loopback model fixture.
import {createServer} from 'node:http';
import {once} from 'node:events';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {tmpdir} from 'node:os';
import {expect} from '@playwright/test';
import {electron} from './electron.mjs';
const root=resolve(import.meta.dirname,'../..'), temp=await mkdtemp(join(tmpdir(),'pero-harness-chart-'));
const output=join(root,'test-results/harness-chart');await mkdir(output,{recursive:true});
const source='[{"period":"一月","value":9007199254740993},{"period":"二月","value":17},{"period":"三月","value":21}]';
const point=JSON.parse(await readFile(join(root,'tests/fixtures/data-chart-point.json'),'utf8'));
const docs=['line','bar','area','pie','radar'].map(type=>({document:{schemaVersion:1,id:type,title:`Harness ${type}`,chart:{type,x:'period',y:'value'},rows:[{period:'Jan',value:12},{period:'Feb',value:17},{period:'Mar',value:21}],source:{label:'Loopback test fixture',caveats:['Illustrative data']}}}));
docs[0]={document:point};
docs[1]={dataset:{name:'exact.json',content:source,format:'json'},chartDocument:{title:'Exact source',chart:{type:'bar',x:'label',y:'value'}},aggregation:{category:'period',measure:'value',aggregation:'sum'}};
docs.push({document:{schemaVersion:1,id:'candles',title:'Harness candles',chart:{type:'candlestick',x:'date',open:'o',high:'h',low:'l',close:'c'},rows:[{date:'Jan',o:3,h:5,l:2,c:4},{date:'Feb',o:4,h:7,l:3,c:6}],source:{label:'Fixture'}}});
docs.push({document:{schemaVersion:1,id:'flows',title:'Harness flows',chart:{type:'sankey',x:'from',target:'to',y:'value'},rows:[{from:'Revenue',to:'Profit',value:45},{from:'Revenue',to:'Cost',value:55}],source:{label:'Fixture'}}});
let requests=0;const providerErrors=[];
const server=createServer(async(req,res)=>{
 try {
  let text='';for await(const part of req)text+=part;
  const body=JSON.parse(text);expect(body.tools.some(tool=>tool.function?.name==='chart_render')).toBe(true);
  requests++;
  const delta=requests===1?{tool_calls:[{index:0,id:'invalid',type:'function',function:{name:'chart_render',arguments:JSON.stringify({document:{...docs[3].document,rows:[{period:'A',value:-1}]}})}}]}:
    requests===2?{tool_calls:docs.map((doc,index)=>({index,id:`chart-${index}`,type:'function',function:{name:'chart_render',arguments:JSON.stringify(doc)}}))}:{content:'HARNESS_CHART_OK'};
  res.writeHead(200,{'Content-Type':'text/event-stream'});
  res.write(`data: ${JSON.stringify({id:`reply-${requests}`,object:'chat.completion.chunk',model:'fixture',choices:[{index:0,delta,finish_reason:requests<=2?'tool_calls':'stop'}]})}\n\ndata: [DONE]\n\n`);res.end();
 } catch(error){providerErrors.push(String(error));res.writeHead(500);res.end('fixture failed');}
});server.listen(0,'127.0.0.1');await once(server,'listening');
const agents=join(temp,'agents.json');await writeFile(agents,JSON.stringify([{id:'chart-harness',name:'Real harness / fixture model',command:join(root,'target/debug/pero-agent-acp'),args:['--endpoint',`http://127.0.0.1:${server.address().port}/v1`,'--model','fixture','--session-dir',join(temp,'sessions'),'--approval','never'],env:{AGENT_PROVIDER_API_KEY:'loopback-fixture-only'}}]));
const settings=join(temp,'settings.json');await writeFile(settings,JSON.stringify({chat_agent:'chart-harness'}));
let app=await electron.launch({args:['--use-mock-keychain',join(root,'desktop')],cwd:root,env:{...process.env,PERO_DESKTOP_DATA_DIR:join(temp,'profile'),PERO_SETTINGS_PATH:settings,PERO_HISTORY_PATH:join(temp,'history.jsonl'),PERO_AGENTS_FILE:agents,PERO_LOCALE:'en'}});
let page;const errors=[],logs=[];app.process().stderr?.on('data',data=>logs.push(String(data)));
try {
 page=await app.firstWindow();page.on('pageerror',error=>errors.push(error.message));
 const state=()=>page.evaluate(()=>JSON.parse(window.peroDiagnostics.snapshot()));
 await page.waitForFunction(()=>window.peroDiagnostics&&!document.getElementById('loading'),undefined,{timeout:60000});
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1488,1086));
 await page.mouse.click(100,28);
 await expect.poll(async()=>(await state()).chats[0]?.state,{timeout:30000}).toBe('idle');
 await page.mouse.click(900,await page.evaluate(()=>innerHeight-80));await page.keyboard.insertText('Chart the supplied data and keep the sources visible.');await page.keyboard.press('Enter');
 await expect.poll(async()=>(await state()).chats[0]?.messages.filter(m=>m.role==='assistant').map(m=>m.text).join(''),{timeout:60000}).toContain('HARNESS_CHART_OK');
 let current=await state();let charts=current.chats[0].tools.filter(tool=>tool.chart);
 expect(charts).toHaveLength(7);expect(current.chats[0].tools.find(tool=>tool.id==='invalid').status).toBe('failed');
 expect(await page.locator('iframe[title="data-agent"]').count()).toBe(0);
 expect(charts.find(tool=>tool.id==='chart-1').chart.document.source.exactValues[0]).toBe('9007199254740993');
 expect(providerErrors).toEqual([]);
 const before=requests,identities=charts.map(tool=>tool.chart.artifact_id);
 await page.screenshot({path:join(output,'inline-light.png'),scale:'css'});
 await page.evaluate(()=>window.pero.sessionCommand({method:'settings.workbench',preferences:{...JSON.parse(window.peroDiagnostics.snapshot()).preferences,appearance:'dark'}}));
 await expect.poll(async()=>(await state()).appearance.dark).toBe(true);
 await page.screenshot({path:join(output,'inline-dark.png'),scale:'css'});
 await page.reload();await page.waitForFunction(()=>window.peroDiagnostics&&!document.getElementById('loading'),undefined,{timeout:60000});
 await expect.poll(async()=>(await state()).chats[0]?.tools.filter(tool=>tool.chart).length).toBe(7);
 expect((await state()).chats[0].tools.filter(tool=>tool.chart).map(tool=>tool.chart.artifact_id)).toEqual(identities);expect(requests).toBe(before);
 await app.evaluate(({BrowserWindow})=>{for(const window of BrowserWindow.getAllWindows())window.destroy();});await app.close();
 app=await electron.launch({args:['--use-mock-keychain',join(root,'desktop')],cwd:root,env:{...process.env,PERO_DESKTOP_DATA_DIR:join(temp,'profile'),PERO_SETTINGS_PATH:settings,PERO_HISTORY_PATH:join(temp,'history.jsonl'),PERO_AGENTS_FILE:agents,PERO_LOCALE:'en'}});
 page=await app.firstWindow();page.on('pageerror',error=>errors.push(error.message));
 await page.waitForFunction(()=>window.peroDiagnostics&&!document.getElementById('loading'),undefined,{timeout:60000});
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1488,1086));
 await expect.poll(async()=>(await state()).chats[0]?.tools.filter(tool=>tool.chart).length).toBe(7);
 expect((await state()).chats[0].tools.filter(tool=>tool.chart).map(tool=>tool.chart.artifact_id)).toEqual(identities);expect(requests).toBe(before);

 // Scroll the conversation until the chart's source control is actually visible.
 await page.mouse.move(1000,500);await page.mouse.wheel(0,-10000);
 await expect.poll(async()=>(await state()).scroll.y).toBe(0);await page.mouse.wheel(0,450);
 let bounds;
 await expect.poll(async()=>{bounds=(await state()).chartBounds.find(item=>item.id===identities[1])?.source;return bounds&&bounds.y>60&&bounds.y+bounds.height<await page.evaluate(()=>innerHeight-150);}).toBe(true);
 await page.mouse.click(bounds.x+bounds.width/2,bounds.y+bounds.height/2);
 await expect.poll(async()=>(await state()).documents?.some(doc=>doc.title==='exact.json')).toBe(true);
 await page.mouse.click(await page.evaluate(()=>innerWidth-60),76);
 await expect.poll(()=>app.evaluate(({clipboard})=>clipboard.readText())).toBe(source);
 await page.screenshot({path:join(output,'original-source.png'),scale:'css'});
 expect(errors).toEqual([]);await writeFile(join(output,'result.json'),JSON.stringify({realHarness:true,realModel:false,requests,chartCount:7,identities,errors,logs},null,2));
 console.log('Harness chart_render -> inline GPUI -> provenance -> replay passed');
} catch(error){if(page){await page.screenshot({path:join(output,'failure.png'),scale:'css'});await writeFile(join(output,'failure-state.json'),await page.evaluate(()=>window.peroDiagnostics?.snapshot()||'{}'));}await writeFile(join(output,'failure-log.json'),JSON.stringify({requests,providerErrors,errors,logs},null,2));throw error;}
finally{await app.evaluate(({BrowserWindow})=>{for(const window of BrowserWindow.getAllWindows())window.destroy();}).catch(()=>{});await app.close();await new Promise(done=>server.close(done));}
