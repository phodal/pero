import { Graphic, ink, muted, border, soft } from './research-graphics.mjs';

// Target workflow, not a capability checklist. Cross-person project memory and
// integrated scientific acceptance remain targets; local project links exist.
const locales = {
  en: {
    title: 'From a question to a result others can build on.',
    note: 'TARGET WORKFLOW · IN DEVELOPMENT',
    description: 'Target research workflow, not a claim of end-to-end implementation. A question becomes a contract with fixed inputs, method version and acceptance criteria. Researchers, agents and authorized compute perform the work. Outputs, parameters, environment and logs are recorded, independently reviewed against a baseline, then accepted by a person. Accepted results feed future project context. Shared project memory across people and machines remains planned; local project links already exist. Illustrations do not represent measured results.',
    stages: [
      ['01 ASK', 'Question', ['GitHub Issue, researcher', 'request or Agent suggestion']],
      ['02 SPECIFY', 'Task contract', ['Fix inputs, method version', 'and acceptance criteria']],
      ['03 EXECUTE', 'People · Agents · Compute', ['Human judgment and review', 'Agents prepare and propose', 'Approved local or remote work']],
      ['04 RECORD', 'Run record', ['Outputs, parameters,', 'environment and logs']],
      ['05 REVIEW', 'Accepted result', ['Check against the baseline;', 'a person accepts the result']],
    ],
    memory: 'Project memory', memoryNote: 'Shared continuity is planned; local project links exist.',
    memoryItems: 'Questions · Papers · Data · Methods · Runs · Decisions · Open questions',
    context: 'Context for the next question', accept: 'Accepted evidence',
  },
  'zh-CN': {
    title: '从一个研究问题，到别人可以接着做的成果。',
    note: '目标流程 · 建设中',
    description: '目标科研流程，不表示端到端能力已经实现。问题形成固定输入、方法版本与验收标准的任务契约。研究者、Agent 与获准算力执行任务，记录产物、参数、环境与日志，独立对照基线复核，由人接受成果。成果成为后续项目背景。跨成员、跨机器的共享项目记忆仍是目标，本地项目引用已有实现。插画不表示实测结果。',
    stages: [
      ['01 提出', '研究问题', ['GitHub Issue、研究者请求', '或 Agent 建议']],
      ['02 明确', '任务契约', ['固定输入、方法版本', '与验收标准']],
      ['03 执行', '研究者 · Agent · 算力', ['人负责判断与复核', 'Agent 准备与提议', '获准的本地或远程执行']],
      ['04 记录', '运行记录', ['保存产物、参数、', '环境与执行日志']],
      ['05 复核', '接受成果', ['对照基线独立检查，', '由人决定是否接受']],
    ],
    memory: '项目记忆', memoryNote: '共享延续仍在规划；本地项目引用已有实现。',
    memoryItems: '研究问题 · 文献 · 数据 · 方法 · 运行记录 · 决定 · 待解决问题',
    context: '为下一个问题提供背景', accept: '接受的证据',
  },
};
for (const [lang, copy] of Object.entries(locales)) {
  const g = new Graphic(1600, 710, lang, `Pero — ${copy.title}`, copy.description);
  g.text(64, 60, copy.title, 36, ink, 700);
  g.text(64, 102, copy.note, 20, muted, 500);
  const centers = [188, 494, 800, 1106, 1412];
  const icons = ['paper', 'contract', 'laptop', 'paper', 'check'];
  copy.stages.forEach(([number, title, detail], i) => {
    const x = centers[i];
    g.text(x, 157, number, 21, i === 0 ? ink : muted, 600, 'middle');
    g.halo(x, 286, 119, 79, i === 0);
    if (i === 2) {
      g.illustration('people', x - 30, 241, .75);
      g.illustration(icons[i], x + 12, 306, .85);
    } else {
      g.illustration(icons[i], x, 274, 1.02, i === 0);
    }
    g.text(x, 397, title, i === 2 ? 25 : 28, ink, 700, 'middle');
    g.lines(x, 439, detail, 22, muted, 'middle', 32);
    if (i < 4) g.path(`M ${x + 129} 276 H ${centers[i + 1] - 129}`, { arrow: true, dashed: true });
  });
  g.rect(64, 561, 1472, 115, { fill: soft, stroke: border, dashed: true, radius: 14 });
  g.illustration('folder', 120, 617, .49);
  g.text(175, 602, copy.memory, 26, ink, 600);
  g.text(175, 642, copy.memoryItems, 23);
  g.text(1496, 602, copy.memoryNote, 21, muted, 400, 'end');
  g.path('M 1412 489 V 530 H 1472 V 558', { arrow: true, dashed: true });
  g.text(1390, 531, copy.accept, 21, muted, 400, 'end');
  g.path('M 128 560 V 523 H 188 V 490', { arrow: true, dashed: true });
  g.text(218, 531, copy.context, 21, muted);
  g.save(`openpero-overview${lang === 'en' ? '' : '.zh-CN'}.svg`);
}
