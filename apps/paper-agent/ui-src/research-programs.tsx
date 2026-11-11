import React, { useEffect, useRef, useState } from 'react';
import { useAppI18n } from '@pero/app-sdk';
import { Badge, Button, Checkbox, Dialog, Disclosure, EmptyState, Feedback, Field, Icon, Input, ListRow, Select, Split, SplitPane, Tabs, TabsContent, TabsList, TabsTrigger, Textarea } from '@pero/app-sdk/ui';
import type { Api, Paper } from './types';
import { useResearchProgramState, type Program, type ProgramClaim } from './research-program-state';
import './research-programs.css';

const messages = {
  title:{zh:'自动研究',en:'Autonomous research'}, new:{zh:'新建计划',en:'New plan'}, draft:{zh:'新研究计划',en:'New research plan'}, draftNote:{zh:'围绕一个问题，整理原文证据与仍待解决的分歧。',en:'Explore one question through source evidence and unresolved questions.'},
  history:{zh:'研究计划',en:'Research plans'}, question:{zh:'研究问题',en:'Research question'}, questionHint:{zh:'说明你希望比较、解释或验证什么。',en:'What would you like to compare, explain or verify?'}, questionPlaceholder:{zh:'例如：哪些实验条件会影响这一结论？现有证据是否一致？',en:'For example: which experimental conditions affect this conclusion, and does the evidence agree?'},
  scope:{zh:'研究范围',en:'Scope'}, scopePlaceholder:{zh:'限定对象、条件、时间或方法。',en:'Define the subjects, conditions, period or methods.'}, criteria:{zh:'范围与筛选',en:'Scope and screening'}, inclusion:{zh:'纳入标准',en:'Include'}, exclusion:{zh:'排除标准',en:'Exclude'},
  seeds:{zh:'起始论文',en:'Starting papers'}, seedHint:{zh:'选择 1–5 篇已保存的论文，作为研究的起点。',en:'Choose 1–5 saved papers to ground the research.'}, searchPapers:{zh:'查找已保存论文',en:'Find saved papers'}, noMatch:{zh:'没有匹配的论文',en:'No matching papers'}, noPapers:{zh:'还没有起始论文',en:'Add a starting paper'}, noPapersHint:{zh:'先把论文加入文库，再回来继续填写。草稿会保留。',en:'Add a paper to the library, then return here. Your draft will be kept.'}, addPapers:{zh:'前往文库',en:'Go to library'},
  acquisition:{zh:'可读取的来源',en:'Sources to read'}, saved:{zh:'仅已保存原文',en:'Saved sources only'}, public:{zh:'已保存原文与公开 PDF',en:'Saved sources and public PDFs'}, publicFulltext:{zh:'含固定版本官方 HTML',en:'Also fixed-version official HTML'},
  execution:{zh:'执行范围',en:'Execution limits'}, adjust:{zh:'调整额度与时限',en:'Adjust limits and time'}, rounds:{zh:'轮',en:'rounds'}, searches:{zh:'检索',en:'searches'}, reads:{zh:'阅读',en:'reads'}, modelRequests:{zh:'模型请求',en:'model requests'}, minutes:{zh:'分钟',en:'minutes'},
  limitRounds:{zh:'研究轮数',en:'Research rounds'}, limitSearches:{zh:'检索次数',en:'Searches'}, limitReads:{zh:'阅读步数',en:'Reading steps'}, limitModelRequests:{zh:'模型请求总数',en:'Model requests'}, limitMinutes:{zh:'时限（分钟）',en:'Time limit (minutes)'},
  limitsNote:{zh:'另含 24 篇候选、6 次下载 / 60 MiB、80 次应用调用。额度跨暂停与重启累计。',en:'Also limited to 24 candidates, 6 downloads / 60 MiB and 80 App calls. Allowances persist across pauses and restarts.'},
  save:{zh:'保存并核对计划',en:'Save and review plan'}, saving:{zh:'正在保存…',en:'Saving…'}, saveNote:{zh:'保存不会启动 Agent。核对计划后，由你启动研究。',en:'Saving does not start an Agent. Review the plan before starting.'}, selectFirst:{zh:'选择至少一篇起始论文后即可保存。',en:'Select at least one starting paper to save.'},
  start:{zh:'启动研究',en:'Start research'}, pause:{zh:'暂停',en:'Pause'}, resume:{zh:'继续研究',en:'Resume research'}, stop:{zh:'停止研究',en:'Stop research'}, stopTitle:{zh:'停止这项研究？',en:'Stop this research?'}, stopNote:{zh:'已保存的报告与证据会保留。此计划停止后，需要新建计划继续研究。',en:'Saved reports and evidence will be kept. Create a new plan to continue after stopping.'}, cancel:{zh:'返回',en:'Go back'}, close:{zh:'关闭',en:'Close'}, chat:{zh:'打开会话与产物',en:'Open conversation and artifacts'},
  loading:{zh:'正在读取研究计划…',en:'Loading research plans…'}, refreshing:{zh:'正在更新…',en:'Updating…'}, retry:{zh:'刷新',en:'Refresh'}, retained:{zh:'显示上次读取的计划。',en:'Showing the last loaded plans.'}, readLoading:{zh:'正在读取记录…',en:'Loading record…'}, retryRead:{zh:'重试读取',en:'Retry loading'},
  review:{zh:'待人工复核',en:'Needs review'}, reviewNote:{zh:'引用已核对到保存的原文；研究结论仍需人工复核。',en:'Citations match saved source passages; conclusions still require human review.'},
  ready:{zh:'计划已保存，尚未启动',en:'Plan saved; not started'}, unavailable:{zh:'启动研究需要可用的 Pero Agent 与工作目录。已保存的报告仍可阅读。',en:'Starting requires an available Pero Agent and workspace. Saved reports remain readable.'}, checking:{zh:'正在检查执行条件…',en:'Checking execution requirements…'},
  staleRun:{zh:'执行状态暂未更新，显示上次记录。已保存的报告仍可阅读。',en:'Execution status could not be updated; showing the last record. Saved reports remain readable.'},
  lastRun:{zh:'上次执行状态：',en:'Last recorded execution: '},
  unconfirmedRun:{zh:'需要先确认已有执行状态，才能继续操作。请刷新重试，已保存的记录会保留。',en:'Confirm the existing execution before continuing. Refresh to retry; saved records will be kept.'},
  failedSelection:{zh:'无法读取研究计划：',en:'Could not load research plan: '},
  running:{zh:'研究中',en:'Running'}, cancelling:{zh:'正在暂停',en:'Pausing'}, cancelled:{zh:'已暂停',en:'Paused'}, completed:{zh:'本次执行已结束',en:'Run ended'}, failed:{zh:'执行失败',en:'Run failed'}, interrupted:{zh:'执行中断',en:'Interrupted'}, needs_input:{zh:'等待处理',en:'Needs attention'},
  include:{zh:'纳入',en:'Included'}, exclude:{zh:'排除',en:'Excluded'}, pending:{zh:'待筛选',en:'Pending'}, source:{zh:'查看来源报告',en:'Source report'}, jobs:{zh:'检索与下载',en:'Search and acquisition'},
  round_limit:{zh:'达到轮数上限',en:'Round limit reached'}, no_progress:{zh:'连续无新进展',en:'No further progress'}, user_stopped:{zh:'用户已停止',en:'Stopped by user'}, scope_exhausted:{zh:'研究范围内无更多工作',en:'Scope exhausted'}, budget_exhausted:{zh:'研究额度耗尽',en:'Budget exhausted'}, ready_for_review:{zh:'研究结果可供复核',en:'Ready for review'},
  runtime_incomplete:{zh:'研究尚未完成',en:'Research incomplete'}, deadline_reached:{zh:'已达到研究时限',en:'Research deadline reached'}, storage_capacity:{zh:'存储容量已满',en:'Storage capacity reached'}, expired:{zh:'计划时限已到。结果已保留，可新建计划继续。',en:'The deadline has passed. Results are preserved; create a new plan to continue.'},
  deadline:{zh:'截止时间',en:'Deadline'}, candidates:{zh:'候选论文',en:'Candidate papers'}, reports:{zh:'研究报告',en:'Reports'}, plan:{zh:'研究计划',en:'Plan'}, progress:{zh:'进展与额度',en:'Progress and allowances'}, openQuestions:{zh:'尚待解决的问题',en:'Open questions'},
  noRounds:{zh:'尚未形成报告',en:'No report yet'}, noRoundsHint:{zh:'研究会按轮保存报告。运行中的步骤可以在会话中查看。',en:'Reports are saved after each round. Follow ongoing steps in the conversation.'}, noCandidates:{zh:'尚无候选论文',en:'No candidates yet'}, noCandidatesHint:{zh:'研究开始检索后，候选论文及筛选依据会出现在这里。',en:'Candidate papers and screening reasons will appear after searching begins.'},
  nextAction:{zh:'下一步',en:'Next action'}, round:{zh:'第',en:'Round'}, newEvidence:{zh:'新证据',en:'New evidence'}, previous:{zh:'上一页',en:'Previous'}, next:{zh:'下一页',en:'Next'}, more:{zh:'更多计划',en:'More plans'},
  noProgressLimit:{zh:'连续无新进展轮数',en:'Rounds without progress'}, unknownUsage:{zh:'尚未报告',en:'Not yet reported'}, support:{zh:'支持证据',en:'Supporting evidence'}, counterevidence:{zh:'反证',en:'Counterevidence'}, limitation:{zh:'局限',en:'Limitation'}, originalSource:{zh:'原始来源',en:'Original source'}, studies:{zh:'已保存的阅读批次',en:'Saved reading batches'}, studiesNote:{zh:'阅读记录与来源报告独立保存，尚未汇入研究轮次的内容也可查看。',en:'Reading records and source reports are saved independently, including work not yet committed to a research round.'}, openStudy:{zh:'查看阅读记录',en:'Open reading record'},
  downloads:{zh:'下载次数',en:'Downloads'}, downloadBytes:{zh:'下载字节',en:'Download bytes'}, appCalls:{zh:'应用调用',en:'App calls'},
} as const;

export function ResearchPrograms({api,papers,seed,active=true,onLibrary,onCitation,onStudy}:{api:Api;papers:Paper[];seed:Paper|null;active?:boolean;onLibrary?:()=>void;onCitation?:(claim:ProgramClaim)=>Promise<void>;onStudy?:(id:string)=>Promise<void>}) {
  const {t}=useAppI18n(messages);
  const state=useResearchProgramState(api,seed,active);
  const {programs,selected,run,agent,scope,available,busy,listLoaded,listLoading,listRefreshing,listError,capabilityError,capabilitiesLoading,runLookupReady,readLoading,error,failedSelection,
    seeds,setSeeds,question,setQuestion,researchScope,setResearchScope,inclusion,setInclusion,exclusion,setExclusion,acquisition,setAcquisition,limits,setLimits,minutes,setMinutes,noProgressLimit,setNoProgressLimit,
    candidateOffset,setCandidateOffset,roundOffset,setRoundOffset,listNext,active:runActive,expired,reload,perform,save,start,control,newPlan,selectProgram,retryRead,morePrograms}=state;
  const panel=useRef<HTMLDivElement>(null),form=useRef<HTMLFormElement>(null);
  const [paperQuery,setPaperQuery]=useState(''),[stopOpen,setStopOpen]=useState(false),[detailTab,setDetailTab]=useState('plan');
  useEffect(()=>{panel.current?.scrollTo({top:0});setDetailTab(selected&&(selected.rounds.length||selected.studies?.length||selected.runtime)?'reports':'plan')},[selected?.id]);
  useEffect(()=>{if(run)setDetailTab('reports')},[run?.id]);
  const visiblePapers=papers.filter(p=>p.title.toLocaleLowerCase().includes(paperQuery.toLocaleLowerCase()));
  const submit=()=>{if(!busy&&seeds.length&&form.current?.reportValidity())void perform(save)};
  const budgetSummary=limits.rounds+' '+t('rounds')+' · '+limits.searches+' '+t('searches')+' · '+limits.reads+' '+t('reads')+' · '+limits.modelRequests+' '+t('modelRequests')+' · '+minutes+' '+t('minutes');
  const allowance=(key:string,value:number)=>key==='downloadBytes'?(value/1048576).toLocaleString()+' MiB':value.toLocaleString();
  const draft=<form ref={form} className="pa-program-plan" aria-label={t('draft')} onSubmit={event=>{event.preventDefault();submit()}} onKeyDown={event=>{
    if(event.defaultPrevented||event.key!=='Enter'||event.nativeEvent.isComposing||event.nativeEvent.keyCode===229||event.altKey||event.ctrlKey||event.metaKey||event.shiftKey)return;
    if(event.target instanceof HTMLInputElement&&event.target.type==='number'){event.preventDefault();if(!event.repeat)submit()}
  }}>
    <header className="pa-program-heading"><h1>{t('draft')}</h1><p>{t('draftNote')}</p></header>
    <div className="pa-program-plan-grid">
      <section className="pa-program-question" aria-label={t('question')}>
        <Field label={t('question')} description={t('questionHint')}>{props=><Textarea {...props} required maxLength={4000} rows={3} placeholder={t('questionPlaceholder')} value={question} onChange={e=>setQuestion(e.target.value)} disabled={busy}/>}</Field>
        <section className="pa-program-section" aria-label={t('criteria')}>
          <h2>{t('criteria')}</h2>
          <Field label={t('scope')}>{props=><Textarea {...props} required maxLength={4000} rows={2} placeholder={t('scopePlaceholder')} value={researchScope} onChange={e=>setResearchScope(e.target.value)} disabled={busy}/>}</Field>
          <div className="pa-program-criteria">
            <Field label={t('inclusion')}>{props=><Textarea {...props} required maxLength={4000} rows={2} value={inclusion} onChange={e=>setInclusion(e.target.value)} disabled={busy}/>}</Field>
            <Field label={t('exclusion')}>{props=><Textarea {...props} required maxLength={4000} rows={2} value={exclusion} onChange={e=>setExclusion(e.target.value)} disabled={busy}/>}</Field>
          </div>
        </section>
      </section>
      <aside className="pa-program-sources" aria-label={t('seeds')}>
        <div className="pa-program-section-heading"><h2>{t('seeds')}</h2><span>{seeds.length} / 5</span></div>
        <p className="pa-program-caption">{t('seedHint')}</p>
        {!papers.length?<EmptyState heading={t('noPapers')} description={t('noPapersHint')} actions={onLibrary?<Button onClick={onLibrary}>{t('addPapers')}</Button>:undefined}/>:<>
          {papers.length>5&&<Input type="search" aria-label={t('searchPapers')} placeholder={t('searchPapers')} value={paperQuery} onChange={e=>setPaperQuery(e.target.value)}/>}
          <div className="pa-program-seeds" role="group" aria-label={t('seeds')}>
            {visiblePapers.map(p=><label key={p.id} className="pa-program-seed"><Checkbox checked={seeds.includes(p.id)} disabled={busy||!seeds.includes(p.id)&&seeds.length>=5} onCheckedChange={checked=>setSeeds(ids=>checked===true?[...ids,p.id]:ids.filter(id=>id!==p.id))}/><span>{p.title}</span></label>)}
            {!visiblePapers.length&&<p>{t('noMatch')}</p>}
          </div>
        </>}
        <Field label={t('acquisition')}>{props=><Select {...props} label={t('acquisition')} value={acquisition} onChange={setAcquisition} disabled={busy} options={[{value:'saved_only',label:t('saved')},{value:'public_pdf',label:t('public')},{value:'public_fulltext',label:t('publicFulltext')}]}/>}</Field>
      </aside>
    </div>
    <section className="pa-program-budget" aria-label={t('execution')}>
      <h2>{t('execution')}</h2><p className="pa-program-budget-summary">{budgetSummary}</p>
      <Disclosure variant="inline" summary={t('adjust')}>
        <div className="pa-program-limits">{Object.entries(limits).map(([key,value])=><Field key={key} label={t('limit'+key[0].toUpperCase()+key.slice(1))}>{props=><Input {...props} type="number" min={1} max={key==='rounds'?32:key==='searches'?100:500} value={value} required disabled={busy} onChange={e=>setLimits(x=>({...x,[key]:Number(e.target.value)}))}/>}</Field>)}
          <Field label={t('noProgressLimit')}>{props=><Input {...props} type="number" min={1} max={10} required value={noProgressLimit} disabled={busy} onChange={e=>setNoProgressLimit(Number(e.target.value))}/>}</Field>
          <Field label={t('limitMinutes')}>{props=><Input {...props} type="number" min={1} max={240} required value={minutes} disabled={busy} onChange={e=>setMinutes(Number(e.target.value))}/>}</Field>
        </div>
      </Disclosure>
      <p className="pa-program-caption">{t('limitsNote')}</p>
    </section>
    <footer className="pa-program-save"><div><p>{t('saveNote')}</p>{!seeds.length&&<p className="pa-program-caption">{t('selectFirst')}</p>}</div><Button variant="primary" busy={busy} type="submit" disabled={busy||!seeds.length}>{busy?t('saving'):t('save')}</Button></footer>
  </form>;
  const detail=selected&&<div className="pa-program-detail">
    <header className="pa-program-heading"><Badge tone={run?.status==='failed'?'error':runActive?'info':'neutral'}>{selected.stopReason?t(selected.stopReason):run?t(run.status):selected.runtime?t('lastRun')+t(selected.runtime.status):t(runLookupReady?'ready':'checking')}</Badge><h1>{selected.protocol.question}</h1>
      <div className="pa-program-actions">
        {!run&&<Button variant="primary" disabled={busy||capabilitiesLoading||!runLookupReady||!agent||!scope||!available||expired||!!selected.stopReason} onClick={()=>void perform(start)}>{t('start')}</Button>}
        {run&&<><Button variant={runActive?'primary':'secondary'} disabled={busy||!agent} onClick={()=>void perform(async()=>{await agent!.call('open',{sessionId:run.sessionId})})}>{t('chat')}</Button>
          {runActive?<Button disabled={busy||run.status==='cancelling'} onClick={()=>void perform(()=>control('cancel'))}>{t('pause')}</Button>:<Button disabled={busy||!agent||!scope||expired||!!selected.stopReason&&!['needs_input','runtime_incomplete'].includes(selected.stopReason)} onClick={()=>void perform(()=>control('retry'))}>{t('resume')}</Button>}
          {!selected.stopReason&&<Button variant="ghost" disabled={busy||!agent||!scope} onClick={()=>setStopOpen(true)}>{t('stop')}</Button>}</>}
      </div>
      <p className="pa-program-caption">{t('deadline')}: {new Date(selected.protocol.deadline).toLocaleString()}</p>
    </header>
    {readLoading&&<p role="status" className="pa-program-caption">{t('readLoading')}</p>}
    {!run&&(capabilitiesLoading?<p role="status">{t('checking')}</p>:(!available||!agent||!scope)&&!capabilityError&&<Feedback kind="info">{t('unavailable')}<Button variant="link" onClick={()=>void reload()}>{t('retryRead')}</Button></Feedback>)}
    {capabilityError&&<Feedback kind="warning" variant="block"><span>{t('staleRun')} {capabilityError}</span><Button onClick={()=>void reload()}>{t('retryRead')}</Button></Feedback>}
    {selected.runtime&&!run&&!runLookupReady&&!capabilitiesLoading&&!capabilityError&&available&&agent&&scope&&<Feedback kind="warning"><span>{t('unconfirmedRun')}</span><Button variant="link" onClick={()=>void reload()}>{t('retryRead')}</Button></Feedback>}
    {run?.error&&<Feedback kind="error">{run.error}</Feedback>}
    {expired&&<Feedback kind="info">{t('expired')}</Feedback>}
    <Tabs value={detailTab} onValueChange={setDetailTab} className="pa-program-tabs">
      <TabsList variant="navigation" aria-label={t('title')}><TabsTrigger value="reports">{t('reports')}</TabsTrigger><TabsTrigger value="candidates">{t('candidates')}</TabsTrigger><TabsTrigger value="plan">{t('plan')}</TabsTrigger></TabsList>
      <TabsContent value="reports" forceMount>
        {!!selected.rounds.length&&<Feedback kind="info"><strong>{t('review')}</strong> {t('reviewNote')}</Feedback>}
        {!selected.rounds.length&&<EmptyState heading={t('noRounds')} description={t('noRoundsHint')}/>}
        {selected.rounds.map(round=><article key={round.id} className="pa-program-report"><p className="pa-program-caption">{t('round')} {round.number} · {t('newEvidence')} {round.newEvidence}</p><h2>{round.question}</h2>
          {round.claims.map((claim,i)=><section key={i} className="pa-program-claim"><Badge>{t(claim.stance)}</Badge><p>{claim.text}</p><blockquote>{claim.quote}</blockquote>{claim.sourceKind==='html'?<a href={claim.sourceUrl} target="_blank" rel="noreferrer">{t('originalSource')}</a>:<Button variant="link" disabled={busy||!onCitation} onClick={()=>void perform(()=>onCitation!(claim))}>{t('source')}</Button>}</section>)}
          {!!round.gaps.length&&<section><h3>{t('openQuestions')}</h3><ul>{round.gaps.map((gap,i)=><li key={i}>{gap}</li>)}</ul></section>}
          <p><strong>{t('nextAction')}: </strong>{round.nextAction}</p>
        </article>)}
        {selected.roundPage&&selected.roundPage.total>1&&<nav className="pa-program-pagination" aria-label={t('reports')}><Button disabled={busy||readLoading||roundOffset===0} onClick={()=>setRoundOffset(Math.max(0,roundOffset-1))}>{t('previous')}</Button><span>{selected.roundPage.offset+1} / {selected.roundPage.total}</span><Button disabled={busy||readLoading||selected.roundPage.nextOffset===null} onClick={()=>setRoundOffset(selected.roundPage!.nextOffset!)}>{t('next')}</Button></nav>}
        {!!selected.gaps.length&&<section className="pa-program-section"><h2>{t('openQuestions')}</h2><ul>{selected.gaps.map((g,i)=><li key={i}>{g}</li>)}</ul></section>}
        {!!selected.studies?.length&&<section className="pa-program-section"><h2>{t('studies')}</h2><p className="pa-program-caption">{t('studiesNote')}</p><ul>{selected.studies.map(study=><li key={study.id}><span>{study.question}</span> <Button variant="link" disabled={busy||!onStudy} onClick={()=>void perform(()=>onStudy!(study.id))}>{t('openStudy')}</Button></li>)}</ul></section>}
        {!!selected.jobs.length&&<Disclosure variant="inline" defaultOpen={runActive} summary={t('jobs')}><ul className="pa-program-jobs">{selected.jobs.map(job=><li key={job.id}><span>{job.input.query?.query||job.input.query?.relation||job.input.operation}</span><Badge>{job.outcome?.status||job.status}</Badge>{job.error&&<Feedback kind="error">{job.error}</Feedback>}{job.outcome?.errors.map((e,i)=><Feedback key={i} kind="error">{e.source}: {e.error}</Feedback>)}{job.outcome?.warnings.map((w,i)=><Feedback key={i} kind="warning">{w.source}: {w.message}</Feedback>)}</li>)}</ul></Disclosure>}
      </TabsContent>
      <TabsContent value="candidates" forceMount>
        {!selected.candidates.length&&<EmptyState heading={t('noCandidates')} description={t('noCandidatesHint')}/>}
        <ul className="pa-program-candidates">{selected.candidates.map(c=><li key={c.id}><h2>{c.title}</h2><p><Badge>{t(c.decision)}</Badge> {c.reason}</p>{c.blocker&&<Feedback kind="warning">{c.blocker}</Feedback>}</li>)}</ul>
        {selected.candidatePage&&selected.candidatePage.total>10&&<nav className="pa-program-pagination" aria-label={t('candidates')}><Button disabled={busy||readLoading||candidateOffset===0} onClick={()=>setCandidateOffset(Math.max(0,candidateOffset-10))}>{t('previous')}</Button><span>{selected.candidatePage.offset+1}–{selected.candidatePage.offset+selected.candidates.length} / {selected.candidatePage.total}</span><Button disabled={busy||readLoading||selected.candidatePage.nextOffset===null} onClick={()=>setCandidateOffset(selected.candidatePage!.nextOffset!)}>{t('next')}</Button></nav>}
      </TabsContent>
      <TabsContent value="plan" forceMount>
        <dl className="pa-program-protocol"><div><dt>{t('scope')}</dt><dd>{selected.protocol.scope}</dd></div><div><dt>{t('inclusion')}</dt><dd>{selected.protocol.inclusion}</dd></div><div><dt>{t('exclusion')}</dt><dd>{selected.protocol.exclusion}</dd></div><div><dt>{t('seeds')}</dt><dd><ul>{selected.protocol.seedPaperIds.map(id=><li key={id}>{papers.find(p=>p.id===id)?.title??id}</li>)}</ul></dd></div><div><dt>{t('acquisition')}</dt><dd>{t(selected.protocol.acquisition==='public_fulltext'?'publicFulltext':selected.protocol.acquisition==='public_pdf'?'public':'saved')}</dd></div></dl>
        <p>{t('noProgressLimit')}: {selected.protocol.noProgressLimit ?? 2}</p><section className="pa-program-section"><h2>{t(run||selected.rounds.length||selected.stopReason?'progress':'execution')}</h2><dl className="pa-program-usage">{Object.entries(selected.protocol.limits).map(([key,limit])=><div key={key}><dt>{t(['rounds','searches','reads','modelRequests'].includes(key)?'limit'+key[0].toUpperCase()+key.slice(1):key)}</dt><dd>{run||selected.rounds.length||selected.stopReason?<>{(key==='modelRequests'||key==='appCalls')&&!selected.runtime?t('unknownUsage'):allowance(key,key==='modelRequests'?selected.runtime!.modelRequestsUsed:key==='appCalls'?selected.runtime!.appCallsUsed:selected.usage[key as keyof Program['usage']]??0)} / </>:null}{allowance(key,limit)}</dd></div>)}</dl></section>
      </TabsContent>
    </Tabs>
  </div>;
  const content=<div className="pa-program-main" ref={panel}>
    {listError&&<Feedback kind="error" variant="block">{listLoaded&&t('retained')} {listError}<Button onClick={()=>void reload()}>{t('retryRead')}</Button></Feedback>}
    {error&&<Feedback kind="error" variant="block"><span>{failedSelection&&<strong>{t('failedSelection')}{failedSelection.protocol.question} </strong>}{error}</span><Button variant="link" disabled={busy} onClick={()=>void perform(retryRead)}>{t('retryRead')}</Button></Feedback>}
    {selected?detail:draft}
  </div>;
  return <div className="pa-programs">
    <div className="pa-program-toolbar"><div>{(listLoading||listRefreshing)&&<span role="status">{t(listLoaded?'refreshing':'loading')}</span>}</div><Button variant="ghost" disabled={busy||listLoading||listRefreshing} onClick={()=>void reload()}><Icon name="refresh"/>{t('retry')}</Button></div>
    <Split storageKey="paper-agent.programs" collapseBelow={760}>
      {!!programs.length&&<SplitPane id="program-list" size={220} min={160} stackedBasis="auto" resizeLabel={t('history')}><nav className="pa-program-list" aria-label={t('history')}><h2>{t('history')}</h2><Button variant="ghost" onClick={newPlan} disabled={busy}><Icon name="plus"/>{t('new')}</Button>{programs.map(p=><ListRow key={p.id} title={p.protocol.question} meta={p.usage.rounds+'/'+p.protocol.limits.rounds+' '+t('rounds')} current={selected?.id===p.id} onOpen={()=>{if(!busy)void perform(()=>selectProgram(p))}}/>)}{listNext!==null&&<Button disabled={busy} onClick={()=>void perform(morePrograms)}>{t('more')}</Button>}</nav></SplitPane>}
      <SplitPane id="program-detail" min={320}>{content}</SplitPane>
    </Split>
    {stopOpen&&<Dialog size="sm" title={t('stopTitle')} closeLabel={t('close')} onClose={()=>setStopOpen(false)} footer={<><Button onClick={()=>setStopOpen(false)}>{t('cancel')}</Button><Button variant="danger" disabled={busy} onClick={()=>void perform(async()=>{await control('stop');setStopOpen(false)})}>{t('stop')}</Button></>}><p>{t('stopNote')}</p></Dialog>}
  </div>;
}
