import React, { useState } from 'react';
import { Badge } from '../src';
import { Button } from '../../app-sdk/src/components/button';
import { Card, CardHeader } from '../../app-sdk/src/components/card';
import { Checkbox } from '../../app-sdk/src/components/checkbox';
import { Dialog } from '../../app-sdk/src/components/dialog';
import { Disclosure } from '../../app-sdk/src/components/disclosure';
import { EmptyState } from '../../app-sdk/src/components/empty-state';
import { Feedback } from '../../app-sdk/src/components/feedback';
import { Field } from '../../app-sdk/src/components/field';
import { Input } from '../../app-sdk/src/components/input';
import { Progress } from '../../app-sdk/src/components/progress';
import { RadioGroup, RadioGroupItem } from '../../app-sdk/src/components/radio-group';
import { Select } from '../../app-sdk/src/components/select';
import { Slider } from '../../app-sdk/src/components/slider';
import { Switch } from '../../app-sdk/src/components/switch';
import { Table } from '../../app-sdk/src/components/table';
import { Tooltip } from '../../app-sdk/src/components/tooltip';

const rows = [
  { id: 'baseline', name: '基线', observations: 12, label: '未核验', tone: 'warning' as const },
  { id: 'candidate', name: '候选 A', observations: 8, label: '存在缺失值', tone: 'error' as const },
];
export function FormsExample() {
  const [name, setName] = useState(''), [submitted, setSubmitted] = useState(false);
  const [quantity, setQuantity] = useState(4), [enabled, setEnabled] = useState(true), [checked, setChecked] = useState(false);
  const [open, setOpen] = useState(false), [source, setSource] = useState('local'), [choice, setChoice] = useState('baseline');
  const [message, setMessage] = useState(''), [readError, setReadError] = useState(true);
  const error = submitted && !name.trim() ? '请输入名称；已填参数会保留。' : undefined;
  return <>
    <div className="catalog-tones">
      <Card tone="blue" variant="soft"><CardHeader><strong>资料与上下文</strong><Badge tone="blue">论文</Badge></CardHeader><p>柔和底色区分内容，正文保持足够对比。</p></Card>
      <Card tone="apricot" variant="soft"><CardHeader><strong>模型与设置</strong><Badge tone="apricot">实验</Badge></CardHeader><p>暖色表达内容身份；核验状态另用明确标签。</p></Card>
    </div>
    <section aria-label="共享表单">
      <form className="catalog-form" onSubmit={event => { event.preventDefault(); setSubmitted(true); if (name.trim()) setMessage(`已保存演示设置：${name}`); else event.currentTarget.querySelector<HTMLInputElement>('input')?.focus(); }}>
        <Field label="实验名称" description="仅保存到当前演示，不启动实验。" error={error}>{control => <Input {...control} value={name} onChange={event => setName(event.target.value)}/>}</Field>
        <Field label={`候选预算：${quantity}`} description="方向键微调，Home / End 到达边界。">{control => <Slider {...control} min={1} max={8} step={1} value={quantity} onChange={event => setQuantity(event.target.valueAsNumber)}/>}</Field>
        <Field label="计算位置">{control => <Select {...control} label="计算位置" value="local" onChange={() => {}} options={[{value:"local",label:"本机"},{value:"remote",label:"远程环境（未配置）",disabled:true}]}/>}</Field>
        <div className="catalog-row"><label className="catalog-choice"><Checkbox checked={checked} onCheckedChange={value => setChecked(value === true)}/>显示基线</label><label className="catalog-choice"><Switch checked={enabled} onCheckedChange={setEnabled}/>显示说明</label><label className="catalog-choice"><Checkbox disabled/>暂不可用</label></div>
        <div className="catalog-row"><Button type="submit" variant="primary">保存设置</Button><Tooltip label="弹窗中的选择框支持键盘操作；Escape 先关闭选择框，再关闭弹窗。"><Button onClick={() => setOpen(true)}>设置来源</Button></Tooltip></div>
      </form>
    </section>
    {message && <Feedback kind="success" variant="block">{message}</Feedback>}
    <section><h2>状态与恢复</h2><Feedback kind="warning" variant="block">这是一组演示数据，未进行科学核验。</Feedback><>{readError ? <Feedback kind="error" variant="block">读取失败，输入已保留。<Button onClick={() => { setReadError(false); setMessage('演示恢复完成，表单输入未重置。'); }}>重试</Button></Feedback> : <Button onClick={() => { setReadError(true); setMessage(''); }}>模拟读取失败</Button>}</><Progress label="演示进度" value={quantity} max={8}/></section>
    <section><h2>结果选择</h2><RadioGroup aria-label="选择结果" value={choice} onValueChange={setChoice}><Table label="演示结果" density="compact" rows={rows} rowId={row => row.id} columns={[
      { id: 'name', header: '结果', size: 180, cell: row => <label className="catalog-choice"><RadioGroupItem value={row.id}/>{row.name}</label> },
      { id: 'samples', header: '观测数', size: 90, meta: { align: 'end' }, cell: row => row.observations },
      { id: 'status', header: '核验状态', size: 160, cell: row => <Badge tone={row.tone}>{row.label}</Badge> },
    ]}/></RadioGroup></section>
    <Disclosure summary="无结果时"><EmptyState heading="还没有结果" description="先填写设置，再明确启动任务。" actions={<Button onClick={() => { setSubmitted(true); document.querySelector<HTMLInputElement>('.catalog-form input')?.focus(); }}>填写设置</Button>}/></Disclosure>
    {open && <Dialog title="设置数据来源与复核方式" closeLabel="关闭来源设置" onClose={() => setOpen(false)} footer={<Button variant="primary" onClick={() => { setOpen(false); setMessage('来源设置已应用'); }}>应用</Button>}>
      <Field label="数据来源" description="选择框浮层应在弹窗内正常显示。">{control => <Select {...control} label="数据来源" value={source} onChange={setSource} options={[{value:'local',label:'本地观测文件'},{value:'example',label:'示例数据（未核验）'},{value:'remote',label:'远程数据（不可用）',disabled:true}]}/>}</Field>
      <Feedback kind="info" variant="block">来源和验证结论分别展示。关闭设置不会清空表单。</Feedback>
    </Dialog>}
  </>;
}
