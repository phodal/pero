import { parse as parseCsv } from 'csv-parse/browser/esm/sync';
import { defaultOptions } from 'myst-parser';
import { VFile } from 'vfile';
import { parseMystSource, type MystNode, type MystParsedDocument } from './myst.ts';
import { resolveMystResource, type MystProjectSnapshot } from './myst-project-snapshot.ts';
export const MYST_CSV_MAX_ROWS = 1000;
export const MYST_CSV_MAX_COLUMNS = 64;
export const MYST_CSV_MAX_CELLS = 10000;
export const MYST_CSV_MAX_CELL_BYTES = 16 * 1024;
const csvDirective = defaultOptions.directives.find(spec => spec.name === 'csv-table')!;
const supported = new Set(['file','header','header-rows','delim','quote','escape','keepspace','label','name']);
interface MystCsvTableInput { body: string; cellCount: number; options: { header?: string; 'header-rows': number; delim: string; quote: string; escape: string; keepspace: boolean; label?: string } }
/** Admission owns resource/count limits; the official directive owns conversion. */
function csvInput(body: string, raw: Readonly<Record<string, unknown>>): MystCsvTableInput {
  for (const key of Object.keys(raw)) if (!supported.has(key) || typeof raw[key] !== 'string') throw new TypeError(`Unsupported CSV-table option: ${key}`);
  const options = raw as Record<string,string>;
  if ('label' in options && 'name' in options) throw new TypeError('CSV-table label and name conflict');
  const rows = options['header-rows'] ?? '0';
  if (!/^\d+$/.test(rows) || !Number.isSafeInteger(Number(rows))) throw new TypeError('CSV-table header-rows must be a nonnegative integer');
  if ('keepspace' in options && !['','true','false'].includes(options.keepspace)) throw new TypeError('CSV-table keepspace must be a boolean flag');
  const normalized: MystCsvTableInput['options'] = { 'header-rows': Number(rows), delim: options.delim ?? ',', quote: options.quote ?? '"', escape: options.escape ?? '"', keepspace: 'keepspace' in options && options.keepspace !== 'false', ...(options.header !== undefined ? {header: options.header} : {}), ...((options.label ?? options.name) ? {label: options.label ?? options.name} : {}) };
  const delimiter = normalized.delim === 'tab' ? '\t' : normalized.delim === 'space' ? ' ' : normalized.delim;
  if ([delimiter, normalized.quote, normalized.escape].some(value => [...value].length !== 1 || /[\r\n]/.test(value))) throw new TypeError('CSV-table delimiter, quote and escape must be single characters');
  const parse = (source: string): string[][] => parseCsv(source,{delimiter,quote:normalized.quote,escape:normalized.escape,ltrim:!normalized.keepspace,max_record_size:64*1024});
  const data = parse(body), header = normalized.header === undefined ? [] : parse(normalized.header), all = [...header,...data];
  if (!data.length) throw new TypeError('CSV-table requires nonempty data');
  if (normalized['header-rows'] > data.length) throw new RangeError('CSV-table header-rows exceeds data rows');
  const columns = all[0]?.length ?? 0;
  if (!columns || all.some(row => row.length !== columns)) throw new TypeError('CSV-table header and data column counts must agree');
  if (all.length > MYST_CSV_MAX_ROWS || columns > MYST_CSV_MAX_COLUMNS || all.length * columns > MYST_CSV_MAX_CELLS) throw new RangeError('CSV-table exceeds 1000 rows, 64 columns or 10000 cells');
  if (all.some(row => row.some(cell => new TextEncoder().encode(cell).length > MYST_CSV_MAX_CELL_BYTES))) throw new RangeError('CSV-table cell exceeds 16 KiB');
  return {body,cellCount:all.length*columns,options:normalized};
}
/** :file: is a Pero explicit-resource extension; pinned MyST only supports body. */
export function expandMystCsvTables(snapshot: MystProjectSnapshot,path: string,parsed: MystParsedDocument): {parsed:MystParsedDocument;resources:string[]} {
  let diagnostics = [...parsed.diagnostics];
  const resources = new Set<string>();
  let count=0,totalBytes=0,totalCells=0;
  const expand=(node:MystNode):MystNode=>{
    if (!['mystDirective','mystDirectiveError'].includes(node.type)||node.name!=='csv-table') { if(node.children)node.children=node.children.map(expand); return node; }
    const containing=node.provenance?.path??path;
    const report=(code:string,message:string)=>diagnostics.push({code,severity:'warning',message,path:containing,line:node.position?.start.line});
    const raw=node.options??{};
    if(typeof raw!=='object'||Array.isArray(raw)){report('csv-table-options','CSV-table options must be a mapping');return node;}
    const options=raw as Record<string,unknown>;
    let body=typeof node.directiveBody==='string'?node.directiveBody:'',resourcePath=containing;
    if(options.file!==undefined){
      if(typeof options.file!=='string'||body.trim()){report('csv-table-options','CSV-table accepts exactly one data source: file or inline body');return node;}
      const resolved=resolveMystResource(snapshot,containing,options.file);
      if(resolved.status!=='resolved'){report(`csv-table-${resolved.status}`,resolved.status==='missing'?`CSV resource not provided: ${resolved.path}`:resolved.reason);return node;}
      resourcePath=resolved.path;body=resolved.resource.text;resources.add(resourcePath);
    }
    if(++count>64||(totalBytes+=new TextEncoder().encode(body+String(options.header??'')).length)>1024*1024){report('csv-table-budget','CSV-table expansion exceeds 64 tables or 1 MiB');return node;}
    try{
      const input=csvInput(body,options);
      if((totalCells+=input.cellCount)>MYST_CSV_MAX_CELLS){report('csv-table-budget','CSV-table expansion exceeds 10000 cells across the page');return node;}
      const file=new VFile();
      const parseInline=(source:string,offset=0)=>{
        const cell=parseMystSource(source),children=cell.ast.children??[];
        if(source.trim()&&(children.length!==1||children[0].type!=='paragraph'))throw new TypeError('CSV cells and captions support inline MyST only');
        if(cell.diagnostics.length)throw new TypeError(`Unsupported CSV cell syntax: ${cell.diagnostics[0].message}`);
        return {...cell.ast,type:'root' as const,children,position:{start:{line:offset+1,column:1},end:{line:offset+1,column:1}}};
      };
      const caption=typeof node.args==='string'&&node.args?parseInline(node.args).children[0]?.children:undefined;
      const children=csvDirective.run({name:'csv-table',node:{type:'mystDirective',name:'csv-table'},body:input.body,options:input.options,arg:caption},file,{parseMyst:parseInline}) as MystNode[];
      if(file.messages.length)throw new TypeError(file.messages.map(m=>m.reason).join('; '));
      const provenance={path:resourcePath,lines:body.split('\n').map((_,i)=>i+1),stack:[...(node.provenance?.stack??[path]),resourcePath]};
      const annotate=(child:MystNode)=>{child.provenance=provenance;child.children?.forEach(annotate);};children.forEach(annotate);
      diagnostics=diagnostics.filter(item=>!((item.path===undefined||item.path===containing)&&item.line!==undefined&&item.line>=(node.position?.start.line??Infinity)&&item.line<=(node.position?.end.line??-1)&&((item.code==='directive-disabled'&&item.message.includes('csv-table'))||(item.code==='directive-body-correct'&&item.message==='required body not provided for directive: csv-table')||(item.code==='directive-options-correct'&&item.message==='unexpected option "file" provided (in csv-table)'))));
      return {type:'block',provenance,children};
    }catch(error){report('csv-table-invalid',error instanceof Error?error.message:'Invalid CSV-table');return node;}
  };
  const ast=expand(structuredClone(parsed.ast));return {parsed:{...parsed,ast,diagnostics},resources:[...resources]};
}
