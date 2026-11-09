import type { JSONContent } from '@tiptap/core';
import { cellAddress } from '@pero/notebook/spreadsheet';

export interface SciencePanelProps { onSnapshot(title: string, snapshot: unknown, rows?: string[][]): boolean; getContent(): string }

/** Snapshots are inert text plus fresh worksheets; never interpreted formulas or existing cells. */
export function scienceSnapshotNodes(title: string, snapshot: unknown, rows?: string[][], existingNames: string[] = []): JSONContent[] {
  const nodes: JSONContent[] = [
    { type: 'paragraph', content: [{ type: 'text', text: title, marks: [{ type: 'bold' }] }] },
    { type: 'codeBlock', attrs: { language: 'json' }, content: [{ type: 'text', text: JSON.stringify(snapshot, null, 2) }] },
  ];
  const used = new Set(existingNames.map(name => name.toLowerCase()));
  if (rows?.length) for (let offset = 0; offset < rows.length; offset += 199) {
    const page = rows.slice(offset, offset + 199), columns = page[0].length;
    const cells: Record<string, string> = {};
    Array.from({ length: columns }, (_, c) => `Field ${c + 1}`).forEach((value, c) => { cells[cellAddress(c, 0)] = `'${value}`; });
    page.forEach((row, r) => row.forEach((value, c) => { cells[cellAddress(c, r + 1)] = `'${value}`; }));
    let number = 1, label = `Sheet${number}`;
    while (used.has(label.toLowerCase())) label = `Sheet${++number}`;
    used.add(label.toLowerCase());
    nodes.push({ type: 'spreadsheet', attrs: { label, sheet: { rows: page.length + 1, columns, cells }, annotations: {} } });
  }
  return nodes;
}

export const scienceMessages = {
  formula: { en: 'Formula workbench', zh: '公式工作台' },
  ai: { en: 'Generate with Host Agent', zh: '使用 Host Agent 生成' },
  tools: { en: 'Scientific tools', zh: '科研工具' }, close: { en: 'Close', zh: '关闭' },
  scope: { en: 'Local calculations and human review. Results are not measured evidence or owner verification.', zh: '本地计算与人工复核。结果不等于实测证据或来源方验证。' },
  sequence: { en: 'Sequence analysis', zh: '序列分析' }, chemistry: { en: 'Reaction calculations', zh: '反应计算' }, plate: { en: 'Plate layout', zh: '孔板布局' }, review: { en: 'Candidate review', zh: '候选数据复核' }, checks: { en: 'Recorded checks', zh: '已记录检查' }, capabilities: { en: 'Methods and limits', zh: '方法与边界' },
  insert: { en: 'Insert snapshot', zh: '插入快照' }, inserted: { en: 'Snapshot inserted as new content.', zh: '已将快照插入为新内容。' },
  stale: { en: 'The notebook changed while these tools were open. Close and reopen to review the current draft.', zh: '工具打开期间笔记已变化。请关闭后重新打开，复核当前草稿。' },
  duplicate: { en: 'This snapshot has already been inserted.', zh: '此快照已经插入。' },
  failure: { en: 'Could not complete this action:', zh: '无法完成此操作：' },
  rawSequence: { en: 'Sequence (IUPAC, up to 20,000 nt)', zh: '序列（IUPAC，最多 20,000 nt）' }, alphabet: { en: 'Alphabet', zh: '字母表' }, code: { en: 'Genetic code', zh: '遗传密码表' }, frame: { en: 'Reading frame', zh: '阅读框' },
  reverse: { en: 'Translate reverse complement', zh: '翻译反向互补序列' }, circular: { en: 'Circular ORF search', zh: '环状开放阅读框搜索' }, method: { en: 'Tm method', zh: '熔解温度方法' },
  oligo: { en: 'Total strand concentration (nM)', zh: '总链浓度（nM）' }, sodium: { en: 'Monovalent salt (mM)', zh: '单价盐（mM）' }, magnesium: { en: 'Magnesium (mM)', zh: '镁（mM）' }, dntp: { en: 'dNTP (mM)', zh: 'dNTP（mM）' },
  calculate: { en: 'Calculate', zh: '计算' }, details: { en: 'Input, result and method details', zh: '输入、结果与方法详情' },
  removed: { en: 'Unsupported characters were removed. Review the sanitized sequence and explicitly accept the removals before inserting.', zh: '已移除不支持的字符。插入前请复核清理后的序列并确认这些移除。' },
  acknowledgeRemoval: { en: 'I reviewed the removed characters', zh: '我已复核被移除的字符' },
  sequenceLimits: { en: '27 NCBI codes. Ambiguous codons resolve only when all possibilities agree. Standard ATG/stop ORFs search both strands, at most one circular revolution. Tm estimates use the named published parameters and declared salt approximation, not recovered algorithms.', zh: '支持 27 种 NCBI 密码表。歧义密码子仅在所有可能结果一致时解析。标准 ATG/终止密码子 ORF 搜索双链，环状最多一圈。Tm 使用所标注的公开参数及盐浓度近似，不使用恢复的算法。' },
  complement: { en: 'Complement', zh: '互补序列' }, reverseComplement: { en: 'Reverse complement', zh: '反向互补序列' }, translation: { en: 'Translation', zh: '翻译结果' },
  target: { en: 'Solve for', zh: '求解目标' }, figures: { en: 'Significant figures', zh: '有效数字' },
  mass: { en: 'Mass', zh: '质量' }, amount: { en: 'Amount', zh: '物质的量' }, volume: { en: 'Volume', zh: '体积' }, equivalence: { en: 'Equivalents', zh: '当量' }, formulaWeight: { en: 'Formula weight', zh: '式量' }, purity: { en: 'Purity', zh: '纯度' }, molarity: { en: 'Molarity', zh: '摩尔浓度' }, density: { en: 'Density', zh: '密度' }, limitingAmount: { en: 'Limiting-reactant amount', zh: '限制反应物的量' }, limitingEquivalence: { en: 'Limiting-reactant equivalents', zh: '限制反应物当量' }, unit: { en: 'Unit', zh: '单位' },
  chemistryLimits: { en: 'Positive finite quantities only. Blank means unknown. Supply purity explicitly for mass-to-amount calculations. Consistent equations can be chained; contradictory inputs are rejected. Floating-point arithmetic, not arbitrary precision or a reaction execution.', zh: '仅接受正有限量。留空表示未知。质量换算物质的量时需明确纯度。可串联相容方程；矛盾输入会被拒绝。采用浮点运算，不是任意精度计算或反应执行。' },
  missing: { en: 'More inputs are required.', zh: '还需要更多输入。' },
  size: { en: 'Plate size', zh: '孔板尺寸' }, direction: { en: 'Traversal order', zh: '遍历顺序' }, across: { en: 'Across rows', zh: '逐行' }, down: { en: 'Down columns', zh: '逐列' }, group: { en: 'Group name', zh: '组名' }, additive: { en: 'Add to existing groups', zh: '添加到现有组' },
  range: { en: 'Well range (for example A1:B3)', zh: '孔范围（例如 A1:B3）' }, selectRange: { en: 'Select range', zh: '选择范围' }, selectAll: { en: 'Select all', zh: '全选' }, clearSelection: { en: 'Clear selection', zh: '取消选择' }, assign: { en: 'Assign selected wells', zh: '分配选中孔' }, clearWells: { en: 'Clear selected wells', zh: '清空选中孔' },
  plateHint: { en: 'Click a well, Shift-click to select a rectangle, or use the range field. Ctrl/Command-click toggles a well. Layout metadata only, no instrument or sample inventory is connected.', zh: '点击孔，按住 Shift 点击选择矩形，或填写范围。Ctrl/Command 点击切换单孔选择。仅记录布局元数据，未连接仪器或样本库存。' },
  resize: { en: 'Changing the plate size clears this unsaved layout.', zh: '更改孔板尺寸会清空此未保存布局。' },
  external: { en: 'External JSON', zh: '外部 JSON' }, load: { en: 'Load and begin review', zh: '载入并开始复核' }, import: { en: 'Import JSON file', zh: '导入 JSON 文件' }, noInput: { en: 'Paste or import a recorded response to begin. No model request is made.', zh: '粘贴或导入已记录的响应以开始。不会调用模型。' },
  run: { en: 'Primary run', zh: '主运行' }, table: { en: 'Table', zh: '表格' }, differences: { en: 'Only differences', zh: '仅显示差异' }, policy: { en: 'Column policy', zh: '列策略' }, writable: { en: 'Writable', zh: '可编辑' }, protected: { en: 'Protected', zh: '受保护' }, 'read-only': { en: 'Read-only', zh: '只读' }, computed: { en: 'Computed', zh: '计算列' }, snapshot: { en: 'Snapshot', zh: '快照列' }, converted: { en: 'Converted', zh: '转换列' },
  row: { en: 'Row', zh: '行' }, field: { en: 'Field', zh: '字段' }, failed: { en: 'Failed run', zh: '运行失败' }, noRows: { en: 'No rows in this view.', zh: '当前视图无行。' }, resetEdits: { en: 'Reset edits', zh: '重置编辑' },
  reviewAck: { en: 'I reviewed these candidates and accept them as new content, not verified scientific results.', zh: '我已复核这些候选数据，并接受其作为新内容，不视为已验证科研结果。' },
  reviewLimits: { en: 'Comparisons use row position and exact text, never an imported “verified” flag. Failed runs, missing cells and extra rows remain visible. Same-family agreement is not independent validation. Values are inserted as literal text in new worksheets.', zh: '按行位置及精确文本比较，不信任导入的“已验证”标记。保留失败运行、缺失单元格及额外行。同族模型的一致性不等于独立验证。值作为字面文本插入新工作表。' },
  extraRows: { en: 'Other runs and additional rows', zh: '其他运行及额外行' }, schema: { en: 'Accepted JSON format', zh: '接受的 JSON 格式' },
  checkAck: { en: 'I acknowledge the source and its reported limits.', zh: '我已知悉来源及其报告的局限。' }, acknowledged: { en: 'Acknowledged', zh: '已知悉' }, usefulness: { en: 'Usefulness', zh: '实用性' }, unmarked: { en: 'Unmarked', zh: '未标记' }, useful: { en: 'Useful', zh: '有用' }, 'not-useful': { en: 'Not useful', zh: '无用' },
  complete: { en: 'Imported complete report', zh: '已导入完整报告' }, partial: { en: 'Partial report', zh: '部分报告' }, error: { en: 'Source reported an error', zh: '来源报告了错误' }, empty: { en: 'No recorded checks', zh: '无已记录检查' },
  checksLimits: { en: 'Imported suggestions only. Acknowledgment does not mark scientific verification or completion. Recorded version and timestamp belong to the source, not this notebook.', zh: '仅为导入的建议。知悉不等于科学验证或完成。所记录的版本和时间属于来源，不是当前笔记。' },
} as const;
