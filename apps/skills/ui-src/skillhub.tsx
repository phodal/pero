import React, {useEffect, useState} from 'react';
import {useAppContext, useHostCapability, type HostCapability} from '@pero/app-sdk';
import {Button, Dialog, EmptyIllustration, EmptyState, Feedback, Icon, Select} from '@pero/app-sdk/ui';
import type {SkillHubEntry, SkillHubHistory, SkillHubPage, SkillHubRelease, SkillHubSort} from '../../../protocol/generated/host';
import {SkillCard} from './skill-card';
import type {Installed, Installations} from './types';

type Text = (cn: string, en: string) => string;
type Install = (item: SkillHubEntry, versionId: number) => void;
type Cursor = {query: string; sort: SkillHubSort; page: number};
export const skillHubId = (item: SkillHubEntry) => `skillhub:${item.publisher}/${item.slug}`;
const pageSize = 12;
const pageCount = (total: number) => Math.max(1, Math.ceil(total / pageSize));

async function readHub<T>(capability: HostCapability, operation: string, input: Record<string, unknown>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      capability.call<T>(operation, input),
      new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new Error('SkillHub timed out')), 13000); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function description(item: SkillHubEntry, text: Text) {
  return text(item.descriptionZh || item.description, item.description || item.descriptionZh)
    || text('发布者未提供说明。', 'The publisher did not provide a description.');
}

function History({item, close, text, saved, ready, busy, installErrors, onInstall}: {
  item: SkillHubEntry; close: () => void; text: Text; saved?: Installed;
  ready: boolean; busy: boolean; installErrors?: Record<number, string>; onInstall: Install;
}) {
  const capability = useHostCapability('skills');
  const {locale} = useAppContext();
  const [versions, setVersions] = useState<SkillHubRelease[]>();
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [chosen, setChosen] = useState('');
  const release = versions?.find(version => String(version.versionId) === chosen) ?? versions?.[0];
  const installError = release && installErrors?.[release.versionId];
  const isInstalled = release !== undefined && saved?.entry?.source.release_id === release.versionId;
  useEffect(() => {
    if (!capability) return;
    let current = true;
    setError(false);
    readHub<SkillHubHistory>(capability, 'skillhub-versions', {publisher: item.publisher, slug: item.slug})
      .then(result => {if (current) setVersions(result.versions);}, () => {if (current) setError(true);});
    return () => {current = false;};
  }, [capability, item, attempt]);

  return <Dialog title={item.name} closeLabel={text('关闭','Close')} size="md" onClose={close}
    footer={<>
      <Button asChild variant="ghost"><a href={`https://skillhub.cn/skills/${item.publisher}/${item.slug}`} target="_blank" rel="noreferrer">{text('前往 SkillHub','Open on SkillHub')}<Icon name="open" size={14}/></a></Button>
      <Button variant="primary" busy={busy} disabled={!ready || !release || isInstalled} onClick={()=>{if (release) onInstall(item, release.versionId);}}>
        {busy ? text('正在安装…','Installing…') : isInstalled ? text('此版本已安装','Version installed') : text('安装所选版本','Install selected version')}
      </Button>
    </>}>
    <p className="skills-card-publisher">@{item.publisher}/{item.slug}</p>
    <p>{description(item, text)}</p>
    {release && <Select label={text('安装版本','Version to install')} value={String(release.versionId)} disabled={busy}
      options={(versions ?? []).map(version=>({value:String(version.versionId),label:version.version,hint:String(version.versionId)}))}
      onChange={setChosen}/>}
    {isInstalled && <Feedback>{text('此版本可在新会话的技能选择器中选用。','Select this version from the skill picker in a new chat.')}</Feedback>}
    {installError && <Feedback kind="error">{text('安装失败。','Installation failed.')} {installError}</Feedback>}
    <h3>{text('发布历史','Release history')}</h3>
    {error ? <Feedback kind="error">{text('无法加载 SkillHub 版本。','SkillHub versions are unavailable.')} <Button variant="link" onClick={()=>setAttempt(attempt+1)}>{text('重试','Retry')}</Button></Feedback>
      : versions === undefined ? <Feedback>{text('正在读取发布历史…','Loading releases…')}</Feedback>
      : versions.length === 0 ? <p>{text('尚无公开发布版本。','No public releases.')}</p>
      : <ul className="skills-release-list">{versions.map(release=><li key={release.versionId}>
        <strong>{release.version}</strong>
        {release.createdAt > 0 && release.createdAt <= 8.64e15 && <time>{new Date(release.createdAt).toLocaleDateString(locale)}</time>}
        {release.changelog && <p>{release.changelog}</p>}
      </li>)}</ul>}
  </Dialog>;
}

export function SkillHub({query, refresh, onPageChange, installed, busy, installErrors, onInstall}: {
  query: string; refresh: number; onPageChange: () => void; installed?: Installations;
  busy: Partial<Record<string, unknown>>;
  installErrors: Partial<Record<string, Record<number, string>>>;
  onInstall: Install;
}) {
  const capability = useHostCapability('skills');
  const {locale} = useAppContext();
  const text: Text = (cn,en) => locale === 'zh-CN' ? cn : en;
  const [request, setRequest] = useState<{cursor: Cursor; fetch: boolean; refresh: number}>({
    cursor: {query, sort:'score', page:1}, fetch:true, refresh,
  });
  const [snapshot, setSnapshot] = useState<{cursor: Cursor; result: SkillHubPage}>();
  const [pending, setPending] = useState(true);
  const [error, setError] = useState(false);
  const [selected, setSelected] = useState<SkillHubEntry>();
  const {cursor} = request;
  const {sort, page} = cursor;
  const result = snapshot?.result;
  const visiblePage = snapshot?.cursor.page ?? 1;
  const total = result?.total ?? 0;
  const pages = pageCount(total);
  const canRestore = error && snapshot?.cursor.query === query && snapshot.cursor.sort === sort && visiblePage !== page;

  function search(next: Cursor) {
    setRequest({cursor:next, fetch:true, refresh});
    setPending(true);
    setError(false);
  }
  if (cursor.query !== query || request.refresh !== refresh) {
    search({query, sort, page:cursor.query === query ? page : 1});
  }
  function goToPage(next: number) {
    search({query, sort, page:next});
    onPageChange();
  }
  useEffect(() => {
    if (!capability || !request.fetch) return;
    let current = true;
    const {cursor, refresh} = request;
    const {query, page, sort} = cursor;
    const timer = setTimeout(() => {
      void readHub<SkillHubPage>(capability, 'skillhub-search', {keyword: Array.from(query.trim()).slice(0,120).join(''), page, sort})
        .then(next => {
          if (!current) return;
          const lastPage = pageCount(next.total);
          if (page > lastPage) {
            setRequest({cursor:{query, sort, page:lastPage}, fetch:true, refresh});
            return;
          }
          setSnapshot({cursor, result:next});
          setPending(false);
        }, () => {
          if (!current) return;
          setError(true);
          setPending(false);
        });
    }, 250);
    return () => {current = false; clearTimeout(timer);};
  }, [capability, request]);

  if (!capability) return null;
  return <section className="skills-results" aria-label={text('SkillHub 技能列表','SkillHub results')}>
    <div className="skills-hub-tools">
      <p className="skills-summary" role="status">{pending ? (result ? text('正在查询 SkillHub，当前显示上次结果。','Searching SkillHub. Showing the previous results.') : text('正在查询 SkillHub…','Loading SkillHub…'))
        : error ? (result ? text('显示上次查询结果','Showing the last results') : '')
        : text(`${total.toLocaleString(locale)} 项匹配`,total === 1 ? '1 match' : `${total.toLocaleString(locale)} matches`)}</p>
      <Select label={text('SkillHub 排序','Sort SkillHub')} value={sort} options={[
        {value:'score',label:text('综合','Relevance')},
        {value:'downloads',label:text('下载量','Downloads')},
        {value:'updated_at',label:text('最新更新','Recently updated')},
      ]} onChange={value=>search({query, sort: value as SkillHubSort, page: 1})}/>
    </div>
    {error && <Feedback kind="error">{text('无法查询 SkillHub。','SkillHub is unavailable.')} <Button variant="link" onClick={()=>search(cursor)}>{text('重试','Retry')}</Button>
      {canRestore && <Button variant="link" onClick={()=>{
        setRequest({cursor:snapshot.cursor, fetch:false, refresh});
        setError(false);
      }}>{text(`返回第 ${visiblePage} 页`,`Return to page ${visiblePage}`)}</Button>}
    </Feedback>}
    {result?.items.length ? <div className="skills-grid">
      {result.items.map(item=><SkillCard key={`${item.publisher}/${item.slug}`} name={item.name}
        publisher={`@${item.publisher}`} icon="skill" description={description(item,text)}
        version={{label:item.version || text('无发布版本','Unversioned'),full:item.version}}
        status={<span className="skills-card-publisher">{installed?.items.some(saved=>saved.id===skillHubId(item))
          ? text('已安装','Installed') : `${text('下载','Downloads')} ${item.downloads.toLocaleString(locale)}`}</span>}
        action={<Button variant="secondary" onClick={()=>setSelected(item)}>{text('安装 / 版本','Install / Versions')}</Button>}
        onOpen={()=>setSelected(item)}/>)}
    </div> : !pending && !error && <EmptyState icon={<EmptyIllustration kind="search" size="compact"/>}
      heading={result?.total
        ? text('本页没有可显示的技能','No skills can be displayed on this page')
        : text('没有匹配的技能','No matching skills')}/>}
    {pages > 1 && <footer className="skills-pagination">
      <Button aria-label={text('上一页','Previous')} disabled={pending || error || visiblePage === 1} onClick={()=>goToPage(visiblePage-1)}><Icon name="chevron-left" size={15}/></Button>
      <span>{visiblePage} / {pages}</span>
      <Button aria-label={text('下一页','Next')} disabled={pending || error || visiblePage >= pages} onClick={()=>goToPage(visiblePage+1)}><Icon name="chevron-right" size={15}/></Button>
    </footer>}
    {selected && <History item={selected} text={text} close={()=>setSelected(undefined)}
      saved={installed?.items.find(item=>item.id===skillHubId(selected))} ready={!!installed}
      busy={!!busy[skillHubId(selected)]} installErrors={installErrors[skillHubId(selected)]} onInstall={onInstall}/>}
  </section>;
}
