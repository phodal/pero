/* OpenPero distributed research concept. No networking, credentials, background
   monitoring, real GitHub events, or remote workers. The numerical experiments
   run locally. Scheduling, contributor identity and approvals are UI simulation. */
(function () {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const escape = (value) => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const tr = (key, vars) => window.OpenPeroI18n.t(key, vars);
  const model = window.OpenPeroExperiment;
  const dialog = $('#collab-dialog');
  const SOURCES = Object.freeze({
    github: {caption:tr('ISSUE #12 · 示例编号'), title:tr('比较三组阻尼参数的响应差异'), text:tr('沿用项目已有模型，分别运行 ζ = 0.08、0.22、0.40，提交曲线、数值误差和完整参数。'), note:tr('不会读取或发布真实 Issue。切换来源会清空本次演示。')},
    proactive: {caption:tr('PERO 建议 · 预设事件'),title:tr('已有基线之外，还需要两组对照。'),text:tr('项目已有 ζ = 0.08 的基线。建议沿用方法补充 0.22 与 0.40 两组条件，检查响应差异与数值误差。'),note:tr('这条建议来自预设规则，不是实时数据监测或模型推理。')},
    human: {caption:tr('研究者提出 · 示例委托'),title:tr('请帮我把参数对照做完整。'),text:tr('不要修改模型和初始状态。增加两组阻尼条件，让不同执行者分别计算，再由合作者复核完整记录。'),note:tr('示例任务由本页模拟整理；无需账户，不会创建真实团队任务。')}
  });
  const contributionSets = Object.freeze({
    build: [
      {title:tr('接入一个研究工具'),kind:'CONNECTOR',level:tr('独立模块'),desc:tr('把已有脚本、数据库或计算工具，变成项目可以调用的能力。'),delivery:tr('接口定义、权限说明、输入输出样例与测试。'),accept:tr('给定固定输入，连接器返回结构化产物；错误可识别；不泄露凭据。'),target:'connector'},
      {title:tr('实现一种 Worker'),kind:'WORKER SDK',level:tr('执行基础'),desc:tr('让熟悉的运行环境接到清楚的任务，回报进度并交回结果。'),delivery:tr('注册、任务领取、心跳、取消与结果提交适配。'),accept:tr('使用本地测试夹具完成任务；节点退出可检测；迟到结果不会覆盖当前执行。'),target:'worker-sdk'},
      {title:tr('补上一道结果检查'),kind:'VERIFIER',level:tr('质量检查'),desc:tr('把领域验收规则写成独立检查，区分“跑完了”与“符合要求”。'),delivery:tr('验证规则、通过与失败样例、可解释的检查报告。'),accept:tr('固定样例产生确定检查结果；完整性与数值检查分开；不把数值通过等同于科学结论成立。'),target:'verifier'}
    ],
    research: [
      {title:tr('复现一个研究方法'),kind:'METHOD PACK',level:tr('方法贡献'),desc:tr('固定代码、输入和运行环境，帮助下一位研究者从可复跑的起点开始。'),delivery:tr('方法说明、版本化依赖、可公开样例与复现步骤。'),accept:tr('另一位贡献者可按步骤运行；引用与许可清楚；已知差异单独记录。'),target:'method-pack'},
      {title:tr('补充一组对照实验'),kind:'EXPERIMENT',level:tr('研究贡献'),desc:tr('沿用项目方法，测试另一组条件，把差异与适用范围说明白。'),delivery:tr('输入版本、参数、原始结果、比较图和限制说明。'),accept:tr('只改变任务允许的条件；保留基线；结果带运行记录且能独立复核。'),target:'comparison'},
      {title:tr('独立核对一份结果'),kind:'REVIEW',level:tr('复核贡献'),desc:tr('检查输入、方法、误差与结论之间的联系，也记录尚不能确认的部分。'),delivery:tr('检查清单、复核记录、发现的问题与待确认事项。'),accept:tr('区分数值正确与研究结论；引用被审阅的具体运行版本；没有依据时明确标注。'),target:'independent-review'}
    ],
    worker: [
      {title:tr('连接自己的开发环境'),kind:'LOCAL WORKER',level:tr('受信任节点'),desc:tr('先在本机跑通项目样例，验证工具环境与任务交付，而不是直接开放任意命令。'),delivery:tr('运行说明、隔离与权限配置、任务样例和结果。'),accept:tr('无需注册托管 Cloud；最小权限执行；退出后不残留长效凭据。'),target:'local-worker'},
      {title:tr('接入实验室服务器'),kind:'LAB WORKER',level:tr('团队部署'),desc:tr('让计算在已有数据与专业工具附近执行，明确哪些结果可以离开实验室。'),delivery:tr('资源标签、数据边界、队列适配和脱敏日志。'),accept:tr('管理员授权后接入；数据访问符合约束；取消与断连行为可检查。'),target:'lab-worker'},
      {title:tr('验证一套部署方式'),kind:'SELF-HOSTED',level:tr('协调服务'),desc:tr('把协调服务与节点接起来，检查重复事件、节点故障和人工验收的完整过程。'),delivery:tr('部署说明、故障演练、恢复记录与资源需求。'),accept:tr('重复事件不重复创建工作；掉线任务按规则恢复；人工决定不能被重试绕过。'),target:'self-hosted'}
    ]
  });
  const state = {source:'github', phase:0, busy:false, epoch:0, runs:[], reviewed:false, claimed:false, accepted:false, route:'lab', log:[], contribution:'build', tasks:[]};
  let toastTimeout;
  function toast(text) { const t=$('#toast'); t.textContent=text; t.classList.add('show'); clearTimeout(toastTimeout); toastTimeout=setTimeout(()=>t.classList.remove('show'),3600); }
  function event(text) { state.log.push({at:new Date().toISOString(),text}); $('#latest-event').textContent=text; }
  function saveFile(name,text,mime) { const url=URL.createObjectURL(new Blob([text],{type:mime||'text/plain;charset=utf-8'})); const a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),3000);toast(tr('已生成 {name}；没有上传到外部服务。',{name:name})); }
  function showDialog(title,html) {$('#collab-dialog-title').textContent=title;$('#collab-dialog-body').innerHTML=html;if(!dialog.open)dialog.showModal();}
  function taskContract() {
    return {schema:'openpero-task-concept/0.1',prototype:true,project_id:'oscillator-demo',title:SOURCES[state.source].title,source:{kind:state.source,simulated:true,github_issue:state.source==='github'?'example-12':null},inputs:{dataset:'synthetic-initial-state/1.0.0',damping_ratios:[0.08,0.22,0.40],duration_s:10,dt_s:0.1},method:{id:'rk4-oscillator/1.0.0',reference:'closed-form solution at matching parameters',initial_position:1,initial_velocity:0,natural_frequency_hz:0.4},artifacts:['results.csv','evidence.json'],acceptance:{sample_count_per_run:101,rmse_max_exclusive:0.001,finite_values_required:true,human_review_required:true,scope:'Checks numerical agreement with a mathematical model, not a scientific claim.'},policy:{all_execution_in_current_browser:true,network_allowed:false,credentials:'none',original_conclusions:'never overwrite'},tasks:[{id:'task-01',goal:'recompute baseline',damping_ratios:[0.08],depends_on:[],suggested_executor:'local-demo'},{id:'task-02',goal:'compare parameters',damping_ratios:[0.22,0.40],depends_on:[],suggested_executor:state.route+'-simulated'},{id:'task-03',goal:'independent review',depends_on:['task-01','task-02'],suggested_executor:'contributor-demo'}]};
  }
  function issueMarkdown(){return tr('# [Research] 比较三组阻尼参数的响应差异\n\n> OpenPero 官网演示模板。未连接真实 GitHub 仓库。\n\n## 所属项目\n阻尼响应研究 / oscillator-demo\n\n## 研究目标\n在相同模型与初始状态下，对照 ζ = 0.08、0.22、0.40 三组参数。\n\n## 固定输入与方法\n- 合成初始状态 v1：x(0)=1，v(0)=0。\n- 固有频率：0.4 Hz。\n- 方法：四阶 Runge–Kutta / 1.0.0。\n- 时间范围：0–10 s；步长 0.1 s。\n- 参考：同参数欠阻尼振子解析解。\n\n## 独立任务\n- [ ] T01：复跑 ζ=0.08 基线。\n- [ ] T02：运行 ζ=0.22、0.40 对照。\n- [ ] T03：独立复核 T01 与 T02 结果。\n\n## 交付\n- results.csv：原始结果、解析参考与误差。\n- evidence.json：方法、参数、输入版本与运行记录。\n- 差异与适用范围说明。\n\n## 验收条件\n- [ ] 每组 101 个数据点，所有数据有限。\n- [ ] 各组相对同参数解析解的 RMSE < 0.001。\n- [ ] 原始数据、参数和方法版本齐全。\n- [ ] 贡献者复核后，维护者决定是否纳入项目。\n\n## 非目标\n不验证真实物理系统；不声称复现了某篇论文；不覆盖已审阅结论；不允许任意远程执行。\n\n## 权限与执行位置\n本页面示例仅在当前浏览器执行。实际系统中需由维护者确认资源、数据权限、预算与受信任节点。\n');}
  function resultCheck(run){return run.sampleCount===101&&Number.isFinite(run.rmse)&&run.rmse<0.001&&run.solution.every(Number.isFinite)&&run.reference.every(Number.isFinite);}
  function bundle(){return {schema:'openpero-distributed-demo/0.1',exportedAt:new Date().toISOString(),scope:'Local browser prototype. No remote execution, real identities, GitHub events, persistent service or scientific claims.',task:taskContract(),routing:{simulated:true,selected:state.route,actual:'current browser JavaScript'},state:{phase:state.phase,reviewer_claimed:state.claimed,numerical_reviewed:state.reviewed,accepted_into_page_project:state.accepted,persistent:false},results:state.runs.map((r,i)=>({id:'run-'+String(i+1).padStart(3,'0'),actual_executor:'current browser',check_passed:resultCheck(r),...r})),events:state.log};}
  function markTask(name,status,label){const card=$('#task-'+name);card.classList.remove('running','done');if(status)card.classList.add(status);$('#state-'+name).textContent=label;$('#indicator-'+name).textContent=status==='done'?'✓':status==='running'?'◌':'○';}
  function updateSteps(){ $$('.studio-steps [data-phase]').forEach(el=>{const p=Number(el.dataset.phase);el.classList.toggle('current',p===state.phase||(p===2&&state.phase===3));el.classList.toggle('complete',p<state.phase && !(p===2&&state.phase===3));}); }
  function renderHero(){ $('#hero-task-count').textContent=state.phase?'3':tr('待拆分');$('#hero-progress').textContent=state.accepted?tr('成果已纳入本页项目'):state.reviewed?tr('复核完成，等待审阅'):state.runs.length===3?tr('计算完成，等待复核'):state.busy?tr('任务执行中'):state.phase?tr('任务已准备'):tr('等待你确认');$('#hero-t1').textContent=state.runs.length?tr('计算完成'):tr('本机 Worker');$('#hero-t2').textContent=state.runs.length===3?tr('对照完成'):state.route==='cloud'?tr('Cloud · 规划示意'):state.route==='local'?tr('本机 Worker'):tr('远程节点 · 示意');$('#hero-t3').textContent=state.accepted?tr('已纳入项目'):state.reviewed?tr('已复核'):state.claimed?tr('你已认领'):tr('开放认领');}
  function renderSource(){const src=SOURCES[state.source];$('#source-caption').textContent=src.caption;$('#source-title').textContent=src.title;$('#source-description').textContent=src.text;$('#source-footnote').textContent=src.note;$$('[data-source]').forEach(b=>{b.setAttribute('aria-pressed',String(b.dataset.source===state.source));b.disabled=state.busy;});}
  function renderResults(){
    const has=state.runs.length===3;$('#result-empty').hidden=has;$('#result-ready').hidden=!has;
    if(has){$('#distributed-results').innerHTML=state.runs.map(r=>'<tr><td>'+r.parameters.damping.toFixed(2)+'</td><td>'+r.rmse.toExponential(2)+'</td><td class="'+(resultCheck(r)?'check-pass':'check-fail')+'">'+escape(resultCheck(r)?tr('通过'):tr('未通过'))+'</td></tr>').join('');$('#review-status').textContent=state.accepted?tr('你已确认将结果纳入本页项目。记录仍可导出。'):state.reviewed?tr('数值复核已确认。仍需维护者审阅，才纳入项目。'):state.claimed?tr('你已认领复核任务。请检查参数、误差和适用范围。'):tr('自动检查已完成，等待贡献者复核。');$('#result-label').textContent=state.accepted?tr('已纳入'):state.reviewed?tr('待审阅'):tr('待复核');$('#review-results').textContent=state.accepted?tr('查看本页验收记录'):state.reviewed?tr('审阅并纳入项目'):state.claimed?tr('检查结果与适用范围'):tr('认领复核任务');requestAnimationFrame(drawDistributedChart);}
    $('#project-return-title').textContent=state.accepted?tr('一份成果，成为下一次研究的起点。'):tr('写回项目，不丢掉过程。');$('#project-return-text').textContent=state.accepted?tr('本页项目新增 3 组运行与 1 份复核记录。刷新会清空，建议导出保存。'):tr('只有经确认的成果，才更新本页项目记录。');
  }
  function render(){renderSource();updateSteps();renderHero();renderResults();$('#execution-route').disabled=state.phase>=2||state.busy;$('#advance-collaboration').disabled=state.busy||state.accepted;$('#cancel-collaboration').hidden=!state.busy;
    const labels=state.busy?tr('正在演示任务执行…'):state.accepted?tr('本页项目已更新 ✓'):state.phase===0?tr('整理成任务草稿 →'):state.phase===1?tr('确认并演示分发 →'):state.phase===2?tr('继续执行 →'):state.reviewed?tr('审阅并纳入项目 →'):state.claimed?tr('查看并复核结果 →'):tr('认领复核任务 →');$('#advance-collaboration').textContent=labels;
    $('#coordinator-status').textContent=state.busy?tr('执行中'):state.accepted?tr('已完成'):state.reviewed?tr('待审阅'):state.phase===3?tr('待复核'):state.phase===1?tr('待授权'):tr('待确认');
  }
  function reset(source){state.epoch++;state.source=source||state.source;state.phase=0;state.busy=false;state.runs=[];state.reviewed=false;state.claimed=false;state.accepted=false;state.tasks=[];state.log=[];markTask('baseline','',tr('等待任务草稿'));markTask('compare','',tr('与基线任务可并行'));markTask('review','',tr('计算完成后可认领'));event(tr(state.source==='github'?'示例 Issue 已准备好。先把目标整理成任务。':state.source==='proactive'?'示例建议已准备好。先把目标整理成任务。':'示例委托已准备好。先把目标整理成任务。'));render();}
  function prepare(){state.phase=1;state.tasks=taskContract().tasks;markTask('baseline','',tr('任务已准备 · 无依赖'));markTask('compare','',tr('任务已准备 · 可与 01 并行'));markTask('review','',tr('等待 01 与 02 的运行记录'));event(tr('已整理为 3 项任务，固定了输入、方法与验收条件。等待你的执行确认。'));render();}
  function dispatch(){
    if(!model||typeof model.run!=='function'){toast(tr('计算模块未能加载。请重新打开完整 HTML 文件。'));return;}
    state.phase=2;state.busy=true;state.runs=[];state.reviewed=false;state.claimed=false;state.accepted=false;const epoch=++state.epoch;markTask('baseline','running',tr('浏览器计算中 · 模拟本机节点'));markTask('compare','running',tr('浏览器计算中 · 模拟 {route} 节点',{route:state.route}));event(tr('已授权本页计算。两个执行位置仅为路由演示，不连接外部节点。'));render();
    setTimeout(()=>{if(epoch!==state.epoch)return;try{state.runs=[model.run({damping:0.08,dt:0.1,duration:10})];markTask('baseline','done',tr('101 个数据点 · 基线计算完成'));event(tr('任务 01 已完成：基线与运行记录已返回。'));renderHero();}catch(err){fail(err);}},350);
    setTimeout(()=>{if(epoch!==state.epoch)return;try{state.runs.push(model.run({damping:0.22,dt:0.1,duration:10}),model.run({damping:0.40,dt:0.1,duration:10}));markTask('compare','done',tr('两组对照已完成 · 记录已返回'));event(tr('任务 02 已完成：两组参数对照已返回。开始检查完整性与数值误差。'));renderHero();}catch(err){fail(err);}},750);
    setTimeout(()=>{if(epoch!==state.epoch)return;state.busy=false;if(state.runs.length!==3||!state.runs.every(resultCheck)){fail(new Error(tr('结果未通过预设数值检查。')));return;}state.phase=3;markTask('review','',tr('数值检查通过 · 等待贡献者认领'));event(tr('3 组计算均通过数值检查。现在需要独立复核，不会自动纳入项目。'));render();},1100);
  }
  function fail(err){state.epoch++;state.busy=false;state.phase=1;state.runs=[];markTask('baseline','',tr('运行中断 · 可重新执行'));markTask('compare','',tr('运行中断 · 未保留部分结果'));markTask('review','',tr('等待完整结果'));event(tr('运行失败：{message}',{message:String(err.message||err)}));render();}
  function cancel(){if(!state.busy)return;state.epoch++;state.busy=false;state.phase=1;state.runs=[];markTask('baseline','',tr('已取消 · 可以重新执行'));markTask('compare','',tr('已取消 · 不提交部分结果'));markTask('review','',tr('等待完整结果'));event(tr('本次演示运行已取消。部分结果不会写入项目，任务草稿仍保留。'));render();}
  function reviewTable(){return '<div class="table-scroll"><table class="review-table"><thead><tr><th>'+escape(tr('阻尼比 ζ'))+'</th><th>'+escape(tr('数据点'))+'</th><th>RMSE</th><th>'+escape(tr('最大误差'))+'</th></tr></thead><tbody>'+state.runs.map(r=>'<tr><td>'+r.parameters.damping.toFixed(2)+'</td><td>'+r.sampleCount+'</td><td>'+r.rmse.toExponential(4)+'</td><td>'+r.maxError.toExponential(4)+'</td></tr>').join('')+'</tbody></table></div>';}
  function review(){
    if(state.runs.length!==3){toast(tr('先确认任务并运行，再认领复核。'));return;}
    if(state.accepted){showDialog(tr('本页项目的验收记录'),'<p>'+escape(tr('你在当前页面演示中确认了复核与纳入操作。没有同步 GitHub，也没有持久保存到服务器。'))+'</p>'+reviewTable()+'<p class="scope-note">'+escape(tr('这些结果只检查数值方法与数学模型的一致性，不代表对真实物理系统或科学结论的验证。'))+'</p><div class="dialog-actions"><button class="btn btn-primary" data-collab-action="export-bundle">'+escape(tr('导出完整记录'))+'</button></div>');return;}
    if(!state.claimed){state.claimed=true;markTask('review','running',tr('已由你认领 · 本页模拟身份'));event(tr('你已在演示中认领复核任务，尚未确认结果。'));render();}
    if(state.reviewed){showDialog(tr('审阅后，再把结果纳入课题。'),'<p>'+escape(tr('三组数值结果已复核。确认后，本页项目将记录输入、方法、运行结果和你的验收动作，不覆盖已有结论。'))+'</p>'+reviewTable()+'<p class="scope-note">'+escape(tr('此处模拟维护者角色，不提供真实身份认证或审阅隔离。项目状态只保留到本页刷新前。'))+'</p><div class="dialog-actions"><button class="btn btn-primary" data-collab-action="accept">'+escape(tr('确认纳入本页项目'))+'</button><button class="btn btn-secondary" data-collab-action="close">'+escape(tr('暂不纳入'))+'</button></div>');return;}
    showDialog(tr('独立复核：先核对过程与适用范围。'),'<p>'+escape(tr('任务要求：固定同一方法与初始状态，计算三组阻尼比。每组 101 点，与同参数解析解比较，RMSE 必须小于 0.001。'))+'</p>'+reviewTable()+'<h3>'+escape(tr('这次检查能说明什么？'))+'</h3><p>'+escape(tr('它能检查 RK4 数值计算与解析数学模型的一致性。没有使用实验测量、真实论文或外部数据；不能据此声称真实系统已经得到验证。'))+'</p><p class="scope-note">'+escape(tr('运行位置：当前浏览器。远程节点与贡献者身份都是界面模拟。'))+'</p><label class="review-checkbox"><input type="checkbox" id="review-ack">'+escape(tr('我已核对参数、数据完整性和误差，并理解此次检查的适用范围。'))+'</label><div class="dialog-actions"><button class="btn btn-primary" id="submit-review" data-collab-action="review" disabled>'+escape(tr('提交本页复核记录'))+'</button><button class="btn btn-secondary" data-collab-action="close">'+escape(tr('稍后再看'))+'</button></div>');
  }
  function drawDistributedChart(){
    if(state.runs.length!==3||$('#result-ready').hidden)return;
    const canvas=$('#distributed-chart'),r=canvas.getBoundingClientRect();if(r.width<1)return;const ratio=Math.min(window.devicePixelRatio||1,2);canvas.width=Math.round(r.width*ratio);canvas.height=Math.round(r.height*ratio);const c=canvas.getContext('2d');c.scale(ratio,ratio);const w=r.width,h=r.height,p={l:30,r:8,t:10,b:23};const plotW=w-p.l-p.r,plotH=h-p.t-p.b;const X=t=>p.l+t/10*plotW;const Y=y=>p.t+(1.08-y)/2.16*plotH;c.clearRect(0,0,w,h);c.font='8px Consolas, monospace';c.fillStyle='#596B7D';c.lineWidth=1;c.textAlign='right';
    [-1,-.5,0,.5,1].forEach(y=>{c.strokeStyle=y===0?'#748599':'#DCE4ED';c.beginPath();c.moveTo(p.l,Y(y));c.lineTo(w-p.r,Y(y));c.stroke();c.fillText(y.toFixed(1),p.l-6,Y(y)+3);});c.textAlign='center';[0,2,4,6,8,10].forEach(t=>c.fillText(String(t),X(t),h-8));c.textAlign='right';c.fillText('s',w-1,h-8);
    ['#845EC2','#007F86','#B86A18'].forEach((color,i)=>{c.strokeStyle=color;c.lineWidth=1.9;c.setLineDash(i===0?[4,3]:i===2?[2,2]:[]);c.beginPath();state.runs[i].solution.forEach((v,j)=>{const x=X(state.runs[i].time[j]),y=Y(v);if(j)c.lineTo(x,y);else c.moveTo(x,y);});c.stroke();});c.setLineDash([]);
  }
  function templateMarkdown(item){return tr('# [Contribution] {title}\n\n> OpenPero 候选开发 / 研究 Issue 模板。请在发布前补充实际仓库、接口与负责人员。\n\n## 类型\n{kind} / {level}\n\n## 背景与目标\n{desc}\n\n## 交付\n{delivery}\n\n## 验收条件\n{accept}\n\n## 开始前需要由维护者补充\n- [ ] 接口或 Schema 版本及代码位置。\n- [ ] 可公开的输入样例、运行环境与预期输出。\n- [ ] 可本地执行的测试命令。\n- [ ] 数据、代码和第三方依赖许可。\n- [ ] 凭据、网络、资源和预算边界。\n\n## 贡献方式\n先在 Issue 确认范围，再提交实现、测试和运行证据。不要求使用托管 Cloud。\n\n## 非目标\n不开放未授权的远程执行；不把公共贡献者机器直接挂到任意 Issue 命令；不自动发布研究结论。\n', item);}
  function renderContributions(){const items=contributionSets[state.contribution];$$('[data-contribution]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.contribution===state.contribution)));$('#contribution-grid').innerHTML=items.map((item,i)=>'<article class="contribution-card"><div class="contribution-kind"><span>'+escape(item.kind)+'</span><span>'+escape(item.level)+'</span></div><h3>'+escape(item.title)+'</h3><p>'+escape(item.desc)+'</p><div class="contribution-delivery"><span>'+escape(tr('一份可以验收的交付'))+'</span>'+escape(item.delivery)+'</div><button class="text-link" data-template-index="'+i+'">'+escape(tr('查看 Issue 模板 ↗'))+'</button></article>').join('');}
  function openTemplate(index){const item=contributionSets[state.contribution][index];if(!item)return;showDialog(tr('{title} · Issue 模板',{title:item.title}),'<p>'+escape(tr('这是一份待完善的贡献任务，不是已经创建的 GitHub Issue。你可以编辑下方内容，再下载到自己的仓库使用。'))+'</p><label class="sr-only" for="issue-editor">'+escape(tr('编辑 Issue Markdown'))+'</label><textarea id="issue-editor" spellcheck="false">'+escape(templateMarkdown(item))+'</textarea><div class="dialog-actions"><button class="btn btn-primary" data-collab-action="download-template" data-filename="'+escape(item.target)+'">'+escape(tr('下载 Markdown'))+'</button></div>');}
  function exportCSV(){if(state.runs.length!==3){toast(tr('先运行示例，再导出结果。'));return;}const rows=['damping_ratio,time_s,displacement,analytical_reference,absolute_error'];state.runs.forEach(r=>r.time.forEach((t,i)=>rows.push([r.parameters.damping,t,r.solution[i],r.reference[i],r.absoluteError[i]].join(','))));saveFile('openpero-comparison-results.csv',rows.join('\n'),'text/csv;charset=utf-8');}
  function exportBundle(){if(state.runs.length!==3){toast(tr('先运行示例，再导出结果。'));return;}saveFile('openpero-task-evidence.json',JSON.stringify(bundle(),null,2),'application/json');}
  $('#advance-collaboration').addEventListener('click',()=>{if(state.busy)return;if(state.phase===0)prepare();else if(state.phase===1||state.phase===2)dispatch();else review();});
  $('#reset-collaboration').addEventListener('click',()=>{reset();toast(tr('演示已重置；没有更改外部服务。'));});
  $('#cancel-collaboration').addEventListener('click',cancel);
  $('#execution-route').addEventListener('change',e=>{if(state.phase>=2)return;state.route=e.target.value;event(tr('选择了 {route}。实际计算仍在本页执行。',{route:e.target.selectedOptions[0].text}));renderHero();});
  $('#export-issue').addEventListener('click',()=>saveFile('openpero-research-issue.md',issueMarkdown(),'text/markdown;charset=utf-8'));
  $('#view-contract').addEventListener('click',()=>showDialog(tr('一个任务，先把输入与验收说清楚。'),'<p>'+escape(tr('这是演示用契约草案，不是已发布的 OpenPero API。每个任务包含输入版本、方法、产物和验收条件；GitHub 只是一个来源。'))+'</p><pre>'+escape(JSON.stringify(taskContract(),null,2))+'</pre><div class="dialog-actions"><button class="btn btn-primary" data-collab-action="export-contract">'+escape(tr('下载任务契约'))+'</button></div>'));
  $('#view-activity').addEventListener('click',()=>showDialog(tr('本次协作过程'),'<p>'+escape(tr('所有时间与动作来自当前页面操作，不是云端日志。刷新后重置。'))+'</p><ol class="activity-list">'+state.log.map(e=>'<li><time>'+escape(e.at)+'</time>'+escape(e.text)+'</li>').join('')+'</ol>'));
  $('#review-results').addEventListener('click',review);
  $('#export-bundle').addEventListener('click',exportBundle);
  $('#export-results-csv').addEventListener('click',exportCSV);
  $('#download-all-issues').addEventListener('click',()=>saveFile('openpero-'+state.contribution+'-issue-templates.md',contributionSets[state.contribution].map(templateMarkdown).join('\n\n---\n\n'),'text/markdown;charset=utf-8'));
  $('.collab-close').addEventListener('click',()=>dialog.close());
  dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();}});
  document.addEventListener('change',e=>{if(e.target.id==='review-ack')$('#submit-review').disabled=!e.target.checked;});
  document.addEventListener('click',e=>{
    const b=e.target.closest('button,a');if(!b)return;
    if(b.dataset.source&&!state.busy){if(state.source!==b.dataset.source){if(state.runs.length){toast(tr('已切换示例来源，上一轮结果已重置。'));}reset(b.dataset.source);}}
    if(b.dataset.contribution){state.contribution=b.dataset.contribution;renderContributions();}
    if(b.dataset.deployment){$$('[data-deployment]').forEach(el=>el.setAttribute('aria-pressed',String(el===b)));$('#deployment-description').textContent=b.dataset.deployment==='self'?tr('自部署协调服务，连接受信任的执行节点。'):tr('托管协调服务仍在规划。即使服务在线，离线节点也不会继续计算。');}
    if(b.hasAttribute('data-open-lab')) requestAnimationFrame(()=>window.dispatchEvent(new Event('resize')));
    if(b.dataset.templateIndex!==undefined)openTemplate(Number(b.dataset.templateIndex));
    const action=b.dataset.collabAction;if(!action)return;
    if(action==='close')dialog.close();
    if(action==='export-contract')saveFile('openpero-task-contract.json',JSON.stringify(taskContract(),null,2),'application/json');
    if(action==='download-template')saveFile('openpero-issue-'+b.dataset.filename+'.md',$('#issue-editor').value,'text/markdown;charset=utf-8');
    if(action==='export-bundle')exportBundle();
    if(action==='review'&&$('#review-ack')?.checked&&state.runs.length===3&&state.runs.every(resultCheck)){state.reviewed=true;markTask('review','done',tr('复核已确认 · 等待维护者验收'));event(tr('贡献者复核已记录：输入、方法、误差与适用范围已确认。等待维护者审阅。'));dialog.close();render();toast(tr('复核完成。下一步由维护者决定是否纳入项目。'));}
    if(action==='accept'&&state.reviewed&&state.runs.length===3&&state.runs.every(resultCheck)){state.accepted=true;state.phase=4;markTask('review','done',tr('维护者已验收 · 已纳入本页项目'));event(tr('你已确认纳入本页项目：3 组运行 + 1 份复核记录。没有关闭真实 Issue 或发布研究结论。'));dialog.close();render();toast(tr('本页项目记录已更新；导出文件可保留这次结果。'));}
  });
  if('ResizeObserver' in window)new ResizeObserver(drawDistributedChart).observe($('#distributed-chart'));else window.addEventListener('resize',drawDistributedChart);
  window.OpenPeroDistributedDemo=Object.freeze({snapshot:()=>JSON.parse(JSON.stringify(bundle()))});
  reset();renderContributions();
})();
