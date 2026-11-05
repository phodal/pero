import React, { useState } from 'react';
import { BookOpen, FileText, MoreHorizontal, Plus } from 'lucide-react';
import { WindowTitlebar } from '../src';
import { AppBar } from '../../app-sdk/src/components/layout';
import { Dialog } from '../../app-sdk/src/components/dialog';
import { Feedback } from '../../app-sdk/src/components/feedback';
import { Button } from '../../app-sdk/src/components/button';
import { IconButton } from '../../app-sdk/src/components/icon-button';
import { FilePicker } from '../../app-sdk/src/components/input';
import { Select } from '../../app-sdk/src/components/select';
import { ContentTab } from '../../app-sdk/src/components/tabs';
import { Tabs, TabsList, TabsContent } from '../../app-sdk/src/components/tabs';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from '../../app-sdk/src/components/dropdown-menu';

const initialTabs = [
  { id: 'viewer', label: 'Scientific Viewer', pinned: true, dirty: false, preview: false },
  { id: 'notes', label: '研究记录.md', pinned: false, dirty: true, preview: false },
  { id: 'preview', label: 'experiment-comparison-with-long-title.csv', pinned: false, dirty: false, preview: true },
];
export function WorkbenchExample() {
  const [tabs, setTabs] = useState(initialTabs), [active, setActive] = useState('viewer');
  const [file, setFile] = useState('expression.csv'), [notice, setNotice] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const close = (id: string, discard = false) => {
    if (tabs.find(tab => tab.id === id)?.dirty && !discard) { setPending(id); return; }
    const index = tabs.findIndex(tab => tab.id === id);
    const rest = tabs.filter(tab => tab.id !== id);
    const next = active === id ? (rest[Math.min(index, rest.length - 1)]?.id ?? '') : active;
    setTabs(rest); setActive(next); setPending(null);
    requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('.catalog-workbench [role=tab][data-state=active]')?.focus());
  };
  return <>
    <Tabs value={active} onValueChange={setActive} className="catalog-workbench">
      <WindowTitlebar leading={<BookOpen size={16} aria-hidden="true"/>} tabs={<TabsList variant="content" aria-label="打开的内容">{tabs.map(tab => <ContentTab key={tab.id} value={tab.id} label={tab.label} pinned={tab.pinned} dirty={tab.dirty} preview={tab.preview} leading={<FileText size={14}/>} stateLabel={[tab.pinned && '固定', tab.dirty && '未保存', tab.preview && '预览'].filter(Boolean).join('，')} closeLabel="关闭" onClose={() => close(tab.id)}/>)}</TabsList>} actions={<IconButton label="恢复示例标签" onClick={() => { setTabs(initialTabs); setActive('viewer'); setNotice('示例标签已恢复'); }}><Plus size={16}/></IconButton>}/>
      {tabs.map(tab => <TabsContent key={tab.id} value={tab.id} className="catalog-tab-panel">
        <AppBar tools={<Select label="当前文件" value={file} onChange={value => { setFile(value); setNotice('已选择 ' + value); }} options={[{value:'expression.csv',label:'expression.csv'},{value:'observations-with-long-file-name.csv',label:'observations-with-long-file-name.csv'},{value:'unavailable.csv',label:'暂不可用的文件',disabled:true}]} className="catalog-file-select"/>} actions={<>
          <FilePicker label="导入文件" emptyLabel="尚未选择文件" compact accept=".csv,.tsv,.txt,.md" onFile={file => setNotice('已选择 ' + file.name + '（演示不会上传文件）')}/>
          <DropdownMenu><DropdownMenuTrigger asChild><IconButton label="更多操作"><MoreHorizontal size={16}/></IconButton></DropdownMenuTrigger><DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => { setTabs(current => current.map(item => item.id === tab.id ? {...item,pinned:!item.pinned} : item)); setNotice(tab.pinned ? '已取消固定' : '已固定标签'); }}>{tab.pinned ? '取消固定' : '固定标签'}</DropdownMenuItem>
            <DropdownMenuItem disabled>导出结果（暂无结果）</DropdownMenuItem><DropdownMenuSeparator/>
            <DropdownMenuItem onSelect={() => close(tab.id)}>关闭当前标签</DropdownMenuItem>
          </DropdownMenuContent></DropdownMenu>
        </>}/>
        <div className="catalog-preview-body"><p>{tab.id === 'viewer' ? '文件预览区域' : tab.id === 'notes' ? '研究记录正文区域' : '表格预览区域'}</p><p className="catalog-caption catalog-muted">这里演示内容布局；没有运行分析或生成科学结果。</p></div>
      </TabsContent>)}
      {!tabs.length && <div className="catalog-preview-body"><p>没有打开的内容。</p><Button onClick={() => { setTabs(initialTabs); setActive('viewer'); }}>打开示例</Button></div>}
    </Tabs>
    {pending && <Dialog title="关闭未保存的研究记录？" size="sm" closeLabel="继续编辑" initialFocus="#keep-editing" onClose={() => setPending(null)} footer={<><Button id="keep-editing" onClick={() => setPending(null)}>继续编辑</Button><Button variant="danger" onClick={() => close(pending, true)}>放弃更改并关闭</Button></>}><p>研究记录有未保存的更改。</p></Dialog>}
    {notice && <Feedback>{notice}</Feedback>}
    <p className="catalog-muted">方向键切换标签，Delete 关闭；未保存的标签先确认。菜单支持键盘选择与 Escape 返回，长标题截断后可悬停查看全文。</p>
  </>;
}
