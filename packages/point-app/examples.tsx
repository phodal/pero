import React,{useEffect,useState,useRef} from 'react';
import {Button,Dialog,DropdownMenu,DropdownMenuTrigger,DropdownMenuContent,DropdownMenuItem,DropdownMenuSeparator} from 'point-sdk-ui';

/** The controller stays with the App. The shell owns titlebar presentation. */
export function PointExamples({controller,state,entries,locale,titlebar}:{controller:any;state:any;entries:any[];locale:string;titlebar:boolean}) {
  const [details,setDetails]=useState(false);
  const pending=useRef<any>(null);
  const language=locale.startsWith('zh')?'zh':'en';
  const labels=language==='zh'?{examples:'示例',source:'示例来源',retry:'重试',close:'关闭'}:{examples:'Examples',source:'Example source',retry:'Retry',close:'Close'};
  const title=(entry:any)=>entry.localizations?.[language]?.title??entry.title;
  useEffect(()=>{
    window.parent.postMessage({type:'pero:app:examples',state:{entries:entries.map(entry=>({id:entry.id,title:title(entry)})),ready:state.ready,busy:state.busy,selectedId:state.selected?.id??null,source:!!state.selected?.source,error:state.error??''}},'*');
  },[state,locale]);
  const act=(request:any)=>{
    if(!controller.getSnapshot().ready){pending.current=request;return;}
    if(request.action==='source'){if(controller.getSnapshot().selected?.source)setDetails(true);return;}
    const pending=request.action==='retry'?controller.retry():request.action==='load'?controller.load(request.id):undefined;
    // Controller retains the visible error and its retry state.
    if(pending)void pending.catch(()=>{});
  };
  useEffect(()=>controller.subscribe(()=>{if(controller.getSnapshot().ready&&pending.current){const request=pending.current;pending.current=null;act(request);}}),[controller]);
  useEffect(()=>{
    const receive=(event:MessageEvent)=>{if(event.source===window.parent&&event.data?.type==='pero:app:example')act(event.data);};
    window.addEventListener('message',receive);return()=>window.removeEventListener('message',receive);
  },[controller]);
  const source=state.selected?.source;
  const safeLink=(value:string)=>{try{const url=new URL(value);return ['http:','https:'].includes(url.protocol)?url.href:undefined;}catch{return undefined;}};
  return <>
    {!titlebar&&entries.length>0&&<div style={{display:'flex',justifyContent:'flex-end',flexShrink:0,padding:'4px 12px'}}><DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" disabled={!state.ready||state.busy}>{labels.examples}⌄</Button></DropdownMenuTrigger><DropdownMenuContent align="end">
      {entries.map(entry=><DropdownMenuItem key={entry.id} onSelect={()=>act({action:'load',id:entry.id})}>{title(entry)}</DropdownMenuItem>)}
      <DropdownMenuSeparator/><DropdownMenuItem disabled={!source} onSelect={()=>setDetails(true)}>{labels.source}</DropdownMenuItem>
      {state.error&&<DropdownMenuItem onSelect={()=>act({action:'retry'})}>{labels.retry}</DropdownMenuItem>}
    </DropdownMenuContent></DropdownMenu></div>}
    {details&&source&&<Dialog title={`${labels.source} · ${source.title?.[language]||state.selected.id}`} closeLabel={labels.close} onClose={()=>setDetails(false)}>
      <p>{source.description?.[language]}</p><p><a href={safeLink(source.sourceUrl)} target="_blank" rel="noreferrer">{source.source}</a> · <a href={safeLink(source.licenseUrl)} target="_blank" rel="noreferrer">{source.license}</a> · {source.retrievedAt}</p>
      <p>{source.citation}</p><p>{source.transformations?.[language]}</p><p>{source.notes?.[language]}</p>
    </Dialog>}
  </>;
}
