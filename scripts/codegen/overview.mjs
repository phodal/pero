import { readFileSync, writeFileSync } from 'node:fs';

// README hero: the target task workflow and the project memory it feeds.
// Self-contained navy canvas so it reads the same on light and dark GitHub themes.
const root = new URL('../../', import.meta.url);
const theme = readFileSync(new URL('DESIGN.md', root), 'utf8').split('---')[1];
// Read only the documented flat HEX palette; regeneration needs no npm install.
const block = (name) => theme.match(new RegExp(`^  ${name}:\\n([\\s\\S]*?)(?=^  \\w+:|(?![\\s\\S]))`, 'm'))?.[1] ?? '';
const tokens = (source) => Object.fromEntries([...source.matchAll(/^\s+([\w-]+): "(#[\da-f]{6})"$/gmi)].map((match) => [match[1], match[2]]));
const brand = tokens(block('brand'));
const dark = tokens(block('dark'));
if (['navy', 'ion'].some((key) => !brand[key]) || ['text', 'text-muted', 'border', 'surface-muted', 'accent-soft'].some((key) => !dark[key])) {
  throw new Error('Missing overview palette token in DESIGN.md');
}

const locales = {
  en: {
    file: 'openpero-overview.svg',
    title: 'From a question to a result others can build on.',
    description: 'Target workflow. A question from a GitHub Issue, a researcher, or an agent becomes a task contract with pinned inputs, method version, and acceptance criteria. Researchers, agents, or compute workers carry it out. The run is recorded with outputs, parameters, environment, and execution log, then reviewed against the baseline before the result is accepted. Accepted results return to the project memory, which provides context for the next question.',
    chip: 'TARGET WORKFLOW · IN DEVELOPMENT',
    steps: [
      ['01 ASK', 'Question', ['GitHub Issue,', 'researcher request,', 'or agent suggestion']],
      ['02 SPECIFY', 'Task contract', ['Pinned inputs and', 'method version,', 'acceptance criteria']],
      ['03 DO THE WORK'],
      ['04 RECORD', 'Run record', ['Outputs, parameters,', 'environment, and', 'execution log']],
      ['05 ACCEPT', 'Accepted result', ['Reviewed against', 'the baseline, then', 'added to the project']],
    ],
    lanes: [['Researchers', 'judgment · review'], ['Agents', 'prepare · propose'], ['Compute', 'laptop · lab · cloud']],
    memory: 'PROJECT MEMORY',
    memoryNote: 'Survives sessions, people, and machines',
    memoryItems: 'Question · Papers · Datasets · Methods · Runs · Decisions · Open questions',
    accept: 'accept',
    context: 'context',
  },
  'zh-CN': {
    file: 'openpero-overview.zh-CN.svg',
    title: '从一个研究问题，到别人可以接着做的成果。',
    description: '目标流程。来自 GitHub Issue、研究者或 Agent 的问题被整理成任务契约，固定输入、方法版本与验收标准。研究者、Agent 或计算节点完成任务。运行时保存产物、参数、环境与执行日志，并与基线对照复核后再接受结果。被接受的成果回到项目记忆，为下一个问题提供背景。',
    chip: '目标流程 · 建设中',
    steps: [
      ['01 提出', '研究问题', ['GitHub Issue、', '研究者请求或', 'Agent 建议']],
      ['02 明确', '任务契约', ['固定输入与', '方法版本，', '写明验收标准']],
      ['03 执行'],
      ['04 记录', '运行记录', ['产物、参数、', '环境与执行日志', '一并保存']],
      ['05 接受', '接受成果', ['与基线对照复核，', '再纳入项目']],
    ],
    lanes: [['研究者', '判断 · 复核'], ['Agent', '准备 · 提议'], ['算力', '个人电脑 · 实验室 · 云']],
    memory: '项目记忆',
    memoryNote: '跨会话、跨成员、跨机器保留',
    memoryItems: '研究问题 · 文献 · 数据集 · 方法 · 运行记录 · 决定 · 待解决问题',
    accept: '接受',
    context: '背景',
  },
};

const escape = (value) => String(value).replace(/[&<>"']/g, (v) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
})[v]);
const sans = 'Inter, Helvetica Neue, PingFang SC, Microsoft YaHei, Arial, sans-serif';
const mono = 'SFMono-Regular, Menlo, Consolas, monospace';

// Small line icons for the three kinds of contributors.
const icons = [
  (x, y) => `<circle cx="${x}" cy="${y - 6}" r="6"/><path d="M ${x - 11} ${y + 12} C ${x - 11} ${y + 1}, ${x + 11} ${y + 1}, ${x + 11} ${y + 12}"/>`,
  (x, y) => `<path d="M ${x} ${y - 13} C ${x + 2} ${y - 3}, ${x + 3} ${y - 2}, ${x + 13} ${y} C ${x + 3} ${y + 2}, ${x + 2} ${y + 3}, ${x} ${y + 13} C ${x - 2} ${y + 3}, ${x - 3} ${y + 2}, ${x - 13} ${y} C ${x - 3} ${y - 2}, ${x - 2} ${y - 3}, ${x} ${y - 13} Z"/>`,
  (x, y) => `<rect x="${x - 12}" y="${y - 12}" width="24" height="10" rx="2"/><rect x="${x - 12}" y="${y + 2}" width="24" height="10" rx="2"/><path d="M ${x - 7} ${y - 7} h 2 M ${x - 7} ${y + 7} h 2"/>`,
];

const width = 1600;
const height = 560;
const cardY = 148;
const cardH = 160;
const mid = cardY + cardH / 2;
const laneW = 340;
const gap = 48;
const cardW = (width - 128 - laneW - gap * 4) / 4;
const xs = [64];
[cardW, cardW, laneW, cardW].forEach((w, i) => xs.push(xs[i] + w + gap));
const bandY = 392;

function render(copy, lang) {
  const parts = [];
  const add = (value) => parts.push(value);
  const text = (x, y, value, size, color, weight = 400, extra = '') => {
    add(`<text x="${x}" y="${y}" font-size="${size}" fill="${color}" font-weight="${weight}" ${extra}>${escape(value)}</text>`);
  };
  const label = (x, y, value) => text(x, y, value, 15, brand.ion, 500, `font-family="${mono}" letter-spacing="1.5"`);
  const rect = (x, y, w, h, { fill = dark['surface-muted'], stroke = dark.border, radius = 10 } = {}) => {
    add(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${radius}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`);
  };
  const arrow = (d) => add(`<path d="${d}" fill="none" stroke="${brand.ion}" stroke-width="2" marker-end="url(#arrow)"/>`);

  add('<?xml version="1.0" encoding="UTF-8"?>');
  add(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title description" lang="${lang}">`);
  add(`<title id="title">Pero — ${escape(copy.title)}</title>`);
  add(`<desc id="description">${escape(copy.description)}</desc>`);
  add(`<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M 0 1 L 9 5 L 0 9" fill="none" stroke="${brand.ion}" stroke-width="1.6"/></marker></defs>`);
  rect(0, 0, width, height, { fill: brand.navy, stroke: 'none', radius: 16 });
  add(`<g font-family="${sans}">`);

  text(64, 64, copy.title, 32, dark.text, 650);
  rect(1256, 38, 280, 34, { fill: 'none', radius: 6 });
  text(1396, 60, copy.chip, 12, dark['text-muted'], 500, `font-family="${mono}" letter-spacing="0.5" text-anchor="middle"`);

  copy.steps.forEach(([tag, title, lines], i) => {
    label(xs[i], 122, tag);
    if (!title) return;
    const accepted = i === copy.steps.length - 1;
    rect(xs[i], cardY, cardW, cardH, accepted ? { fill: dark['accent-soft'], stroke: brand.ion } : {});
    text(xs[i] + 20, cardY + 44, title, 24, dark.text, 650);
    lines.forEach((line, j) => text(xs[i] + 20, cardY + 82 + j * 25, line, 18, dark['text-muted']));
  });

  // Step 3 fans out: any of the three can claim the same contract.
  copy.lanes.forEach(([title, detail], i) => {
    const y = cardY + i * 56 - 8;
    const cy = y + 24;
    rect(xs[2], y, laneW, 48, { radius: 8 });
    add(`<g fill="none" stroke="${brand.ion}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${icons[i](xs[2] + 28, cy)}</g>`);
    text(xs[2] + 56, cy + 7, title, 19, dark.text, 600);
    text(xs[2] + laneW - 16, cy + 6, detail, 14, dark['text-muted'], 400, 'text-anchor="end"');
    arrow(`M ${xs[1] + cardW} ${mid} C ${xs[2] - 24} ${mid}, ${xs[2] - 24} ${cy}, ${xs[2] - 2} ${cy}`);
    arrow(`M ${xs[2] + laneW} ${cy} C ${xs[3] - 24} ${cy}, ${xs[3] - 24} ${mid}, ${xs[3] - 2} ${mid}`);
  });
  arrow(`M ${xs[0] + cardW} ${mid} H ${xs[1] - 2}`);
  arrow(`M ${xs[3] + cardW} ${mid} H ${xs[4] - 2}`);

  // Project memory: accepted results flow in, the next question draws on it.
  rect(64, bandY, width - 128, 112, { radius: 12 });
  label(96, bandY + 38, copy.memory);
  text(width - 96, bandY + 38, copy.memoryNote, 16, dark['text-muted'], 400, 'text-anchor="end"');
  text(96, bandY + 80, copy.memoryItems, 24, dark.text, 500);
  const back = xs[4] + cardW / 2;
  const front = xs[0] + cardW / 2;
  const labelY = (cardY + cardH + bandY) / 2 + 6;
  arrow(`M ${back} ${cardY + cardH} V ${bandY - 2}`);
  text(back + 12, labelY, copy.accept, 15, brand.ion, 500, `font-family="${mono}"`);
  arrow(`M ${front} ${bandY} V ${cardY + cardH + 2}`);
  text(front + 12, labelY, copy.context, 15, brand.ion, 500, `font-family="${mono}"`);

  add('</g>');
  add('</svg>');
  return `${parts.join('\n')}\n`;
}

for (const [lang, copy] of Object.entries(locales)) {
  const output = new URL(`docs/assets/${copy.file}`, root);
  const svg = render(copy, lang);
  if (process.argv.includes('--check')) {
    if (readFileSync(output, 'utf8') !== svg) throw new Error('Run npm run gen:overview');
  } else {
    writeFileSync(output, svg);
    console.log(`Wrote ${output.pathname}`);
  }
}
