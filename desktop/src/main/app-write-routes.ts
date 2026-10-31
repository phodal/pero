import { resolve } from 'node:path';
import type { AppAccess, AppRecord } from '../../../protocol/generated/host';
import { readPointApp, pointTarget, pointHeaders, pointWrites } from './point-apps.ts';
import { PreparedAppWrite, type AppWriteDefinition } from './app-write.ts';

/** Installed routes are resolved by Host; both shells use the same write boundary. */
export class AppWriteRoutes {
  constructor(
    private request: <T>(action: string, fields?: Record<string, unknown>) => Promise<T>,
    private send: (event: {version:number;kind:string;request_id:null;text:string;data:unknown}) => void | Promise<unknown>,
    private fetch: (url:string, init:RequestInit) => Promise<Response>,
    private installedRoot?: string,
  ) {}
  async describe():Promise<AppWriteDefinition[]>{
    const records=await this.request<AppRecord[]>('list');
    const routes: AppWriteDefinition[] = [];
    for (const record of records.filter(record => record.enabled)) {
      routes.push(...(record.writes || []).map(route => ({ app: record.name, panel: record.panels[0].id, version: record.version, ...route })));
      const point = this.installedRoot ? await readPointApp(resolve(this.installedRoot, record.name)) : null;
      if (point) routes.push(...pointWrites(point, record.panels[0].id));
    }
    return routes;
  }
  async apply(prepared:PreparedAppWrite,signal:AbortSignal,goal?:import('./control-lab-goal.ts').ControlLabGoal):Promise<unknown>{
    const route=prepared.definition;prepared.requireCurrent((await this.describe()).find(current=>current.app===route.app&&current.name===route.name));
    const access=await this.request<AppAccess>('resolve',{name:route.app});
    if(!access.backend)throw new Error('The App write backend is unavailable');
    if(route.app==='control-lab'&&route.path==='/api/agent-step'&&!goal)throw new Error('Control Lab goal is required');
    const body=goal?{...(prepared.document as Record<string,unknown>),specHash:goal.specHash}:prepared.document;
    const point = await readPointApp(access.root);
    const encoded = JSON.stringify(body), method = route.method || 'POST';
    const headers = point ? pointHeaders(access.backend.token, method, pointTarget(point, `/apps/${route.app}${route.path}`), Buffer.from(encoded)) : { 'X-Pero-App-Token': access.backend.token };
    const response=await this.fetch(access.backend.url+route.path,{method,headers:{'Content-Type':'application/json',...headers},body:encoded,redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(15000)])});
    const text=await response.text();if(Buffer.byteLength(text)>1000000)throw new Error('App write response exceeds 1 MiB');
    if(!response.ok)throw new Error(text.slice(0,1000)||`App write failed (${response.status})`);
    const value=JSON.parse(text);await this.send({version:1,kind:'app_written',request_id:null,text:'',data:{app:route.app,tool:route.name,digest:prepared.digest}});return value;
  }

}
