/** Explicit Host capability, never a global fetch override or backend credential. */
export async function automationRequest<T>(method:string,path:string,body:unknown=null,signal?:AbortSignal):Promise<T> {
  if(!/^\/api\/automations(?:\/[^/?#]+(?:\/run)?)?$/.test(path))throw new Error('Unsupported automation path');
  const response=await fetch('/host/automation',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({method,path,body}),signal});
  const value=await response.json();
  if(!response.ok)throw new Error(value.error||`Host HTTP ${response.status}`);
  if(!Number.isInteger(value.status))throw new Error('Invalid Host response');
  if(value.status<200||value.status>=300)throw new Error(value.body?.error||`Automation HTTP ${value.status}`);
  return value.body as T;
}
export function openSession(sessionId:string) {
  if(!sessionId||sessionId.length>256)throw new Error('Invalid session');
  window.parent.postMessage({type:'pero:app:open-session',sessionId},'*');
}
