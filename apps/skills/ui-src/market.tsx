import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {useAppContext, useHostCapability, useInstalledSkill} from '@pero/app-sdk';
import {AppBar, Button, Checkbox, ContentPane, Dialog, EmptyIllustration, EmptyState, Feedback, Icon, IconButton, Input, InspectorHeader, LibraryHeader, ListRow, Select, Switch, Tabs, TabsContent, TabsList, TabsTrigger} from '@pero/app-sdk/ui';
import {findSkills, installationBlock, skillCopy as copy} from './catalog.mjs';
import type {Catalog, EvidenceSection, Installations, Skill, Update} from './types';

function SkillEvidence({sections, missing}: {sections?: EvidenceSection[]; missing: React.ReactNode}) {
  return sections?.length ? <ul className="skills-evidence">{sections.map((section,index) => <li key={index}><strong>{section.heading}</strong><p>{section.text}</p></li>)}</ul> : <>{missing}</>;
}

const glyphs:Record<string,string> = {writing:'quote',literature:'skill',statistics:'simulation',visualization:'palette','research-design':'light',presentation:'browser',ai:'circuit',data:'table','scientific-computing':'protein',laboratory:'microscope',workflow:'nodes',documents:'document',review:'checklist'};
function SkillGlyph({skill}:{skill:Skill}) {return <span className={`skills-glyph tone-${skill.category}`}><Icon name={glyphs[skill.category] || 'skill'} size={20}/></span>;}

export function SkillsMarket() {
  const {locale, permissions} = useAppContext(), capability = useHostCapability('skills');
  const zh = locale === 'zh-CN', text = (cn: string, en: string) => zh ? cn : en;
  const title = (item: Skill) => zh ? copy(item)?.title || item.title_zh || item.name : item.name;
  const description = (item: Skill) => (zh ? copy(item)?.summary || item.description_zh || item.description : item.description || item.description_zh) || text('来源未提供摘要，请查看原始技能。', 'No source summary; review the original skill.');
  const categoryLabel = (item: Skill) => zh ? item.category_zh || item.category : item.category.replace(/[-_]/g,' ');
  const [catalog, setCatalog] = useState<Catalog>(), [installed, setInstalled] = useState<Installations>();
  const [loading, setLoading] = useState(false), [error, setError] = useState('');
  const [view, setView] = useState('discover'), [query, setQuery] = useState(''), [category, setCategory] = useState(''), [scope, setScope] = useState('');
  const [selected, setSelected] = useState(''), [page, setPage] = useState(0), [detailTab,setDetailTab] = useState('overview');
  const [onlyReady,setOnlyReady] = useState(false), [sort,setSort] = useState('flow'), [queueOpen,setQueueOpen] = useState(true), [opening,setOpening] = useState('');
  const search = useRef<HTMLInputElement>(null), scroller = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState<Record<string, {operation: string; cancelling: boolean; notice?: string}>>({});
  const [outcomes, setOutcomes] = useState<Record<string, {error: boolean; message: string; operation:string; input:Record<string,unknown>}>>({});
  const [removing, setRemoving] = useState<Skill>(), [updates, setUpdates] = useState<Record<string, Update>>({});
  const epoch = useRef(0);
  const installedEpoch = useRef(0);
  const activeOperations = useRef(new Map<string, {cancelRequested?:boolean}>());

  const load = useCallback(async () => {
    if (!capability) return;
    const request = ++epoch.current;
    const installedRequest = ++installedEpoch.current;
    setLoading(true); setError('');
    const results = await Promise.allSettled([capability.call('catalog', {}) as Promise<Catalog>, capability.call('installed', {}) as Promise<Installations>]);
    if (epoch.current !== request) return;
    if (results[0].status === 'fulfilled') setCatalog(results[0].value);
    if (results[1].status === 'fulfilled' && installedRequest === installedEpoch.current) setInstalled(results[1].value);
    setError(results.flatMap(result => result.status === 'rejected' ? [String(result.reason instanceof Error ? result.reason.message : result.reason)] : []).join('\n'));
    setLoading(false);
  }, [capability]);
  useEffect(() => { void load(); return () => { epoch.current++; }; }, [load]);

  const records = installed?.items ?? [];
  const entries = useMemo(() => {
    // Matching immutable bytes use current editorial metadata; older versions keep their snapshot.
    const values = (catalog?.skills ?? []).map(entry=>{
      const snapshot=installed?.items.find(value=>value.id===entry.id)?.entry;
      return snapshot&&(snapshot.source.commit!==entry.source.commit||snapshot.source.sha256!==entry.source.sha256)?snapshot:entry;
    }), ids = new Set(values.map(item => item.id));
    for (const item of installed?.items ?? []) if (item.entry && !ids.has(item.id)) { values.push(item.entry); ids.add(item.id); }
    return values;
  }, [catalog, installed]);
  const shown = findSkills(entries, {scope,query, category, view, installed:records, page, onlyReady, sort});
  const listed = entries.find(value => value.id === selected);
  const record = records.find(value => value.id === listed?.id);
  const item = listed;
  const itemBusy = busy[item?.id ?? ''];
  const update = updates[item?.id ?? ''];
  const categories = [...new Map(entries.map(value => [value.category, {value:value.category, label:categoryLabel(value)}])).values()].sort((a,b) => a.label.localeCompare(b.label, locale));
  const noCapability = !!permissions && !capability;
  function filter(change: () => void) { change(); setPage(0); }
  function open(target:Skill) {setSelected(target.id);setDetailTab('overview');}
  useEffect(()=>{if(scroller.current)scroller.current.scrollTop=0;},[view,page,query,category,onlyReady,sort]);
  useEffect(()=>{const handle=(event:KeyboardEvent)=>{if((event.ctrlKey || event.metaKey) && event.key.toLowerCase()==='k' && !selected){event.preventDefault();search.current?.focus();}};window.addEventListener('keydown',handle);return()=>window.removeEventListener('keydown',handle);},[selected]);
  async function useSkill(target:Skill, message='') {
    const saved=records.find(value=>value.id===target.id);
    if(!saved)return;
    setOpening(target.id);
    try {await useInstalledSkill(`pero-market-skill:${saved.id}@${saved.revision}`,message);setSelected('');}
    catch(reason) {setOutcomes(previous=>({...previous,[target.id]:{error:true,operation:'use',input:{message},message:reason instanceof Error?reason.message:String(reason)}}));setQueueOpen(true);}
    finally {setOpening('');}
  }

  async function operate(operation: string, target: Skill, input: Record<string, unknown> = {}) {
    if (!capability || activeOperations.current.has(target.id)) return;
    const current: {cancelRequested?:boolean} = {};
    activeOperations.current.set(target.id, current);
    setBusy(previous => ({...previous, [target.id]:{operation, cancelling:false}}));
    setQueueOpen(true);
    setOutcomes(previous => {const next={...previous};delete next[target.id];return next;});
    try {
      if (operation === 'check-update') {
        const result = await capability.call(operation, {id:target.id}) as Update;
        setUpdates(previous => ({...previous, [target.id]:result}));
        setOutcomes(previous => ({...previous, [target.id]:{error:false, operation, input, message:result.updateAvailable
          ? text(`${title(target)}：发现新版本 ${result.latestRevision.slice(0,12)}`, `${title(target)}: update available ${result.latestRevision.slice(0,12)}`)
          : text(`${title(target)}：已是当前上游版本`, `${title(target)}: already at the current upstream revision`)}}));
      } else {
        const result = await capability.call(operation, {id:target.id,...input}) as Installations;
        installedEpoch.current++;
        // Each operation owns one skill; concurrent replies must not replace other records.
        setInstalled(previous => ({...result, items:[...(previous?.items ?? []).filter(value => value.id !== target.id), ...result.items.filter(value => value.id === target.id)]}));
        setUpdates(previous => {const next={...previous};delete next[target.id];return next;});
        if (operation === 'remove') setSelected('');
        setOutcomes(previous => ({...previous, [target.id]:{error:false, operation, input, message:text(`${title(target)}：操作已完成`, `${title(target)}: operation completed`)}}));
      }
    } catch (reason) {
      setOutcomes(previous => ({...previous, [target.id]:{error:!(current.cancelRequested && /cancel/i.test(String(reason))), operation, input, message:`${title(target)}：${reason instanceof Error ? reason.message : String(reason)}`}}));
    } finally {
      activeOperations.current.delete(target.id);
      setBusy(previous => {const next={...previous};delete next[target.id];return next;});
    }
  }

  async function cancel(id: string) {
    const target = busy[id], current = activeOperations.current.get(id);
    if (!capability || !target || target.cancelling || !current) return;
    setBusy(previous => ({...previous, [id]:{...target, cancelling:true}}));
    try {
      const response = await capability.call('cancel', {id}) as {cancelled: boolean};
      current.cancelRequested = response.cancelled;
      if (activeOperations.current.get(id) !== current) return;
      setBusy(previous => ({...previous, [id]:{...previous[id], notice:response.cancelled ? text('已请求取消，正在等待原操作结束。', 'Cancellation requested; waiting for the operation to finish.') : text('没有可取消的操作，请核对当前状态。', 'No running operation to cancel; check the current state.')}}));
    } catch (reason) {
      if (activeOperations.current.get(id) === current) {
        setOutcomes(previous => ({...previous, [id]:{error:true, operation:target.operation, input:{}, message:`${entries.find(value => value.id === id)?.name ?? id}：${reason instanceof Error ? reason.message : String(reason)}`}}));
        setBusy(previous => ({...previous, [id]:{...previous[id], cancelling:false}}));
      }
    }
  }

  function primary(target:Skill, compact=false) {
    const saved=records.find(value=>value.id===target.id), pending=busy[target.id];
    if(saved)return <Button variant={compact?'ghost':'primary'} disabled={!!pending} busy={opening===target.id} onClick={()=>void useSkill(target)}>{compact?text('去使用','Use skill'):text('在新会话中使用','Use in new chat')}<Icon name="arrow" size={14}/></Button>;
    if(installationBlock(target) && compact)return <Button variant="ghost" onClick={()=>open(target)}>{text('查看条件','View conditions')}</Button>;
    return <Button variant={compact?'secondary':'primary'} disabled={!!installationBlock(target)||!!pending||!installed} busy={!!pending} onClick={()=>void operate('install',target)}>{text('安装技能','Install')}</Button>;
  }
  function retry(target:Skill) {
    const outcome=outcomes[target.id];
    if(!outcome)return;
    if(outcome.operation==='use')void useSkill(target, String(outcome.input.message||''));
    else void operate(outcome.operation,target,outcome.input);
  }
  const taskIds=[...new Set([...Object.keys(outcomes),...Object.keys(busy)])].reverse();
  const running=Object.keys(busy).length;
  const missingEvidence=item ? <>{text('未明确列出，请查看','Not explicitly listed; review the')} <a href={item.source.url} target="_blank" rel="noreferrer">{text('技能原文','original skill')}</a>。</> : null;

  return <main className="skills-market">
        <Tabs className="skills-frame" value={view} onValueChange={next=>filter(()=>setView(next))}>
          <AppBar scope={<TabsList variant="navigation" aria-label={text('技能视图','Skill views')}>
            <TabsTrigger value="discover">{text('发现技能','Discover')}</TabsTrigger>
            <TabsTrigger value="installed">{text('已安装','Installed')}{installed?` (${records.length})`:''}</TabsTrigger>
          </TabsList>} utilities={<IconButton label={text('刷新','Refresh')} busy={loading} disabled={!capability} onClick={() => void load()}><Icon name="sync" size={14}/></IconButton>} />
          <ContentPane id="skills-catalog" label={text('技能列表','Skill results')} as="div" surface="list" inset="regular" scroll="pane" bodyRef={scroller}
            header={<LibraryHeader density="compact" title={text('Skills 市场','Skills')} subtitle={catalog ? text(`${catalog.skills.length.toLocaleString(locale)} 项 · ${catalog.sources.length} 个来源`, `${catalog.skills.length.toLocaleString(locale)} skills · ${catalog.sources.length} sources`) : text('找到合适的技能，把下一步研究做得更清楚。','Find the right skill for the next step in your research.')} />}
            toolbar={<div className="skills-tools">
            <div className="skills-search"><Icon name="search" size={18}/><Input ref={search} type="search" aria-label={text('搜索技能','Search skills')} placeholder={text('搜索用途、技能名称或来源…','Search tasks, skill names or sources…')} value={query} onChange={event=>filter(()=>setQuery(event.target.value))}/><kbd>Ctrl K</kbd></div>
            <Select label={text('技能范围','Skill scope')} value={scope} options={[{value:'',label:text('全部','All')},{value:'general',label:text('通用','General')},{value:'research',label:text('科研','Research')}]} onChange={value=>filter(()=>setScope(value))}/>
            <Select label={text('任务分类','Task category')} value={category} options={[{value:'',label:text('全部任务分类','All categories')},...categories]} onChange={value=>filter(()=>setCategory(value))}/>
          </div>}
            feedback={<div className="skills-status">
            {loading&&<Feedback>{catalog?text('正在刷新，保留当前目录。','Refreshing; the current catalog remains visible.'):text('正在读取技能目录…','Loading the skill catalog…')}</Feedback>}
            {error&&<Feedback kind="error">{text('读取未完成，已保留可用内容。','Loading is incomplete; available content is retained.')} {error} <Button variant="link" disabled={loading} onClick={()=>void load()}>{text('重试','Retry')}</Button></Feedback>}
            {noCapability&&<Feedback kind="error">{text('此 Host 不提供 Skills 市场能力。请更新 Pero 后重试。','This Host does not provide the Skills market capability. Update Pero and retry.')}</Feedback>}
          </div>}>
          <TabsContent value={view}>
            {!catalog ? !loading&&!error&&!noCapability&&<Feedback>{text('正在等待 Host 目录。','Waiting for the Host catalog.')}</Feedback> : <div className="skills-layout">
              <section className="skills-results" aria-label={text('技能列表','Skill results')}>
                <div className="skills-list-heading"><div><h2>{view==='installed'?text('你的已安装技能','Your installed skills'):text('浏览技能','Browse skills')}</h2><span className="skills-summary">{text(`${shown.total.toLocaleString(locale)} 项匹配`,`${shown.total.toLocaleString(locale)} matches`)}</span></div><div><label className="skills-ready"><Checkbox checked={onlyReady} onCheckedChange={checked=>filter(()=>setOnlyReady(checked===true))}/>{text('可直接安装','Ready to install')}</label><Select label={text('排序方式','Sort skills')} value={sort} options={[{value:'flow',label:text('按研究任务浏览','Research task')},{value:'name',label:text('按名称排序','Name')}]} onChange={value=>filter(()=>setSort(value))}/></div></div>
                {view==='installed'&&<p className="skills-installed-guide"><Icon name="info" size={15}/>{text('可在聊天中手动选择，不必开启自动选用。','Select skills in Chat without enabling automatic use.')}</p>}
                {shown.items.length ? shown.items.map(value=>{
                  const saved=records.find(row=>row.id===value.id), pending=busy[value.id];
                  const displayed=value;
                  return <article key={value.id}>
                    <ListRow className="skills-row" onOpen={()=>open(value)} title={<span className="skills-row-identity"><SkillGlyph skill={displayed}/><span className="skills-row-copy"><span className="skills-row-title"><span role="heading" aria-level={3}>{title(displayed)}</span>{saved&&<span className="skills-installed-label"><Icon name="check" size={12}/>{text('已安装','Installed')}</span>}{pending&&<span className="skills-pending-label">{text('处理中','Working')}</span>}{!pending&&outcomes[value.id]?.error&&<span className="skills-failed-label">{text('操作未完成','Action incomplete')}</span>}</span><span className="skills-row-description">{description(displayed)}</span><span className="skills-row-meta"><span className={`skills-category tone-${displayed.category}`}>{categoryLabel(displayed)}</span><code>{displayed.name}</code><span className="skills-source-owner">{displayed.source.repository.split('/')[0]}</span></span></span></span>} trailing={<div className="skills-row-action">{primary(displayed,true)}</div>}/>
                  </article>;
                }):<EmptyState icon={<EmptyIllustration kind={view==='installed'&&!query&&!category?'data':'search'} size="compact"/>} heading={view==='installed'&&!query&&!category?text('尚未安装技能','No installed skills'):text('没有匹配的技能','No matching skills')} description={text('换一个任务关键词，或清除分类条件再试试。','Try another task keyword or clear the category filter.')} actions={<Button onClick={()=>filter(()=>{setQuery('');setCategory('');setScope('');setOnlyReady(false);setView('discover');})}>{text('浏览全部技能','Browse all skills')}</Button>}/>}
                {shown.total>0&&<footer className="skills-pagination"><span>{text(`显示 ${shown.page*12+1}–${Math.min(shown.page*12+12,shown.total)}，共 ${shown.total.toLocaleString(locale)} 项`,`Showing ${shown.page*12+1}–${Math.min(shown.page*12+12,shown.total)} of ${shown.total.toLocaleString(locale)}`)}</span><div><Button aria-label={text('上一页','Previous')} disabled={shown.page===0} onClick={()=>setPage(shown.page-1)}><Icon name="chevron-left" size={15}/></Button><span>{shown.page+1} / {shown.pages}</span><Button aria-label={text('下一页','Next')} disabled={shown.page+1===shown.pages} onClick={()=>setPage(shown.page+1)}><Icon name="chevron-right" size={15}/></Button></div></footer>}
              </section>
              <aside className="skills-aside">
                <section className="skills-local-library"><div className="skills-aside-heading"><Icon name="skill" size={18}/><h2>{text('你的技能','Your skills')}</h2>{installed&&<span>{records.length}</span>}</div><p>{text('已安装到当前 Pero，随时在聊天中选择。','Installed in this Pero profile and ready to select in Chat.')}</p><div className="skills-mini-list">{records.slice(0,4).map(saved=>{const value=entries.find(entry=>entry.id===saved.id);return value&&<Button key={saved.id} variant="ghost" onClick={()=>open(value)}><SkillGlyph skill={value}/><span>{title(value)}</span><Icon name="chevron-right" size={14}/></Button>;})}</div><Button className="skills-manage" onClick={()=>filter(()=>{setQuery('');setCategory('');setScope('');setOnlyReady(false);setView('installed');})}>{text('管理已安装技能','Manage installed skills')}<Icon name="arrow" size={14}/></Button></section>
                <section className="skills-use-guide"><span className="skills-guide-icon"><Icon name="session" size={22}/></span><h2>{text('安装之后，怎么使用？','How do I use a skill?')}</h2><p>{text('点击「去使用」打开会话，技能会出现在输入框中。也可以新建会话，输入 @skill 搜索已安装技能。','Choose “Use skill” to open Chat with the skill attached. You can also start a chat and type @skill to find installed skills.')}</p></section>
                <p className="skills-source-note"><Icon name="info" size={15}/>{text('目录保留固定来源与许可依据。安装成功不代表科研方法已经验证。','Sources and license evidence are preserved. Installation does not establish scientific validation.')}</p>
              </aside>
            </div>}
          </TabsContent>
          </ContentPane>
        </Tabs>
    {taskIds.length>0&&<section className="skills-task-queue" aria-label={text('安装任务','Installation tasks')}><header><Button variant="ghost" aria-expanded={queueOpen} onClick={()=>setQueueOpen(!queueOpen)}><Icon name={running?'sync':'export'} size={16}/><strong>{running?text(`${running} 项正在处理`,`${running} running`):text('最近操作','Recent actions')}</strong><span>{taskIds.length}</span><Icon name={queueOpen?'chevron-down':'up'} size={14}/></Button>{!running&&<Button variant="ghost" aria-label={text('清除已完成任务','Clear completed tasks')} onClick={()=>setOutcomes({})}><Icon name="close" size={15}/></Button>}</header>{queueOpen&&<div className="skills-queue-items">{taskIds.map(id=>{const target=entries.find(value=>value.id===id);if(!target)return null;const pending=busy[id],outcome=outcomes[id];return <div className="skills-queue-item" key={id}><Icon name={pending?'sync':outcome?.error?'alert':'check'} size={16}/><div><Button variant="link" onClick={()=>open(target)}>{title(target)}</Button><p role={pending?'status':outcome?.error?'alert':'status'}>{pending?(pending.notice||text(pending.cancelling?'正在等待取消完成。':'正在获取或核对所选技能，请稍候。',pending.cancelling?'Waiting for cancellation.':'Fetching or checking the selected skill.')):outcome?.message}</p></div>{pending&&['install','update'].includes(pending.operation)?<Button variant="ghost" aria-label={text(`取消 ${target.name}`,`Cancel ${target.name}`)} busy={pending.cancelling} onClick={()=>void cancel(id)}><Icon name="close" size={14}/></Button>:!pending&&outcome?.error?<Button variant="link" onClick={()=>retry(target)}>{text('重试','Retry')}</Button>:!pending&&records.some(value=>value.id===id)?<Button variant="link" onClick={()=>void useSkill(target)}>{text('去使用','Use skill')}</Button>:null}</div>;})}</div>}</section>}

    {item&&<Dialog presentation="drawer" className="skills-detail" title={text('技能详情','Skill details')} closeLabel={text('关闭详情','Close details')} onClose={()=>setSelected('')} footerStart={<span className="skills-footer-note"><Icon name={record?'check':'local'} size={14}/>{record?text('已安装在本地','Installed locally'):text('安装到当前 Pero','Install in this Pero')}</span>} footer={primary(item)}>
      <div className="skills-detail-content">
        <InspectorHeader title={title(item)} identity={<span className="skills-detail-identity"><SkillGlyph skill={item}/><span className={`skills-category tone-${item.category}`}>{categoryLabel(item)}</span></span>} subtitle={<code>{item.name}</code>} status={record ? text('已安装','Installed') : text('未安装','Not installed')} /><p className="skills-description">{description(item)}</p>
        {!record&&installationBlock(item)&&<Feedback>{installationBlock(item)} <a href={item.license.evidence_url||item.source.url} target="_blank" rel="noreferrer">{text('查看许可依据','License evidence')}</a></Feedback>}
        {itemBusy&&<Feedback>{itemBusy.notice||text('正在处理，可关闭详情继续浏览。','Working; close details to keep browsing.')} {['install','update'].includes(itemBusy.operation)&&<Button variant="link" disabled={itemBusy.cancelling} onClick={()=>void cancel(item.id)}>{text('取消','Cancel')}</Button>}</Feedback>}
        {!itemBusy&&outcomes[item.id]?.error&&<Feedback kind="error">{outcomes[item.id].message}<Button variant="link" onClick={()=>retry(item)}>{text('重试','Retry')}</Button></Feedback>}
        <Tabs value={detailTab} onValueChange={setDetailTab}><TabsList variant="navigation" aria-label={text('技能详情视图','Skill detail views')}><TabsTrigger value="overview">{text('用途与条件','Overview')}</TabsTrigger><TabsTrigger value="examples">{text('示例任务','Examples')}</TabsTrigger><TabsTrigger value="source">{text('来源与版本','Source and version')}</TabsTrigger></TabsList>
          <TabsContent value="overview"><section><h3>{text('这项技能能帮你做什么','What this skill does')}</h3><p>{description(item)}</p></section>
            <div className="skills-io-grid">{(['inputs','outputs'] as const).map(key=><section key={key}><h3><Icon name={key==='inputs'?'folder':'document'} size={16}/>{key==='inputs'?text('准备什么','Inputs'):text('得到什么','Outputs')}</h3>{zh&&copy(item)&&<p>{key==='inputs'?copy(item)?.input:copy(item)?.output}</p>}<SkillEvidence sections={item[key]} missing={missingEvidence}/></section>)}</div>
            <section><h3>{text('使用前了解','Before you use it')}</h3><dl className="skills-facts"><dt>{text('来源','Repository')}</dt><dd>{item.source.repository}</dd><dt>{text('许可','License')}</dt><dd>{item.license.spdx||text('未知','Unknown')}</dd><dt>{text('运行条件','Requirements')}</dt><dd>{item.compatibility?.declared?.join(', ')||text('未单列声明，请以原文为准','Not explicitly declared; review the original skill.')}</dd><dt>{text('条目类型','Entry type')}</dt><dd>{item.kind==='general_skill'?text('通用技能','General skill'):item.kind==='internal_dependency'?text('内部依赖','Internal dependency'):item.kind==='research_support'?text('科研辅助','Research support'):text('科研技能','Research skill')}</dd><dt>{text('兼容状态','Compatibility')}</dt><dd>{item.compatibility?.status==='unverified'?text('尚未验证','Unverified'):({static_instructions:text('静态指引已审查；执行环境待核查','Static instructions reviewed; execution environment unchecked'),requires_adaptation:text('需要宿主或工具适配','Host or tool adaptation required')})[item.compatibility?.status as 'static_instructions'|'requires_adaptation']||item.compatibility?.status||text('未声明','Not declared')}</dd><dt>{text('实际运行','Runtime evidence')}</dt><dd>{item.verification?.runtime==='not_run'?text('未执行','Not run'):item.verification?.runtime||text('未提供','Not provided')}</dd></dl></section>
            <section><h3>{text('运行依赖','Dependencies')}</h3><SkillEvidence sections={item.dependencies} missing={missingEvidence}/></section>
            <p className="skills-verification-note">{text('来源已收录；运行与科研效果未统一验证。','Catalog inclusion does not establish runtime or scientific validation.')} {item.verification?.notes?.join(' ')}</p>
            {record&&<><section className="skills-automatic"><div><h3>{text('自动用于后续普通聊天','Use automatically in future chats')}</h3><p>{text('手动选择无需开启。自动装配只作用于后续普通 Pero Agent 会话。','Manual selection needs no global activation. Automatic assembly applies to subsequent ordinary Pero Agent chats.')}</p></div><Switch checked={record.enabled&&record.selected} aria-label={text('用于后续普通聊天','Use in subsequent ordinary chats')} disabled={!!itemBusy} onCheckedChange={enabled=>void operate('enable',item,{enabled})}/></section><p className="skills-revocation-note">{text('停用或移除不会清除已加载的指引。需停止并重开已有会话才能彻底撤销。','Selection applies only to subsequent ordinary Pero chats, not App sessions. Stop and reopen existing sessions to revoke instructions already loaded.')}</p><Button variant="link" disabled={!!itemBusy} onClick={()=>setRemoving(item)}><Icon name="trash" size={14}/>{text('移除本地安装','Remove')}</Button></>}
          </TabsContent>
          <TabsContent value="examples"><section><h3>{text('可以这样发起任务','Start a research task')}</h3><p>{text('先在聊天中选中技能，再补充你的实际材料与要求。','Select the skill in Chat, then add your actual materials and requirements.')}</p>{zh&&copy(item)&&<><blockquote>{copy(item)?.example}</blockquote>{record&&<Button onClick={()=>void useSkill(item,copy(item)?.example)}>{text('带着示例去会话','Use example in chat')}<Icon name="arrow" size={14}/></Button>}</>}<SkillEvidence sections={item.examples} missing={missingEvidence}/></section></TabsContent>
          <TabsContent value="source"><section><h3>{text('来源信息','Source information')}</h3><dl className="skills-facts"><dt>{text('仓库','Repository')}</dt><dd><a href={item.source.url} target="_blank" rel="noreferrer">{item.source.repository}<Icon name="open" size={13}/></a></dd><dt>{text('固定版本','Pinned revision')}</dt><dd><code>{item.source.commit}</code></dd><dt>{text('技能文件','Skill file')}</dt><dd><code>{item.source.path}</code></dd><dt>{text('许可依据','License evidence')}</dt><dd><a href={item.license.evidence_url||item.source.url} target="_blank" rel="noreferrer">{item.license.spdx||text('待核对','Unverified')}</a> · {({declared_in_skill:text('技能自身声明','Declared by the skill'),directory_license:text('技能目录许可证','Skill directory license'),reviewed_repository:text('已复审仓库许可适用范围','Reviewed repository license scope'),repository_only:text('仅有仓库声明','Repository declaration only')})[item.license.status as 'declared_in_skill'|'directory_license'|'reviewed_repository'|'repository_only']||text('尚无许可依据','No license evidence')}</dd></dl></section><section><h3>{text('原始说明','Original description')}</h3><p className="skills-original-description">{item.description||text('来源未提供摘要。','No source summary.')}</p></section>
            {record&&<section><h3>{text('版本管理','Version management')}</h3><dl className="skills-facts"><dt>{text('已安装版本','Installed revision')}</dt><dd><code>{record.revision}</code></dd>{record.invocation&&<><dt>{text('调用名称','Invocation')}</dt><dd><code>/{record.invocation}</code></dd></>}</dl><div className="skills-version-actions"><Button disabled={!!itemBusy} onClick={()=>void operate('check-update',item)}>{text('检查更新','Check for updates')}</Button>{update?.updateAvailable&&<Button variant="primary" disabled={!!itemBusy} onClick={()=>void operate('update',item,{revision:update.latestRevision,sha256:update.latestSha256})}>{text('更新','Update')}</Button>}<Button disabled={!!itemBusy||!record.previousRevision} onClick={()=>void operate('rollback',item)}>{text('回退','Roll back')}</Button></div>{updates[item.id]&&<Feedback>{text(updates[item.id].updateAvailable?`发现新版本 ${updates[item.id].latestRevision.slice(0,12)}`:'已是当前上游版本',updates[item.id].updateAvailable?`Update available: ${updates[item.id].latestRevision.slice(0,12)}`:'Already at the current upstream revision')}</Feedback>}</section>}
            {item.sources?.length>1&&<section><h3>{text('其他来源','Other sources')}</h3><ul>{item.sources.map((source,index)=><li key={index}><a href={source.url} target="_blank" rel="noreferrer">{source.repository} / {source.path}</a></li>)}</ul></section>}
          </TabsContent>
        </Tabs>
      </div>
    </Dialog>}
    {removing&&<Dialog title={text(`移除 ${title(removing)}？`,`Remove ${title(removing)}?`)} closeLabel={text('关闭','Close')} size="sm" onClose={()=>setRemoving(undefined)} footer={<><Button onClick={()=>setRemoving(undefined)}>{text('取消','Cancel')}</Button><Button variant="danger" onClick={()=>{const target=removing;setRemoving(undefined);void operate('remove',target);}}>{text('移除','Remove')}</Button></>}><p>{text('将从已安装列表和后续会话选择中移除。已有会话仍绑定原快照，不会被中途替换或清除。','Remove from installed skills and future session selection. Existing sessions retain their original snapshot.')}</p></Dialog>}
  </main>;
}
