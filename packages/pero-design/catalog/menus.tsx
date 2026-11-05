import React, { useState } from 'react';
import { Button } from '../../app-sdk/src/components/button';
import { Select } from '../../app-sdk/src/components/select';
import { Field } from '../../app-sdk/src/components/field';
import { Input } from '../../app-sdk/src/components/input';
import { Feedback } from '../../app-sdk/src/components/feedback';
import { Popover } from '../../app-sdk/src/components/popover';
import { InfoTip } from '../../app-sdk/src/components/help-tip';
import { Tooltip } from '../../app-sdk/src/components/tooltip';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuLabel, DropdownMenuItem, DropdownMenuCheckboxItem, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent } from '../../app-sdk/src/components/dropdown-menu';
import { ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem, ContextMenuSeparator } from '../../app-sdk/src/components/context-menu';

export function MenusExample() {
  const [model, setModel] = useState('scgpt'), [density, setDensity] = useState('comfortable');
  const [details, setDetails] = useState(true), [name, setName] = useState('研究计划'), [message, setMessage] = useState('');
  return <>
    <section><h2>选择与搜索</h2>
      <p className="catalog-muted">短选项使用紧凑浮层；长列表支持搜索、分组和禁用说明。方向键导航，Enter 确认，Escape 返回。</p>
      <div className="catalog-row">
        <Select label="展示密度" value={density} onChange={setDensity} options={[{value:'comfortable',label:'舒适'},{value:'compact',label:'紧凑'}]}/>
        <Select label="研究模型" value={model} onChange={setModel} searchable showHint emptyLabel="没有匹配的模型" searchLabel="搜索研究模型" options={[
          {value:'scgpt',label:'scGPT',group:'已就绪',hint:'单细胞基础模型'},
          {value:'gears',label:'GEARS',group:'已就绪',hint:'基因扰动预测'},
          {value:'remote',label:'远程推理环境',group:'不可用',hint:'需要先连接执行环境',disabled:true},
        ]}/>
        <Select label="正在加载" value="" onChange={() => {}} options={[]} disabled placeholder="正在读取模型…"/>
      </div>
    </section>
    <section><h2>操作菜单</h2><div className="catalog-row">
      <DropdownMenu><DropdownMenuTrigger>视图与操作</DropdownMenuTrigger><DropdownMenuContent>
        <DropdownMenuLabel>展示</DropdownMenuLabel>
        <DropdownMenuCheckboxItem checked={details} onCheckedChange={value => setDetails(value === true)}>显示详情</DropdownMenuCheckboxItem>
        <DropdownMenuRadioGroup value={density} onValueChange={setDensity}><DropdownMenuRadioItem value="comfortable">舒适</DropdownMenuRadioItem><DropdownMenuRadioItem value="compact">紧凑</DropdownMenuRadioItem></DropdownMenuRadioGroup>
        <DropdownMenuSeparator/>
        <DropdownMenuSub><DropdownMenuSubTrigger>导出演示</DropdownMenuSubTrigger><DropdownMenuSubContent><DropdownMenuItem onSelect={() => setMessage('已选择 Markdown 导出示例')}>Markdown</DropdownMenuItem><DropdownMenuItem onSelect={() => setMessage('已选择 JSON 导出示例')}>JSON</DropdownMenuItem></DropdownMenuSubContent></DropdownMenuSub>
        <DropdownMenuItem disabled>分享到团队（尚未连接）</DropdownMenuItem>
        <DropdownMenuSeparator/><DropdownMenuItem danger onSelect={() => { setName(''); setMessage('已清空当前演示名称'); }}>清空演示名称</DropdownMenuItem>
      </DropdownMenuContent></DropdownMenu>
      <ContextMenu><ContextMenuTrigger className="catalog-context-target" tabIndex={0}>右键此处查看操作</ContextMenuTrigger><ContextMenuContent>
        <ContextMenuItem onSelect={() => setMessage('已复制演示记录')}>复制记录</ContextMenuItem><ContextMenuSeparator/><ContextMenuItem disabled>打开源文件（未导入）</ContextMenuItem>
      </ContextMenuContent></ContextMenu>
    </div>{details && <p className="catalog-muted">当前密度：{density === 'comfortable' ? '舒适' : '紧凑'}；菜单的勾选态与当前选择保持同步。</p>}</section>
    <section><h2>浮层与提示</h2><div className="catalog-row">
      <Popover label="编辑演示名称" trigger="重命名">{close => <div className="catalog-form"><Field label="名称">{control => <Input {...control} value={name} onChange={event => setName(event.target.value)}/>}</Field><Button variant="primary" disabled={!name.trim()} onClick={() => { setMessage('已保存演示名称：' + name); close(); }}>保存</Button></div>}</Popover>
      <Tooltip label="仅演示共享组件，不调用 Agent"><Button onClick={() => setMessage('演示操作已执行')}>悬停或聚焦提示</Button></Tooltip>
      <InfoTip label="了解浮层行为" text="点击可固定说明；Escape 或点击外部关闭。浮层跟随主题与字号。"/>
    </div></section>
    {message && <Feedback>{message}</Feedback>}
  </>;
}
