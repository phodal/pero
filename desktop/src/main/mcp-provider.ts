import {createInterface} from 'node:readline';
import {resolve,dirname} from 'node:path';
import {McpHost} from './mcp-host.ts';
import {McpSessionRpc} from './mcp-session-rpc.ts';
import {McpSessionPanels} from './mcp-session-panels.ts';
import {z} from 'zod';
import {execFile} from 'node:child_process';
const args=process.argv.slice(2),config=args[args.indexOf('--config')+1];
if(!args.includes('--stdio')||!config){console.error('Usage: mcp-provider --stdio --config PATH');process.exit(2);}
// The same provider implementation is used by Electron and the Native sidecar.
const openLink=(url:string)=>new Promise<void>((resolveOpen,reject)=>{
  const command=process.platform==='darwin'?'open':process.platform==='win32'?'rundll32':'xdg-open';
  execFile(command,process.platform==='win32'?['url.dll,FileProtocolHandler',url]:[url],error=>error?reject(error):resolveOpen());
});
const host=new McpHost(resolve(config),dirname(resolve(process.argv[1])),openLink);
const write=(value:object)=>process.stdout.write(JSON.stringify(value)+'\n');
const rpc=new McpSessionRpc(request=>write({kind:'mcp_session_request',request}));
const sessions=new McpSessionPanels(rpc,dirname(resolve(process.argv[1])),openLink,undefined,selection=>{const {thread_id,...data}=selection;write({version:1,kind:'mcp_resource_selected',request_id:null,thread_id,text:'',data});});
const Scope=z.object({thread_id:z.string().min(1),incarnation:z.number().int().nonnegative(),revision:z.number().int().nonnegative()}).strict();
const OriginalCall=z.object({server:z.string().min(1),generation:z.number().int().nonnegative(),tool_call:z.string().min(1)});
async function close(){rpc.close();await sessions.close();await host.close();}
process.once('SIGTERM',()=>{void close().finally(()=>process.exit(0));});
async function main(){
  await host.start();write({kind:'mcp_ready'});
  for await(const line of createInterface({input:process.stdin})){
    const value=JSON.parse(line) as {action?:unknown;thread_id?:unknown;request_id?:unknown;locale?:unknown;mode?:unknown;session?:unknown;event?:unknown};
    if(value.action==='shutdown')break;
    if(value.action==='session_result'){rpc.accept(value.event);continue;}
    if(value.action==='session_event'){sessions.observe(value.event as Parameters<typeof sessions.observe>[0]);continue;}
    if(value.action==='forget_thread'&&typeof value.thread_id==='string'){host.forgetThread(value.thread_id);void sessions.forgetThread(value.thread_id);continue;}
    if(!['open','adopt'].includes(String(value.action))||typeof value.request_id!=='string'||value.thread_id!==null&&value.thread_id!==undefined&&typeof value.thread_id!=='string')throw new Error('Invalid MCP provider command');
    const thread=typeof value.thread_id==='string'?value.thread_id:undefined;
    const locale=typeof value.locale==='string'?value.locale:'en';
    // Do not await here: the reply arrives on this same input stream.
    void (async()=>{
      if(value.mode!==undefined&&value.mode!=='session'&&value.mode!=='standalone')throw new Error('Invalid MCP provider mode');
      const scope=value.mode==='session'?Scope.parse(value.session):undefined;
      if(scope&&scope.thread_id!==thread)throw new Error('MCP session scope does not match its panel');
      const call=value.action==='adopt'?OriginalCall.parse(value):undefined;
      if(call&&!scope)throw new Error('A tool result requires its original session');
      const url=scope?await sessions.open(scope,locale,call):host.open(thread,locale);
      write({version:1,kind:call?'mcp_app_view':'mcp_sources',request_id:value.request_id,thread_id:thread,text:'',data:{url,...(call?{tool_call:call.tool_call}:{})}});
    })().catch(error=>write({version:1,kind:'mcp_error',request_id:value.request_id,thread_id:thread,text:error instanceof Error?error.message:String(error)}));
  }
  await close();
  process.stdin.destroy();
}
void main().catch(async error=>{console.error(error instanceof Error?error.message:String(error));await close();process.exit(1);});
