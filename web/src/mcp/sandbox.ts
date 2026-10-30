const query=new URL(location.href).searchParams;
const host=query.get('host'),binding=query.get('binding');
if(!host||!binding||window.parent===window||new URL(host).origin===location.origin)throw new Error('Invalid MCP sandbox origin');
const inner=document.createElement('iframe');
inner.style.cssText='width:100%;height:100vh;border:0;display:block';
inner.sandbox.add('allow-scripts','allow-same-origin','allow-forms');
inner.referrerPolicy='no-referrer';document.body.append(inner);
window.addEventListener('message',event=>{
  if(event.source===window.parent&&event.origin===host){
    if(event.data?.method==='ui/notifications/sandbox-resource-ready'){
      // The privileged provider serves this exact bound HTML with immutable HTTP CSP.
      inner.src=`/resource?binding=${encodeURIComponent(binding)}`;
    }else if(!String(event.data?.method||'').startsWith('ui/notifications/sandbox-'))inner.contentWindow?.postMessage(event.data,location.origin);
  }else if(event.source===inner.contentWindow&&event.origin===location.origin&&
    !String(event.data?.method||'').startsWith('ui/notifications/sandbox-'))window.parent.postMessage(event.data,host);
});
window.parent.postMessage({jsonrpc:'2.0',method:'ui/notifications/sandbox-proxy-ready',params:{}},host);
export {};
