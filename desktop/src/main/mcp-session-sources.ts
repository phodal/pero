import {randomUUID} from 'node:crypto';
import {ToolSchema,ReadResourceResultSchema,CallToolResultSchema,type Tool} from '@modelcontextprotocol/sdk/types.js';
import {RESOURCE_MIME_TYPE,getToolUiResourceUri,McpUiResourceMetaSchema,McpUiToolMetaSchema} from '@modelcontextprotocol/ext-apps/app-bridge';
import type {McpPanelCommand} from '../../../packages/content-source/mcp-source.ts';
import type {McpView} from './mcp-sources.ts';
import type {McpSessionScope,McpSessionCall} from './mcp-session-rpc.ts';
import {admitMcpCsp} from './mcp-policy.ts';
import {z} from 'zod';
export type McpResourceSelection=McpSessionScope&{server:string;generation:number;uri:string;contents:{uri:string;mimeType?:string;text:string}[]};
const TextResourceResult=z.object({contents:z.array(z.object({uri:z.string().min(1),text:z.string().refine(text=>!text.includes('\0')),mimeType:z.string().optional(),blob:z.never().optional()})).min(1).max(16)});
const Catalog=z.object({servers:z.array(z.object({name:z.string(),generation:z.number().int().nonnegative(),connected:z.boolean(),tools:z.array(ToolSchema)}))});
/** The existing ACP session owns IO and authority. This adapter creates no MCP client. */
export class McpSessionSources {
  private alive=true;
  private catalog=new Map<string,{generation:number;connected:boolean;tools:Tool[]}>();
  private opening=new Map<string,{cancelled:boolean;remote?:string}>();
  private bindings=new Map<string,{view:McpView;remote:string;generation:number}>();
  readonly scope:McpSessionScope;
  private rpc:(scope:McpSessionScope,call:McpSessionCall)=>Promise<unknown>;
  private openLink?:((url:string)=>Promise<void>);
  private onResource?:((selection:McpResourceSelection)=>void);
  constructor(scope:McpSessionScope,rpc:(scope:McpSessionScope,call:McpSessionCall)=>Promise<unknown>,openLink?:((url:string)=>Promise<void>),onResource?:((selection:McpResourceSelection)=>void)){this.scope={...scope};this.rpc=rpc;this.openLink=openLink;this.onResource=onResource;}
  async load(){}
  admitThread(thread:string){if(!this.alive||thread!==this.scope.thread_id)throw new Error('This MCP session is unavailable');}
  forgetThread(thread:string){if(thread===this.scope.thread_id){this.alive=false;this.bindings.clear();this.catalog.clear();}}
  view(id:string){const entry=this.bindings.get(id);if(!this.alive||!entry)throw new Error('This MCP source is closed');return entry.view;}
  private async call(call:McpSessionCall){this.admitThread(this.scope.thread_id);const result=await this.rpc(this.scope,call);this.admitThread(this.scope.thread_id);return result;}
  private server(name:string,generation:number|undefined){const server=this.catalog.get(name);if(!server?.connected||generation!==server.generation)throw new Error('This MCP server catalog is stale; refresh it');return server;}
  observeServers(servers:{server:string;generation:number;status:string}[]){
    for(const [name,catalog] of this.catalog){const observed=servers.find(server=>server.server===name);if(!observed||observed.status!=='connected'||observed.generation!==catalog.generation)this.catalog.delete(name);}
    for(const [id,entry] of this.bindings)if(!this.catalog.has(entry.view.binding.server))this.bindings.delete(id);
  }
  async list(){
    const {servers}=Catalog.parse(await this.call({action:'list'}));
    this.catalog=new Map(servers.map(server=>[server.name,server]));
    for(const [id,entry] of this.bindings){const server=this.catalog.get(entry.view.binding.server);if(!server?.connected||server.generation!==entry.generation)this.bindings.delete(id);}
    return servers.map(server=>({id:server.name,title:server.name,transport:'session',managed:true,generation:server.generation,connected:server.connected,
      tools:server.tools.filter(tool=>{const meta=McpUiToolMetaSchema.safeParse(tool._meta?.ui??{});return getToolUiResourceUri(tool)&&meta.success&&(!meta.data.visibility||meta.data.visibility.includes('app'));}).map(tool=>({name:tool.name,title:tool.title||tool.name,description:tool.description,inputSchema:tool.inputSchema}))}));
  }
  async command(command:McpPanelCommand):Promise<unknown>{
    this.admitThread(this.scope.thread_id);
    switch(command.action){
      case 'list':return this.list();
      case 'configure':case 'connect':case 'disconnect':throw new Error('Manage this Agent connector in MCP settings, then start a new session');
      case 'resources':case 'templates':case 'read':{
        this.server(command.server,command.generation);
        const result=await this.call({action:command.action,server:command.server,generation:command.generation,...('cursor' in command?{cursor:command.cursor}:{}),...('uri' in command?{uri:command.uri}:{})});
        this.server(command.server,command.generation);return result;
      }
      case 'attach_resource':{
        this.server(command.server,command.generation);
        if(!this.onResource)throw new Error('Adding resources to Chat is unavailable');
        const resource=TextResourceResult.safeParse(await this.call({action:'read',server:command.server,generation:command.generation,uri:command.uri}));
        if(!resource.success)throw new Error('Chat accepts text resources only (maximum 16 parts and 64 KB)');
        const contents=resource.data.contents.map(content=>({uri:content.uri,...(content.mimeType?{mimeType:content.mimeType}:{}),text:content.text}));
        const selection={...this.scope,server:command.server,generation:command.generation,uri:command.uri,contents};
        const {contents:attachmentContents,...provenance}=selection;
        if(Buffer.byteLength(JSON.stringify({provenance,contents:attachmentContents}),'utf8')>64_000)throw new Error('Chat resource exceeds the 64 KB limit');
        this.server(command.server,command.generation);
        this.onResource(selection);return {attached:true};
      }
      case 'cancel_open':{
        const operation=this.opening.get(command.operation);if(!operation)return {};
        operation.cancelled=true;
        if(operation.remote)await this.call({action:'close',binding:operation.remote});
        return {};
      }
      case 'execute':{
        if(command.thread_id!==this.scope.thread_id)throw new Error('This conversation is outside the MCP panel binding');
        const server=this.server(command.server,command.generation),tool=server.tools.find(tool=>tool.name===command.tool),uri=tool&&getToolUiResourceUri(tool);
        if(!uri)throw new Error('This tool does not declare an MCP App resource');
        if(!command.operation||this.opening.has(command.operation))throw new Error('An MCP App operation identity is required');
        const operation:{cancelled:boolean;remote?:string}={cancelled:false};this.opening.set(command.operation,operation);
        try{
          const prepared=z.object({binding:z.string().min(1),resource:z.unknown()}).parse(await this.call({action:'prepare',server:command.server,generation:command.generation,name:command.tool}));
          operation.remote=prepared.binding;
          if(operation.cancelled)throw new Error('MCP App opening cancelled');
          const resource=ReadResourceResultSchema.parse(prepared.resource);
          const content=resource.contents[0];
          if(resource.contents.length!==1||!content||content.uri!==uri||content.mimeType!==RESOURCE_MIME_TYPE||!('text' in content))throw new Error('The MCP App resource must be one bound text/html;profile=mcp-app document');
          const meta=McpUiResourceMetaSchema.parse(content._meta?.ui??{});
          const csp=admitMcpCsp(meta.csp);
          this.server(command.server,command.generation);
          const result=CallToolResultSchema.parse(await this.call({action:'tool',binding:prepared.binding,name:command.tool,arguments:command.arguments}));
          if(operation.cancelled)throw new Error('MCP App opening cancelled');
          this.server(command.server,command.generation);
          const view:McpView={binding:{id:randomUUID(),server:command.server,resource_uri:uri,tool:command.tool,tool_call:randomUUID(),thread_id:this.scope.thread_id},html:content.text,csp,input:command.arguments,result};
          this.bindings.set(view.binding.id,{view,remote:prepared.binding,generation:server.generation});return view;
        }catch(error){if(operation.remote)await this.call({action:'close',binding:operation.remote}).catch(()=>{});throw error;}
        finally{this.opening.delete(command.operation);}
      }
      case 'close':{
        const entry=this.bindings.get(command.binding);if(!entry)return {};
        this.bindings.delete(command.binding);return this.call({action:'close',binding:entry.remote});
      }
      case 'tool':case 'resource':case 'open_link':{
        const view=this.view(command.binding),entry=this.bindings.get(command.binding)!;
        this.server(view.binding.server,entry.generation);
        if(command.action==='tool')return this.call({action:'tool',binding:entry.remote,name:command.name,arguments:command.arguments});
        if(command.action==='resource'){
          if(command.uri!==view.binding.resource_uri)throw new Error('This resource is outside the MCP App binding');
          return this.call({action:'resource',binding:entry.remote,uri:command.uri});
        }
        const url=new URL(command.url);if(!['http:','https:'].includes(url.protocol)||!this.openLink)throw new Error('Opening external links is unavailable');
        await this.openLink(url.href);return {};
      }
    }
  }
  async close(){for(const operation of this.opening.values()){operation.cancelled=true;if(operation.remote)await this.call({action:'close',binding:operation.remote}).catch(()=>{});}const entries=[...this.bindings.values()];this.bindings.clear();await Promise.all(entries.map(entry=>this.call({action:'close',binding:entry.remote}).catch(()=>{})));this.forgetThread(this.scope.thread_id);}
}
