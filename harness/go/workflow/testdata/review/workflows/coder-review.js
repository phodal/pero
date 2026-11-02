export const meta = {
  name: 'coder-review',
  description: 'Multi-dimension code review: spec gate, batched D2-D9, senior aggregation, targeted skepticism, and final adjudication.',
  phases: [
    { title: 'Spec Gate', detail: 'spec compliance hard gate — fail blocks all quality dimensions' },
    { title: 'CR', detail: 'batched parallel quality dimension review (max 3 concurrent)' },
    { title: 'Assess', detail: 'senior aggregation, targeted independent verification, and final root-cause adjudication' },
    { title: 'Aggregate', detail: 'return consolidated repair input and final verdict' },
  ],
}

const SPEC_RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    dimension: { type: 'string', const: 'spec' },
    result: { type: 'string', enum: ['pass', 'fail'] },
    affected_tasks: { type: 'array', items: { type: 'string' } },
    rework_count: { type: 'integer' },
  },
  required: ['dimension', 'result', 'affected_tasks', 'rework_count'],
}

const DIM_CR_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    dimension: { type: 'string' },
    result: { type: 'string', enum: ['pass', 'fail'] },
    affected_tasks: { type: 'array', items: { type: 'string' } },
    rework_count: { type: 'integer' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string' },
          task_id: { type: 'string' },
          description: { type: 'string' },
          severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
          confidence: { type: 'integer' },
        },
        required: ['id', 'task_id', 'description', 'severity', 'confidence'],
      },
    },
  },
  required: ['dimension', 'result', 'affected_tasks', 'rework_count'],
}

const AGGREGATE_ASSESSMENT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          finding_id: { type: 'string' },
          dimension: { type: 'string' },
          verdict: { type: 'string', enum: ['TRUE_POSITIVE', 'FALSE_POSITIVE', 'UNCERTAIN'] },
          confidence: { type: 'integer' },
          rationale: { type: 'string' },
          root_cause_id: { type: 'string' },
        },
        required: ['finding_id', 'dimension', 'verdict', 'confidence', 'rationale', 'root_cause_id'],
      },
    },
    root_cause_groups: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          summary: { type: 'string' },
          finding_ids: { type: 'array', items: { type: 'string' } },
          affected_tasks: { type: 'array', items: { type: 'string' } },
          severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
          repair_strategy: { type: 'string' },
        },
        required: ['id', 'title', 'summary', 'finding_ids', 'affected_tasks', 'severity', 'repair_strategy'],
      },
    },
  },
  required: ['verdicts', 'root_cause_groups'],
}

const TARGETED_SKEPTIC_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    finding_id: { type: 'string' },
    angle: { type: 'string' },
    verdict: { type: 'string', enum: ['TRUE_POSITIVE', 'FALSE_POSITIVE', 'UNCERTAIN'] },
    confidence: { type: 'integer' },
    rationale: { type: 'string' },
    evidence: { type: 'array', items: { type: 'string' } },
  },
  required: ['finding_id', 'angle', 'verdict', 'confidence', 'rationale', 'evidence'],
}

const schemas = { spec: SPEC_RESULT_SCHEMA, dim: DIM_CR_SCHEMA, aggregate: AGGREGATE_ASSESSMENT_SCHEMA, skeptic: TARGETED_SKEPTIC_SCHEMA }

const workflowArgs = typeof args === 'undefined' ? null : typeof args === 'string' ? JSON.parse(args) : args
const {
  pluginRoot,
  ideaDir,
  baseRef,
  projectRoot,
  complexity,
  riskLevel,
  taskIds,
  reworkCycle,
  activeDimensions,
  dimensionBatches,
  reviewPolicy,
} = workflowArgs || {}

if (!pluginRoot || !ideaDir || !Array.isArray(taskIds) || taskIds.length === 0) {
  throw new Error('args.pluginRoot, args.ideaDir, and args.taskIds are required')
}
if (!Array.isArray(activeDimensions) || activeDimensions.includes('spec')) {
  throw new Error('args.activeDimensions must be a quality-dimension array and must not include spec')
}
if (!Array.isArray(dimensionBatches) || dimensionBatches.flat().includes('spec')) {
  throw new Error('args.dimensionBatches must contain quality dimensions only')
}

log(`coder-review: ${taskIds.length} task(s), complexity=${complexity}, risk=${riskLevel}, rework_cycle=${reworkCycle}`)

// --- Phase 1: Spec Gate ---
phase('Spec Gate')

const specPrompt = `You are a spec compliance reviewer for a legacy system enhancement.

Read the spec dimension definition: ${pluginRoot}/skills/coder-review/references/dim-spec.md
Read the shared CR footer: ${pluginRoot}/skills/coder-review/references/dim-shared-footer.md
Read the CR context: ${ideaDir}/cr/cr-context.json

## Task
Review all changes against the spec (acceptance criteria, scope, forbidden files, behavior invariants).
Base ref for diff: ${baseRef || 'use git merge-base main HEAD'}
Task IDs under review: ${taskIds.join(', ')}

## Output
Write your full CR report to ${ideaDir}/cr/dim-spec-cr.md with YAML frontmatter containing:
- dimension: spec
- result: pass or fail
- affected_tasks: array of task IDs that have issues (empty if pass)
- rework_count: ${reworkCycle}

The Markdown body MUST always include these exact headings from dim-spec.md:
- ## 结论
- ## Acceptance Criteria 覆盖
- ## Expected Files 覆盖
- ## Scope Check Proof
Do not return until the report file contains every heading, even when the result is pass.

Then return your structured result via the schema.`

const specResult = await agent(specPrompt, {
  label: 'reviewer:spec',
  phase: 'Spec Gate',
  schema: SPEC_RESULT_SCHEMA,
  model: 'opus',
})

if (!specResult || specResult.result === 'fail') {
  log(`spec gate FAILED: affected_tasks=${JSON.stringify(specResult?.affected_tasks || taskIds)}`)
  return {
    status: 'spec_failed',
    affected_tasks: specResult?.affected_tasks || taskIds,
    rework_count: specResult?.rework_count || reworkCycle,
  }
}

log('spec gate passed — proceeding to quality dimensions')

// --- Phase 2: CR (batched parallel) ---
const crResult = await workflow(
  { scriptPath: `${pluginRoot}/workflows/phases/review-cr-phase.js` },
  { pluginRoot, ideaDir, baseRef, projectRoot, taskIds, reworkCycle, activeDimensions, dimensionBatches, riskLevel, schemas },
)

// --- Phase 3: Senior aggregation, targeted skepticism, final adjudication ---
const failFindings = (crResult.allResults || [])
  .filter(r => r && r.result === 'fail')
  .flatMap(r => (r.findings || []).map(f => ({ ...f, dimension: r.dimension })))

let verifiedFindings = failFindings
let rootCauseGroups = []
if (failFindings.length > 0) {
  const assessment = await workflow(
    { scriptPath: `${pluginRoot}/workflows/phases/review-aggregate-assessment-phase.js` },
    { pluginRoot, ideaDir, baseRef, failFindings, riskLevel, reviewPolicy, schemas },
  )
  if (assessment.assessment_failed) {
    return {
      status: 'assessment_failed',
      failure_stage: assessment.failure_stage,
      affected_tasks: [...new Set(failFindings.map(finding => finding.task_id).filter(Boolean))],
      findings: failFindings,
      rework_count: reworkCycle,
    }
  }
  verifiedFindings = assessment.retained || []
  rootCauseGroups = assessment.root_cause_groups || []
}

// --- Phase 4: Aggregate ---
phase('Aggregate')

const allDimResults = crResult.allResults || []
const failDims = allDimResults.filter(r => r && r.result === 'fail')
const dismissedIds = new Set(failFindings.filter(f => !verifiedFindings.some(v => v.id === f.id)).map(f => f.id))

const stillFailing = failDims.filter(d => {
  const dimFindings = d.findings || []
  if (dimFindings.length === 0) return true
  const retained = dimFindings.filter(f => !dismissedIds.has(f.id))
  return retained.length > 0
})

if (stillFailing.length === 0) {
  log('all dimensions passed after aggregate assessment')
  return { status: 'approved', affected_tasks: [] }
}

const retainedIds = new Set(verifiedFindings.map(finding => finding.id))
const affectedTasks = [...new Set(stillFailing.flatMap(d => {
  const findings = d.findings || []
  if (findings.length === 0) return d.affected_tasks || []
  return findings.filter(finding => retainedIds.has(finding.id)).map(finding => finding.task_id).filter(Boolean)
}))]
const retainedRootCauseGroups = rootCauseGroups.filter(group => (group.finding_ids || []).some(id => retainedIds.has(id)))
log(`CR needs rework: ${stillFailing.length} dimension(s) failed, affected_tasks=${JSON.stringify(affectedTasks)}`)

return {
  status: 'needs_rework',
  affected_tasks: affectedTasks,
  failed_dimensions: stillFailing.map(d => d.dimension),
  findings: verifiedFindings,
  root_cause_groups: retainedRootCauseGroups,
  rework_count: reworkCycle,
}
