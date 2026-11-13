import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BookOpen, Folder, MessageSquare, PanelLeftClose, PanelLeftOpen, Plus, Search, Settings2, SunMoon } from 'lucide-react';
import { Sidebar, SidebarGroup, SidebarRow, WindowTitlebar, LibraryHeader, ListRow, SearchField, SettingsGroup, SettingsRow, Composer, typePx } from '../src';
import { Button } from '../../app-sdk/src/components/button';
import { Input, FilePicker } from '../../app-sdk/src/components/input';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../../app-sdk/src/components/tabs';
import { Split, SplitPane } from '../../app-sdk/src/components/split';
import '../../app-sdk/src/tokens/tokens.css';
import '../../app-sdk/src/ui.css';
import './style.css';
import { FormsExample } from './forms';
import { MenusExample } from './menus';
import { Feedback } from '../../app-sdk/src/components/feedback';
import { EmptyState } from '../../app-sdk/src/components/empty-state';
import { EmptyIllustration } from '../../app-sdk/src/components/empty-illustration';
import { LoadingSkeleton, SkeletonText } from '../../app-sdk/src/components/skeleton';
import { WorkbenchExample } from './workbench';
import { ContentPanesExample } from './content-panes';
import { Select } from '../../app-sdk/src/components/select';
import { IconButton } from '../../app-sdk/src/components/icon-button';

const screens = ['窗口与导航', '标签与控件', '标题与列表', '输入与状态', '表单与反馈', '菜单与浮层', '内容区'] as const;
function Catalog() {
  const [screen, setScreen] = useState<string>(screens[0]);
  const [dark, setDark] = useState(false), [collapsed, setCollapsed] = useState(false);
  const [scale, setScale] = useState(14), [selected, setSelected] = useState('scGPT');
  const [query, setQuery] = useState(''), [draft, setDraft] = useState('');
  const [status, setStatus] = useState('idle'), [message, setMessage] = useState('');
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    document.documentElement.style.setProperty('--pero-font-scale', String(scale / 14));
  }, [dark, scale]);
  const newTask = () => { setScreen('输入与状态'); setStatus('idle'); setDraft(''); setMessage('新任务草稿已创建'); };
  const nav = <Sidebar label="组件导航" collapsed={collapsed}>
    <SidebarGroup label="组件示例">{screens.map((name, i) => <SidebarRow key={name} label={name} count={i === 0 ? 3 : undefined} selected={screen === name} lead={i === 0 ? <Folder size={16}/> : i === 1 ? <BookOpen size={16}/> : <MessageSquare size={16}/>} onClick={() => setScreen(name)}/>)}</SidebarGroup>
    <div className="catalog-nav-bottom"><SidebarGroup separated><SidebarRow label="设置" lead={<Settings2 size={16}/>} onClick={() => { setScreen('输入与状态'); setMessage('在设置示例中调整输入和状态'); }}/></SidebarGroup></div>
  </Sidebar>;
  return <div className="catalog">
    <div className="catalog-controls"><h1>Pero 组件库</h1><div className="catalog-row"><label className="catalog-scale">字号 <Select label="界面字号" value={String(scale)} onChange={value => setScale(Number(value))} options={[12,14,18,24].map(n => ({value:String(n),label:`${n}px`}))} menuMinWidth={0}/></label><Button variant="ghost" onClick={() => setDark(!dark)} aria-label="切换明暗主题"><SunMoon size={16}/>{dark ? '浅色' : '深色'}</Button></div></div>
    <div className="catalog-window">
      <WindowTitlebar leading={<div className="catalog-row"><IconButton label={collapsed ? '展开侧栏' : '收起侧栏'} onClick={() => setCollapsed(!collapsed)}>{collapsed ? <PanelLeftOpen size={16}/> : <PanelLeftClose size={16}/>}</IconButton><IconButton label="新任务" onClick={newTask}><Plus size={16}/></IconButton></div>} actions={<IconButton label="搜索资料" onClick={() => { setScreen('标题与列表'); requestAnimationFrame(() => document.getElementById('catalog-search')?.focus()); }}><Search size={16}/></IconButton>}/>
      <Split key={String(collapsed)} storageKey={collapsed ? undefined : 'pero-design-catalog/sidebar'} collapseBelow={560} className="catalog-split">
        <SplitPane id="navigation" size={collapsed ? 56 : 208} min={collapsed ? 56 : 160} resizeLabel="调整侧栏宽度">{nav}</SplitPane>
        <SplitPane id="content" min={280}>
          <LibraryHeader title={screen} actions={<Button onClick={() => setMessage('组件入口：@pero/app-sdk/ui；布局与状态由调用页面控制。')}>查看用法</Button>}/>
          <main className="catalog-content">
            {screen === '窗口与导航' && <>
              <p className="catalog-muted">窗口栏只放窗口操作、内容标签和全局动作。页面标题由内容区负责。</p>
              <section><h2>导航状态</h2><div className="catalog-example-nav"><SidebarRow label="研究项目" lead={<Folder size={16}/>} selected={selected === '研究项目'} onClick={() => setSelected('研究项目')}/><SidebarRow label="需要处理" count="2" lead={<MessageSquare size={16}/>} selected={selected === '需要处理'} onClick={() => setSelected('需要处理')}/><SidebarRow label="不可用的操作" disabled lead={<BookOpen size={16}/>}/></div><div className="catalog-example-nav"><SidebarGroup><SidebarRow label="应用商店" onClick={() => setMessage('应用商店导航示例')}/><SidebarRow label="执行环境" onClick={() => setMessage('执行环境导航示例')}/></SidebarGroup><SidebarGroup separated><SidebarRow label="论文" onClick={() => setMessage('论文导航示例')}/><SidebarRow label="Insights" onClick={() => setMessage('Insights 导航示例')}/></SidebarGroup><SidebarGroup separated><SidebarRow label="最近会话" onClick={() => setMessage('最近会话导航示例')}/></SidebarGroup></div></section>
              <section><h2>字阶</h2><div className="catalog-type"><span style={{fontSize:'var(--pero-font-title)'}}>标题 {typePx.title}</span><span style={{fontSize:'var(--pero-font-heading)'}}>章节 {typePx.heading}</span><span>正文 {typePx.body}</span><span className="catalog-muted catalog-caption">辅助信息 {typePx.caption}</span></div></section>
              <section><h2>使用约束</h2><ul><li>分组优先用间距，标签只在必要时出现。</li><li>选中态使用浅青底，计数不用额外徽章。</li><li>侧栏可收起；分隔条支持拖动、方向键和双击复位。</li></ul></section>
            </>}
            {screen === '表单与反馈' && <FormsExample/>}
            {screen === '菜单与浮层' && <MenusExample/>}
            {screen === '内容区' && <ContentPanesExample/>}
            {screen === '标签与控件' && <WorkbenchExample/>}
            {screen === '标题与列表' && <>
              <SearchField id="catalog-search" aria-label="搜索论文" placeholder="搜索论文…" value={query} onChange={e => setQuery(e.target.value)}/>
              <Tabs defaultValue="catalog"><TabsList variant="navigation" aria-label="服务视图"><TabsTrigger value="catalog">服务目录</TabsTrigger><TabsTrigger value="installed">已安装连接 1</TabsTrigger></TabsList><TabsContent value="catalog"><p>搜索服务与能力</p></TabsContent><TabsContent value="installed"><p>管理已有连接</p></TabsContent></Tabs>
              <Tabs defaultValue="papers"><TabsList aria-label="资料类别"><TabsTrigger value="papers">论文</TabsTrigger><TabsTrigger value="notes">研究记录</TabsTrigger></TabsList><TabsContent value="papers">
                {['scGPT','GEARS'].filter(t => t.toLowerCase().includes(query.toLowerCase())).map(title => <ListRow key={title} title={title} meta="Paper" current={selected === title} onOpen={() => { setSelected(title); setMessage('已选择 ' + title); }} trailing={<Button variant="ghost" onClick={() => setMessage(title + ' 已加入当前任务上下文')}>加入上下文</Button>}/>)}
                {!['scGPT','GEARS'].some(t => t.toLowerCase().includes(query.toLowerCase())) && <EmptyState icon={<EmptyIllustration kind="search" size="compact"/>} heading="没有匹配论文" actions={<Button onClick={() => setQuery('')}>清除搜索</Button>}/>}
              </TabsContent><TabsContent value="notes"><ListRow title="评估口径对照" meta="引用待核对" onOpen={() => setMessage('研究记录已打开；保留未核验状态')}/></TabsContent></Tabs>
              <p className="catalog-muted">标题先于元信息。只有当前任务需要的状态才常驻显示。</p>
            </>}
            {screen === '输入与状态' && <>
              <SettingsGroup label="任务设置"><SettingsRow><label htmlFor="catalog-name">任务名称</label><Input id="catalog-name" placeholder="输入任务名称"/></SettingsRow><SettingsRow><label htmlFor="catalog-mode">呈现状态</label><Select id="catalog-mode" label="呈现状态" value={status} onChange={setStatus} options={[['idle','空闲'],['loading','加载中'],['running','运行中'],['success','完成'],['error','错误'],['disabled','不可用']].map(([value,label]) => ({value,label}))}/></SettingsRow></SettingsGroup>
              <FilePicker multiple label="导入附件" emptyLabel="尚未选择附件" disabled={status === 'disabled'} busy={['loading','running'].includes(status)} onFiles={files => setMessage('已选择 ' + files.map(file => file.name).join('，'))}/>
              {status === 'idle' && <EmptyState icon={<EmptyIllustration kind="documents"/>} heading="添加任务资料" description="导入附件后开始分析。"/>}
              {status === 'loading' && <LoadingSkeleton label="正在读取任务上下文…"><SkeletonText/></LoadingSkeleton>}
              {status === 'running' && <div className="catalog-row" role="status"><span>正在分析示例资料…</span><Button onClick={() => { setStatus('idle'); setMessage('已停止演示任务'); }}>停止</Button></div>}
              {status === 'success' && <p role="status">示例任务已完成。</p>}
              {status === 'error' && <Feedback kind="error" variant="block">无法读取资料，草稿已保留。<Button onClick={() => { setStatus('idle'); setMessage('已恢复，可以再次提交'); }}>重试</Button></Feedback>}
              <Composer id="catalog-composer" label="任务描述" value={draft} onChange={setDraft} placeholder="描述要完成的任务…" disabled={['loading','running','disabled'].includes(status)} toolbar={<span className="catalog-caption catalog-muted">本地演示</span>} submit={<Button variant="primary" disabled={!draft.trim() || ['loading','running','disabled'].includes(status)} onClick={() => { setStatus('success'); setMessage('已提交演示任务：' + draft); }}>发送</Button>}/>
            </>}
            {message && <Feedback>{message}</Feedback>}
          </main>
        </SplitPane>
      </Split>
    </div>
    <p className="catalog-footnote">共享组件实装预览。示例操作不调用 Agent。</p>
  </div>;
}
createRoot(document.getElementById('app')!).render(<Catalog/>);
