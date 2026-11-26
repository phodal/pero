// Scripted inference seam, not evidence of any LLM decision or visual ability.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { setTimeout as pause } from 'node:timers/promises';
import { scenes } from './scenarios.mjs';

const skillName = 'research-resource-import';
const alias = name => `mcp__pero-app-use__app__paper-agent__${name}`;
function* invoke(name, args, pointer = '', text) {
  const raw = yield { name, args, text };
  assert(!String(raw).startsWith('tool approval '), `Fixture tool denied before dispatch: ${name}: ${raw}`);
  let value = JSON.parse(raw);
  if (value.type === 'content_reference') {
    let request = { id: value.artifact.id, pointer, maxBytes: 16384 };
    const chunks = [];
    while (request) {
      const chunk = yield { name: 'mcp__pero-app-use__content_read', args: request };
      const match = /^Content ([a-f0-9]{64}), bytes (\d+)\.\.(\d+) of (\d+)\.\n([\s\S]*)\n(End of selection\.|Next read: (.*))$/.exec(chunk);
      assert(match, 'Expected real content_read envelope');
      chunks.push(match[5]); request = match[7] ? JSON.parse(match[7]) : undefined;
    }
    value = JSON.parse(chunks.join(''));
  } else if (pointer) value = pointer.split('/').slice(1).reduce((node, key) => node[key], value);
  return value;
}
const write = function* (name, args, text) { return yield* invoke(alias(name), args, '/result', text); };

export function* plan(scene, digest) {
  const spec = scenes[scene];
  if (!spec.explicitSkill) {
    const catalog = yield* invoke('skill', {});
    assert.equal(catalog.find(item => item.name === skillName)?.digest, digest);
    const skill = yield* invoke('skill', { name: skillName, digest });
    assert(skill.content.includes('research-source-read'));
  }
  let draft = yield* write('inspect-research-link', { url: spec.seed });
  while (draft.status === 'inspecting') draft = yield* write('inspect-research-link', { draftId: draft.id });
  assert.equal(draft.status, 'ready');
  if (spec.analysis) {
    const context = yield* write('research-analysis', { operation: 'context', draftId: draft.id });
    const conservative = scene === 'nonstandard-decline';
    const link = context.pages.flatMap(page => page.links).find(link => conservative
      ? link.href.endsWith('/files/methods.tgz') : link.href.includes('/attachments?'));
    assert(link);
    draft = yield* write('research-analysis', { operation: 'propose', draftId: draft.id, draftDigest: context.draftDigest,
      proposals: [{ evidenceId: link.id, kind: 'source_archive', title: 'Unverified source candidate', reason: 'Observed link; format and identity not verified' }] });
    if (conservative) assert(!draft.resources.some(resource => resource.originalUrl === 'https://research.example.org/attachments?id=methods'),
      'Conservative fixture must leave the ambiguous link unclassified');
    const candidate = draft.resources.find(resource => resource.originalUrl === link.href);
    assert.equal(candidate.confidence, 'unresolved'); assert.equal(candidate.workIdentity, null); assert.equal(candidate.revision, null);
  }
  const selection = { draftId: draft.id, resourceIds: draft.resources.map(resource => resource.id) };
  const review = 'Synthetic protocol review (not model inference): ' + JSON.stringify(draft.resources);
  let bundle;
  if (spec.inspectOnly) {
    yield { answer: review + ' Inspection only: no bundle saved or downloads authorized.' };
    if (spec.decline) return 'User declined: no references saved, no grants or file bytes acquired. Identity and version remain unresolved.';
  } else {
    bundle = yield* write('commit-research-bundle', selection, review);
    assert.deepEqual(bundle.sourceDownloadIds, []); assert.deepEqual(bundle.pdfDownloadIds, []);
  }
  if (!spec.source) return 'Synthetic protocol completed: unresolved observed attachment saved; no download or page-granted authority.';
  if (!spec.inspectOnly) yield { answer: 'Synthetic protocol stopped at references. Exact source/PDF acquisition still requires next user confirmation.' };
  const source = draft.resources.find(resource => resource.kind === 'source_archive' && (!spec.sourceURL || resource.originalUrl === spec.sourceURL));
  const pdf = draft.resources.find(resource => resource.kind === 'pdf_candidate');
  if (!spec.publicRecording) {
    assert.equal(source?.originalUrl, spec.sourceURL || `https://arxiv.org/src/${spec.version}`);
    if (spec.pdf) assert.equal(pdf?.originalUrl, `https://arxiv.org/pdf/${spec.version}`);
    selection.resourceIds = [source.id, ...(spec.pdf ? [pdf.id] : [])];
  }
  bundle = yield* write('commit-research-bundle', { ...selection, sourceIds: [source.id], pdfIds: spec.pdf ? [pdf.id] : [], confirmedDownloads: true });
  const base = { bundleId: bundle.id, resourceId: source.id };
  let job = yield* write('research-source', { ...base, operation: 'start' });
  while (['running'].includes(job.status)) job = yield* write('research-source', { ...base, operation: 'status' });
  assert.equal(job.status, 'source_available');
  const members = yield* write('research-source-read', { ...base, operation: 'list' });
  const tex = members.members.find(member => member.path === 'main.tex');
  for (const [startLine, endLine] of spec.readRanges || [[1, Math.min(tex.lineCount, 39)]]) {
    const read = yield* write('research-source-read', { ...base, operation: 'read', memberId: tex.id, startLine, endLine });
    assert.equal(read.memberDigest, tex.sha256); assert.equal(read.archiveDigest, job.receipt.archiveDigest);
  }
  const inspectImage = function* () {
    const image = members.members.find(member => spec.imagePath ? member.path === spec.imagePath : member.kind === 'image');
    const observed = yield* write('research-source-read', { ...base, operation: 'image', memberId: image.id });
    assert.equal(observed.type, 'source_image'); assert.equal(observed.provenance.memberId, image.id);
    return 'Synthetic wire probe received typed image input; scripted fixture makes no visual understanding claim.';
  }
  if (spec.vision && !spec.pdf) return yield* inspectImage();
  if (!spec.pdf) {
    assert.equal(job.receipt.workIdentity, null); assert.equal(job.receipt.revision, null);
    return 'Synthetic nonstandard protocol completed explicit source-only acquisition and actual original lines. Work identity, release version and license remain unknown; byte SHA is not an inferred paper version.';
  }
  const pdfBase = { bundleId: bundle.id, resourceId: pdf.id };
  let pdfJob = yield* write('research-pdf', { ...pdfBase, operation: 'start' });
  while (['running'].includes(pdfJob.status)) pdfJob = yield* write('research-pdf', { ...pdfBase, operation: 'status' });
  assert.equal(pdfJob.status, 'completed');
  const comparison = yield* write('research-source-read', { ...base, operation: 'compare', pdfResourceId: pdf.id });
  assert.equal(comparison.status, 'matched'); assert(comparison.matches.length > 0);
  const prepared = yield* write('prepare-research', { question: 'Read the authored synthetic caption; no scientific conclusion.', paperIds: [pdfJob.receipt.paperId], requestId: 'fixture-source-study', fullText: true });
  const prompt = typeof prepared === 'string' ? prepared : prepared.prompt;
  const context = JSON.parse(prompt.split('Research context:\n')[1]);
  const reading = yield* write('research-step', { studyId: context.studyId, action: 'read', paperId: pdfJob.receipt.paperId, page: 1, start: 0 });
  const passage = reading.observation.passages[0];
  const saved = yield* write('research-step', { studyId: context.studyId, action: 'finalize', report: {
    title: 'Authored fixture reading', sections: [{ heading: 'Observed caption', content: 'The synthetic PDF contains the source caption.', paperIds: [pdfJob.receipt.paperId],
      evidence: [{ paperId: pdfJob.receipt.paperId, passageId: passage.id, quote: spec.caption || 'Synthetic source figure.' }] }], experiments: [], limitations: 'Synthetic transport and scripted provider only; no scientific verification.' } });
  assert(saved.observation);
  if (spec.vision) return yield* inspectImage();
  return 'Synthetic protocol completed source lines, literal PDF comparison and validated PDF passage report; not LLM evidence.';
}

export function verifyFirstSkillInput(body, skillBody) {
  assert(typeof skillBody === 'string' && skillBody.length > 0, 'Expected exact installed Skill body');
  const expected = `<skill_content name="${skillName}">\n${skillBody}\n</skill_content>`;
  assert(body.messages.some(message => message.role === 'user' &&
    (typeof message.content === 'string' ? message.content === expected :
      message.content?.some(block => block.type === 'text' && block.text === expected))),
    'First provider request must contain actual Go-injected Skill instructions');
}

// Keep one scripted trajectory for both protocols; only decode/encode the wire here.
function reply(response, messages, body, delta, finish) {
  response.writeHead(200, { 'Content-Type': 'text/event-stream' });
  if (!messages) {
    response.end(`data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: finish }] })}\n\ndata: [DONE]\n\n`);
    return;
  }
  const send = value => response.write(`event: ${value.type}\ndata: ${JSON.stringify(value)}\n\n`);
  send({ type: 'message_start', message: { id: 'paper-fixture', type: 'message', role: 'assistant',
    model: body.model, content: [], usage: { input_tokens: 1, output_tokens: 0 } } });
  let index = 0;
  if (delta.content) {
    send({ type: 'content_block_start', index, content_block: { type: 'text', text: '' } });
    send({ type: 'content_block_delta', index, delta: { type: 'text_delta', text: delta.content } });
    send({ type: 'content_block_stop', index: index++ });
  }
  for (const call of delta.tool_calls ?? []) {
    send({ type: 'content_block_start', index, content_block: { type: 'tool_use', id: call.id, name: call.function.name, input: {} } });
    send({ type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: call.function.arguments } });
    send({ type: 'content_block_stop', index: index++ });
  }
  send({ type: 'message_delta', delta: { stop_reason: finish === 'stop' ? 'end_turn' : 'tool_use' }, usage: { output_tokens: 1 } });
  send({ type: 'message_stop' });
  response.end();
}

export async function startFixtureProvider(scene, digest, skillBody, fixtureApproval) {
  const spec = scenes[scene], iterator = plan(scene, digest), errors = [];
  const messages = spec.files === true, fileID = 'file-paper-fixture';
  const beta = 'files-api-2025-04-14';
  let upload, uploadCount = 0, imageToolID;
  let requests = 0, imageRequests = 0, firstProviderSkillContent = false;
  const server = createServer(async (request, response) => {
    try {
      assert.equal(request.method, 'POST');
      assert.equal(messages ? request.headers['x-api-key'] : request.headers.authorization,
        messages ? 'local-paper-study-fixture' : 'Bearer local-paper-study-fixture');
      let length = 0;
      const chunks = [];
      for await (const chunk of request) {
        length += chunk.length;
        assert(length <= 8 * 1024 * 1024, 'Fixture request exceeded its bound');
        chunks.push(chunk);
      }
      const raw = Buffer.concat(chunks);
      if (messages && request.url === '/v1/files') {
        assert(imageToolID, 'Only the explicitly requested Paper image can upload');
        assert.equal(++uploadCount, 1, 'A single preview should upload exactly once');
        assert.equal(request.headers['anthropic-beta'], beta);
        const form = await new Response(raw, { headers: { 'Content-Type': request.headers['content-type'] } }).formData();
        const file = form.get('file');
        assert(file instanceof File && file.type === 'image/png');
        assert.equal(form.get('expires_after[anchor]'), 'created_at');
        upload = Buffer.from(await file.arrayBuffer());
        response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({
          id: fileID, type: 'file', mime_type: file.type, filename: file.name, size_bytes: file.size, created_at: new Date().toISOString(),
        }));
        return;
      }
      assert.equal(request.url, messages ? '/v1/messages' : '/v1/chat/completions');
      const body = JSON.parse(raw); requests++;
      const advertised = name => body.tools.some(tool => (messages ? tool.name : tool.function.name) === name);
      if (requests === 1 && scenes[scene].explicitSkill) { verifyFirstSkillInput(body, skillBody); firstProviderSkillContent = true; }
      assert.equal(body.max_tokens, messages ? 1024 : undefined);
      if (scenes[scene].publicRecording) for (const name of ['import-paper', 'prepare-research', 'research-pdf', 'research-assets'])
        assert(!advertised(alias(name)), 'Public replay must not advertise unrelated access');
      let last = body.messages.filter(message => message.role === 'tool').at(-1)?.content;
      if (messages) {
        const latest = body.messages.at(-1);
        const result = latest.role === 'user' && latest.content.findLast(block => block.type === 'tool_result');
        const blocks = result?.content;
        const images = blocks?.filter(block => block.type === 'image') ?? [];
        if (images.length) {
          assert.equal(result.tool_use_id, imageToolID, 'Files input must stay inside its matching Paper tool result');
          assert.equal(request.headers['anthropic-beta'], beta);
          assert.deepEqual(images.map(block => block.source), [{ type: 'file', file_id: fileID }]);
          assert(upload, 'Messages referenced a file before uploading it');
          last = [...blocks.filter(block => block.type === 'text'),
            { type: 'image_url', image_url: { url: 'data:image/png;base64,' + upload.toString('base64') } }];
        } else {
          assert.notEqual(result?.tool_use_id, imageToolID || null, 'Paper image tool result lost its Files input');
          last = blocks?.filter(block => block.type === 'text').map(block => block.text).join('');
        }
      }
      if (Array.isArray(last)) {
        const images = last.filter(part => part.type === 'image_url');
        assert(images.length === 1 && images[0].image_url.url.startsWith('data:image/png;base64,'));
        const bytes = Buffer.from(images[0].image_url.url.split(',')[1], 'base64');
        const [width, height] = scenes[scene].imageSize || [256, 256];
        assert.equal(bytes.readUInt32BE(16), width); assert.equal(bytes.readUInt32BE(20), height);
        if (scenes[scene].imageSHA) assert.equal(createHash('sha256').update(bytes).digest('hex'), scenes[scene].imageSHA);
        imageRequests++;
      }
      if (typeof last === 'string' && last.startsWith('tool approval ')) {
        errors.push(`Fixture tool denied before dispatch: ${last}`);
        reply(response, messages, body, { content: 'Synthetic trajectory stopped: tool permission denied; no retry.' }, 'stop');
        return;
      }
      const step = iterator.next(Array.isArray(last) ? last.filter(part => part.type === 'text').map(part => part.text).join('') : last);
      let delta, finish_reason;
      if (step.done || step.value.answer) { delta = { content: step.done ? step.value : step.value.answer }; finish_reason = 'stop'; }
      else {
        const call = step.value;
        fixtureApproval?.expect(`fixture-${requests}`, call.name, call.args);
        assert(advertised(call.name), `Not advertised: ${call.name}`);
        if (call.name === alias('research-source-read') && call.args.operation === 'image') imageToolID = `fixture-${requests}`;
        if (call.args.operation === 'status' || call.args.draftId) await pause(50); // Poll an actual external worker condition.
        delta = { ...(call.text ? { content: call.text } : {}), tool_calls: [{ index: 0, id: `fixture-${requests}`, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.args) } }] };
        finish_reason = 'tool_calls';
      }
      reply(response, messages, body, delta, finish_reason);
    } catch (error) { errors.push(error.stack); response.writeHead(500).end('Synthetic fixture assertion failed'); }
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  return { endpoint: `http://127.0.0.1:${server.address().port}/v1`, errors,
    counts: () => ({ requests, imageRequests, firstProviderSkillContent, ...(messages ? {
      uploadCount, uploadSHA256: upload && createHash('sha256').update(upload).digest('hex'),
    } : {}) }), async close() { server.closeAllConnections(); await new Promise(done => server.close(done)); } };
}
