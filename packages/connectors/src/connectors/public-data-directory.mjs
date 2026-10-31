import { publicDataSpecs } from './public-data-specs.mjs';

// Public hosted MCPs use the existing Host-managed HTTP connection lifecycle.
// A reviewed directory entry neither installs a connection nor authorizes a call.
export function publicDataDirectory() {
  return publicDataSpecs.map(spec => {
    // brapi_connect accepts password/token/client-secret values in model-visible
    // arguments. It cannot participate in Point's Host-owned credential flow.
    const operations = spec.operations.filter(operation => operation.tool !== 'brapi_connect');
    const blocked = spec.providerId === 'cyanheads-brapi';
    return ({
    providerId: spec.providerId, displayName: spec.displayName,
    category: 'research', transport: 'http', iconId: 'evidence',
    endpoint: spec.endpoint, docsUrl: spec.repository,
    summary: spec.summary, summaryEn: spec.summaryEn,
    prerequisiteCopy: '社区维护的公开远程 MCP。无需 BioBase 账号；工具输入会发送给 cyanheads 托管服务。',
    prerequisiteEn: 'Public remote MCP maintained by the community. No BioBase account is required; tool inputs go to the cyanheads hosted service.',
    gotchaCopy: spec.providerId === 'cyanheads-brapi'
      ? '上游尚未配置公开数据源，查询返回 unknown_alias。凭据型连接工具不开放，当前仅提供文档。'
      : '默认仅允许已审查的读取工具。保留原数据库引用；远程版本、访问频率与数据许可由上游管理。',
    gotchaEn: spec.providerId === 'cyanheads-brapi'
      ? 'The hosted server has no public source configured; queries return unknown_alias. Credential-bearing connection tools are unavailable. Documentation only.'
      : 'Only reviewed read tools are allowed by default. Retain database citations; remote versions, rate limits, and data licenses are managed upstream.',
    auth: { mode: 'none', registration: 'none', credentialHolder: 'native-keychain' },
    requires: [{ key: 'url', kind: 'url', required: true }, { key: 'tools', kind: 'text' }],
    operations: operations.map(operation => ({ ...operation, helpId: 'research.evidence' })),
    defaultTools: blocked ? [] : operations.filter(operation => operation.effect === 'read').map(operation => operation.tool),
    deployment: 'remote-service', multipleConnections: true, verifiable: true,
    preregistered: !blocked, launchGatePassed: false,
    ...(blocked ? {listed:true,catalogStage:'review'} : {}),
    });
  });
}

const endpoints = new Map(publicDataSpecs.map(spec => [spec.endpoint, spec.providerId]));

// Exact matching preserves provenance: a lookalike host or an arbitrary custom
// endpoint must continue to resolve as a custom connector.
export function publicDataProviderId(definition) {
  return definition?.transport === 'http' ? endpoints.get(definition.url) ?? null : null;
}
