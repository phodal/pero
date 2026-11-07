import {AppBridge,PostMessageTransport,type McpUiResourceCsp} from '@modelcontextprotocol/ext-apps/app-bridge';
import type {CallToolResult,Tool} from '@modelcontextprotocol/sdk/types.js';
import {closeMcpView} from './lifecycle.ts';
import type {McpAppBinding} from '../../../packages/content-source/mcp-source.ts';
const query=new URL(location.href).searchParams,token=query.get('token'),thread=query.get('thread')||'',managed=query.get('mode')==='session';
const status=document.querySelector<HTMLElement>('#status')!;
const servers=document.querySelector<HTMLElement>('#servers')!;
const form=document.querySelector<HTMLFormElement>('#tool-form')!;
const surface=document.querySelector<HTMLElement>('#view')!;
type ServerInfo={id:string;title:string;transport:string;connected:boolean;generation?:number;managed?:boolean;tools:{name:string;title:string;description?:string;inputSchema:Tool['inputSchema']}[]};
type View={binding:McpAppBinding;html:string;csp?:McpUiResourceCsp;input:Record<string,unknown>;result:CallToolResult;sandbox:string};
let opening:{id:string;cancelled:boolean}|undefined;
let active:{view:View;bridge:AppBridge;frame:HTMLIFrameElement}|undefined;
async function api<T=unknown>(value:object):Promise<T>{
  const response=await fetch('/api',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(value),keepalive:['close','cancel_open'].includes((value as {action?:string}).action||'')});
  const result=await response.json();if(!response.ok)throw new Error(result.error||'MCP request failed');return result as T;
}
function report(error:unknown){status.textContent=error instanceof Error?error.message:String(error);}
function button(label:string,action:()=>void|Promise<unknown>){
  const element=document.createElement('button');element.type='button';element.textContent=label;
  element.onclick=()=>{element.disabled=true;void Promise.resolve().then(action).catch(report).finally(()=>{element.disabled=false;});};return element;
}
function field(parent:HTMLElement,label:string,value='',multiline=false){
  const wrapper=document.createElement('label');wrapper.textContent=label;
  const input=multiline?document.createElement('textarea'):document.createElement('input');input.value=value;
  wrapper.append(input);parent.append(wrapper);return input;
}
async function closeView(){
  if(opening){const pending=opening;opening=undefined;pending.cancelled=true;await api({action:'cancel_open',operation:pending.id});}
  if(!active)return;const previous=active;active=undefined;
  await closeMcpView({
    revoke:()=>api({action:'close',binding:previous.view.binding.id}),
    teardown:()=>previous.bridge.teardownResource({},{timeout:3000}),
    dispose:async()=>{await previous.bridge.close();previous.frame.remove();},
  });
}
async function mount(view:View){
  await closeView().catch(report);surface.replaceChildren();
  const frame=document.createElement('iframe');frame.title=`${view.binding.tool} · ${view.binding.server}`;
  frame.sandbox.add('allow-scripts','allow-same-origin');frame.referrerPolicy='no-referrer';
  surface.append(frame);
  const bridge=new AppBridge(null,{name:'Pero MCP Apps Host',version:'1.0.0'},{serverTools:{},serverResources:{},openLinks:{},sandbox:{csp:view.csp,permissions:{}}},
    {hostContext:{displayMode:'inline',availableDisplayModes:['inline'],platform:'desktop',locale:query.get('locale')||'en',theme:matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light'}});
  bridge.oncalltool=params=>api<CallToolResult>({action:'tool',binding:view.binding.id,name:params.name,arguments:params.arguments||{}});
  bridge.onreadresource=params=>api({action:'resource',binding:view.binding.id,uri:params.uri});
  bridge.onopenlink=async({url})=>{await api({action:'open_link',binding:view.binding.id,url});return {};};
  bridge.oninitialized=()=>{void bridge.sendToolInput({arguments:view.input}).then(()=>bridge.sendToolResult(view.result)).catch(report);status.textContent='App connected';};
  bridge.onerror=report;
  bridge.onsandboxready=()=>{void bridge.sendSandboxResourceReady({html:view.html,csp:view.csp,sandbox:'allow-scripts allow-same-origin allow-forms'}).catch(report);};
  bridge.onrequestteardown=()=>{void closeView().catch(report);};
  await bridge.connect(new PostMessageTransport(frame.contentWindow!,frame.contentWindow!));
  active={view,bridge,frame};frame.src=view.sandbox;
}
function toolForm(server:ServerInfo,tool:ServerInfo['tools'][number]){
  form.replaceChildren();const title=document.createElement('h2');title.textContent=tool.title;form.append(title);
  if(tool.description){const description=document.createElement('p');description.textContent=tool.description;form.append(description);}
  const fields=new Map<string,{input:HTMLInputElement|HTMLTextAreaElement;type:unknown}>();
  for(const [name,raw] of Object.entries(tool.inputSchema.properties||{})){
    const schema=raw as {type?:string;title?:string;default?:unknown};
    const input=field(form,schema.title||name,schema.default===undefined?'':typeof schema.default==='string'?schema.default:JSON.stringify(schema.default),['object','array'].includes(schema.type||''));
    fields.set(name,{input,type:schema.type});
  }
  const open=button('Open App',async()=>{
    if(opening){status.textContent='An App is awaiting approval. Complete it or close it before opening another App.';return;}
    const args:Record<string,unknown>={};
    for(const [name,{input,type}] of fields){if(!input.value)continue;args[name]=type==='string'||!type?input.value:JSON.parse(input.value);}
    const pending={id:crypto.randomUUID(),cancelled:false};if(managed)opening=pending;
    status.textContent='Running tool…';
    try{const view=await api<View>({action:'execute',server:server.id,thread_id:thread,tool:tool.name,arguments:args,...(managed?{generation:server.generation,operation:pending.id}:{})});
      if(pending.cancelled){await api({action:'close',binding:view.binding.id});return;}
      if(opening===pending)opening=undefined;await mount(view);
    }finally{if(opening===pending)opening=undefined;}
  });
  open.disabled=!thread;
  if(!thread)status.textContent='Select a conversation in the workbench to run an App.';
  form.append(open,button('Close App',closeView));
}
async function resources(server:ServerInfo,templates=false,cursor?:string){
  await closeView().catch(report);form.replaceChildren();surface.replaceChildren();status.textContent='Loading resources…';
  const page=await api<{resources?:{uri:string;name:string;description?:string}[];resourceTemplates?:{uriTemplate:string;name:string;description?:string}[];nextCursor?:string}>({action:templates?'templates':'resources',server:server.id,generation:server.generation,...(cursor?{cursor}:{})});
  const heading=document.createElement('h2');heading.textContent=`${server.title} · ${templates?'Resource templates':'Resources'}`;surface.append(heading);
  const read=async(uri:string)=>{
    const result=await api<{contents:{uri:string;text?:string;blob?:string;mimeType?:string}[]}>({action:'read',server:server.id,generation:server.generation,uri});
    const content=document.createElement('pre');content.style.whiteSpace='pre-wrap';
    content.textContent=result.contents.map(part=>`${part.uri} (${part.mimeType||'unknown type'})\n${part.text??'[Binary resource: not displayed]'}`).join('\n\n');
    output.replaceChildren(content,button('Add to Chat (text only, up to 64 KB)',async()=>{await api({action:'attach_resource',server:server.id,generation:server.generation,uri});status.textContent='Resource added to the Chat draft as untrusted context. Review it before sending.';}));status.textContent='Resource read from this session. It has not been added to Chat.';
  };
  for(const resource of page.resources||[])surface.append(button(resource.name||resource.uri,()=>read(resource.uri)));
  for(const template of page.resourceTemplates||[]){const row=document.createElement('div');const label=document.createElement('strong');label.textContent=template.name;row.append(label);
    const uri=field(row,`Resource URI (${template.uriTemplate})`);row.append(button('Read resource',()=>read(uri.value)));surface.append(row);}
  if(page.nextCursor)surface.append(button('Next page',()=>resources(server,templates,page.nextCursor)));
  const output=document.createElement('div');surface.append(output);status.textContent='Resource content is untrusted source material. Reading does not run tools.';
}
async function refresh(){
  const list=await api<ServerInfo[]>({action:'list'});servers.replaceChildren();
  for(const server of list){const row=document.createElement('article');const title=document.createElement('strong');title.textContent=server.title;row.append(title,document.createElement('br'));
    if(!managed)row.append(button(server.connected?'Disconnect':'Connect',async()=>{if(active?.view.binding.server===server.id)await closeView();await api({action:server.connected?'disconnect':'connect',server:server.id});await refresh();}));
    else {const state=document.createElement('span');state.textContent=server.connected?'Session connected':'Session disconnected';row.append(state,document.createElement('br'));
      if(server.connected)row.append(button('Browse resources',()=>resources(server)),button('Resource templates',()=>resources(server,true)));}
    if(server.connected)for(const tool of server.tools)row.append(button(tool.title,()=>toolForm(server,tool)));
    servers.append(row);
  }
  if(managed)return;
  const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent='Add server';details.append(summary);
  const id=field(details,'ID'),title=field(details,'Name'),transport=document.createElement('select');
  for(const value of ['http','stdio']){const option=document.createElement('option');option.value=value;option.textContent=value;transport.append(option);}details.append(transport);
  const endpoint=field(details,'HTTP URL / executable'),args=field(details,'Stdio arguments (JSON array)','[]'),environment=field(details,'Header/environment references (JSON object)','{}',true);
  details.append(button('Save server',async()=>{await api({action:'configure',config:{id:id.value,title:title.value,transport:transport.value,
    ...(transport.value==='http'?{url:endpoint.value,header_env:JSON.parse(environment.value)}:{command:endpoint.value,args:JSON.parse(args.value),env:JSON.parse(environment.value)})}});await refresh();}));
  servers.append(details);
}
document.querySelector<HTMLButtonElement>('#refresh')!.onclick=()=>{void refresh().catch(report);};
window.peroMcpTeardown=closeView;
window.addEventListener('pagehide',()=>{void closeView().catch(()=>{});});
if(managed){document.querySelector('h1')!.textContent='Session MCP resources & Apps';status.textContent='Uses the active Agent session and its saved tool permissions. Manage connectors in MCP settings.';}
void refresh().catch(report);
declare global {interface Window {peroMcpTeardown():Promise<void>;}}
