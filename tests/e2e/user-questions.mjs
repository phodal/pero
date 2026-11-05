// Actual Desktop/GPUI → Host → ACP structured input, with no model or service.
import { expect } from '@playwright/test';
import { electron } from './electron.mjs';
import { clickAppShortcut, setAppearance } from './sidebar-controls.mjs';
import { mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';

const root=resolve(import.meta.dirname,'../..');
const output=resolve(root,'test-results/user-questions');
const temp=await mkdtemp(resolve(tmpdir(),'pero-question-ui-'));
const workspace=resolve(temp,'workspace');
await mkdir(workspace,{recursive:true});
await mkdir(output,{recursive:true});
const agents=resolve(temp,'agents.json');
await writeFile(agents,JSON.stringify([{id:'questions',name:'Structured question fixture',command:process.execPath,args:[resolve(root,'tests/runtime/questions-agent.mjs')]}]));
await writeFile(resolve(temp,'settings.json'),JSON.stringify({chat_agent:'questions'}));
const env={...process.env,PERO_DESKTOP_DATA_DIR:resolve(temp,'profile'),PERO_SETTINGS_PATH:resolve(temp,'settings.json'),PERO_HISTORY_PATH:resolve(temp,'sessions.jsonl'),PERO_LOCALE:'en',PERO_AGENTS_FILE:agents};
delete env.ELECTRON_RUN_AS_NODE;
const app=await electron.launch({args:[...(process.platform==='darwin'?['--use-mock-keychain']:[]),resolve(root,'desktop')],cwd:root,env});
const errors=[];
try {
    const page=await app.firstWindow();
    page.on('pageerror',error=>errors.push(error.message));
    const state=()=>page.evaluate(()=>JSON.parse(window.peroDiagnostics.snapshot()));
    await page.waitForFunction(()=>window.peroDiagnostics&&JSON.parse(window.peroDiagnostics.snapshot()).connected,undefined,{timeout:60000});
    await page.waitForFunction(()=>!document.getElementById('loading'));
    await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});},workspace);
    await page.evaluate(()=>window.pero.chooseWorkspace());
    await expect.poll(async()=>(await state()).workspace).toBe(await realpath(workspace));
    await clickAppShortcut(page,'sessions');
    await expect.poll(async()=>(await state()).navigation).toBe(0);
    await expect.poll(async()=>(await state()).chats?.[0]?.state,{timeout:15000}).toBe('idle');
    const thread=(await state()).chats[0].id;
    const modifier=process.platform==='darwin'?'Meta':'Control';
    const frame=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const click=async bounds=>{
        expect(bounds?.width).toBeGreaterThan(0);
        await page.mouse.click(bounds.x+bounds.width/2,bounds.y+bounds.height/2);
        await frame();
    };
    const prompt=async text=>{
        await page.evaluate(({thread,text})=>window.pero.sessionCommand({action:'prompt',thread_id:thread,text}),{thread,text});
        await expect.poll(async()=>(await state()).chats[0].user_questions?.length,{timeout:10000}).toBeGreaterThan(0);
        await expect.poll(async()=>(await state()).userQuestionBounds?.[0]?.submit?.width).toBeGreaterThan(0);
        await frame();
    };
    const bounds=async()=>(await state()).userQuestionBounds[0];
    const enter=async(index,text)=>{
        await click((await bounds()).inputs[index]);
        await page.keyboard.press(`${modifier}+a`);
        const cdp=await page.context().newCDPSession(page);
        await cdp.send('Input.insertText',{text});
        await cdp.detach();
        await frame();
    };
    const finish=async()=>{
        await expect.poll(async()=>(await state()).chats[0].state,{timeout:10000}).toBe('idle');
        expect((await state()).chats[0].user_questions).toEqual([]);
        return (await state()).chats[0].messages.filter(message=>message.role==='assistant').at(-1).text;
    };

    await prompt('ask');
    // Incomplete answers cannot be submitted and no option is preselected.
    expect((await state()).chats[0].user_questions[0].selected).toEqual([[],[]]);
    await click((await bounds()).submit);
    expect((await state()).chats[0].user_questions).toHaveLength(1);
    await click((await bounds()).options[0][1]);
    await click((await bounds()).options[1][0]);
    await click((await bounds()).options[1][1]);
    await enter(1,'Build');
    await page.screenshot({scale:'css',path:resolve(output,'answered-light.png')});
    await setAppearance(page,'dark');
    await page.screenshot({scale:'css',path:resolve(output,'answered-dark.png')});
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1000,788));
    await frame();
    await page.screenshot({scale:'css',path:resolve(output,'answered-narrow.png')});
    await click((await bounds()).inputs[1]);
    await page.keyboard.press('Enter');
    const answer=JSON.parse(await finish());
    expect(answer.advertised).toBe(true);
    expect(answer.result).toEqual({outcome:'answered',answers:[{questionIndex:0,selectedOptions:[1]},{questionIndex:1,selectedOptions:[0,1],text:'Build'}]});
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1488,1008));
    await frame();

    await prompt('ask');
    await enter(0,'Python');
    await click((await bounds()).options[1][0]);
    await click((await bounds()).submit);
    expect(JSON.parse(await finish()).result.answers[0]).toEqual({questionIndex:0,selectedOptions:[],text:'Python'});

    await prompt('ask');
    await click((await bounds()).cancel);
    expect(JSON.parse(await finish()).result).toEqual({outcome:'cancelled'});

    await prompt('fifo');
    await expect.poll(async()=>(await state()).chats[0].user_questions.length).toBe(2);
    const first=(await bounds()).request_id;
    await click((await bounds()).cancel);
    await expect.poll(async()=>(await state()).chats[0].user_questions.length).toBe(1);
    expect((await bounds()).request_id).not.toBe(first);
    await click((await bounds()).cancel);
    await finish();

    await prompt('cancel');
    await click((await state()).stopButtonBounds);
    await finish();
    expect(errors).toEqual([]);
    await writeFile(resolve(output,'result.json'),JSON.stringify({passed:true,errors,checks:['single-select','multi-select','other-text','incomplete-disabled','cancel','fifo','turn-cancel','enter-submit','dark','narrow']},null,2));
    console.log(JSON.stringify({passed:true,output}));
} catch(error) {
    const page=await app.firstWindow();
    await page.screenshot({path:resolve(output,'failure.png')}).catch(()=>{});
    await writeFile(resolve(output,'failure-state.json'),await page.evaluate(()=>window.peroDiagnostics?.snapshot()||'{}').catch(()=>'{}'));
    throw error;
} finally {await app.close();}
