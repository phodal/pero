import React, {useEffect, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {mountMcpApp, type McpAppResource} from '@pero/mcp-apps';
import {AppBar, Badge, Button, Disclosure, EmptyState, Feedback, Field, Input, Select, Textarea} from '@pero/app-sdk/ui';
import '@pero/app-sdk/tokens.css';
import './panel.css';
import type {Tool} from '@modelcontextprotocol/sdk/types.js';
import type {McpAppBinding} from '../../../packages/content-source/mcp-source.ts';

const query=new URL(location.href).searchParams;
const token=query.get('token'),thread=query.get('thread')||'',managed=query.get('mode')==='session';
type AppTool={name:string;title:string;description?:string;inputSchema:Tool['inputSchema']};
type ServerInfo={id:string;title:string;connected:boolean;generation?:number;tools:AppTool[]};
type View=McpAppResource&{binding:McpAppBinding};
type Resource={uri:string;name:string};
type Template={uriTemplate:string;name:string};
type ResourcePage={server:ServerInfo;templates:boolean;resources?:Resource[];resourceTemplates?:Template[];nextCursor?:string};
async function api<T=unknown>(value:object):Promise<T>{
  const response=await fetch('/api',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
    body:JSON.stringify(value),keepalive:['close','cancel_open'].includes((value as {action?:string}).action||'')});
  const result=await response.json();if(!response.ok)throw new Error(result.error||'MCP request failed');return result as T;
}
const message=(error:unknown)=>error instanceof Error?error.message:String(error);

function ToolForm({tool,onOpen,busy}:{tool:AppTool;onOpen(args:Record<string,unknown>):void;busy:boolean}){
  const [values,setValues]=useState<Record<string,string>>({});
  const [error,setError]=useState('');
  return <form id="tool-form" onSubmit={event=>{
    event.preventDefault();setError('');
    try{
      const args:Record<string,unknown>={};
      for(const [name,raw] of Object.entries(tool.inputSchema.properties||{})){
        const schema=raw as {type?:string;default?:unknown};
        const value=values[name];
        if(value===undefined){if(schema.default!==undefined)args[name]=schema.default;continue;}
        if(value===''&&schema.type!=='string'&&schema.type!==undefined)continue;
        args[name]=schema.type==='string'||!schema.type?value:JSON.parse(value);
      }
      onOpen(args);
    }catch(error){setError(message(error));}
  }}>
    <h2>{tool.title}</h2>
    <div className="mcp-fields">{Object.entries(tool.inputSchema.properties||{}).map(([name,raw])=>{
      const schema=raw as {type?:string;title?:string;default?:unknown};
      const value=values[name]??(schema.default===undefined?'':typeof schema.default==='string'?schema.default:JSON.stringify(schema.default));
      return <Field key={name} label={schema.title||name}>{control=>['object','array'].includes(schema.type||'')
        ? <Textarea {...control} value={value} onChange={event=>setValues({...values,[name]:event.target.value})}/>
        : <Input {...control} value={value} onChange={event=>setValues({...values,[name]:event.target.value})}/>}</Field>;
    })}</div>
    {tool.description&&<Disclosure summary="Tool details" variant="inline"><p>{tool.description}</p></Disclosure>}
    {error&&<Feedback kind="error">{error}</Feedback>}
    <div className="mcp-form-actions"><Button type="submit" variant="primary" busy={busy} disabled={!thread}>Open view</Button></div>
  </form>;
}

function Panel(){
  const [servers,setServers]=useState<ServerInfo[]>([]),[serverId,setServerId]=useState('');
  const [selected,setSelected]=useState<{server:ServerInfo;tool:AppTool}>();
  const [view,setView]=useState<View>(),[busy,setBusy]=useState(false),[error,setError]=useState(''),[status,setStatus]=useState('Loading tools…');
  const [page,setPage]=useState<ResourcePage>(),[output,setOutput]=useState<{uri:string;text:string}>();
  const surface=useRef<HTMLDivElement>(null);
  const active=useRef<{view:View;runtime:Awaited<ReturnType<typeof mountMcpApp>>}|undefined>(undefined);
  const opening=useRef<{id:string;cancelled:boolean}|undefined>(undefined);
  const resourceRequest=useRef(0);
  const hadView=useRef(false);
  const server=servers.find(server=>server.id===serverId);
  const report=(error:unknown)=>{setError(message(error));setStatus('');};
  const close=async()=>{
    const pending=opening.current,previous=active.current,closingView=previous?.view||view;
    if(pending)pending.cancelled=true;
    if(active.current===previous)active.current=undefined;
    try{
      if(pending){await api({action:'cancel_open',operation:pending.id});if(opening.current===pending)opening.current=undefined;}
    }finally{
      try{await previous?.runtime.close();}
      finally{setView(current=>current===closingView?undefined:current);if(!opening.current)setStatus('');}
    }
  };
  const refresh=async()=>{
    const list=await api<ServerInfo[]>({action:'list'});setServers(list);
    setServerId(previous=>list.some(server=>server.id===previous)?previous:(list.find(server=>server.connected)||list[0])?.id||'');
    setStatus('');
  };
  useEffect(()=>{void refresh().catch(report);},[]);
  useEffect(()=>{
    const colors=matchMedia('(prefers-color-scheme:dark)');
    const update=()=>{
      document.documentElement.dataset.theme=colors.matches?'dark':'light';
      active.current?.runtime.setHostContext({theme:colors.matches?'dark':'light'});
    };
    update();colors.addEventListener('change',update);
    return ()=>colors.removeEventListener('change',update);
  },[]);
  useEffect(()=>{
    if(!view&&!busy&&hadView.current)document.querySelector<HTMLButtonElement>('#tool-form button[type="submit"]')?.focus();
    hadView.current=!!view||busy;
    document.title=view?view.title:'Tools and resources';
  },[view,busy]);
  useEffect(()=>{
    window.peroMcpTeardown=close;
    const dismiss=()=>{void close().catch(()=>{});};window.addEventListener('pagehide',dismiss);
    return ()=>window.removeEventListener('pagehide',dismiss);
  });
  useEffect(()=>{
    if(!view)return;
    let disposed=false;
    let mounted:Awaited<ReturnType<typeof mountMcpApp>>|undefined;
    const colors=matchMedia('(prefers-color-scheme:dark)');
    void mountMcpApp(surface.current!,{...view,title:view.binding.tool},{
      callTool:(name,args)=>api({action:'tool',binding:view.binding.id,name,arguments:args}),
      readResource:uri=>api({action:'resource',binding:view.binding.id,uri}),
      openLink:async url=>{await api({action:'open_link',binding:view.binding.id,url});},
      revoke:()=>api({action:'close',binding:view.binding.id}),
      onError:report,
      onState:state=>{if(state==='closed')setView(current=>current===view?undefined:current);setStatus(state==='connecting'?'Connecting view…':'');},
    },{locale:query.get('locale')||'en',theme:colors.matches?'dark':'light'}).then(runtime=>{
      mounted=runtime;
      if(disposed)void runtime.close().catch(report);else active.current={view,runtime};
    }).catch(report);
    return ()=>{
      disposed=true;
      if(active.current?.view===view)active.current=undefined;
      void mounted?.close().catch(report);
    };
  },[view]);
  const open=async(args:Record<string,unknown>)=>{
    if(!selected)return;
    if(opening.current){setStatus('An App is awaiting approval. Complete it or close it before opening another App.');return;}
    const pending={id:crypto.randomUUID(),cancelled:false};opening.current=pending;
    setBusy(true);setError('');setStatus('Running tool…');
    try{
      const next=await api<View>({action:'execute',server:selected.server.id,thread_id:thread,tool:selected.tool.name,arguments:args,
        ...(managed?{generation:selected.server.generation,operation:pending.id}:{})});
      if(pending.cancelled){await api({action:'close',binding:next.binding.id});return;}
      opening.current=undefined;await close();resourceRequest.current++;setView({...next,title:selected.tool.title});setPage(undefined);
    }catch(error){if(!pending.cancelled)report(error);}
    finally{if(opening.current===pending)opening.current=undefined;setBusy(false);}
  };
  const browse=async(server:ServerInfo,templates=false,cursor?:string)=>{
    const request=++resourceRequest.current;
    await close();if(request!==resourceRequest.current)return;
    setError('');setSelected(undefined);setOutput(undefined);setStatus('Loading resources…');
    const result=await api<Omit<ResourcePage,'server'|'templates'>>({action:templates?'templates':'resources',server:server.id,generation:server.generation,...(cursor?{cursor}:{})});
    if(request!==resourceRequest.current)return;
    setPage({...result,server,templates});setStatus('');
  };
  const read=async(uri:string)=>{
    if(!page)return;
    const request=++resourceRequest.current;
    setStatus('Loading resource…');
    const result=await api<{contents:{uri:string;mimeType?:string;text?:string}[]}>({action:'read',server:page.server.id,generation:page.server.generation,uri});
    if(request!==resourceRequest.current)return;
    setOutput({uri,text:result.contents.map(part=>`${part.uri} (${part.mimeType||'unknown type'})\n${part.text??'[Binary resource: not displayed]'}`).join('\n\n')});
    setStatus('');
  };
  const run=(effect:()=>Promise<unknown>)=>{
    setError('');const pending=effect(),request=resourceRequest.current;
    void pending.catch(error=>{if(request===resourceRequest.current)report(error);});
  };
  const choose=(tool:AppTool)=>run(async()=>{
    const request=++resourceRequest.current;if(view)await close();if(request!==resourceRequest.current)return;
    setPage(undefined);setOutput(undefined);setSelected({server:server!,tool});
  });
  return <div className="mcp-surface">
    <AppBar scope={view?<span className="mcp-view-scope"><Badge>{servers.find(server=>server.id===view.binding.server)?.title||view.binding.server}</Badge>{view.title}</span>
      :<Select label="MCP source" value={serverId} options={servers.map(server=>({value:server.id,label:server.title}))} onChange={id=>run(async()=>{
        const request=++resourceRequest.current;await close();if(request!==resourceRequest.current)return;
        setServerId(id);setSelected(undefined);setPage(undefined);setOutput(undefined);
      })} placeholder="Connected tools"/>}
      utilities={!view&&<Button variant="ghost" onClick={()=>run(refresh)}>Refresh</Button>}
      commands={(view||busy)&&<Button variant="ghost" onClick={()=>run(close)}>Close view</Button>}/>
    <div id="status" role="status">{status}</div>
    {error&&<Feedback kind="error" variant="block">{error}</Feedback>}
    {!view&&<div id="servers" className="mcp-catalog">
      {server&&!server.connected&&!managed&&<Button onClick={()=>run(async()=>{await api({action:'connect',server:server.id});await refresh();})}>Connect</Button>}
      {server?.connected&&<>
        <nav aria-label="Interactive tools">{server.tools.map(tool=><Button key={tool.name} variant={selected?.tool.name===tool.name?'secondary':'ghost'} onClick={()=>choose(tool)}>{tool.title}</Button>)}</nav>
        {managed&&<nav aria-label="Source resources"><Button variant="ghost" onClick={()=>run(()=>browse(server))}>Browse resources</Button><Button variant="ghost" onClick={()=>run(()=>browse(server,true))}>Resource templates</Button></nav>}
      </>}
    </div>}
    <main className={view?'mcp-content mcp-content-active':'mcp-content'}>
      {!view&&selected&&<ToolForm key={`${selected.server.id}/${selected.tool.name}`} tool={selected.tool} onOpen={args=>void open(args)} busy={busy}/>}
      {!view&&!selected&&!page&&!status&&<EmptyState title={servers.length?'Choose a tool result':'Connect a tool to get started'} description={servers.length?'Interactive results open here, using this conversation’s tool permissions.':'Manage MCP connections in Connectors, then open a conversation with the Pero Agent.'}/>}
      {page&&!view&&<section className="mcp-resources"><h2>{page.templates?'Resource templates':'Resources'}</h2>
        {page.resources?.map(resource=><Button key={resource.uri} variant="ghost" onClick={()=>run(()=>read(resource.uri))}>{resource.name||resource.uri}</Button>)}
        {page.resourceTemplates?.map(template=><TemplateRead key={template.uriTemplate} template={template} read={uri=>run(()=>read(uri))}/>)}
        {page.nextCursor&&<Button onClick={()=>run(()=>browse(page.server,page.templates,page.nextCursor))}>Next page</Button>}
        {output&&<><pre>{output.text}</pre><Button onClick={()=>run(async()=>{await api({action:'attach_resource',server:page.server.id,generation:page.server.generation,uri:output.uri});setStatus('Resource added to the Chat draft as untrusted context. Review it before sending.');})}>Add to Chat (text only, up to 64 KB)</Button></>}
      </section>}
      <div id="view" ref={surface} hidden={!view}/>
    </main>
  </div>;
}
function TemplateRead({template,read}:{template:Template;read(uri:string):void}){
  const [uri,setUri]=useState('');return <div className="mcp-template"><Field label={`Resource URI (${template.uriTemplate})`}>{control=><Input {...control} value={uri} onChange={event=>setUri(event.target.value)}/>}</Field><Button onClick={()=>read(uri)}>Read resource</Button></div>;
}
createRoot(document.getElementById('root')!).render(<Panel/>);
declare global {interface Window {peroMcpTeardown():Promise<void>;}}
