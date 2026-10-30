import init, {analyze_json,analyze_preview,analyze_node,ProjectionSource} from './content-wasm/pero_content_worker';
const ready=init();
type AnalysisMessage={id:number}&(
  {kind:'syntax';text:string}|
  {kind:'preview';text:string;jsonLines:boolean;revision:bigint}|
  {kind:'node';text:string;start:number;end:number;revision:bigint}|
  {kind:'seed';source:number;text:string;tape:Uint32Array}|
  {kind:'projection';source:number;filter:string;column:number;descending:boolean}|
  {kind:'release';source:number}
);
// Explicitly table-owned: release removes both the Wasm object and its source/preview.
const sources=new Map<number,ProjectionSource|string>();
const worker=globalThis as unknown as {
  onmessage:((event:MessageEvent<AnalysisMessage>)=>void)|null;
  postMessage(value:unknown,transfer:Transferable[]):void;
};
worker.onmessage=async({data})=>{
  try {
    await ready;
    if(data.kind==='seed') {
      try {sources.set(data.source,new ProjectionSource(data.text,data.tape));}
      catch(error){sources.set(data.source,String(error));}
      return;
    }
    if(data.kind==='release') {
      const source=sources.get(data.source);
      if(source&&typeof source!=='string')source.free();
      sources.delete(data.source);return;
    }
    let tape:Uint32Array;
    if(data.kind==='syntax')tape=analyze_json(data.text);
    else if(data.kind==='node')tape=analyze_node(data.text,data.start,data.end,data.revision);
    else if(data.kind==='preview')tape=analyze_preview(data.text,data.jsonLines,data.revision);
    else {
      const source=sources.get(data.source);
      if(!source||typeof source==='string')throw new Error(source||'Table source is unavailable');
      tape=source.project(data.filter,data.column,data.descending);
    }
    worker.postMessage({id:data.id,tape},[tape.buffer as ArrayBuffer]);
  } catch(error) {worker.postMessage({id:data.id,error:String(error)},[]);}
};
