import type { AppMessages } from '@pero/app-sdk';

export const messages: AppMessages = {
  title: { en: 'LCMS2Yield', zh: 'LCMS2Yield' },
  subtitle: { en: 'Correction factors from the official LCMS2Yield examples', zh: '用官方 LCMS2Yield 示例预测校正因子' },
  task: { en: 'Task', zh: '任务' },
  taskReproduce: { en: 'Reproduce paper results', zh: '复现论文结果' },
  taskPredict: { en: 'Predict correction factors', zh: '预测校正因子' },
  taskTrain: { en: 'Train and evaluate model', zh: '训练并评估模型' },
  dataset: { en: 'Dataset', zh: '数据集' },
  datasetAll: { en: 'Published reactions · {count}', zh: '已发布反应 · {count}' },
  upload: { en: 'Upload dataset', zh: '上传数据集' },
  noFile: { en: 'No CSV selected', zh: '未选择 CSV' },
  uploadHint: { en: 'CSV with a header row. Excel and SDF are not read in this version.', zh: '带表头的 CSV。这一版不读取 Excel 和 SDF。' },
  detected: { en: 'Auto-detected inputs', zh: '自动识别的输入' },
  detectedReproduce: { en: 'Experimental yields, published predicted yields, reaction names.', zh: '实验产率、论文发布的预测产率、反应名称。' },
  detectedPredict: { en: 'Product SMILES. The released model returns a correction factor, not a yield.', zh: '产物 SMILES。已发布模型返回校正因子，不直接返回产率。' },
  detectedTrain: { en: 'The release has weights and predict.py, and no training entry. A train/validation split does not apply.', zh: '发布内容有权重和 predict.py，没有训练入口。训练/验证划分在这里不适用。' },
  mappingNeeded: { en: 'Schema mapping and validation are required before running.', zh: '运行前需要完成字段对应和校验。' },
  mappingReady: { en: 'Detected {smiles} as SMILES and {yields} as yields.', zh: '已把 {smiles} 识别为 SMILES，把 {yields} 识别为产率。' },
  advanced: { en: 'Advanced settings', zh: '高级设置' },
  advancedBody: { en: 'Python 3.12, pinned weights, correction-factor tolerance 0.0001. These stay fixed for the published case.', zh: 'Python 3.12、钉住的权重、校正因子容差 0.0001。已发布案例里这些保持固定。' },
  runReproduce: { en: 'Run reproduction', zh: '运行复现' },
  runTrain: { en: 'Training is not in the release', zh: '发布内容不含训练' },
  paperMetric: { en: 'Paper metric', zh: '论文指标' },
  thisCheck: { en: 'This check', zh: '本次核算' },
  difference: { en: 'Difference', zh: '差值' },
  evidence: { en: 'The 4.74 figure is the mean absolute error of the published yield columns, in percentage points. A weight rerun checks correction factors and does not recompute those yields.', zh: '4.74 是发布产率列的平均绝对误差，单位是个百分点。权重复跑核对的是校正因子，不会重算这些产率。' },
  data: { en: 'Data', zh: '数据' },
  tasks: { en: 'Run', zh: '任务' },
  officialExample: { en: 'Official README example', zh: '官方 README 示例' },
  reactionFile: { en: 'reactions.csv', zh: 'reactions.csv' },
  rows: { en: '{count} rows · published table', zh: '{count} 行 · 发布表' },
  buchwaldExample: { en: 'Buchwald · XantPhos', zh: 'Buchwald · XantPhos' },
  sn2Example: { en: 'SN2 · DMF', zh: 'SN2 · DMF' },
  suzukiExample: { en: 'Suzuki · XPhos', zh: 'Suzuki · XPhos' },
  amideExample: { en: 'Amide · HATU', zh: '酰胺偶联 · HATU' },
  axisExp: { en: 'Experimental yield (%)', zh: '实验产率 (%)' },
  axisPred: { en: 'Predicted yield (%)', zh: '预测产率 (%)' },
  target: { en: 'Target', zh: '目标列' },
  targetValue: { en: 'Correction factor', zh: '校正因子' },
  runPrediction: { en: 'Run prediction', zh: '运行预测' },
  results: { en: 'Results', zh: '结果' },
  log: { en: 'Log', zh: '日志' },
  metrics: { en: 'Published-table statistics', zh: '发布表统计' },
  r2: { en: 'R²', zh: 'R²' },
  metricMae: { en: 'MAE', zh: 'MAE' },
  rmse: { en: 'RMSE', zh: 'RMSE' },
  pearson: { en: 'Pearson r', zh: 'Pearson r' },
  conclusion: { en: 'Conclusion', zh: '结论' },
  conclusionBody: { en: 'The published yields agree closely (MAE {value} percentage points). This is not a new measurement.', zh: '发布产率高度一致（平均绝对误差 {value} 个百分点）。这不是一次新的测量。' },
  exampleOutput: { en: 'Example output', zh: '示例输出' },
  publishedCf: { en: 'README correction factor', zh: 'README 校正因子' },
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
  matchesFactors: { en: 'Matches released factors', zh: '与发布校正因子一致' },
  operationFailed: { en: 'The operation could not finish. Check the details and try again.', zh: '操作未能完成，请查看详情后重试。' },
  fail: { en: 'Does not match', zh: '不一致' },
  unrun: { en: 'Not run', zh: '尚未运行' },
  inconclusive: { en: 'Unsettled', zh: '未决' },
  chart: { en: 'Published yield table', zh: '发布产率表' },
  chartHelp: { en: 'Fixed published columns, not this run. Each point is one reaction. The diagonal is exact agreement.', zh: '这是发布表里的固定两列，不是这次运行的输出。每个点是一行反应，对角线表示完全一致。' },
  population: { en: '{count} reactions, {products} distinct products', zh: '{count} 行反应，{products} 个不同产物' },
  identityUnrun: { en: 'Chemical-identity overlap waits for the pinned release and RDKit.', zh: '化学身份重叠要等钉住的发布和 RDKit 都就绪后再计算。' },
  identityRecorded: { en: 'Shared molecules after the model parse:', zh: '按模型解析得到的相同分子：' },
  identityTrain: { en: 'Pretraining and fine-tuning share {count} molecules.', zh: '预训练与微调共享 {count} 个分子。' },
  identityClean: { en: 'No evaluation molecule appears in either training set.', zh: '评测集与两个训练集没有相同分子。' },
  identityPair: { en: '{left} and {right} share {count}.', zh: '{left}与{right}共享 {count} 个。' },
  identityAll: { en: 'All set pairs', zh: '全部集合对照' },
  paperBody: { en: 'The released yield columns match 4.74 percentage points only as published arithmetic. Chromatograms were not remeasured, and a correction-factor rerun does not recompute those yields.', zh: '4.74 个百分点只是发布产率列的算术结果。没有重测色谱，校正因子重跑也不会重算这些产率。' },
  mae: { en: 'Mean absolute error {value} percentage points', zh: '平均绝对误差 {value} 个百分点' },
  selected: { en: 'Selected reaction', zh: '选中的反应' },
  noSelection: { en: 'Select a point or a row.', zh: '选择图上的点或列表中的一行。' },
  product: { en: 'Product SMILES', zh: '产物 SMILES' },
  structure: { en: 'Product structure', zh: '产物结构' },
  structureMissing: { en: 'Structure drawing needs RDKit in the prepared inference environment. The SMILES remains available.', zh: '结构图需要在已准备的推理环境中提供 RDKit。SMILES 仍然保留。' },
  cfExp: { en: 'Experimental correction factor', zh: '实验校正因子' },
  cfPred: { en: 'Released predicted correction factor', zh: '发布的预测校正因子' },
  input: { en: 'Input', zh: '输入' },
  output: { en: 'Output', zh: '输出' },
  outputEmpty: { en: 'Run the pinned weights. The correction factor for this reaction appears here.', zh: '运行钉住的权重后，这里显示这个反应的校正因子。' },
  outputLimit: { en: 'The model outputs a correction factor. The 4.74 yield figure stays the published table.', zh: '模型输出的是校正因子。4.74 的产率数字仍是发布表，不是这次输出。' },
  delta: { en: 'Absolute difference from the published prediction', zh: '与发布预测列的绝对差' },
  cfRerun: { en: 'Correction factor from this run', zh: '本次校正因子' },
  yieldExp: { en: 'Experimental yield', zh: '实验产率' },
  yieldPred: { en: 'Released predicted yield', zh: '发布的预测产率' },
  rerun: { en: 'Run pinned weights', zh: '运行钉死的权重' },
  rerunHelp: { en: 'Compares correction factors with the released column.', zh: '把校正因子与发布列比较。' },
  confirmTitle: { en: 'Run the pinned weights', zh: '运行钉死的权重' },
  confirmBody: { en: 'This starts one inference on the downloaded release. The paper conclusion stays unsettled.', zh: '这将在已下载的发布上启动一次推理。论文结论仍保持未决。' },
  confirm: { en: 'Run once', zh: '运行一次' },
  cancel: { en: 'Cancel', zh: '取消' },
  running: { en: 'Running the pinned predictor…', zh: '正在运行钉死的预测程序…' },
  release: { en: 'Pinned release', zh: '钉住的发布' },
  releaseReady: { en: 'The pinned upstream release is in this App’s data directory.', zh: '钉住的上游发布已在这个 App 的 data 目录中。' },
  releaseMissing: { en: 'The pinned release is not in app data yet.', zh: '钉住的发布还没有进入 App data。' },
  downloadRelease: { en: 'Download pinned release', zh: '下载钉住的发布' },
  pretrain: { en: 'Pretraining', zh: '预训练' },
  fine_tuning: { en: 'Fine-tuning', zh: '微调' },
  fda: { en: 'FDA', zh: 'FDA' },
  reaction_products: { en: 'Reaction products', zh: '反应产物' },
  suzuki_isolated: { en: 'Suzuki isolated', zh: 'Suzuki 分离产率' },
  minisci_isolated: { en: 'Minisci isolated', zh: 'Minisci 分离产率' },
  environment: { en: 'Inference environment', zh: '推理环境' },
  environmentHelp: { en: 'Prepare environment installs PyTorch, PyTorch Geometric and RDKit into this App’s own Python 3.12 environment, separate from Control Lab, and downloads the pinned release.', zh: '准备环境会把 PyTorch、PyTorch Geometric 和 RDKit 装进这个 App 自己的 Python 3.12 环境，与 Control Lab 分开，并下载钉住的发布。' },
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
  predictionByType: Record<string, 'UNRUN' | 'PASS' | 'FAIL'>;
  paperReason: string;
  typeCounts: Record<string, number>;
  checkout: string | null;
  identity: { status: 'UNRUN' | 'RECORDED' | 'FAIL'; reason?: string; shared?: { left: string; right: string; shared: number }[] };
  examples: { status: 'UNRUN' | 'PASS' | 'FAIL'; items: { id: string; smiles: string; published: string; predicted: string | null }[] };
  showcase: { status: 'UNRUN' | 'PASS' | 'FAIL'; items: { id: string; smiles: string; published: string; predicted: string | null }[] };
  custom: { predictions: { smiles: string; predicted: string }[] } | null;
  fit: { mae: string; rmse: string; r2: string; pearson: string };
  compute: { connected: false; jobs: null; destination: string };
  links: { environments: string; compute: string; workers: string; method: 'lcms2yield.inference' };
  reactions: Reaction[];
}
