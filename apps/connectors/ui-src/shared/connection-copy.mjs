// Presentation owns the sentence; the model owns the distinction. The domain
// emits codes (contracts/connector-v1.json), and everything a person reads is
// assembled here, so a new state cannot ship with three different wordings in
// three different render sites — and so localization has one file to touch.

/** @type {Record<string, string>} */
export const STATE_LABELS = {
  'needs-configuration': '待配置',
  disabled: '已停用',
  'not-connected': '未连接',
  'waiting-for-approval': '等待授权',
  connecting: '连接中',
  'needs-authorization': '需要登录',
  verified: '验证通过',
  connected: '运行中',
  'not-verified': '未验证',
  'needs-attention': '需处理',
};

// Each sentence answers "what is true" and, where the fact is easy to
// misread, "what it is not". Verified is the clearest example: the probe
// released its session on purpose, so the card must not imply a live link.
/** @type {Record<string, string>} */
export const REASON_TEXT = {
  'configuration-incomplete': '还缺少必填配置，填好之后才能连接。',
  'disabled-by-user': '已暂停使用，配置和授权都保留着。',
  'never-connected': '配置已就绪，还没有连接过。',
  'awaiting-consent': '已在浏览器打开授权页，等待你同意。关闭这个窗口不会取消本次授权。',
  'runtime-starting': '正在启动运行时并读取工具列表。',
  'grant-absent': '本机没有这个连接的授权记录，需要登录。',
  'grant-expired': '授权已过期，重新登录即可，配置会保留。',
  'grant-rejected': '服务端拒绝了现有授权（令牌失效或同意已被撤销），需要重新登录。',
  'grant-indeterminate': '读取不到本机授权记录，这不等于没有授权。请先确认系统凭据存储可访问，再重试。',
  'install-failed': '运行时没有安装成功，和登录状态无关。',
  'start-failed': '运行时启动失败，和登录状态无关。授权仍然保留。',
  'probe-failed': '授权仍然有效，但这次没能连上服务。这是暂时离线，不需要重新登录。',
  'probe-cancelled': '上次验证被取消了，尚未确认能力。已产生的外部效果不会回滚。',
  'partial-mutation': '这次修改只生效了一半。',
  'runtime-live': '运行时在线并持有会话。',
  'probe-verified': '已验证可以初始化并读取工具；验证用的连接随后就释放了，这不代表持续在线。',
  'grant-present-unverified': '本机有授权记录，但还没验证过能力。',
  'provider-unavailable': '找不到对应的服务目录项，无法判断接入方式。',
};

/** @type {Record<string, string>} */
export const ACTION_LABELS = {
  configure: '配置',
  connect: '连接',
  reauthorize: '重新登录',
  'cancel-attempt': '取消连接',
  verify: '验证连接',
  retry: '重试',
  enable: '启用',
  disable: '停用',
  'disconnect-runtime': '断开运行连接',
  logout: '退出登录',
  remove: '删除连接',
  'revoke-at-provider': '在服务商撤销',
  'open-docs': '查看文档',
};

// The five verbs users confuse. Spelling out what each one keeps is the whole
// reason they are separate buttons.
/** @type {Record<string, string>} */
export const LIFECYCLE_HINTS = {
  disable: '暂停使用，配置与授权都保留。',
  enable: '恢复使用，不会重新登录。',
  'disconnect-runtime': '只关闭当前运行连接，配置与授权保留。',
  logout: '清除本机授权记录，配置保留；不会撤销服务商那一侧的授权。',
  remove: '删除这个连接的配置与本机授权记录。',
  'revoke-at-provider': '前往服务商页面撤销授权；是否支持由服务商决定。',
};

/** @type {Record<string, string>} */
export const BADGE_LABELS = {
  'source-builtin': '内置',
  'auth-required': '需登录',
  'no-auth': '免登录',
  'lease-held': '持有会话',
  'probe-released': '已释放',
  'grant-unknown': '授权未知',
  'scope-limited': '权限不全',
  'approval-required': '调用需审批',
  'multi-account': '可多账号',
  'partial-mutation': '部分生效',
};

/** @type {Record<string, string>} */
export const BLOCK_REASON_LABELS = {
  'not-discovered': '服务未提供',
  'not-host-allowed': '不在白名单',
  'out-of-grant-scope': '超出授权范围',
  'user-disabled': '已被关闭',
  'policy-blocked': '策略禁止',
};

/** @type {Record<string, string>} */
export const EFFECT_LABELS = {
  read: '读取',
  write: '写入',
  delete: '删除',
  share: '分享',
  external_send: '对外发送',
};

/** @type {Record<string, string>} */
export const ACTION_LABELS_EN = {
  configure: 'Configure', connect: 'Connect', reauthorize: 'Sign in again', 'cancel-attempt': 'Cancel connection',
  verify: 'Verify connection', retry: 'Retry', enable: 'Enable', disable: 'Disable',
  'disconnect-runtime': 'Disconnect runtime', logout: 'Sign out', remove: 'Remove connection',
  'revoke-at-provider': 'Revoke at provider', 'open-docs': 'Open documentation',
};
/** @type {Record<string, string>} */
export const STATE_LABELS_EN = {
  'needs-configuration': 'Needs configuration', disabled: 'Disabled', 'not-connected': 'Not connected',
  'waiting-for-approval': 'Awaiting approval', connecting: 'Connecting', 'needs-authorization': 'Sign-in required',
  verified: 'Verified', connected: 'Running', 'not-verified': 'Not verified', 'needs-attention': 'Needs attention',
};
/** @type {Record<string, string>} */
export const BADGE_LABELS_EN = {
  'source-builtin': 'Built-in', 'auth-required': 'Sign-in required', 'no-auth': 'No authentication',
  'lease-held': 'Session held', 'probe-released': 'Session released', 'grant-unknown': 'Consent unknown',
  'scope-limited': 'Scopes limited', 'approval-required': 'Approval required', 'multi-account': 'Multiple accounts', 'partial-mutation': 'Partially applied',
};
/** @type {Record<string, string>} */
export const BLOCK_REASON_LABELS_EN = {
  'not-discovered': 'Not provided by service', 'not-host-allowed': 'Not admitted',
  'out-of-grant-scope': 'Outside granted scopes', 'user-disabled': 'Disabled by user', 'policy-blocked': 'Blocked by policy',
};
/** @type {Record<string, string>} */
export const EFFECT_LABELS_EN = { read: 'Read', write: 'Write', delete: 'Delete', share: 'Share', external_send: 'Send externally' };
/** @type {Record<string, string>} */
export const LIFECYCLE_HINTS_EN = {
  disable: 'Pause use; configuration and consent are retained.', enable: 'Resume using the existing sign-in.',
  'disconnect-runtime': 'Close the runtime session; configuration and consent are retained.',
  logout: 'Clear local consent; configuration is retained. Provider consent must be revoked separately.',
  remove: 'Remove this connection configuration and its local consent records.',
  'revoke-at-provider': 'Open the provider to revoke consent, where supported.',
};
const REASON_TEXT_EN = {
  'configuration-incomplete': 'Complete the required configuration to connect.', 'disabled-by-user': 'Paused; configuration and consent are retained.',
  'never-connected': 'Configuration is ready. This connection has not been used yet.', 'awaiting-consent': 'Waiting for consent in the browser. Closing this window keeps the attempt active.',
  'runtime-starting': 'Starting the runtime and discovering tools.', 'grant-absent': 'No local consent record; sign in to continue.',
  'grant-expired': 'Consent expired. Sign in again; configuration is retained.', 'grant-rejected': 'The provider rejected consent. Sign in again.',
  'grant-indeterminate': 'Local consent is unreadable. Check system credential storage and retry.', 'install-failed': 'Runtime installation failed.',
  'start-failed': 'Runtime start failed. Consent is retained.', 'probe-failed': 'The connection check failed. Retry when the service is available.',
  'probe-cancelled': 'Verification was cancelled. Existing external effects remain.', 'partial-mutation': 'Only part of the change took effect.',
  'runtime-live': 'The runtime holds an active session.', 'probe-verified': 'Initialization and tool discovery succeeded. The verification session was released.',
  'grant-present-unverified': 'Local consent exists; capabilities still need verification.', 'provider-unavailable': 'The provider catalog entry is unavailable.',
};
const NEXT_STEP_TEXT_EN = {
  refresh: 'Refresh for the current state.', 'restart-runtime': 'Configuration saved. Restart the runtime session.',
  reauthorize: 'Sign in again to continue.', 'retry-operation': 'This step had no effect. Retry it.', manual: 'Manual reconciliation is required; operations are not replayed.',
};

/** @type {Record<string, string>} */
export const NEXT_STEP_TEXT = {
  refresh: '请刷新列表以看到最新状态。',
  'restart-runtime': '配置已保存，只需重新启动运行连接。',
  reauthorize: '请重新登录后再继续。',
  'retry-operation': '这一步没有生效，可以重试。',
  manual: '需要手动处理，系统不会自动重放。',
};

/** @type {Record<string, string>} */
export const AUTH_MODE_TEXT = {
  none: '无需身份验证',
  'user-oauth': '用户 OAuth 登录',
  'user-qr': '用户扫码授权',
  'shared-token': '配置的共享令牌',
  'service-identity': '服务身份',
};

// Registration answers "can this service be joined at all"; identity answers
// "as whom does one call run". Keeping the two sentences apart is what stops a
// finished OAuth-app setup from reading as a finished login.
/** @type {Record<string, string>} */
export const REGISTRATION_TEXT = {
  none: '无需注册 OAuth 应用',
  dcr: '支持动态客户端注册',
  preregistered: '需要预先注册 OAuth 应用',
};

/** @type {Record<string, string>} */
export const ERROR_TEXT = {
  MCP_CREDENTIAL_RELEASE_FAILED: '凭据会话的释放尚未确认。请检查本机状态后重试；未自动重放。',
  MCP_CONTROL_RELEASE_UNCERTAIN: '配置操作可能已生效，但锁的释放尚未确认。请刷新检查实际状态；未自动重放。',
  MCP_CREDENTIAL_STORE_UNAVAILABLE: '系统凭据存储不可用，请检查系统加密存储；Pero 不会把密钥保存为明文。',
  MCP_CREDENTIAL_STORE_LOCKED: '系统凭据存储已锁定，请在系统中解锁后重试。',
  MCP_CREDENTIAL_STORE_PROTOCOL: '系统凭据存储响应无效，未继续此操作。',
  MCP_CREDENTIAL_STORE_CORRUPT: '无法读取此连接的凭据记录，请检查系统凭据存储。',
  MCP_SECRET_LIMIT: '凭据过大，未保存。',
  MCP_CREDENTIAL_SAVE_FAILED_NO_REPLAY: '服务操作可能已经完成，但凭据保存失败。请先检查实际结果；未自动重放。',
  MCP_CREDENTIAL_CHANGE_APPLIED_INCOMPLETE: '凭据变更已部分生效。请刷新并检查实际状态；未自动重放。',
  MCP_CHANNEL_UNAVAILABLE: '本机缺少可用的渠道运行时，请检查 Pero 安装。',
  MCP_PLATFORM_UNSUPPORTED: '此系统未提供该本机能力。',

  CHANNEL_AUTH_FAILED: '渠道凭据无效或权限不足，请检查平台应用配置。',
  CHANNEL_MODEL_CREDENTIAL_REQUIRED: '尚未配置渠道的对话模型凭据，请在 ~/.point/.credentials.yaml 中配置 DEEPSEEK_API_KEY。',
  CHANNEL_CONNECT_TIMEOUT: '渠道连接超时，请检查网络和平台应用状态。',
  CHANNEL_START_FAILED: '渠道运行时启动失败，请检查本机 Pero 的对话模型配置。',
  CHANNEL_CONNECT_FAILED: '渠道连接失败，请检查网络后重试。',
  CHANNEL_DISCONNECTED: '渠道长连接已断开，正在自动重连。',
  CHANNEL_KICKED: '同一个机器人在别处建立了新连接，本机连接已被平台断开；请确认只有一处在运行后重新连接。',
  MCP_WECOM: '企业微信服务请求失败，请检查网络后重试。',
  MCP_FEISHU: '飞书开放平台请求失败，请检查网络和应用权限后重试。',
  CHANNEL_TURN_OR_DELIVERY_FAILED: '有消息未完成处理或无法确认回复已送达；未自动重放。请先检查平台中的实际回复和模型配置。',
  MCP_CONTROL_APPROVAL_REQUIRED: '操作未获允许。',
  MCP_CONFIG_CONFLICT: '配置已被修改，请刷新后重试。',
  MCP_CONFIG: '配置无效，请检查字段、工具白名单和密钥引用。',
  MCP_INTEGRITY: '可执行文件或依赖摘要不匹配。',
  MCP_TRANSPORT_UNSUPPORTED: '旧 SSE 不再支持，请填写服务端实际的 Streamable HTTP 地址。',
  MCP_AUTH_REQUIRED: '需要登录。',
  MCP_AUTH_DENIED: '授权未获允许。',
  MCP_CONTROL_BUSY: '另一个操作正在进行，请等它结束。',
  MCP_INSTALL_FAILED: '无法准备安装命令，请检查网络后重试，或改为手动配置。',
  MCP_INSTALL_UNVERIFIED: '发布文件没有可校验的 sha256 摘要，已拒绝安装。',
  MCP_INSTALL_NO_PYTHON: '本机没有 uv，也没有 Python 3.12 或更高版本，Pero 无法代为安装。请先安装 uv（brew install uv）。',
  MCP_KEYCHAIN_UNAVAILABLE: '系统凭据存储不可访问，请检查系统登录与加密存储。',
  MCP_SECRET_REQUIRED: '配置引用的密钥不存在。',
  MCP_METHOD_DENIED: '本机原生服务版本过旧，不支持这个操作；请重新构建原生服务后重启 Point。',
  MCP_WEIXIN: '微信 iLink 服务请求失败，请检查网络后重试。',
  MCP_AUTH_VERIFY_CODE: '手机端要求输入配对数字，Pero 暂不支持这一步；请重新扫码，或先在手机上解除该账号的其它绑定。',
  MCP_AUTH_CALLBACK: '登录确认结果不完整，请重新扫码。',
  MCP_TIMEOUT: '连接超时；未自动重放调用。',
  MCP_ATTEMPT_CONFLICT: '这个连接已经有一次授权在进行中。',
  MCP_ATTEMPT_FINISHED: '本次授权已经结束。',
  MCP_NO_ATTEMPT: '这次授权已经不在进行中了。',
  MCP_DIRECTORY: '服务目录项无效。',
  GITLAB_AUTH_REQUIRED: 'GitLab 令牌无效或已被撤销，请更新系统凭据存储中的密钥。',
  GITLAB_PERMISSION_DENIED: 'GitLab 令牌权限不足，请检查项目成员关系和只读范围。',
  GITLAB_RATE_LIMITED: 'GitLab 暂时限流，请按返回信息稍后重试。',
  GITLAB_NOT_FOUND: 'GitLab 资源不存在，或当前令牌无权看到它。',
  GITLAB_CONFLICT: 'GitLab 资源当前状态不允许这次读取。',
  GITLAB_INVALID_ARGUMENT: 'GitLab 请求参数无效。',
  GITLAB_TEMPORARY: 'GitLab 服务暂时不可用，未自动重放。',
  GITLAB_API_FAILED: 'GitLab 请求失败，未自动重放。',
  GITHUB_AUTH_REQUIRED: 'GitHub 令牌无效或已被撤销，请更新系统凭据存储中的密钥。',
  GITHUB_PERMISSION_DENIED: 'GitHub 令牌权限不足，请检查仓库访问和只读权限。',
  GITHUB_RATE_LIMITED: 'GitHub 暂时限流，请按返回的重置时间稍后重试。',
  GITHUB_NOT_FOUND: 'GitHub 资源不存在，或当前令牌无权看到它。',
  GITHUB_CONFLICT: 'GitHub 资源当前状态不允许这次读取。',
  GITHUB_INVALID_ARGUMENT: 'GitHub 请求参数无效。',
  GITHUB_TEMPORARY: 'GitHub 服务暂时不可用，未自动重放。',
  GITHUB_API_FAILED: 'GitHub 请求失败，未自动重放。',
  LINEAR_AUTH_REQUIRED: 'Linear API 密钥无效或已被撤销，请更新系统凭据存储中的密钥。',
  LINEAR_PERMISSION_DENIED: 'Linear 密钥权限不足。',
  LINEAR_RATE_LIMITED: 'Linear 暂时限流，请稍后重试。',
  LINEAR_INVALID_ARGUMENT: 'Linear 请求参数无效。',
  LINEAR_TEMPORARY: 'Linear 服务暂时不可用，未自动重放。',
  LINEAR_API_FAILED: 'Linear 请求失败，未自动重放。',
  M365_PERMISSION_DENIED: 'Microsoft 365 权限不足，请检查管理员策略或重新授权。',
  M365_RATE_LIMITED: 'Microsoft Graph 暂时限流，请稍后重试。',
  GMAIL_PERMISSION_DENIED: 'Gmail 权限不足，请检查只读授权。',
  GMAIL_RATE_LIMITED: 'Gmail 暂时限流，请稍后重试。',
  GMAIL_API_FAILED: 'Gmail 读取失败，未自动重放。',
  M365_GRAPH_FAILED: 'Microsoft Graph 请求失败，未自动重放。',
  ABORT_ERR: '连接已取消。',
};

/**
 * A card identifies the connection, so its title is the instance and this line
 * carries the directory entry behind it. Titling a card with the provider name
 * makes three accounts of one service look like one row repeated.
 */
export const cardTitle = view => view.accountLabel || view.connectionId;
export const summaryLine = view => [view.displayName, view.origin].filter(Boolean).join(' · ');

/** The sentence a card shows, plus the narrowest recovery when one applies. */
export function explain(view, locale = 'zh') {
  if (locale === 'en') return [REASON_TEXT_EN[view.reason] ?? 'State needs verification.', NEXT_STEP_TEXT_EN[view.nextStep] ?? '', view.code ? PORTABLE_ERRORS_EN[view.code] ?? `Error: ${view.code}` : ''].filter(Boolean).join(' ');
  const reason = REASON_TEXT[view.reason] ?? '状态待确认。';
  const step = view.nextStep && view.nextStep !== 'none' ? NEXT_STEP_TEXT[view.nextStep] : '';
  const code = view.code ? ERROR_TEXT[view.code] ?? `错误代码：${view.code}` : '';
  return [reason, step, code].filter(Boolean).join(' ');
}

/**
 * Admitted and usable are different counts, and before discovery both are
 * zero while the server may still offer plenty. Saying "0/3 allowed" would
 * name a denominator that is not the allowlist at all.
 */
export function toolSummary(tools, locale = 'zh') {
  if (locale === 'en') {
    if (!tools) return 'Tool policy needs verification';
    const undeclared = tools.undeclared ?? 0;
    const admitted = tools.usable.length + tools.blocked.filter(item => item.reason !== 'not-host-allowed').length;
    if (!admitted) return undeclared ? `${undeclared} tools offered; none admitted` : 'No tools discovered yet';
    return [`${admitted} admitted; ${tools.usable.length} currently usable`, tools.needsApproval.length ? 'Each call requires approval' : '', undeclared ? `${undeclared} additional tools not admitted` : ''].filter(Boolean).join(' · ');
  }
  if (!tools) return '工具策略待确认';
  const undeclared = tools.undeclared ?? 0;
  const admitted = tools.usable.length + tools.blocked.filter(item => item.reason !== 'not-host-allowed').length;
  if (!admitted) return undeclared ? `服务提供 ${undeclared} 个工具，尚未允许任何一个` : '尚未发现可用工具';
  const parts = [`已允许 ${admitted} 个，其中 ${tools.usable.length} 个当前可用`];
  if (tools.needsApproval.length) parts.push('调用仍需逐次审批');
  if (undeclared) parts.push(`服务另有 ${undeclared} 个未允许`);
  return parts.join(' · ');
}

const PORTABLE_ERRORS_EN = {
  MCP_CREDENTIAL_RELEASE_FAILED: 'Credential session release is unconfirmed. Check the local state before retrying; no automatic replay.',
  MCP_CONTROL_RELEASE_UNCERTAIN: 'The configuration may have changed, but lock release is unconfirmed. Refresh and reconcile the actual state; no automatic replay.',
  MCP_CREDENTIAL_STORE_UNAVAILABLE: 'System credential storage is unavailable. Check the operating system encryption; Pero will not save secrets as plaintext.',
  MCP_CREDENTIAL_STORE_LOCKED: 'System credential storage is locked. Unlock it in the system, then retry.',
  MCP_CREDENTIAL_STORE_PROTOCOL: 'The credential provider returned an invalid response. The operation was stopped.',
  MCP_CREDENTIAL_STORE_CORRUPT: 'This connection’s credential record could not be read. Check system credential storage.',
  MCP_SECRET_LIMIT: 'The credential exceeds the storage limit and was not saved.',
  MCP_CREDENTIAL_SAVE_FAILED_NO_REPLAY: 'The service operation may have completed, but saving its credentials failed. Check the actual result before retrying; it was not replayed.',
  MCP_CREDENTIAL_CHANGE_APPLIED_INCOMPLETE: 'The credential change was partially applied. Refresh and check its state; it was not replayed.',
  MCP_CHANNEL_UNAVAILABLE: 'The channel runtime is unavailable on this device. Check the Pero installation.',
  MCP_PLATFORM_UNSUPPORTED: 'This native capability is unavailable on this platform.',
  CHANNEL_MODEL_CREDENTIAL_REQUIRED: 'The channel model credential is missing. Set DEEPSEEK_API_KEY in ~/.point/.credentials.yaml.',
};
const GMAIL_ERRORS_EN = { GMAIL_PERMISSION_DENIED: 'Gmail permission denied. Check read-only consent.', GMAIL_RATE_LIMITED: 'Gmail rate limit reached. Try later.', GMAIL_API_FAILED: 'Gmail read failed. No automatic replay.' };
export const errorText = (code, locale = 'zh') => locale === 'en' ? PORTABLE_ERRORS_EN[code] ?? GMAIL_ERRORS_EN[code] ?? `Operation failed (${code ?? 'MCP_ERROR'}). Nothing was replayed automatically.` : ERROR_TEXT[code] ?? `操作失败（${code ?? 'MCP_ERROR'}），未自动重放。`;
