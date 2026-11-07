#!/usr/bin/env python3
"""Generate bilingual Paper workflow schematics with the Python standard library.

Run this file to regenerate the bilingual combined diagrams and four standalone
stages in docs/assets/openpero-paper-research*.svg.
Use --check for deterministic verification, or --out-dir for local review.

Layout references: user-supplied library and selected-PDF/shared-Chat screenshots
reviewed on 2026-11-07 (their app revision is unknown), and older controlled
fixture import/reader captures. Source supplements the unscreened record/report
state: apps/paper-agent/ui-src/{workspace-nav,library,library-papers,index,
pdf-reader,research-records,report-content}.tsx and research-history.css at
c12c2ab0. The screenshot-visible navigation is intentional; later source-only
controls are not added. This is editorial artwork, not runtime acceptance.
"""
import argparse
from dataclasses import dataclass
from html import escape
from pathlib import Path
import sys
import xml.etree.ElementTree as ET

INK = '#20272B'
MUTED = '#667075'
LINE = '#D7DCDF'
SOFT = '#F5F7F7'
WARM = '#A87531'
CREAM = '#FBF3E7'
WIDTH, HEIGHT = 1600, 2790

# Existing Lucide glyphs used by the product's shared icon family. Embedded here
# so regeneration needs no npm installation. Each SVG includes the full shared
# ISC and Feather-derived MIT notices from the repository's existing license.
ICON_LICENSE = (Path(__file__).resolve().parents[2] / 'packages' / 'icons' / 'LICENSE-LUCIDE').read_text(encoding='utf-8')
ICONS = {
    'book-open': '<path d="M12 5v16"/><path d="M20.001 19A2 2 0 0022 17V5a2 2 0 00-1.999-2L16 3.002A5 5 0 0012 5a5 5 0 00-4-2H4a2 2 0 00-2 2v12a2 2 0 001.999 2H8a5 5 0 014 2 5 5 0 014-2z"/>',
    'list': '<path d="M3 5h.01"/><path d="M3 12h.01"/><path d="M3 19h.01"/><path d="M8 5h13"/><path d="M8 12h13"/><path d="M8 19h13"/>',
    'drafting-compass': '<path d="m12.99 6.74 1.93 3.44"/><path d="M19.136 12a10 10 0 0 1-14.271 0"/><path d="m21 21-2.16-3.84"/><path d="m3 21 8.02-14.26"/><circle cx="12" cy="5" r="2"/>',
    'file-text': '<path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"/><path d="M14 2v5a1 1 0 0 0 1 1h5"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
    'clock': '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    'folder': '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
    'message-square': '<path d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z"/>',
    'rows-2': '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 12h18"/>',
    'network': '<rect x="16" y="16" width="6" height="6" rx="1"/><rect x="2" y="16" width="6" height="6" rx="1"/><rect x="9" y="2" width="6" height="6" rx="1"/><path d="M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3"/><path d="M12 12V8"/>',
    'database': '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5V19A9 3 0 0 0 21 19V5"/><path d="M3 12A9 3 0 0 0 21 12"/>',
    'layout-grid': '<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/>',
    'terminal': '<path d="M12 19h8"/><path d="m4 17 6-6-6-6"/>',
    'settings': '<path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915"/><circle cx="12" cy="12" r="3"/>',
    'panel-left': '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/>',
    'panel-right': '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M15 3v18"/>',
    'search': '<path d="m21 21-4.34-4.34"/><circle cx="11" cy="11" r="8"/>',
    'rotate-cw': '<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>',
    'plus': '<path d="M5 12h14"/><path d="M12 5v14"/>',
    'arrow-left': '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
    'arrow-right': '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
    'chevron-left': '<path d="m15 18-6-6 6-6"/>',
    'chevron-right': '<path d="m9 18 6-6-6-6"/>',
    'chevron-down': '<path d="m6 9 6 6 6-6"/>',
    'x': '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    'sparkles': '<path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z"/><path d="M20 2v4"/><path d="M22 4h-4"/><circle cx="4" cy="20" r="2"/>',
    'box': '<path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>',
    'shield-check': '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
    'git-compare': '<circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M13 6h3a2 2 0 0 1 2 2v7"/><path d="M11 18H8a2 2 0 0 1-2-2V9"/>',
    'file-code': '<path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"/><path d="M14 2v5a1 1 0 0 0 1 1h5"/><path d="M10 12.5 8 15l2 2.5"/><path d="m14 12.5 2 2.5-2 2.5"/>',
}

ZH = {
    'Add a paper': '入库', 'Read': '正文', 'Read the original': '阅读',
    'Ask with context': '提问', 'Review the record': '回查',
    'Papers': '论文', 'Sessions': '会话', 'Projects': '项目',
    'Environments': '执行环境', 'App Store': '应用商店', 'Terminal': '终端',
    'Settings': '设置', 'Library': '文库', 'Discover': '发现',
    'Research results': '研究结果', 'Reading': '在读', 'To read': '待读',
    'Collections': '合集', 'Example set A': '示例合集 A', 'Example set B': '示例合集 B',
    'All papers': '全部论文', '3 papers': '3 篇论文', 'Add papers': '添加论文',
    'Search title, authors and full text…': '搜索标题、作者和全文…',
    'All statuses': '全部状态', 'Recently added': '最近添加',
    'Paper': '论文', 'Source': '来源', 'Status': '状态',
    'Example paper A': '示例论文 A', 'Example paper B': '示例论文 B', 'Example paper C': '示例论文 C',
    'Imported': '导入', 'Local PDF': '本地 PDF', 'Continue reading': '继续阅读', 'Added': '添加于',
    'Today': '今天', 'Nov 7, 2026': '2026年11月7日',
    'Nov 6, 2026': '2026年11月6日', 'Research record': '研究记录',
    'Continue discovery': '继续发现', 'Download PDF': '下载 PDF', 'Download TeX': '下载 TeX',
    'Search': '检索', 'Import text': '导入文本', 'Research URL': '链接导入',
    'Import PDF': '导入 PDF', 'Choose a PDF file or drop it into the window': '选择 PDF 文件，或拖入窗口',
    'Ask AI': '询问 AI', 'Note (optional)': '备注（可选）',
    'Highlight': '高亮', 'Discuss selection': '讨论选段', 'Close': '关闭',
    'Artifacts': '产物', 'Start with a task': '从一个任务开始',
    'Select an Agent and workspace.': '选择 Agent 和工作目录。',
    'Agent: Pero': 'Agent: Pero', 'example': '示例目录',
    'Selected passage': '所选原文片段', 'Auto review': '自动审查', 'Send': '发送',
    'What supports this claim?': '这项结论有哪些依据？', 'What is missing?': '还缺少什么证据？',
    'Report saved': '报告已保存', 'Question saved': '提问已保存',
    'Conclusions not verified': '结论尚未核验', 'Limitations': '局限与缺口',
    '1  Page 2 ↗': '1  页码 2 ↗', 'Continue from here': '从此处追问',
    'Pero Paper: add, read, ask, and review': 'Pero 论文：入库、阅读、提问与回查',
}
DESC = {
    'en': 'Simplified editorial UI schematic based on user-supplied library and selected-PDF/shared-Chat screenshots reviewed on 2026-11-07, whose application revision is unknown. Older controlled fixture captures inform the import and reader layout. Paper source at c12c2ab0 supplements the research-record and report state not shown in those screenshots. The global workbench sidebar is abbreviated, but remains separate from the Paper tab and Paper internal navigation. The internal menu follows the screenshot-visible Library, Discover, Research results, Papers, Reading, To read, and Collections hierarchy; newer source-only controls are intentionally omitted. Add papers opens Search, PDF, Import text, and Research URL tabs. Reader modes, page navigation, zoom, clock, and Ask AI occupy one header row. Selection actions sit immediately below it. The local-PDF example has no HTTPS Source target; TeX remains an unselected tab, which does not mean TeX source is available. The shared Host Chat has Artifacts, Agent/workspace selection, context chips, and a user-sent composer; Paper does not own a separate chat. Research record contains date-grouped questions and statuses, selected detail, citations, and Continue from here. Paper titles, collections, counts, page numbers, questions, dates, and document lines are illustrative placeholders, not user data or research findings. Gold marks editorial emphasis, not verification. No live GUI, fixed-version, scientific-quality, native-package, or production acceptance is claimed.',
    'zh-CN': '依据 2026-11-07 审阅的用户文库、PDF 选文与共享对话截图绘制的简化界面示意，截图对应的应用版本未知；旧受控 fixture 截图辅助确认导入页与阅读器布局。未截图的研究记录与报告状态以 c12c2ab0 的 Paper 源码补全。全局工作台侧栏有所省略，与顶部论文标签、Paper 内部导航分别呈现；内部菜单遵循用户截图可见的文库、发现、研究结果、论文、在读、待读和合集层级，不添加仅在较新源码出现的控件。添加论文页保留检索、PDF、导入文本、链接导入四个标签。阅读模式、翻页、缩放、时钟和询问 AI 位于同一顶栏；选文操作紧随其下。本地 PDF 示例没有 HTTPS 原文目标；TeX 保留为未选中的标签，不表示已有 TeX 源码。右侧为 Host 共享对话，包含产物、Agent 与工作目录选择、上下文标签和由用户发送的输入区，不是 Paper 独立对话框。研究记录展示按日期分组的问题与状态、所选详情、引用及从此处追问。论文标题、合集、计数、页码、问题、日期及正文线条均为示例占位，不含用户项目、真实论文内容或研究结论。金色仅表示插画强调，不表示核验通过。本图不代表本次真实界面运行、固定版本认证、科学质量、原生安装包或生产验收。',
}


@dataclass(frozen=True)
class Stage:
    slug: str
    method: str
    title: str
    top: int
    bottom: int
    next_arrow: tuple | None = None


# Standalone stages keep the approved geometry, a title baseline of 48, and
# 36 units below the last panel. Only combined diagrams connect the stages.
STAGES = (
    Stage('01-add', 'library', 'Add a paper', 0, 994, (976, 999)),
    Stage('02-read', 'reading', 'Read the original', 995, 1458, (1441, 1464)),
    Stage('03-ask', 'asking', 'Ask with context', 1460, 2069, (2052, 2075)),
    Stage('04-review', 'records', 'Review the record', 2071, 2790),
)
STAGE_DESC = {
    '01-add': {
        'en': 'The abbreviated global workbench sidebar, Paper tab, and internal Paper navigation remain separate. The Library shows a paper list and inspector. An internal connector leads to the expanded Add papers view with Search, PDF, Import text, and Research URL tabs.',
        'zh-CN': '省略后的全局工作台侧栏、顶部论文标签与 Paper 内部导航分别呈现。文库包含论文列表与详情栏，图内连接线指向展开的添加论文页，保留检索、PDF、导入文本和链接导入四个标签。',
    },
    '02-read': {
        'en': 'The PDF reader keeps modes, page navigation, zoom, clock, and Ask AI in one header row. The local-PDF example has no HTTPS Source target. TeX is unselected and does not imply available TeX source.',
        'zh-CN': 'PDF 阅读器将阅读模式、翻页、缩放、时钟和询问 AI 放在同一顶栏。本地 PDF 示例没有 HTTPS 原文目标；TeX 未选中，不表示已有 TeX 源码。',
    },
    '03-ask': {
        'en': 'Selection actions sit directly below the PDF reader header. The shared Host Chat contains Artifacts, Agent/workspace selection, paper and passage context chips, and a draft that the user sends. Paper does not own a separate chat.',
        'zh-CN': '选文操作紧随 PDF 阅读器顶栏。Host 共享对话包含产物、Agent 与工作目录选择、论文及选段上下文标签和由用户发送的草稿，不是 Paper 独立对话框。',
    },
    '04-review': {
        'en': 'The Research record sidebar shows date-grouped questions and saved statuses, selected report detail, an unverified-conclusion notice, a citation pointing back to page 2, limitations, and Continue from here.',
        'zh-CN': '研究记录侧栏展示按日期分组的问题及保存状态、所选报告详情、结论尚未核验提示、指回第 2 页的引用、局限与缺口，以及从此处追问。',
    },
}
STAGE_PROVENANCE = {
    'en': 'Simplified editorial UI schematic based on user-supplied library and selected-PDF/shared-Chat screenshots reviewed on 2026-11-07, whose application revision is unknown. Older controlled fixture captures inform import and reader layout; Paper source at c12c2ab0 supplements the unscreened record/report state. Titles, collections, counts, page numbers, questions, dates, and document lines are illustrative placeholders, not user data or research findings. Gold is editorial emphasis, not verification. No live GUI, fixed-version, scientific-quality, native-package, or production acceptance is claimed.',
    'zh-CN': '依据 2026-11-07 审阅的用户文库、PDF 选文与共享对话截图绘制的简化界面示意，截图对应的应用版本未知；旧受控 fixture 截图辅助确认导入与阅读器布局，未截图的研究记录和报告状态以 c12c2ab0 的 Paper 源码补全。标题、合集、计数、页码、问题、日期及正文线条均为示例占位，不含用户数据或研究结论。金色仅表示插画强调，不表示核验通过。本图不代表本次真实界面运行、固定版本认证、科学质量、原生安装包或生产验收。',
}


class Diagram:
    def __init__(self, lang):
        self.lang = lang
        self.parts = []

    def add(self, value):
        self.parts.append(value)

    def rect(self, x, y, w, h, fill='white', stroke=LINE, rx=0, sw=1.5):
        self.add(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" fill="{fill}" stroke="{stroke}" stroke-width="{sw}"/>')

    def line(self, x1, y1, x2, y2, color=LINE, sw=2, extra=''):
        self.add(f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{color}" stroke-width="{sw}" {extra}/>')

    def path(self, data, color=INK, sw=2, extra=''):
        self.add(f'<path d="{data}" fill="none" stroke="{color}" stroke-width="{sw}" {extra}/>')

    def text(self, x, y, value, size=22, color=INK, weight=400, anchor='start'):
        label = ZH.get(value, value) if self.lang == 'zh-CN' else value
        self.add(f'<text x="{x}" y="{y}" font-size="{size}" fill="{color}" font-weight="{weight}" text-anchor="{anchor}">{escape(label)}</text>')

    def icon(self, name, x, y, size=24, color=MUTED):
        self.add(f'<g transform="translate({x} {y}) scale({size / 24})" fill="none" stroke="{color}" stroke-width="1.8">{ICONS[name]}</g>')

    def lines(self, x, y, widths, step=17, color=LINE, sw=3):
        for i, width in enumerate(widths):
            self.line(x, y + i * step, x + width, y + i * step, color, sw)

    def button(self, x, y, w, label, emphasis=False, icon=None, size=22):
        self.rect(x, y, w, 38, CREAM if emphasis else 'white', WARM if emphasis else LINE, 5)
        if icon:
            self.icon(icon, x + 12, y + 7, 23, INK)
            self.text(x + 44, y + 27, label, size, weight=500)
        else:
            self.text(x + w / 2, y + 27, label, size, weight=500, anchor='middle')

    def stage(self, y, number, label):
        self.text(56, y, number, 26, MUTED, 600)
        self.line(103, y - 10, 137, y - 10, WARM, 3)
        self.text(158, y, label, 31, weight=650)

    def arrow(self, y1, y2):
        self.line(800, y1, 800, y2, MUTED, 2, 'marker-end="url(#arrow)"')

    def nav_row(self, x, y, width, label, glyph, active=False, count=None):
        if active:
            self.rect(x - 12, y - 28, width, 39, CREAM, 'none', 5, 0)
        self.icon(glyph, x, y - 21, 24, INK if active else MUTED)
        self.text(x + 37, y, label, weight=600 if active else 400)
        if count is not None:
            self.rect(x + width - 50, y - 24, 26, 27, SOFT, 'none', 4, 0)
            self.text(x + width - 37, y - 3, str(count), 22, MUTED, anchor='middle')

    def reader_bar(self, x, y, w, show_actions=True, page=1, records=False):
        self.rect(x, y, w, 58, SOFT, 'none', sw=0)
        self.icon('arrow-left', x + 18, y + 18)
        self.text(x + 52, y + 37, 'Library')
        # All modes and PDF controls remain on this single row, even with a sidebar.
        start = x + 166
        for dx, label in [(0, 'Read'), (78, 'PDF'), (146, 'TeX'), (214, '原文' if self.lang == 'zh-CN' else 'Source')]:
            self.text(start + dx, y + 37, label, 22, LINE if label in ('Source', '原文') else INK if label == 'PDF' else MUTED, 600 if label == 'PDF' else 400)
        self.line(start + 72, y + 49, start + 122, y + 49, WARM, 3)
        self.icon('chevron-left', start + 325, y + 19, 21)
        self.rect(start + 355, y + 12, 42, 35, 'white', LINE, 4)
        self.text(start + 376, y + 37, str(page), 22, anchor='middle')
        self.text(start + 405, y + 37, '/ 8', 22, MUTED)
        self.icon('chevron-right', start + 451, y + 19, 21)
        self.text(start + 490, y + 37, '−', 24, MUTED)
        self.text(start + 524, y + 37, '99%', 22, MUTED)
        self.text(start + 582, y + 37, '+', 24, MUTED)
        if show_actions:
            if records:
                self.rect(x + w - 169, y + 9, 39, 39, CREAM, 'none', 5, 0)
            self.icon('clock', x + w - 161, y + 17, 24, INK)
            self.icon('sparkles', x + w - 117, y + 18, 22, WARM)
            self.text(x + w - 85, y + 37, 'Ask AI', 22)
        self.line(x, y + 58, x + w, y + 58, LINE, 1.5)

    def page(self, x, y, w, h, selected=False, page_number=1):
        self.rect(x, y, w, h, 'white', LINE, sw=1)
        self.lines(x + 54, y + 36, [w * .50, w * .69], 19, MUTED, 3)
        self.lines(x + 54, y + 93, [w - 108, w - 108, w - 142], 17)
        if selected:
            self.rect(x + 47, y + 113, w - 94, 25, CREAM, 'none', 1, 0)
            self.line(x + 54, y + 126, x + w - 60, y + 126, WARM, 3)
        for row in range(max(0, int((h - 198) / 17))):
            self.lines(x + 54, y + 165 + row * 17, [w - 108 if row % 4 != 3 else w - 165])
        self.text(x + w / 2, y + h - 16, str(page_number), 21, MUTED, anchor='middle')

    def library(self):
        self.stage(48, '01', 'Add a paper')
        self.rect(56, 80, 1488, 620, 'white', LINE, 7)
        self.rect(57, 81, 1486, 47, SOFT, 'none', 6, 0)
        self.line(56, 128, 1544, 128, LINE, 1.5)
        self.icon('panel-left', 80, 93)
        self.rect(288, 87, 179, 35, 'white', LINE, 5)
        self.icon('book-open', 303, 93, 24, INK)
        self.text(340, 113, 'Papers', 23, weight=600)
        self.icon('x', 435, 96, 18)
        # Workbench navigation is abbreviated with an ellipsis, never conflated
        # with the separate Paper navigation to its right.
        self.rect(57, 129, 215, 570, SOFT, 'none', sw=0)
        self.line(272, 128, 272, 700, LINE, 1.5)
        for y, label, glyph in [(171, 'Sessions', 'message-square'), (213, 'Projects', 'folder'), (255, 'Insights', 'rows-2'), (314, 'Papers', 'book-open'), (356, 'Compute', 'network'), (398, 'Data', 'database'), (440, 'Environments', 'network'), (500, 'App Store', 'layout-grid'), (608, 'Terminal', 'terminal'), (659, 'Settings', 'settings')]:
            self.nav_row(80, y, 184, label, glyph, label == 'Papers')
        self.line(74, 279, 254, 279)
        self.line(74, 466, 254, 466)
        self.text(91, 555, '…', 28, MUTED)
        # Paper-owned navigation follows the supplied visible menu exactly.
        self.rect(273, 129, 259, 570, SOFT, 'none', sw=0)
        self.line(532, 128, 532, 700, LINE, 1.5)
        for y, label, glyph, count in [(171, 'Library', 'list', 3), (215, 'Discover', 'drafting-compass', None), (259, 'Research results', 'file-text', None), (351, 'Reading', 'book-open', 2), (393, 'To read', 'clock', 1), (490, 'Example set A', 'folder', None), (534, 'Example set B', 'folder', None)]:
            self.nav_row(294, y, 226, label, glyph, label == 'Library', count)
        self.text(294, 308, 'Papers', 21, MUTED)
        self.text(294, 445, 'Collections', 21, MUTED)
        # Library centre list and right-hand inspector are distinct panes.
        self.text(556, 170, 'All papers', 27, weight=650)
        self.text(727, 170, '3 papers', 21, MUTED)
        self.icon('rotate-cw', 958, 147)
        self.button(996, 140, 164, 'Add papers', True, 'plus', 21)
        self.rect(556, 198, 604, 40, 'white', MUTED, 5)
        self.icon('search', 568, 206)
        self.text(606, 226, 'Search title, authors and full text…', 22, MUTED)
        self.button(556, 258, 170, 'All statuses', size=21)
        self.icon('chevron-down', 699, 271, 16)
        self.button(958, 258, 202, 'Recently added', size=21)
        self.icon('chevron-down', 1136, 271, 16)
        self.text(556, 322, 'Paper', 21, MUTED)
        self.text(958, 322, 'Source', 21, MUTED)
        self.text(1061, 322, 'Status', 21, MUTED)
        for i, (label, status) in enumerate([('Example paper A', 'Reading'), ('Example paper B', 'Reading'), ('Example paper C', 'To read')]):
            y = 337 + i * 108
            if i == 0:
                self.rect(544, y, 628, 96, SOFT, 'none', 5, 0)
            self.rect(558, y + 24, 22, 22, 'white', MUTED, 4)
            self.text(597, y + 34, label, 24, weight=600)
            self.lines(597, y + 60, [270, 196], 14, LINE, 3)
            self.text(944, y + 43, 'Local PDF', 21, MUTED)
            self.icon('book-open' if i < 2 else 'clock', 1057, y + 23, 21)
            self.text(1085, y + 43, status, 21, MUTED)
            self.line(556, y + 102, 1160, y + 102, LINE, 1)
        self.line(1182, 128, 1182, 700, LINE, 1.5)
        self.text(1206, 174, 'Example paper A', 27, weight=650)
        self.lines(1206, 205, [280, 228], 19, MUTED, 3)
        self.lines(1206, 254, [254], 17, LINE, 3)
        self.button(1206, 279, 139, 'Reading')
        self.icon('chevron-down', 1320, 291, 18)
        self.button(1206, 336, 313, 'Continue reading', True, 'book-open')
        self.icon('arrow-right', 1483, 344, 22)
        self.text(1206, 416, 'Source', 21, MUTED)
        self.text(1350, 416, 'Local PDF', 22)
        self.text(1206, 456, 'Added', 21, MUTED)
        self.text(1350, 456, 'Today', 22)
        self.line(1206, 480, 1518, 480)
        for y, label, glyph in [(522, 'Research record', 'clock'), (566, 'Continue discovery', 'drafting-compass'), (610, 'Download PDF', 'file-text')]:
            self.icon(glyph, 1209, y - 21, 23)
            self.text(1247, y, label, 22)
        # Expanded importer crop, not an invented modal or a second sidebar.
        self.path('M1040 701 V720 H982 V736', MUTED, 2, 'marker-end="url(#arrow)"')
        self.rect(532, 742, 1012, 216, 'white', LINE, 6)
        self.icon('chevron-left', 557, 761, 23)
        self.text(599, 783, 'Add papers', 27, weight=650)
        for x, label in [(557, 'Search'), (685, 'PDF'), (792, 'Import text'), (978, 'Research URL')]:
            self.text(x, 831, label, 23, INK if label == 'PDF' else MUTED, 600 if label == 'PDF' else 400)
        self.line(557, 845, 1518, 845, LINE, 1.5)
        self.line(681, 845, 735, 845, WARM, 3)
        self.button(557, 874, 192, 'Import PDF', True, 'file-text')
        self.text(775, 901, 'Choose a PDF file or drop it into the window', 22, MUTED)

    def reading(self):
        self.stage(1043, '02', 'Read the original')
        self.rect(56, 1076, 1488, 346, SOFT, LINE, 6)
        self.reader_bar(56, 1076, 1488)
        self.page(369, 1155, 862, 245)

    def asking(self):
        self.stage(1508, '03', 'Ask with context')
        self.rect(56, 1541, 1488, 492, SOFT, LINE, 6)
        self.reader_bar(56, 1541, 1014, show_actions=False)
        self.rect(57, 1599, 1012, 58, 'white', 'none', sw=0)
        self.rect(78, 1610, 314, 36, 'white', MUTED, 4)
        self.text(92, 1636, 'Note (optional)', 22, MUTED)
        self.text(420, 1636, 'Highlight', 22)
        self.rect(557, 1607, 222, 42, CREAM, 'none', 5, 0)
        self.text(575, 1636, 'Discuss selection', 22, weight=500)
        self.text(811, 1636, 'Close', 22, MUTED)
        self.line(56, 1657, 1070, 1657, LINE, 1.5)
        self.page(179, 1680, 766, 331, selected=True)
        # Shared Host Chat: actual top artifact control, empty state and bottom
        # Agent/workspace row, frozen references, draft and shared send controls.
        self.rect(1070, 1542, 473, 490, 'white', 'none', sw=0)
        self.line(1070, 1541, 1070, 2033, MUTED, 1.5)
        self.icon('panel-right', 1358, 1559, 22)
        self.text(1392, 1578, 'Artifacts', 22)
        self.icon('panel-right', 1505, 1559, 22)
        self.line(1070, 1599, 1544, 1599, LINE, 1.5)
        self.text(1101, 1653, 'Start with a task', 28, weight=600)
        self.text(1101, 1693, 'Select an Agent and workspace.', 22, MUTED)
        self.icon('chevron-right', 1092, 1754, 18)
        self.text(1120, 1775, 'Agent: Pero', 22)
        self.icon('chevron-down', 1259, 1757, 18)
        self.icon('folder', 1306, 1754, 22)
        self.text(1339, 1775, 'example', 22)
        self.rect(1086, 1795, 442, 219, 'white', MUTED, 14)
        self.rect(1101, 1810, 412, 39, SOFT, 'none', 6, 0)
        self.icon('box', 1112, 1819, 22)
        self.text(1147, 1837, 'Example paper A', 22)
        self.icon('x', 1480, 1820, 18)
        self.rect(1101, 1860, 357, 34, SOFT, LINE, 5)
        self.text(1114, 1885, 'Selected passage', 21)
        self.text(1103, 1935, 'What supports this claim?', 23)
        self.icon('plus', 1103, 1970, 23)
        self.icon('shield-check', 1145, 1970, 22)
        self.text(1176, 1991, 'Auto review', 22)
        self.icon('git-compare', 1316, 1970, 22)
        self.text(1347, 1991, 'Diff', 22)
        self.button(1410, 1964, 100, 'Send', True, size=21)

    def records(self):
        self.stage(2119, '04', 'Review the record')
        self.rect(56, 2152, 1488, 602, SOFT, LINE, 6)
        # Wider reader preserves the single-row controls. Records is a separate
        # right sidebar with its own title and close control, not a clock title.
        self.reader_bar(56, 2152, 982, page=2, records=True)
        self.page(138, 2236, 816, 493, selected=True, page_number=2)
        self.rect(1038, 2153, 505, 600, 'white', 'none', sw=0)
        self.line(1038, 2152, 1038, 2754, MUTED, 1.5)
        self.text(1062, 2190, 'Research record', 26, weight=600)
        self.icon('x', 1501, 2170, 23)
        self.line(1038, 2210, 1544, 2210, LINE, 1.5)
        self.text(1062, 2247, 'Nov 7, 2026', 21, MUTED)
        self.rect(1054, 2261, 474, 76, CREAM, 'none', 5, 0)
        self.icon('file-text', 1068, 2275, 22)
        self.text(1104, 2296, 'What supports this claim?', 23, weight=500)
        self.text(1104, 2323, 'Report saved', 21, MUTED)
        self.icon('chevron-right', 1499, 2276, 19)
        self.text(1506, 2323, '10:30', 21, MUTED, anchor='end')
        self.text(1062, 2371, 'Nov 6, 2026', 21, MUTED)
        self.icon('clock', 1068, 2394, 22)
        self.text(1104, 2415, 'What is missing?', 23)
        self.text(1104, 2442, 'Question saved', 21, MUTED)
        self.icon('chevron-right', 1499, 2395, 19)
        self.text(1506, 2442, '16:20', 21, MUTED, anchor='end')
        self.line(1062, 2464, 1520, 2464)
        self.text(1062, 2504, 'What supports this claim?', 24, weight=600)
        self.text(1062, 2537, 'Conclusions not verified', 21, MUTED)
        self.lines(1062, 2561, [440], 16)
        self.button(1062, 2580, 177, '1  Page 2 ↗', True, size=22)
        self.path('M1051 2599 H968', WARM, 2, 'marker-end="url(#arrow)"')
        self.text(1062, 2652, 'Limitations', 22, weight=600)
        self.lines(1062, 2672, [442], 16)
        self.button(1062, 2698, 257, 'Continue from here', size=22)

    def render(self, stage=None):
        self.parts = []
        height = stage.bottom - stage.top if stage else HEIGHT
        title = 'Pero Paper: add, read, ask, and review'
        title = ZH[title] if self.lang == 'zh-CN' else title
        desc = DESC[self.lang]
        if stage:
            label = ZH[stage.title] if self.lang == 'zh-CN' else stage.title
            prefix = 'Pero 论文：' if self.lang == 'zh-CN' else 'Pero Paper: '
            title = f'{prefix}{stage.slug[:2]} · {label}'
            desc = f'{STAGE_DESC[stage.slug][self.lang]} {STAGE_PROVENANCE[self.lang]}'
        self.add(f'<svg xmlns="http://www.w3.org/2000/svg" width="{WIDTH}" height="{height}" viewBox="0 0 {WIDTH} {height}" role="img" aria-labelledby="title desc" xml:lang="{self.lang}">')
        self.add(f'<title id="title">{escape(title)}</title>')
        self.add(f'<desc id="desc">{escape(desc)}</desc>')
        self.add(f'<metadata id="icon-license">{escape(ICON_LICENSE)}</metadata>')
        self.add('<defs><marker id="arrow" viewBox="0 0 12 12" refX="10" refY="6" markerWidth="12" markerHeight="12" orient="auto" markerUnits="userSpaceOnUse"><path d="M2 2 L10 6 L2 10" fill="none" stroke="#667075" stroke-width="2"/></marker></defs>')
        self.add('<style>text{font-family:"Noto Sans CJK SC","Noto Sans CJK",Arial,sans-serif}path,line,rect,polyline,polygon,circle,ellipse{stroke-linecap:round;stroke-linejoin:round}</style>')
        self.rect(0, 0, WIDTH, height, 'white', 'none', sw=0)
        if stage:
            self.add(f'<g transform="translate(0 {-stage.top})">')
            getattr(self, stage.method)()
            self.add('</g>')
        else:
            for item in STAGES:
                getattr(self, item.method)()
                if item.next_arrow:
                    self.arrow(*item.next_arrow)
        self.add('</svg>')
        svg = '\n'.join(self.parts) + '\n'
        ET.fromstring(svg)
        return svg


def main():
    parser = argparse.ArgumentParser(description='Generate screenshot-informed Paper workflow schematics.')
    parser.add_argument('--out-dir', type=Path, default=Path(__file__).resolve().parents[2] / 'docs' / 'assets')
    parser.add_argument('--basename', default='openpero-paper-research')
    parser.add_argument('--lang', choices=['en', 'zh-CN', 'both'], default='both')
    parser.add_argument('--check', action='store_true', help='Check deterministic output without writing files.')
    args = parser.parse_args()
    if not args.check:
        args.out_dir.mkdir(parents=True, exist_ok=True)
    stale = []
    for lang in ('en', 'zh-CN') if args.lang == 'both' else (args.lang,):
        suffix = '' if lang == 'en' else '.zh-CN'
        for stage in (None, *STAGES):
            stage_suffix = f'-{stage.slug}' if stage else ''
            target = args.out_dir / f'{args.basename}{stage_suffix}{suffix}.svg'
            content = Diagram(lang).render(stage)
            if args.check:
                if not target.is_file() or target.read_text(encoding='utf-8') != content:
                    stale.append(str(target))
                else:
                    print(f'OK: {target}')
            else:
                target.write_text(content, encoding='utf-8')
                print(target)
    for target in stale:
        print(f'Stale or missing: {target}', file=sys.stderr)
    return bool(stale)


if __name__ == '__main__':
    sys.exit(main())
