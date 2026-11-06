import React, { useEffect, useRef, useState } from 'react';
import { useAppI18n, useHostCapability, type AppAgentRun, type AppAgentScope } from '@pero/app-sdk';
import { Button, Feedback, PageHeader, Split, SplitPane } from '@pero/app-sdk/ui';
import type { Api, Paper } from './types';
import './research-programs.css';

const messages = {
  title: {zh:'自动研究',en:'Autonomous research'}, new: {zh:'新建计划',en:'New plan'}, empty:{zh:'选择已保存的论文，写下问题并设定研究范围。',en:'Choose a saved paper, a question and the scope of your research.'},
  question:{zh:'研究问题',en:'Research question'}, scope:{zh:'研究范围',en:'Scope'}, inclusion:{zh:'纳入标准',en:'Include'}, exclusion:{zh:'排除标准',en:'Exclude'}, seeds:{zh:'起始论文（1–5 篇）',en:'Seed papers (1–5)'},
  acquisition:{zh:'论文获取',en:'Source acquisition'}, saved:{zh:'只读已保存的原文',en:'Saved sources only'}, publicFulltext:{zh:'允许公开 PDF 和固定版本官方 HTML',en:'Allow public PDFs and fixed-version official HTML'}, previous:{zh:'上一页',en:'Previous'}, next:{zh:'下一页',en:'Next'}, more:{zh:'更多计划',en:'More plans'}, public:{zh:'允许下载候选论文的公开 PDF',en:'Allow public candidate PDFs'},
  rounds:{zh:'研究轮数',en:'Rounds'}, searches:{zh:'检索次数',en:'Searches'}, reads:{zh:'阅读步数',en:'Reading steps'}, modelRequests:{zh:'模型请求总数',en:'Total model requests'}, minutes:{zh:'时限（分钟）',en:'Time limit (minutes)'},
  save:{zh:'保存计划',en:'Save plan'}, start:{zh:'启动研究',en:'Start research'}, pause:{zh:'暂停',en:'Pause'}, resume:{zh:'继续研究',en:'Resume research'}, stop:{zh:'停止研究',en:'Stop research'}, chat:{zh:'打开会话与产物',en:'Open conversation and artifacts'},
  loading:{zh:'正在读取…',en:'Loading…'}, retry:{zh:'重新读取',en:'Reload'}, review:{zh:'待人工复核',en:'Needs review'},
  reviewNote:{zh:'引用已核对到保存的原文；这不代表结论已经科学验证。',en:'Citations match saved source passages; conclusions still require scientific review.'},
  planNote:{zh:'保存不会启动 Agent。启动后会自动检索、筛选、阅读并按轮交付报告，直到达到额度、时限或遇到阻塞。',en:'Saving does not start an Agent. Starting authorizes search, screening, reading and delivery within this plan’s limits.'},
  limitsNote:{zh:'候选上限 24 篇，下载上限 6 次 / 60 MiB，应用调用上限 80 次；连续两轮无新证据或筛选变化时停止。额度跨暂停和重启累计。',en:'Up to 24 candidates, 6 downloads / 60 MiB and 80 App calls. Stop after two rounds without new evidence or screening changes. Allowances persist across pauses and restarts.'},
  deadline:{zh:'截止时间',en:'Deadline'}, candidates:{zh:'候选论文',en:'Candidates'}, evidence:{zh:'研究记录',en:'Research record'}, gaps:{zh:'尚待解决的问题',en:'Open questions'},
  noRounds:{zh:'尚未形成一轮报告。执行进度见会话，检索和下载任务见下方。',en:'No round report yet. Follow the conversation and the jobs below.'}, noPapers:{zh:'先向文库添加至少一篇论文。',en:'Add at least one paper to the library first.'},
  ready:{zh:'计划已保存，尚未启动',en:'Plan saved; not started'}, unavailable:{zh:'需要配置可用的 Pero Agent。完成配置后重新读取。',en:'Configure an available Pero Agent, then reload.'},
  running:{zh:'研究中',en:'Running'}, cancelling:{zh:'正在暂停',en:'Pausing'}, cancelled:{zh:'已暂停',en:'Paused'}, completed:{zh:'本次执行已结束',en:'Run ended'}, failed:{zh:'执行失败',en:'Run failed'}, interrupted:{zh:'执行中断',en:'Interrupted'}, needs_input:{zh:'等待处理',en:'Needs attention'},
  include:{zh:'纳入',en:'Included'}, exclude:{zh:'排除',en:'Excluded'}, pending:{zh:'待筛选',en:'Pending'}, source:{zh:'查看来源报告',en:'Source report'}, jobs:{zh:'检索与下载',en:'Search and acquisition'},
  round_limit:{zh:'达到轮数上限',en:'Round limit reached'}, no_progress:{zh:'连续无新进展',en:'No further progress'}, user_stopped:{zh:'用户已停止',en:'Stopped by user'}, scope_exhausted:{zh:'研究范围内无更多工作',en:'Scope exhausted'}, budget_exhausted:{zh:'研究额度耗尽',en:'Budget exhausted'}, ready_for_review:{zh:'研究结果可供复核',en:'Ready for review'},
  runtime_incomplete:{zh:'研究尚未完成',en:'Research incomplete'}, deadline_reached:{zh:'已达到研究时限',en:'Research deadline reached'}, storage_capacity:{zh:'存储容量已满',en:'Storage capacity reached'}, expired:{zh:'计划时限已到；保留结果，可新建计划继续。',en:'The plan deadline has passed. Results are preserved; create a new plan to continue.'},
  downloads:{zh:'下载次数',en:'Downloads'}, downloadBytes:{zh:'下载字节',en:'Download bytes'}, appCalls:{zh:'应用调用',en:'App calls'}, saveFirst:{zh:'保存后核对计划，再启动研究。',en:'Save and review the plan before starting.'},
} as const;

type Limits = {rounds:number;searches:number;candidates:number;reads:number;downloads:number;downloadBytes:number;modelRequests:number;appCalls:number};
type Candidate = {id:string;title:string;url:string;decision:string;reason:string;blocker:string|null;documentId:string|null};
type Round = {id:string;number:number;question:string;claims:{text:string;stance:string;quote:string;reportId:string;passageId?:string;sourceKind?:string;sourceUrl?:string}[];gaps:string[];nextAction:string;newEvidence:number};
type Page = {offset:number;total:number;nextOffset:number|null};
type Program = {id:string;checkpoint:string;protocol:{question:string;scope:string;inclusion:string;exclusion:string;seedPaperIds:string[];acquisition:string;limits:Limits;deadline:string};
  candidatePage?:Page;roundPage?:Page;usage:Omit<Limits,'modelRequests'>;runtime:{status:string;modelRequestsUsed:number;appCallsUsed:number}|null;candidates:Candidate[];rounds:Round[];gaps:string[];stopReason:string|null;jobs:{id:string;status:string;input:{operation:string;query?:{query?:string;relation?:string}};error:string;outcome?:{status:string;errors:{source:string;error:string}[];warnings:{source:string;message:string}[]}}[]};

export function ResearchPrograms({api,papers,seed}:{api:Api;papers:Paper[];seed:Paper|null}) {
  const {t}=useAppI18n(messages), agent=useHostCapability('agent');
  const createId=useRef(crypto.randomUUID());
  const panel=useRef<HTMLDivElement>(null);
  const [programs,setPrograms]=useState<Program[]>([]),[selected,setSelected]=useState<Program|null>(null),[run,setRun]=useState<AppAgentRun|null>(null);
  const [scope,setScope]=useState<AppAgentScope|null>(null),[available,setAvailable]=useState(false),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState('');
  const [seeds,setSeeds]=useState<string[]>(seed?[seed.id]:[]),[question,setQuestion]=useState(''),[researchScope,setResearchScope]=useState(''),[inclusion,setInclusion]=useState(''),[exclusion,setExclusion]=useState('');
  const [candidateOffset,setCandidateOffset]=useState(0),[roundOffset,setRoundOffset]=useState(0),[listNext,setListNext]=useState<number|null>(null);
  const [acquisition,setAcquisition]=useState('saved_only'),[limits,setLimits]=useState({rounds:3,searches:8,reads:24,modelRequests:40}),[minutes,setMinutes]=useState(30);
  const active=!!run&&['running','cancelling','needs_input'].includes(run.status), expired=!!selected&&Date.now()>=Date.parse(selected.protocol.deadline);
  const fail=(value:unknown)=>setError(value instanceof Error?value.message:String(value));
  async function reload() {
    setLoading(true);setError('');
    try {
      const [list,workspaces,harnesses]=await Promise.all([
        api.post<{programs:Program[];page?:Page}>('/api/programs',{operation:'list'}),
        api.get<{items:{workspaceId:string}[]}>('/api/workspaces'),api.get<{items:{id:string;available:boolean}[]}>('/api/harnesses')]);
      setPrograms(list.programs);setListNext(list.page?.nextOffset??null);setScope(workspaces.items[0]?{workspaceId:workspaces.items[0].workspaceId}:null);
      setAvailable(harnesses.items.some(h=>h.id==='pero'&&h.available));
    } catch(e){fail(e)} finally{setLoading(false)}
  }
  useEffect(()=>{void reload()},[api]);
  useEffect(()=>{if(seed){setSeeds([seed.id]);setSelected(null);setRun(null)}},[seed?.id]);
  useEffect(()=>{panel.current?.scrollTo({top:0})},[selected?.id]);
  useEffect(()=>{
    if(!selected||!scope||!agent)return;
    let alive=true,timer:ReturnType<typeof setTimeout>;
    const id=selected.id;
    async function poll(){
      try {
        const lookup=await agent!.call<{run:AppAgentRun|null}>('lookup',{scope:scope!,requestId:id});
        const next=lookup.run?await agent!.call<AppAgentRun>('status',{scope:scope!,runId:lookup.run.id}):null;
        const saved=await api.post<Program>('/api/programs',{operation:'read',programId:id,offset:candidateOffset,roundOffset,roundLimit:1});
        if(!alive)return;setRun(next);setSelected(saved);
        setPrograms(items=>items.map(p=>p.id===id?saved:p));
        if(next&&['running','cancelling','needs_input'].includes(next.status))timer=setTimeout(()=>void poll(),2000);
      } catch(e){if(alive)fail(e)}
    }
    void poll();return()=>{alive=false;clearTimeout(timer)};
  },[selected?.id,scope,agent,run?.attempt,run?.status==='running',busy,candidateOffset,roundOffset]);
  async function perform(action:()=>Promise<void>){setBusy(true);setError('');try{await action()}catch(e){fail(e)}finally{setBusy(false)}}
  async function save(){
    const saved=await api.post<Program>('/api/programs',{operation:'create',requestId:createId.current,question,scope:researchScope,inclusion,exclusion,seedPaperIds:seeds,acquisition,limits,minutes});
    setCandidateOffset(0);setRoundOffset(0);setSelected(saved);setRun(null);setPrograms(items=>[saved,...items]);
  }
  async function start(){
    if(!agent||!scope||!selected)return;
    const launch=await api.post<{context:Record<string,unknown>;prompt:string}>('/api/programs',{operation:'launch',programId:selected.id});
    const next=await agent.call<AppAgentRun>('start',{scope,requestId:selected.id,harnessId:'pero',text:launch.prompt,context:launch.context});
    setRun(next);await agent.call('open',{sessionId:next.sessionId});
  }
  async function control(action:'cancel'|'retry'|'stop'){
    if(!agent||!scope||!run||!selected)return;
    if(action==='stop'){
      const saved=await api.post<Program>('/api/programs',{operation:'stop',programId:selected.id,operationId:crypto.randomUUID()});setSelected(saved);
      setRun(await agent.call<AppAgentRun>('cancel',{scope,runId:run.id}));
    }else setRun(await agent.call<AppAgentRun>(action,{scope,runId:run.id,...(action==='retry'?{requestId:crypto.randomUUID()}:{})}));
  }
  const fields=[['question',question,setQuestion],['scope',researchScope,setResearchScope],['inclusion',inclusion,setInclusion],['exclusion',exclusion,setExclusion]] as const;
  return <div className="pa-programs" ref={panel}>
    <PageHeader title={t('title')} actions={<><Button disabled={busy} onClick={()=>{setSelected(null);setRun(null);setError('');createId.current=crypto.randomUUID()}}>{t('new')}</Button><Button disabled={busy||loading} onClick={()=>void reload()}>{t('retry')}</Button></>}/>
    {error&&<Feedback kind="error">{error}</Feedback>}
    <Split storageKey="paper-agent.programs" collapseBelow={760}>
      <SplitPane id="program-list" size={220} min={160} stackedBasis="auto" resizeLabel={t('title')}>
        <nav className="pa-program-list" aria-label={t('title')}>
          {loading&&<p role="status">{t('loading')}</p>}
          {!loading&&!programs.length&&<p>{t('empty')}</p>}
          {programs.map(p=><button key={p.id} aria-current={selected?.id===p.id?'page':undefined} disabled={busy} onClick={()=>void perform(async()=>{const detail=await api.post<Program>('/api/programs',{operation:'read',programId:p.id,roundLimit:1});setCandidateOffset(0);setRoundOffset(0);setSelected(detail);setRun(null)})}><strong>{p.protocol.question}</strong><span>{p.usage.rounds}/{p.protocol.limits.rounds} {t('rounds')}</span></button>)}
        {listNext!==null&&<Button disabled={busy} onClick={()=>void perform(async()=>{const page=await api.post<{programs:Program[];page:Page}>('/api/programs',{operation:'list',offset:listNext});setPrograms(items=>[...items,...page.programs]);setListNext(page.page.nextOffset)})}>{t('more')}</Button>}</nav>
      </SplitPane>
      <SplitPane id="program-detail" min={320}>
        {!selected?<form className="pa-program-plan" onSubmit={event=>{event.preventDefault();void perform(save)}}>
          <p>{t('planNote')}</p>
          <fieldset disabled={busy}><legend>{t('seeds')}</legend>{papers.length?papers.map(p=><label className="pa-program-seed" key={p.id}><input type="checkbox" checked={seeds.includes(p.id)} disabled={!seeds.includes(p.id)&&seeds.length>=5} onChange={e=>setSeeds(ids=>e.target.checked?[...ids,p.id]:ids.filter(id=>id!==p.id))}/>{p.title}</label>):<p>{t('noPapers')}</p>}</fieldset>
          {fields.map(([key,value,set])=><label key={key}>{t(key)}<textarea required maxLength={4000} value={value} onChange={e=>set(e.target.value)} disabled={busy} rows={key==='question'?3:2}/></label>)}
          <label>{t('acquisition')}<select value={acquisition} onChange={e=>setAcquisition(e.target.value)} disabled={busy}><option value="saved_only">{t('saved')}</option><option value="public_pdf">{t('public')}</option><option value="public_fulltext">{t('publicFulltext')}</option></select></label>
          <div className="pa-program-limits">{Object.entries(limits).map(([key,value])=><label key={key}>{t(key)}<input type="number" min={1} max={key==='rounds'?32:key==='searches'?100:500} value={value} required disabled={busy} onChange={e=>setLimits(x=>({...x,[key]:Number(e.target.value)}))}/></label>)}<label>{t('minutes')}<input type="number" min={1} max={240} required value={minutes} disabled={busy} onChange={e=>setMinutes(Number(e.target.value))}/></label></div>
          <p>{t('limitsNote')}</p><Button type="submit" disabled={busy||!seeds.length}>{t('save')}</Button>
        </form>:<div className="pa-program-detail">
          <h2>{selected.protocol.question}</h2>
          <div className="pa-program-actions">
            {!run&&<Button disabled={busy||!agent||!scope||!available||expired||!!selected.stopReason} onClick={()=>void perform(start)}>{t('start')}</Button>}
            {run&&<><Button disabled={busy||!agent} onClick={()=>void perform(async()=>{await agent!.call('open',{sessionId:run.sessionId})})}>{t('chat')}</Button>
              {active?<Button disabled={busy||run.status==='cancelling'} onClick={()=>void perform(()=>control('cancel'))}>{t('pause')}</Button>:<Button disabled={busy||expired||!!selected.stopReason&&!['needs_input','runtime_incomplete'].includes(selected.stopReason)} onClick={()=>void perform(()=>control('retry'))}>{t('resume')}</Button>}
              {!selected.stopReason&&<Button disabled={busy} onClick={()=>void perform(()=>control('stop'))}>{t('stop')}</Button>}</>}
          </div>
          <p role="status">{selected.stopReason?t(selected.stopReason):run?t(run.status):t('ready')}</p>
          {!available&&!run&&<Feedback kind="error">{t('unavailable')}</Feedback>}
          {run?.error&&<Feedback kind="error">{run.error}</Feedback>}
          {expired&&<p>{t('expired')}</p>}
          <p>{t('deadline')}: {new Date(selected.protocol.deadline).toLocaleString()}</p>
          <details><summary>{t('scope')}</summary><p>{selected.protocol.scope}</p><p>{t('inclusion')}: {selected.protocol.inclusion}</p><p>{t('exclusion')}: {selected.protocol.exclusion}</p><p>{t('acquisition')}: {t(selected.protocol.acquisition==='public_fulltext'?'publicFulltext':selected.protocol.acquisition==='public_pdf'?'public':'saved')}</p></details>
          <dl className="pa-program-usage">{Object.entries(selected.protocol.limits).map(([key,limit])=><div key={key}><dt>{t(key)}</dt><dd>{key==='modelRequests'?selected.runtime?.modelRequestsUsed??0:key==='appCalls'?selected.runtime?.appCallsUsed??0:selected.usage[key as keyof Program['usage']]??0} / {limit}</dd></div>)}</dl>
          <h3>{t('evidence')}</h3>{!!selected.rounds.length&&<><p>{t('review')}</p><p>{t('reviewNote')}</p></>}
          {!selected.rounds.length&&<p>{t('noRounds')}</p>}
          {selected.rounds.map(round=><details key={round.id} open={round.number===selected.rounds.length}><summary>{round.number}. {round.question}</summary>{round.claims.map((claim,i)=><div key={i}><p>{claim.text}</p><blockquote>{claim.quote}</blockquote><a href={claim.sourceKind==='html'?claim.sourceUrl:`pero-app-location://paper-agent/main/report/${claim.reportId}/passage/${claim.passageId}`}>{t('source')}</a></div>)}<p>{round.nextAction}</p></details>)}
          {selected.roundPage&&selected.roundPage.total>1&&<div className="pa-program-actions"><Button disabled={busy||roundOffset===0} onClick={()=>setRoundOffset(Math.max(0,roundOffset-1))}>{t('previous')}</Button><span>{selected.roundPage.offset+1} / {selected.roundPage.total}</span><Button disabled={busy||selected.roundPage.nextOffset===null} onClick={()=>setRoundOffset(selected.roundPage!.nextOffset!)}>{t('next')}</Button></div>}
          {!!selected.gaps.length&&<><h3>{t('gaps')}</h3><ul>{selected.gaps.map(g=><li key={g}>{g}</li>)}</ul></>}
          <h3>{t('candidates')}</h3><ul className="pa-program-candidates">{selected.candidates.map(c=><li key={c.id}><strong>{c.title}</strong><span>{t(c.decision)}: {c.reason}</span>{c.blocker&&<p>{c.blocker}</p>}</li>)}</ul>
          {selected.candidatePage&&selected.candidatePage.total>10&&<div className="pa-program-actions"><Button disabled={busy||candidateOffset===0} onClick={()=>setCandidateOffset(Math.max(0,candidateOffset-10))}>{t('previous')}</Button><span>{selected.candidatePage.offset+1}–{selected.candidatePage.offset+selected.candidates.length} / {selected.candidatePage.total}</span><Button disabled={busy||selected.candidatePage.nextOffset===null} onClick={()=>setCandidateOffset(selected.candidatePage!.nextOffset!)}>{t('next')}</Button></div>}
          {!!selected.jobs.length&&<><h3>{t('jobs')}</h3><ul>{selected.jobs.map(job=><li key={job.id}>{job.input.query?.query||job.input.query?.relation||job.input.operation}: {job.outcome?.status||job.status}{job.error&&<p role="alert">{job.error}</p>}{job.outcome?.errors.map((e,i)=><p key={i} role="alert">{e.source}: {e.error}</p>)}{job.outcome?.warnings.map((w,i)=><p key={i}>{w.source}: {w.message}</p>)}</li>)}</ul></>}
        </div>}
      </SplitPane>
    </Split>
  </div>;
}
