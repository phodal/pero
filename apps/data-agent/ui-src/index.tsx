import React, {useEffect, useRef, useState} from 'react';
import {AppConversation, downloadFile, openDocument, useAppApi, useAppChat, useAppI18n, useAppObject, useAppDataChanged} from '@pero/app-sdk';
import {AppFrame, Button, Checkbox, EmptyState, Feedback, FilePicker, Icon, Input, Select, Split, SplitPane, Tabs, TabsContent, TabsList, TabsTrigger, Toolbar} from '@pero/app-sdk/ui';
import {emptyView, fieldRule, querySchema, summary, type Dataset, type Export, type Result, type ViewSpec} from './model';
import {messages} from './i18n';
import {ChartPanel} from './chart-panel';
import './styles.css';

type Example = { id: string; name: string; format: Dataset['format']; records: number; fields: string[] };

export default function DataAgent() {
  const api=useAppApi(),chat=useAppChat(),{t}=useAppI18n(messages);
  const [catalog,setCatalog]=useState<Dataset[]>([]),[examples,setExamples]=useState<Example[]>([]),[examplesReady,setExamplesReady]=useState(false),[data,setData]=useState<Result|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[fieldSearch,setFieldSearch]=useState('');
  const [showChat,setShowChat]=useState(false);
  const [tab,setTab]=useState('table'),[dragging,setDragging]=useState(false);
  const [filterField,setFilterField]=useState(''),[operator,setOperator]=useState('contains'),[filterValue,setFilterValue]=useState('');
  const request=useRef(0);
  const homeRequested=useRef(false);
  const view=data?.view||emptyView;
  async function query(dataset: string, next: ViewSpec, offset=0) {
    const id=++request.current;setBusy(true);setError('');
    const previous=data;
    setData(current=>current?.dataset.id===dataset?{...current,view:next}:current);
    try {
      const result=await api.post<Result>('/api/query',{dataset,...next,offset,limit:50});
      if(id===request.current){setData(result);setFilterField(result.view.filter?.field||'');setOperator(result.view.filter?.operator||'contains');setFilterValue(result.view.filter?.value||'');}
      return result;
    } catch(error){if(id===request.current){setData(previous);setError(String(error));}throw error;}
    finally{if(id===request.current)setBusy(false);}
  }
  async function choose(dataset:Dataset) {
    homeRequested.current=false;
    const numeric=dataset.fields.find(field=>field.kinds.includes('number'));
    const category=dataset.fields.find(field=>field.kinds.includes('string'))||dataset.fields[0];
    const result=await query(dataset.id,{...emptyView,columns:dataset.fields.slice(0,8).map(field=>field.name),chart:category&&numeric?{category:category.name,measure:numeric.name,aggregation:'sum'}:null});
    setTab('table');
    return result;
  }
  async function reload() {
    setError('');
    try { const [listed,value]=await Promise.all([api.get<{examples:Example[]}>('/api/examples'),api.get<{datasets:Dataset[]}>('/api/datasets')]);
      setExamples(listed.examples);setCatalog(value.datasets);
      if(homeRequested.current)return;
      const current=value.datasets.find(item=>item.id===data?.dataset.id)||value.datasets[0];
      if(current){
        if(data&&current.id===data.dataset.id)await query(current.id,data.view,data.offset);
        else await choose(current);
      }
    }catch(error){setError(String(error));}
    finally{setExamplesReady(true);}
  }
  useEffect(()=>{void reload();},[]);
  useAppDataChanged(()=>{void reload();});
  async function importSource(name:string,content:string,format:Dataset['format']) {
    setBusy(true);setError('');
    try {const result=await api.post<{dataset:Dataset}>('/api/import',{name,content,format});
      setCatalog(previous=>[result.dataset,...previous.filter(item=>item.id!==result.dataset.id)]);await choose(result.dataset);
    }catch(error){setError(String(error));}finally{setBusy(false);}
  }
  async function openListed(example: Example) {
    const value=await api.get<{name:string;content:string;format:Dataset['format']}>(`/api/examples/${example.id}`);
    await importSource(value.name,value.content,value.format);
  }
  async function source(record?:number) {
    if(!data)throw new Error('Choose a dataset first');
    const result=await api.get<{dataset:Dataset;content:string}>(`/api/source/${data.dataset.id}`);
    await openDocument({id:result.dataset.id,title:result.dataset.name,text:result.content,format:{kind:result.dataset.format},...(record===undefined?{}:{location:{record}})});
    return {dataset:result.dataset.id,revision:result.dataset.revision,bytes:result.dataset.bytes,...(record===undefined?{}:{record})};
  }
  async function exportRows(open=false) {
    if(!data)throw new Error('Choose a dataset first');
    const result=await api.post<Export>('/api/export',{dataset:data.dataset.id,...view});
    if(open)await openDocument({id:result.id,title:result.name,text:result.content,format:{kind:'json'}});
    else downloadFile(result.name,result.content,'application/json');
    return {artifactId:result.id,name:result.name,records:result.records,bytes:result.bytes};
  }
  const act=(work:()=>Promise<unknown>)=>{setBusy(true);setError('');void work().catch(error=>setError(String(error))).finally(()=>setBusy(false));};
  const update=(next:ViewSpec,offset=0)=>act(()=>query(data!.dataset.id,next,offset));
  function importFile(file:File) {
    act(async()=>{
      if(file.size>16*1024*1024)throw new Error(t('fileTooLarge'));
      await importSource(file.name,await file.text(),/\.(jsonl|ndjson)$/i.test(file.name)?'json_lines':'json');
    });
  }
  useAppObject({id:'dataset-view',kind:'dataset-view',label:'Data Agent',state:{phase:data?'ready':'empty',
    ...(data?{...summary(data),name:data.dataset.name,sourceFormat:data.dataset.format,bytes:data.dataset.bytes,recordCount:data.dataset.rowCount,
      fields:data.dataset.fields.slice(0,32),fieldCount:data.dataset.fields.length,query:data.view,
      sample:data.sample.records,sampleNextOffset:data.sample.nextOffset,
      chart:data.chart?{points:data.chart.points.slice(0,10).map(point=>({...point,exact:point.exact.slice(0,128),truncated:point.exact.length>128})),excludedValues:data.chart.excludedValues,omittedGroups:data.chart.omittedGroups}:null}:{}),
  },actions:{
    query:{description:'Apply a typed filter, sort, displayed fields or stable record selection. Results return counts; source remains in App files.',parameters:querySchema,run:async params=>{
      if(!data)throw new Error('Import a dataset first');
      const next:ViewSpec={...view,selection:params.selection as number[]??view.selection,columns:params.columns as string[]??view.columns};
      if(Object.hasOwn(params,'filterField'))next.filter=params.filterField?{field:String(params.filterField),operator:String(params.operator||'contains'),value:String(params.value??'')}:null;
      if(Object.hasOwn(params,'sortField'))next.sort=params.sortField?{field:String(params.sortField),descending:Boolean(params.descending)}:null;
      return summary(await query(data.dataset.id,next));
    }},
    chart:{description:'Aggregate the same selected or matching records. Exact values remain strings; missing values are excluded explicitly.',parameters:{type:'object',properties:{category:fieldRule,measure:fieldRule,aggregation:{type:'string',enum:['sum','count']}},required:['category','measure','aggregation'],additionalProperties:false},run:async params=>{
      if(!data)throw new Error('Import a dataset first');
      setTab('chart');
      return summary(await query(data.dataset.id,{...view,chart:{category:String(params.category),measure:String(params.measure),aggregation:String(params.aggregation)}}));
    }},
    source:{description:'Open complete immutable source, optionally locating a record in the shared reader.',parameters:{type:'object',properties:{record:{type:'integer',minimum:0}},additionalProperties:false},run:params=>source(params.record as number|undefined)},
    read:{description:'Read selected or matching records with exact numeric text and provenance. Follow nextOffset only if needed; truncated cells remain in the source.',parameters:{type:'object',properties:{offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:20},columns:{type:'array',maxItems:8,items:fieldRule}},additionalProperties:false},run:params=>{
      if(!data)throw new Error('Choose a dataset first');
      return api.post('/api/records',{dataset:data.dataset.id,...view,columns:params.columns??view.columns.slice(0,8),offset:params.offset??0,limit:params.limit??10});
    }},
    export:{description:'Persist an exact JSON export with source digest, query, selection and record provenance; open it in the shared reader.',parameters:{type:'object',properties:{},additionalProperties:false},run:()=>exportRows(true)},
  }});
  const fields=data?.dataset.fields||[],fieldOptions=fields.map(field=>({value:field.name,label:field.name}));
  const selected=new Set(view.selection);
  const visibleFields=fields.filter(field=>field.name.toLowerCase().includes(fieldSearch.toLowerCase()));
  const picker=<FilePicker label={t('import')} emptyLabel={t('noFile')} accept=".json,.jsonl,.ndjson,application/json" disabled={busy} busy={busy} onFile={importFile}/>;
  return <AppFrame className="data-agent" data-screen={data?'dataset':'home'} label={t('title')} title={!data?t('title'):undefined} aria-busy={busy}
    tools={data&&<>
      <Button variant="ghost" disabled={busy} onClick={()=>{homeRequested.current=true;++request.current;setData(null);setBusy(false);setShowChat(false);setError('');}}>{t('allData')}</Button>
      <Select label={t('dataset')} value={data.dataset.id} options={catalog.map(item=>({value:item.id,label:item.name}))} disabled={busy} onChange={id=>{const found=catalog.find(item=>item.id===id);if(found)act(()=>choose(found));}}/>
    </>}
    actions={data&&<>
      {picker}
      <Button disabled={busy} onClick={()=>act(()=>source())}>{t('source')}</Button>
      <Button disabled={busy} onClick={()=>act(()=>exportRows())}>{t('export')}</Button>
      <Button variant="primary" disabled={busy||window.parent===window} onClick={()=>act(()=>chat.compose(t('prompt'),{attachments:[chat.objectReference('dataset-view',{dataset:data.dataset.id,sourceRevision:data.dataset.revision,viewId:data.viewId,selectedCount:data.selected})]}))}>{t('ask')}</Button>
      {window.parent!==window&&<Button onClick={()=>setShowChat(value=>!value)} aria-expanded={showChat}>{t(showChat?'closeChat':'openChat')}</Button>}
    </>}>
    {error&&<Feedback kind="error"><span>{error}</span><Button disabled={busy} onClick={()=>{void reload();}}>{t('retry')}</Button></Feedback>}
    {busy&&<p className="data-status" role="status">{t('loading')}</p>}
    {!data?<div className="data-home">
      <Split className="data-start" storageKey="data-agent.start-split" collapseBelow={820}>
        <SplitPane id="data-import" min={280} className="data-import" as="section">
          <div className="data-home-panel">
          <h2>{t('importData')}</h2>
          <div className="data-dropzone" data-dragging={dragging||undefined}
            onDragOver={event=>{event.preventDefault();if(!busy)setDragging(true);}}
            onDragLeave={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node|null))setDragging(false);}}
            onDrop={event=>{event.preventDefault();setDragging(false);const file=event.dataTransfer.files[0];if(file&&!busy)importFile(file);}}>
            <Icon name="upload" size={24}/>
            <p>{t(dragging?'dropToImport':'dropFile')}</p>
            {picker}
          </div>
          </div>
        </SplitPane>
        <SplitPane id="data-examples" min={320} size={500} resizeLabel={t('resizeExamples')} className="data-examples" as="section">
          <div className="data-home-panel">
          <h2>{t('examples')}</h2>
          {examples.length?<ul>{examples.map(example=><li key={example.id}>
            <div><h3>{example.name}</h3>
              <span className="data-example-meta">{example.records.toLocaleString()} {t('rows')}, {example.fields.length} {t('fieldCount')}</span>
            </div>
            <Button disabled={busy} aria-label={example.id==='observations'?undefined:`${t('open')} ${example.name}`} onClick={()=>act(()=>openListed(example))}>{t(example.id==='observations'?'example':'open')}</Button>
          </li>)}</ul>:examplesReady&&!error?<p className="data-muted">{t('noExamples')}</p>:!error?<p className="data-muted" role="status">{t('loading')}</p>:null}
          </div>
        </SplitPane>
      </Split>
      {catalog.length>0&&<section className="data-datasets"><h2>{t('datasets')}</h2><ul>{catalog.map(item=><li key={item.id}>
        <button disabled={busy} onClick={()=>act(()=>choose(item))}><span>{item.name}</span><span>{item.rowCount.toLocaleString()} {t('rows')}</span></button>
      </li>)}</ul></section>}
      <section className="data-home-charts" aria-label={t('chart')}><ChartPanel data={null} busy={busy}/></section>
    </div>:<>
      <Split className="data-content" data-chat={showChat||undefined} storageKey="data-agent.chat-split" collapseBelow={820}>
        <SplitPane id="data-workspace" min={400} className="data-workspace">
          <Tabs className="data-tabs" value={tab} onValueChange={setTab}>
            <div className="data-workspace-bar">
              <TabsList aria-label={t('views')}><TabsTrigger value="table">{t('table')}</TabsTrigger><TabsTrigger value="fields">{t('fields')}</TabsTrigger><TabsTrigger value="chart">{t('chart')}</TabsTrigger></TabsList>
              <div className="data-counts"><span>{data.dataset.rowCount.toLocaleString()} {t('rows')}</span><span>{fields.length} {t('fieldCount')}</span>{view.filter&&<span>{data.matching.toLocaleString()} {t('matching')}</span>}{view.selection.length>0&&<span>{view.selection.length} {t('selected')}</span>}</div>
            </div>
            <TabsContent value="table" forceMount className="data-tab-panel data-records">
              <Toolbar className="data-controls">
                <Select label={t('filter')} value={filterField} options={[{value:'',label:t('filter')},...fieldOptions]} onChange={setFilterField}/>
                <Select label={t('operator')} value={operator} options={(['contains','eq','gte','lte','missing','null'] as const).map(value=>({value,label:t(value)}))} onChange={setOperator}/>
                <Input aria-label={t('value')} placeholder={t('value')} value={filterValue} disabled={operator==='missing'||operator==='null'} onChange={event=>setFilterValue(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'&&!busy)update({...view,selection:[],filter:filterField?{field:filterField,operator,value:filterValue}:null});}}/>
                <Button disabled={busy||!filterField} onClick={()=>update({...view,selection:[],filter:{field:filterField,operator,value:filterValue}})}>{t('apply')}</Button>
                {view.filter&&<Button disabled={busy} onClick={()=>update({...view,selection:[],filter:null})}>{t('clear')}</Button>}
                <Select label={t('sort')} value={view.sort?.field||''} options={[{value:'',label:t('sort')},...fieldOptions]} disabled={busy} onChange={field=>update({...view,sort:field?{field,descending:view.sort?.descending||false}:null})}/>
                <Button disabled={busy||!view.sort} onClick={()=>update({...view,sort:{field:view.sort!.field,descending:!view.sort!.descending}})}>{t(view.sort?.descending?'descending':'ascending')}</Button>
              </Toolbar>
              <div className="data-grid" tabIndex={0} role="region" aria-label={t('rows')}><table>
                <thead><tr><th scope="col">#</th>{view.columns.map(name=><th key={name} scope="col" aria-sort={view.sort?.field===name?(view.sort.descending?'descending':'ascending'):'none'}><button disabled={busy} onClick={()=>update({...view,sort:{field:name,descending:view.sort?.field===name?!view.sort.descending:false}})}>{name}</button></th>)}<th scope="col">{t('source')}</th></tr></thead>
                <tbody>{data.rows.map(row=><tr key={row.ordinal} aria-selected={selected.has(row.ordinal)}>
                  <th scope="row"><label><Checkbox aria-label={`${t('select')} ${row.ordinal+1}`} checked={selected.has(row.ordinal)} disabled={busy||!selected.has(row.ordinal)&&selected.size===1000} onCheckedChange={checked=>update({...view,selection:checked?[...view.selection,row.ordinal]:view.selection.filter(index=>index!==row.ordinal)},data.offset)}/>{row.ordinal+1}</label></th>
                  {view.columns.map(name=><td key={name} data-kind={row.cells[name]?.kind||'missing'} title={row.cells[name]?.truncated?t('showRecord'):undefined}>{row.cells[name]?.display??'—'}{row.cells[name]?.truncated?'…':''}</td>)}
                  <td><Button variant="ghost" disabled={busy} aria-label={`${t('showRecord')} ${row.ordinal+1}`} onClick={()=>act(()=>source(row.ordinal))}><Icon name="open"/></Button></td>
                </tr>)}</tbody>
              </table>{!data.rows.length&&<EmptyState heading={t('noResults')}/>}</div>
              <footer className="data-pagination"><span>{data.rows.length?data.offset+1:0}–{data.offset+data.rows.length} / {data.matching.toLocaleString()}</span><Button disabled={busy||data.offset===0} onClick={()=>update(view,Math.max(0,data.offset-50))}>{t('previous')}</Button><Button disabled={busy||data.offset+50>=data.matching} onClick={()=>update(view,data.offset+50)}>{t('next')}</Button>{view.selection.length>0&&<Button disabled={busy} onClick={()=>update({...view,selection:[]},data.offset)}>{t('clearSelection')}</Button>}</footer>
            </TabsContent>
            <TabsContent value="fields" forceMount className="data-tab-panel data-fields">
              <Toolbar className="data-field-controls"><Input type="search" aria-label={t('findFields')} placeholder={t('findFields')} value={fieldSearch} onChange={event=>setFieldSearch(event.target.value)}/><p>{view.columns.length} / 32 {t('displayed')}</p></Toolbar>
              <div className="data-fields-table" tabIndex={0} role="region" aria-label={t('quality')}><table>
                <thead><tr><th scope="col">{t('inTable')}</th><th scope="col">{t('field')}</th><th scope="col">{t('type')}</th><th scope="col">{t('nullValues')}</th><th scope="col">{t('missingFields')}</th></tr></thead>
                <tbody>{visibleFields.map(field=><tr key={field.name}>
                  <td><Checkbox aria-label={`${t('displayField')} ${field.name}`} checked={view.columns.includes(field.name)} disabled={busy||!view.columns.includes(field.name)&&view.columns.length===32} onCheckedChange={checked=>update({...view,columns:checked?[...view.columns,field.name]:view.columns.filter(name=>name!==field.name)},data.offset)}/></td>
                  <th scope="row">{field.name}</th><td>{field.kinds.join(' / ')}</td><td>{field.nulls.toLocaleString()}</td><td>{field.missing.toLocaleString()}</td>
                </tr>)}</tbody>
              </table>{!visibleFields.length&&<EmptyState heading={t('noFields')}/>}</div>
            </TabsContent>
            <TabsContent value="chart" forceMount className="data-tab-panel data-chart">
              <ChartPanel data={data} busy={busy} onActivate={()=>setTab('chart')} aggregationControls={<>
                <label className="data-chart-field"><span>{t('category')}</span><Select label={t('category')} value={view.chart?.category||''} options={[{value:'',label:t('category')},...fieldOptions]} disabled={busy} onChange={category=>update({...view,chart:category?{category,measure:view.chart?.measure||fields[0].name,aggregation:view.chart?.aggregation||'count'}:null})}/></label>
                {view.chart&&<><label className="data-chart-field"><span>{t('measure')}</span><Select label={t('measure')} value={view.chart.measure} options={fieldOptions} disabled={busy} onChange={measure=>update({...view,chart:{...view.chart!,measure}})}/></label><label className="data-chart-field"><span>{t('aggregation')}</span><Select label={t('aggregation')} value={view.chart.aggregation} options={[{value:'sum',label:t('sum')},{value:'count',label:t('count')}]} disabled={busy} onChange={aggregation=>update({...view,chart:{...view.chart!,aggregation}})}/></label></>}
              </>}/>
            </TabsContent>
          </Tabs>
        </SplitPane>
        <SplitPane id="data-conversation" min={280} size={360} resizeLabel={t('resizeChat')} className="data-chat" hidden={!showChat}>{showChat&&<AppConversation fallback={<p role="status">{t('chatUnavailable')}</p>}/>}</SplitPane>
      </Split>
      <footer className="data-provenance"><details><summary>{t('sourceDetails')}</summary><p>{t('provenance')}: <code>{data.dataset.id}</code></p><p>{data.dataset.bytes.toLocaleString()} bytes</p><p>{t('exportFields')}</p></details></footer>
    </>}
  </AppFrame>;
}
