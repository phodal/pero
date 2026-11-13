import {createServer,type Server,type IncomingMessage,type ServerResponse} from 'node:http';
import {randomBytes} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {McpPanelCommandSchema} from '../../../packages/content-source/mcp-source.ts';
import type {McpAppBinding} from '../../../packages/content-source/mcp-source.ts';
import {McpSources} from './mcp-sources.ts';
import type {McpSessionSources} from './mcp-session-sources.ts';
import {mcpSandboxCsp} from './mcp-policy.ts';
const conversationAncestors='pero://workbench pero://chat';

/** One privileged provider serves the trusted panel and a different-origin sandbox. */
export class McpHost {
  readonly sources:McpSources|McpSessionSources;
  private panel?:Server;
  private sandbox?:Server;
  private origin='';
  private sandboxOrigin='';
  private panels=new Map<string,string|undefined>();
  private assets:string;
  private onBinding:((binding:McpAppBinding)=>void)|undefined;
  constructor(config:string,assets:string,openLink?:((url:string)=>Promise<void>),onBinding?:((binding:McpAppBinding)=>void),sources?:McpSessionSources) {
    this.sources=sources??new McpSources(config,openLink);this.assets=assets;this.onBinding=onBinding;
  }
  async start(){
    if(this.panel)return;
    await this.sources.load();
    this.sandbox=createServer((request,response)=>{void this.serveSandbox(request,response).catch(error=>this.fail(response,error));});
    this.sandboxOrigin=await this.listen(this.sandbox);
    this.panel=createServer((request,response)=>{void this.servePanel(request,response).catch(error=>this.fail(response,error));});
    this.origin=await this.listen(this.panel);
  }
  open(thread:string|undefined,locale='en',call?:{server:string;generation:number;tool_call:string}){
    if(!this.origin)throw new Error('MCP Apps provider is unavailable');
    if(thread)this.sources.admitThread(thread);
    const token=[...this.panels].find(([,scope])=>scope===thread)?.[0]||randomBytes(32).toString('hex');
    this.panels.set(token,thread);
    const url=new URL(`${this.origin}/`);url.search=new URLSearchParams({token,thread:thread||'',locale,mode:'scope' in this.sources?'session':'standalone',...(call?{server:call.server,generation:String(call.generation),tool_call:call.tool_call}:{})}).toString();return url.href;
  }
  forgetThread(thread:string){this.sources.forgetThread(thread);for(const [token,scope] of this.panels)if(scope===thread)this.panels.delete(token);}
  ownsPanel(value:string){if(!URL.canParse(value))return false;const url=new URL(value);return url.origin===this.origin&&this.panels.has(url.searchParams.get('token')||'');}
  private async listen(server:Server):Promise<string>{
    await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>{server.removeListener('error',reject);resolve();});});
    const address=server.address();if(!address||typeof address==='string')throw new Error('MCP source listener has no address');
    return `http://127.0.0.1:${address.port}`;
  }
  private fail(response:ServerResponse,error:unknown){
    if(response.headersSent){response.end();return;}
    response.writeHead(400,{'Content-Type':'application/json','Cache-Control':'no-store'});
    response.end(JSON.stringify({error:error instanceof Error?error.message:String(error)}));
  }
  private async asset(response:ServerResponse,file:string,type:string,headers:Record<string,string>={}){
    const data=await readFile(join(this.assets,file));response.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store',...headers});response.end(data);
  }
  private async servePanel(request:IncomingMessage,response:ServerResponse){
    const url=new URL(request.url||'/',this.origin);
    if(request.method==='GET'&&url.pathname==='/panel.css'){await this.asset(response,'mcp-panel.css','text/css');return;}
    if(request.method==='GET'&&url.pathname==='/panel.js'){await this.asset(response,'mcp-panel.js','text/javascript');return;}
    if(request.method==='GET'&&url.pathname==='/'){
      if(!this.panels.has(url.searchParams.get('token')||''))throw new Error('This MCP source panel is unavailable');
      response.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer',
        'Content-Security-Policy':`default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-src ${this.sandboxOrigin}; base-uri 'none'; object-src 'none'`});
      response.end(PANEL_HTML);return;
    }
    const token=request.headers.authorization?.replace(/^Bearer /,'')||'';
    if(request.method!=='POST'||url.pathname!=='/api'||!this.panels.has(token)||request.headers.origin!==this.origin)throw new Error('MCP source request is unavailable');
    const chunks:Buffer[]=[];let bytes=0;
    for await(const chunk of request){
      bytes+=chunk.length;
      if(bytes>16_000_000)throw new Error('MCP source request exceeds limit');
      chunks.push(chunk);
    }
    const body=Buffer.concat(chunks,bytes).toString('utf8');
    const command=McpPanelCommandSchema.parse(JSON.parse(body));
    const thread=this.panels.get(token);
    if(command.action==='execute'&&command.thread_id!==thread)throw new Error('This conversation is outside the MCP panel binding');
    if('binding' in command&&this.sources.view(command.binding).binding.thread_id!==thread)throw new Error('This source is outside the MCP panel binding');
    const value=await this.sources.command(command);
    if(command.action==='execute'||command.action==='adopt')this.onBinding?.((value as {binding:McpAppBinding}).binding);
    response.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});
    response.end(JSON.stringify(command.action==='execute'||command.action==='adopt'?{...value as object,sandbox:`${this.sandboxOrigin}/sandbox?binding=${encodeURIComponent((value as {binding:{id:string}}).binding.id)}&host=${encodeURIComponent(this.origin)}`}:value));
  }
  private async serveSandbox(request:IncomingMessage,response:ServerResponse){
    const url=new URL(request.url||'/',this.sandboxOrigin);
    if(request.method==='GET'&&url.pathname==='/sandbox.js'){await this.asset(response,'mcp-sandbox.js','text/javascript');return;}
    if(request.method==='GET'&&url.pathname==='/resource'){
      const view=this.sources.view(url.searchParams.get('binding')||'');
      response.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store',
        'Content-Security-Policy':`${mcpSandboxCsp(view.csp)}; frame-ancestors ${this.origin} ${this.sandboxOrigin} ${conversationAncestors}`,
        'Referrer-Policy':'no-referrer','Permissions-Policy':'camera=(), microphone=(), geolocation=(), clipboard-write=()'});
      response.end(view.html);return;
    }
    if(request.method!=='GET'||url.pathname!=='/sandbox'||url.searchParams.get('host')!==this.origin)throw new Error('MCP sandbox is unavailable');
    const view=this.sources.view(url.searchParams.get('binding')||'');
    response.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store',
      'Content-Security-Policy':`default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; frame-src 'self'; frame-ancestors ${this.origin} ${conversationAncestors}; base-uri 'none'; object-src 'none'`,'Referrer-Policy':'no-referrer',
      'Permissions-Policy':'camera=(), microphone=(), geolocation=(), clipboard-write=()'});
    response.end('<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0"><script src="/sandbox.js"></script></body></html>');
  }
  async close(){
    await this.sources.close();
    for(const server of [this.panel,this.sandbox])if(server){server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
    this.panel=undefined;this.sandbox=undefined;this.origin='';this.panels.clear();
  }
}
const PANEL_HTML=`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Tools and resources</title><link rel="stylesheet" href="/panel.css"></head><body><div id="root"></div><script src="/panel.js"></script></body></html>`;
