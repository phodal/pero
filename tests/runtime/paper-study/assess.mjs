import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { scenes } from './scenarios.mjs';

export async function records(directory, category) {
  const path = resolve(directory, 'app-data/paper-agent/research-v1', category);
  const files = await readdir(path).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
  return Promise.all(files.filter(file => file.endsWith('.json')).map(async file => JSON.parse(await readFile(resolve(path, file), 'utf8'))));
}
export async function fetches(directory) {
  const raw = await readFile(resolve(directory, 'app-data/paper-agent/source-fixture-requests.jsonl'), 'utf8')
    .catch(error => { if (error.code === 'ENOENT') return ''; throw error; });
  return raw.split('\n').filter(Boolean).map(JSON.parse);
}
export async function referenceBoundary(host, directory, { inspectOnly = false } = {}) {
  const sourceJobs = await records(directory, 'source-downloads'), pdfJobs = await records(directory, 'pdf-downloads');
  const data = await host.backend('data', '/api/state');
  const library = await host.backend('paper-agent', '/api/library');
  assert.deepEqual(sourceJobs, []); assert.deepEqual(pdfJobs, []);
  if (inspectOnly) assert.deepEqual(library.bundles, [], 'Inspection alone must not persist a bundle');
  for (const bundle of library.bundles) {
    assert.deepEqual(bundle.sourceDownloadIds, []); assert.deepEqual(bundle.pdfDownloadIds, []); assert.deepEqual(bundle.downloadIds, []);
  }
  assert.equal(data.download, null); assert.deepEqual(data.assets, []);
  assert(!(await fetches(directory)).some(item => ['source', 'pdf'].includes(item.kind)), 'Byte fetch before exact consent');
  return { sourceJobs: 0, pdfJobs: 0, dataAssets: 0, byteFetches: 0 };
}

export function explicitSkillLoaded(events, digest) {
  return events.some(event => event.type === 'user/message' && event.data?.role === 'user' &&
    event.data.source?.kind === 'skill-invocation' && event.data.source?.form === 'instructions' &&
    event.data.source?.name === 'research-resource-import' && event.data.source?.digest === digest &&
    event.data.content?.some(block => block.type === 'text' && block.text.startsWith('<skill_content name="research-resource-import">\n')));
}

export async function assess({ host, scene, directory, digest, credential }) {
  const spec = scenes[scene], events = [];
  for (const file of (await readdir(host.sessions)).filter(file => file.endsWith('.jsonl'))) {
    const raw = await readFile(resolve(host.sessions, file), 'utf8');
    assert(!raw.includes(credential), 'Credential echo detected; finalization will remove it');
    events.push(...raw.split('\n').filter(Boolean).map(JSON.parse).map(record => record.event).filter(Boolean));
  }
  const calls = events.filter(event => event.type === 'tool/call');
  const results = new Map(events.filter(event => event.type === 'tool/result').map(event => [event.data.toolCallId, event.data]));
  const good = call => results.has(call.data.callId) && !results.get(call.data.callId).isError;
  const appName = call => call.data.name === 'mcp__pero-app-use__app_write' ? call.data.arguments.tool : call.data.name.split('__app__paper-agent__')[1];
  const input = call => call.data.name === 'mcp__pero-app-use__app_write' ? call.data.arguments.document : call.data.arguments;
  const action = (name, operation) => calls.filter(call => appName(call) === name && (!operation || input(call)?.operation === operation) && good(call));
  const appResult = call => {
    const text = results.get(call.data.callId)?.content?.find(block => block.type === 'text')?.text;
    try { return JSON.parse(text).result; } catch { return undefined; }
  };
  const skillList = calls.find(call => call.data.name === 'skill' && !call.data.arguments?.name && good(call));
  const skillRead = calls.find(call => call.data.name === 'skill' && call.data.arguments?.digest === digest && good(call));
  const library = await host.backend('paper-agent', '/api/library');
  const data = await host.backend('data', '/api/state');
  const sourceJobs = await records(directory, 'source-downloads'), pdfJobs = await records(directory, 'pdf-downloads');
  const checks = { skillActivationMode: spec.explicitSkill ? 'explicit-user-invocation' : 'model-selected-tool',
    explicitSkillLoaded: explicitSkillLoaded(events, digest), skillListed: Boolean(skillList), digestValidatedRead: Boolean(skillList && skillRead && skillList.seq < skillRead.seq),
    noExecutionTools: !calls.some(call => /(?:^|__)(?:shell|computer_use|spawn_agent|fork_agent|write_file|read_file)$/.test(call.data.name)),
    savedBundleCount: library.bundles.length, sourceList: action('research-source-read', 'list').length,
    sourceRead: action('research-source-read', 'read').length, sourceCompare: action('research-source-read', 'compare').length,
    imageTool: action('research-source-read', 'image').length, analysisContext: action('research-analysis', 'context').length,
    analysisPropose: action('research-analysis', 'propose').length,
    typedImageResults: [...results.values()].filter(result => result.content?.some(block => block.type === 'image')).length,
    noDataDownloads: data.download === null && data.assets.length === 0 };
  const fetchLog = await fetches(directory);
  const allowedBytes = spec.source ? [spec.sourceURL || `https://arxiv.org/src/${spec.version}`, ...(spec.pdf ? [`https://arxiv.org/pdf/${spec.version}`] : [])] : [];
  checks.noUnapprovedByteFetch = fetchLog.filter(item => ['source', 'pdf'].includes(item.kind)).every(item => allowedBytes.includes(item.url));
  checks.metadataFetchObserved = fetchLog.some(item => item.kind === 'metadata' && item.url === spec.seed);
  checks.recordedSourceFetchObserved = spec.publicRecording ? fetchLog.some(item => item.kind === 'source' && item.sha256 === spec.archiveSHA) : null;
  const actualBytes = [];
  const publicMessages = events.filter(event => event.type === 'assistant/message').map(event => ({ seq: event.seq,
    texts: (event.data.message?.content || []).filter(block => block.type === 'text').map(block => block.text) })).filter(item => item.texts.length);
  const output = { checks, trajectory: calls.map(call => ({ seq: call.seq, name: call.data.name, arguments: call.data.arguments, succeeded: good(call) })),
    usage: events.filter(event => event.type === 'assistant/message').map(event => event.data.usage ?? null), publicMessages,
    providerErrors: events.filter(event => /error|retry/.test(event.type)).map(event => ({ type: event.type, data: event.data })),
    artifacts: { library, sourceJobs, pdfJobs, actualBytes, fetchLog },
    qualityAssessment: { status: 'requires-manual-assessment', rubric: 'Compare exact pre-commit review/consent, observed source line/hash references and PDF report evidence against saved records. For vision verify actual image input and discriminating color/shape/count/location facts; caption matching is not vision. Source indexes/session reads are not a validated source report. Do not publish raw reasoning or third-party assets.' } };
  try {
  for (const job of sourceJobs) {
    assert.equal(job.status, 'source_available');
    assert.equal(job.receipt.revision, spec.unknownIdentity ? null : /v\d+$/.exec(spec.version)[0]);
    assert.equal(job.receipt.workIdentity, spec.unknownIdentity ? null : 'arxiv:' + spec.version.replace(/v\d+$/, ''));
    assert.equal(job.receipt.explicitVersion, 'sha256:' + job.receipt.archiveDigest, 'Byte version is the original content SHA, separate from work/revision');
    if (spec.archiveSHA) assert.equal(job.receipt.archiveDigest, spec.archiveSHA);
    const bytes = await readFile(resolve(directory, 'app-data/paper-agent/research-v1/source-files', job.receipt.archiveDigest + '.bin'));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), job.receipt.archiveDigest);
    assert.equal(bytes.length, job.receipt.size);
    const index = JSON.parse(await readFile(resolve(directory, 'app-data/paper-agent/research-v1/source-archives', job.receipt.archiveDigest + '.json')));
    for (const member of index.members) {
      const original = await readFile(resolve(directory, 'app-data/paper-agent/research-v1/source-members', member.sha256 + '.bin'));
      assert.equal(createHash('sha256').update(original).digest('hex'), member.sha256);
    }
    actualBytes.push({ receipt: job.receipt, memberCount: index.members.length, allMemberHashesVerified: true });
    if (spec.publicRecording) {
      const reads = action('research-source-read', 'read').map(appResult).filter(Boolean);
      const main = index.members.find(member => member.path === 'main.tex');
      checks.requestedSourceRangesObserved = spec.readRanges.every(([first, last]) =>
        Array.from({ length: last - first + 1 }, (_, offset) => first + offset).every(line => reads.some(read =>
          read.memberDigest === main.sha256 && read.startLine <= line && read.endLine >= line)));
      checks.onlyRequestedSourceRangesRead = reads.length > 0 && reads.every(read => read.memberDigest === main.sha256 &&
        spec.readRanges.some(([first, last]) => first <= read.startLine && last >= read.endLine));
      const target = index.members.find(member => member.path === spec.imagePath);
      checks.requestedImageObserved = action('research-source-read', 'image').some(call => {
        const observed = appResult(call);
        return observed?.type === 'source_image' && observed.provenance.memberId === target.id &&
          observed.provenance.originalSha256 === target.sha256 && observed.provenance.previewSha256 === spec.imageSHA;
      });
      assert(checks.requestedSourceRangesObserved && checks.onlyRequestedSourceRangesRead && checks.requestedImageObserved,
        'Require requested original table/figure ranges and the selected image/hash, not unrelated reads/images');
    }
  }
  if (spec.source) { assert.equal(sourceJobs.length, 1); assert(checks.sourceList && checks.sourceRead); }
  else { assert.deepEqual(sourceJobs, []); assert(checks.analysisContext && checks.analysisPropose); }
  if (spec.analysis) {
    assert(checks.analysisContext && checks.analysisPropose);
    const resources = spec.inspectOnly && spec.decline ? (await records(directory, 'import-drafts')).flatMap(draft => draft.resources || []) : library.bundles.flatMap(bundle => bundle.resources);
    if (spec.decline) {
      const attachment = resources.find(resource => resource.originalUrl === 'https://research.example.org/attachments?id=methods');
      assert(attachment && attachment.workIdentity === null && attachment.revision === null, 'Ambiguous attachment identity/version must remain unresolved');
    }
    const code = resources.find(resource => resource.originalUrl === 'https://github.com/example/synthetic-research');
    checks.observedCodeLicensePreserved = code?.license === 'MIT';
    assert(checks.observedCodeLicensePreserved, 'Agent proposals must not discard inspected code metadata');
  }
  if (spec.vision) {
    assert(checks.imageTool && checks.typedImageResults, 'Need actual typed MCP image content, not a filename/caption');
    checks.publicResponseAfterImage = publicMessages.some(message => message.seq > action('research-source-read', 'image').at(-1).seq);
    assert(checks.publicResponseAfterImage, 'Image delivery without a subsequent public model response is not an end-to-end result');
    assert.deepEqual(pdfJobs, []);
  }
  if (spec.pdf) {
    assert.equal(pdfJobs.length, 1); assert.equal(pdfJobs[0].status, 'completed'); assert(checks.sourceCompare);
    const reports = await records(directory, 'reports');
    checks.validatedPDFReportCount = reports.length; assert(reports.length > 0, 'No validated PDF report persisted');
    assert(calls.some(call => appName(call) === 'research-step' && input(call)?.action === 'read' && good(call)));
    assert(calls.some(call => appName(call) === 'research-step' && input(call)?.action === 'finalize' && good(call)));
  }
  assert(checks.noExecutionTools && checks.noDataDownloads && checks.noUnapprovedByteFetch);
  assert(spec.publicRecording ? checks.recordedSourceFetchObserved : checks.metadataFetchObserved);
  if (spec.decline) {
    await referenceBoundary(host, directory, { inspectOnly: true });
    assert(!calls.some(call => appName(call) === 'commit-research-bundle' ||
      (['research-source', 'research-pdf', 'research-assets'].includes(appName(call)) && input(call)?.operation === 'start')),
      'Declined acquisition must not attempt commit/start, even if the domain rejects it');
    checks.declinedWithoutSavingOrAcquiring = true;
  }
  assert.equal(library.bundles.length, spec.decline ? 0 : 1); assert(spec.explicitSkill ? checks.explicitSkillLoaded : checks.digestValidatedRead,
    spec.explicitSkill ? 'Explicit digest-validated Skill invocation was not persisted' : 'Natural Skill coverage was not observed');
  } catch (error) { output.automatedFailure = error.stack; }
  return output;
}
