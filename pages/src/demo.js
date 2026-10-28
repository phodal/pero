(function () {
  'use strict';
  const tr = (key, vars) => window.OpenPeroI18n.t(key, vars);
  const $ = selector => document.querySelector(selector);
  const $$ = selector => Array.from(document.querySelectorAll(selector));
  const icon = name => '<svg class="icon" aria-hidden="true"><use href="#i-' + name + '"></use></svg>';
  const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt = number => number === null ? 'N/A' : (Math.abs(number)<.00005?0:number).toFixed(4);
  const model = window.OpenPeroExperiment;
  const inputs = model.inputs();
  const state = { count:0, current:null, previous:null, chart:'solution', panel:'results', entry:'web', worker:'local', running:false };
  const method = { id:'virtual-cell.baselines.v1', methods:model.methods, additive:'mean(A) + mean(B) - mean(control)', train_mean:'Mean of all perturbed training-condition means', aggregation:'equal_batch', primary:'median delta_mse over every test combination', reference:'additive', skill:'median(1 - condition_mse / additive_mse); exclude exact additive with reason', scientificScope:'Synthetic, non-blind demonstration. No trained AI model or biological validation.' };
  let toastTimer;
  function toast(message) { const el=$('#toast');el.textContent=message;el.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(() => el.classList.remove('show'),3500); }
  function runLabel() { return 'RUN ' + String(state.count).padStart(3,'0'); }
  function specRows(rows) { return rows.map(row => '<dt>'+escapeHtml(row[0])+'</dt><dd>'+escapeHtml(row[1])+'</dd>').join(''); }
  function applyRun(result, elapsed) {
    state.previous=state.current;state.count++;
    state.current={id:runLabel(),createdAt:new Date().toISOString(),computeMilliseconds:elapsed,result};
    $('#rmse').textContent=fmt(result.medianDeltaMse);
    $('#samples').textContent=result.denominator.evaluated+'/'+result.denominator.attempted;
    $('#max-error').textContent=fmt(result.medianSkill);
    $('#run-caption').textContent=runLabel()+' · '+result.method+' · '+result.genes.length+' genes';
    $('#run-state').textContent=tr('已计算');
    $('#run-announcement').textContent=tr('{id} 已完成，全部 {count} 个测试组合已评估。',{id:runLabel(),count:result.rows.length});
    renderTrace();renderEvidence();drawChart();
  }
  function calculate() {
    if(state.running)return;
    state.running=true;$('#run-button').disabled=true;$('#run-state').textContent=tr('计算中');
    requestAnimationFrame(() => {
      const begin=performance.now();applyRun(model.run({method:$('#baseline-method').value}),performance.now()-begin);
      state.running=false;$('#run-button').disabled=false;showPanel('results');
      $('#proactive-status').textContent=tr('已触发本页计算 · 可查看结果与运行记录');
      toast(tr('评估已更新，全部测试组合保留在导出记录中。'));
    });
  }
  function renderTrace() {
    const r=state.current.result;
    const records=[[tr('固定输入'),r.dataVersion],[tr('冻结组合划分'),'train 11 · validation 2 · test 5 · seed 7'],[tr('仅用训练条件生成预测'),r.method+' / '+r.methodVersion],[tr('对全部测试组合评分'),'median ΔMSE '+fmt(r.medianDeltaMse)+' · '+r.denominator.evaluated+'/'+r.denominator.attempted]];
    $('#trace-list').innerHTML=records.map(row => '<div class="trace-item">'+icon('check')+'<div><strong>'+escapeHtml(row[0])+'</strong><p>'+escapeHtml(row[1])+'</p></div></div>').join('');
    $('#trace-time').textContent=tr('实际计算 {ms} ms · Browser',{ms:state.current.computeMilliseconds.toFixed(2)});
  }
  function renderEvidence() {
    const r=state.current.result;
    $('#evidence-spec').innerHTML=specRows([[tr('运行'),runLabel()],[tr('方法版本'),r.methodVersion],[tr('输入版本'),r.dataVersion],[tr('基因与尺度'),r.genes.length+' · '+r.scale],[tr('完整分母'),r.denominator.evaluated+'/'+r.denominator.attempted],[tr('评估边界'),tr('合成数据 · 非盲评估')]]);
    $('#evidence-summary').textContent=tr('覆盖全部 5 个测试组合。只演示基线评估流程，未训练 AI 模型，也未验证生物学结论。');
  }
  function drawChart() {
    if(!state.current||state.panel!=='results')return;
    const canvas=$('#research-chart'),ctx=canvas.getContext('2d'),width=canvas.clientWidth,height=canvas.clientHeight;
    if(!ctx||width<20)return;
    const ratio=Math.min(window.devicePixelRatio||1,3);canvas.width=width*ratio;canvas.height=height*ratio;ctx.setTransform(ratio,0,0,ratio,0,0);
    const r=state.current.result,row=r.rows.find(row => row.id===$('#test-condition').value),error=state.chart==='error';
    const css=getComputedStyle(document.documentElement),text=css.getPropertyValue('--slate'),line=css.getPropertyValue('--line'),accent=css.getPropertyValue('--teal');
    const p={l:48,r:16,t:18,b:36},w=width-p.l-p.r,h=height-p.t-p.b;
    const limit=error?Math.max(...row.squaredError)*1.15:Math.max(...row.observed.map(Math.abs),...row.predicted.map(Math.abs))*1.15;
    const range=limit||1,X=value=>p.l+(error?value/r.genes.length:(value+range)/(2*range))*w,Y=value=>p.t+(error?1-value/range:(range-value)/(2*range))*h;
    ctx.clearRect(0,0,width,height);ctx.font='11px monospace';ctx.textAlign='right';
    for(let i=0;i<=4;i++){const value=error?range*i/4:-range+2*range*i/4,y=Y(value);ctx.strokeStyle=line;ctx.beginPath();ctx.moveTo(p.l,y);ctx.lineTo(width-p.r,y);ctx.stroke();ctx.fillStyle=text;ctx.fillText(value.toFixed(2),p.l-8,y+4);}
    if(error){row.squaredError.forEach((value,g)=>{ctx.fillStyle=accent;ctx.fillRect(X(g)+4,Y(value),Math.max(2,w/r.genes.length-8),p.t+h-Y(value));ctx.fillStyle=text;ctx.textAlign='center';ctx.fillText(r.genes[g],X(g+.5),height-17);});}
    else {
      ctx.strokeStyle=text;ctx.setLineDash([4,4]);ctx.beginPath();ctx.moveTo(X(-range),Y(-range));ctx.lineTo(X(range),Y(range));ctx.stroke();ctx.setLineDash([]);
      row.observed.forEach((value,g)=>{ctx.fillStyle=accent;ctx.beginPath();ctx.arc(X(value),Y(row.predicted[g]),4,0,Math.PI*2);ctx.fill();ctx.fillStyle=text;ctx.textAlign='left';ctx.fillText(r.genes[g],X(value)+7,Y(row.predicted[g])-6);});
      ctx.textAlign='center';ctx.fillStyle=text;ctx.fillText(tr('留出观测 Δ表达'),p.l+w/2,height-8);
    }
    $('#plot-label').textContent=error?tr('逐基因平方误差'):tr('预测 vs 留出观测 · Δ表达');
    $('#chart-legend').textContent=error?tr('误差按全部 12 个基因计算'):tr('点：基因 · 虚线：预测 = 观测');
    canvas.setAttribute('aria-label',tr('{condition} 的预测与合成观测比较，完整数值可通过查看数据读取。',{condition:row.id}));
  }
  function showPanel(panel) {state.panel=panel;$$('.wb-tab').forEach(tab=>{const on=tab.dataset.panel===panel;tab.setAttribute('aria-selected',on);tab.tabIndex=on?0:-1;});['results','trace','evidence'].forEach(name=>$('#panel-'+name).hidden=name!==panel);$$('.side-link[data-panel]').forEach(button=>button.classList.toggle('active',button.dataset.panel===panel));if(panel==='results')requestAnimationFrame(drawChart);}


    function renderRuntime() {
      $$('.choice[data-entry]').forEach(function(button){button.setAttribute('aria-pressed',button.dataset.entry===state.entry);});
      $$('.choice[data-worker]').forEach(function(button){button.setAttribute('aria-pressed',button.dataset.worker===state.worker);});
      $('#entry-node').innerHTML=icon(state.entry==='web'?'world':'device-desktop')+(state.entry==='web'?'Web':'Desktop');
      $('#worker-node').innerHTML=icon(state.worker==='local'?'terminal-2':'server')+(state.worker==='local'?'Local Worker':'Remote Worker');
      const modes={
        'web-local':[tr('轻量入口，本地研究环境。'),tr('通过浏览器连接本地运行服务，查看项目、发起分析与比较结果。浏览器是界面，本地 Worker 承担文件和工具访问。'),[tr('浏览器界面'),tr('本地运行服务'),tr('统一研究记录')]],
        'web-remote':[tr('打开项目，连接远程计算。'),tr('从 Web 进入项目，由远程 Worker 执行任务。适合实验室服务器与共享计算资源，也为持续运行和结果审阅保留空间。'),[tr('远程任务'),tr('共享算力'),tr('异步查看结果')]],
        'desktop-local':[tr('熟悉的桌面，身边的工具。'),tr('通过桌面工作台连接本机文件、研究环境与专业软件。让日常分析与项目记录留在同一个工作上下文中。'),[tr('本地文件'),tr('专业工具'),tr('项目上下文')]],
        'desktop-remote':[tr('本地组织研究，远程推进实验。'),tr('桌面保留交互与本地材料，远程 Worker 承担长任务和更重的计算。入口与执行位置可以独立选择。'),[tr('本地交互'),tr('长任务执行'),tr('一致的研究对象')]]
      }[state.entry+'-'+state.worker];
      $('#runtime-title').textContent=modes[0];$('#runtime-description').textContent=modes[1];
      $('#runtime-points').innerHTML=modes[2].map(function(label){return '<span>'+icon('check')+label+'</span>';}).join('');
    }
  function evidenceBundle() {return {schema:'openpero-cell-demo-evidence/1.0',kind:'synthetic-demonstration',method,inputs,run:state.current,previousRun:state.previous,scope:'Non-blind baseline comparison. No AI training, biological acceptance, App backend or remote service connected.'};}
  function download(type) {
    const r=state.current.result;
    const csv=['method,condition,gene,observed_delta,predicted_delta,squared_error'];
    r.rows.forEach(row=>r.genes.forEach((gene,g)=>csv.push([r.method,row.id,gene,row.observed[g],row.predicted[g],row.squaredError[g]].join(','))));
    const content=type==='csv'?csv.join('\n'):JSON.stringify(type==='method'?method:evidenceBundle(),null,2);
    const url=URL.createObjectURL(new Blob([content],{type:type==='csv'?'text/csv;charset=utf-8':'application/json'})),a=document.createElement('a');
    a.href=url;a.download='openpero-virtual-cell-'+(type==='method'?'method':runLabel().toLowerCase().replace(' ','-'))+(type==='csv'?'.csv':'.json');document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),3000);toast(tr('已生成包含实际评估数据的文件。'));
  }
  function openDialog(name) {
    const r=state.current.result,pre=value=>'<pre>'+escapeHtml(JSON.stringify(value,null,2))+'</pre>',para=text=>'<p>'+escapeHtml(tr(text))+'</p>';
    const contents={
      method:{title:tr('Virtual Cell · 基线方法'),body:para('用训练数据中的单扰动效应，预测留出的双扰动组合。additive 是经验加性基线，不是训练的 AI 模型。')+pre(method)+'<button class="btn btn-primary" data-export="method">'+tr('下载方法定义')+'</button>'},
      inputs:{title:tr('Virtual Cell · 数据与划分'),body:para('输入来自仓库内 Virtual Cell App 的 synthetic.json。A–F 与 G6–G11 均为合成特征名，不代表真实基因实验。')+pre({source:inputs.dataset.source,scale:inputs.dataset.scale,genes:inputs.dataset.genes,split:inputs.split})},
      sources:{title:tr('来源与适用范围'),body:para('本页复用 apps/virtual-cell/examples/synthetic.json，以及 App 的三种基线与 ΔMSE 评估定义。没有调用 Python 后端。')+para('Virtual Cell App 还提供 PBMC 参考图谱、机制仿真和体数据查看。本页只展示扰动评估，没有把这些不同来源的数据拼成一个实验。')+'<p><a href="https://github.com/phodal/pero/tree/main/apps/virtual-cell" target="_blank" rel="noopener noreferrer">Virtual Cell App ↗</a></p>'+para('测试读数在浏览器中可见，因此这是非盲流程演示。低误差不构成生物学验证或模型泛化证据。')},
      about:{title:tr('关于这个可复跑的示例'),body:para('本页可切换基线、查看测试组合、导出全部预测与误差。所有数据与状态均在浏览器本地；刷新后重置。')+para('GitHub、Agent、协作者、远程执行与验收角色均为界面模拟。没有训练 AI 模型，没有接通 App 后端或科学验证服务。')},
      roadmap:{title:tr('可选的 Cloud，围绕真实研究需求。'),body:para('Cloud 的核心方向是持续任务协调。协调服务可自部署或托管，计算由本地、实验室或云端节点承担。托管 Cloud 仍在规划。')}
    };
    if(name==='data')contents.data={title:tr('全部测试组合 · 逐基因数据'),body:para('指标覆盖全部测试组合；切换图中的组合不会改变分母。')+'<div class="table-scroll"><table class="data-table"><thead><tr><th>Combination</th><th>Gene</th><th>Observed Δ</th><th>Predicted Δ</th><th>Squared error</th></tr></thead><tbody>'+r.rows.map(row=>r.genes.map((gene,g)=>'<tr><td>'+row.id+'</td><td>'+gene+'</td><td>'+fmt(row.observed[g])+'</td><td>'+fmt(row.predicted[g])+'</td><td>'+fmt(row.squaredError[g])+'</td></tr>').join('')).join('')+'</tbody></table></div><button class="btn btn-primary" data-export="csv">'+tr('下载 CSV 数据')+'</button>'};
    const content=contents[name];if(!content)return;$('#dialog-title').textContent=content.title;$('#dialog-body').innerHTML=content.body;if(!$('#detail-dialog').open)$('#detail-dialog').showModal();
  }
  document.addEventListener('click',event=>{
    const target=event.target.closest('button,a');if(!target)return;
    if(target.dataset.panel)showPanel(target.dataset.panel);
    if(target.dataset.chart){state.chart=target.dataset.chart;$$('[data-chart]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.chart===state.chart));drawChart();}
    if(target.dataset.entry){state.entry=target.dataset.entry;renderRuntime();}
    if(target.dataset.worker){state.worker=target.dataset.worker;renderRuntime();}
    if(target.dataset.dialog)openDialog(target.dataset.dialog);
    if(target.dataset.export)download(target.dataset.export);
    if(target.closest('.nav-links'))closeMenu();
  });
  $('#run-button').addEventListener('click',calculate);$('#proactive-approve').addEventListener('click',calculate);
  $('#baseline-method').addEventListener('change',()=>$('#run-state').textContent=tr('方法已更改 · 请运行'));
  $('#test-condition').addEventListener('change',drawChart);
  $('.dialog-close').addEventListener('click',()=>$('#detail-dialog').close());
  function closeMenu() {$('#nav-links').classList.remove('open');$('#menu-button').setAttribute('aria-expanded','false');}
  $('#menu-button').addEventListener('click',function(){const open=this.getAttribute('aria-expanded')!=='true';this.setAttribute('aria-expanded',open);this.setAttribute('aria-label',tr(open?'关闭导航菜单':'打开导航菜单'));$('#nav-links').classList.toggle('open',open);});
  document.addEventListener('keydown',event=>{if(event.key==='Escape')closeMenu();});
  function keyboardTabs(selector,vertical) {const list=$$(selector);list.forEach((button,index)=>button.addEventListener('keydown',event=>{let next;if(event.key===(vertical?'ArrowDown':'ArrowRight'))next=(index+1)%list.length;else if(event.key===(vertical?'ArrowUp':'ArrowLeft'))next=(index+list.length-1)%list.length;else if(event.key==='Home')next=0;else if(event.key==='End')next=list.length-1;else return;event.preventDefault();list[next].click();list[next].focus();}));}
  keyboardTabs('.wb-tab',false);
  if('ResizeObserver' in window)new ResizeObserver(drawChart).observe($('#research-chart'));else window.addEventListener('resize',drawChart);
  const begin=performance.now();applyRun(model.run(model.presets.variant),performance.now()-begin);renderRuntime();
  // Read-only inspection for the local prototype and exported evidence.
  window.OpenPeroDemo=Object.freeze({snapshot:()=>JSON.parse(JSON.stringify(evidenceBundle()))});
})();
