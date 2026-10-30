import init, {analyze_json} from './content-wasm/pero_content_worker';
const ready=init();
const worker=globalThis as unknown as {
  onmessage:((event:MessageEvent<{id:number;text:string}>)=>void)|null;
  postMessage(value:unknown,transfer:Transferable[]):void;
};
worker.onmessage=async({data})=>{
  try {
    await ready;
    const tape=analyze_json(data.text);
    worker.postMessage({id:data.id,tape},[tape.buffer as ArrayBuffer]);
  } catch(error) {worker.postMessage({id:data.id,error:String(error)},[]);}
};
