import type { AppDocumentInput } from '../../content-source/app-document';
export type { AppDocumentInput };

/** Opens source in the owning Workbench. It never submits an Agent prompt. */
export function openDocument(document:AppDocumentInput):Promise<void> {
  if(window.parent===window)return Promise.reject(new Error('Open this App in the Pero Workbench to use workspace documents.'));
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
