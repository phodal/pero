export const meta = {
  name: 'coder-review-aggregate-assessment',
  description: 'Senior-model aggregation, targeted independent skepticism, and final root-cause adjudication.',
  phases: [
    { title: 'Assess', detail: 'aggregate globally, verify only risky or uncertain findings, then adjudicate final root causes' },
  ],
}

const {
  pluginRoot,
  ideaDir,
  baseRef,
  failFindings,
  riskLevel,
  reviewPolicy,
  schemas,
} = args

const ASSESSMENT_SCHEMA = schemas.aggregate
const SKEPTIC_SCHEMA = schemas.skeptic
const serializedFindings = JSON.stringify(failFindings, null, 2)
const targetedPolicy = reviewPolicy?.targeted_skeptic || {
  max_findings: 6,
  votes_by_severity: { critical: 2, high: 2, medium: 1, low: 1 },
}
const maxConcurrency = reviewPolicy?.max_concurrency || 3

phase('Assess')

const initialAssessment = await agent(`你是一名负责 CR 初步汇总的高级代码审查专家。多个独立维度已经完成 CR；你必须先把所有问题放在同一个上下文中深度评估，供后续有条件独立核验使用。

## 全部待评估 findings
${serializedFindings}

## 可读取信息
- 完整 diff（base ref: ${baseRef || 'HEAD~1'}）
- ${ideaDir}/cr/cr-context.json
- findings 指向的源码、测试、配置与相关调用链
- 各维度报告 ${ideaDir}/cr/dim-*-cr.md（只用于补充 finding 证据）

## 任务
1. 逐条核对代码语义、运行时行为、框架约定、配置和测试证据，判断 TRUE_POSITIVE、FALSE_POSITIVE 或 UNCERTAIN；不确定项保守保留。
2. 对保留项追溯根因。不同维度如果描述的是同一个底层缺陷，必须合并为一个 root_cause_group，避免重复修复表象。
3. 每个根因组给出最小、保持不变量的 repair_strategy，并列出覆盖的 finding_ids 与 affected_tasks。
4. 不得修改业务代码，也不要写最终报告；这里只输出初步结构化裁决。

风险等级：${riskLevel || 'unknown'}。返回结构化结果时必须覆盖输入中的每一个 finding ID。`, {
  label: 'reviewer:initial-aggregate-assessment',
  phase: 'Assess',
  schema: ASSESSMENT_SCHEMA,
  model: 'opus',
})

if (!initialAssessment) {
  log('initial aggregate assessment returned no result; blocking repair')
  return { assessment_failed: true, failure_stage: 'initial_aggregate', retained: failFindings, dismissed: 0, root_cause_groups: [] }
}

const initialById = new Map((initialAssessment.verdicts || []).map(item => [item.finding_id, item]))
const conflictingIds = new Set()
for (const group of initialAssessment.root_cause_groups || []) {
  const verdicts = new Set((group.finding_ids || []).map(id => initialById.get(id)?.verdict).filter(Boolean))
  if (verdicts.size > 1) for (const id of group.finding_ids || []) conflictingIds.add(id)
}

const severityRank = { critical: 4, high: 3, medium: 2, low: 1 }
const targetedCandidates = failFindings.filter(finding => {
  const verdict = initialById.get(finding.id)?.verdict
  return verdict === 'UNCERTAIN'
    || ['critical', 'high'].includes(finding.severity)
    || (verdict === 'FALSE_POSITIVE' && Number(finding.confidence || 0) >= 80)
    || conflictingIds.has(finding.id)
}).sort((left, right) => {
  const leftVerdict = initialById.get(left.id)?.verdict
  const rightVerdict = initialById.get(right.id)?.verdict
  const leftPriority = (leftVerdict === 'UNCERTAIN' ? 100 : 0) + (conflictingIds.has(left.id) ? 50 : 0) + (severityRank[left.severity] || 0)
  const rightPriority = (rightVerdict === 'UNCERTAIN' ? 100 : 0) + (conflictingIds.has(right.id) ? 50 : 0) + (severityRank[right.severity] || 0)
  return rightPriority - leftPriority
}).slice(0, targetedPolicy.max_findings)

const angleInstructions = {
  'code-semantics': '只核对代码语义、类型、控制流和数据变换是否真的产生所述缺陷。',
  'runtime-behavior': '只核对真实运行时行为、状态变化、时序、并发和外部可观察结果。',
  'independent-evidence': '独立寻找支持或反驳证据，包括框架保证、间接调用、配置和测试；不要沿用汇总模型的结论。',
}

const voteJobs = targetedCandidates.flatMap(finding => {
  const voteCount = targetedPolicy.votes_by_severity?.[finding.severity] || 1
  const angles = voteCount > 1 ? ['code-semantics', 'runtime-behavior'] : ['independent-evidence']
  return angles.map(angle => ({ finding, angle }))
})
const skepticVotes = []
for (let index = 0; index < voteJobs.length; index += maxConcurrency) {
  const batch = voteJobs.slice(index, index + maxConcurrency)
  const results = await parallel(batch.map(({ finding, angle }) => () => agent(`你是独立 skeptic reviewer。不要读取或迎合高级汇总模型的结论，只根据源码和运行证据核验这一条 finding。

## Finding
${JSON.stringify(finding, null, 2)}

## 核验角度
${angleInstructions[angle]}

## 信息边界
- 可读取完整 diff（base ref: ${baseRef || 'HEAD~1'}）、${ideaDir}/cr/cr-context.json、相关源码/测试/配置。
- 不得读取 aggregate-assessment 输出，不得修改任何文件。

给出 TRUE_POSITIVE、FALSE_POSITIVE 或 UNCERTAIN，并列出具体 evidence。证据不足时必须选择 UNCERTAIN。`, {
    label: `skeptic:${finding.id}:${angle}`,
    phase: 'Assess',
    schema: SKEPTIC_SCHEMA,
    model: 'sonnet',
  })))
  skepticVotes.push(...(results || []).filter(Boolean))
}

const finalAssessment = await agent(`你是最终 CR 裁决者。你必须结合全部原始 findings、第一次全局汇总和有条件独立核验证据，给出返修前的最终裁决。不得仅按票数机械表决；要比较证据质量，并保持全局根因一致性。

## 原始 findings
${serializedFindings}

## 初步全局汇总
${JSON.stringify(initialAssessment, null, 2)}

## 独立 skeptic 核验
${JSON.stringify(skepticVotes, null, 2)}

你可以重新读取完整 diff（base ref: ${baseRef || 'HEAD~1'}）、${ideaDir}/cr/cr-context.json、相关源码、测试和配置，以解决证据冲突。

## 最终任务
1. 覆盖每一个 finding ID，输出最终 TRUE_POSITIVE / FALSE_POSITIVE / UNCERTAIN；证据不足的项目保守保留为 UNCERTAIN。
2. 重新合并所有保留项的共同根因，不得为 FALSE_POSITIVE 建立返修根因组。
3. 每个根因组给出最小返修策略、affected_tasks、finding_ids 和严重度，并明确建议返修顺序。
4. skeptic 与初步汇总结论冲突时，在 rationale 中说明采用哪份证据以及原因。
5. 将完整中文最终裁决写入 ${ideaDir}/cr/aggregate-assessment.md。
6. 不得修改业务代码；最终裁决完成后外层工作流才允许开始返修。

风险等级：${riskLevel || 'unknown'}。`, {
  label: 'reviewer:final-aggregate-adjudication',
  phase: 'Assess',
  schema: ASSESSMENT_SCHEMA,
  model: 'opus',
})

if (!finalAssessment) {
  log('final aggregate adjudication returned no result; blocking repair')
  return {
    assessment_failed: true,
    failure_stage: 'final_adjudication',
    retained: failFindings,
    dismissed: 0,
    root_cause_groups: initialAssessment.root_cause_groups || [],
    targeted_findings: targetedCandidates.map(finding => finding.id),
    skeptic_votes: skepticVotes,
  }
}

const assessment = finalAssessment
const verdictById = new Map((assessment.verdicts || []).map(item => [item.finding_id, item]))
const retained = failFindings.filter(finding => verdictById.get(finding.id)?.verdict !== 'FALSE_POSITIVE')
const missing = failFindings.filter(finding => !verdictById.has(finding.id)).length
log(`final aggregate adjudication complete: ${retained.length}/${failFindings.length} retained, ${failFindings.length - retained.length} dismissed, ${targetedCandidates.length} targeted finding(s), ${skepticVotes.length} skeptic vote(s), ${missing} missing verdict(s) conservatively retained`)

return {
  retained,
  dismissed: failFindings.length - retained.length,
  verdicts: assessment.verdicts || [],
  root_cause_groups: assessment.root_cause_groups || [],
  targeted_findings: targetedCandidates.map(finding => finding.id),
  skeptic_votes: skepticVotes,
}
