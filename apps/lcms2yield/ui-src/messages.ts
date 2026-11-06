import type { AppMessages } from '@pero/app-sdk';

export const messages: AppMessages = {
  title: { en: 'LCMS2Yield', zh: 'LCMS2Yield' },
  loading: { en: 'Loading the released reaction table…', zh: '正在读取已发布的反应表…' },
  loadFailed: { en: 'Could not read the reaction table.', zh: '暂时无法读取反应表。' },
  retry: { en: 'Retry', zh: '重试' },
  details: { en: 'Error details', zh: '错误详情' },
  unavailable: { en: 'LCMS2Yield could not load.', zh: 'LCMS2Yield 暂时无法加载。' },
  reload: { en: 'Reload', zh: '重新加载' },
  yieldTable: { en: 'Released yield table', zh: '发布产率表' },
  prediction: { en: 'Weight rerun', zh: '权重复跑' },
  paper: { en: 'Paper conclusion', zh: '论文结论' },
  pass: { en: 'Matches 4.74', zh: '与 4.74 一致' },
  fail: { en: 'Does not match', zh: '不一致' },
  unrun: { en: 'Not run', zh: '尚未运行' },
  inconclusive: { en: 'Unsettled', zh: '未决' },
  chart: { en: 'Experimental yield against the released prediction', zh: '实验产率对发布预测产率' },
  chartHelp: { en: 'Each point is one reaction row. The diagonal is exact agreement. Axes are yield percent, converted from the released fractions.', zh: '每个点是一行反应。对角线表示完全一致。坐标是产率百分数，由发布表中的分数换算。' },
  population: { en: '{count} reactions, {products} distinct products', zh: '{count} 行反应，{products} 个不同产物' },
  identityUnrun: { en: 'Chemical-identity overlap waits for the pinned checkout and RDKit.', zh: '化学身份重叠要等钉死的检出和 RDKit 都就绪后再计算。' },
  identityRecorded: { en: 'Shared molecules after the model parse, MolFromSmiles then AddHs:', zh: '按模型解析（MolFromSmiles 后加氢）得到的相同分子数：' },
  mae: { en: 'Mean absolute error {value} percentage points', zh: '平均绝对误差 {value} 个百分点' },
  selected: { en: 'Selected reaction', zh: '选中的反应' },
  noSelection: { en: 'Select a point or a row.', zh: '选择图上的点或列表中的一行。' },
  product: { en: 'Product SMILES', zh: '产物 SMILES' },
  structure: { en: 'Product structure', zh: '产物结构' },
  structureMissing: { en: 'Structure drawing needs RDKit in the prepared inference environment. The SMILES remains available.', zh: '结构图需要在已准备的推理环境中提供 RDKit。SMILES 仍然保留。' },
  cfExp: { en: 'Experimental correction factor', zh: '实验校正因子' },
  cfPred: { en: 'Released predicted correction factor', zh: '发布的预测校正因子' },
  cfRerun: { en: 'This run', zh: '本次重跑' },
  yieldExp: { en: 'Experimental yield', zh: '实验产率' },
  yieldPred: { en: 'Released predicted yield', zh: '发布的预测产率' },
  rerun: { en: 'Run pinned weights', zh: '运行钉死的权重' },
  rerunHelp: { en: 'Runs predict_by_smiles_list on the product SMILES and compares correction factors with the released column. It does not recompute the 4.74 yield figure.', zh: '对产物 SMILES 调用 predict_by_smiles_list，并把校正因子与发布列比较。这不会重算 4.74 的产率数字。' },
  confirmTitle: { en: 'Run the pinned weights', zh: '运行钉死的权重' },
  confirmBody: { en: 'This starts one inference on the selected checkout. The paper conclusion stays unsettled.', zh: '这将在选定的检出上启动一次推理。论文结论仍保持未决。' },
  confirm: { en: 'Run once', zh: '运行一次' },
  cancel: { en: 'Cancel', zh: '取消' },
  running: { en: 'Running the pinned predictor…', zh: '正在运行钉死的预测程序…' },
  checkout: { en: 'Pinned checkout', zh: '钉死的检出' },
  checkoutHelp: { en: 'Absolute path of xtalpi-inc/lcms2yield at commit 1018ba0. This App does not clone or download it.', zh: 'xtalpi-inc/lcms2yield 提交 1018ba0 的绝对路径。本应用不会克隆或下载它。' },
  saveCheckout: { en: 'Save checkout', zh: '保存检出' },
  environment: { en: 'Inference environment', zh: '推理环境' },
  environmentHelp: { en: 'This trial prepares PyTorch, PyTorch Geometric and RDKit on Python 3.12. The view only observes that method.', zh: '这次在 Python 3.12 上准备 PyTorch、PyTorch Geometric 和 RDKit。这里只观察该方法。' },
  computeHelp: { en: 'Cluster jobs are not connected. Compute keeps connection drafts; this case does not submit them.', zh: '集群作业尚未接通。Compute 保存的是连接草稿；本案例不会提交作业。' },
  notConnected: { en: 'Not connected', zh: '未连接' },
  openEnvironments: { en: 'Software environments', zh: '软件环境' },
  openCompute: { en: 'Compute', zh: '计算' },
  workers: { en: 'Execution workers', zh: '执行节点' },
  settings: { en: 'Related places', zh: '相关位置' },
  filter: { en: 'Reaction type', zh: '反应类型' },
  allTypes: { en: 'All types', zh: '全部类型' },
  reactions: { en: 'Reactions', zh: '反应' },
  Buchwald: { en: 'Buchwald', zh: 'Buchwald' },
  SN2: { en: 'SN2', zh: 'SN2' },
  amide_coupling: { en: 'Amide coupling', zh: '酰胺偶联' },
  Suzuki: { en: 'Suzuki', zh: 'Suzuki' },
};

export interface Reaction {
  index: number;
  reactionType: 'Buchwald' | 'SN2' | 'amide_coupling' | 'Suzuki';
  name: string;
  productSmiles: string;
  yieldExp: string;
  yieldPred: string;
  cfExp: string;
  cfPred: string;
  cfRerun: string | null;
}
export interface CaseState {
  commit: string;
  population: number;
  uniqueProducts: number;
  yieldMaePercentagePoints: string;
  verdicts: { yieldTable: 'PASS' | 'FAIL'; prediction: 'UNRUN' | 'PASS' | 'FAIL'; paper: 'INCONCLUSIVE' };
  paperReason: string;
  typeCounts: Record<string, number>;
  checkout: string | null;
  identity: { status: 'UNRUN' | 'RECORDED' | 'FAIL'; reason?: string; shared?: { left: string; right: string; shared: number }[] };
  compute: { connected: false; jobs: null; destination: string };
  links: { environments: string; compute: string; workers: string; method: 'lcms2yield.inference' };
  reactions: Reaction[];
}
