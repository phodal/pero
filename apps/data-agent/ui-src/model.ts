export type Field = { name: string; kinds: string[]; missing: number; nulls: number };
export type Dataset = { id: string; name: string; revision: number; format: 'json'|'json_lines'; bytes: number; rowCount: number; fields: Field[] };
export type ViewSpec = {
  filter: {field: string; operator: string; value: string}|null;
  sort: {field: string; descending: boolean}|null;
  selection: number[]; columns: string[];
  chart: {category: string; measure: string; aggregation: string}|null;
};
export type Row = { ordinal: number; pointer: string; line: number|null; cells: Record<string,{kind: string;display: string;truncated: boolean}> };
export type RecordWindow = {records:Row[];total:number;offset:number;nextOffset:number|null};
export type Result = { dataset: Dataset; view: ViewSpec; viewId: string; matching: number; selected: number; offset: number; rows: Row[];sample:RecordWindow;
  chart: {points: {label: string|null;exact: string;ratio: number;count: number}[];omittedGroups: number;excludedValues: number}|null };
export type Export = { id: string; name: string; records: number; bytes: number; content: string };
export const emptyView: ViewSpec = { filter:null, sort:null, selection:[], columns:[], chart:null };
export const fieldRule = {type:'string',maxLength:512};
export const querySchema = {type:'object',properties:{
  filterField:fieldRule,operator:{type:'string',enum:['contains','eq','gte','lte','missing','null']},value:{type:'string',maxLength:4096},
  sortField:fieldRule,descending:{type:'boolean'},
  columns:{type:'array',maxItems:32,items:fieldRule},
  selection:{type:'array',maxItems:1000,items:{type:'integer',minimum:0}},
},additionalProperties:false};
export function summary(value: Result) { return {dataset:value.dataset.id,revision:value.dataset.revision,view:value.viewId,matching:value.matching,selected:value.selected,offset:value.offset,visibleRows:value.rows.length}; }
