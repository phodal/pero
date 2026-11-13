/** Explicit Host capability, never a global fetch override or backend credential. */
export const automationHostFailure='Automation host unavailable';
export async function automationRequest<T>(method:string,path:string,body:unknown=null,signal?:AbortSignal):Promise<T> {
  if(!/^\/api\/automations(?:\/[^/?#]+(?:\/run)?)?$/.test(path))throw new Error('Unsupported automation path');
  let response:Response;
  try{response=await fetch('/host/automation',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({method,path,body}),signal});}
  catch{throw new Error(automationHostFailure);}
  let value:any;
  try{value=JSON.parse((await response.text())||'null');}catch{throw new Error(automationHostFailure);}
  if(!response.ok){
    const domain=typeof value?.body?.error==='string'&&value.body.error||typeof value?.error==='string'&&value.error;
    throw new Error(domain||automationHostFailure);
  }
  if(!value||typeof value!=='object'||!Number.isInteger(value.status))throw new Error('Invalid Host response');
  if(value.status<200||value.status>=300)throw new Error(value.body?.error||`Automation HTTP ${value.status}`);
  return value.body as T;
}
export function openSession(sessionId:string) {
  if(!sessionId||sessionId.length>256)throw new Error('Invalid session');
  window.parent.postMessage({type:'pero:app:open-session',sessionId},'*');
}
