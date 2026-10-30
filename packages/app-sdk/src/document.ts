import {AppDocuments, type AppDocumentInput} from '../../content-source/app-document';
import {mountReaderSurface} from './reader-surface';
import {normalizeLocale,translate} from '../../../locales';
import type {ReaderContext} from './reader-surface';
export type { AppDocumentInput };

let standalone:ReturnType<typeof mountReaderSurface>|undefined;
let standalonePanel:HTMLDialogElement|undefined;
let standaloneTitle:HTMLElement|undefined;
export const standaloneDocuments=new AppDocuments('standalone','content');

/** Opens source in the owning reader. It never submits an Agent prompt. */
export function openDocument(document:AppDocumentInput):Promise<void> {
  if(window.parent===window){
    const source=standaloneDocuments.admit(document);
    const locale=normalizeLocale(window.document.documentElement.lang),dark=getComputedStyle(window.document.documentElement).colorScheme==='dark';
    if(!standalonePanel){
      const panel=window.document.createElement('dialog');panel.className='pero-standalone-document';
      const header=window.document.createElement('header'),title=window.document.createElement('strong'),close=window.document.createElement('button');
      title.id='pero-document-title';panel.setAttribute('aria-labelledby',title.id);title.textContent=document.title;
      close.type='button';close.textContent=translate(locale,'workspace.close_tab');close.onclick=()=>panel.close();
      header.append(title,close);const body=window.document.createElement('div');body.className='pero-standalone-document-body';panel.append(header,body);
      window.document.body.append(panel);standalonePanel=panel;standaloneTitle=title;
      const contextChanged=(event:Event)=>standalone?.context((event as CustomEvent<ReaderContext>).detail);
      window.addEventListener('pero:app:context-changed',contextChanged);
      panel.addEventListener('close',()=>{window.removeEventListener('pero:app:context-changed',contextChanged);standalone?.dispose();standalone=undefined;panel.remove();standalonePanel=undefined;standaloneTitle=undefined;},{once:true});
      standalone=mountReaderSurface(body,{source,context:{locale,dark},url:'./_reader/reader.html',link:url=>window.open(url,'_blank','noopener')});
      panel.showModal();
    }else{standaloneTitle!.textContent=document.title;standalone!.source(source);}
    return Promise.resolve();
  }
  return new Promise((resolve,reject)=> {
    const id=crypto.randomUUID();
    const receive=(event:MessageEvent)=> {
      if(event.source!==window.parent || event.data?.type!=='pero:app:document-result' || event.data.id!==id)return;
      clearTimeout(timer);window.removeEventListener('message',receive);
      if(event.data.ok===true)resolve();else reject(new Error(event.data.error||'Could not open the document'));
    };
    const timer=setTimeout(()=>{window.removeEventListener('message',receive);reject(new Error('The Workbench did not answer. Retry opening the document.'));},15000);
    window.addEventListener('message',receive);
    window.parent.postMessage({type:'pero:app:document',id,document},'*');
  });
}
