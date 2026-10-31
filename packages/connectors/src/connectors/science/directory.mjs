import { scienceSpecs, scienceVersion } from './specs.mjs';

export function scienceDirectory() {
  return scienceSpecs.map(spec => ({
    providerId: spec.providerId, displayName: spec.displayName, summary: spec.summary, summaryEn: spec.summaryEn, iconId: spec.iconId,
    category: 'research', transport: 'stdio', deployment: 'local-process',
    docsUrl: 'https://claude.com/docs/claude-science/connectors-and-skills',
    auth: { mode: 'none', registration: 'none', credentialHolder: 'native-keychain' },
    prerequisiteCopy: spec.domain === 'ketcher' ? '分子编辑器尚待资源适配，当前只提供评估条目。' : `需本机安装 Claude Science ${scienceVersion} 与 Node.js；检测后固定服务文件和 Python 校验。${spec.domain === 'pubmed' ? '另需填写 NCBI 联系邮箱。' : ''}`,
    prerequisiteEn: spec.domain === 'ketcher' ? 'The molecular editor needs resource adaptation; currently listed for review only.' : `Requires local Claude Science ${scienceVersion} and Node.js. Discovery pins server files and Python.${spec.domain === 'pubmed' ? ' Also enter your NCBI contact email.' : ''}`,
    gotchaCopy: spec.domain === 'ketcher' ? '界面资源超过 26 MB，超出 Point 的 1 MiB MCP 帧限制；当前仅列入评估目录。'
      : `查询会发送到对应数据源。仅允许已核对的 ${spec.tools.length} 个工具；保留上游许可限制。${spec.domain === 'literature' ? 'OpenAlex 搜索需在高级配置单独绑定 OPENALEX_API_KEY 的 secretRef。' : spec.domain === 'pubmed' ? '需填写 NCBI 联系邮箱；可另行绑定 NCBI_API_KEY 的 secretRef。' : ''}`,
    gotchaEn: spec.domain === 'ketcher' ? 'The UI resource exceeds 26 MB and Point’s 1 MiB MCP frame limit. Listed for review only.'
      : `Queries are sent to the source databases. Only ${spec.tools.length} reviewed tools are allowed; upstream license restrictions remain.${spec.domain === 'literature' ? ' Bind your own OPENALEX_API_KEY secretRef in advanced configuration for OpenAlex search.' : spec.domain === 'pubmed' ? ' Enter your NCBI contact email; optionally bind an NCBI_API_KEY secretRef.' : ''}`,
    requires: [{ key: 'command', kind: 'path', required: true }, { key: 'sha256', kind: 'text', required: true }, { key: 'tools', kind: 'text' }],
    operations: spec.tools.map(tool => ({ tool, effect: spec.domain === 'ketcher' ? 'write' : 'read', helpId: spec.domain === 'ketcher' ? 'research.execute' : 'research.read' })), defaultTools: spec.domain === 'ketcher' ? [] : [...spec.tools],
    ...(spec.domain === 'ketcher' ? { listed: true, catalogStage: 'review' } : { discovery: { executables: ['node'] } }),
    stdioTemplate: { args: [], callTimeoutMs: 45000, initializeTimeoutMs: 45000 },
    installHint: 'https://claude.com/product/claude-science',
    multipleConnections: true, verifiable: true, launchGatePassed: false, preregistered: spec.domain !== 'ketcher',
  }));
}
