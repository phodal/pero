import {App} from '@modelcontextprotocol/ext-apps';
const app=new App({name:'Pero MCP fixture',version:'1.0.0'},{},{autoResize:false});
const heading=document.createElement('h1');heading.id='input';heading.textContent='Connecting';
const output=document.createElement('p');output.id='result';
const button=document.createElement('button');button.id='increment';button.textContent='Increment';
const state=document.createElement('p');state.id='interaction';
document.body.append(heading,output,button,state);
app.ontoolinput=({arguments:input})=>{heading.textContent=String(input?.label||'No label');};
app.ontoolresult=result=>{output.textContent=String(result.structuredContent?.label||'No result');};
app.onteardown=async()=>{document.body.dataset.teardown='complete';return {};};
button.onclick=()=>{void app.callServerTool({name:'increment',arguments:{by:2}}).then(result=>{state.textContent=String(result.structuredContent?.counter);});};
try {void window.top!.document.body;document.body.dataset.hostAccess='allowed';}catch {document.body.dataset.hostAccess='denied';}
document.addEventListener('securitypolicyviolation',()=>{document.body.dataset.csp='blocked';});
void app.connect().then(()=>{document.body.dataset.initialized='true';void fetch('http://127.0.0.1:9/blocked').catch(()=>{});});
