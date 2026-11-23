import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {useAppContext, useHostCapability, useInstalledSkill} from '@pero/app-sdk';
import {AppBar, Button, Checkbox, ContentPane, ContentSection, Dialog, EmptyIllustration, EmptyState, Feedback, Icon, IconButton, InspectorHeader, ListRow, SearchField, Select, Switch, Tabs, TabsContent, TabsList, TabsTrigger} from '@pero/app-sdk/ui';
import {findSkills, installationBlock, skillCopy as copy} from './catalog.mjs';
import {SkillHub, SkillHubHistory, skillHubId, type SkillHubInstallFailure} from './skillhub';
import type {SkillHubEntry} from '../../../protocol/generated/host';
import type {Catalog, EvidenceSection, Installations, Skill, Update} from './types';

function SkillEvidence({sections, missing}: {sections?: EvidenceSection[]; missing: React.ReactNode}) {
  return sections?.length ? <ul className="skills-evidence">{sections.map((section,index) => <li key={index}><strong>{section.heading}</strong><p>{section.text}</p></li>)}</ul> : <>{missing}</>;
}

const glyphs:Record<string,string> = {writing:'quote',literature:'skill',statistics:'simulation',visualization:'palette','research-design':'light',presentation:'browser',ai:'circuit',data:'table','scientific-computing':'protein',laboratory:'microscope',workflow:'nodes',documents:'document',review:'checklist'};
function SkillGlyph({skill}:{skill:Skill}) {return <span className="skills-glyph"><Icon name={glyphs[skill.category] || 'skill'} size={20}/></span>;}

const admissionReasonsZh: Record<string, string> = {
  'License evidence is missing; open the source and verify its terms first': '缺少适用于该技能的许可依据，可前往来源核对许可条款。',
  'This catalog record is a dependency or reference, not an independent skill': '此条目是依赖或参考资料，无法单独安装。',
  'This general skill requires a compatibility review or host adaptation; review its requirements': '此技能需要兼容性审查或宿主适配，可在原文中查看运行要求。',
  'Selected source is not a supported pinned Git skill; archive members require a separate adapter': '安装需要受支持的固定 Git 来源。压缩包内的技能需要单独适配。',
  'Invalid skill catalog entry': '技能目录记录无效。',
  'Admission not provided by Host; refresh or update Pero.': '尚未取得安装条件，请刷新目录或更新 Pero。',
};

export const SkillsMarket = React.memo(function SkillsMarket({ embedded = false, searchRef }: {
  embedded?: boolean;
  searchRef?: React.RefObject<HTMLInputElement | null>;
} = {}) {
  const {locale, permissions} = useAppContext(), capability = useHostCapability('skills');
  const zh = locale === 'zh-CN', text = (cn: string, en: string) => zh ? cn : en;
  const title = (item: Skill) => zh ? copy(item)?.title || item.title_zh || item.name : item.name;
  const description = (item: Skill) => (zh ? copy(item)?.summary || item.description_zh || item.description : item.description || item.description_zh) || text('来源未提供摘要，请查看原始技能。', 'No source summary; review the original skill.');
  const categoryLabel = (item: Skill) => zh ? item.category_zh || item.category : item.category.replace(/[-_]/g,' ');
  const [catalog, setCatalog] = useState<Catalog>(), [installed, setInstalled] = useState<Installations>();
  const [loading, setLoading] = useState(false), [error, setError] = useState('');
  const [inventoryLoading, setInventoryLoading] = useState(false), [inventoryError, setInventoryError] = useState('');
  const [hubFailures, setHubFailures] = useState<Record<string, SkillHubInstallFailure[]>>({});
  const [hubHistory, setHubHistory] = useState<{item: SkillHubEntry; versionId?: number}>();
  const [view, setView] = useState('discover'), [query, setQuery] = useState(''), [category, setCategory] = useState(''), [scope, setScope] = useState('');
  const [hubQuery, setHubQuery] = useState(''), [hubRefresh, setHubRefresh] = useState(0);
  const [targetRevision, setTargetRevision] = useState('');
  const hub = view === 'skillhub';
  const viewingInstalled = view === 'installed';
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState(''), [detailTab,setDetailTab] = useState('overview');
  const [onlyReady,setOnlyReady] = useState(false), [sort,setSort] = useState('flow'), [queueOpen,setQueueOpen] = useState(true), [opening,setOpening] = useState('');
  const search = useRef<HTMLInputElement>(null), scroller = useRef<HTMLDivElement>(null);
  const searchInput = searchRef ?? search;
  const [busy, setBusy] = useState<Record<string, {operation: string; cancelling: boolean; notice?: string; name?: string}>>({});
  const [outcomes, setOutcomes] = useState<Record<string, {error: boolean; message: string; operation:string; input:Record<string,unknown>}>>({});
  const [removing, setRemoving] = useState<Skill>(), [updates, setUpdates] = useState<Record<string, Update>>({});
  const epoch = useRef(0);
  const installedEpoch = useRef(0);
  const activeOperations = useRef(new Map<string, {cancelRequested?:boolean}>());

  const loadInstalled = useCallback(async () => {
    if (!capability) return;
    const request = ++installedEpoch.current;
    setInventoryLoading(true);
    try {
      const result = await capability.call<Installations>('installed', {});
      if (installedEpoch.current === request) {
        setInstalled(result);
        setInventoryError('');
      }
    } catch (reason) {
      if (installedEpoch.current === request) setInventoryError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (installedEpoch.current === request) setInventoryLoading(false);
    }
  }, [capability]);
  const load = useCallback(async () => {
    if (!capability) return;
    const request = ++epoch.current;
    setLoading(true);
    setError('');
    void loadInstalled();
    try {
      const result = await capability.call<Catalog>('catalog', {});
      if (epoch.current === request) setCatalog(result);
    } catch (reason) {
      if (epoch.current === request) setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (epoch.current === request) setLoading(false);
    }
  }, [capability, loadInstalled]);
  useEffect(() => { void load(); return () => { epoch.current++; installedEpoch.current++; }; }, [load]);

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
  const shown = useMemo(() => hub ? undefined : findSkills(entries, {
    scope, query, category, view, installed: installed?.items, page, onlyReady, sort,
  }), [hub, entries, scope, query, category, view, installed, page, onlyReady, sort]);
  const listed = entries.find(value => value.id === selected);
  const record = records.find(value => value.id === listed?.id);
  const retained = record?.versions ?? [];
  const chosenRevision = retained.includes(targetRevision) ? targetRevision : record?.revision ?? '';
  const catalogRevision = catalog?.skills.find(value => value.id === listed?.id)?.source.commit;
  const item = listed;
  const itemBusy = busy[item?.id ?? ''];
  const update = updates[item?.id ?? ''];
  const categories = hub ? [] : [...new Map(entries.map(value => [value.category, {value:value.category, label:categoryLabel(value)}])).values()].sort((a,b) => a.label.localeCompare(b.label, locale));
  const noCapability = !!permissions && !capability;
  function open(target:Skill) {setSelected(target.id);setDetailTab('overview');setTargetRevision('');}
  function mergeInstalled(result: Installations, id: string) {
    installedEpoch.current++;
    setInventoryLoading(false);
    setInstalled(previous => ({...result, items:[...(previous?.items ?? []).filter(value => value.id !== id), ...result.items.filter(value => value.id === id)]}));
  }
  async function installFromHub(item: SkillHubEntry, versionId: number) {
    const id = skillHubId(item);
    if (!capability || !installed || activeOperations.current.has(id)) return;
    activeOperations.current.set(id, {});
    setBusy(previous => ({...previous, [id]:{operation:'skillhub-install', cancelling:false, name:item.name}}));
    setQueueOpen(true);
    setHubFailures(previous => ({...previous, [id]:(previous[id] ?? []).filter(failure=>failure.versionId!==versionId)}));
    try {
      const result = await capability.call<Installations>('skillhub-install', {publisher:item.publisher, slug:item.slug, versionId});
      mergeInstalled(result, id);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      setHubFailures(previous => ({...previous, [id]:[...(previous[id] ?? []), {item,versionId,message}]}));
    } finally {
      activeOperations.current.delete(id);
      setBusy(previous => {const next={...previous};delete next[id];return next;});
    }
  }
  useEffect(()=>{if(scroller.current)scroller.current.scrollTop=0;},[view,page,scope,query,hubQuery,category,onlyReady,sort]);
  useEffect(()=>{if(embedded)return;const handle=(event:KeyboardEvent)=>{if((event.ctrlKey || event.metaKey) && event.key.toLowerCase()==='k' && !selected){event.preventDefault();searchInput.current?.focus();}};window.addEventListener('keydown',handle);return()=>window.removeEventListener('keydown',handle);},[embedded,searchInput,selected]);
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
        // Each operation owns one skill; concurrent replies must not replace other records.
        mergeInstalled(result, target.id);
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

  function reasonContent(target: Skill) {
    const reason = installationBlock(target);
    return <><span>{zh ? admissionReasonsZh[reason] ?? reason : reason}</span>
      <a href={target.source.url} target="_blank" rel="noreferrer">{text('查看技能原文','View skill source')}</a>
      {target.license.evidence_url && target.license.evidence_url !== target.source.url &&
        <a href={target.license.evidence_url} target="_blank" rel="noreferrer">{text('许可依据','License evidence')}</a>}</>;
  }
  function primary(target:Skill, compact=false) {
    const saved=records.find(value=>value.id===target.id), pending=busy[target.id];
    if(saved)return <Button variant={compact?'ghost':'primary'} disabled={!!pending} busy={opening===target.id} onClick={()=>void useSkill(target)}>{compact?text('去使用','Use skill'):text('在新会话中使用','Use in new chat')}<Icon name="arrow" size={14}/></Button>;
    if (installationBlock(target)) return compact ? <span className="skills-unavailable">{text('暂不可安装','Install unavailable')}</span> : null;
    return <Button variant={compact?'secondary':'primary'} disabled={!!pending||!installed} busy={!!pending} onClick={()=>void operate('install',target)}>{text('安装技能','Install')}</Button>;
  }
  function retry(target:Skill) {
    const outcome=outcomes[target.id];
    if(!outcome)return;
    if(outcome.operation==='use')void useSkill(target, String(outcome.input.message||''));
    else void operate(outcome.operation,target,outcome.input);
  }
  const failedHubIds = Object.keys(hubFailures).filter(id=>hubFailures[id]?.length);
  const taskIds=[...new Set([...Object.keys(outcomes),...failedHubIds,...Object.keys(busy)])].reverse();
  const running=taskIds.filter(id=>busy[id]).length;
  const missingEvidence=item ? <>{text('未明确列出，请查看','Not explicitly listed; review the')} <a href={item.source.url} target="_blank" rel="noreferrer">{text('技能原文','original skill')}</a>。</> : null;

  const filtered = !!(query || category || scope || onlyReady);
  function changeFilter<T>(setValue: (value:T) => void, value:T) {
    setPage(0);
    setValue(value);
  }
  const clearFilters = () => {setPage(0);setQuery('');setCategory('');setScope('');setOnlyReady(false);setSort('flow');};
  const activeFilters = Number(Boolean(scope)) + Number(Boolean(category)) + Number(onlyReady) + Number(sort !== 'flow');
  return <main className={embedded ? 'skills-market skills-market-embedded' : 'skills-market'}>
        <Tabs className="skills-frame" value={view} onValueChange={value=>changeFilter(setView,value)}>
          <AppBar scope={<TabsList variant="navigation" aria-label={text('技能视图','Skill views')}>
            <TabsTrigger value="discover">{text('发现技能','Discover')}</TabsTrigger>
            <TabsTrigger value="skillhub">SkillHub</TabsTrigger>
            <TabsTrigger value="installed">{text('已安装','Installed')}{installed?` (${records.length})`:''}</TabsTrigger>
          </TabsList>} utilities={<IconButton label={text('刷新','Refresh')} busy={!hub && (viewingInstalled ? inventoryLoading : loading)} disabled={!capability} onClick={() => hub ? setHubRefresh(value=>value+1) : viewingInstalled ? void loadInstalled() : void load()}><Icon name="refresh" size={14}/></IconButton>} />
          <ContentPane id="skills-catalog" label={hub ? 'SkillHub' : text('技能列表','Skill results')} as="div" surface="list" inset="compact" scroll="pane" bodyRef={scroller}
            toolbar={<><div className="pero-catalog-tools">
            <SearchField ref={searchInput} aria-label={hub ? text('搜索 SkillHub','Search SkillHub') : text('搜索技能','Search skills')}
              placeholder={hub ? text('搜索 SkillHub','Search SkillHub') : text('搜索技能','Search skills')} value={hub ? hubQuery : query}
              onChange={event=>hub ? setHubQuery(event.target.value) : changeFilter(setQuery,event.target.value)}/>
            {!hub && <Button variant="ghost" aria-expanded={filtersOpen} onClick={()=>setFiltersOpen(!filtersOpen)}>
              {text('筛选','Filters')}{activeFilters ? ` (${activeFilters})` : ''}
            </Button>}
            </div>
            {!hub && filtersOpen && <div className="pero-catalog-tools">
            <Select label={text('技能范围','Skill scope')} value={scope} options={[{value:'',label:text('全部','All')},{value:'general',label:text('通用','General')},{value:'research',label:text('科研','Research')}]} onChange={value=>changeFilter(setScope,value)}/>
            <Select label={text('任务分类','Task category')} value={category} options={[{value:'',label:text('全部任务分类','All categories')},...categories]} onChange={value=>changeFilter(setCategory,value)}/>
            <label className="skills-ready"><Checkbox checked={onlyReady} onCheckedChange={checked=>changeFilter(setOnlyReady,checked===true)}/>{text('可直接安装','Ready to install')}</label>
            <Select label={text('排序方式','Sort skills')} value={sort} options={[{value:'flow',label:text('按任务','Task')},{value:'name',label:text('按名称','Name')}]} onChange={value=>changeFilter(setSort,value)}/>
            {(filtered || activeFilters > 0) && <Button variant="ghost" onClick={clearFilters}>{text('清除筛选','Clear filters')}</Button>}
            </div>}</>}
            feedback={<div className="skills-status">
            {!hub&&!viewingInstalled&&loading&&<Feedback>{catalog?text('正在刷新，保留当前目录。','Refreshing; the current catalog remains visible.'):text('正在读取技能目录…','Loading the skill catalog…')}</Feedback>}
            {!hub&&!viewingInstalled&&error&&<Feedback kind="error">{text('读取未完成，已保留可用内容。','Loading is incomplete; available content is retained.')} {error} <Button variant="link" disabled={loading} onClick={()=>void load()}>{text('重试','Retry')}</Button></Feedback>}
            {inventoryError&&<Feedback kind="error">{text('无法读取已安装技能。','Could not load installed skills.')} {inventoryError} <Button variant="link" disabled={inventoryLoading} onClick={()=>void loadInstalled()}>{text('重试','Retry inventory')}</Button></Feedback>}
            {(hub || viewingInstalled) && inventoryLoading && !installed && <Feedback>{text('正在读取已安装技能…','Loading installed skills…')}</Feedback>}
            {noCapability&&<Feedback kind="error">{text('此 Host 不提供 Skills 市场能力。请更新 Pero 后重试。','This Host does not provide the Skills market capability. Update Pero and retry.')}</Feedback>}
          </div>}
            footer={shown && (viewingInstalled ? installed : catalog) && <nav className="skills-pagination" aria-label={text('技能分页','Skill pages')}>
              <span className="skills-catalog-total">{shown.total.toLocaleString(locale)} {filtered ? text('项匹配', shown.total===1?'match':'matches') : text('项技能', shown.total===1?'skill':'skills')}{shown.pages > 1 && <> · {text(`显示 ${shown.start+1}–${shown.start+shown.items.length} 项`, `Showing ${shown.start+1}–${shown.start+shown.items.length}`)}</>}</span>
              {shown.pages > 1 && <div>
                <IconButton label={text('上一页','Previous')} disabled={shown.page===0} onClick={()=>setPage(shown.page-1)}><Icon name="chevron-left"/></IconButton>
                <span>{shown.page+1} / {shown.pages}</span>
                <IconButton label={text('下一页','Next')} disabled={shown.page+1===shown.pages} onClick={()=>setPage(shown.page+1)}><Icon name="chevron-right"/></IconButton>
              </div>}
            </nav>}>
          <TabsContent value={view}>
            {hub ? <SkillHub query={hubQuery} refresh={hubRefresh} installed={installed} busy={busy} onOpen={item=>setHubHistory({item,versionId:hubFailures[skillHubId(item)]?.at(-1)?.versionId})} onPageChange={()=>scroller.current?.scrollTo(0,0)}/> : !shown || (viewingInstalled ? !installed : !catalog) ? null : <div className="skills-layout">
              <section className="skills-results" aria-label={text('技能列表','Skill results')}>
                {shown.items.length ? <ul className="skills-directory">{shown.items.map(value=>{
                  return <li key={value.id}><ListRow onOpen={()=>open(value)}
                    title={<span className="skills-result-name" title={title(value)}>{title(value)}</span>}
                    meta={description(value)}
                    trailing={<div className="skills-result-action">
                      {outcomes[value.id]?.error && <span className="skills-failed-label">{text('操作未完成','Action incomplete')}</span>}
                      {primary(value,true)}
                    </div>}/>
                  </li>;
                })}</ul> : <EmptyState icon={<EmptyIllustration kind={viewingInstalled && records.length === 0 ?'data':'search'} size="compact"/>} heading={viewingInstalled && records.length === 0 ?text('尚未安装技能','No installed skills'):text('没有匹配的技能','No matching skills')} description={text('换一个任务关键词，或清除分类条件再试试。','Try another task keyword or clear the category filter.')} actions={viewingInstalled && records.length > 0
                  ? <Button onClick={clearFilters}>{text('清除筛选','Clear filters')}</Button>
                  : <Button onClick={()=>{clearFilters();setView('discover');}}>{text('浏览全部技能','Browse all skills')}</Button>}/>}
              </section>
            </div>}
          </TabsContent>
          </ContentPane>
        </Tabs>
    {taskIds.length > 0 && <section className="skills-task-queue" aria-label={text('安装任务','Installation tasks')}>
      <header>
        <Button variant="ghost" aria-expanded={queueOpen} onClick={()=>setQueueOpen(!queueOpen)}>
          <Icon name={running?'sync':'export'} size={16}/>
          <strong>{running ? text(`${running} 项正在处理`,`${running} running`) : text('最近操作','Recent actions')}</strong>
          <span>{taskIds.length}</span><Icon name={queueOpen?'chevron-down':'up'} size={14}/>
        </Button>
        {!running && <Button variant="ghost" aria-label={text('清除已完成任务','Clear completed tasks')} onClick={()=>{setOutcomes({});setHubFailures({});}}><Icon name="close" size={15}/></Button>}
      </header>
      {queueOpen && <div className="skills-queue-items">{taskIds.map(id=>{
        const target = entries.find(value=>value.id===id);
        const pending = busy[id], outcome = outcomes[id];
        const failure = pending ? undefined : hubFailures[id]?.at(-1);
        const name = target ? title(target) : pending?.name ?? failure?.item.name;
        if (!name) return null;
        const openFailure = failure ? ()=>{
          setHubHistory({item:failure.item, versionId:failure.versionId});
          setView('skillhub');
        } : undefined;
        const message = pending ? pending.notice || text(
          pending.cancelling?'正在等待取消完成。':'正在获取或核对所选技能，请稍候。',
          pending.cancelling?'Waiting for cancellation.':'Fetching or checking the selected skill.',
        ) : failure?.message ?? outcome?.message;
        const action = pending && ['install','update'].includes(pending.operation)
          ? <Button variant="ghost" aria-label={text(`取消 ${name}`,`Cancel ${name}`)} busy={pending.cancelling} onClick={()=>void cancel(id)}><Icon name="close" size={14}/></Button>
          : openFailure ? <Button variant="link" onClick={openFailure}>{text('查看发布版本','View release')}</Button>
          : !pending && target && outcome?.error
            ? <Button variant="link" onClick={()=>retry(target)}>{text('重试','Retry')}</Button>
            : !pending && target && records.some(value=>value.id===id)
              ? <Button variant="link" onClick={()=>void useSkill(target)}>{text('去使用','Use skill')}</Button> : undefined;
        return <div className="skills-queue-item" key={id}>
          <ListRow title={<><Icon name={pending?'sync':failure || outcome?.error?'alert':'check'} size={16}/>{name}</>}
            onOpen={openFailure ?? (target ? ()=>open(target) : undefined)} trailing={action}/>
          <p role={pending?'status':failure || outcome?.error?'alert':'status'}>{message}</p>
        </div>;
      })}</div>}
    </section>}

    {hubHistory && <SkillHubHistory key={skillHubId(hubHistory.item)}
      item={hubHistory.item} versionId={hubHistory.versionId} text={text} close={()=>setHubHistory(undefined)}
      saved={records.find(record=>record.id===skillHubId(hubHistory.item))} ready={!!installed}
      busy={!!busy[skillHubId(hubHistory.item)]} failures={hubFailures[skillHubId(hubHistory.item)]}
      onInstall={(item, versionId)=>void installFromHub(item, versionId)}/>}
    {item&&<Dialog presentation="drawer" className="skills-detail" title={text('技能详情','Skill details')} closeLabel={text('关闭详情','Close details')} onClose={()=>setSelected('')} footerStart={(record || !installationBlock(item)) && <span className="skills-footer-note"><Icon name={record?'check':'local'} size={14}/>{record?text('已安装在本地','Installed locally'):text('安装到当前 Pero','Install in this Pero')}</span>} footer={primary(item)}>
      <div className="skills-detail-content">
        <InspectorHeader title={title(item)} identity={<span className="skills-detail-identity"><SkillGlyph skill={item}/><span className="skills-category">{categoryLabel(item)}</span></span>} subtitle={<code>{item.name}</code>} status={record ? text('已安装','Installed') : text('未安装','Not installed')} /><p className="skills-description">{description(item)}</p>
        {!record&&installationBlock(item)&&<Feedback><strong>{text('暂不可安装','Install unavailable')}</strong><div className="skills-block-reason">{reasonContent(item)}</div></Feedback>}
        {itemBusy&&<Feedback>{itemBusy.notice||text('正在处理，可关闭详情继续浏览。','Working; close details to keep browsing.')} {['install','update'].includes(itemBusy.operation)&&<Button variant="link" disabled={itemBusy.cancelling} onClick={()=>void cancel(item.id)}>{text('取消','Cancel')}</Button>}</Feedback>}
        {!itemBusy&&outcomes[item.id]?.error&&<Feedback kind="error">{outcomes[item.id].message}<Button variant="link" onClick={()=>retry(item)}>{text('重试','Retry')}</Button></Feedback>}
        <Tabs value={detailTab} onValueChange={setDetailTab}><TabsList variant="navigation" aria-label={text('技能详情视图','Skill detail views')}><TabsTrigger value="overview">{text('用途与条件','Overview')}</TabsTrigger><TabsTrigger value="examples">{text('示例任务','Examples')}</TabsTrigger><TabsTrigger value="source">{text('来源与版本','Source and version')}</TabsTrigger></TabsList>
          <TabsContent value="overview">
            <div className="skills-io-grid">{(['inputs','outputs'] as const).map(key=><ContentSection id={`skill-${key}`} key={key} title={key==='inputs'?text('准备什么','Inputs'):text('得到什么','Outputs')}>{zh&&copy(item)&&<p>{key==='inputs'?copy(item)?.input:copy(item)?.output}</p>}<SkillEvidence sections={item[key]} missing={missingEvidence}/></ContentSection>)}</div>
            <ContentSection id="skill-before" title={text('使用前了解','Before you use it')}><dl className="skills-facts"><dt>{text('来源','Repository')}</dt><dd>{item.source.repository}</dd><dt>{text('许可','License')}</dt><dd>{item.license.spdx||text('未知','Unknown')}</dd><dt>{text('运行条件','Requirements')}</dt><dd>{item.compatibility?.declared?.join(', ')||text('未单列声明，请以原文为准','Not explicitly declared; review the original skill.')}</dd><dt>{text('条目类型','Entry type')}</dt><dd>{item.kind==='general_skill'?text('通用技能','General skill'):item.kind==='internal_dependency'?text('内部依赖','Internal dependency'):item.kind==='research_support'?text('科研辅助','Research support'):text('科研技能','Research skill')}</dd><dt>{text('兼容状态','Compatibility')}</dt><dd>{item.compatibility?.status==='unverified'?text('尚未验证','Unverified'):({static_instructions:text('静态指引已审查；执行环境待核查','Static instructions reviewed; execution environment unchecked'),requires_adaptation:text('需要宿主或工具适配','Host or tool adaptation required')})[item.compatibility?.status as 'static_instructions'|'requires_adaptation']||item.compatibility?.status||text('未声明','Not declared')}</dd><dt>{text('实际运行','Runtime evidence')}</dt><dd>{item.verification?.runtime==='not_run'?text('未执行','Not run'):item.verification?.runtime||text('未提供','Not provided')}</dd></dl></ContentSection>
            <ContentSection id="skill-dependencies" title={text('运行依赖','Dependencies')}><SkillEvidence sections={item.dependencies} missing={missingEvidence}/></ContentSection>
            <p className="skills-verification-note">{text('来源已收录；运行与科研效果未统一验证。','Catalog inclusion does not establish runtime or scientific validation.')} {item.verification?.notes?.join(' ')}</p>
            {record&&<><ContentSection id="skill-automatic" title={text('自动用于后续普通聊天','Use automatically in future chats')} actions={<Switch checked={record.enabled&&record.selected} aria-label={text('用于后续普通聊天','Use in subsequent ordinary chats')} disabled={!!itemBusy} onCheckedChange={enabled=>void operate('enable',item,{enabled})}/>}><p>{text('手动选择无需开启。自动装配只作用于后续普通 Pero Agent 会话。','Manual selection needs no global activation. Automatic assembly applies to subsequent ordinary Pero Agent chats.')}</p></ContentSection><p className="skills-revocation-note">{text('停用或移除不会清除已加载的指引。需停止并重开已有会话才能彻底撤销。','Selection applies only to subsequent ordinary Pero chats, not App sessions. Stop and reopen existing sessions to revoke instructions already loaded.')}</p><Button variant="link" disabled={!!itemBusy} onClick={()=>setRemoving(item)}><Icon name="trash" size={14}/>{text('移除本地安装','Remove')}</Button></>}
          </TabsContent>
          <TabsContent value="examples"><ContentSection id="skill-examples" title={text('可以这样发起任务','Start a research task')}><p>{text('先在聊天中选中技能，再补充你的实际材料与要求。','Select the skill in Chat, then add your actual materials and requirements.')}</p>{zh&&copy(item)&&<><blockquote>{copy(item)?.example}</blockquote>{record&&<Button onClick={()=>void useSkill(item,copy(item)?.example)}>{text('带着示例去会话','Use example in chat')}<Icon name="arrow" size={14}/></Button>}</>}<SkillEvidence sections={item.examples} missing={missingEvidence}/></ContentSection></TabsContent>
          <TabsContent value="source"><ContentSection id="skill-source" title={text('来源信息','Source information')}><dl className="skills-facts"><dt>{text('仓库','Repository')}</dt><dd><a href={item.source.url} target="_blank" rel="noreferrer">{item.source.repository}<Icon name="open" size={13}/></a></dd><dt>{text('固定版本','Pinned revision')}</dt><dd><code>{item.source.commit}</code></dd><dt>{text('技能文件','Skill file')}</dt><dd><code>{item.source.path}</code></dd><dt>{text('许可依据','License evidence')}</dt><dd><a href={item.license.evidence_url||item.source.url} target="_blank" rel="noreferrer">{item.license.spdx||text('待核对','Unverified')}</a> · {({declared_in_skill:text('技能自身声明','Declared by the skill'),directory_license:text('技能目录许可证','Skill directory license'),reviewed_repository:text('已复审仓库许可适用范围','Reviewed repository license scope'),repository_only:text('仅有仓库声明','Repository declaration only')})[item.license.status as 'declared_in_skill'|'directory_license'|'reviewed_repository'|'repository_only']||text('尚无许可依据','No license evidence')}</dd></dl></ContentSection><ContentSection id="skill-original" title={text('原始说明','Original description')}><p className="skills-original-description">{item.description||text('来源未提供摘要。','No source summary.')}</p></ContentSection>
            {record&&<ContentSection id="skill-version" title={text('版本管理','Version management')}>
              <dl className="skills-facts">
                <dt>{text('已安装版本','Installed revision')}</dt><dd>{item.source.release && `${item.source.release} · `}<code>{record.revision}</code></dd>
                {catalogRevision && catalogRevision !== record.revision && <><dt>{text('目录固定版本','Catalog revision')}</dt><dd><code>{catalogRevision}</code></dd></>}
                {record.invocation&&<><dt>{text('调用名称','Invocation')}</dt><dd><code>/{record.invocation}</code></dd></>}
              </dl>
              {retained.length>1 && <div className="skills-version-actions">
                <Select label={text('本地保留版本','Retained versions')} value={chosenRevision} disabled={!!itemBusy}
                  options={retained.map(revision=>{
                    const name = record.releaseNames?.[revision] ?? revision.slice(0,12);
                    return {value:revision,hint:revision,label:revision === record.revision
                      ? text(`${name} · 当前`,`${name} · Current`) : name};
                  })}
                  onChange={setTargetRevision}/>
                <Button disabled={!!itemBusy || chosenRevision === record.revision} onClick={()=>void operate('rollback',item,{revision:chosenRevision})}>{text('切换版本','Switch version')}</Button>
              </div>}
              <div className="skills-version-actions">
                {!item.source.release && <Button disabled={!!itemBusy} onClick={()=>void operate('check-update',item)}>{text('检查更新','Check for updates')}</Button>}
                {update?.updateAvailable && <Button disabled={!!itemBusy} onClick={()=>void operate('update',item,{revision:update.latestRevision,sha256:update.latestSha256})}>{text('更新','Update')}</Button>}
                <Button disabled={!!itemBusy||!record.previousRevision} onClick={()=>void operate('rollback',item)}>{text('回退','Roll back')}</Button>
              </div>
              {update&&<Feedback>{update.updateAvailable ? text(`发现新版本 ${update.latestRevision.slice(0,12)}`,`Update available: ${update.latestRevision.slice(0,12)}`) : text('已是当前上游版本','Already at the current upstream revision')}</Feedback>}
            </ContentSection>}
            {item.sources?.length>1&&<ContentSection id="skill-other-sources" title={text('其他来源','Other sources')}><ul>{item.sources.map((source,index)=><li key={index}><a href={source.url} target="_blank" rel="noreferrer">{source.repository} / {source.path}</a></li>)}</ul></ContentSection>}
          </TabsContent>
        </Tabs>
      </div>
    </Dialog>}
    {removing&&<Dialog title={text(`移除 ${title(removing)}？`,`Remove ${title(removing)}?`)} closeLabel={text('关闭','Close')} size="sm" onClose={()=>setRemoving(undefined)} footer={<><Button onClick={()=>setRemoving(undefined)}>{text('取消','Cancel')}</Button><Button variant="danger" disabled={!!busy[removing.id]} onClick={()=>{const target=removing;setRemoving(undefined);void operate('remove',target);}}>{text('移除','Remove')}</Button></>}><p>{text('将从已安装列表和后续会话选择中移除。已有会话仍绑定原快照，不会被中途替换或清除。','Remove from installed skills and future session selection. Existing sessions retain their original snapshot.')}</p></Dialog>}
  </main>;
});
