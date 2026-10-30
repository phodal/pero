/** One real Worker per renderer. Content and execution authority stay in their owners. */
export function installContentAnalysis() {
  let worker:Worker|undefined,nextId=0;
  const pending=new Map<number,{resolve(tape:Uint32Array):void;reject(error:Error):void}>();
  const stats={requests:0,completed:0,failures:0};
  const stop=(error:Error)=>{
    worker?.terminate();worker=undefined;
    for(const request of pending.values())request.reject(error);
    pending.clear();
  };
  window.peroContentAnalysisStats=stats;
  window.peroAnalyzeJson=(text:string)=>new Promise<Uint32Array>((resolve,reject)=>{
    if(!worker) {
      worker=new Worker(new URL('./content-analysis.worker.ts',import.meta.url),{type:'module'});
      worker.onmessage=({data}:{data:{id:number;tape?:Uint32Array;error?:string}})=>{
        const request=pending.get(data.id);if(!request)return;pending.delete(data.id);
        if(data.error||!data.tape){stats.failures++;request.reject(new Error(data.error||'Missing syntax result'));}
        else {stats.completed++;request.resolve(data.tape);}
      };
      worker.onerror=()=>{stats.failures++;stop(new Error('Content analysis Worker failed'));};
    }
    const id=++nextId;stats.requests++;pending.set(id,{resolve,reject});worker.postMessage({id,text});
  });
  window.addEventListener('pagehide',()=>stop(new Error('Content view closed')),{once:true});
}
declare global {
  interface Window {
    peroAnalyzeJson(text:string):Promise<Uint32Array>;
    peroContentAnalysisStats:{requests:number;completed:number;failures:number};
  }
}
