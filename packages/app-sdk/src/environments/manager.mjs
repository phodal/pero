import { METHODS } from './model.mjs';
const messages = locale => locale.startsWith('zh') ? {
 title:'执行环境', environments:'本机环境', inspect:'软件检查', create:'创建环境', createTitle:'创建本机环境', name:'环境名称', method:'方法', prepare:'准备环境', createPrepare:'创建并准备', bind:'使用此环境', back:'返回', refresh:'刷新', empty:'尚未创建本机环境', emptyNote:'创建一个环境，为方法安装所需软件。', loading:'正在读取环境…', created:'待准备', preparing:'准备中', ready:'准备完成', failed:'准备失败', status:'状态', usedBy:'用于', actions:'操作', details:'详情', dependencies:'Python 依赖', log:'安装日志', cancel:'取消', confirm:'绑定并重启', confirmTitle:'切换应用环境', confirmText:'将重启应用后端并停止其中的计算。请先保存工作。', shared:'Control 和 Circuit 共用 Control Lab 的环境。', native:'准备 Circuit 时会通过 Homebrew 安装 ngspice，并将该程序绑定到环境。', python:'Python 3.12', failedLoad:'环境列表无法读取', active:'当前使用', description:'环境名称用于区分同一方法的不同软件配置。'
} : {
 title:'Environments', environments:'Local environments', inspect:'Software checks', create:'Create environment', createTitle:'Create local environment', name:'Environment name', method:'Method', prepare:'Prepare environment', createPrepare:'Create and prepare', bind:'Use this environment', back:'Back', refresh:'Refresh', empty:'No local environments yet', emptyNote:'Create an environment to install the software a method needs.', loading:'Loading environments…', created:'Not prepared', preparing:'Preparing', ready:'Prepared', failed:'Preparation failed', status:'Status', usedBy:'Used by', actions:'Actions', details:'Details', dependencies:'Python dependencies', log:'Installation log', cancel:'Cancel', confirm:'Bind and restart', confirmTitle:'Switch App environment', confirmText:'This restarts the App backend and stops its calculations. Save your work first.', shared:'Control and Circuit share the Control Lab environment.', native:'Circuit preparation installs ngspice through Homebrew and binds the program to this environment.', python:'Python 3.12', failedLoad:'Could not load environments', active:'Currently in use', description:'Use a name that distinguishes this software configuration.'
};

/** The catalog owns navigation; task inspectors retain their existing read-only view. */
export function mountEnvironmentManager(root, options = {}) {
 const document=root.ownerDocument;
 let locale=options.locale || 'en', values=[], busy=false, loading=true, error='', selected=null, tab='environments', creating=false, confirming=false, logOpen=false, disposed=false, poll=null, inspector=null;
 let label='', target=METHODS[1].id, location=null;
 const node=(tag,text,className)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(className)el.className=className;return el;};
 const append=(parent,...children)=>{parent.append(...children.filter(Boolean));return parent;};
 function button(text,action,primary=false){const el=node('button',text,`env-button${primary?' env-primary':''}`);el.type='button';el.dataset.focus=text;el.disabled=busy;el.onclick=action;return el;}
 async function read(){const response=await fetch('/host/environment/profiles',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({operation:'list'})});if(!response.ok)throw Error((await response.text()).slice(0,1000));const result=await response.json();if(!Array.isArray(result))throw Error('Invalid environment catalog');return result;}
 async function request(input){
  busy=true;error='';if(input.operation==='prepare'){const value=values.find(v=>v.id===input.id);if(value)value.state='preparing';}render();
  try {
   const response=await fetch('/host/environment/profiles',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});
   if(!response.ok)throw Error((await response.text()).slice(0,1000));
   const result=await response.json();if(!Array.isArray(result))throw Error('Invalid environment catalog');
   const previous=new Set(values.map(v=>v.id));values=result;
   if(input.operation==='create'){
    selected=values.find(v=>!previous.has(v.id))?.id;creating=false;busy=false;render();
    if(selected)await request({operation:'prepare',id:selected});
   }
  }catch(e){error=e.message;}finally{busy=false;loading=false;render();}
 }
 const methodOf=value=>METHODS.find(m=>m.id===value.target);
 function status(value){return node('span',messages(locale)[value.state] || value.state,`env-status env-${value.state==='ready'?'matched':value.state==='failed'?'blocked':value.state==='preparing'?'checking':'unchecked'}`);}
 function facts(value){const t=messages(locale),method=methodOf(value);const list=node('dl',null,'env-facts');for(const [name,text] of [[t.method,method.name],['Python','3.12'],[t.usedBy,value.bound?method.app:'—']])list.append(append(node('div'),node('dt',name),node('dd',text)));return list;}
 function createForm(){
  const t=messages(locale),method=METHODS.find(m=>m.id===target);
  const form=node('form',null,'env-create-form');
  const name=node('input');name.id='env-name';name.required=true;name.maxLength=80;name.value=label;name.autocomplete='off';name.oninput=()=>{label=name.value;};
  const select=node('select');select.id='env-method';for(const m of METHODS){const option=node('option',m.name);option.value=m.id;select.append(option);}select.value=target;select.onchange=()=>{target=select.value;render();root.querySelector('#env-method')?.focus();};
  for(const [text,control] of [[t.name,name],[t.method,select]]){const field=node('label',text);field.htmlFor=control.id;form.append(append(node('div',null,'env-field'),field,control));}
  form.append(append(node('p',null,'env-recipe-summary'),node('strong',t.python),node('span',method.software)));
  if(method.app==='Control Lab')form.append(node('p',t.shared,'env-note'));
  if(target==='control-lab.ngspice')form.append(node('p',t.native,'env-warning'));
  const submitForm=()=>{if(!busy && name.reportValidity())void request({operation:'create',label:name.value,target:select.value});};
  const submit=button(t.createPrepare,submitForm,true);
  form.onsubmit=e=>{e.preventDefault();submitForm();};
  name.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();submitForm();}};
  form.append(append(node('footer',null,'env-form-actions'),button(t.cancel,()=>{creating=false;render();}),submit));root.append(form);
 }
 function detail(value){
  const t=messages(locale),method=methodOf(value);root.append(facts(value));
  if(method.app==='Control Lab')root.append(node('p',t.shared,'env-note'));
  if(value.error)root.append(node('p',value.error,'env-error'));
  if(value.state==='preparing'){
   const progress=node('p',value.log.filter(line=>!line.startsWith('WARN')).at(-1) || t.preparing,'env-progress');progress.setAttribute('role','status');root.append(progress);
  }
  if(confirming){
   const confirmation=node('section',null,'env-warning');confirmation.setAttribute('aria-label',t.confirmTitle);confirmation.append(node('strong',t.confirmTitle),node('p',t.confirmText));
   confirmation.append(append(node('div',null,'env-form-actions'),button(t.cancel,()=>{confirming=false;render();}),button(t.confirm,()=>{confirming=false;void request({operation:'bind',id:value.id});},true)));root.append(confirmation);
  }
  root.append(node('h3',t.dependencies,'env-section-title'));
  const table=node('table',null,'env-table');table.setAttribute('aria-label',t.dependencies);
  for(const dependency of value.dependencies){const [name,version]=dependency.split('==');table.append(append(node('tr'),node('td',name),node('td',version)));}root.append(append(node('div',null,'env-table-wrap env-dependency-table'),table));
  if(value.target==='control-lab.ngspice')root.append(node('p',t.native,'env-note'));
  if(value.log.length){const details=node('details',null,'env-install-log');details.open=logOpen;details.ontoggle=()=>{logOpen=details.open;};details.append(node('summary',t.log),node('pre',value.log.join('\n'),'env-json'));root.append(details);}
 }
 function catalog(){
  const t=messages(locale);
  if(loading){const pending=node('p',t.loading,'env-empty');pending.setAttribute('role','status');root.append(pending);return;}
  if(!values.length){root.append(append(node('div',null,'env-empty'),node('h2',t.empty),node('p',t.emptyNote,'env-muted')));return;}
  const table=node('table',null,'env-table env-managed-table');table.setAttribute('aria-label',t.environments);
  const head=node('tr');for(const text of [t.name,t.method,t.status,t.usedBy]){const th=node('th',text);th.scope='col';head.append(th);}table.append(append(node('thead'),head));const body=node('tbody');
  for(const value of values){const method=methodOf(value),row=node('tr');row.dataset.environment=value.id;
   const open=button(value.label,()=>{selected=value.id;confirming=false;logOpen=false;render();});open.className='env-link';open.disabled=false;
   row.append(append(node('td'),open),node('td',method.name),append(node('td'),status(value)),node('td',value.bound?method.app:'—'));body.append(row);
  }table.append(body);root.append(append(node('div',null,'env-table-wrap'),table));
 }
 function render(){
  if(disposed)return;
  const active=document.activeElement,focus=root.contains(active)?active.dataset.focus:null;
  const nextLocation=creating?'create':selected || tab, navigated=location!==nextLocation;location=nextLocation;
  queueMicrotask(()=>{
   if(disposed)return;
   const target=navigated?root.querySelector(creating?'#env-name':'h1,h2'):[...root.querySelectorAll('[data-focus]')].find(el=>el.dataset.focus===focus);
   if(target && !target.disabled){if(/^H[12]$/.test(target.tagName))target.tabIndex=-1;target.focus({preventScroll:true});}
  });
  inspector?.dispose();inspector=null;
  const t=messages(locale),value=values.find(v=>v.id===selected);
  root.className='pero-env env-workspace';root.replaceChildren();
  const header=node('header',null,'env-heading');
  const heading=node('div',null,'env-heading-start');
  if(creating || value){const back=button(t.back,()=>{creating=false;selected=null;confirming=false;render();});back.disabled=false;heading.append(back);}
  heading.append(node(creating || value?'h2':'h1',creating?t.createTitle:value?.label || t.title));
  if(value)heading.append(status(value));header.append(heading);
  const actions=node('div',null,'env-actions');
  if(value){
   if(!value.bound && value.state!=='preparing')actions.append(button(value.state==='ready'?t.bind:t.prepare,()=>{if(value.state==='ready'){confirming=true;render();}else void request({operation:'prepare',id:value.id});},true));
   if(value.bound)actions.append(node('span',t.active,'env-muted'));
  }else if(!creating){actions.append(button(t.refresh,()=>request({operation:'list'})),button(t.create,()=>{creating=true;selected=null;label='';render();root.querySelector('#env-name')?.focus();},true));}
  header.append(actions);root.append(header);
  if(error){const alert=node('p',error,'env-error');alert.setAttribute('role','alert');root.append(alert);}
  if(creating){createForm();return;}if(value){detail(value);return;}
  const tabs=node('nav',null,'env-tabs');tabs.setAttribute('aria-label',t.title);
  for(const key of ['environments','inspect']){const control=button(t[key],()=>{tab=key;render();});control.disabled=false;control.setAttribute('aria-pressed',String(tab===key));tabs.append(control);}root.append(tabs);
  if(tab==='environments')catalog();else{const content=node('div',null,'env-checks');root.append(content);inspector=options.inspect?.(content,{locale});}
 }
 void request({operation:'list'});
 poll=setInterval(async()=>{if(disposed || !values.some(v=>v.state==='preparing'))return;try{values=await read();if(!creating)render();}catch(e){error=e.message;render();}},1000);
 return {setLocale(value){locale=value;render();},dispose(){disposed=true;clearInterval(poll);inspector?.dispose();root.replaceChildren();}};
}
