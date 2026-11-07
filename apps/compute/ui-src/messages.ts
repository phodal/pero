import type { AppMessages } from '@pero/app-sdk';

export const messages: AppMessages = {
  navigation: { en: 'Compute views', zh: '计算视图' },
  jobs: { en: 'Jobs', zh: '作业' },
  clusters: { en: 'Clusters', zh: '集群' },
  add: { en: 'Add cluster draft', zh: '添加集群配置' },
  edit: { en: 'Edit draft', zh: '编辑配置' },
  editTitle: { en: 'Edit cluster draft', zh: '编辑集群配置' },
  createTitle: { en: 'New cluster draft', zh: '新建集群配置' },
  name: { en: 'Cluster name', zh: '集群名称' },
  host: { en: 'Login host or SSH alias', zh: '登录主机或 SSH 别名' },
  account: { en: 'Slurm account', zh: 'Slurm 账号' },
  partition: { en: 'Slurm partition', zh: 'Slurm 分区' },
  workdir: { en: 'Working directory', zh: '工作目录' },
  optional: { en: 'Optional', zh: '可选' },
  configurationHelp: { en: 'Save host and Slurm settings on this device. The draft stays not connected.', zh: '在本机保存主机与 Slurm 配置，草稿保持“未连接”。' },
  notConnected: { en: 'Not connected', zh: '未连接' },
  draftHelp: { en: 'This is a saved configuration draft. Host access, Slurm account and partition have not been verified. Slurm connections are not available yet.', zh: '这是已保存的配置草稿，主机访问、Slurm 账号与分区尚未验证。当前尚未接通 Slurm 集群连接。' },
  noClusters: { en: 'Prepare your first cluster connection', zh: '准备第一个集群连接' },
  noClustersHelp: { en: 'Save host and Slurm settings as a draft. Cluster access is not connected yet.', zh: '先保存主机与 Slurm 配置草稿。集群连接尚未接通，配置会保持“未连接”。' },
  jobsUnavailable: { en: 'Connect a cluster to read jobs', zh: '尚未连接，无法读取作业' },
  jobsHelp: { en: 'Cluster scheduling is not connected yet. No queue or job history has been queried. Start by preparing a cluster configuration.', zh: '集群调度尚未接通，目前未查询作业队列或历史。可以先准备集群配置。' },
  selectedJobsHelp: { en: '“{name}” is a saved draft and is not connected. Its queue and job history cannot be read yet.', zh: '“{name}”仍是未连接的配置草稿，当前无法读取该集群的队列与作业历史。' },
  recordedHelp: { en: 'These receipts were written by the execution owner. They are not a query of the cluster queue.', zh: '这些回执由执行方写入，不是对集群队列的查询。' },
  executionsUnreadable: { en: 'An execution receipt could not be read. The cluster queue was not queried.', zh: '有一份执行回执无法读取。集群队列并未查询。' },
  operation: { en: 'Operation', zh: '操作' },
  externalJob: { en: 'External job', zh: '外部作业' },
  payload: { en: 'Payload SHA-256', zh: '载荷 SHA-256' },
  requested: { en: 'Requested resources', zh: '请求的资源' },
  requestedValue: { en: 'partition {partition}, {cpus} CPU, {memory} MiB, {wall} s', zh: '分区 {partition}，{cpus} CPU，{memory} MiB，墙钟 {wall} 秒' },
  scheduler: { en: 'Scheduler observation', zh: '调度观察' },
  noScheduler: { en: 'This receipt has no scheduler observation.', zh: '这份回执没有调度观察。' },
  submittedOnly: { en: 'Submission receipt', zh: '提交回执' },
  receiptCluster: { en: 'Cluster', zh: '集群' },
  keepJob: { en: 'Do not resubmit external job {jobId}.', zh: '不要重新提交外部作业 {jobId}。' },
  processHost: { en: 'Host', zh: '主机' },
  processExit: { en: 'Recorded exit', zh: '记录的退出码' },
  processExitValue: { en: 'Exit {code}', zh: '退出码 {code}' },
  processOpen: { en: 'The process had not exited when this receipt was written.', zh: '写下这份回执时，进程尚未退出。' },
  noExternalJob: { en: 'This receipt has no external job.', zh: '这份回执没有外部作业。' },
  processFact: { en: 'This is a process fact, not a scheduler observation.', zh: '这是进程事实，不是调度观察。' },
  recordedNodes: { en: 'Allocated nodes', zh: '已分配节点' },
  recordedStart: { en: 'Recorded start', zh: '记录的开始时间' },
  recordedEnd: { en: 'Recorded end', zh: '记录的结束时间' },
  recordedSpan: { en: 'Recorded span', zh: '记录的时长' },
  recordedSeconds: { en: '{seconds} s', zh: '{seconds} 秒' },
  entryLabel: { en: 'Recorded entry', zh: '记录的入口' },
  logsLabel: { en: 'Recorded logs', zh: '记录的日志' },
  outputsLabel: { en: 'Recorded outputs', zh: '记录的产物' },
  snapshot: { en: 'Environment snapshot', zh: '环境快照' },
  reproduce: { en: 'Reproduce draft', zh: '重跑草稿' },
  reproduceHelp: { en: 'A new attempt for review. Nothing is submitted from this page.', zh: '这是待审阅的新尝试草稿，此页面不会提交任何作业。' },
  draftCopied: { en: 'Reproduce draft copied.', zh: '已复制重跑草稿。' },
  draftCopyFailed: { en: 'The draft is shown below. The clipboard is unavailable.', zh: '草稿已显示在下方，剪贴板暂不可用。' },
  manage: { en: 'Manage clusters', zh: '管理集群' },
  saved: { en: 'Cluster draft saved. It is not connected.', zh: '集群配置草稿已保存，尚未建立连接。' },
  loading: { en: 'Loading cluster drafts…', zh: '正在读取集群配置…' },
  refreshing: { en: 'Updating saved configuration…', zh: '正在更新已保存的配置…' },
  selecting: { en: 'Saving cluster selection…', zh: '正在保存集群选择…' },
  refresh: { en: 'Refresh configuration', zh: '刷新配置' },
  loadFailed: { en: 'Could not read cluster configuration.', zh: '暂时无法读取集群配置。' },
  retained: { en: 'Showing the last loaded configuration.', zh: '正在显示上次读取的配置。' },
  actionFailed: { en: 'Could not save this change. Your draft is kept; try again.', zh: '未能保存本次修改，已保留填写内容，请重试。' },
  navigationFailed: { en: 'Could not open that page. Try again.', zh: '暂时无法打开该页面，请重试。' },
  environmentUnavailable: { en: 'Could not open software environments. Check that the app is enabled in Apps, then try again.', zh: '暂时无法打开软件环境。请在应用目录检查是否已启用，再重试。' },
  manageApps: { en: 'Open Apps', zh: '打开应用目录' },
  details: { en: 'Error details', zh: '错误详情' },
  retry: { en: 'Retry', zh: '重试' },
  save: { en: 'Save draft', zh: '保存草稿' },
  saving: { en: 'Saving…', zh: '正在保存…' },
  cancel: { en: 'Cancel', zh: '取消' },
  close: { en: 'Close', zh: '关闭' },
  notSet: { en: 'Not set', zh: '未填写' },
  settings: { en: 'Related settings', zh: '相关设置' },
  settingsHelp: { en: 'Worker registration and software environments are managed separately from cluster connections.', zh: '执行节点登记、软件环境与集群连接分别管理。' },
  workers: { en: 'Manage execution workers', zh: '管理执行节点' },
  environments: { en: 'Software environments', zh: '软件环境' },
  unavailable: { en: 'Compute could not load.', zh: '计算页面暂时无法加载。' },
  reload: { en: 'Reload', zh: '重新加载' },
};

export type Cluster = { id: string; name: string; host: string; account: string; partition: string; workdir: string; connectionStatus: 'not_connected' };
export type ClusterInput = Omit<Cluster, 'connectionStatus' | 'id'> & { id?: string };
export type SchedulerObservation = { states: string[]; nodes: string; startTime: number | null; endTime: number | null; wallSeconds: number | null };
export type ExecutionReceipt = {
  operation: string; cluster: string | null; jobId: number | null; submitTime: number;
  host: string | null; started: number | null; ended: number | null; exitCode: number | null; wallMilliseconds: number | null;
  constraints: { partition: string; cpus: number; memoryMib: number; walltimeSeconds: number } | null;
  payloadSha256: string; scheduler: SchedulerObservation | null; entry: string | null;
  logs: string[]; outputs: { path: string; sha256: string }[]; snapshotSha256: string | null;
};
export type ClusterState = {
  clusters: Cluster[]; selectedClusterId: string | null; jobs: null; jobsStatus: 'not_connected';
  executions: ExecutionReceipt[] | null; executionsStatus: 'none' | 'recorded' | 'unreadable'; executionsError?: string;
};
