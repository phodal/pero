import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const resultText=result=>typeof result.content==='string'?result.content:JSON.stringify(result.content);
const completed=state=>state.events.some(e=>e.kind==='session_update'&&e.data?.sessionUpdate==='tool_call_update'&&e.data.toolCallId==='actual-tool-call'&&e.data.status==='completed');
const failed=state=>state.events.some(e=>e.kind==='session_update'&&e.data?.sessionUpdate==='tool_call_update'&&e.data.toolCallId==='actual-tool-call'&&e.data.status==='failed');
const noPermissions=state=>assert(!state.events.some(e=>e.kind==='permission_denied'),'read-only operation unexpectedly required approval');
const success=state=>{assert(completed(state),'actual tool did not complete');noPermissions(state)};
const rejection=state=>assert(failed(state),'unsafe tool call was not explicitly failed');

export const plans=[
 {name:'read-file',call:()=>({name:'read_file',arguments:{path:'source.txt'}}),verifyResult:({result})=>assert(resultText(result).includes('READ_TOOL_OK')),verify:({state})=>success(state)},
 {name:'list-directory',call:()=>({name:'list_directory',arguments:{path:'.'}}),verifyResult:({result})=>{assert(resultText(result).includes('source.txt'));assert(resultText(result).includes('nested'))},verify:({state})=>success(state)},
 {name:'search-files',call:()=>({name:'search_files',arguments:{query:'needle-search-marker',path:'.'}}),verifyResult:({result})=>assert(resultText(result).includes('source.txt')),verify:({state})=>success(state)},
 {name:'write-denied',call:()=>({name:'write_file',arguments:{path:'existing.txt',content:'SHOULD_NOT_WRITE'}}),verify:async({state,workspace})=>{assert.equal(await readFile(join(workspace,'existing.txt'),'utf8'),'ORIGINAL_UNCHANGED');rejection(state)}},
 {name:'edit-denied',call:()=>({name:'edit_file',arguments:{path:'existing.txt',old_text:'ORIGINAL_UNCHANGED',new_text:'SHOULD_NOT_EDIT'}}),verify:async({state,workspace})=>{assert.equal(await readFile(join(workspace,'existing.txt'),'utf8'),'ORIGINAL_UNCHANGED');rejection(state)}},
 {name:'shell-denied',enableShell:true,call:()=>({name:'shell',arguments:{command:'printf SHOULD_NOT_RUN > shell-executed.txt',timeout_ms:1000}}),verify:async({state,workspace})=>{await assert.rejects(readFile(join(workspace,'shell-executed.txt')),{code:'ENOENT'});rejection(state)}},
 {name:'absolute-outside-rejected',call:({outside})=>({name:'read_file',arguments:{path:outside}}),verify:({state})=>rejection(state)},
 {name:'parent-escape-rejected',call:()=>({name:'read_file',arguments:{path:'../outside.txt'}}),verify:({state})=>rejection(state)},
 {name:'symlink-escape-rejected',call:()=>({name:'read_file',arguments:{path:'escape.txt'}}),verify:({state})=>rejection(state)},
 {name:'symlink-inside-rejected',call:()=>({name:'read_file',arguments:{path:'escape.txt'}}),verify:({state})=>rejection(state)},
 {name:'search-symlink-skipped',call:()=>({name:'search_files',arguments:{query:'MUST_NOT_LEAK',path:'.'}}),verifyResult:({result})=>assert(!resultText(result).includes('escape.txt'),'search followed a rejected symlink'),verify:({state})=>success(state)},
 {name:'oversized-file-rejected',call:()=>({name:'read_file',arguments:{path:'large.txt'}}),verify:({state})=>rejection(state)},
 {name:'bounded-read-output',call:()=>({name:'read_file',arguments:{path:'output.txt',offset:1,limit:2000}}),verifyResult:({result})=>{const text=resultText(result);assert(text.includes('truncated'));assert(Buffer.byteLength(text)<65536)},verify:({state})=>success(state)},
 {name:'cancel-after-real-read',cancel:true,call:()=>({name:'read_file',arguments:{path:'source.txt'}}),verifyResult:({result})=>assert(resultText(result).includes('READ_TOOL_OK')),verify:({state})=>success(state)},
];
