// Opt-in real GPT -> Go harness -> ACP -> Rust Host -> shared GPUI conversation.
import {expect} from '@playwright/test';
import {createHash} from 'node:crypto';
import {mkdir,mkdtemp,writeFile,readFile,realpath,cp,rm} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {electron} from './electron.mjs';
import {clickNewChat} from './sidebar-controls.mjs';

if(process.env.PERO_SCIENTIFIC_REAL!=='1') throw Error('Opt in with PERO_SCIENTIFIC_REAL=1 and explicitly configure OPENAI_BASE_URL, OPENAI_MODEL, OPENAI_API_KEY, SCIENTIFIC_PYTHON.');
const apiFormat=process.env.OPENAI_API_FORMAT||'responses';
const endpoint=process.env.OPENAI_BASE_URL,model=process.env.OPENAI_MODEL,key=process.env.OPENAI_API_KEY,python=process.env.SCIENTIFIC_PYTHON;
if(!endpoint||!model?.startsWith('gpt-')||!key||!python) throw Error('Explicit GPT endpoint, model, credential and RDKit Python are required');
const root=resolve(import.meta.dirname,'../..'),temp=await realpath(await mkdtemp(join(tmpdir(),'pero-scientific-real-')));
const output=resolve(process.env.SCIENTIFIC_OUTPUT_DIR||join(root,'test-results/scientific-chat-real'));
const workspace=join(temp,'workspace');await mkdir(workspace);await mkdir(output,{recursive:true});
await rm(join(output,'result.json'),{force:true});await rm(join(output,'failure.json'),{force:true});
await cp(join(root,'apps/scientific-viewer/backend'),join(workspace,'scientific-viewer/backend'),{recursive:true,filter:path=>!path.includes('__pycache__')});
const source='[{"controller":"PID-A","error":0.008012362983683907,"samples":1001,"run":"supplied-a"},{"controller":"PID-B","error":0.0017626982052595386,"samples":1001,"run":"supplied-b"}]';
const agents=join(temp,'agents.json'),settings=join(temp,'settings.json'),history=join(temp,'history.jsonl');
const audit=join(output,'http-attempts.log');await writeFile(audit,'',{mode:0o600});
const args=['--api-format',apiFormat,...(apiFormat==='responses'?['--disable-streaming']:[]),'--endpoint',endpoint,'--model',model,'--api-key-env','OPENAI_API_KEY','--session-dir',join(temp,'sessions'),'--workspace',workspace,'--enable-shell','--skills-root',join(root,'apps/scientific-viewer/skills'),'--chart-python',python,'--max-requests','20','--max-tokens','5000','--max-retries','0','--request-timeout-ms','120000','--http-attempt-audit',audit,'--approval','ask'];
if(new URL(endpoint).protocol==='http:') {
  if(process.env.PERO_ALLOW_HTTP!=='1') throw Error('Configured plaintext endpoint needs explicit PERO_ALLOW_HTTP=1');
  args.push('--allow-http');
}
await writeFile(agents,JSON.stringify([{id:'science-gpt',name:'GPT scientific acceptance',command:join(root,'target/debug/pero-agent-acp'),args}]),{mode:0o600});
await writeFile(settings,JSON.stringify({chat_agent:'science-gpt',appearance:'light'}));
const env={PATH:dirname(python)+':'+process.env.PATH,HOME:process.env.HOME,LANG:'en_US.UTF-8',OPENAI_API_KEY:key,PERO_DESKTOP_DATA_DIR:join(temp,'profile'),PERO_SETTINGS_PATH:settings,PERO_HISTORY_PATH:history,PERO_AGENTS_FILE:agents,PERO_LOCALE:'en',PERO_BUILTIN_APPS:'',PERO_REQUIRED_APPS:''};
let app,page;const turns=[],errors=[],completedChecks=[];
const state=()=>page.evaluate(()=>JSON.parse(window.peroDiagnostics.snapshot()));
const chat=async()=>{const s=await state();return s.chats[s.activeChat]||s.chats[0];};
async function prompt(text){
  const before=(await chat()).messages.filter(m=>m.role==='user').length;
  const input=(await state()).composerBounds.input;
  await page.mouse.click(input.x+input.width/2,input.y+input.height/2);
  await page.keyboard.insertText(text);await page.keyboard.press('Enter');
  await expect.poll(async()=>(await chat()).messages.filter(m=>m.role==='user').length).toBe(before+1);
  await expect.poll(async()=>{const current=await chat();if(current.error)throw Error(current.error);return current.state;},{timeout:360000,intervals:[500,1000,2000]}).toBe('idle');
  const current=await chat();expect(current.messages.at(-1).role).toBe('assistant');
  turns.push({prompt:text,chat:current});
  await writeFile(join(output,`turn-${turns.length}.json`),JSON.stringify(turns.at(-1),null,2));
  return current;
}
const receipts=(current,kind)=>current.tools.filter(t=>t.status==='completed'&&t[kind]).map(t=>t[kind]);
const document=table=>JSON.parse(JSON.parse(turns.at(-1).chat.tools.find(t=>t.table?.artifact_id===table.artifact_id).content).content);
try{
  app=await electron.launch({args:['--use-mock-keychain',join(root,'desktop')],cwd:root,env});page=await app.firstWindow();
  page.on('pageerror',e=>errors.push(e.message));
  await page.waitForFunction(()=>window.peroDiagnostics&&!document.getElementById('loading'),undefined,{timeout:60000});
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1300,1050));
  await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});},workspace);
  await page.evaluate(()=>window.pero.chooseWorkspace());
  await expect.poll(async()=>(await state()).workspace).toBe(workspace);
  await clickNewChat(page);await expect.poll(async()=>{const current=await chat();if(current?.error)throw Error(current.error);return current?.state;},{timeout:30000}).toBe('idle');
  let revised;
  if(process.env.SCIENTIFIC_CASE!=='molecules') {
  const first=await prompt(`请直接在会话中展示这两条控制实验记录的结果表和误差比较图，并给出状态方程 x_{t+1}=Ax_t+Bu_t 的排版公式、变量定义和一个 2×2 单位矩阵。记录是用户提供值，不是你运行的实验。不得声称验证通过，不要操作文件或 shell。保持原始数字和来源 run。数据：${source}`);
  const tables=receipts(first,'table'),charts=receipts(first,'chart');
  expect(tables.length).toBeGreaterThan(0);expect(charts.length).toBeGreaterThan(0);
  const firstTable=tables.at(-1),firstDoc=document(firstTable);
  expect(firstDoc.rows.flat().map(c=>c.display)).toEqual(expect.arrayContaining(['0.008012362983683907','0.0017626982052595386','supplied-a','supplied-b']));
  expect(first.messages.filter(m=>m.role==='assistant').map(m=>m.text).join('')).toContain('$');
  expect(first.tools.some(t=>t.title==='shell')).toBe(false);
  completedChecks.push('natural-tool-selection-and-equations');
  await page.mouse.move(950,450);await page.mouse.wheel(0,-10000);
  await expect.poll(async()=>(await state()).scroll.y).toBe(0);
  await page.screenshot({path:join(output,'gpt-results.png'),scale:'css'});
  await page.mouse.wheel(0,10000);await page.screenshot({path:join(output,'gpt-equations.png'),scale:'css'});
  const second=await prompt('把 PID-B 的 error 改为 0，run 改为 supplied-b-revised，其余来源值不变。请生成新版本的表和图，说明它只是对提供数据的修订；保留上一版，不运行求解器。');
  revised=receipts(second,'table').at(-1);expect(revised.artifact_id).not.toBe(firstTable.artifact_id);
  expect(receipts(second,'table').some(t=>t.artifact_id===firstTable.artifact_id)).toBe(true);
  expect(document(revised).rows.flat().map(c=>c.display)).toEqual(expect.arrayContaining(['0','supplied-b-revised']));
  completedChecks.push('follow-up-preserves-old-version');
  }
  const third=await prompt(`现在做分子报告：处理精确输入 CCO、C[C@H](O)C(=O)O、invalid@@。请使用合适的已有 skill 和真实 RDKit，给出会话内描述符表（MolWt、TPSA 和逐条状态），保留无效记录与原始立体信息，不要将解析成功称为实验或生物活性验证。执行环境：Python 为 ${python}，Scientific Viewer 位于工作目录 scientific-viewer；可在当前临时工作目录保存 request.json 和 result.json（用这两个文件名）。不要安装软件、联网或改动工作目录之外的文件。保留真实 SVG 在 result.json 中，回复说明其显示范围，不必另外生成图片文件。`);
  expect(third.tools.some(t=>t.title==='skill'&&t.status==='completed')).toBe(true);
  expect(third.tools.some(t=>t.title==='shell'&&t.status==='completed')).toBe(true);
  const request=JSON.parse(await readFile(join(workspace,'request.json'),'utf8'));
  expect(request).toEqual({format:'smiles',records:['CCO','C[C@H](O)C(=O)O','invalid@@']});
  const result=JSON.parse(await readFile(join(workspace,'result.json'),'utf8'));
  expect(result.engine.name).toBe('RDKit');expect(result.rows).toHaveLength(3);
  expect(result.rows[0].descriptors.MolWt).toBeCloseTo(46.069,3);
  expect(result.rows[0].svg).toContain('<svg');expect(result.rows[1].input).toBe(request.records[1]);
  expect(result.rows[2].error).toBeTruthy();expect(result.rows[2].descriptors).toBeUndefined();
  const molecularTable=receipts(third,'table').at(-1);
  if(revised)expect(molecularTable.artifact_id).not.toBe(revised.artifact_id);
  const molecularValues=document(molecularTable).rows.flat().map(c=>c.display);
  expect(molecularValues).toEqual(expect.arrayContaining(request.records));
  for(const row of result.rows.slice(0,2)) for(const field of ['MolWt','TPSA'])
    expect(molecularValues.some(text=>Number(text)===row.descriptors[field])).toBe(true);
  completedChecks.push('discovered-skill-and-real-rdkit');
  await cp(join(workspace,'request.json'),join(output,'molecules.request.json'));
  await cp(join(workspace,'result.json'),join(output,'molecules.result.json'));
  await page.mouse.move(950,450);await page.mouse.wheel(0,10000);
  await page.screenshot({path:join(output,'gpt-molecules.png'),scale:'css'});
  expect(errors).toEqual([]);
  const report={model,completedChecks,endpointOrigin:new URL(endpoint).origin,scenario:process.env.SCIENTIFIC_CASE||'all',realModel:true,realHarness:true,transport:apiFormat==='responses'?'nonstreaming Responses -> ACP updates':'streamed Chat Completions -> ACP updates',turns:turns.length,tableVersions:receipts(third,'table').map(t=>t.artifact_id),engine:result.engine,errors,temp,history,agents,settings,workspace,skillSHA256:createHash('sha256').update(await readFile(join(root,'apps/scientific-viewer/skills/molecular-report/SKILL.md'))).digest('hex')};
  await writeFile(join(output,'result.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({model,turns:report.turns,tables:report.tableVersions.length,engine:result.engine,passed:true}));
}catch(error){
  await writeFile(join(output,'failure.json'),JSON.stringify({error:String(error),completedChecks,temp,turns:turns.length,snapshot:page?await state():null},null,2));
  if(page)await page.screenshot({path:join(output,'failure.png'),scale:'css'});throw error;
}finally{if(app){await app.evaluate(({BrowserWindow})=>{for(const w of BrowserWindow.getAllWindows())w.destroy();}).catch(()=>{});await app.close();}}
