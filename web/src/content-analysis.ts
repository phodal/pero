/** One real Worker per renderer. Content and execution authority stay in their owners. */
export function installContentAnalysis() {
  let worker:Worker|undefined,nextId=0;
  const pending=new Map<number,{preview:boolean;resolve(tape:Uint32Array):void;reject(error:Error):void}>();
  const stats={requests:0,completed:0,failures:0,previewRequests:0,previewCompleted:0,previewFailures:0};
  const stop=(error:Error)=>{
    worker?.terminate();worker=undefined;
    for(const request of pending.values())request.reject(error);
    pending.clear();
  };
  window.peroContentAnalysisStats=stats;
  const analyze=(text:string,preview:boolean,jsonLines=false,revision=0n)=>new Promise<Uint32Array>((resolve,reject)=>{
    if(!worker) {
      worker=new Worker(new URL('./content-analysis.worker.ts',import.meta.url),{type:'module'});
      worker.onmessage=({data}:{data:{id:number;tape?:Uint32Array;error?:string}})=>{
        const request=pending.get(data.id);if(!request)return;pending.delete(data.id);
        if(data.error||!data.tape){
          stats[request.preview?'previewFailures':'failures']++;
          request.reject(new Error(data.error||'Missing content analysis result'));
        }
        else {stats[request.preview?'previewCompleted':'completed']++;request.resolve(data.tape);}
      };
      worker.onerror=()=>{
        for(const request of pending.values())stats[request.preview?'previewFailures':'failures']++;
        stop(new Error('Content analysis Worker failed'));
      };
    }
    const id=++nextId;stats[preview?'previewRequests':'requests']++;
    pending.set(id,{preview,resolve,reject});worker.postMessage({id,text,preview,jsonLines,revision});
  });
  window.peroAnalyzeJson=(text:string)=>analyze(text,false);
  window.peroAnalyzePreview=(text:string,jsonLines:boolean,revision:bigint)=>analyze(text,true,jsonLines,revision);
  window.addEventListener('pagehide',()=>stop(new Error('Content view closed')),{once:true});
}
declare global {
  interface Window {
    peroAnalyzeJson(text:string):Promise<Uint32Array>;
    peroAnalyzePreview(text:string,jsonLines:boolean,revision:bigint):Promise<Uint32Array>;
    peroContentAnalysisStats:{requests:number;completed:number;failures:number;previewRequests:number;previewCompleted:number;previewFailures:number};
  }
}
