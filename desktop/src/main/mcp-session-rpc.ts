import {randomUUID} from 'node:crypto';
import type {McpSessionRequest as HostMcpSessionRequest} from '../../../protocol/generated/host.ts';
export type McpSessionScope={thread_id:string;incarnation:number;revision:number};
export type McpSessionCall={action:HostMcpSessionRequest['action'];server?:string;generation?:number;name?:string;uri?:string;cursor?:string;arguments?:Record<string,unknown>;binding?:string};
export type McpSessionRequest=McpSessionScope&McpSessionCall&{method:'mcp.session';request_id:string};
type Reply={kind?:unknown;request_id?:unknown;thread_id?:unknown;data?:{incarnation?:unknown;revision?:unknown;result?:unknown;reason?:unknown}};
/** Correlates only Host responses; never retries an uncertain tool operation. */
export class McpSessionRpc {
  private pending=new Map<string,{scope:McpSessionScope;resolve:(value:unknown)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
  private send:(request:McpSessionRequest)=>void;
  private timeout:number;
  constructor(send:(request:McpSessionRequest)=>void,timeout=300_000){this.send=send;this.timeout=timeout;}
  request(scope:McpSessionScope,call:McpSessionCall):Promise<unknown>{
    if(this.pending.size>=64)return Promise.reject(new Error('Too many pending MCP session requests'));
    const request_id=randomUUID();
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.pending.delete(request_id);reject(new Error('MCP session request timed out; its outcome is unknown. Do not replay a tool call.'));},this.timeout);
      this.pending.set(request_id,{scope:{...scope},resolve,reject,timer});
      try{this.send({...call,...scope,method:'mcp.session',request_id});}
      catch(error){clearTimeout(timer);this.pending.delete(request_id);reject(error instanceof Error?error:new Error('MCP session transport unavailable'));}
    });
  }
  accept(value:unknown):boolean{
    const event=value as Reply;
    if(!event||!['mcp_session','mcp_session_error'].includes(String(event.kind)))return false;
    if(typeof event.request_id!=='string')return true;
    const pending=this.pending.get(event.request_id);if(!pending)return false;
    if(event.thread_id!==pending.scope.thread_id||event.data?.incarnation!==pending.scope.incarnation||event.data?.revision!==pending.scope.revision)return true;
    clearTimeout(pending.timer);this.pending.delete(event.request_id);
    if(event.kind==='mcp_session_error')pending.reject(new Error(`MCP session request failed: ${String(event.data.reason||'unavailable')}`));
    else pending.resolve(event.data.result);
    return true;
  }
  forgetThread(thread:string){for(const [id,pending] of this.pending)if(pending.scope.thread_id===thread){clearTimeout(pending.timer);this.pending.delete(id);pending.reject(new Error('This MCP session is closed'));}}
  close(){for(const pending of this.pending.values()){clearTimeout(pending.timer);pending.reject(new Error('The MCP session transport stopped'));}this.pending.clear();}
}
