// Deterministic ACP fixture. It reads synthetic prompt data and reports no real
// experiment, model request or scientific acceptance. ResearchStudy mode uses
// actual Host MCP tools to read sources and save explicitly synthetic reports.
import readline from 'node:readline';
import assert from 'node:assert/strict';
import { appendFileSync } from 'node:fs';

const capture = process.argv.find(value => value.startsWith('--capture='))?.slice('--capture='.length);
const send = value => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...value }) + '\n');
let active, server, controller, rpcId = 0;
const sessionId = 'synthetic-paper-fixture';
const contentText = block => {
  if (block?.type === 'text') return block.text ?? '';
  if (block?.type === 'resource') return block.resource?.text ?? '';
  return '';
};
const finish = stopReason => {
  if (active !== undefined) send({ id: active, result: { stopReason } });
  active = undefined;
};
const respond = value => {
  send({ method: 'session/update', params: { sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: JSON.stringify(value) } } } });
  finish('end_turn');
};
async function rpc(method, params, signal) {
  assert.ok(server, 'Host must supply the App MCP endpoint in session/new');
  const headers = Object.fromEntries(server.headers.map(header => [header.name, header.value]));
  const response = await fetch(server.url, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }), signal });
  assert.equal(response.status, 200);
  const reply = await response.json();
  assert.equal(reply.error, undefined, JSON.stringify(reply.error));
  return reply.result;
}
async function callTool(name, args, pointer, signal) {
  const toolCallId = `paper-mcp-${rpcId + 1}`;
  send({ method: 'session/update', params: { sessionId, update: { sessionUpdate: 'tool_call', toolCallId,
    title: name === 'app_write' ? `Paper research: ${args.document.action}` : name, kind: 'other', status: 'in_progress', rawInput: args } } });
  const result = await rpc('tools/call', { name, arguments: args }, signal);
  const text = result.content?.find(block => block.type === 'text')?.text ?? '';
  assert.notEqual(result.isError, true, text);
  const envelope = JSON.parse(text);
  let selected;
  if (envelope.type === 'content_reference') {
    assert.equal(envelope.read?.tool, 'content_read');
    assert.match(envelope.artifact?.id ?? '', /^[a-f0-9]{64}$/);
    let request = { id: envelope.artifact.id, pointer, maxBytes: 16384 }, end;
    const chunks = [];
    for (let count = 0; count < 16; count++) {
      const read = await rpc('tools/call', { name: 'content_read', arguments: request }, signal);
      assert.notEqual(read.isError, true);
      const match = /^Content ([a-f0-9]{64}), bytes (\d+)\.\.(\d+) of (\d+)\.\n([\s\S]*)\n(End of selection\.|Next read: (.*))$/.exec(read.content[0].text);
      assert.ok(match, 'content_read must return its selection envelope');
      assert.equal(match[1], envelope.artifact.id);
      if (end !== undefined) assert.equal(Number(match[2]), end);
      end = Number(match[3]); chunks.push(match[5]);
      if (match[6] === 'End of selection.') { selected = JSON.parse(chunks.join('')); break; }
      request = JSON.parse(match[7]);
    }
    assert.notEqual(selected, undefined, 'Fixture exceeded its bounded content selection reads');
  } else {
    selected = pointer.split('/').slice(1).reduce((value, key) => value[key], envelope);
  }
  send({ method: 'session/update', params: { sessionId, update: { sessionUpdate: 'tool_call_update', toolCallId,
    status: 'completed', rawOutput: { synthetic: true, selected: pointer, action: args.document?.action,
      page: args.document?.page, passageCount: selected?.passages?.length, reportId: typeof selected === 'string' ? selected : selected?.reportId } } } });
  return selected;
}
async function researchStudy(prompt, signal) {
  const context = JSON.parse(/\nResearch context:\n([\s\S]*)$/.exec(prompt)?.[1] ?? 'null');
  assert.ok(context?.studyId && context.sourceCatalog?.length, 'ResearchStudy needs its frozen source catalog');
  await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'synthetic-paper-fixture', version: '2' } }, signal);
  const declarations = await callTool('app_describe', {}, '/apps', signal);
  assert.ok(declarations.some(tool => tool.app === 'paper-agent' && tool.tool === 'research-step'));
  const source = context.sourceCatalog[0], steps = [], passages = [];
  const step = async (document, pointer = '/result/observation') => {
    const value = await callTool('app_write', { app: 'paper-agent', tool: 'research-step', document: { studyId: context.studyId, ...document } }, pointer, signal);
    steps.push({ action: document.action, page: document.page, start: document.start, passageId: document.passageId, selected: pointer });
    return value;
  };
  const pages = /Meta-Harness/i.test(source.title) && source.pageCount >= 5 ? [4, 5] : [1];
  const continuing = context.observedPassages?.length > 0;
  if (continuing) {
    const prior = context.observedPassages.find(passage => passage.paperId === source.paperId);
    assert.ok(prior, 'Continuation needs an observed passage from its frozen source');
    const observation = await step({ action: 'recall', passageId: prior.id });
    assert.equal(observation.passages[0].id, prior.id);
    passages.push(...observation.passages);
  } else {
    for (const page of pages) {
      let start = 0;
      do {
        const observation = await step({ action: 'read', paperId: source.paperId, page, start });
        assert.equal(observation.page, page);
        assert.ok(observation.passages.length);
        passages.push(...observation.passages);
        start = observation.nextStart;
      } while (start !== null);
    }
    if (context.question.includes('paper-fixture-pause')) {
      send({ method: 'session/update', params: { sessionId, update: { sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'Synthetic fixture paused after reading original pages; waiting for cancellation.' } } } });
      await new Promise((_resolve, reject) => {
        if (signal.aborted) reject(signal.reason);
        else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    }
    await step({ action: 'search', paperId: source.paperId, query: /Meta-Harness/i.test(source.title) ? 'execution traces' : 'evidence attention page' });
  }
  const passage = passages.find(p => p.content.split('\n').some(line => line.trim().length >= 40)) ?? passages[0];
  const quote = passage.content.split('\n').find(line => line.trim().length >= 40 && !line.startsWith('#')) ?? passage.content.trim().slice(0, 100);
  const evidence = { paperId: source.paperId, passageId: passage.id, quote };
  await step({ action: 'note', text: 'Synthetic fixture recorded original-page access; this is not a scientific finding.',
    gaps: ['Synthetic execution does not evaluate scientific conclusions.'], evidence: [evidence] }, '/result');
  const report = fixtureReport(context.studyId, { id: source.paperId }, passage, context.question, quote);
  const reportId = await step({ action: 'finalize', report }, '/result/reportId');
  assert.match(reportId, /^[a-f0-9]{64}$/);
  if (capture) appendFileSync(capture + '.mcp.jsonl', JSON.stringify({ synthetic: true, studyId: context.studyId,
    tools: ['app_describe', 'app_write'], pages, steps, reportId }) + '\n');
  return { synthetic: true, studyId: context.studyId, reportId, message: 'Synthetic report saved through Host MCP.' };
}
function fixtureReport(intentId, paper, passage, question, suppliedQuote) {
  const reference = passage ? { passageId: passage.id } : {};
  const lines = (passage?.content ?? paper.content).split('\n');
  const quote = suppliedQuote ?? lines.find(value => value.trim().length >= 40 && !value.startsWith('#')) ?? lines.find(value => value.trim() && !value.startsWith('#'));
  return {
    schema: 'pero.paper-agent-report.v1', intentId, title: passage ? 'PDF answer fixture' : 'Synthetic research report',
    sections: [{ heading: 'Fixture evidence', content: 'This **deterministic fixture** checks [source evidence](evidence:1).\n\n| Scope | Result |\n| --- | --- |\n| Synthetic | Not a research result |\n\nInline $x^2$ and block math:\n\n$$\nE = mc^2\n$$\n\n```python\nprint("synthetic only")\n```',
      paperIds: [paper.id], evidence: [{ paperId: paper.id, ...reference, quote: question.includes('paper-fixture-invalid') ? 'This invented quote is absent from the frozen source.' : quote }] }],
    matrix: { columns: [{ id: 'scope', label: 'Scope' }, { id: 'data', label: 'Dataset' }], cells: [
      { paperId: paper.id, columnId: 'scope', status: 'supported', value: 'Synthetic fixture only', evidence: [{ paperId: paper.id, ...reference, quote }] },
    ] },
    experiments: [], limitations: 'Synthetic fixture only. No model request or scientific experiment was performed. Scientific acceptance is unverified.',
  };
}
readline.createInterface({ input: process.stdin }).on('line', async line => {
  const { id, method, params } = JSON.parse(line);
  if (method === 'initialize') {
    send({ id, result: { protocolVersion: 1, agentCapabilities: { mcpCapabilities: { http: true }, promptCapabilities: { embeddedContext: true } }, agentInfo: { name: 'synthetic-paper-fixture', version: '1' } } });
  } else if (method === 'session/new') {
    server = params.mcpServers?.find(item => item.type === 'http' && item.name === 'pero-app-use');
    send({ id, result: { sessionId, configOptions: [] } });
  } else if (method === 'session/prompt') {
    active = id; controller = new AbortController();
    const blocks = params.prompt.map(contentText), prompt = blocks.join('\n');
    const question = /(?:^|\n)Question: ([^\n]*)/.exec(prompt)?.[1] ?? prompt;
    if (capture) appendFileSync(capture, JSON.stringify({ synthetic: true, wait: question.includes('paper-fixture-wait'), invalid: question.includes('paper-fixture-invalid') }) + '\n');
    if (question.includes('paper-fixture-wait')) return;
    try {
      if (prompt.includes('ResearchStudy:')) {
        const result = await researchStudy(blocks.find(block => block.includes('ResearchStudy:')), controller.signal);
        if (active === id) respond(result);
        return;
      }
      if (prompt.includes('Prepare a lexical search')) {
        respond({ query: prompt.includes('Meta-Harness') ? 'harness proposer execution traces' : prompt.includes('Attention Is All You Need') ? 'attention mechanism' : 'Second page' });
        return;
      }
      if (prompt.includes('Select and reorder PDF evidence')) {
        const passages = JSON.parse(/\nPassages: ([\s\S]*)$/.exec(prompt)[1]);
        respond({ passageIds: passages.slice(0,2).map(p => p.id), followupQuery: null, gaps: [] });
        return;
      }
      const intentId = /Frozen input: ([a-f0-9]{64})/.exec(prompt)?.[1];
      const sourceText = /\nSources:\n([\s\S]*?)\nReturn ONLY JSON:/.exec(prompt)?.[1];
      const papers = JSON.parse(sourceText);
      if (!intentId || !papers.length) throw new Error('Missing frozen research input');
      respond(fixtureReport(intentId, papers[0], papers[0].passages?.[0], question));
    } catch (error) {
      if (active !== id) return;
      send({ id, error: { code: -32602, message: error.message } }); active = undefined;
    }
  } else if (method === 'session/cancel') {
    controller?.abort();
    finish('cancelled');
  } else if (id !== undefined) {
    send({ id, error: { code: -32601, message: 'Unsupported fixture operation' } });
  }
});
