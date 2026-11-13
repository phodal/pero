/** Geometry comes from the rendered tool row; URLs come from the admitted Host result. */
export type McpAppSurface={reset?:boolean;thread_id?:string;tool_call?:string;url?:string;visible?:boolean;left?:number;top?:number;width?:number;height?:number;clip?:number[];dark?:boolean;locale?:string};
export function mountMcpSurfaces(){
  type Frame={region:HTMLElement;frame:HTMLIFrameElement;url:string;context:{theme:string;locale:string};contextKey:string};
  const frames=new Map<string,Frame>();
  const context=(entry:Frame)=>{
    const key=JSON.stringify(entry.context);if(key===entry.contextKey)return;
    entry.contextKey=key;
    entry.frame.contentWindow?.postMessage({type:'pero:mcp:context',context:entry.context},new URL(entry.url).origin);
  };
  const update=(surface:McpAppSurface)=>{
    if(surface.reset){for(const {region} of frames.values())region.hidden=true;return;}
    if(!surface.thread_id||!surface.tool_call||!surface.url)return;
    const key=`${surface.thread_id}/${surface.tool_call}`;
    let entry=frames.get(key);
    if(!entry){
      const region=document.createElement('section');region.setAttribute('aria-label','Interactive tool result');
      region.style.cssText='position:fixed;z-index:3;overflow:hidden;background:var(--pero-surface)';
      const frame=document.createElement('iframe');frame.title='Interactive tool result';frame.sandbox.add('allow-scripts','allow-same-origin');frame.referrerPolicy='no-referrer';
      frame.style.cssText='display:block;width:100%;height:100%;border:0';region.append(frame);document.body.append(region);
      entry={region,frame,url:'',context:{theme:surface.dark?'dark':'light',locale:surface.locale||'en'},contextKey:''};frames.set(key,entry);
      const retained=entry;
      frame.addEventListener('load',()=>{retained.contextKey='';context(retained);});
    }
    if(entry.url!==surface.url){entry.url=surface.url;entry.frame.src=surface.url;}
    entry.region.hidden=!surface.visible;
    entry.context={theme:surface.dark?'dark':'light',locale:surface.locale||'en'};context(entry);
    Object.assign(entry.region.style,{left:`${surface.left}px`,top:`${surface.top}px`,width:`${surface.width}px`,height:`${surface.height}px`,clipPath:surface.clip?`inset(${surface.clip.map(value=>`${value}px`).join(' ')})`:''});
  };
  return {update,observe(event:{kind:string;thread_id?:string}){
    if(!['session_closed','session_deleted','disconnected'].includes(event.kind))return;
    for(const [key,entry] of frames)if(event.kind==='disconnected'||key.startsWith(`${event.thread_id}/`)){entry.region.remove();frames.delete(key);}
  },dispose(){for(const {region}of frames.values())region.remove();frames.clear();}};
}
declare global {interface Window {peroMcpAppSurface(json:string):void;}}
