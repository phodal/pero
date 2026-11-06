import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '../components/button';
import { Icon } from '../components/icon';
import { Card } from '../components/card';
import { Input } from '../components/input';
import { Field } from '../components/field';
import { RadioGroup, RadioGroupItem } from '../components/radio-group';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/tabs';
import { Table } from '../components/table';
import { Feedback } from '../components/feedback';
import { EmptyState } from '../components/empty-state';
import { EmptyIllustration } from '../components/empty-illustration';
import { LoadingSkeleton, SkeletonText } from '../components/skeleton';
import { Disclosure } from '../components/disclosure';
import { Dialog } from '../components/dialog';
import { Badge, OutlineBadge, LibraryHeader } from '../../../pero-design/src/components';
import { METHODS } from './model.mjs';
import { EnvironmentChecks, type InspectionProps } from './inspection';

export const managerMessages = (locale: string) => locale.startsWith('zh') ? {
 createNote:'选择计算方法，在本机安装所需软件。', local:'本机环境', preparationNote:'准备完成后可切换应用环境，不会自动开始计算。', catalogNote:'管理方法所需的软件，让计算有据可查。', controlNote:'控制系统仿真', circuitNote:'电路仿真', pcgymNote:'过程控制复现', relatedApp:'关联应用', software:'将准备的软件', runtime:'运行时', packages:'依赖包', title:'执行环境', environments:'本机环境', inspect:'软件检查', create:'创建环境', name:'环境名称', method:'方法', prepare:'准备环境', createPrepare:'创建并准备', bind:'使用此环境', back:'返回', refresh:'刷新', empty:'尚未创建本机环境', emptyNote:'创建一个环境，为方法安装所需软件。', loading:'正在读取环境…', created:'待准备', preparing:'准备中', ready:'准备完成', failed:'准备失败', status:'状态', usedBy:'用于', actions:'操作', dependencies:'Python 依赖', log:'安装日志', cancel:'取消', confirm:'绑定并重启', confirmTitle:'切换应用环境', confirmText:'将重启应用后端并停止其中的计算。请先保存工作。', shared:'Control 和 Circuit 共用 Control Lab 的环境。', native:'准备 Circuit 时会通过 Homebrew 安装 ngspice，并将该程序绑定到环境。', python:'Python 3.12', createFailed:'环境未能创建，请检查后重试。', failedLoad:'环境列表无法读取', active:'当前使用', retry:'重试', version:'版本', retained:'正在显示上次读取的环境，请重试更新。'
} : {
 createNote:'Choose a scientific method and install its software on this computer.', local:'Local environment', preparationNote:'Switch the App environment when ready. Preparation does not start a calculation.', catalogNote:'Manage the software behind your scientific methods.', controlNote:'Control system simulation', circuitNote:'Circuit simulation', pcgymNote:'Process control reproduction', relatedApp:'Related App', software:'Software to prepare', runtime:'Runtime', packages:'Packages', title:'Environments', environments:'Local environments', inspect:'Software checks', create:'Create environment', name:'Environment name', method:'Method', prepare:'Prepare environment', createPrepare:'Create and prepare', bind:'Use this environment', back:'Back', refresh:'Refresh', empty:'No local environments yet', emptyNote:'Create an environment to install the software a method needs.', loading:'Loading environments…', created:'Not prepared', preparing:'Preparing', ready:'Prepared', failed:'Preparation failed', status:'Status', usedBy:'Used by', actions:'Actions', dependencies:'Python dependencies', log:'Installation log', cancel:'Cancel', confirm:'Bind and restart', confirmTitle:'Switch App environment', confirmText:'This restarts the App backend and stops its calculations. Save your work first.', shared:'Control and Circuit share the Control Lab environment.', native:'Circuit preparation installs ngspice through Homebrew and binds the program to this environment.', python:'Python 3.12', createFailed:'Could not create the environment. Check the details and try again.', failedLoad:'Could not load environments', active:'Currently in use', retry:'Retry', version:'Version', retained:'Showing the previous environment list. Retry to update it.'
};
interface LocalEnvironment {
  id: string; label: string; target: string; dependencies: string[]; state: 'created' | 'preparing' | 'ready' | 'failed'; log: string[]; error: string | null; bound: boolean;
}
type Request = { operation: 'list' } | { operation: 'create'; label: string; target: string } | { operation: 'prepare' | 'bind'; id: string };
interface ManagerProps { locale?: string; fetchFn?: typeof fetch; inspect?: InspectionProps['inspect']; pollMs?: number }

/** The Host remains the owner of preparation and backend bindings. */
export function EnvironmentManager({ locale = 'en', fetchFn = globalThis.fetch, inspect, pollMs = 1000 }: ManagerProps) {
  const t = managerMessages(locale), [values, setValues] = useState<LocalEnvironment[]>([]), [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [selected, setSelected] = useState(''), [tab, setTab] = useState('environments');
  const [accessRevoked, setAccessRevoked] = useState(false), [createError, setCreateError] = useState('');
  const [creating, setCreating] = useState(false), [confirming, setConfirming] = useState(false), [label, setLabel] = useState(''), [target, setTarget] = useState<string>(METHODS[1].id);
  const mounted = useRef(false), pending = useRef(false), latestValues = useRef(values), generation = useRef(0), heading = useRef<HTMLSpanElement>(null), input = useRef<HTMLInputElement>(null);
  const previousPage = useRef('catalog'); latestValues.current = values;
  const call = useCallback(async (request: Request) => {
    const response = await fetchFn('/host/environment/profiles', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) });
    if (!response.ok) {
      const failure = Object.assign(Error((await response.text()).slice(0, 1000)), { status: response.status }); throw failure;
    }
    const result: LocalEnvironment[] = await response.json();
    if (!Array.isArray(result)) throw Error('Invalid environment catalog');
    return result;
  }, [fetchFn]);
  const request = useCallback(async (operation: Request) => {
    if (pending.current) return;
    pending.current = true; const current = ++generation.current;
    let activeOperation = operation.operation;
    setBusy(true); setError('');
    if (activeOperation === 'create') setCreateError('');
    try {
      const previous = latestValues.current, result = await call(operation);
      if (!mounted.current || current !== generation.current) return;
      setValues(result); setLoaded(true); setAccessRevoked(false);
      if (operation.operation === 'create') {
        const created = result.find(value => !previous.some(item => item.id === value.id));
        setCreating(false); setLabel('');
        activeOperation = 'prepare';
        if (created) {
          setSelected(created.id);
          const prepared = await call({ operation: 'prepare', id: created.id });
          if (mounted.current && current === generation.current) setValues(prepared);
        }
      }
    } catch (failure) {
      if (mounted.current && current === generation.current) {
        if (failure instanceof Error && 'status' in failure && [401, 403, 404, 410].includes(Number(failure.status))) { setValues([]); setLoaded(false); setAccessRevoked(true); }
        (activeOperation === 'create' ? setCreateError : setError)(failure instanceof Error ? failure.message : String(failure));
      }
    } finally {
      if (current === generation.current) { pending.current = false; if (mounted.current) setBusy(false); }
    }
  }, [call]);
  useEffect(() => {
    mounted.current = true; void request({ operation: 'list' });
    return () => { mounted.current = false; pending.current = false; generation.current++; };
  }, [request]);
  const preparing = values.some(value => value.state === 'preparing');
  useEffect(() => {
    if (!preparing) return;
    let stopped = false, polling = false;
    const poll = async () => {
      if (pending.current || polling) return;
      polling = true;
      const current = generation.current;
      try {
        const result = await call({ operation: 'list' });
        if (!stopped && mounted.current && current === generation.current) { setValues(result); setError(''); }
      } catch (failure) {
        if (!stopped && mounted.current && current === generation.current) {
          if (failure instanceof Error && 'status' in failure && [401, 403, 404, 410].includes(Number(failure.status))) { setValues([]); setLoaded(false); setAccessRevoked(true); }
          setError(failure instanceof Error ? failure.message : String(failure));
        }
      } finally { polling = false; }
    };
    const timer = setInterval(() => void poll(), pollMs);
    return () => { stopped = true; clearInterval(timer); };
  }, [preparing, call, pollMs]);
  const value = values.find(item => item.id === selected), method = METHODS.find(item => item.id === (value?.target ?? target))!;
  const page = creating ? 'create' : value?.id ?? 'catalog';
  useEffect(() => {
    if (page !== previousPage.current) (creating ? input.current : heading.current)?.focus({ preventScroll: true });
    previousPage.current = page;
  }, [page, creating]);
  const status = (item: LocalEnvironment) => <Badge tone={item.state === 'ready' ? 'success' : item.state === 'failed' ? 'error' : item.state === 'preparing' ? 'info' : 'neutral'}>{t[item.state]}</Badge>;
  const back = () => { setCreating(false); setSelected(''); setConfirming(false); setError(''); setCreateError(''); };
  const startCreating = () => { setCreating(true); setSelected(''); };
  // App frames disallow native form navigation. Keep validation and dispatch
  // explicit so pointer and Enter work in both the sandbox and Native WebView.
  const createEnvironment = (form: HTMLFormElement) => {
    if (!busy && form.reportValidity()) void request({ operation: 'create', label, target });
  };
  return <main className={`pero-env env-workspace${creating ? ' env-workspace-create' : ''}`}><div className="env-workspace-content">
    {(creating || value) && <nav className="env-back" aria-label={t.back}><Button variant="ghost" disabled={busy} onClick={back}><Icon family="shell" name="back" />{t.back}</Button></nav>}
    <LibraryHeader density="compact" title={<span ref={heading} tabIndex={-1}>{creating ? t.create : value?.label ?? t.title}</span>}
      subtitle={creating ? t.createNote : value ? `${method.name} · ${t.local}` : t.catalogNote}
      actions={<>{value && status(value)}{value ? value.bound ? <span className="env-muted">{t.active}</span> : value.state !== 'preparing' && <Button variant="primary" busy={busy} onClick={() => value.state === 'ready' ? setConfirming(true) : void request({ operation: 'prepare', id: value.id })}>{value.state === 'ready' ? t.bind : t.prepare}</Button>
        : !creating && <><Button busy={busy} onClick={() => void request({ operation: 'list' })}>{t.refresh}</Button>{(!loaded || values.length > 0 || tab !== 'environments') && <Button variant="primary" disabled={busy} onClick={startCreating}>{t.create}</Button>}</>}</>} />
    {error && !creating && <div className="env-load-error"><Feedback kind="error" variant="block">{!loaded && `${t.failedLoad}: `}{error}{loaded && ` ${t.retained}`}</Feedback><Button disabled={busy} onClick={() => void request({ operation: 'list' })}>{t.retry}</Button></div>}
    {creating ? <form className="env-create-form" onSubmit={event => { event.preventDefault(); createEnvironment(event.currentTarget); }}>
      <Field label={t.name} controlId="env-name">{control => <Input {...control} ref={input} required maxLength={80} autoComplete="off" value={label} disabled={busy} onChange={event => setLabel(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); if (!event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) createEnvironment(event.currentTarget.form!); } }} />}</Field>
      <section className="env-method-section" aria-labelledby="env-method-label">
        <h3 id="env-method-label">{t.method}</h3>
        <RadioGroup id="env-method" aria-labelledby="env-method-label" value={target} disabled={busy} onValueChange={setTarget} className="env-method-choices">
          {[...METHODS.slice(1), METHODS[0]].map(item => <RadioGroupItem key={item.id} variant="card" value={item.id} aria-label={item.name}>
            <span className="env-method-option"><span className="env-method-icon" data-tone={item.tone}><Icon name={item.icon} size={18} /></span>
              <span className="env-method-copy"><strong>{item.name}</strong><span>{item.id === 'paper-agent.pcgym' ? t.pcgymNote : item.id === 'control-lab.ngspice' ? t.circuitNote : t.controlNote}</span></span>
            </span>
          </RadioGroupItem>)}
        </RadioGroup>
      </section>
      <Card tone="blue" variant="soft" className="env-recipe-summary" asChild><section aria-labelledby="env-software-title">
        <h3 id="env-software-title"><Icon name="cube" size={18}/>{t.software}</h3>
        <dl className="env-recipe-facts">
          <div><dt>{t.runtime}</dt><dd>{t.python} · {t.local}</dd></div>
          <div><dt>{t.packages}</dt><dd className="env-package-list">{method.software.split(', ').map(name => <OutlineBadge key={name}>{name}</OutlineBadge>)}</dd></div>
          <div><dt>{t.relatedApp}</dt><dd>{method.app}</dd></div>
        </dl>
        {method.app === 'Control Lab' && <p className="env-note">{t.shared}</p>}
        {target === 'control-lab.ngspice' && <Feedback kind="warning" variant="block">{t.native}</Feedback>}
      </section></Card>
      {createError && <Feedback kind="error" variant="block">{t.createFailed} {createError}</Feedback>}
      <footer className="env-create-footer"><p className="env-note">{t.preparationNote}</p><div className="env-form-actions"><Button variant="ghost" disabled={busy} onClick={back}>{t.cancel}</Button><Button type="submit" variant="primary" busy={busy} onClick={event => { event.preventDefault(); createEnvironment(event.currentTarget.form!); }}>{t.createPrepare}</Button></div></footer>
    </form> : value ? <>
      <dl className="env-facts">{[[t.method, method.name], ['Python', '3.12'], [t.usedBy, value.bound ? method.app : '—']].map(([name, text]) => <div key={name}><dt>{name}</dt><dd>{text}</dd></div>)}</dl>
      {method.app === 'Control Lab' && <p className="env-note">{t.shared}</p>}{value.error && <Feedback kind="error" variant="block">{value.error}</Feedback>}
      {value.state === 'preparing' && <Feedback>{value.log.filter(line => !line.startsWith('WARN')).at(-1) || t.preparing}</Feedback>}
      <h3>{t.dependencies}</h3><Table className="env-dependency-table" label={t.dependencies} density="compact" rows={value.dependencies.map(dependency => { const [name, version] = dependency.split('=='); return { name, version }; })} rowId={item => item.name} columns={[
        { id: 'name', header: t.name, size: 240, cell: item => item.name }, { id: 'version', header: t.version, size: 150, cell: item => item.version ?? '—' },
      ]} />
      {value.target === 'control-lab.ngspice' && <p className="env-note">{t.native}</p>}
      {!!value.log.length && <Disclosure variant="inline" className="env-install-log" summary={t.log}><pre className="env-json">{value.log.join('\n')}</pre></Disclosure>}
      {confirming && <Dialog title={t.confirmTitle} closeLabel={t.cancel} onClose={() => setConfirming(false)} footer={<><Button onClick={() => setConfirming(false)}>{t.cancel}</Button><Button variant="primary" busy={busy} onClick={() => { setConfirming(false); void request({ operation: 'bind', id: value.id }); }}>{t.confirm}</Button></>}><Feedback kind="warning" variant="block">{t.confirmText}</Feedback></Dialog>}
    </> : <Tabs value={tab} onValueChange={setTab}>
      <TabsList variant="navigation" aria-label={t.title}><TabsTrigger value="environments">{t.environments}</TabsTrigger><TabsTrigger value="inspect">{t.inspect}</TabsTrigger></TabsList>
      <TabsContent value="environments" forceMount>
        {!loaded ? busy ? <LoadingSkeleton label={t.loading}><SkeletonText /></LoadingSkeleton> : null : !values.length ? <EmptyState icon={<EmptyIllustration kind="environment" />} heading={t.empty} description={t.emptyNote} actions={<Button variant="primary" disabled={busy} onClick={startCreating}>{t.create}</Button>} /> : <Table className="env-catalog-table" label={t.environments} density="comfortable" rows={values} rowId={item => item.id} columns={[
          { id: 'name', header: t.name, size: 320, cell: item => <div className="env-catalog-name"><span className="env-method-icon" data-tone={METHODS.find(method => method.id === item.target)!.tone}><Icon name={METHODS.find(method => method.id === item.target)!.icon} size={18}/></span><div><Button variant="link" onClick={() => setSelected(item.id)}>{item.label}</Button><p className="env-muted">{t.python} · {t.local}</p></div></div> },
          { id: 'method', header: t.method, size: 130, cell: item => METHODS.find(method => method.id === item.target)!.name },
          { id: 'status', header: t.status, size: 140, cell: item => status(item) },
          { id: 'usedBy', header: t.usedBy, size: 120, cell: item => item.bound ? METHODS.find(method => method.id === item.target)!.app : '—' },
        ]} />}
      </TabsContent>
      <TabsContent value="inspect" forceMount>{!accessRevoked && <EnvironmentChecks locale={locale} inspect={inspect} embedded />}</TabsContent>
    </Tabs>}
  </div></main>;
}
