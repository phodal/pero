import React, {useEffect, useRef, useState} from 'react';
import {downloadFile, openDocument, useAppApi, useAppContext, useAppObject} from '@pero/app-sdk';
import {Button, FilePicker, Select} from '@pero/app-sdk/ui';
import {mountChartSurface} from '../../../packages/app-sdk/src/chart-surface';
import type {Result} from './model';

type ChartDocument = {id:string; title:string; description?:string; chart:{type:string;y?:string;xLabel?:string;yLabel?:string}; rows:Record<string, unknown>[];
  source:{label:string;caveats?:string[];dataset?:string;revision?:number;viewId?:string;view?:unknown;aggregation?:unknown;sql?:string;executedAt?:string;records?:{ordinal:number;pointer:string;line:number|null}[];exactValues?:string[];omittedGroups?:number;excludedValues?:number}};
type ChartResult = {document:ChartDocument;artifactId:string;content:string};
type Kind = 'line'|'bar'|'area'|'pie'|'radar'|'candlestick'|'sankey';
const kinds:Kind[] = ['line','bar','area','pie','radar','candlestick','sankey'];

function ChartSurface({document}:{document:ChartDocument}) {
  const container=useRef<HTMLDivElement>(null), surface=useRef<ReturnType<typeof mountChartSurface>>(null);
  const context=useAppContext();
  useEffect(()=>{const current=mountChartSurface(container.current!,{document,context,url:'./_reader/reader.html'});surface.current=current;
    return ()=>{current.dispose();surface.current=null;};},[]);
  useEffect(()=>{surface.current?.document(document);},[document]);
  useEffect(()=>{surface.current?.context(context);},[context]);
  return <div ref={container} className="data-chart-surface"/>;
}

export function ChartPanel({data,busy}:{data:Result|null;busy:boolean}) {
  const api=useAppApi(), {locale}=useAppContext(), zh=locale==='zh-CN';
  const [kind,setKind]=useState<Kind>('bar'),[mode,setMode]=useState<'aggregate'|'records'>('aggregate');
  const [x,setX]=useState(''),[y,setY]=useState(''),[target,setTarget]=useState(''),[series,setSeries]=useState('');
  const [open,setOpen]=useState(''),[high,setHigh]=useState(''),[low,setLow]=useState(''),[close,setClose]=useState('');
  const [result,setResult]=useState<ChartResult|null>(null),[pending,setPending]=useState(false),[error,setError]=useState('');
  const [saved,setSaved]=useState<{artifactId:string;title:string;type:string;source:string}[]>([]);
  const serial=useRef(0);
  const options=[{value:'',label:zh?'选择字段':'Choose field'},...(data?.dataset.fields||[]).map(field=>({value:field.name,label:field.name}))];
  const chartView=JSON.stringify(data?.view);
  async function create(mapping?:Record<string,string>, useAggregation=mode==='aggregate') {
    if(!data)throw new Error(zh?'请先导入数据集':'Import a dataset first');
    const request=++serial.current;setPending(true);setError('');setResult(null);
    const chart=mapping??(mode==='aggregate'?{type:kind,x:'label',y:'value'}:
      kind==='candlestick'?{type:kind,x,open,high,low,close}:
      kind==='sankey'?{type:kind,x,y,target}:{type:kind,x,y,...(kind==='line'&&series?{series}:{})});
    try {
      const value=await api.post<ChartResult>('/api/chart',{dataset:data.dataset.id,...data.view,
        chartDocument:{title:data.dataset.name,chart},...(useAggregation?{aggregation:data.view.chart}: {})});
      if(request===serial.current)setResult(value);
      return value;
    } catch(reason) {if(request===serial.current)setError(String(reason));throw reason;}
    finally {if(request===serial.current)setPending(false);}
  }
  useEffect(()=>{++serial.current;setPending(false);setResult(null);setError('');if(mode==='aggregate'&&data?.view.chart)void create().catch(()=>{});},[data?.dataset.id,data?.viewId,chartView,kind,mode]);
  async function acceptDocument(content:string) {
    const request=++serial.current;setPending(true);setResult(null);setError('');
    try {const value=await api.post<ChartResult>('/api/chart/validate',{content});if(request===serial.current)setResult(value);return value;}
    catch(reason){if(request===serial.current)setError(String(reason));throw reason;}finally{if(request===serial.current)setPending(false);}
  }
  async function importChart(file:File) {
    try {if(file.size>2*1024*1024)throw new Error(zh?'图表 JSON 超过 2 MiB':'Chart JSON exceeds 2 MiB');await acceptDocument(await file.text());}catch(reason){setError(String(reason));}
  }
  async function openSaved(id:string) {
    if(!id)return;
    const request=++serial.current;setPending(true);setResult(null);setError('');
    try {const value=await api.get<ChartResult>(`/api/chart/${id}`);if(request===serial.current)setResult(value);}
    catch(reason){if(request===serial.current)setError(String(reason));}finally{if(request===serial.current)setPending(false);}
  }
  async function showSource(record?:number) {
    if(!result?.document.source.dataset)return;
    const value=await api.get<{dataset:{id:string;name:string;format:'json'|'json_lines'};content:string}>(`/api/source/${result.document.source.dataset}`);
    await openDocument({id:value.dataset.id,title:value.dataset.name,text:value.content,format:{kind:value.dataset.format},...(record===undefined?{}:{location:{record}})});
  }
  useAppObject({id:'chart-document',kind:'chart-document',label:'Chart',state:{phase:result?'ready':'empty',
    ...(result?{artifactId:result.artifactId,title:result.document.title,type:result.document.chart.type,source:result.document.source.label,
      ...(result.document.source.dataset?{dataset:result.document.source.dataset}:{}),...(result.document.source.viewId?{viewId:result.document.source.viewId}:{})}: {})},actions:{
    render:{description:'Validate and display a chart document. Its source label is a declaration, not verified dataset provenance.',parameters:{type:'object',properties:{document:{type:'string',maxLength:65536}},required:['document'],additionalProperties:false},run:async params=>{
      const value=await acceptDocument(String(params.document));return {artifactId:value.artifactId,title:value.document.title,type:value.document.chart.type,source:value.document.source.label};
    }},
    create:{description:'Create a chart from the current matching records or selected records, retaining dataset and record provenance. Line optionally uses series; candlestick uses x, open, high, low and close; Sankey uses x, target and y.',parameters:{type:'object',properties:{type:{type:'string',enum:kinds},x:{type:'string',maxLength:160},y:{type:'string',maxLength:160},series:{type:'string',maxLength:160},target:{type:'string',maxLength:160},open:{type:'string',maxLength:160},high:{type:'string',maxLength:160},low:{type:'string',maxLength:160},close:{type:'string',maxLength:160}},required:['type','x'],additionalProperties:false},run:async params=>{
      const mapping=Object.fromEntries(Object.entries(params).map(([key,value])=>[key,String(value)]));const value=await create(mapping,false);
      return {artifactId:value.artifactId,title:value.document.title,type:value.document.chart.type,dataset:value.document.source.dataset!,viewId:value.document.source.viewId!,records:value.document.source.records!.length};
    }},
    source:{description:'Open the chart dataset source when the chart was generated from a Data Agent view.',parameters:{type:'object',properties:{record:{type:'integer',minimum:0}},additionalProperties:false},run:async params=>{if(!result?.document.source.dataset)throw new Error('This chart has no linked dataset');await showSource(params.record as number|undefined);return {dataset:result.document.source.dataset};}},
  }});
  const field=(label:string,value:string,change:(value:string)=>void)=><label className="data-chart-field"><span>{label}</span><Select label={label} value={value} options={options} disabled={busy||pending} onChange={change}/></label>;
  const columns=result?Array.from(new Set(result.document.rows.flatMap(row=>Object.keys(row)))):[];
  return <div className="data-chart-panel">
    {data&&<><label className="data-chart-field"><span>{zh?'图型':'Chart type'}</span><Select label={zh?'图型':'Chart type'} value={kind} options={kinds.map(value=>({value,label:value}))} disabled={busy||pending} onChange={value=>{setKind(value as Kind);if(value==='candlestick'||value==='sankey')setMode('records');}}/></label>
    <label className="data-chart-field"><span>{zh?'数据':'Data'}</span><Select label={zh?'图表数据':'Chart data'} value={mode} options={[...(kind==='candlestick'||kind==='sankey'?[]:[{value:'aggregate',label:zh?'当前聚合':'Current aggregation'}]),{value:'records',label:zh?'记录字段':'Record fields'}]} disabled={busy||pending} onChange={value=>setMode(value as 'aggregate'|'records')}/></label>
    {mode==='records'&&<>
      {field(kind==='sankey'?(zh?'来源':'Source'):zh?'横轴 / 分类':'X / category',x,setX)}
      {kind==='line'&&field(zh?'系列（可选）':'Series (optional)',series,setSeries)}
      {kind==='candlestick'?<>{field('Open',open,setOpen)}{field('High',high,setHigh)}{field('Low',low,setLow)}{field('Close',close,setClose)}</>:<>{kind==='sankey'&&field(zh?'目标':'Target',target,setTarget)}{field(zh?'数值':'Value',y,setY)}</>}
      <Button disabled={busy||pending} onClick={()=>void create().catch(()=>{})}>{zh?'生成图表':'Create chart'}</Button>
    </>}</>}
    <FilePicker label={zh?'打开图表 JSON':'Open chart JSON'} emptyLabel={zh?'图表 JSON':'Chart JSON'} accept=".json,application/json" disabled={busy||pending} busy={pending} onFile={file=>void importChart(file)}/>
    <details onToggle={event=>{if(event.currentTarget.open)void api.get<{charts:typeof saved}>('/api/charts').then(value=>setSaved(value.charts)).catch(reason=>setError(String(reason)));}}><summary>{zh?'已保存的图表':'Saved charts'}</summary>
      <Select label={zh?'打开已保存图表':'Open saved chart'} value="" options={[{value:'',label:zh?'选择图表':'Choose a chart'},...saved.map(item=>({value:item.artifactId,label:`${item.title} (${item.type}) — ${item.source}`}))]} onChange={value=>void openSaved(value)}/></details>
    {pending&&<p role="status">{zh?'正在生成图表…':'Preparing chart…'}</p>}
    {error&&<p role="alert" className="data-chart-error">{error}</p>}
    {result&&<><h3>{result.document.title}</h3>{result.document.description&&<p>{result.document.description}</p>}
      {(result.document.chart.xLabel||result.document.chart.yLabel)&&<p>{[result.document.chart.xLabel,result.document.chart.yLabel].filter(Boolean).join(' / ')}</p>}
      <ChartSurface document={result.document}/><div className="data-chart-actions"><Button onClick={()=>downloadFile(`${result.document.id||'chart'}.json`,result.content,'application/json')}>{zh?'导出图表 JSON':'Export chart JSON'}</Button>{result.document.source.dataset&&<Button onClick={()=>void showSource().catch(reason=>setError(String(reason)))}>{zh?'打开来源':'Open source'}</Button>}</div>
      <details><summary>{zh?'图表数据':'Chart data'} ({result.document.rows.length})</summary><div className="data-chart-table"><table><thead><tr>{columns.map(key=><th key={key} scope="col">{key}</th>)}</tr></thead><tbody>{result.document.rows.map((row,index)=><tr key={index}>{columns.map(key=><td key={key}>{key===result.document.chart.y&&result.document.source.exactValues?.[index]!==undefined?result.document.source.exactValues[index]:row[key]===null?'—':String(row[key]??'—')}</td>)}</tr>)}</tbody></table></div></details>
      <details className="data-chart-source"><summary>{zh?'图表来源':'Chart source'}</summary><p>{result.document.source.label}</p>{result.document.source.caveats?.map((item,index)=><p key={index}>{item}</p>)}
        <p>{zh?'图表摘要':'Chart digest'}: <code>{result.artifactId}</code></p>
        {result.document.source.dataset&&<><p>{zh?'来源摘要':'Source digest'}: <code>{result.document.source.dataset}</code></p><p>{zh?'视图':'View'}: <code>{result.document.source.viewId}</code></p><details><summary>{zh?'筛选和选区':'Filter and selection'}</summary><pre>{JSON.stringify({view:result.document.source.view,aggregation:result.document.source.aggregation},null,2)}</pre></details></>}
        {result.document.source.executedAt&&<p>{result.document.source.executedAt}</p>}{result.document.source.sql&&<details><summary>SQL</summary><pre>{result.document.source.sql}</pre></details>}
        {!!result.document.source.excludedValues&&<p>{zh?'排除数值':'Excluded values'}: {result.document.source.excludedValues}</p>}{!!result.document.source.omittedGroups&&<p>{zh?'省略分组':'Omitted groups'}: {result.document.source.omittedGroups}</p>}
        {result.document.source.records&&<details><summary>{zh?'来源记录':'Source records'} ({result.document.source.records.length})</summary><ul>{result.document.source.records.map(record=><li key={record.ordinal}><button onClick={()=>void showSource(record.ordinal).catch(reason=>setError(String(reason)))}>{record.pointer}{record.line===null?'':` (line ${record.line})`}</button></li>)}</ul></details>}
      </details></>}
  </div>;
}
