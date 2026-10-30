import {createInterface} from 'node:readline';
import {resolve,dirname} from 'node:path';
import {McpHost} from './mcp-host.ts';
import {execFile} from 'node:child_process';
const args=process.argv.slice(2),config=args[args.indexOf('--config')+1];
if(!args.includes('--stdio')||!config){console.error('Usage: mcp-provider --stdio --config PATH');process.exit(2);}
// The same provider implementation is used by Electron and the Native sidecar.
const host=new McpHost(resolve(config),dirname(resolve(process.argv[1])),url=>new Promise<void>((resolveOpen,reject)=>{
  const command=process.platform==='darwin'?'open':process.platform==='win32'?'rundll32':'xdg-open';
  execFile(command,process.platform==='win32'?['url.dll,FileProtocolHandler',url]:[url],error=>error?reject(error):resolveOpen());
}));
const write=(value:object)=>process.stdout.write(JSON.stringify(value)+'\n');
process.once('SIGTERM',()=>{void host.close().finally(()=>process.exit(0));});
async function main(){
  await host.start();write({kind:'mcp_ready'});
  for await(const line of createInterface({input:process.stdin})){
    const value=JSON.parse(line) as {action?:unknown;thread_id?:unknown;request_id?:unknown;locale?:unknown};
    if(value.action==='shutdown')break;
    if(value.action!=='open'||typeof value.request_id!=='string'||value.thread_id!==null&&value.thread_id!==undefined&&typeof value.thread_id!=='string')throw new Error('Invalid MCP provider command');
    const thread=typeof value.thread_id==='string'?value.thread_id:undefined;
    write({version:1,kind:'mcp_sources',request_id:value.request_id,thread_id:thread,text:'',data:{url:host.open(thread,typeof value.locale==='string'?value.locale:'en')}});
  }
  await host.close();
}
void main().catch(async error=>{console.error(error instanceof Error?error.message:String(error));await host.close();process.exit(1);});
