/** One real Worker per renderer. Content and execution authority stay in their owners. */
export function installContentAnalysis() {
  let worker:Worker|undefined,nextId=0;
  type AnalysisKind='syntax'|'preview'|'node'|'projection';
  const pending=new Map<number,{kind:AnalysisKind;resolve(tape:Uint32Array):void;reject(error:Error):void}>();
  const stats={requests:0,completed:0,failures:0,previewRequests:0,previewCompleted:0,previewFailures:0,
    projectionRequests:0,projectionCompleted:0,projectionFailures:0,nodeRequests:0,nodeCompleted:0,nodeFailures:0};
  const counters={syntax:['requests','completed','failures'],preview:['previewRequests','previewCompleted','previewFailures'],
    node:['nodeRequests','nodeCompleted','nodeFailures'],
    projection:['projectionRequests','projectionCompleted','projectionFailures']} as const;
  const stop=(error:Error)=>{
    worker?.terminate();worker=undefined;
    for(const request of pending.values())request.reject(error);
    pending.clear();
  };
  const ensureWorker=()=>{
    if(!worker) {
      worker=new Worker(new URL('./content-analysis.worker.ts',import.meta.url),{type:'module'});
      worker.onmessage=({data}:{data:{id:number;tape?:Uint32Array;error?:string}})=>{
        const request=pending.get(data.id);if(!request)return;pending.delete(data.id);
        if(data.error||!data.tape){
          stats[counters[request.kind][2]]++;
          request.reject(new Error(data.error||'Missing content analysis result'));
        }
        else {stats[counters[request.kind][1]]++;request.resolve(data.tape);}
      };
      worker.onerror=()=>{
        for(const request of pending.values())stats[counters[request.kind][2]]++;
        stop(new Error('Content analysis Worker failed'));
      };
    }
    return worker;
  };
  const analyze=(kind:AnalysisKind,payload:object)=>new Promise<Uint32Array>((resolve,reject)=>{
    const active=ensureWorker(),id=++nextId;stats[counters[kind][0]]++;
    pending.set(id,{kind,resolve,reject});active.postMessage({id,kind,...payload});
  });
  window.peroContentAnalysisStats=stats;
  window.peroAnalyzeJson=(text:string)=>analyze('syntax',{text});
  window.peroAnalyzePreview=(text:string,jsonLines:boolean,revision:bigint)=>analyze('preview',{text,jsonLines,revision});
  window.peroAnalyzeNode=(text:string,start:number,end:number,revision:bigint)=>analyze('node',{text,start,end,revision});
  // The table seeds its immutable source once. Only specs and row identities cross thereafter.
  window.peroCreateTableProjection=(text:string,tape:Uint32Array)=>{
    const source=++nextId;
    ensureWorker().postMessage({id:source,kind:'seed',source,text,tape},[tape.buffer as ArrayBuffer]);
    return source;
  };
  window.peroProjectTable=(source:number,filter:string,column:number,descending:boolean)=>
    analyze('projection',{source,filter,column,descending});
  window.peroReleaseTableProjection=(source:number)=>worker?.postMessage({kind:'release',source});
  window.addEventListener('pagehide',()=>stop(new Error('Content view closed')),{once:true});
}
declare global {
  interface Window {
    peroAnalyzeJson(text:string):Promise<Uint32Array>;
    peroAnalyzePreview(text:string,jsonLines:boolean,revision:bigint):Promise<Uint32Array>;
    peroAnalyzeNode(text:string,start:number,end:number,revision:bigint):Promise<Uint32Array>;
    peroCreateTableProjection(text:string,tape:Uint32Array):number;
    peroProjectTable(source:number,filter:string,column:number,descending:boolean):Promise<Uint32Array>;
    peroReleaseTableProjection(source:number):void;
    peroContentAnalysisStats:{requests:number;completed:number;failures:number;previewRequests:number;previewCompleted:number;previewFailures:number;
      projectionRequests:number;projectionCompleted:number;projectionFailures:number;nodeRequests:number;nodeCompleted:number;nodeFailures:number};
  }
}
