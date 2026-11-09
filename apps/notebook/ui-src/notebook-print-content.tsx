import { Fragment, type ReactNode } from 'react';
import { useAppI18n } from '@pero/app-sdk';
import type { CellAnnotation, NotebookDocument, NotebookNode } from '@pero/notebook';
import { notebookPrintSections, type NotebookPrintSection, type NotebookPrintSettings } from '@pero/notebook/notebook-print';
import { cellAddress, type Spreadsheet } from '@pero/notebook/spreadsheet';
import { displayNumber, formatCellValue, type CellFormat } from '@pero/notebook/grid-presentation';
import { calculateNotebookWorksheets, type NotebookWorksheet } from '@pero/notebook/worksheet';
import type { StructuredTableDraft } from '@pero/notebook/structured-table';
import type { NotebookMaterial } from '@pero/notebook/workspace';
import { messages } from './messages';

const printRecordMessages = {
  printCurrentRecipe: { en: 'Current recipe', zh: '当前配方' },
  printOutput: { en: 'Output', zh: '产物' },
  printTarget: { en: 'Final target', zh: '最终目标量' },
  printMethod: { en: 'Method', zh: '方法' },
  printIngredients: { en: 'Ingredients', zh: '成分' },
  printNoIngredients: { en: 'No ingredients recorded.', zh: '尚未记录成分。' },
  printSource: { en: 'Source', zh: '来源' },
  printPlanned: { en: 'Planned', zh: '计划' },
  printMeasured: { en: 'Measured', zh: '实测' },
  printQuantityMode: { en: 'Specified quantity', zh: '指定用量' },
  printQsMode: { en: 'QS to final volume', zh: '补足至最终体积' },
  printAdditive: { en: 'Planning assumption: volumes add. QS subtraction is not an observed addition.', zh: '计划假定体积可加。QS 相减不是实测添加量。' },
  printNoAdditive: { en: 'No additive-volume assumption. QS means fill to the measured final volume.', zh: '不假定体积可加。QS 表示补足至实测最终体积。' },
  printSavedRecipes: { en: 'Saved recipe v{revision}: {name}', zh: '已保存配方 v{revision}：{name}' },
  printPreparations: { en: 'Preparation records', zh: '制备记录' },
  printNoPreparation: { en: 'No actual preparation recorded.', zh: '尚未记录实际制备。' },
  printOperator: { en: 'Operator', zh: '操作者' },
  printRecordedAt: { en: 'Recorded', zh: '记录时间' },
  printRecipeVersion: { en: 'Recipe v{revision}', zh: '配方 v{revision}' },
  printUnknownQuantity: { en: 'Unknown', zh: '未知' },
  printUnnamed: { en: 'Unnamed', zh: '未命名' },
  printReactant: { en: 'Reactant', zh: '反应物' },
  printProduct: { en: 'Product', zh: '产物' },
  printAgentRole: { en: 'Agent / solvent', zh: '试剂 / 溶剂' },
  printMolecules: { en: 'Molecules', zh: '分子' },
  printNoMolecules: { en: 'No molecules recorded.', zh: '尚未记录分子。' },
  printAtoms: { en: 'Explicit atoms', zh: '显式原子' },
  printNoAtoms: { en: 'No explicit atoms.', zh: '无显式原子。' },
  printBonds: { en: 'Bonds', zh: '化学键' },
  printNoBonds: { en: 'no bonds', zh: '无化学键' },
  printSingleBond: { en: '{count} single', zh: '{count} 个单键' },
  printDoubleBond: { en: '{count} double', zh: '{count} 个双键' },
  printTripleBond: { en: '{count} triple', zh: '{count} 个三键' },
  printCharge: { en: '{element} charge {charge}', zh: '{element} 电荷 {charge}' },
  printCoordinatesOmitted: { en: 'Atom coordinates omitted.', zh: '已省略原子坐标。' },
  printSavedScientific: { en: 'Saved record {id} · v{revision} · {savedAt}', zh: '已保存记录 {id} · v{revision} · {savedAt}' },
  printDraftRecord: { en: 'Draft only; no saved record.', zh: '仅为草稿，尚未保存记录。' },
  printChemicalSource: { en: 'From molecule {molecule} in record {id} v{revision}.', zh: '来自记录 {id} v{revision} 的分子 {molecule}。' },
  printChemicalMolecule: { en: 'Source molecule {molecule}.', zh: '来源分子 {molecule}。' },
  printDrawnLocally: { en: 'Drawn in this entry; no source record.', zh: '在本条目中绘制，无来源记录。' },
  printIntakeMode: { en: 'Input source', zh: '输入来源' },
  printModeManual: { en: 'Manual identifiers', zh: '手工标识符' },
  printModeBarcode: { en: 'Barcode', zh: '条码' },
  printModeWorklist: { en: 'Worklist', zh: '工作清单' },
  printModeTable: { en: 'Structured table', zh: '结构化表格' },
  printModePlate: { en: 'Plate mapping', zh: '孔板映射' },
  printMatchField: { en: 'Match field', zh: '匹配字段' },
  printSchema: { en: 'Schema', zh: '数据结构' },
  printPlateSize: { en: 'Plate {rows} × {columns}', zh: '孔板 {rows} × {columns}' },
  printSelectedRecords: { en: 'Selected records', zh: '已选记录' },
  printNoBindings: { en: 'No selected records.', zh: '尚未选择记录。' },
  printWell: { en: 'Well {well}', zh: '孔位 {well}' },
  printSourceRows: { en: '{count} source rows omitted from print.', zh: '打印省略 {count} 行来源数据。' },
  printSourceFile: { en: '{file}: {count} source rows omitted from print.', zh: '{file}：打印省略 {count} 行来源数据。' },
  printRecordVersion: { en: 'v{version}', zh: 'v{version}' },
  printCatalog: { en: 'Catalog {id}', zh: '目录 {id}' },
  printLiveQuery: { en: 'Live query; results are not frozen in this entry.', zh: '实时查询，结果未固定在本条目中。' },
  printFrozenResults: { en: '{count} frozen results · refreshed {time}', zh: '{count} 条固定结果 · 刷新于 {time}' },
  printNoFrozenResults: { en: 'No matching entries in the frozen results.', zh: '固定结果中没有匹配记录。' },
  printQueryRef: { en: 'Query {id} · revision {revision} · {mode}', zh: '查询 {id} · 版本 {revision} · {mode}' },
  printModeLive: { en: 'live', zh: '实时' },
  printModeSnapshot: { en: 'snapshot', zh: '快照' },
  printUnboundCanvas: { en: 'No canvas binding saved.', zh: '尚未保存画布绑定。' },
  printCanvasPath: { en: '{app} / {panel}', zh: '{app} / {panel}' },
  printCanvasView: { en: 'View {view}', zh: '视图 {view}' },
  printBindingId: { en: 'Binding {id}', zh: '绑定 {id}' },
  printDeclarationSha: { en: 'Declaration SHA-256: {sha}', zh: '声明 SHA-256：{sha}' },
  printInputs: { en: 'Inputs', zh: '输入' },
  printRetainedResult: { en: 'Retained result', zh: '保留结果' },
  printBytesOmitted: { en: 'Embedded bytes omitted.', zh: '已省略嵌入字节。' },
  printNoExcerpt: { en: 'No excerpt saved.', zh: '尚未保存摘录。' },
  printSha: { en: 'SHA-256: {sha}', zh: 'SHA-256：{sha}' },
  printSourceTextOmitted: { en: 'Full source text omitted.', zh: '已省略完整来源文本。' },
  printExtractedBy: { en: 'Extracted by {parser} ({method}).', zh: '由 {parser} 提取（{method}）。' },
  printPage: { en: 'Page {page}', zh: '第 {page} 页' },
  printLimitations: { en: 'Limitations', zh: '局限' },
  printLookupQuery: { en: 'Schema {schema} · {text} · limit {limit}', zh: '数据结构 {schema} · {text} · 上限 {limit}' },
  printNoSnapshot: { en: 'No catalog snapshot recorded.', zh: '尚未记录目录快照。' },
  printSnapshotCount: { en: '{count} of {total} records · refreshed {time}', zh: '{count} / {total} 条记录 · 刷新于 {time}' },
  printNoSource: { en: 'No source reference.', zh: '无来源引用。' },
  printVersion: { en: 'version {version}', zh: '版本 {version}' },
  printLocator: { en: 'Locator: {locator}', zh: '定位：{locator}' },
  printOccurrences: { en: '{count} occurrences', zh: '{count} 处出现' },
  printCheckCount: { en: '{count} checks', zh: '{count} 项检查' },
  printDigestOmitted: { en: 'Digest omitted.', zh: '已省略摘要。' },
  printReceiptCount: { en: '{count} registration receipts', zh: '{count} 条登记回执' },
  printRecordCount: { en: '{count} records', zh: '{count} 条记录' },
  printWaiver: { en: 'Waiver: {reason} · {attribution} · {count} missing required cells', zh: '豁免：{reason} · {attribution} · {count} 个必填空缺' },
  printEvidenceCount: { en: '{count} linked evidence blocks', zh: '{count} 个关联证据块' },
  printNoEvidenceLinks: { en: 'No linked evidence.', zh: '无关联证据。' },
  printMaterialSource: { en: 'Catalog {catalog} · record {record} · v{version} · schema {schema} v{schemaRevision}', zh: '目录 {catalog} · 记录 {record} · v{version} · 数据结构 {schema} v{schemaRevision}' },
  printProject: { en: 'Project: {project}', zh: '项目：{project}' },
  printAuthor: { en: 'Author: {author}', zh: '作者：{author}' },
  printTags: { en: 'Tags: {tags}', zh: '标签：{tags}' },
  printReport: { en: 'Report {id}', zh: '报告 {id}' },
  printPhase: { en: 'Phase {phase}', zh: '阶段 {phase}' },
} as const;

const notebookPrintMessages = { ...messages, ...printRecordMessages };
type PrintTranslate = (key: string, vars?: Record<string, string | number>) => string;

function printableRecord(value: unknown): string {
  return JSON.stringify(value, (key, item) => key === 'data' && typeof item === 'string' ? '[Embedded file bytes omitted from print]' : item, 2);
}
function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function textOf(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return displayNumber(value);
  return '';
}
function quantityLabel(value: unknown, unknownLabel: string): string {
  const item = asRecord(value);
  if (!item) return '';
  const amount = item.value === null || item.value === undefined || item.value === '' ? unknownLabel : textOf(item.value);
  return [amount, textOf(item.unit)].filter(Boolean).join(' ');
}
function structureProse(graph: unknown, t: PrintTranslate): string {
  const item = asRecord(graph);
  const atoms = Array.isArray(item?.atoms) ? item.atoms : [];
  const bonds = Array.isArray(item?.bonds) ? item.bonds : [];
  const counts = new Map<string, number>();
  const charges: string[] = [];
  for (const atom of atoms) {
    const row = asRecord(atom);
    const element = textOf(row?.element);
    if (!element) continue;
    counts.set(element, (counts.get(element) ?? 0) + 1);
    const charge = row?.charge;
    if (typeof charge === 'number' && Number.isFinite(charge) && charge !== 0) charges.push(t('printCharge', { element, charge: displayNumber(charge) }));
  }
  const formula = [...counts].map(([element, count]) => count > 1 ? `${element}${count}` : element).join('');
  const orders = { 1: 0, 2: 0, 3: 0 };
  for (const bond of bonds) {
    const order = asRecord(bond)?.order;
    if (order === 1 || order === 2 || order === 3) orders[order] += 1;
  }
  const bondText = [
    orders[1] ? t('printSingleBond', { count: orders[1] }) : '',
    orders[2] ? t('printDoubleBond', { count: orders[2] }) : '',
    orders[3] ? t('printTripleBond', { count: orders[3] }) : '',
  ].filter(Boolean).join(', ') || t('printNoBonds');
  const atomsText = formula ? `${t('printAtoms')}: ${formula}` : t('printNoAtoms');
  const chargeText = charges.length ? ` (${charges.join(', ')})` : '';
  const drawn = atoms.length > 0 || bonds.length > 0;
  return `${atomsText}${chargeText}. ${t('printBonds')}: ${bondText}.${drawn ? ` ${t('printCoordinatesOmitted')}` : ''}`;
}
function moleculeRole(role: unknown, t: PrintTranslate): string {
  if (role === 'reactant') return t('printReactant');
  if (role === 'product') return t('printProduct');
  if (role === 'agent') return t('printAgentRole');
  return textOf(role) || t('printUnnamed');
}
function ingredientList(recipe: Record<string, unknown> | null, actual: Record<string, unknown> | null, t: PrintTranslate): ReactNode {
  const ingredients = Array.isArray(recipe?.ingredients) ? recipe.ingredients : [];
  if (!ingredients.length) return <p>{t('printNoIngredients')}</p>;
  return <ol>{ingredients.map((item, index) => {
    const ingredient = asRecord(item);
    if (!ingredient) return <li key={index}>{t('printUnnamed')}</li>;
    const id = textOf(ingredient.id);
    const measured = id && actual ? actual[id] : undefined;
    return <li key={id || index}>
      <strong>{textOf(ingredient.reference) || t('printUnnamed')}</strong>
      {textOf(ingredient.source) && <> · {t('printSource')}: {textOf(ingredient.source)}</>}
      {' · '}{ingredient.mode === 'qs' ? t('printQsMode') : t('printQuantityMode')}
      {ingredient.mode !== 'qs' && <> · {t('printPlanned')}: {quantityLabel(ingredient.target, t('printUnknownQuantity'))}</>}
      {measured !== undefined && <> · {t('printMeasured')}: {quantityLabel(measured, t('printUnknownQuantity'))}</>}
    </li>;
  })}</ol>;
}
function mixtureRecord(attrs: Record<string, unknown>, t: PrintTranslate): ReactNode {
  const mixture = asRecord(attrs.mixture);
  const draft = asRecord(mixture?.draft);
  const measurements = asRecord(mixture?.measurements);
  const recipes = Array.isArray(mixture?.recipes) ? mixture.recipes : [];
  const records = Array.isArray(mixture?.records) ? mixture.records : [];
  const ingredients = Array.isArray(draft?.ingredients) ? draft.ingredients : [];
  const title = textOf(attrs.label) || textOf(draft?.name) || t('mixturePrep');
  const qs = ingredients.some(item => asRecord(item)?.mode === 'qs');
  return <>
    <h3>{title}</h3>
    <h4>{t('printCurrentRecipe')}</h4>
    <p>{textOf(draft?.name) || t('printUnnamed')}</p>
    {textOf(draft?.output) && <p>{t('printOutput')}: {textOf(draft?.output)}</p>}
    {draft?.target !== undefined && <p>{t('printTarget')}: {quantityLabel(draft.target, t('printUnknownQuantity'))}</p>}
    {textOf(draft?.notes) && <p style={{ whiteSpace: 'pre-wrap' }}>{t('printMethod')}: {textOf(draft?.notes)}</p>}
    {qs && <p>{draft?.additiveVolumes === true ? t('printAdditive') : t('printNoAdditive')}</p>}
    <h4>{t('printIngredients')}</h4>
    {ingredientList(draft, measurements, t)}
    {recipes.length > 0 && <ul>{recipes.map((item, index) => {
      const row = asRecord(item);
      const recipe = asRecord(row?.recipe);
      const revision = textOf(row?.revision) || String(index + 1);
      return <li key={`${revision}-${index}`}>{t('printSavedRecipes', { revision, name: textOf(recipe?.name) || t('printUnnamed') })}</li>;
    })}</ul>}
    <h4>{t('printPreparations')}</h4>
    {records.length ? <ol>{records.map((item, index) => {
      const record = asRecord(item);
      const recipe = asRecord(record?.recipe);
      const revision = textOf(record?.recipeRevision);
      return <li key={textOf(record?.id) || index}>
        <p>{t('printOperator')}: {textOf(record?.operator) || t('printUnnamed')}
          {textOf(record?.recordedAt) && <> · {t('printRecordedAt')}: {textOf(record?.recordedAt)}</>}
          {revision && <> · {t('printRecipeVersion', { revision })}</>}
          {textOf(record?.id) && <> · {textOf(record?.id)}</>}</p>
        {textOf(record?.output) && <p>{t('printOutput')}: {textOf(record?.output)}</p>}
        {textOf(record?.notes) && <p style={{ whiteSpace: 'pre-wrap' }}>{textOf(record?.notes)}</p>}
        {ingredientList(recipe, asRecord(record?.actual), t)}
      </li>;
    })}</ol> : <p>{t('printNoPreparation')}</p>}
  </>;
}
function reactionRecord(attrs: Record<string, unknown>, t: PrintTranslate): ReactNode {
  const reaction = asRecord(attrs.reaction);
  const molecules = Array.isArray(reaction?.molecules) ? reaction.molecules : [];
  const record = asRecord(attrs.record);
  const title = textOf(reaction?.name) || textOf(attrs.label) || t('reactionScheme');
  return <>
    <h3>{title}</h3>
    {textOf(reaction?.notes) && <p style={{ whiteSpace: 'pre-wrap' }}>{textOf(reaction?.notes)}</p>}
    <h4>{t('printMolecules')}</h4>
    {molecules.length ? <ol>{molecules.map((item, index) => {
      const molecule = asRecord(item);
      return <li key={textOf(molecule?.id) || index}>
        <strong>{moleculeRole(molecule?.role, t)}</strong>: {textOf(molecule?.name) || t('printUnnamed')}
        <p>{structureProse(molecule?.graph, t)}</p>
      </li>;
    })}</ol> : <p>{t('printNoMolecules')}</p>}
    <p>{record ? t('printSavedScientific', { id: textOf(record.id) || t('printUnnamed'), revision: textOf(record.revision), savedAt: textOf(record.savedAt) }) : t('printDraftRecord')}</p>
  </>;
}
function chemicalRecord(attrs: Record<string, unknown>, t: PrintTranslate): ReactNode {
  const chemical = asRecord(attrs.chemical);
  const source = asRecord(chemical?.source);
  const title = textOf(chemical?.name) || textOf(attrs.label) || t('chemical');
  const molecule = textOf(source?.moleculeId);
  const id = textOf(source?.id);
  const revision = textOf(source?.revision);
  const provenance = !source ? t('printDrawnLocally')
    : id && revision ? t('printChemicalSource', { molecule: molecule || t('printUnnamed'), id, revision })
    : molecule ? t('printChemicalMolecule', { molecule })
    : t('printDrawnLocally');
  return <><h3>{title}</h3><p>{structureProse(chemical?.graph, t)}</p><p>{provenance}</p></>;
}
function intakeModeLabel(mode: unknown, t: PrintTranslate): string {
  if (mode === 'manual') return t('printModeManual');
  if (mode === 'barcode') return t('printModeBarcode');
  if (mode === 'worklist') return t('printModeWorklist');
  if (mode === 'table') return t('printModeTable');
  if (mode === 'plate') return t('printModePlate');
  return textOf(mode) || t('printUnnamed');
}
function sourceNote(intake: Record<string, unknown>, t: PrintTranslate): string {
  const fileName = textOf(intake.fileName);
  const input = textOf(intake.input);
  if (!input) return fileName;
  const rows = input.split(/\r?\n/).filter(line => line.trim());
  if (input.length > 240 || rows.length > 8) return fileName ? t('printSourceFile', { file: fileName, count: rows.length }) : t('printSourceRows', { count: rows.length });
  return [fileName, input].filter(Boolean).join(' · ');
}
function columnName(record: Record<string, unknown>, id: string): string {
  const columns = Array.isArray(record.columns) ? record.columns : [];
  for (const column of columns) {
    const item = asRecord(column);
    if (item && item.id === id && textOf(item.name)) return textOf(item.name);
  }
  return id;
}
function cellText(value: unknown): string | null {
  if (typeof value === 'string') return value.length > 200 ? null : value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  const cell = asRecord(value);
  if (!cell || cell.type === 'object' || cell.type === 'missing') return null;
  const raw = cell.value;
  if (typeof raw === 'string' && raw.length > 200) return null;
  if (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean') {
    return `${raw}${typeof cell.unit === 'string' && cell.unit ? ` ${cell.unit}` : ''}`;
  }
  return null;
}
function intakeRecord(attrs: Record<string, unknown>, t: PrintTranslate): ReactNode {
  const intake = asRecord(attrs.intake);
  const bindings = Array.isArray(intake?.bindings) ? intake.bindings : [];
  const plate = asRecord(intake?.plateSize);
  const title = textOf(intake?.name) || textOf(attrs.label) || t('sampleIntake');
  const note = intake ? sourceNote(intake, t) : '';
  let omitted = false;
  const items = bindings.map((item, index) => {
    const binding = asRecord(item);
    const source = asRecord(binding?.source);
    const snapshot = asRecord(binding?.snapshot);
    const records = Array.isArray(snapshot?.records) && snapshot.records.length ? snapshot.records : [null];
    return records.map((row, rowIndex) => {
      const record = asRecord(row);
      const values = asRecord(record?.values);
      const fields: string[] = [];
      if (values && record) for (const [key, field] of Object.entries(values)) {
        const shown = cellText(field);
        if (shown === null) { omitted = true; continue; }
        if (shown) fields.push(`${columnName(record, key)}: ${shown}`);
      }
      const well = textOf(source?.well);
      return <li key={`${textOf(record?.id) || index}-${well}-${rowIndex}`}>
        <strong>{textOf(record?.name) || textOf(source?.input) || t('printUnnamed')}</strong>
        {textOf(record?.id) && <> · {textOf(record?.id)}</>}
        {textOf(record?.version) && <> · {t('printRecordVersion', { version: textOf(record?.version) })}</>}
        {well && <> · {t('printWell', { well })}</>}
        {textOf(source?.input) && <> · {textOf(source?.input)}</>}
        {textOf(source?.fileName) && <> · {textOf(source?.fileName)}</>}
        {textOf(snapshot?.catalogId) && <> · {t('printCatalog', { id: textOf(snapshot?.catalogId) })}</>}
        {textOf(record?.registeredAt) && <> · {t('printRecordedAt')}: {textOf(record?.registeredAt)}</>}
        {fields.length > 0 && <p>{fields.join(' · ')}</p>}
      </li>;
    });
  });
  return <>
    <h3>{title}</h3>
    <p>{t('printIntakeMode')}: {intakeModeLabel(intake?.mode, t)}{textOf(intake?.field) && <> · {t('printMatchField')}: {textOf(intake?.field)}</>}</p>
    {textOf(intake?.schemaId) && <p>{t('printSchema')}: {textOf(intake?.schemaId)}</p>}
    {intake?.mode === 'plate' && plate && <p>{t('printPlateSize', { rows: textOf(plate.rows), columns: textOf(plate.columns) })}</p>}
    {note && <p>{note}</p>}
    <h4>{t('printSelectedRecords')}</h4>
    {items.length ? <ul>{items}</ul> : <p>{t('printNoBindings')}</p>}
    {omitted && <p>{t('printBytesOmitted')}</p>}
  </>;
}
function searchRecord(attrs: Record<string, unknown>, t: PrintTranslate): ReactNode {
  const snapshot = asRecord(attrs.snapshot);
  const results = Array.isArray(snapshot?.results) ? snapshot.results : [];
  const mode = attrs.mode === 'live' ? t('printModeLive') : attrs.mode === 'snapshot' ? t('printModeSnapshot') : textOf(attrs.mode);
  return <>
    <h3>{textOf(attrs.label) || t('savedSearch')}</h3>
    <p>{t('printQueryRef', { id: textOf(attrs.queryId) || t('printUnnamed'), revision: textOf(attrs.queryRevision), mode })}</p>
    {snapshot ? <>
      <p>{t('printFrozenResults', { count: results.length, time: textOf(snapshot.refreshedAt) })}</p>
      {results.length ? <ul>{results.map((item, index) => {
        const result = asRecord(item);
        const tags = Array.isArray(result?.tags) ? result.tags.map(textOf).filter(Boolean) : [];
        return <li key={textOf(result?.entryId) || index}>
          <strong>{textOf(result?.title) || t('printUnnamed')}</strong>
          {textOf(result?.revision) && <> · v{textOf(result?.revision)}</>}
          {textOf(result?.entryId) && <> · {textOf(result?.entryId)}</>}
          {textOf(result?.summary) && <p>{textOf(result?.summary)}</p>}
          {tags.length > 0 && <p>{tags.join(' · ')}</p>}
        </li>;
      })}</ul> : <p>{t('printNoFrozenResults')}</p>}
    </> : <p>{t('printLiveQuery')}</p>}
  </>;
}
function scalarText(value: unknown): string | null {
  if (typeof value === 'string') return value.length > 200 ? null : value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  return null;
}
function claimLines(value: unknown, depth = 0): string[] {
  if (depth > 3) return [];
  const item = asRecord(value);
  if (!item) return [];
  const lines = ['status', 'outcome', 'reason', 'claim', 'summary', 'title', 'name'].flatMap(key => {
    const text = textOf(item[key]);
    return text && text.length <= 500 ? [text] : [];
  });
  for (const nested of [item.result, item.dataset]) if (nested && typeof nested === 'object') lines.push(...claimLines(nested, depth + 1));
  return [...new Set(lines)];
}
function canvasRecord(attrs: Record<string, unknown>, t: PrintTranslate): ReactNode {
  const binding = asRecord(attrs.binding);
  const title = textOf(attrs.label) || t('appCanvas');
  if (!binding) return <><h3>{title}</h3><p>{t('printUnboundCanvas')}</p></>;
  const inputs = asRecord(binding.inputs);
  const inputLines: string[] = [];
  let omitted = binding.receipt !== undefined && binding.receipt !== null;
  if (inputs) for (const [key, value] of Object.entries(inputs)) {
    const shown = scalarText(value);
    if (shown === null) { omitted = true; continue; }
    if (shown) inputLines.push(`${key}: ${shown}`);
  }
  const claims = claimLines(binding.receipt);
  const declaration = textOf(binding.declaration);
  return <>
    <h3>{title}</h3>
    <p>{t('printCanvasPath', { app: textOf(binding.app), panel: textOf(binding.panel) })}</p>
    {textOf(binding.view) && <p>{t('printCanvasView', { view: textOf(binding.view) })}</p>}
    {textOf(binding.id) && <p>{t('printBindingId', { id: textOf(binding.id) })}</p>}
    {declaration && <p>{t('printDeclarationSha', { sha: declaration })}</p>}
    {inputLines.length > 0 && <><h4>{t('printInputs')}</h4><ul>{inputLines.map((line, index) => <li key={`${index}-${line}`}>{line}</li>)}</ul></>}
    {claims.length > 0 && <><h4>{t('printRetainedResult')}</h4><ul>{claims.map((line, index) => <li key={`${index}-${line}`}>{line}</li>)}</ul></>}
    {omitted && <p>{t('printBytesOmitted')}</p>}
  </>;
}
function excerptPages(extraction: unknown): number[] {
  const segments = Array.isArray(asRecord(extraction)?.segments) ? asRecord(extraction)!.segments as unknown[] : [];
  const pages: number[] = [];
  for (const segment of segments) {
    const page = asRecord(segment)?.page;
    if (typeof page === 'number' && Number.isInteger(page) && !pages.includes(page)) pages.push(page);
  }
  return pages;
}
function excerptHasRegion(extraction: unknown): boolean {
  const segments = Array.isArray(asRecord(extraction)?.segments) ? asRecord(extraction)!.segments as unknown[] : [];
  return segments.some(segment => asRecord(segment)?.region);
}
function excerptRecord(attrs: Record<string, unknown>, t: PrintTranslate): ReactNode {
  const excerpt = asRecord(attrs.excerpt);
  const source = asRecord(excerpt?.source);
  const title = textOf(attrs.label) || textOf(source?.filename) || t('sourceExcerpt');
  if (!excerpt) return <><h3>{title}</h3><p>{t('printNoExcerpt')}</p></>;
  const quote = textOf(excerpt.quote);
  const retained = textOf(excerpt.text);
  const passage = quote || (retained.length <= 500 ? retained : '');
  const extraction = asRecord(excerpt.extraction);
  const parser = asRecord(extraction?.parser);
  const limitations = Array.isArray(extraction?.limitations) ? extraction.limitations.map(textOf).filter(item => item.length > 0 && item.length <= 500) : [];
  const sha = textOf(source?.sha256);
  return <>
    <h3>{title}</h3>
    {passage && <blockquote>{passage}</blockquote>}
    {[textOf(source?.filename), textOf(source?.mime)].some(Boolean) && <p>{[textOf(source?.filename), textOf(source?.mime)].filter(Boolean).join(' · ')}</p>}
    {excerptPages(excerpt.extraction).length > 0 && <p>{excerptPages(excerpt.extraction).map(page => t('printPage', { page })).join(' · ')}</p>}
    {extraction && <p>{t('printExtractedBy', { parser: textOf(parser?.name) || t('printUnnamed'), method: textOf(extraction.method) || t('printUnnamed') })}</p>}
    {limitations.length > 0 && <p>{t('printLimitations')}: {limitations.join(' ')}</p>}
    {sha && <p>{t('printSha', { sha })}</p>}
    {retained && retained !== passage && <p>{t('printSourceTextOmitted')}</p>}
    {extraction && <p>{t('printBytesOmitted')}</p>}
    {excerptHasRegion(excerpt.extraction) && <p>{t('printCoordinatesOmitted')}</p>}
  </>;
}
const digestKeys = ['inputHash', 'fileDigest', 'exportSha256', 'specHash', 'inputDigest', 'paperContentDigest', 'sha256', 'textSha256', 'observationId'];
function markedOmission(value: unknown): { digest: boolean; coordinates: boolean; bytes: boolean } {
  const item = asRecord(value);
  if (!item) return { digest: false, coordinates: false, bytes: false };
  const digest = digestKeys.some(key => textOf(item[key]).length > 0) || markedOmission(item.waiver).digest;
  const coordinates = ['x', 'y', 'width', 'height'].some(key => typeof item[key] === 'number') || item.region != null;
  const bytes = typeof item.data === 'string' || typeof item.bytes === 'string';
  return { digest, coordinates, bytes };
}
function shortIdentity(value: unknown): string {
  const text = textOf(value);
  return /^[a-f0-9]{64}$/i.test(text) ? `${text.slice(0, 12)}…` : text;
}
function capped(value: unknown, limit = 500): string {
  const text = textOf(value);
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}
function referenceLine(source: Record<string, unknown> | null, t: PrintTranslate): string {
  if (!source) return t('printNoSource');
  const identity = [textOf(source.app), textOf(source.kind)].filter(Boolean).join(' / ');
  const parts = [
    identity,
    textOf(source.id),
    textOf(source.version) ? t('printVersion', { version: textOf(source.version) }) : '',
    textOf(source.locator) ? t('printLocator', { locator: capped(source.locator) }) : '',
  ].filter(Boolean);
  return parts.join(' · ') || t('printNoSource');
}
function omissionNote(flags: { digest: boolean; coordinates: boolean; bytes: boolean }, t: PrintTranslate): ReactNode {
  return <>
    {flags.digest && <p>{t('printDigestOmitted')}</p>}
    {flags.coordinates && <p>{t('printCoordinatesOmitted')}</p>}
    {flags.bytes && <p>{t('printBytesOmitted')}</p>}
  </>;
}
function referenceRecord(kind: string, attrs: Record<string, unknown>, t: PrintTranslate): ReactNode {
  const source = asRecord(attrs.source);
  const snapshot = asRecord(attrs.snapshot);
  const title = textOf(attrs.label) || (kind === 'experiment' ? t('experiment') : t('evidence'));
  const lines: string[] = [];
  const flags = snapshot ? markedOmission(snapshot) : { digest: false, coordinates: false, bytes: false };
  if (snapshot?.kind === 'paper-report') {
    const quote = capped(snapshot.quote);
    if (quote) lines.push(quote);
    if (typeof snapshot.page === 'number' && Number.isFinite(snapshot.page)) lines.push(t('printPage', { page: displayNumber(snapshot.page) }));
    if (textOf(snapshot.reportId)) lines.push(t('printReport', { id: shortIdentity(snapshot.reportId) }));
    if (typeof snapshot.occurrences === 'number' && snapshot.occurrences > 1) lines.push(t('printOccurrences', { count: snapshot.occurrences }));
  } else if (snapshot?.kind === 'control-receipt') {
    if (textOf(snapshot.verdict)) lines.push(textOf(snapshot.verdict));
    if (textOf(snapshot.phase)) lines.push(t('printPhase', { phase: textOf(snapshot.phase) }));
    if (textOf(snapshot.candidateId)) lines.push(textOf(snapshot.candidateId));
    const checks = Array.isArray(snapshot.checks) ? snapshot.checks : [];
    lines.push(t('printCheckCount', { count: checks.length }));
    for (const item of checks) {
      const check = asRecord(item);
      if (!check) continue;
      const claim = [textOf(check.name), textOf(check.verdict), capped(check.message, 500)].filter(Boolean).join(' · ');
      const bounds = [textOf(check.actual) && `actual ${textOf(check.actual)}`, textOf(check.limit) && `limit ${textOf(check.limit)}`].filter(Boolean).join(' · ');
      if (claim || bounds) lines.push([claim, bounds].filter(Boolean).join(' · '));
    }
  } else if (snapshot) {
    const name = textOf(snapshot.name) || textOf(snapshot.title) || textOf(snapshot.kind);
    const claim = capped(snapshot.claim) || capped(snapshot.quote) || capped(snapshot.summary);
    if (name) lines.push(name);
    if (claim && claim !== name) lines.push(claim);
  }
  return <>
    <h3>{title}</h3>
    <p>{referenceLine(source, t)}</p>
    {lines.length > 0 && <ul>{lines.map((line, index) => <li key={`${index}-${line}`}>{line}</li>)}</ul>}
    {omissionNote(flags, t)}
  </>;
}
function lookupRecord(attrs: Record<string, unknown>, t: PrintTranslate): ReactNode {
  const query = asRecord(attrs.query);
  const snapshot = asRecord(attrs.snapshot);
  const records = Array.isArray(snapshot?.records) ? snapshot.records : [];
  let bytes = false;
  let digest = false;
  return <>
    <h3>{textOf(attrs.label) || t('lookupTable')}</h3>
    <p>{t('printLookupQuery', { schema: textOf(query?.schemaId) || '*', text: textOf(query?.text) || '*', limit: textOf(query?.limit) || t('printUnnamed') })}</p>
    {!snapshot ? <p>{t('printNoSnapshot')}</p> : <>
      <p>{t('printSnapshotCount', { count: records.length, total: textOf(snapshot.total) || String(records.length), time: textOf(snapshot.refreshedAt) || t('printUnnamed') })}</p>
      {textOf(snapshot.catalogId) && <p>{t('printCatalog', { id: textOf(snapshot.catalogId) })}</p>}
      {records.length ? <ul>{records.map((item, index) => {
        const record = asRecord(item);
        if (!record) return <li key={index}>{t('printUnnamed')}</li>;
        const values = asRecord(record.values);
        const fields: string[] = [];
        if (values) for (const [key, field] of Object.entries(values)) {
          const shown = cellText(field);
          if (shown === null) { bytes = true; continue; }
          if (shown) fields.push(`${columnName(record, key)}: ${shown}`);
        }
        if (markedOmission(record.waiver).digest) digest = true;
        return <li key={textOf(record.id) || index}>
          <strong>{textOf(record.name) || t('printUnnamed')}</strong>
          {textOf(record.id) && <> · {textOf(record.id)}</>}
          {textOf(record.version) && <> · {t('printRecordVersion', { version: textOf(record.version) })}</>}
          {textOf(record.registeredAt) && <> · {t('printRecordedAt')}: {textOf(record.registeredAt)}</>}
          {fields.length > 0 && <p>{fields.join(' · ')}</p>}
        </li>;
      })}</ul> : <p>{t('printNoFrozenResults')}</p>}
    </>}
    {bytes && <p>{t('printBytesOmitted')}</p>}
    {digest && <p>{t('printDigestOmitted')}</p>}
  </>;
}
function receiptRecord(receipts: unknown, t: PrintTranslate): ReactNode {
  const items = Array.isArray(receipts) ? receipts : [];
  if (!items.length) return null;
  let digest = false;
  return <>
    <p>{t('printReceiptCount', { count: items.length })}</p>
    <ul>{items.map((item, index) => {
      const receipt = asRecord(item);
      if (!receipt) return <li key={index}>{t('printUnnamed')}</li>;
      if (markedOmission(receipt).digest) digest = true;
      const records = Array.isArray(receipt.records) ? receipt.records : [];
      const waiver = asRecord(receipt.waiver);
      const links = records.map(row => {
        const record = asRecord(row);
        return record ? `${textOf(record.rowId)} → ${textOf(record.recordId)} v${textOf(record.version)}` : '';
      }).filter(Boolean);
      return <li key={textOf(receipt.submissionId) || index}>
        <p>{[textOf(receipt.registeredAt), textOf(receipt.catalogId) && t('printCatalog', { id: textOf(receipt.catalogId) }), textOf(receipt.schemaId) && `${t('printSchema')}: ${textOf(receipt.schemaId)}`].filter(Boolean).join(' · ')}</p>
        <p>{t('printRecordCount', { count: records.length })}{links.length > 0 && <> · {links.join(' · ')}</>}</p>
        {waiver && <p>{t('printWaiver', { reason: textOf(waiver.reason) || t('printUnnamed'), attribution: textOf(waiver.attribution) || t('printUnnamed'), count: Array.isArray(waiver.issues) ? waiver.issues.length : 0 })}</p>}
      </li>;
    })}</ul>
    {digest && <p>{t('printDigestOmitted')}</p>}
  </>;
}
function metadataRecord(metadata: unknown, t: PrintTranslate): ReactNode {
  const item = asRecord(metadata);
  if (!item) return null;
  const tags = Array.isArray(item.tags) ? item.tags.map(textOf).filter(Boolean) : [];
  return <>
    {textOf(item.project) && <p>{t('printProject', { project: textOf(item.project) })}</p>}
    {textOf(item.author) && <p>{t('printAuthor', { author: textOf(item.author) })}</p>}
    {tags.length > 0 && <p>{t('printTags', { tags: tags.join(' · ') })}</p>}
  </>;
}
function materialSourceLine(source: NotebookMaterial['source'], t: PrintTranslate): string {
  const item = asRecord(source);
  if (!item) return '';
  return t('printMaterialSource', {
    catalog: textOf(item.catalogId) || t('printUnnamed'),
    record: textOf(item.recordId) || t('printUnnamed'),
    version: textOf(item.version),
    schema: textOf(item.schemaId) || t('printUnnamed'),
    schemaRevision: textOf(item.schemaRevision),
  });
}
function rootWorksheets(root: NotebookNode): NotebookWorksheet[] {
  const sheets: NotebookWorksheet[] = [];
  const visit = (node: NotebookNode) => {
    if (node.type === 'spreadsheet') sheets.push({ id: String(node.attrs!.blockId), name: String(node.attrs?.label || ''), sheet: node.attrs!.sheet as Spreadsheet });
    node.content?.forEach(visit);
  };
  visit(root);
  return sheets;
}
function RichPrint({ root, includeInputs, contextRoot = root }: { root: NotebookNode; includeInputs: boolean; contextRoot?: NotebookNode }) {
  const { t } = useAppI18n(notebookPrintMessages);
  const calculated = calculateNotebookWorksheets(rootWorksheets(contextRoot));
  const nodeView = (node: NotebookNode, key: number): ReactNode => {
    const attrs = node.attrs ?? {}, content = node.content?.map(nodeView);
    switch (node.type) {
      case 'namedReference': return <section key={key}><h3>{String(attrs.name)}</h3><p>{String(attrs.notes)}</p><small>{t('printEntryReference')}</small></section>;
      case 'doc': return <Fragment key={key}>{content}</Fragment>;
      case 'text': {
        let result: ReactNode = node.text;
        for (const mark of node.marks ?? []) {
          if (mark.type === 'bold') result = <strong>{result}</strong>;
          else if (mark.type === 'italic') result = <em>{result}</em>;
          else if (mark.type === 'underline') result = <u>{result}</u>;
          else if (mark.type === 'strike') result = <s>{result}</s>;
          else if (mark.type === 'code') result = <code>{result}</code>;
          else if (mark.type === 'subscript') result = <sub>{result}</sub>;
          else if (mark.type === 'superscript') result = <sup>{result}</sup>;
          else if (mark.type === 'link') result = <>{result} ({String(mark.attrs?.href ?? '')})</>;
        }
        return <Fragment key={key}>{result}</Fragment>;
      }
      case 'paragraph': return <p key={key}>{content ?? <br />}</p>;
      case 'heading': return <h3 key={key}>{content}</h3>;
      case 'section': return <section key={key}><h2>{String(attrs.label || t('section'))}</h2>{!!attrs.date && <p>{String(attrs.date)}</p>}{content}</section>;
      case 'blockquote': return <blockquote key={key}>{content}</blockquote>;
      case 'bulletList': case 'taskList': return <ul key={key}>{content}</ul>;
      case 'orderedList': return <ol key={key} start={typeof attrs.start === 'number' ? attrs.start : 1}>{content}</ol>;
      case 'listItem': return <li key={key}>{content}</li>;
      case 'taskItem': return <li key={key}>{attrs.checked ? '☑' : '☐'} {content}</li>;
      case 'hardBreak': return <br key={key} />;
      case 'horizontalRule': return <hr key={key} />;
      case 'codeBlock': return <pre key={key}>{content}</pre>;
      case 'referenceMention': return <span key={key}>{textOf(attrs.label) || t('printUnnamed')} · {referenceLine(asRecord(attrs.source), t)}</span>;
      case 'spreadsheet': {
        const sheet = attrs.sheet as Spreadsheet, calculation = calculated.get(String(attrs.blockId))!;
        const { name, values, ambiguous } = calculation;
        const annotations = attrs.annotations as Record<string, CellAnnotation> | undefined, formats = attrs.formats as Record<string, CellFormat> | undefined;
        return <figure key={key}><figcaption>{name}</figcaption>{ambiguous && <p>{t('printDuplicateWorksheet')}</p>}<table><thead><tr><th>Cell</th>{Array.from({ length: sheet.columns }, (_, c) => <th key={c}>{cellAddress(c, 0).replace(/1$/, '')}</th>)}</tr></thead>
          <tbody>{Array.from({ length: sheet.rows }, (_, r) => <tr key={r}><th>{r + 1}</th>{Array.from({ length: sheet.columns }, (_, c) => { const address = cellAddress(c, r), raw = sheet.cells[address] ?? ''; return <td key={c} style={{ textAlign: formats?.[address]?.align, fontWeight: formats?.[address]?.bold ? 'bold' : undefined, fontStyle: formats?.[address]?.italic ? 'italic' : undefined }}>{formatCellValue(values[address], formats?.[address])}{annotations?.[address]?.unit && <small>{annotations[address].unit}</small>}{!!annotations?.[address]?.evidenceIds.length && <small>{t('evidence')}: {annotations[address].evidenceIds.join(', ')}</small>}{includeInputs && raw.startsWith('=') && <small>{raw}</small>}</td>; })}</tr>)}</tbody></table>
          <small>{t('printCalculatedLocally')}</small>{!!(attrs.merges as unknown[])?.length && <small>{t('printStoredCells')}</small>}</figure>;
      }
      case 'registrationTable': case 'inputTable': {
        const table = attrs.table as StructuredTableDraft;
        return <figure key={key}><figcaption>{table.name || node.type}</figcaption><table><thead><tr>{table.schema.columns.map(column => <th key={column.id}>{column.name} ({column.type})</th>)}</tr></thead><tbody>{table.rows.map(row => <tr key={row.id}>{table.schema.columns.map(column => <td key={column.id}>{row.cells[column.id] ?? ''}</td>)}</tr>)}</tbody></table>
          {receiptRecord(attrs.receipts, t)}</figure>;
      }
      case 'attachment': return <figure key={key}><figcaption>{String(attrs.filename)} {String(attrs.caption || '')}</figcaption>{/^image\/(png|jpeg|gif|webp)$/.test(String(attrs.mime)) && typeof attrs.data === 'string' ? <img src={`data:${attrs.mime};base64,${attrs.data}`} alt={String(attrs.caption || attrs.filename)} /> : <p>{t('printAttachmentBytes')}</p>}<small>SHA-256: {String(attrs.sha256)}</small></figure>;
      case 'finding': {
        const ids = Array.isArray(attrs.evidenceIds) ? attrs.evidenceIds.map(textOf).filter(Boolean) : [];
        return <section key={key}><h3>{t('finding')}</h3><p>{String(attrs.claim || '')}</p><p>{String(attrs.limitations || '')}</p>
          <p>{ids.length ? t('printEvidenceCount', { count: ids.length }) : t('printNoEvidenceLinks')}</p>
          {ids.length > 0 && <ul>{ids.map(id => <li key={id}>{id}</li>)}</ul>}</section>;
      }
      case 'lookupTable': return <section key={key}>{lookupRecord(attrs, t)}{content}</section>;
      case 'evidence': case 'experiment': return <section key={key}>{referenceRecord(node.type, attrs, t)}{content}</section>;
      case 'mixturePrep': return <section key={key}>{mixtureRecord(attrs, t)}{content}</section>;
      case 'reactionScheme': return <section key={key}>{reactionRecord(attrs, t)}{content}</section>;
      case 'chemical': return <section key={key}>{chemicalRecord(attrs, t)}{content}</section>;
      case 'sampleIntake': return <section key={key}>{intakeRecord(attrs, t)}{content}</section>;
      case 'savedSearch': return <section key={key}>{searchRecord(attrs, t)}{content}</section>;
      case 'appCanvas': return <section key={key}>{canvasRecord(attrs, t)}{content}</section>;
      case 'sourceExcerpt': return <section key={key}>{excerptRecord(attrs, t)}{content}</section>;
      default: return <section key={key}><h3>{String(attrs.label || node.type)}</h3><p>{t('printRecordedStructured')}</p><pre>{printableRecord(attrs)}</pre>{content}</section>;
    }
  };
  return <>{nodeView(root, 0)}</>;
}
export function visiblePrintSectionLabel(section: NotebookPrintSection, translate: (key: 'printNotesSection' | 'printUntitledSection' | 'printUntitledProcedure') => string): string {
  if (section.label.trim()) return section.label;
  if (section.kind === 'notes') return translate('printNotesSection');
  return translate(section.kind === 'procedure' ? 'printUntitledProcedure' : 'printUntitledSection');
}
export function NotebookPrintContent({ document, settings, entryId, revision, dirty, preparedAt }: {
  document: NotebookDocument; settings: NotebookPrintSettings; entryId: string; revision: number; dirty: boolean; preparedAt: string;
}) {
  const { t } = useAppI18n(notebookPrintMessages);
  const selected = new Set(settings.sections);
  const materials = (items: NotebookMaterial[]): ReactNode => <ul>{items.map(item => <li key={item.id}><strong>{item.name}</strong> {item.quantity}{item.source && <p>{materialSourceLine(item.source, t)}</p>}{item.content && <RichPrint root={item.content} includeInputs={settings.includeInputs} />}{item.children && materials(item.children)}</li>)}</ul>;
  // Keep original Notes order and its full calculation context even when only one section is printed.
  const filtered = { ...document.content, content: document.content.content.filter(node => selected.has(node.type === 'section' ? `section:${node.attrs!.blockId}` : 'notes')) };
  const sectionLabels = notebookPrintSections(document).filter(section => selected.has(section.id)).map(section => visiblePrintSectionLabel(section, t)).join(' · ');
  return <article className="notebook-print-document"><h1>{document.title}</h1><p>{dirty ? t('printUnsavedDraft') : t('printSavedRevision', { revision })}</p>
    {settings.includeMetadata && <header><p>{t('printEntryMeta', { entryId, revision })}</p><p>{t('printPreparedAt', { preparedAt })}</p><p>{settings.paper} · {settings.orientation} · {settings.marginMm} mm</p>{metadataRecord(document.metadata, t)}</header>}
    <RichPrint root={filtered} contextRoot={document.content} includeInputs={settings.includeInputs} />
    {(document.procedures ?? []).filter(procedure => selected.has(`procedure:${procedure.id}`)).map(procedure => <section key={procedure.id}><h2>{procedure.title}</h2>{procedure.introduction ? <RichPrint root={procedure.introduction} includeInputs={settings.includeInputs} /> : <p>{procedure.description}</p>}
      {!!procedure.materials.length && <><h3>{t('printMaterials')}</h3>{materials(procedure.materials)}</>}
      <ol>{procedure.steps.map(step => <li key={step.id}><p>{step.completed ? '☑' : '☐'} {step.kind ?? 'step'}{step.critical ? ` · ${t('printCritical')}` : ''}{step.pause ? ` · ${t('printPause')}` : ''}{step.minutes !== null ? ` · ${t('printMinutesPlanned', { minutes: step.minutes })}` : ''}</p>
        {step.content ? <RichPrint root={step.content} includeInputs={settings.includeInputs} /> : <p>{step.text}</p>}{step.timer && <p>{t('printRecordedTimer', { elapsedMs: step.timer.elapsedMs, running: step.timer.startedAt !== null ? t('printTimerRunning') : '' })}</p>}</li>)}</ol></section>)}
    <footer>{t('printFooter', { sections: sectionLabels })}</footer>
  </article>;
}
