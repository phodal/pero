import React, {useEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {App} from '@modelcontextprotocol/ext-apps';
import {applyMcpAppTheme} from '@pero/mcp-apps/theme';
import type {CallToolResult} from '@modelcontextprotocol/sdk/types.js';
import {z} from 'zod';
import {Button, Badge, Feedback, Disclosure, Table} from '@pero/app-sdk/ui';
import '@pero/app-sdk/tokens.css';

// Validate the wire shape once. Notebook still owns saved-state and domain validation.
type NotebookNode={type:string;text?:string;attrs?:Record<string,unknown>;content?:NotebookNode[];[key:string]:unknown};
const Node:z.ZodType<NotebookNode>=z.lazy(()=>z.object({type:z.string(),text:z.string().optional(),
  attrs:z.record(z.string(),z.unknown()).optional(),content:z.array(Node).optional()}).passthrough());
const Metadata=z.object({id:z.string(),title:z.string(),revision:z.number().int(),updatedAt:z.string()});
const Chunk=Metadata.extend({format:z.literal('json-chunk'),offset:z.number().int(),
  nextOffset:z.number().int().nullable(),totalCharacters:z.number().int(),content:z.string()});
const Entry=z.union([
  Metadata.extend({document:z.object({content:z.object({type:z.literal('doc'),content:z.array(Node)})}).passthrough()}),
  Metadata.extend({block:Node}),
  Metadata.extend({format:z.literal('block-index'),blocks:z.array(z.object({blockId:z.string(),type:z.string()})),
    offset:z.number().int(),nextOffset:z.number().int().nullable(),totalBlocks:z.number().int()}),
  Chunk.extend({target:z.literal('document'),blockId:z.null()}),
  Chunk.extend({target:z.literal('block'),blockId:z.string().min(1)}),
]);
type Entry=z.infer<typeof Entry>;
type ReadSelection={view:'index';blockId?:never;offset?:number}|{view?:never;blockId?:string;offset?:number};
const Envelope=z.object({result:Entry});
const app=new App({name:'Pero Notebook Inspector',version:'0.1.0'},{});
const style=document.createElement('style');
style.textContent=`
  body{background:var(--pero-surface);color:var(--pero-text);font:14px system-ui}
  main{padding:var(--pero-spacing-4);max-width:760px;margin:auto}
  header{display:flex;gap:var(--pero-spacing-3);align-items:center;flex-wrap:wrap}
  h1{font-size:24px;margin:0;overflow-wrap:anywhere}
  .notebook-inspector-meta{color:var(--pero-text-muted);font-size:12px}p{line-height:1.6}
  pre{white-space:pre-wrap;overflow-wrap:anywhere;font:13px ui-monospace,monospace}
  nav{display:flex;gap:var(--pero-spacing-2);flex-wrap:wrap;margin:var(--pero-spacing-3) 0}
  article{padding:var(--pero-spacing-3) 0;border-bottom:1px solid var(--pero-border)}
  blockquote{margin:var(--pero-spacing-3) 0;padding-left:var(--pero-spacing-4);border-left:2px solid var(--pero-border)}
`;
document.head.append(style);
app.onteardown=async()=>{root.unmount();return {};};

function Block({value}:{value:NotebookNode}){
  const children=value.content?.map((child,index)=><Block key={index} value={child}/>);
  if(value.type==='doc')return <>{children}</>;
  if(value.type==='text')return <>{value.text}</>;
  if(value.type==='hardBreak')return <br/>;
  if(value.type==='heading')return <h2>{children}</h2>;
  if(value.type==='paragraph')return <p>{children}</p>;
  if(value.type==='codeBlock')return <pre>{children}</pre>;
  if(value.type==='bulletList'||value.type==='taskList')return <ul>{children}</ul>;
  if(value.type==='orderedList')return <ol start={typeof value.attrs?.start==='number'?value.attrs.start:undefined}>{children}</ol>;
  if(value.type==='listItem')return <li>{children}</li>;
  if(value.type==='taskItem')return <li><span aria-label={value.attrs?.checked===true?'Completed':'Not completed'}>{value.attrs?.checked===true?'☑':'☐'}</span> {children}</li>;
  if(value.type==='blockquote')return <blockquote>{children}</blockquote>;
  const label=typeof value.attrs?.blockId==='string'?value.attrs.blockId:'Saved fields';
  return <section><strong>{value.type}</strong>{children}
    <Disclosure summary={label}><pre>{JSON.stringify(value,null,2)}</pre></Disclosure>
  </section>;
}

function Inspector(){
  const [entry,setEntry]=useState<Entry>();
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const [locale,setLocale]=useState<string>();
  const [retry,setRetry]=useState<ReadSelection>();
  const mounted=useRef(true);
  const receive=(result:CallToolResult)=>{
    if(!mounted.current)return false;
    if(result.isError){setError(result.content.filter(c=>c.type==='text').map(c=>c.text).join('\n')||'Could not read this saved entry.');return false;}
    const value=Envelope.safeParse(result.structuredContent);
    if(!value.success){setError('The Notebook response could not be displayed. Close the Inspector and read the saved entry again.');return false;}
    setEntry(value.data.result);setError('');setRetry(undefined);return true;
  };
  useEffect(()=>{
    mounted.current=true;
    app.ontoolresult=receive;
    app.onhostcontextchanged=context=>{applyMcpAppTheme(context);if(context.locale)setLocale(context.locale);};
    void app.connect().then(()=>{
      if(!mounted.current)return;
      const context=app.getHostContext();if(context)applyMcpAppTheme(context);setLocale(context?.locale);
    }).catch(error=>{if(mounted.current)setError(String(error));});
    return ()=>{mounted.current=false;};
  },[]);
  const read=async(selection:ReadSelection)=>{
    if(!entry||busy)return;
    setBusy(true);setError('');
    try{
      const result=await app.callServerTool({name:'app__notebook__read-entry',arguments:{entryId:entry.id,revision:entry.revision,...selection}});
      if(!receive(result)&&mounted.current)setRetry(selection);
    }catch(error){if(mounted.current){setError(error instanceof Error?error.message:String(error));setRetry(selection);}}
    finally{if(mounted.current)setBusy(false);}
  };
  const index=entry&&'format' in entry&&entry.format==='block-index'?entry:undefined;
  const chunk=entry&&'format' in entry&&entry.format==='json-chunk'?entry:undefined;
  const block=entry&&'block' in entry?entry.block:undefined;
  // Continuation identity comes from the displayed response, including after a failed read.
  const chunkSelection:ReadSelection=chunk?.target==='block'?{blockId:chunk.blockId}:{};
  return <main aria-label="Saved Notebook content" aria-busy={busy}>
    <header><h1>{entry?.title||'Notebook Inspector'}</h1>{entry&&<Badge>Revision {entry.revision}</Badge>}</header>
    {error&&<Feedback kind="error">{error}{retry&&<Button variant="link" busy={busy} onClick={()=>void read(retry)}>Retry read</Button>}</Feedback>}
    {!entry&&!error&&<p role="status">Connecting to the saved entry…</p>}
    {entry&&<>
      <p className="notebook-inspector-meta">Saved notebook · {new Date(entry.updatedAt).toLocaleString(locale)}</p>
      <nav aria-label="Saved entry views">
        {(block||index||chunk)&&<Button variant="ghost" busy={busy} onClick={()=>void read({})}>Read saved entry</Button>}
        <Button variant="ghost" busy={busy} onClick={()=>void read({view:'index'})}>Browse blocks</Button>
      </nav>
      {busy&&<p role="status">Reading this revision…</p>}
      {index&&<><p className="notebook-inspector-meta">{index.blocks.length?`Blocks ${index.offset+1}–${index.offset+index.blocks.length} of ${index.totalBlocks}`:'This revision has no addressable blocks.'}</p>
        <Table label="Saved blocks" rows={index.blocks} rowId={row=>row.blockId} columns={[
          {id:'type',header:'Block',cell:row=>row.type},
          {id:'open',header:'Content',cell:row=><Button busy={busy} onClick={()=>void read({blockId:row.blockId})}>Read {row.blockId}</Button>},
        ]}/>
        {index.nextOffset!==null&&<Button busy={busy} onClick={()=>void read({view:'index',offset:index.nextOffset!})}>Read next part</Button>}
      </>}
      {'document' in entry&&entry.document.content.content.map((node,index)=><article key={index}><Block value={node}/></article>)}
      {block&&<Block value={block}/>}
      {chunk&&<>
        <p className="notebook-inspector-meta">{chunk.target==='block'?`Block ${chunk.blockId}`:'Saved document'} · characters {chunk.offset+1}–{chunk.nextOffset??chunk.totalCharacters} of {chunk.totalCharacters}. This is a JSON fragment.</p>
        <pre>{chunk.content}</pre>
        <nav aria-label="Saved content pages">
          {chunk.offset>0&&<Button busy={busy} onClick={()=>void read({...chunkSelection,offset:0})}>Read first part</Button>}
          {chunk.nextOffset!==null&&<Button busy={busy} onClick={()=>void read({...chunkSelection,offset:chunk.nextOffset!})}>Read next part</Button>}
        </nav>
      </>}
      <Disclosure summary="Source identity"><pre>{entry.id} · revision {entry.revision}{'\n'}Saved {entry.updatedAt}</pre></Disclosure>
    </>}
  </main>;
}
const root=createRoot(document.getElementById('app')!);
root.render(<Inspector/>);
