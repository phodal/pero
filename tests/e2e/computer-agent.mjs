// Opt-in provider checks through real Host-injected MCP, with owned UI effects.
import { expect } from '@playwright/test';
import { electron, focusPage } from './electron.mjs';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { computerFixture, computerEvidenceDirectory } from '../fixtures/computer-app.mjs';
if(process.env.PERO_COMPUTER_AGENT!=='1')throw new Error('Opt in with PERO_COMPUTER_AGENT=1; this sends one status-only prompt to the signed-in Codex provider.');
const native=process.env.PERO_COMPUTER_AGENT_NATIVE==='1';
if(native&&process.platform!=='darwin')throw new Error('Native provider acceptance requires macOS');
const root=resolve(import.meta.dirname,'../..'),temp=await mkdtemp(resolve(tmpdir(),'pero-computer-agent-')),out=computerEvidenceDirectory(root);
await mkdir(out,{recursive:true});
const fixture=native?await computerFixture(root,temp):null;
await writeFile(resolve(temp,'settings.json'),JSON.stringify({chat_agent:'codex',computer_use:{enabled:true}}));
await writeFile(resolve(temp,'agents.json'),JSON.stringify([{id:'codex',name:'Codex',command:process.execPath,args:[resolve(root,'node_modules/@agentclientprotocol/codex-acp/dist/index.js')],env:{CODEX_PATH:process.env.CODEX_PATH||'codex'}}]));
const app=await electron.launch({args:['--use-mock-keychain',resolve(root,'desktop')],cwd:root,env:{...process.env,PERO_DESKTOP_DATA_DIR:resolve(temp,'profile'),PERO_SETTINGS_PATH:resolve(temp,'settings.json'),PERO_HISTORY_PATH:resolve(temp,'history.jsonl'),PERO_AGENTS_FILE:resolve(temp,'agents.json'),PERO_LOCALE:'en'}});
const errors=[];
try {
 const page=await app.firstWindow();await focusPage(page);page.on('pageerror',error=>errors.push(error.message));
 await page.waitForFunction(()=>window.peroDiagnostics&&JSON.parse(window.peroDiagnostics.snapshot()).connected,undefined,{timeout:60000});
 const state=()=>page.evaluate(()=>JSON.parse(window.peroDiagnostics.snapshot()));
 await expect.poll(async()=>(await state()).agents.length).toBeGreaterThan(0);
 await page.waitForFunction(()=>{const canvas=document.querySelector('canvas');return canvas?.width===Math.round(innerWidth*devicePixelRatio)&&canvas.height===Math.round(innerHeight*devicePixelRatio);});
 await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
 await page.mouse.click(90,28);await expect.poll(async()=>(await state()).chats.length).toBe(1);
 await expect.poll(async()=>(await state()).chats[0].state,{timeout:60000}).toBe('idle');
 const thread=(await state()).chats[0].id;
 await page.evaluate(()=>window.pero.computerCommand({action:'computer_set',enabled:true}));
 expect((await page.evaluate(()=>window.pero.computerCommand({action:'computer_get'}))).enabled).toBe(true);
 const text=native?`Use only the computer_use MCP tool to operate our disposable owned application window titled "Pero Computer Fixture". I authorize these specific real UI actions in that fixture. Do not operate other windows, use shell/files/browser tools, or alter any other application. Start with status and targets, identify the exact fixture, then observe it. Use background delivery and a fresh observation after EVERY action; executed only acknowledges input. Click the AX Increment button exactly once and verify Count: 1 in the gesture canvas value. Type "Agent 验收 🌱" into its AXTextField and verify its observed value. From the actual screenshot identify the blue rectangle in the Gesture canvas; click its center using a pixel anchor, observe and verify Clicks: 1. Scroll down 120 pixels there, observe and verify Scroll is nonzero. Drag from inside the blue rectangle about 40 image pixels to the right and 30 down using background delivery, observe and verify Drags is positive. Keep original opaque IDs exactly, choose unique request IDs, and use screenshot image coordinates. If an effect is unknown, inspect then observe without blindly repeating. Finish only after the observed Count and Text match, Clicks is at least 1 (dragging adds a pointer-down), Scroll is nonzero and Drags is positive, with PERO_COMPUTER_AGENT_OK and the observed values.`:'Use only the computer_use MCP tool. Call operation status exactly once and report the native available/accessibility/screen_recording fields. Do not list targets, observe applications, execute input, use other tools or modify files. Finish with PERO_COMPUTER_AGENT_OK.';
 await page.evaluate(async({thread,text})=>{await window.pero.appUseCommand({action:'select',thread_id:thread});await window.pero.sessionCommand({action:'prompt',thread_id:thread,text});},{thread,text});
 await expect.poll(async()=>{const chat=(await state()).chats[0];if(chat.error)throw new Error(chat.error);const text=chat.messages.filter(m=>m.role==='assistant').map(m=>m.text).join('');if(chat.state==='idle'&&chat.tools.length&&text&&!text.includes('PERO_COMPUTER_AGENT_OK'))throw new Error('Agent finished without acceptance: '+text);return text;},{timeout:native?360000:120000,intervals:[250,500,1000]}).toContain('PERO_COMPUTER_AGENT_OK');
 await expect.poll(async()=>(await state()).chats[0].state).toBe('idle');
 const chat=(await state()).chats[0];expect(chat.tools.some(tool=>JSON.stringify(tool).includes('computer_use'))).toBe(true);expect(errors).toEqual([]);
 const effects=await fixture?.state();
 if(native){expect(effects.count).toBe(1);expect(effects.text).toBe('Agent 验收 🌱');expect(effects.clicks).toBeGreaterThan(0);expect(effects.scroll).not.toBe(0);expect(effects.drags).toBeGreaterThan(0);const calls=chat.tools.filter(tool=>tool.kind!=='think');expect(calls.every(tool=>tool.title.includes('computer_use'))).toBe(true);expect(calls.some(tool=>tool.transcript?.input?.arguments?.operation==='observe')).toBe(true);}
 await writeFile(resolve(out,native?'agent-native-result.json':'agent-result.json'),JSON.stringify({passed:true,provider:'codex',model:chat.model,calls:chat.tools,reply:chat.messages.filter(m=>m.role==='assistant').map(m=>m.text),effects,scope:native?'actual owned native UI through provider, ACP, Host, MCP, Desktop and driver':'native status only, no input/observation acceptance',errors},null,2));
 await page.screenshot({path:resolve(out,native?'agent-native.png':'agent-status.png')});
 await rm(resolve(out,'agent-failure.json'),{force:true});
 console.log(`Real Codex ACP → Host-injected MCP → native Computer Use ${native?'observed input workflow':'status'} passed.`);
} catch(error) {const page=await app.firstWindow();await writeFile(resolve(out,'agent-failure.json'),JSON.stringify({error:String(error),state:await page.evaluate(()=>JSON.parse(window.peroDiagnostics.snapshot())),errors},null,2));throw error;}
finally {await app.close();await fixture?.close();await rm(temp,{recursive:true,force:true});}
