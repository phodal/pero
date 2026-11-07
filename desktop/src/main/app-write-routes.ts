import type { AppAccess, AppRecord } from '../../../protocol/generated/host';
import { PaperSourceImage, SOURCE_IMAGE_RESPONSE_BYTES } from './paper-source-image.ts';
import { PreparedAppWrite, type AppWriteDefinition } from './app-write.ts';

/** Installed routes are resolved by Host; both shells use the same write boundary. */
export class AppWriteRoutes {
  constructor(
    private request: <T>(action: string, fields?: Record<string, unknown>) => Promise<T>,
    private send: (event: {version:number;kind:string;request_id:null;text:string;data:unknown}) => void | Promise<unknown>,
    private fetch: (url:string, init:RequestInit) => Promise<Response>,
  ) {}
  async describe():Promise<AppWriteDefinition[]>{
    const records=await this.request<AppRecord[]>('list');
    const routes: AppWriteDefinition[] = [];
    for (const record of records.filter(record => record.enabled)) {
      routes.push(...(record.writes || []).map(route => ({ app: record.name, panel: record.panels[0].id, version: record.version, revision: record.revision, ...route })));
    }
    return routes;
  }
  async apply(prepared:PreparedAppWrite,signal:AbortSignal,goal?:import('./control-lab-goal.ts').ControlLabGoal,caller?:{threadId:string;operationId:string}):Promise<unknown>{
    const route=prepared.definition;prepared.requireCurrent((await this.describe()).find(current=>current.app===route.app&&current.name===route.name));
    if (route.app === 'paper-agent' && route.path === '/api/programs/agent') {
      if (!caller) throw new Error('Research requires the actual Host caller');
      signal.throwIfAborted();
      const value = await this.request<{unbound?:boolean}>('research-program', {name:route.app,...caller,tool:route.name,request:prepared.document});
      if (!value?.unbound) {
        await this.send({version:1,kind:'app_written',request_id:null,text:'',data:{app:route.app,tool:route.name,digest:prepared.digest}});
        return value;
      }
    }
    if (route.app === 'paper-agent' && route.path === '/api/research/assets') {
      signal.throwIfAborted();
      const deadline = AbortSignal.any([signal, AbortSignal.timeout(15000)]);
      const value = await new Promise<unknown>((resolve, reject) => {
        // Cancelling the wait cannot roll back an already-dispatched Host action.
        const interrupted = () => reject(new Error('Research handoff interrupted after dispatch. Check status and cancel the asset if needed.', { cause: deadline.reason }));
        deadline.addEventListener('abort', interrupted, { once: true });
        this.request('research-assets', { name: route.app, request: prepared.document })
          .then(resolve, reject).finally(() => deadline.removeEventListener('abort', interrupted));
      });
      const text = JSON.stringify(value);
      if (!text || Buffer.byteLength(text) > 1000000) throw new Error('App write response exceeds 1 MiB');
      await this.send({ version: 1, kind: 'app_written', request_id: null, text: '', data: { app: route.app, tool: route.name, digest: prepared.digest } });
      return value;
    }
    const access=await this.request<AppAccess>('resolve',{name:route.app});
    if(!access.backend)throw new Error('The App write backend is unavailable');
    if((route.app==='control-lab'||route.app==='lab')&&route.path==='/api/agent-step'&&(!goal||goal.app!==route.app))throw new Error('Bound research App goal is required');
    const body=goal?{...(prepared.document as Record<string,unknown>),specHash:goal.specHash}:prepared.document;
    const encoded = JSON.stringify(body), method = route.method || 'POST';
    const headers = { 'X-Pero-App-Token': access.backend.token };
    const response=await this.fetch(access.backend.url+route.path,{method,headers:{'Content-Type':'application/json',...headers},body:encoded,redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(15000)])});
    let text: string;
    if (PaperSourceImage.accepts(prepared)) {
      const reader = response.body?.getReader(), chunks: Uint8Array[] = []; let size = 0;
      if (!reader) throw new Error('Source image response body is unavailable');
      try {
        while (true) {
          const part = await reader.read(); if (part.done) break;
          size += part.value.byteLength;
          if (size > SOURCE_IMAGE_RESPONSE_BYTES) throw new Error('Source image response exceeds its bounded PNG envelope');
          chunks.push(part.value);
        }
        text = Buffer.concat(chunks).toString('utf8');
      } finally { await reader.cancel(); reader.releaseLock(); }
    } else {
      text=await response.text();if(Buffer.byteLength(text)>1000000)throw new Error('App write response exceeds 1 MiB');
    }
    if(!response.ok)throw new Error(text.slice(0,1000)||`App write failed (${response.status})`);
    const value=JSON.parse(text);await this.send({version:1,kind:'app_written',request_id:null,text:'',data:{app:route.app,tool:route.name,digest:prepared.digest}});return value;
  }

}
