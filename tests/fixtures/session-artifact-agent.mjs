// Native UI acceptance fixture. Real files and Host/MCP calls; no model or external network.
import { createInterface } from 'node:readline';
import { mkdir, readFile, writeFile, appendFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { richArtifactFiles } from './session-artifact-files.mjs';

const argument = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const output = argument('output');
if (!output) throw new Error('--output is required');
await mkdir(output, { recursive: true });
const statePath = resolve(output, 'agent-state.json');
const send = value => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...value }) + '\n');
let workspace, endpoint, active;
const notify = update => send({ method: 'session/update', params: { sessionId: 'artifact-fixture', update } });
const text = value => ({ type: 'content', content: { type: 'text', text: value } });

async function run(id, params) {
  active = id;
  const prompt = JSON.stringify(params.prompt);
  await appendFile(resolve(output, 'prompts.jsonl'), prompt + '\n');
  const state = await readFile(statePath, 'utf8').then(JSON.parse, () => ({ revision: 0 }));
  if (!endpoint) throw new Error('The real Host did not supply its artifact MCP endpoint');
  const callTool = (name, args, requestId) => fetch(endpoint.url, {
    method: 'POST', headers: { ...Object.fromEntries(endpoint.headers.map(header => [header.name, header.value])), 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: requestId, method: 'tools/call', params: { name, arguments: args } }),
  }).then(response => response.json()).then(result => {
    if (result.error || result.result?.isError) throw new Error(JSON.stringify(result));
    return JSON.parse(result.result.content[0].text);
  });
  const existing = /show existing v(\d+) (inline|below)/i.exec(prompt);
  if (existing) {
    await callTool('present_artifact', { artifact_id: state.artifact_id, version: Number(existing[1]), presentation: existing[2] }, id);
    notify({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: `Displayed report.md v${existing[1]}.` } });
    send({ id, result: { stopReason: 'end_turn' } }); active = undefined;
    return;
  }
  const revision = state.revision + 1;
  const contents = `# 产物区验证报告\n\n这是 Native 界面验收使用的合成记录。\n\n版本：${revision}\n\n| 项目 | 数值 |\n| --- | --- |\n| 示例结果 | ${revision === 1 ? 7 : 9} |\n\n未执行科学实验，没有调用真实模型。\n`;
  const rich = /rich|丰富|多模态|图片|PDF|Notebook|表格|HTML/i.test(prompt);
  const presentation = /present (inline|below|side|expanded)/i.exec(prompt)?.[1].toLowerCase();
  const prior = /with previous input/i.test(prompt) ? state.delivered?.[0] : undefined;
  const files = rich ? richArtifactFiles(revision) : [{ name: 'report.md', title: '验证报告', data: Buffer.from(contents) }];
  const media = /present (?:inline|below|side|expanded) (notebook|image)/i.exec(prompt)?.[1].toLowerCase();
  const previewFile = media === 'notebook' ? 'analysis.ipynb' : media === 'image' ? 'chart.png' : files[0].name;
  const artifacts = { ...(state.artifacts || {}), ...(state.artifact_id ? { 'report.md': state.artifact_id } : {}) };
  const delivered = [];
  for (const [index, file] of files.entries()) {
    const path = resolve(workspace, file.name);
    const editId = `write-${index}-${revision}`, deliveryId = `deliver-${index}-${revision}`;
    notify({ sessionUpdate: 'tool_call', toolCallId: editId, title: `保存 ${file.name}`, kind: 'edit', status: 'in_progress', locations: [{ path }] });
    await writeFile(path, file.data);
    notify({ sessionUpdate: 'tool_call_update', toolCallId: editId, status: 'completed', content: [text(`Saved ${file.name} in the acceptance workspace.`)] });
    notify({ sessionUpdate: 'tool_call', toolCallId: deliveryId, title: 'deliver_artifact', kind: 'other', status: 'in_progress' });
    const sidecar = `${path}.pero-run.json`;
    const external = index === 0 && /external run/i.test(prompt);
    if (external) {
      const digest = value => createHash('sha256').update(value).digest('hex');
      const evidence = await Promise.all([
        { path: 'solver.log', role: 'execution_log', text: 'Solver finished with residual 0.001.\n' },
        { path: 'environment.json', role: 'environment', text: '{"engine":"local-fixture"}\n' },
        { path: 'review.md', role: 'review', text: '# Review notes\n\nCheck mesh convergence.\n' },
      ].map(async ({ path, role, text }) => {
        await writeFile(resolve(workspace, path), text);
        return { path, role, sha256: digest(text) };
      }));
      await writeFile(sidecar, JSON.stringify({ schema_version: 1, system: 'fixture-solver', run_id: `run-${revision}`,
        outcome: 'succeeded', output_sha256: digest(file.data), evidence }));
    }
    const receipt = await callTool('deliver_artifact', {
      path, title: file.title, ...(artifacts[file.name] ? { artifact_id: artifacts[file.name] } : {}),
      ...(file.name === previewFile && presentation ? { presentation } : {}),
      ...(index === 0 && prior ? { related: [{ artifact_id: prior.id, version: prior.version.version, role: 'input' }] } : {}),
    }, revision * 100 + index);
    if (external) await rm(sidecar);
    notify({ sessionUpdate: 'tool_call_update', toolCallId: deliveryId, status: 'completed', content: [text(JSON.stringify(receipt))] });
    artifacts[file.name] = receipt.artifact.id;
    delivered.push({ name: file.name, id: receipt.artifact.id, version: receipt.artifact.versions.at(-1) });
  }
  await writeFile(statePath, JSON.stringify({ revision, artifact_id: artifacts['report.md'], artifacts, delivered, workspace,
    sawFrozenContext: prompt.includes('session-artifact:'), rich }));
  notify({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: `## ${rich ? '丰富产物' : '验证报告'}已保存\n\n第 ${revision} 次交付已完成：${files.map(file => file.name).join('、')}。${revision > 1 ? '同名产物保存了新版本，旧版本保持不变。' : '可以预览、返回交付工具，或加入提问继续修改。'}\n\n这是本地 ACP fixture 验收，没有调用真实模型，也未执行科学实验。` } });
  if (active === id) { send({ id, result: { stopReason: 'end_turn' } }); active = undefined; }
}

createInterface({ input: process.stdin }).on('line', line => {
  const { id, method, params } = JSON.parse(line);
  if (method === 'initialize') send({ id, result: { protocolVersion: 1, agentCapabilities: { mcpCapabilities: { http: true }, promptCapabilities: { image: true, embeddedContext: true } }, agentInfo: { name: 'Artifact acceptance fixture', version: '1' } } });
  else if (method === 'session/new') {
    workspace = params.cwd;
    endpoint = params.mcpServers?.find(server => server.type === 'http' && server.name === 'pero-app-use');
    send({ id, result: { sessionId: 'artifact-fixture' } });
  } else if (method === 'session/prompt') void run(id, params).catch(error => {
    notify({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: `Acceptance error: ${error.message}` } });
    send({ id, result: { stopReason: 'end_turn' } }); active = undefined;
  });
  else if (method === 'session/cancel') { if (active !== undefined) send({ id: active, result: { stopReason: 'cancelled' } }); active = undefined; }
  else if (id !== undefined) send({ id, error: { code: -32601, message: 'Method not found' } });
});
