import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FeishuError } from './client.mjs';
const fail = code => { throw new FeishuError(code); };
const token = v => typeof v === 'string' && /^[A-Za-z0-9]{10,128}$/.test(v);
const table = v => typeof v === 'string' && /^tbl[A-Za-z0-9]{3,125}$/.test(v);
const field = v => typeof v === 'string' && /^fld[A-Za-z0-9]{3,125}$/.test(v);
const fields = (v, names) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).every(k => names.includes(k));
const digest = v => 'sha256:' + createHash('sha256').update(JSON.stringify(v)).digest('hex');
export const BASE_READ_SCOPES = ['base:table:read', 'base:field:read'];
export const BASE_WRITE_SCOPES = [...BASE_READ_SCOPES, 'base:record:create'];
async function consent(client, scopes, options) {
  const account = await client.account(options);
  if (!account.tenantId || !scopes.every(s => account.scopes.includes(s))) fail('FEISHU_PERMISSION');
  return account;
}
export async function baseTables(input, options = {}) {
  if (!fields(input, ['baseToken']) || !token(input.baseToken)) fail('FEISHU_ARGUMENT');
  await consent(this, BASE_READ_SCOPES.slice(0, 1), options);
  const result = await this.read(['base', '+table-list', '--as', 'user', '--base-token', input.baseToken, '--format', 'json'], options);
  const items = result.data.tables ?? result.data.items;
  if (!Array.isArray(items) || items.length > 300) fail('FEISHU_RESPONSE');
  return { ...result, data: { items: items.map(t => {
    const id = t.table_id ?? t.id;
    if (!table(id) || typeof t.name !== 'string') fail('FEISHU_RESPONSE');
    return { id, name: t.name.slice(0, 160) };
  }) } };
}
export async function baseFields(input, options = {}) {
  if (!fields(input, ['baseToken', 'tableId']) || !token(input.baseToken) || !table(input.tableId)) fail('FEISHU_ARGUMENT');
  await consent(this, BASE_READ_SCOPES, options);
  const result = await this.read(['base', '+field-list', '--as', 'user', '--base-token', input.baseToken, '--table-id', input.tableId, '--format', 'json'], options);
  const items = result.data.fields ?? result.data.items;
  if (!Array.isArray(items) || items.length > 300) fail('FEISHU_RESPONSE');
  const schema = items.map(f => {
    const id = f.field_id ?? f.id, name = f.field_name ?? f.name;
    if (!field(id) || typeof name !== 'string') fail('FEISHU_RESPONSE');
    // Typed Base CLI uses named types. Limit mappings to ordinary text fields.
    return { id, name: name.slice(0, 160), type: f.type, style: f.style?.type ?? 'plain', writable: f.type === 'text' && (!f.style?.type || f.style.type === 'plain') && !f.is_computed && !f.readonly };
  }).sort((a, b) => a.id.localeCompare(b.id));
  return { ...result, data: { items: schema, schemaDigest: digest(schema) } };
}
export async function baseRecordCreate(input, options = {}) {
  if (!fields(input, ['baseToken', 'tableId', 'schemaDigest', 'values']) || !token(input.baseToken) || !table(input.tableId) || !/^sha256:[a-f0-9]{64}$/.test(input.schemaDigest ?? '') || !fields(input.values, Object.keys(input.values ?? {}))) fail('FEISHU_ARGUMENT');
  const entries = Object.entries(input.values);
  if (entries.length !== 4 || entries.some(([k, v]) => !field(k) || typeof v !== 'string' || !v.length || Buffer.byteLength(v) > 4000)) fail('FEISHU_ARGUMENT');
  const account = await consent(this, BASE_WRITE_SCOPES, options);
  const schema = await baseFields.call(this, { baseToken: input.baseToken, tableId: input.tableId }, options);
  if (schema.data.schemaDigest !== input.schemaDigest || entries.some(([id]) => !schema.data.items.some(f => f.id === id && f.writable))) fail('FEISHU_BASE_SCHEMA_CHANGED');
  // Exactly one record, fixed command and identity. Never take a URL, method or shell from an Agent.
  const temp=await mkdtemp(join(tmpdir(),'point-feishu-base-'));
  let response;try{
    await writeFile(join(temp,'record.json'),JSON.stringify({create_records:[input.values]}),{mode:0o600});
    response=await this.run(['base','+record-batch-create','--as','user','--base-token',input.baseToken,'--table-id',input.tableId,'--format','json','--json','@record.json'],{...options,cwd:temp});
  }finally{await rm(temp,{recursive:true,force:true})}
  const ids = response?.data?.record_id_list;
  if (response?.ok !== true || response.identity !== 'user' || !Array.isArray(ids) || ids.length !== 1 || !/^rec[A-Za-z0-9]{3,125}$/.test(ids[0])) fail('FEISHU_WRITE_UNKNOWN');
  const receipt = { recordId: ids[0], baseToken: input.baseToken, tableId: input.tableId, valuesDigest: digest(input.values), createdAt: new Date().toISOString(), url: `https://www.feishu.cn/base/${input.baseToken}?table=${input.tableId}&record=${ids[0]}` };
  // A known record ID survives a post-write identity failure; callers must not retry.
  try { await this.account(options); } catch { return { account, receipt, outcome: 'created-unverified' }; }
  return { account, receipt, outcome: Array.isArray(response.data.ignored_fields)&&response.data.ignored_fields.length ? 'created-unverified' : 'created' };
}
