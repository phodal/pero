(function () {
    'use strict';
    const tr = function (key, vars) { return window.OpenPeroI18n.t(key, vars); };
    const $ = function (selector) { return document.querySelector(selector); };
    const $$ = function (selector) { return Array.from(document.querySelectorAll(selector)); };
    const icon = function (name) { return '<svg class="icon" aria-hidden="true"><use href="#i-' + name + '"></use></svg>'; };
    const escapeHtml = function (value) { return String(value).replace(/[&<>"']/g,function (c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); };
    const fmt = function (number) { return number === 0 ? '0' : number.toExponential(2).replace('e-','e−'); };
    const fixed = function (number, digits) { return Number(number).toFixed(digits === undefined ? 2 : digits); };
    const model = window.OpenPeroExperiment;
    const baseline = model.run(model.presets.baseline);
    const state = { count:0, current:null, previous:null, chart:'solution', panel:'results', step:'evidence', entry:'web', worker:'local', running:false };
    const method = { name:'damped-oscillator',version:'1.0.0',solver:'Runge-Kutta 4',equation:"x'' + 2ζω₀x' + ω₀²x = 0",naturalFrequencyHz:0.4,initialConditions:{position:1,velocity:0},inputs:['damping','dt','duration'],reference:'analytical solution with identical parameters',validation:{metric:'maximum absolute displacement error',threshold:0.001},artifacts:['results.csv','evidence.json'],scope:'synthetic mathematical demonstration' };
    let toastTimer;
    function toast(message) { const el=$('#toast'); el.textContent=message; el.classList.add('show'); clearTimeout(toastTimer); toastTimer=setTimeout(function(){el.classList.remove('show');},3500); }
    function runLabel() { return 'RUN ' + String(state.count).padStart(3,'0'); }
    function applyRun(result,elapsed) {
      if(state.current) state.previous=state.current;
      state.count+=1;
      state.current={id:runLabel(),createdAt:new Date().toISOString(),computeMilliseconds:elapsed,result:result};
      $('#rmse').textContent=fmt(result.rmse); $('#max-error').textContent=fmt(result.maxError);
      $('#samples').textContent=result.sampleCount;
      $('#run-caption').textContent=runLabel()+' · dt '+fixed(result.parameters.dt)+' s';
      $('#run-state').textContent=tr('已计算'); $('#ledger-run').textContent=runLabel();
      $('#run-announcement').textContent=tr('{id} 已完成。阻尼比 {damping}，{samples} 个数据点，解析对照均方根误差 {rmse}。',{id:runLabel(),damping:fixed(result.parameters.damping),samples:result.sampleCount,rmse:result.rmse.toExponential(3)});
      renderTrace(); renderEvidence(); renderLedger(); drawChart();
    }
    function calculate() {
      if(state.running)return;
      state.running=true;
      const button=$('#run-button'); button.disabled=true; button.querySelector('span').textContent=tr('计算中');
      $('#run-state').textContent=tr('计算中'); $('#run-badge').classList.add('is-running');
      requestAnimationFrame(function(){setTimeout(function(){
        try {
          const begin=performance.now();
          const result=model.run({damping:Number($('#damping').value),dt:0.1,duration:10});
          const elapsed=performance.now()-begin;
          applyRun(result,elapsed); showPanel('results');
          toast(tr('{id} 已生成：参数、曲线与证据已更新。',{id:runLabel()}));
        } catch(error) { $('#run-state').textContent=tr('未完成'); toast(tr('计算未完成：{message}',{message:error.message})); }
        finally { state.running=false; button.disabled=false; button.querySelector('span').textContent=tr('运行对照'); $('#run-badge').classList.remove('is-running'); }
      },80);});
    }
    function renderTrace() {
      const r=state.current.result;
      const records=[
        [tr('固定输入'),'x(0)=1 · v(0)=0 · f₀=0.4 Hz · synthetic / v1.0'],
        [tr('执行数值方法'),'RK4 · ζ='+fixed(r.parameters.damping)+' · dt='+fixed(r.parameters.dt)+' s · '+r.sampleCount+' samples'],
        [tr('与解析参考比较'),'RMSE '+fmt(r.rmse)+' · max error '+fmt(r.maxError)],
        [tr('保留本次证据'),runLabel()+' · inputs + method + samples + metrics']
      ];
      $('#trace-list').innerHTML=records.map(function(row){return '<div class="trace-item">'+icon('check')+'<div><strong>'+escapeHtml(row[0])+'</strong><p>'+escapeHtml(row[1])+'</p></div></div>';}).join('');
      $('#trace-time').textContent=tr('实际计算 {ms} ms · Browser',{ms:state.current.computeMilliseconds<1?'< 1':fixed(state.current.computeMilliseconds,2)});
    }
    function specRows(rows) { return rows.map(function(row){return '<dt>'+escapeHtml(row[0])+'</dt><dd>'+escapeHtml(row[1])+'</dd>';}).join(''); }
    function renderEvidence() {
      const r=state.current.result;
      $('#evidence-spec').innerHTML=specRows([[tr('运行'),runLabel()],[tr('方法版本'),r.methodVersion],[tr('输入版本'),r.dataVersion],[tr('初始条件'),'x₀ = 1 · v₀ = 0'],[tr('本次参数'),'ζ = '+fixed(r.parameters.damping)+' · dt = 0.10 s'],[tr('参考'),tr('同参数解析解')]]);
      $('#evidence-summary').textContent=tr('最大绝对误差 {error}{status}此检查只衡量数值方法与数学参考的一致性。',{error:fmt(r.maxError),status:tr(r.maxError<=0.001?'，满足示例预设阈值 0.001。':'，超出示例预设阈值 0.001。')});
    }
    function renderLedger() {
      if(!state.current)return;
      const r=state.current.result;
      const content={
        inputs:{label:'01 / INPUT SNAPSHOT',title:tr('让每次运行，有一个确定的起点。'),copy:tr('本例从公开的数学模型出发。输入由方程和初始条件生成，使用合成数据演示研究流程。'),rows:[[tr('模型'),tr('欠阻尼谐振子')],[tr('初始位移'),'1 · normalized amplitude'],[tr('初始速度'),'0'],[tr('固有频率'),'0.4 Hz'],[tr('数据来源'),r.dataVersion]],note:tr('同样的输入与参数，生成相同的数值数组。'),action:tr('查看输入定义'),dialog:'inputs'},
        method:{label:'02 / EXECUTABLE METHOD',title:tr('方法可读，也可以实际执行。'),copy:tr('用四阶 Runge-Kutta 方法积分运动方程，再与使用相同初始条件和参数的解析解对照。'),rows:[[tr('方法'),'Classical Runge-Kutta 4'],[tr('版本'),r.methodVersion],[tr('时间步长'),fixed(r.parameters.dt)+' s'],[tr('持续时间'),'10 s'],[tr('验证阈值'),'max absolute error ≤ 0.001']],note:tr('阈值是本示例的数值检查规则，不代表真实物理系统已经得到验证。'),action:tr('打开方法定义'),dialog:'method'},
        run:{label:'03 / RUN & COMPARE',title:tr('条件改变了，结果如何变化？'),copy:tr('紫色曲线保留固定基线，青色曲线使用你选择的阻尼比。本次运行保留完整参数与结果；导出记录同时附带上一次运行摘要。'),rows:[[tr('本次运行'),runLabel()],[tr('基线阻尼'),'ζ = 0.08'],[tr('本次阻尼'),'ζ = '+fixed(r.parameters.damping)],[tr('数据点'),r.sampleCount+' per run'],[tr('执行位置'),'Browser local']],note:tr('同一模型中，阻尼比影响振幅衰减。比较曲线与数值误差，分别回答不同问题。'),action:tr('查看本次数据'),dialog:'data'},
        evidence:{label:'04 / EVIDENCE RECORD',title:tr('从一个结果，回到完整依据。'),copy:tr('输入、方法版本、完整数值数组与检查结果都在记录中。导出后，可以独立查看和继续分析。'),rows:[[tr('运行记录'),runLabel()],[tr('方法版本'),r.methodVersion],[tr('解析对照 RMSE'),fmt(r.rmse)],[tr('最大绝对误差'),fmt(r.maxError)],[tr('记录格式'),'JSON + CSV']],note:tr(r.maxError<=0.001?'数值检查：满足 max error ≤ 0.001。记录包含完整参数，结论的适用范围也一并保留。':'数值检查：未满足 max error ≤ 0.001。记录包含完整参数，结论的适用范围也一并保留。'),action:tr('下载完整复现记录'),export:'json'}
      }[state.step];
      $('#ledger-content').innerHTML='<div class="ledger-kicker">'+content.label+'</div><h3>'+content.title+'</h3><p>'+content.copy+'</p><dl>'+specRows(content.rows)+'</dl><div class="check-note">'+content.note+'</div><button class="text-link" '+(content.export?'data-export="'+content.export+'"':'data-dialog="'+content.dialog+'"')+'>'+content.action+icon('arrow-up-right')+'</button>';
      $('#ledger-content').setAttribute('aria-labelledby','step-'+state.step);
    }
    function drawChart() {
      if(!state.current||state.panel!=='results')return;
      const canvas=$('#research-chart'),ctx=canvas.getContext('2d');
      if(!ctx)return;
      const width=canvas.clientWidth,height=canvas.clientHeight;
      if(width<20||height<20)return;
      const ratio=Math.min(window.devicePixelRatio||1,3);
      canvas.width=Math.round(width*ratio);canvas.height=Math.round(height*ratio);ctx.setTransform(ratio,0,0,ratio,0,0);
      const r=state.current.result,margin={left:32,right:10,top:13,bottom:24};
      const w=width-margin.left-margin.right,h=height-margin.top-margin.bottom;
      const isError=state.chart==='error';
      const ymin=isError?0:-1,ymax=isError?Math.max(r.maxError*1.2,1e-12):1;
      const px=function(t){return margin.left+t/10*w;},py=function(y){return margin.top+(ymax-y)/(ymax-ymin)*h;};
      ctx.clearRect(0,0,width,height);ctx.font='8px '+getComputedStyle(document.body).getPropertyValue('--mono');ctx.lineWidth=1;
      for(let i=0;i<=4;i++){const y=ymin+(ymax-ymin)*i/4,cy=py(y);ctx.beginPath();ctx.strokeStyle='#DCE4ED';ctx.setLineDash([2,4]);ctx.moveTo(margin.left,cy);ctx.lineTo(width-margin.right,cy);ctx.stroke();ctx.fillStyle='#596B7D';ctx.textAlign='right';ctx.fillText(isError?y.toExponential(0):(i===0?'-1.0':i===4?'1.0':fixed(y,1)),margin.left-7,cy+3);}
      for(let i=0;i<=5;i++){const t=i*2;ctx.fillStyle='#596B7D';ctx.textAlign='center';ctx.fillText(String(t),px(t),height-9);}
      ctx.fillText('s',width-margin.right,height-9);
      if(!isError){ctx.setLineDash([]);ctx.strokeStyle='#748599';ctx.beginPath();ctx.moveTo(margin.left,py(0));ctx.lineTo(width-margin.right,py(0));ctx.stroke();}
      function line(times,values,color,dash){ctx.beginPath();ctx.strokeStyle=color;ctx.lineWidth=1.75;ctx.setLineDash(dash||[]);times.forEach(function(t,i){if(i===0)ctx.moveTo(px(t),py(values[i]));else ctx.lineTo(px(t),py(values[i]));});ctx.stroke();}
      if(isError) line(r.time,r.absoluteError,'#007F86',[]);
      else {line(baseline.time,baseline.solution,'#845EC2',[4,3]);line(r.time,r.solution,'#007F86',[]);}
      ctx.setLineDash([]);
      $('#plot-label').textContent=isError?'ABSOLUTE ERROR / ANALYTICAL REFERENCE':'NORMALIZED DISPLACEMENT';
      $('#chart-legend').innerHTML=isError?'<span><i></i>'+escapeHtml(tr('本次 RK4 与同参数解析解的绝对误差'))+'</span>':'<span class="baseline"><i></i>'+escapeHtml(tr('基线 ζ = 0.08'))+'</span><span><i></i>'+escapeHtml(tr('本次 ζ ='))+' <b id="legend-damping">'+fixed(r.parameters.damping)+'</b></span>';
      canvas.setAttribute('aria-label',isError?tr('本次 RK4 数值解与解析解的绝对误差曲线，最大误差 {error}',{error:r.maxError.toExponential(3)}):tr('归一化位移对照，紫色虚线为阻尼比 0.08 的基线，青色实线为阻尼比 {damping} 的本次运行。详细数值可通过查看数据读取。',{damping:fixed(r.parameters.damping)}));
    }
    function showPanel(panel) {
      state.panel=panel;
      $$('.wb-tab').forEach(function(tab){const on=tab.dataset.panel===panel;tab.setAttribute('aria-selected',on);tab.tabIndex=on?0:-1;});
      ['results','trace','evidence'].forEach(function(name){$('#panel-'+name).hidden=name!==panel;});
      $$('.side-link[data-panel]').forEach(function(button){button.classList.toggle('active',button.dataset.panel===panel);});
      if(panel==='results')requestAnimationFrame(drawChart);
    }
    function showStep(name) { state.step=name;$$('.step').forEach(function(button){const on=button.dataset.step===name;button.setAttribute('aria-selected',on);button.tabIndex=on?0:-1;});renderLedger(); }
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
    function evidenceBundle() { return {schema:'openpero-demo-evidence/1.0.0',kind:'synthetic-demonstration',exportedAt:new Date().toISOString(),method:method,baseline:{parameters:baseline.parameters,time:baseline.time,solution:baseline.solution},run:state.current,previousRun:state.previous?{id:state.previous.id,createdAt:state.previous.createdAt,parameters:state.previous.result.parameters,rmse:state.previous.result.rmse}:null,scope:'Numerical demonstration only; no measurement or published research dataset is used.'}; }
    function download(type) {
      const r=state.current.result; let content,mime,extension;
      if(type==='csv'){const rows=['time_s,baseline_displacement,current_displacement,analytical_reference,absolute_error'];r.time.forEach(function(t,i){rows.push([t,baseline.solution[i],r.solution[i],r.reference[i],r.absoluteError[i]].join(','));});content=rows.join('\n');mime='text/csv;charset=utf-8';extension='csv';}
      else if(type==='method'){content=JSON.stringify(method,null,2);mime='application/json';extension='json';}
      else {content=JSON.stringify(evidenceBundle(),null,2);mime='application/json';extension='json';}
      const blob=new Blob([content],{type:mime}),url=URL.createObjectURL(blob),a=document.createElement('a');
      a.href=url;a.download='openpero-'+(type==='method'?'method':runLabel().toLowerCase().replace(' ','-'))+'.'+extension;
      document.body.appendChild(a);a.click();a.remove();setTimeout(function(){URL.revokeObjectURL(url);},10000);
      toast(type==='method'?tr('方法定义已生成。'):tr('已生成 {ext} 文件，包含当前运行的实际数据。',{ext:extension.toUpperCase()}));
    }
    function openDialog(name) {
      const r=state.current.result;
      const pre=function(object){return '<pre>'+escapeHtml(JSON.stringify(object,null,2))+'</pre>';};
      const para=function(text){return '<p>'+escapeHtml(tr(text))+'</p>';};
      const heading=function(text){return '<h3>'+escapeHtml(tr(text))+'</h3>';};
      const item=function(text){return '<li>'+escapeHtml(tr(text))+'</li>';};
      const contents={
        method:{title:tr('实验方法 · damped-oscillator'),body:para('用有解析参考的阻尼振子，展示从输入、计算到证据的最小研究过程。')+'<pre>x″ + 2ζω₀x′ + ω₀²x = 0\nx(0) = 1, x′(0) = 0\nω₀ = 2π × 0.4 rad/s</pre>'+heading('实际执行的内容')+para('四阶 Runge-Kutta 数值积分，固定时间步长 0.1 秒、时长 10 秒。每个时间点与同参数的解析解比较，计算 RMSE 和最大绝对误差。')+pre(method)+'<div class="dialog-actions"><button class="btn btn-primary" data-export="method">'+icon('download')+escapeHtml(tr('下载方法定义'))+'</button></div>'},
        inputs:{title:tr('研究输入 · 当前参数'),body:para('数据由方程和初始条件生成。阻尼比 ζ 无量纲；时间单位为秒；位移使用归一化振幅。')+pre(r.parameters)+'<p class="scope-note">'+escapeHtml(tr('基线阻尼固定为 0.08；当前实验阻尼为 {damping}。本例未使用真实测量或论文数据。',{damping:fixed(r.parameters.damping)}))+'</p>'},
        sources:{title:tr('研究输入与来源'),body:para('此交互示例使用经典欠阻尼谐振子方程，通过浏览器内的数值方法生成数据。')+heading('输入来源')+para('模型定义、固定初始条件与可调整阻尼比。没有关联虚构的论文、作者或 DOI。')+heading('比较依据')+para('同一方程在同样初始条件和参数下的解析解。结果与参考的接近程度反映数值方法的误差。')+heading('在正式研究项目中')+para('这里可关联论文、数据集、方法实现与版本信息。本页只演示这些对象之间的关系。')},
        open:{title:tr('OpenPero · 开放计划'),body:para('OpenPero 的产品方向是围绕研究项目工作的开源 AI 科研工作台：保留已有工作，连接研究工具，跟进与课题有关的变化。')+heading('优先建立的开放边界')+'<ul>'+item('可阅读的方法定义、参数与验证规则。')+item('可以导出的运行记录、数据与研究产物。')+item('面向本地与远程执行的一致研究对象。')+item('清楚标注代码、扩展和外部工具各自的许可。')+'</ul><p class="scope-note">'+escapeHtml(tr('正式代码仓库、许可证与安装包链接尚未在本原型中配置。本页面提供的示例方法与运行记录可以直接导出。'))+'</p><div class="dialog-actions"><button class="btn btn-primary" data-export="method">'+escapeHtml(tr('查看并下载示例方法'))+'</button><button class="btn btn-secondary" data-export="json">'+escapeHtml(tr('导出复现记录'))+'</button></div>'},
        roadmap:{title:tr('可选的 Cloud，围绕真实研究需求。'),body:para('Cloud 的核心方向是持续任务协调。协调服务可自部署或托管，计算由本地、实验室或云端节点承担。托管 Cloud 仍在规划。')+heading('让已有研究可以接着做')+para('保存研究资料、跑通的方法与分析结果，回到项目时可以沿用已有工作。')+heading('再连接远程环境')+para('围绕实验室服务器、共享算力与长任务，明确环境、资源和结果之间的责任。')+heading('探索托管与协作')+para('验证持续执行、团队审阅、环境托管与计算资源管理的需求，再确定服务边界与商业模式。')+'<p class="scope-note">'+escapeHtml(tr('当前状态：规划中。此页面未提供云服务、账户注册、远程执行或付费功能。'))+'</p>'},
        about:{title:tr('关于这个可复跑的示例'),body:para('这是 OpenPero 官网与研究工作台的交互原型。页面采用「深空蓝 × 光谱青」品牌配色，HTML、CSS、图标和计算逻辑均包含在同一个文件中。')+heading('可以实际操作')+para('改变阻尼比并重新计算、切换曲线与误差、查看运行记录与参数、下载真实生成的 JSON / CSV 文件，以及探索产品形态说明。')+heading('科学适用范围')+para('本页 GitHub、Agent、协作者与节点分发均为模拟，没有连接外部服务。本例只检查数值方法与解析数学模型的一致性，不构成对真实物理系统的验证，也不代表已经复现了某篇研究论文。')+heading('隐私与执行')+para('示例在浏览器本地计算，不上传数据，不调用 AI 服务，不保存账户信息。刷新页面会重置运行记录；需要保留结果时请先导出。')+heading('图标与品牌')+para('标准界面图标来自 MIT 授权的 Tabler Icons。小橘猫是可替换的示意图标；正式品牌原图可在接入时替换。')}
      };
      if(name==='data'){
        const table='<div class="table-scroll"><table><thead><tr><th>'+escapeHtml(tr('时间 / s'))+'</th><th>'+escapeHtml(tr('基线位移'))+'</th><th>'+escapeHtml(tr('本次位移'))+'</th><th>'+escapeHtml(tr('解析参考'))+'</th><th>'+escapeHtml(tr('绝对误差'))+'</th></tr></thead><tbody>'+r.time.map(function(t,i){return '<tr><td>'+fixed(t,1)+'</td><td>'+fixed(baseline.solution[i],6)+'</td><td>'+fixed(r.solution[i],6)+'</td><td>'+fixed(r.reference[i],6)+'</td><td>'+r.absoluteError[i].toExponential(3)+'</td></tr>';}).join('')+'</tbody></table></div>';
        contents.data={title:tr('{id} · 完整数值数据',{id:runLabel()}),body:'<p>'+escapeHtml(tr('当前阻尼比 {damping}，基线阻尼比 0.08。共 {samples} 个数据点，数据由当前模型实际计算。',{damping:fixed(r.parameters.damping),samples:r.sampleCount}))+'</p>'+table+'<div class="dialog-actions"><button class="btn btn-primary" data-export="csv">'+icon('download')+escapeHtml(tr('下载 CSV 数据'))+'</button><button class="btn btn-secondary" data-export="json">'+escapeHtml(tr('下载完整 JSON 记录'))+'</button></div>'};
      }
      const content=contents[name];if(!content)return;
      $('#dialog-title').textContent=content.title;$('#dialog-body').innerHTML=content.body;
      if(!$('#detail-dialog').open)$('#detail-dialog').showModal();
    }
    document.addEventListener('click',function(event){
      const target=event.target.closest('button,a');if(!target)return;
      if(target.dataset.panel)showPanel(target.dataset.panel);
      if(target.dataset.chart){state.chart=target.dataset.chart;$$('[data-chart]').forEach(function(b){b.setAttribute('aria-pressed',b.dataset.chart===state.chart);});drawChart();}
      if(target.dataset.step)showStep(target.dataset.step);
      if(target.dataset.entry){state.entry=target.dataset.entry;renderRuntime();}
      if(target.dataset.worker){state.worker=target.dataset.worker;renderRuntime();}
      if(target.dataset.dialog)openDialog(target.dataset.dialog);
      if(target.dataset.export)download(target.dataset.export);
      if(target.hasAttribute('data-explore')){showPanel('results');setTimeout(function(){$('#damping').focus({preventScroll:true});},350);}
      if(target.closest('.nav-links'))closeMenu();
    });
    $('#run-button').addEventListener('click',calculate);
    $('#damping').addEventListener('input',function(){const value=Number(this.value);$('#damping-output').textContent=fixed(value);$('#run-button span').textContent=tr('运行对照');$('#run-state').textContent=value===state.current.result.parameters.damping?tr('已计算'):tr('参数已更改');});
    $('.dialog-close').addEventListener('click',function(){$('#detail-dialog').close();});
    $('#detail-dialog').addEventListener('click',function(event){if(event.target===this){const rect=this.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)this.close();}});
    function closeMenu(){$('#nav-links').classList.remove('open');$('#menu-button').setAttribute('aria-expanded','false');$('#menu-button').setAttribute('aria-label',tr('打开导航菜单'));}
    $('#menu-button').addEventListener('click',function(){const open=this.getAttribute('aria-expanded')!=='true';this.setAttribute('aria-expanded',open);this.setAttribute('aria-label',open?tr('关闭导航菜单'):tr('打开导航菜单'));$('#nav-links').classList.toggle('open',open);});
    document.addEventListener('keydown',function(event){if(event.key==='Escape')closeMenu();});
    function keyboardTabs(selector,vertical){const list=$$(selector);list.forEach(function(button,index){button.addEventListener('keydown',function(event){const nextKey=vertical?'ArrowDown':'ArrowRight',previousKey=vertical?'ArrowUp':'ArrowLeft';let next;if(event.key===nextKey)next=(index+1)%list.length;else if(event.key===previousKey)next=(index+list.length-1)%list.length;else if(event.key==='Home')next=0;else if(event.key==='End')next=list.length-1;else return;event.preventDefault();list[next].click();list[next].focus();});});}
    keyboardTabs('.wb-tab',false);keyboardTabs('.step',true);
    if('ResizeObserver' in window)new ResizeObserver(drawChart).observe($('#research-chart'));else window.addEventListener('resize',drawChart);
    if('IntersectionObserver' in window){const observer=new IntersectionObserver(function(entries){entries.forEach(function(entry){if(entry.isIntersecting)$$('.nav-links a').forEach(function(a){a.setAttribute('aria-current',a.hash==='#'+entry.target.id?'true':'false');});});},{rootMargin:'-15% 0px -45% 0px'});['principles','collaborate','runtime','open'].forEach(function(id){observer.observe($('#'+id));});}
    const initialStart=performance.now();const initial=model.run(model.presets.variant);applyRun(initial,performance.now()-initialStart);renderRuntime();
    // Read-only inspection hook for transparent, reproducible example data.
    window.OpenPeroDemo=Object.freeze({snapshot:function(){return JSON.parse(JSON.stringify(evidenceBundle()));}});
    document.addEventListener('DOMContentLoaded',()=>{
      const approve=document.getElementById('proactive-approve');
      const status=document.getElementById('proactive-status');
      const damping=document.getElementById('damping');
      if(approve)approve.addEventListener('click',()=>{
        const run=document.getElementById('run-button');
        if(run)run.click();
        status.textContent=tr('已触发本页计算 · 可查看结果与运行记录');
        approve.textContent=tr('再次运行');
      });
      if(damping)damping.addEventListener('input',()=>{status.textContent=tr('参数已调整 · 预设建议，非 Agent 推理');approve.textContent=tr('运行这组参数');});
    });
  })();
