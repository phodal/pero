import React, {useEffect, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {AppProvider, useAppContext} from '@pero/app-sdk';
import {Badge, Button, Checkbox, EmptyIllustration, EmptyState, Feedback, Icon, IconButton, Input, Select, Tabs, TabsContent, TabsList, TabsTrigger, Textarea, ToggleGroup, ToggleGroupItem} from '@pero/app-sdk/ui';
import {automationRequest, openSession} from './transport';
import {draftBody, editDraft, newDraft, templates, weekdays, type Automation, type Draft, type Run, type Schedule} from './model';
import './frame.css';

const path = (id: string) => `/api/automations/${encodeURIComponent(id)}`;
const enCopy = {
  title: 'Automations',
  subtitle: 'Hand a clear, repeatable job to the local assistant.',
  create: 'New automation',
  templates: 'Templates',
  templatesLabel: 'Templates',
  templateNote: 'Choosing a template only fills a draft. It does not run until you enable it and save.',
  list: 'List',
  calendar: 'Calendar',
  view: 'Automation view',
  search: 'Search automations',
  statusFilter: 'Filter by status',
  all: 'All tasks',
  enabled: 'Enabled',
  paused: 'Paused',
  unavailable: 'Unavailable',
  running: 'Running',
  manual: 'Manual',
  hourly: 'Hourly',
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
  custom: 'RRULE (advanced)',
  task: 'Task',
  schedule: 'Schedule',
  latest: 'Latest run',
  actions: 'Actions',
  listLabel: 'Automations',
  overview: 'Overview',
  runs: 'Runs',
  contentHeading: 'Task content',
  triggerHeading: 'Trigger',
  kept: 'Kept in run history',
  openDetail: 'Details',
  detailNav: 'Automation detail',
  details: 'Automation details',
  editor: 'Automation editor',
  editTitle: 'Edit automation',
  edit: 'Edit',
  close: 'Close',
  dismiss: 'Close details',
  name: 'Name',
  instructions: 'Instructions',
  timezone: 'Timezone',
  timezonePlaceholder: 'Local or Europe/London',
  enableAfter: 'Enable after saving',
  save: 'Save automation',
  saving: 'Saving…',
  pause: 'Pause',
  enable: 'Enable',
  run: 'Run now',
  openSession: 'Open session',
  managed: 'Managed in Paper',
  eventLocked: 'Event rule editing is not available here.',
  event: 'Event',
  notScheduled: 'Not scheduled',
  next: 'Next',
  dash: '—',
  noRuns: 'No runs yet.',
  noRunHint: 'A finished run is shown here. The task text stays above.',
  noAutomations: 'No automations yet',
  noAutomationsHint: 'Create one or choose a template.',
  noMatches: 'No matching automations',
  noMatchesHint: 'Try a different search.',
  clear: 'Clear filters',
  loading: 'Loading…',
  retry: 'Retry',
  saved: 'Saved',
  queued: 'Run queued',
  history: 'Run history',
  rrule: 'RRULE',
  rruleHelp: 'Unsupported rules are rejected by Host.',
  repeat: 'Repeat every',
  hours: 'hours',
  days: 'days',
  weeks: 'weeks',
  months: 'months',
  hour: 'Hour',
  minute: 'Minute',
  monthDay: 'Day of month',
  monthDayHelp: 'Months without this day are skipped.',
  weekdays: 'Weekdays',
  hostNote: 'Runs use the Host\'s local workspace and configured Agent. Templates do not run until enabled.',
  previousMonth: 'Previous month',
  nextMonth: 'Next month',
  noRunThisMonth: 'Nothing scheduled this month',
  succeeded: 'Succeeded',
  failed: 'Failed',
  skipped: 'Skipped',
  scope: 'The list shows the latest kept run. Open an automation for its history.',
  localRun: 'Local workspace',
};
type Copy = {[K in keyof typeof enCopy]: string};
const zhCopy: Copy = {
  title: '自动化',
  subtitle: '把明确、重复的工作，交给本地助手。',
  create: '新建自动化',
  templates: '模板',
  templatesLabel: '场景模板',
  templateNote: '选择模板只会填入草稿。启用并保存之前不会运行。',
  list: '列表',
  calendar: '日历',
  view: '自动化视图',
  search: '搜索自动化',
  statusFilter: '按状态筛选',
  all: '全部任务',
  enabled: '已启用',
  paused: '已暂停',
  unavailable: '不可用',
  running: '运行中',
  manual: '手动',
  hourly: '每小时',
  daily: '每天',
  weekly: '每周',
  monthly: '每月',
  custom: 'RRULE（高级）',
  task: '任务',
  schedule: '调度',
  latest: '最近运行',
  actions: '操作',
  listLabel: '自动化列表',
  overview: '概览',
  runs: '运行记录',
  contentHeading: '任务内容',
  triggerHeading: '自动触发',
  kept: '保存在运行记录',
  openDetail: '详情',
  detailNav: '自动化详情',
  details: '自动化详情',
  editor: '自动化编辑器',
  editTitle: '编辑自动化',
  edit: '编辑',
  close: '关闭',
  dismiss: '关闭详情',
  name: '名称',
  instructions: '说明',
  timezone: '时区',
  timezonePlaceholder: 'Local 或 Europe/London',
  enableAfter: '保存后启用',
  save: '保存自动化',
  saving: '正在保存…',
  pause: '暂停',
  enable: '启用',
  run: '立即运行',
  openSession: '打开会话',
  managed: '在论文里管理',
  eventLocked: '事件规则不能在这里编辑。',
  event: '事件',
  notScheduled: '未排期',
  next: '下次',
  dash: '—',
  noRuns: '还没有运行。',
  noRunHint: '完成后的运行会显示在这里。任务正文仍在上方。',
  noAutomations: '还没有自动化',
  noAutomationsHint: '新建一个，或从场景模板开始。',
  noMatches: '没有匹配的自动化',
  noMatchesHint: '试试其他关键词，或清除筛选。',
  clear: '清除筛选',
  loading: '正在读取…',
  retry: '重试',
  saved: '已保存',
  queued: '已排队运行',
  history: '运行记录',
  rrule: 'RRULE',
  rruleHelp: 'Host 不接受无法执行的规则。',
  repeat: '重复间隔',
  hours: '小时',
  days: '天',
  weeks: '周',
  months: '月',
  hour: '小时',
  minute: '分钟',
  monthDay: '每月第几天',
  monthDayHelp: '没有这一天的月份会跳过。',
  weekdays: '星期',
  hostNote: '运行使用 Host 的本地工作区和已配置的助手。模板在启用前不会运行。',
  previousMonth: '上个月',
  nextMonth: '下个月',
  noRunThisMonth: '这个月没有排期',
  succeeded: '成功',
  failed: '失败',
  skipped: '已跳过',
  scope: '列表显示 Host 保留的最近一次运行。打开自动化可查看记录。',
  localRun: '本地工作区',
};
const templateCopy: Record<string, [string, string]> = {
  'Daily research brief': ['每日研究简报', '查看工作区里的研究材料，总结变化并标出来源。不修改文件。'],
  'Weekly project review': ['每周项目回顾', '回顾这个工作区的进展、未决问题和建议的下一步。不修改文件。'],
  'Check experiment results': ['检查实验结果', '查看已有的实验输出，报告缺失的证据和未通过的检查。'],
};

type StatusFilter = 'all' | 'enabled' | 'paused' | 'unavailable';
type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'error';

function useCopy() {
  const {locale} = useAppContext();
  const zh = locale === 'zh-CN';
  return {locale, zh, t: zh ? zhCopy : enCopy, when: (value?: string) => value ? new Date(value).toLocaleString(locale) : (zh ? zhCopy : enCopy).dash};
}
function templateTitle(name: string, zh: boolean) {
  return zh ? templateCopy[name]?.[0] ?? name : name;
}
function templateBlurb(name: string, prompt: string, zh: boolean) {
  return zh ? templateCopy[name]?.[1] ?? prompt : prompt;
}
function describeRule(rule: string, t: Copy) {
  const freq = /FREQ=([A-Z]+)/.exec(rule)?.[1];
  const label = freq === 'HOURLY' ? t.hourly : freq === 'DAILY' ? t.daily : freq === 'WEEKLY' ? t.weekly : freq === 'MONTHLY' ? t.monthly : '';
  if (!label) return rule;
  const hour = /BYHOUR=(\d+)/.exec(rule)?.[1];
  const minute = /BYMINUTE=(\d+)/.exec(rule)?.[1];
  if (hour == null) return minute != null && freq === 'HOURLY' ? `${label} · :${minute.padStart(2, '0')}` : label;
  return `${label} · ${hour.padStart(2, '0')}:${(minute ?? '0').padStart(2, '0')}`;
}
function scheduleTitle(item: Automation, t: Copy) {
  if (item.event) return `${t.event}: ${item.event.event}`;
  if (!item.rule) return t.manual;
  return describeRule(item.rule, t);
}
function statusOf(item: Automation, t: Copy): {label: string; tone: Tone} {
  if (!item.scheduled) return {label: t.unavailable, tone: 'neutral'};
  if (item.in_flight) return {label: t.running, tone: 'info'};
  if (item.kind === 'research_watch' && !item.rule) return {label: t.manual, tone: 'neutral'};
  if (item.enabled) return {label: t.enabled, tone: 'success'};
  return {label: t.paused, tone: 'warning'};
}
function phrase(value: string | undefined, zh: boolean) {
  if (!value) return '';
  if (!zh) return value;
  const known: Record<string, string> = {missed: '错过', schedule: '定时', manual: '手动', event: '事件'};
  return known[value] ?? value;
}
function runLabel(state: string, t: Copy) {
  if (state === 'succeeded') return t.succeeded;
  if (state === 'failed') return t.failed;
  if (state === 'skipped') return t.skipped;
  return state;
}
function runTone(state: string): Tone {
  if (state === 'succeeded') return 'success';
  if (state === 'failed') return 'error';
  if (state === 'skipped') return 'warning';
  return 'neutral';
}
function matchesStatus(item: Automation, status: StatusFilter) {
  if (status === 'enabled') return item.scheduled && item.enabled;
  if (status === 'paused') return item.scheduled && !item.enabled;
  if (status === 'unavailable') return !item.scheduled;
  return true;
}
function newestSession(runs: Run[]) {
  for (let index = runs.length - 1; index >= 0; index -= 1) if (runs[index].session_id) return runs[index];
}

function TemplateCatalog({zh, t, onPick}: {zh: boolean; t: Copy; onPick: (template: typeof templates[number]) => void}) {
  return <section aria-label={t.templates} className="templates">
    <header><h2>{t.templatesLabel} <span>{templates.length}</span></h2></header>
    <div className="template-grid">{templates.map(template => <Button type="button" key={template.name} className="template-card" aria-label={templateTitle(template.name, zh)} onClick={() => onPick(template)}>
      <Icon name="nodes" size={20}/>
      <Icon className="template-arrow" name="arrow" size={16}/>
      <strong>{templateTitle(template.name, zh)}</strong>
      <span className="template-desc">{templateBlurb(template.name, template.prompt, zh)}</span>
      <small className="template-flow"><span>{t[template.schedule]}</span><Icon name="arrow" size={12}/><span>{t.localRun}</span></small>
    </Button>)}</div>
    <p className="muted">{t.templateNote}</p>
  </section>;
}

function RunList({runs, t, when, zh}: {runs: Run[]; t: Copy; when: (value?: string) => string; zh: boolean}) {
  const latest = newestSession(runs);
  if (!runs.length) return <p className="muted">{t.noRuns}</p>;
  return <ol className="history">{[...runs].reverse().map((run, index) => <li key={run.key.request_id || `${run.key.slot}-${index}`}>
    <div><Badge tone={runTone(run.state)}>{runLabel(run.state, t)}</Badge><small>{when(run.scheduled_for)} · {phrase(run.key.trigger, zh)}</small>{(run.error || run.skip_reason) && <p>{phrase(run.error || run.skip_reason, zh)}</p>}</div>
    {run.session_id && <Button type="button" aria-label={runs.filter(item => item.session_id).length > 1 && run !== latest ? `${t.openSession} · ${when(run.scheduled_for)}` : undefined} onClick={() => openSession(run.session_id!)}>{t.openSession}</Button>}
  </li>)}</ol>;
}

function Calendar({items, locale, t, onOpen}: {items: Automation[]; locale: string; t: Copy; onOpen: (id: string) => void}) {
  const [cursor, setCursor] = useState(() => new Date());
  const year = cursor.getFullYear(), month = cursor.getMonth();
  const first = new Date(year, month, 1);
  const lead = (first.getDay() + 6) % 7;
  const days = new Date(year, month + 1, 0).getDate();
  const cells: Array<number | null> = [...Array(lead).fill(null), ...Array.from({length: days}, (_, index) => index + 1)];
  while (cells.length % 7) cells.push(null);
  const weeks: Array<Array<number | null>> = [];
  for (let index = 0; index < cells.length; index += 7) weeks.push(cells.slice(index, index + 7));
  const placed = new Set<string>();
  const byDay = new Map<number, Automation[]>();
  for (const item of items) {
    if (!item.next) continue;
    const date = new Date(item.next);
    if (date.getFullYear() !== year || date.getMonth() !== month) continue;
    placed.add(item.id);
    const bucket = byDay.get(date.getDate()) ?? [];
    bucket.push(item);
    byDay.set(date.getDate(), bucket);
  }
  const today = new Date();
  const weekday = new Intl.DateTimeFormat(locale, {weekday: 'short'});
  const headings = Array.from({length: 7}, (_, index) => weekday.format(new Date(2024, 0, index + 1)));
  const rest = items.filter(item => !placed.has(item.id));
  return <div className="calendar">
    <div className="calendar-bar">
      <IconButton label={t.previousMonth} onClick={() => setCursor(new Date(year, month - 1, 1))}><Icon family="shell" name="back" size={16}/></IconButton>
      <strong>{new Intl.DateTimeFormat(locale, {month: 'long', year: 'numeric'}).format(first)}</strong>
      <IconButton label={t.nextMonth} onClick={() => setCursor(new Date(year, month + 1, 1))}><Icon name="chevron-right" size={16}/></IconButton>
    </div>
    <div role="grid" aria-label={new Intl.DateTimeFormat(locale, {month: 'long', year: 'numeric'}).format(first)}>
      <div role="row" className="calendar-week">{headings.map(label => <div role="columnheader" key={label}>{label}</div>)}</div>
      {weeks.map(week => <div role="row" className="calendar-week" key={week.map(day => day ?? 'x').join('-')}>
        {week.map((day, index) => <div role="gridcell" key={day ?? `empty-${index}`} data-today={day != null && year === today.getFullYear() && month === today.getMonth() && day === today.getDate() || undefined}>
          {day != null && <span>{day}</span>}
          {day != null && (byDay.get(day) ?? []).map(item => <Button type="button" variant="link" key={item.id} onClick={() => onOpen(item.id)}>{item.name}</Button>)}
        </div>)}
      </div>)}
    </div>
    {!!rest.length && <section className="unscheduled" aria-label={t.noRunThisMonth}>
      <h3>{t.noRunThisMonth}</h3>
      <ul>{rest.map(item => <li key={item.id}><Button type="button" variant="link" onClick={() => onOpen(item.id)}>{item.name}</Button><small>{scheduleTitle(item, t)}</small></li>)}</ul>
    </section>}
  </div>;
}

function Editor({draft, busy, t, onPatch, onClose, onSave}: {draft: Draft; busy: boolean; t: Copy; onPatch: (value: Partial<Draft>) => void; onClose: () => void; onSave: () => void}) {
  const unit = draft.schedule === 'hourly' ? t.hours : draft.schedule === 'daily' ? t.days : draft.schedule === 'weekly' ? t.weeks : t.months;
  const schedules: Schedule[] = ['manual', 'hourly', 'daily', 'weekly', 'monthly', 'custom'];
  return <section className="editor" aria-label={t.editor} onKeyDown={event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); onSave(); } }}>
    <header className="editor-head"><p>{draft.id ? t.editTitle : t.create}</p><Button type="button" onClick={onClose}>{t.close}</Button></header>
    <div className="editor-body">
      <div>
        <h2>{t.contentHeading}</h2>
        <label>{t.name}<Input data-panel-focus="" value={draft.name} onChange={event => onPatch({name: event.target.value})} maxLength={200}/></label>
        <label>{t.instructions}<Textarea value={draft.prompt} onChange={event => onPatch({prompt: event.target.value})} rows={6} maxLength={16000}/></label>
      </div>
      <div>
        <h2>{t.schedule}</h2>
        <label>{t.schedule}<Select label={t.schedule} value={draft.schedule} onChange={value => onPatch({schedule: value as Schedule})} options={schedules.map(value => ({value, label: t[value]}))}/></label>
        {draft.schedule === 'custom' ? <label>{t.rrule}<Input value={draft.rule} onChange={event => onPatch({rule: event.target.value})}/><small>{t.rruleHelp}</small></label> : draft.schedule !== 'manual' && <>
          <label>{t.repeat} ({unit})<Input type="number" min={1} max={366} value={draft.interval} onChange={event => onPatch({interval: event.target.valueAsNumber})}/></label>
          <div className="time-fields">{draft.schedule !== 'hourly' && <label>{t.hour}<Input type="number" min={0} max={23} value={draft.hour} onChange={event => onPatch({hour: event.target.valueAsNumber})}/></label>}<label>{t.minute}<Input type="number" min={0} max={59} value={draft.minute} onChange={event => onPatch({minute: event.target.valueAsNumber})}/></label></div>
        </>}
        {draft.schedule === 'monthly' && <label>{t.monthDay}<Input type="number" min={1} max={31} value={draft.monthDay} onChange={event => onPatch({monthDay: event.target.valueAsNumber})}/><small>{t.monthDayHelp}</small></label>}
        {draft.schedule === 'weekly' && <fieldset><legend>{t.weekdays}</legend><div className="weekdays">{weekdays.map(day => <label key={day}><Checkbox checked={draft.days.includes(day)} onCheckedChange={checked => onPatch({days: checked === true ? [...draft.days, day] : draft.days.filter(value => value !== day)})}/>{day}</label>)}</div></fieldset>}
        <label>{t.timezone}<Input value={draft.timezone} placeholder={t.timezonePlaceholder} onChange={event => onPatch({timezone: event.target.value})}/></label>
        <label className="check"><Checkbox checked={draft.enabled} onCheckedChange={checked => onPatch({enabled: checked === true})}/>{t.enableAfter}</label>
      </div>
    </div>
    <footer className="editor-footer"><p>{t.hostNote}</p><Button variant="primary" disabled={busy} onClick={onSave}>{busy ? t.saving : t.save}</Button></footer>
  </section>;
}

function Detail({record, t, when, zh, onEdit, onDismiss}: {record: Automation; t: Copy; when: (value?: string) => string; zh: boolean; onEdit: () => void; onDismiss: () => void}) {
  const [tab, setTab] = useState('overview');
  const latest = record.runs.at(-1);
  const session = newestSession(record.runs);
  const outcome = latest && phrase(latest.error || latest.skip_reason, zh);
  const status = statusOf(record, t);
  return <section className="job" aria-label={t.details} tabIndex={-1} data-panel-focus="">
    <header className="job-head">
      <div>
        <h2>{record.name}</h2>
        <div className="job-meta"><Badge tone={status.tone}>{status.label}</Badge><span>{t.localRun}</span><span>{record.timezone}</span><span>{scheduleTitle(record, t)}</span></div>
      </div>
      <div className="actions">{record.kind !== 'research_watch' && <Button type="button" disabled={!!record.event} onClick={onEdit}>{t.edit}</Button>}<IconButton label={t.dismiss} onClick={onDismiss}><Icon name="close" size={16}/></IconButton></div>
    </header>
    {record.event && <p className="muted">{t.eventLocked}</p>}
    {record.error && <p className="detail-note">{record.error}</p>}
    <Tabs value={tab} onValueChange={setTab}>
      <TabsList aria-label={t.detailNav}><TabsTrigger value="overview">{t.overview}</TabsTrigger><TabsTrigger value="runs">{t.runs}</TabsTrigger></TabsList>
      <TabsContent value="overview">
        <div className="overview">
          <div>
            <header className="section-head"><h3>{t.contentHeading}</h3></header>
            <p className="instructions">{record.prompt}</p>
            <header className="section-head"><h3>{t.latest}</h3></header>
            {!latest ? <div className="empty-result"><span className="task-icon"><Icon name="document" size={18}/></span><h4>{t.noRuns}</h4><p>{t.noRunHint}</p></div> : <div className="latest">
              <div className="result-meta"><Badge tone={runTone(latest.state)}>{runLabel(latest.state, t)}</Badge><time dateTime={latest.scheduled_for}>{when(latest.scheduled_for)}</time><span>{phrase(latest.key.trigger, zh)}</span>{latest.skip_reason && <span>{phrase(latest.skip_reason, zh)}</span>}</div>
              {outcome && <p>{outcome}</p>}
              <footer><span>{t.kept}</span>{session?.session_id && <Button type="button" onClick={() => openSession(session.session_id!)}>{t.openSession}</Button>}</footer>
            </div>}
          </div>
          <aside className="context">
            <section><h3><Icon name="agent" size={15}/>{t.localRun}</h3><p>{record.timezone}</p></section>
            <section><h3><Icon name="clock" size={15}/>{t.triggerHeading}</h3><p>{scheduleTitle(record, t)}</p><p className="muted">{record.scheduled ? (record.next ? `${t.next} ${when(record.next)}` : record.timezone) : t.notScheduled}</p></section>
          </aside>
        </div>
      </TabsContent>
      <TabsContent value="runs"><h3>{t.history}</h3><RunList runs={record.runs} t={t} when={when} zh={zh}/></TabsContent>
    </Tabs>
  </section>;
}

function Automations() {
  const {zh, t, when} = useCopy();
  const [items, setItems] = useState<Automation[]>([]), [selected, select] = useState<string>();
  const [draft, setDraft] = useState<Draft>(), [gallery, setGallery] = useState(false), [query, search] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all'), [view, setView] = useState<'list' | 'calendar'>('list');
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const refresh = async () => { const result = await automationRequest<{items: Automation[]}>('GET', '/api/automations'); setItems(result.items); setLoading(false); };
  useEffect(() => {
    let stopped = false; let timer: ReturnType<typeof setTimeout>;
    const tick = async () => { try { if (!stopped) await refresh(); } catch (reason) { if (!stopped) { setError((reason as Error).message); setLoading(false); } } finally { if (!stopped) timer = setTimeout(tick, 5000); } };
    void tick(); return () => { stopped = true; clearTimeout(timer); };
  }, []);
  const perform = async (operation: () => Promise<void>) => {
    if (busy) return; setBusy(true); setError(''); setNotice('');
    try { await operation(); await refresh(); } catch (reason) { setError((reason as Error).message); } finally { setBusy(false); }
  };
  const save = () => perform(async () => {
    if (!draft) return;
    const saved = await automationRequest<Automation>(draft.id ? 'PUT' : 'POST', draft.id ? path(draft.id) : '/api/automations', draftBody(draft));
    select(saved.id); setDraft(undefined); setNotice(t.saved);
  });
  const patch = (value: Partial<Draft>) => setDraft(previous => previous ? {...previous, ...value} : previous);
  const pickTemplate = (template: typeof templates[number]) => {
    setDraft({...newDraft(), ...template, name: templateTitle(template.name, zh), prompt: templateBlurb(template.name, template.prompt, zh)});
    setGallery(false);
    revealPanel();
  };
  const queried = items.filter(item => `${item.name} ${item.prompt}`.toLowerCase().includes(query.trim().toLowerCase()));
  const visible = queried.filter(item => matchesStatus(item, status));
  const counts: Record<StatusFilter, number> = {
    all: queried.length,
    enabled: queried.filter(item => matchesStatus(item, 'enabled')).length,
    paused: queried.filter(item => matchesStatus(item, 'paused')).length,
    unavailable: queried.filter(item => matchesStatus(item, 'unavailable')).length,
  };
  const record = items.find(item => item.id === selected);
  const showCatalog = gallery && (items.length > 0 || view === 'calendar');
  const stage = useRef<HTMLDivElement>(null);
  const [reveal, setReveal] = useState(0);
  const revealPanel = () => setReveal(value => value + 1);
  useEffect(() => {
    if (!reveal) return;
    const node = stage.current;
    if (!node) return;
    node.scrollIntoView({block: 'nearest'});
    const field = node.querySelector<HTMLElement>('[data-panel-focus]');
    (field ?? node).focus();
  }, [reveal]);
  const welcome = !items.length && !loading;
  return <main className="automation-app">
    <div className="automation-page">
      <header className="page-heading">
        <div className="page-title"><h1>{t.title}</h1>{welcome && <p>{t.subtitle}</p>}</div>
        <div className="page-tools">
          <ToggleGroup type="single" value={view} aria-label={t.view} onValueChange={value => { if (value === 'list' || value === 'calendar') setView(value); }}>
            <ToggleGroupItem value="list"><Icon name="list" size={16}/>{t.list}</ToggleGroupItem>
            <ToggleGroupItem value="calendar"><Icon name="calendar" size={16}/>{t.calendar}</ToggleGroupItem>
          </ToggleGroup>
          <Button type="button" onClick={() => setGallery(value => !value)}>{t.templates}</Button>
          <Button variant="primary" onClick={() => { setDraft(newDraft()); setGallery(false); revealPanel(); }}><Icon name="plus" size={16}/>{t.create}</Button>
        </div>
      </header>
      {error && <Feedback kind="error" variant="block" className="feedback">{error}<Button type="button" disabled={busy} onClick={() => void perform(refresh)}>{t.retry}</Button></Feedback>}
      {notice && <Feedback>{notice}</Feedback>}
      {showCatalog && <TemplateCatalog zh={zh} t={t} onPick={pickTemplate}/>}
      <section className="catalog" aria-label={t.listLabel}>
        <div className="toolbar"><div className="search"><Icon name="search" size={16}/><Input aria-label={t.search} type="search" placeholder={t.search} value={query} onChange={event => search(event.target.value)}/></div></div>
        <ToggleGroup className="filter-strip" type="single" value={status} aria-label={t.statusFilter} onValueChange={value => { if (value === 'all' || value === 'enabled' || value === 'paused' || value === 'unavailable') setStatus(value); }}>
          {(['all', 'enabled', 'paused', 'unavailable'] as const).map(value => <ToggleGroupItem className="filter-chip" key={value} value={value}>{t[value]}<span>{counts[value]}</span></ToggleGroupItem>)}
        </ToggleGroup>
        {loading ? <Feedback>{t.loading}</Feedback> : view === 'calendar' ? <Calendar items={visible} locale={zh ? 'zh-CN' : 'en'} t={t} onOpen={id => { select(id); setDraft(undefined); revealPanel(); }}/> : <div className="task-list">
          {visible.length ? <div role="table" aria-label={t.listLabel}>
            <div role="row" className="task-head"><span>{t.task}</span><span>{t.schedule}</span><span>{t.latest}</span><span>{t.actions}</span></div>
            {visible.map(item => {
              const latest = item.runs[item.runs.length - 1];
              const state = statusOf(item, t);
              return <div role="row" className="task-row" key={item.id} data-current={item.id === selected || undefined}>
                <div className="identity">
                  <span className="task-icon" aria-hidden="true">{item.event ? <Icon family="shell" name="webhook" size={18}/> : <Icon name="nodes" size={18}/>}</span>
                  <div>
                    <div className="title-line">
                      <Button variant="ghost" className="automation-name" aria-current={item.id === selected ? 'true' : undefined} onClick={() => { select(item.id); setDraft(undefined); revealPanel(); }}>{item.name}</Button>
                      <Badge tone={state.tone}>{state.label}</Badge>
                    </div>
                    <p className="description">{item.prompt}</p>
                    <small>{item.event ? `${t.event}: ${item.event.event}` : t.localRun}</small>
                    {item.error && <small role="alert">{item.error}</small>}
                  </div>
                </div>
                <div className="schedule"><span><Icon name="clock" size={14}/>{scheduleTitle(item, t)}</span><small>{item.scheduled ? (item.next ? `${t.next} ${when(item.next)}` : item.timezone) : t.notScheduled}</small></div>
                <div className="result">{latest ? <><Badge tone={runTone(latest.state)}>{runLabel(latest.state, t)}</Badge><small>{phrase(latest.error || latest.skip_reason, zh) || when(latest.scheduled_for)}</small></> : <small>{t.noRuns}</small>}</div>
                <div className="row-actions">{item.kind === 'research_watch' ? <span className="muted">{t.managed}</span> : <>
                  <IconButton variant="secondary" label={t.run} disabled={busy || !!item.in_flight || !item.enabled || !item.scheduled} onClick={() => void perform(async () => { const receipt = await automationRequest<{request_id: string}>('POST', `${path(item.id)}/run`); select(item.id); revealPanel(); setNotice(`${t.queued} · ${receipt.request_id}`); })}><Icon name="play" size={16}/></IconButton>
                  <IconButton variant="secondary" label={item.enabled ? t.pause : t.enable} disabled={busy} onClick={() => void perform(async () => { await automationRequest('PUT', path(item.id), {enabled: !item.enabled}); })}><Icon name={item.enabled ? 'pause' : 'play'} size={16}/></IconButton>
                  <IconButton variant="secondary" label={t.openDetail} onClick={() => { select(item.id); setDraft(undefined); revealPanel(); }}><Icon name="panel-right" size={16}/></IconButton>
                </>}</div>
              </div>;
            })}
          </div> : welcome ? <div className="empty-templates"><EmptyState icon={<EmptyIllustration kind="data"/>} heading={t.noAutomations} description={t.noAutomationsHint}/><TemplateCatalog zh={zh} t={t} onPick={pickTemplate}/></div> : <EmptyState icon={<EmptyIllustration kind="search" size="compact"/>} heading={t.noMatches} description={t.noMatchesHint} actions={<Button type="button" onClick={() => { search(''); setStatus('all'); }}>{t.clear}</Button>}/>}
          {!!visible.length && <p className="scope">{t.scope}</p>}
        </div>}
      </section>
      {(draft || record) && <div ref={stage}>{draft ? <Editor draft={draft} busy={busy} t={t} onPatch={patch} onClose={() => setDraft(undefined)} onSave={() => void save()}/> : <Detail key={record!.id} record={record!} t={t} when={when} zh={zh} onEdit={() => { setDraft(editDraft(record!)); revealPanel(); }} onDismiss={() => select(undefined)}/>}</div>}
    </div>
  </main>;
}

createRoot(document.getElementById('app')!).render(<AppProvider><Automations/></AppProvider>);
