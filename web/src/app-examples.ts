import {receive_host_event} from './wasm/pero_ui';
type Scope={app:string;panel:string};
declare global {interface Window {peroAppExample(json:string):void}}
/** The managed iframe owns imports; the shell only presents its titlebar menu. */
export function mountAppExamples(send:(scope:Scope,request:object)=>void) {
  window.peroAppExample=json=>{const {scope,...request}=JSON.parse(json);send(scope,{type:'pero:app:example',...request});};
  return (scope:Scope,state:unknown)=>receive_host_event(JSON.stringify({version:1,kind:'app_examples',request_id:null,text:'',data:{scope,state}}));
}
