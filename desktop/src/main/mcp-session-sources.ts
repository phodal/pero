import {randomUUID} from 'node:crypto';
import {ToolSchema,ReadResourceResultSchema,CallToolResultSchema,type Tool} from '@modelcontextprotocol/sdk/types.js';
import {RESOURCE_MIME_TYPE,getToolUiResourceUri,McpUiResourceMetaSchema,McpUiToolMetaSchema} from '@modelcontextprotocol/ext-apps/app-bridge';
import type {McpPanelCommand} from '../../../packages/content-source/mcp-source.ts';
import type {McpView} from './mcp-sources.ts';
import type {McpSessionScope,McpSessionCall} from './mcp-session-rpc.ts';
import {admitMcpCsp} from './mcp-policy.ts';
import {z} from 'zod';
export type McpResourceSelection=McpSessionScope&{server:string;generation:number;uri:string;tool_call?:string;contents:{uri:string;mimeType?:string;text:string}[]};
const TextResourceResult=z.object({contents:z.array(z.object({uri:z.string().min(1),text:z.string().refine(text=>!text.includes('\0')),mimeType:z.string().optional(),blob:z.never().optional()})).min(1).max(16)});
const Catalog=z.object({servers:z.array(z.object({name:z.string(),generation:z.number().int().nonnegative(),connected:z.boolean(),tools:z.array(ToolSchema)}))});
const PreparedBinding=z.object({binding:z.string().min(1),resource:z.unknown().optional()});
const AdoptedCall=z.object({input:z.record(z.string(),z.unknown()),result:CallToolResultSchema,tool:z.string().min(1),resource_uri:z.string().min(1)});
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
  private sendMessage?:((scope:McpSessionScope,text:string)=>Promise<void>);
  constructor(scope:McpSessionScope,rpc:(scope:McpSessionScope,call:McpSessionCall)=>Promise<unknown>,openLink?:((url:string)=>Promise<void>),onResource?:((selection:McpResourceSelection)=>void),sendMessage?:((scope:McpSessionScope,text:string)=>Promise<void>)){this.scope={...scope};this.rpc=rpc;this.openLink=openLink;this.onResource=onResource;this.sendMessage=sendMessage;}
  async load(){}
  admitThread(thread:string){if(!this.alive||thread!==this.scope.thread_id)throw new Error('This MCP session is unavailable');}
  forgetThread(thread:string){if(thread===this.scope.thread_id){this.alive=false;this.bindings.clear();this.catalog.clear();}}
  view(id:string){const entry=this.bindings.get(id);if(!this.alive||!entry)throw new Error('This MCP source is closed');return entry.view;}
  private async call(call:McpSessionCall){this.admitThread(this.scope.thread_id);const result=await this.rpc(this.scope,call);this.admitThread(this.scope.thread_id);return result;}
  private server(name:string,generation:number|undefined){const server=this.catalog.get(name);if(!server)throw new Error(`This MCP server is not in the session catalog: ${name}`);if(!server.connected||generation!==server.generation)throw new Error(`This MCP server catalog is stale; refresh it (${server.generation} vs ${generation})`);return server;}
  private internal(server:string){return server==='pero-app-use'&&!this.catalog.has(server);}
  observeServers(servers:{server:string;generation:number;status:string}[]){
    for(const [name,catalog] of this.catalog){const observed=servers.find(server=>server.server===name);if(!observed||observed.status!=='connected'||observed.generation!==catalog.generation)this.catalog.delete(name);}
    for(const [id,entry] of this.bindings)if(!this.internal(entry.view.binding.server)&&!this.catalog.has(entry.view.binding.server))this.bindings.delete(id);
  }
  async list(){
    const {servers}=Catalog.parse(await this.call({action:'list'}));
    this.catalog=new Map(servers.map(server=>[server.name,server]));
    for(const [id,entry] of this.bindings){if(this.internal(entry.view.binding.server))continue;const server=this.catalog.get(entry.view.binding.server);if(!server?.connected||server.generation!==entry.generation)this.bindings.delete(id);}
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
      case 'execute':case 'adopt':{
        if(command.action==='execute'&&command.thread_id!==this.scope.thread_id)throw new Error('This conversation is outside the MCP panel binding');
        if(typeof command.generation!=='number')throw new Error('This MCP server catalog is stale; refresh it');
        const generation=command.generation;
        if(!command.operation||this.opening.has(command.operation))throw new Error('An MCP App operation identity is required');
        const operation:{cancelled:boolean;remote?:string}={cancelled:false};this.opening.set(command.operation,operation);
        try{
          if(this.catalog.get(command.server)?.generation!==generation)await this.list();
          if(operation.cancelled)throw new Error('MCP App opening cancelled');
          // pero-app-use is an internal session connection, not a user-managed directory entry.
          const current=()=>{
            const listed=this.catalog.get(command.server);
            if(!listed){
              if(command.server==='pero-app-use')return {generation,connected:true,tools:[] as Tool[]};
              throw new Error(`This MCP server catalog is stale; refresh it (absent vs ${generation})`);
            }
            if(!listed.connected||listed.generation!==generation)throw new Error(`This MCP server catalog is stale; refresh it (${listed.generation} vs ${generation}, connected ${listed.connected})`);
            return listed;
          };
          const server=current();
          const receipt=command.action==='adopt'?await this.call({action:'adopt',server:command.server,generation:command.generation,tool_call:command.tool_call}):undefined;
          const original=receipt===undefined?undefined:PreparedBinding.parse(receipt);
          operation.remote=original?.binding;
          const adopted=receipt===undefined?undefined:AdoptedCall.parse(receipt);
          const declared=server.tools.find(tool=>tool.name===(adopted?.tool??(command.action==='execute'?command.tool:'')));
          const uri=(declared&&getToolUiResourceUri(declared))||adopted?.resource_uri;
          const toolName=declared?.name||adopted?.tool||(command.action==='execute'?command.tool:'');
          if(!uri||!toolName||adopted&&adopted.resource_uri!==uri)throw new Error('This tool does not declare the bound MCP App resource');
          const prepared=original??PreparedBinding.parse(await this.call({action:'prepare',server:command.server,generation:command.generation,name:toolName}));
          operation.remote=prepared.binding;
          if(operation.cancelled)throw new Error('MCP App opening cancelled');
          // The tool result does not carry the HTML. Read that document by its URI.
          const resource=ReadResourceResultSchema.parse(prepared.resource??await this.call({action:'read',server:command.server,generation:command.generation,uri}));
          const content=resource.contents[0];
          if(resource.contents.length!==1||!content||content.uri!==uri||content.mimeType!==RESOURCE_MIME_TYPE||!('text' in content))throw new Error('The MCP App resource must be one bound text/html;profile=mcp-app document');
          const meta=McpUiResourceMetaSchema.parse(content._meta?.ui??{});
          const csp=admitMcpCsp(meta.csp);
          current();
          const input=adopted?.input??(command.action==='execute'?command.arguments:{});
          const result=adopted?.result??CallToolResultSchema.parse(await this.call({action:'tool',binding:prepared.binding,name:toolName,arguments:input}));
          if(operation.cancelled)throw new Error('MCP App opening cancelled');
          current();
          const view:McpView={binding:{id:randomUUID(),server:command.server,resource_uri:uri,tool:toolName,tool_call:command.action==='adopt'?command.tool_call:randomUUID(),thread_id:this.scope.thread_id},html:content.text,csp,input,result,canUpdateModelContext:!!this.onResource};
          this.bindings.set(view.binding.id,{view,remote:prepared.binding,generation:server.generation});return view;
        }catch(error){if(operation.remote)await this.call({action:'close',binding:operation.remote}).catch(()=>{});throw error;}
        finally{this.opening.delete(command.operation);}
      }
      case 'close':{
        const entry=this.bindings.get(command.binding);if(!entry)return {};
        this.bindings.delete(command.binding);return this.call({action:'close',binding:entry.remote});
      }
      case 'tool':case 'resource':case 'open_link':case 'message':case 'update_model_context':{
        const view=this.view(command.binding),entry=this.bindings.get(command.binding)!;
        if(this.catalog.has(view.binding.server))this.server(view.binding.server,entry.generation);
        if(command.action==='message'){
          if(!this.sendMessage)throw new Error('Sending messages to this conversation is unavailable');
          await this.sendMessage(this.scope,command.text);return {};
        }
        if(command.action==='update_model_context'){
          if(!this.onResource)throw new Error('Adding context to Chat is unavailable');
          const {server,resource_uri:uri,tool_call}=view.binding;
          const provenance={...this.scope,server,generation:entry.generation,uri,tool_call};
          const contents=command.text.trim()?[{uri,mimeType:'text/plain',text:command.text}]:[];
          if(command.text.includes('\0') || Buffer.byteLength(JSON.stringify({provenance,contents}),'utf8')>64_000)
            throw new Error('App context is invalid or exceeds 64 KB');
          this.onResource({...provenance,contents});
          return {};
        }
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
