import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {StdioClientTransport,getDefaultEnvironment} from '@modelcontextprotocol/sdk/client/stdio.js';
import type {Tool,Resource,CallToolResult} from '@modelcontextprotocol/sdk/types.js';
import {RESOURCE_MIME_TYPE,getToolUiResourceUri,McpUiToolMetaSchema,McpUiResourceMetaSchema,type McpUiResourceCsp} from '@modelcontextprotocol/ext-apps/app-bridge';
import {randomUUID} from 'node:crypto';
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {dirname} from 'node:path';
import {McpServerConfigSchema,type McpServerConfig,type McpAppBinding,type McpPanelCommand} from '../../../packages/content-source/mcp-source.ts';
import {admitMcpCsp} from './mcp-policy.ts';

type AppTool={tool:Tool;resource?:string;visible:boolean};
type Connected={client:Client;tools:Map<string,AppTool>;resources:Map<string,Resource>};
export type McpView={binding:McpAppBinding;html:string;csp?:McpUiResourceCsp;input:Record<string,unknown>;result:CallToolResult};
type BoundView={view:McpView;tools:Set<string>};
/** The privileged Host owns connections and bindings; frames cannot select their authority. */
export class McpSources {
  private configs=new Map<string,McpServerConfig>();
  private connected=new Map<string,Connected>();
  private bindings=new Map<string,BoundView>();
  private threads=new Set<string>();
  private configPath:string;
  private openLink:((url:string)=>Promise<void>)|undefined;
  constructor(configPath:string,openLink?:((url:string)=>Promise<void>)){this.configPath=configPath;this.openLink=openLink;}
  async load(){
    let text:string;
    try {text=await readFile(this.configPath,'utf8');}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return;throw error;}
    const value:unknown=JSON.parse(text);
    if(!Array.isArray(value))throw new Error('Invalid MCP server configuration');
    for(const raw of value){const config=McpServerConfigSchema.parse(raw);if(this.configs.has(config.id))throw new Error('Duplicate MCP server identity');this.configs.set(config.id,config);}
  }
  admitThread(thread:string){if(!thread)throw new Error('A conversation is required');this.threads.add(thread);}
  forgetThread(thread:string){this.threads.delete(thread);for(const [id,entry] of this.bindings)if(entry.view.binding.thread_id===thread)this.bindings.delete(id);}
  list(){return [...this.configs.values()].map(config=>({id:config.id,title:config.title,transport:config.transport,connected:this.connected.has(config.id),
    tools:[...(this.connected.get(config.id)?.tools.values()||[])].filter(entry=>entry.resource).map(({tool,resource})=>({name:tool.name,title:tool.title||tool.name,description:tool.description,inputSchema:tool.inputSchema,resource_uri:resource}))}));}
  view(id:string){const entry=this.bindings.get(id);if(!entry||!this.threads.has(entry.view.binding.thread_id))throw new Error('This MCP source is closed');return entry.view;}
  private server(id:string){const server=this.connected.get(id);if(!server)throw new Error('Connect this MCP server first');return server;}
  async connect(id:string){
    if(this.connected.has(id))return;
    const config=this.configs.get(id);if(!config)throw new Error('Unknown MCP server');
    const environment=(refs:Record<string,string>)=>Object.fromEntries(Object.entries(refs).map(([key,name])=>{const value=process.env[name];if(value===undefined)throw new Error(`Host environment variable ${name} is unavailable`);return [key,value];}));
    const transport=config.transport==='http'?new StreamableHTTPClientTransport(new URL(config.url),{requestInit:{headers:environment(config.header_env)}}):
      new StdioClientTransport({command:config.command,args:config.args,env:{...getDefaultEnvironment(),...environment(config.env)},stderr:'inherit'});
    const client=new Client({name:'Pero MCP Apps Host',version:'1.0.0'},{capabilities:{extensions:{'io.modelcontextprotocol/ui':{mimeTypes:[RESOURCE_MIME_TYPE]}}}});
    try {
      await client.connect(transport);
      const tools=new Map<string,AppTool>();let cursor:string|undefined;
      do {const page=await client.listTools({cursor});for(const tool of page.tools){const meta=McpUiToolMetaSchema.parse(tool._meta?.ui||{});tools.set(tool.name,{tool,resource:getToolUiResourceUri(tool),visible:!meta.visibility||meta.visibility.includes('app')});}cursor=page.nextCursor;}while(cursor);
      const resources=new Map<string,Resource>();
      if(client.getServerCapabilities()?.resources){do {const page=await client.listResources({cursor});for(const resource of page.resources)resources.set(resource.uri,resource);cursor=page.nextCursor;}while(cursor);}
      this.connected.set(id,{client,tools,resources});
    } catch(error){await client.close();throw error;}
  }
  async disconnect(id:string){
    for(const [key,entry] of this.bindings)if(entry.view.binding.server===id)this.bindings.delete(key);
    const server=this.connected.get(id);this.connected.delete(id);await server?.client.close();
  }
  async command(command:McpPanelCommand):Promise<unknown>{
    switch(command.action){
      case 'list':return this.list();
      case 'configure':{
        if(this.connected.has(command.config.id))throw new Error('Disconnect this server before changing its configuration');
        this.configs.set(command.config.id,command.config);await mkdir(dirname(this.configPath),{recursive:true});
        await writeFile(this.configPath+'.tmp',JSON.stringify([...this.configs.values()]),{mode:0o600});await rename(this.configPath+'.tmp',this.configPath);return this.list();
      }
      case 'connect':await this.connect(command.server);return this.list();
      case 'disconnect':await this.disconnect(command.server);return this.list();
      case 'close':this.bindings.delete(command.binding);return {};
      case 'execute':{
        if(!this.threads.has(command.thread_id))throw new Error('This conversation is unavailable');
        const server=this.server(command.server),tool=server.tools.get(command.tool);
        if(!tool?.resource)throw new Error('This tool does not declare an MCP App resource');
        const resource=await server.client.readResource({uri:tool.resource});
        const content=resource.contents[0];
        if(resource.contents.length!==1||!content||content.mimeType!==RESOURCE_MIME_TYPE)throw new Error('The MCP App resource must be one text/html;profile=mcp-app document');
        const meta=McpUiResourceMetaSchema.parse(content._meta?.ui??server.resources.get(tool.resource)?._meta?.ui??{});
        const result=await server.client.callTool({name:tool.tool.name,arguments:command.arguments}) as CallToolResult;
        const view:McpView={binding:{id:randomUUID(),server:command.server,resource_uri:tool.resource,tool:tool.tool.name,tool_call:randomUUID(),thread_id:command.thread_id},
          html:'text' in content?content.text:Buffer.from(content.blob,'base64').toString('utf8'),csp:admitMcpCsp(meta.csp),input:command.arguments,result};
        this.bindings.set(view.binding.id,{view,tools:new Set([...server.tools].filter(([,tool])=>tool.visible&&(!tool.resource||tool.resource===view.binding.resource_uri)).map(([name])=>name))});
        return view;
      }
      case 'tool':{
        const view=this.view(command.binding),entry=this.bindings.get(command.binding)!;
        if(!entry.tools.has(command.name))throw new Error('This tool is not available to this MCP App');
        return this.server(view.binding.server).client.callTool({name:command.name,arguments:command.arguments});
      }
      case 'resource':{
        const view=this.view(command.binding);
        if(command.uri!==view.binding.resource_uri)throw new Error('This resource is outside the MCP App binding');
        return this.server(view.binding.server).client.readResource({uri:command.uri});
      }
      case 'open_link':{
        this.view(command.binding);const url=new URL(command.url);
        if(!['http:','https:'].includes(url.protocol)||!this.openLink)throw new Error('Opening external links is unavailable');
        await this.openLink(url.href);return {};
      }
    }
  }
  async close(){this.bindings.clear();for(const id of [...this.connected.keys()])await this.disconnect(id);}
}
