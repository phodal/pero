#!/usr/bin/env node
// Optional, offline presentation bridge. Better Harness remains an external checkout.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const HELP = `Usage: node inspector.mjs --summary <summary.json> --better-harness <checkout> --output <inspector.html>

Render a Pero session_report schema_version=1 summary with the unmodified
Better Harness Inspector. Reads the summary only; never replays recorded tools
or calls a model API. Also writes .report.json and .sources.json/.sources.md
beside the HTML. Full commands and source paths remain in the source index.
`;

const number = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const ms = (value) => value ? Date.parse(value) : Number.NaN;
const short = (value, limit) => String(value ?? '').replace(/\s+/gu, ' ').trim().slice(0, limit);
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

function validateSummary(summary) {
  assert.equal(summary?.schema_version, 1, 'Expected session_report schema_version=1');
  assert(Array.isArray(summary.sessions), 'Expected sessions[]');
  const ids = new Set();
  for (const session of summary.sessions) {
    assert(typeof session.id === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$/u.test(session.id), 'Invalid Session id');
    assert(!ids.has(session.id), `Duplicate Session id: ${session.id}`);
    ids.add(session.id);
    assert(Array.isArray(session.responses) && Array.isArray(session.calls), `Missing responses/calls: ${session.id}`);
    assert(session.source && typeof session.source.path === 'string', `Missing source: ${session.id}`);
    for (const call of session.calls) {
      assert(typeof call.name === 'string' && Number.isInteger(call.seq), `Invalid tool call: ${session.id}`);
    }
  }
}

// Cache writes and reasoning are subsets of the reported lanes, never addends.
function responseUsage(usage) {
  if (!usage) return null;
  const mapping = {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadInputTokens: usage.cacheReadTokens,
    reasoningOutputTokens: usage.reasoningTokens,
    totalTokens: usage.totalTokens,
  };
  const retained = Object.fromEntries(Object.entries(mapping).filter(([, value]) => number(value) !== null));
  return Object.keys(retained).length ? retained : null;
}

function toolAction(name) {
  if (['Read', 'Glob', 'Grep', 'Search'].includes(name)) return { family: 'inspect', operation: name === 'Read' ? 'read-files' : 'search-repository', actionLabel: name };
  if (['Write', 'Edit', 'ApplyPatch', 'apply_patch'].includes(name)) return { family: 'change', operation: 'edit-files', actionLabel: name };
  if (name === 'Bash') return { family: 'execute', operation: 'run-command', actionLabel: 'Run command' };
  return { family: 'other', operation: 'use-tool', actionLabel: name };
}

function inspectorSession(session, { buildUsageReport, deriveCacheReuse }) {
  const tokenMapping = {
    inputTokens: session.usage?.input_tokens,
    cacheReadInputTokens: session.usage?.cache_read_tokens,
    outputTokens: session.usage?.output_tokens,
    totalTokens: session.usage?.total_tokens,
    reasoningOutputTokens: session.usage?.reasoning_tokens,
  };
  const totals = Object.fromEntries(Object.entries(tokenMapping).filter(([, value]) => number(value) !== null));
  const hasUsage = (session.usage?.reported_completions ?? 0) > 0;
  const observations = session.responses.map((response) => {
    const usage = responseUsage(response.usage);
    const total = number(usage?.totalTokens);
    // Provider totals already include cached reads and output. No token estimate.
    return {
      timestamp: response.time,
      model: response.model,
      outputTokens: number(usage?.outputTokens),
      ...(total === null ? {} : { processedTokens: total, processedTokensBasis: 'provider-reported-total' }),
      ...(usage ? { cacheReuse: deriveCacheReuse(usage, 'separate-input-lane') } : {}),
    };
  });
  const calls = session.calls.map((call, index) => {
    const start = ms(call.time);
    const duration = ms(call.end_time) - start;
    const observedDuration = Number.isFinite(duration) && duration >= 0 && duration <= 86_400_000;
    const status = call.protocol_error === true || call.execution_failure === true || call.lifecycle_failure === true || call.status === 'failed' ? 'failed' : 'observed';
    const refs = `seq ${call.seq}→${call.result_seq ?? '?'} / L${call.line ?? call.seq + 1}→${call.result_line ?? '?'}`;
    const signals = (call.validation_signals ?? []).map((signal) => `${signal.kind} candidate`).join(', ');
    const metadata = [refs, call.status, call.exit_code === null || call.exit_code === undefined ? null : `exit=${call.exit_code}`,
      call.lifecycle_failure ? `owner=${call.lifecycle_status}` : null, call.cleanup_uncertain ? 'cleanup uncertain' : null, signals || null].filter(Boolean).join(' | ');
    return {
      step: index + 1,
      toolName: call.name,
      ...toolAction(call.name),
      status,
      durationStatus: observedDuration ? 'observed' : 'unobserved',
      ...(observedDuration ? { durationMs: duration, timingSource: 'transcript-pair' } : {}),
      ...(Number.isFinite(start) ? { startedAt: start } : {}),
      detail: `${metadata} | ${short(call.command ?? call.arguments_preview, 150)}`,
      detailKind: 'normalized-summary',
    };
  });
  const first = ms(session.started_at);
  const last = ms(session.ended_at);
  return {
    sessionId: session.id,
    platform: 'pero-local',
    firstSeen: session.started_at,
    lastSeen: session.ended_at,
    durationMs: Number.isFinite(first) && Number.isFinite(last) && last >= first ? last - first : null,
    models: [...new Set(session.responses.map((response) => response.model).filter(Boolean))],
    tokenUsage: hasUsage ? {
      ...totals,
      cacheAccountingMode: 'separate-input-lane',
      coverage: session.usage.usage_complete === false || session.usage.unreported_completions > 0 || session.usage.totals_unreported > 0 ? 'partial' : 'observed',
      basis: 'provider-reported',
      source: 'pero-summary-v1',
    } : null,
    usageReport: buildUsageReport(observations),
    toolCallCount: calls.length,
    toolTrace: { totalCalls: calls.length, calls },
    toolActivity: { kind: 'NormalizedToolActivityV1', schemaVersion: 1, calls },
    // The summary omits source prompt/response text. Leave calls unplaced rather
    // than inventing conversational Turns or attaching usage to guessed prompts.
    dialogue: { truncated: false, turns: [] },
    prompts: [],
    files: [],
    source: 'pero-summary-v1',
    sourceCheckpointId: session.source.sha256 ?? null,
    timestampBasis: 'native-event',
  };
}

function sessionTree(sessions, api) {
  const refs = () => ({ specs: [], issues: [], prompts: [], sessions: [], commits: [] });
  return {
    kind: api.FEATURE_TREE_KIND,
    schemaVersion: api.FEATURE_TREE_SCHEMA_VERSION,
    source: null,
    roots: ['reported-sessions'],
    nodes: [{ id: 'reported-sessions', type: 'feature', title: 'Reported Sessions', parentId: null, children: sessions.map((_, index) => `reported-session-${index + 1}`), status: null, stage: null, date: null, evidence: 'declared', refs: refs() },
      ...sessions.map((session, index) => ({
        id: `reported-session-${index + 1}`, type: 'story', title: session.label ?? session.id,
        parentId: 'reported-sessions', children: [], status: null, stage: null, date: null, evidence: 'declared',
        refs: { ...refs(), sessions: [`pero-local/${session.id}`] },
      }))],
  };
}

function sourceMarkdown(sourceIndex, reportName) {
  const lines = [
    '# Session source index', '',
    'The Inspector is a bounded presentation. This index retains the summary’s source references, original commands and validation candidates. Candidates are not official test verdicts.', '',
    'Usage input is uncached; cache reads are a separate lane. Cache writes are informational subsets; reasoning is included in output. Missing usage is not estimated. No context-window occupancy is inferred.', '',
  ];
  for (const session of sourceIndex.sessions) {
    const query = new URLSearchParams({ mode: 'feature', feature: session.featureId, view: 'session', session: session.id });
    lines.push(`## ${short(session.label ?? session.id, 160)}`, '',
      `[Inspector](${reportName}?${query}) · [Usage](${reportName}?${query}&session-mode=usage)`, '',
      `Source: [${path.basename(session.source.path)}](<${session.source.path}>)`, '',
      `SHA-256: \`${session.source.sha256 ?? 'unobserved'}\``, '',
      '| Tool | Call seq / line | Result seq / line | Observed status |',
      '| --- | --- | --- | --- |');
    for (const call of session.calls) {
      const callLine = call.line ?? call.seq + 1;
      const resultLine = call.result_line ?? (Number.isInteger(call.result_seq) ? call.result_seq + 1 : null);
      lines.push(`| A${call.inspector_step} ${short(call.name, 40).replaceAll('|', '\\|')} | [${call.seq} / ${callLine}](<${session.source.path}:${callLine}>) | ${resultLine ? `[${call.result_seq} / ${resultLine}](<${session.source.path}:${resultLine}>)` : 'unobserved'} | ${short(call.status, 40)} |`);
    }
    lines.push('', `Responses: ${session.responses.length}; findings: ${session.findings.length}. Full commands, output previews, response usage and finding refs are in the companion sources JSON.`, '');
    for (const finding of session.findings) lines.push(`- ${short(finding.severity, 30)} / ${short(finding.kind, 60)}: ${short(finding.message, 500)} (seq ${(finding.refs ?? []).map((ref) => ref.seq).join(', ') || 'unobserved'})`);
    lines.push('');
  }
  return lines.join('\n');
}

export async function main(argv = process.argv.slice(2)) {
  if (argv.includes('--help') || argv.includes('-h')) { process.stdout.write(HELP); return; }
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    assert(['--summary', '--better-harness', '--output'].includes(flag), `Unknown option: ${flag}`);
    assert(value && !value.startsWith('--'), `Missing value for ${flag}`);
    assert(!Object.hasOwn(options, flag), `Duplicate option: ${flag}`);
    options[flag] = path.resolve(value);
  }
  assert(Object.keys(options).length === 3, HELP);
  const summaryBytes = await readFile(options['--summary']);
  const summary = JSON.parse(summaryBytes);
  validateSummary(summary);
  const api = await import(pathToFileURL(path.join(options['--better-harness'], 'scripts/harness-inspector/index.mjs')));
  const usageApi = await import(pathToFileURL(path.join(options['--better-harness'], 'scripts/session-analysis/index.mjs')));
  const sessions = summary.sessions.map((session) => inspectorSession(session, usageApi));
  const report = api.buildHarnessInspectorReport({
    repoRoot: path.dirname(options['--summary']),
    sessions,
    featureTree: sessionTree(summary.sessions, api),
    correlation: { commits: [] },
    filters: { platform: 'pero-local' },
    generatedAt: summary.generated_at ?? new Date().toISOString(),
    diagnostics: [
      'External offline summary bridge; no native Pero host adapter or Better Harness source changes.',
      'Failure markers use tool protocol/execution outcomes. Validation signals remain candidates in the source index.',
      'Input is uncached; cached reads are separate. Cache writes and reasoning are not added again.',
      'Source conversation text and context occupancy are not in this summary. Tool calls remain unplaced evidence.',
    ],
  });
  assert.equal(report.sessions.length, summary.sessions.length, 'Inspector rejected a Session');
  const output = options['--output'];
  const stem = output.endsWith('.html') ? output.slice(0, -5) : output;
  const outputs = { html: output, report: `${stem}.report.json`, sources: `${stem}.sources.json`, source_markdown: `${stem}.sources.md` };
  const sourceIndex = {
    schema_version: 1, kind: 'pero-inspector-source-index',
    summary: { path: options['--summary'], sha256: hash(summaryBytes) },
    better_harness: { path: options['--better-harness'], public_exports: ['buildHarnessInspectorReport', 'renderHarnessInspectorHtml', 'buildUsageReport', 'deriveCacheReuse'] },
    sessions: summary.sessions.map((session, index) => ({
      ...session,
      featureId: `reported-session-${index + 1}`,
      calls: session.calls.map((call, offset) => ({ ...call, inspector_step: offset + 1, inspector_id: `A${offset + 1}` })),
      findings: session.findings ?? [],
    })),
  };
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(outputs.html, api.renderHarnessInspectorHtml(report, { contextLabel: 'Pero summary · offline', robots: 'noindex, nofollow' }));
  await writeFile(outputs.report, JSON.stringify(report, null, 2) + '\n');
  await writeFile(outputs.sources, JSON.stringify(sourceIndex, null, 2) + '\n');
  await writeFile(outputs.source_markdown, sourceMarkdown(sourceIndex, path.basename(output)));
  process.stdout.write(JSON.stringify({ ok: true, outputs, sessions: report.sessions.length, tool_calls: report.sessions.reduce((count, session) => count + session.toolActivity.totalCalls, 0), failed_calls: report.sessions.reduce((count, session) => count + session.toolActivity.failedCalls, 0) }) + '\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => { process.stderr.write(`inspector: ${error.message}\n`); process.exitCode = 1; });
}
