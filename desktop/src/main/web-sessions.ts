import {readFile,writeFile,rename,mkdir} from 'node:fs/promises';
import {dirname} from 'node:path';
import type {NavigationEntry,WebContents} from 'electron';
import {WebLocation} from '../../../packages/content-source/web-location.ts';

export type WebPageState={url:string;scroll:[number,number];fields:{index:number;tag:string;id:string;name:string;value:string;checked?:boolean}[]};
export type WebEngineSession={entries:NavigationEntry[];index:number;page?:WebPageState};

/** Chromium owns opaque history state; only the engine shell persists it. */
export class WebSessions {
  private saved=new Map<string,WebEngineSession>();
  private path:string;
  constructor(path:string){this.path=path;}
  async load() {
    let text:string;
    try {text=await readFile(this.path,'utf8');}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return;throw error;}
    const value:unknown=JSON.parse(text);
    if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid saved browser session');
    for(const [id,entry] of Object.entries(value)) {
      const state=entry as WebEngineSession;
      if(!state||!Array.isArray(state.entries)||!Number.isInteger(state.index)||state.index<0||state.index>=state.entries.length||
        state.entries.some(item=>!item||typeof item.url!=='string'||typeof item.title!=='string'||item.pageState!==undefined&&typeof item.pageState!=='string'))throw new Error('Invalid saved browser history');
      for(const entry of state.entries)WebLocation.parse(entry.url);
      if(state.page&&(!Array.isArray(state.page.scroll)||state.page.scroll.length!==2||!state.page.scroll.every(Number.isFinite)||typeof state.page.url!=='string'||!Array.isArray(state.page.fields)||
        state.page.fields.some(field=>!Number.isInteger(field.index)||field.index<0||!['INPUT','TEXTAREA','SELECT'].includes(field.tag)||!['id','name','value'].every(key=>typeof field[key as 'id'|'name'|'value']==='string')||field.checked!==undefined&&typeof field.checked!=='boolean')))throw new Error('Invalid saved browser form state');
      this.saved.set(id,state);
    }
  }
  get(id:string){return this.saved.get(id);}
  async save(pages:Map<string,WebContents>) {
    const sessions:Record<string,WebEngineSession>={};
    for(const [id,contents] of pages) {
      if(contents.isDestroyed()||!contents.navigationHistory.length)continue;
      const state:WebEngineSession={entries:contents.navigationHistory.getAllEntries(),index:contents.navigationHistory.getActiveIndex()};
      // Password/file inputs remain solely in Chromium's live document.
      if(!contents.isLoadingMainFrame())state.page=await contents.executeJavaScript(`(${capturePage.toString()})()`);
      sessions[id]=state;
    }
    await mkdir(dirname(this.path),{recursive:true});
    await writeFile(this.path+'.tmp',JSON.stringify(sessions),{mode:0o600});
    await rename(this.path+'.tmp',this.path);
    this.saved=new Map(Object.entries(sessions));
  }
}
function capturePage():WebPageState {
  const controls=document.querySelectorAll<HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement>('input,textarea,select');
  return {url:location.href,scroll:[scrollX,scrollY],fields:Array.from(controls).flatMap((field,index)=>{
    if(field instanceof HTMLInputElement&&['password','file'].includes(field.type))return [];
    return [{index,tag:field.tagName,id:field.id,name:field.name,value:field.value,...(field instanceof HTMLInputElement?{checked:field.checked}:{})}];
  })};
}
export function restorePage(state:WebPageState):void {
  if(location.href!==state.url)return;
  const controls=document.querySelectorAll<HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement>('input,textarea,select');
  for(const saved of state.fields) {
    const field=controls[saved.index];
    if(!field||field.tagName!==saved.tag||field.id!==saved.id||field.name!==saved.name||field instanceof HTMLInputElement&&['password','file'].includes(field.type))continue;
    field.value=saved.value;
    if(field instanceof HTMLInputElement&&saved.checked!==undefined)field.checked=saved.checked;
  }
  scrollTo(...state.scroll);
}
