import {McpHost} from './mcp-host.ts';
import {McpSessionSources,type McpResourceSelection} from './mcp-session-sources.ts';
import type {McpSessionRpc,McpSessionScope} from './mcp-session-rpc.ts';
import type {McpAppBinding} from '../../../packages/content-source/mcp-source.ts';
/** Electron and the Native sidecar use the same scoped panel composition. */
export class McpSessionPanels {
  private panels=new Map<string,{scope:McpSessionScope;host:McpHost;ready:Promise<void>}>();
  private rpc:McpSessionRpc;
  private assets:string;
  private openLink?:((url:string)=>Promise<void>);
  private onBinding?:((binding:McpAppBinding)=>void);
  private onResource?:((selection:McpResourceSelection)=>void);
  constructor(rpc:McpSessionRpc,assets:string,openLink?:((url:string)=>Promise<void>),onBinding?:((binding:McpAppBinding)=>void),onResource?:((selection:McpResourceSelection)=>void)){this.rpc=rpc;this.assets=assets;this.openLink=openLink;this.onBinding=onBinding;this.onResource=onResource;}
  async open(scope:McpSessionScope,locale='en',call?:{server:string;generation:number;tool_call:string}){
    let entry=this.panels.get(scope.thread_id);
    if(entry&&(entry.scope.incarnation!==scope.incarnation||entry.scope.revision!==scope.revision)){await this.forgetThread(scope.thread_id);entry=undefined;}
    if(!entry){
      const sources=new McpSessionSources(scope,(scope,call)=>this.rpc.request(scope,call),this.openLink,this.onResource,(scope,text)=>this.rpc.message(scope,text));
      const host=new McpHost('',this.assets,this.openLink,this.onBinding,sources);
      const ready=sources.list().then(()=>host.start());
      entry={scope:{...scope},host,ready};this.panels.set(scope.thread_id,entry);
    }
    try{await entry.ready;return entry.host.open(scope.thread_id,locale,call);}
    catch(error){if(this.panels.get(scope.thread_id)===entry)this.panels.delete(scope.thread_id);await entry.host.close();throw error;}
  }
  ownsPanel(url:string){return [...this.panels.values()].some(entry=>entry.host.ownsPanel(url));}
  async forgetThread(thread:string){const entry=this.panels.get(thread);this.panels.delete(thread);this.rpc.forgetThread(thread);if(entry){entry.host.forgetThread(thread);await entry.ready.catch(()=>{});await entry.host.close();}}
  observe(event:{kind?:string;thread_id?:string;data?:any}){
    if(event.kind==='session_deleted'&&event.thread_id){void this.forgetThread(event.thread_id);return;}
    if(event.kind!=='mcp_runtime')return;
    const snapshot=event.data,entry=this.panels.get(snapshot?.thread_id);if(!entry)return;
    if(snapshot.closed||snapshot.incarnation!==entry.scope.incarnation||snapshot.revision!==entry.scope.revision){void this.forgetThread(entry.scope.thread_id);return;}
    (entry.host.sources as McpSessionSources).observeServers(snapshot.servers);
  }
  async close(){await Promise.all([...this.panels.keys()].map(thread=>this.forgetThread(thread)));}
}
