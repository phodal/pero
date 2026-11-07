#!/usr/bin/env python3
"""Generate the Paper first-use UI schematics in English and Chinese.

Install at scripts/codegen/paper-research.py, then run from any directory:
  python3 scripts/codegen/paper-research.py
  python3 scripts/codegen/paper-research.py --check

The default destination is docs/assets/ relative to the repository containing
this script. Use --out-dir and --basename for review output outside the repo.
Standard library only. Artwork is source-based, not a screenshot or a runtime
acceptance claim. Source provenance is recorded in the SVG description.
"""
from pathlib import Path
from html import escape
import argparse
import sys
import xml.etree.ElementTree as ET

parser = argparse.ArgumentParser(description='Generate source-based Paper research UI diagrams.')
parser.add_argument('--out-dir', type=Path, default=Path(__file__).resolve().parents[2] / 'docs' / 'assets')
parser.add_argument('--basename', default='openpero-paper-research')
parser.add_argument('--lang', choices=['en', 'zh-CN', 'both'], default='both')
parser.add_argument('--check', action='store_true', help='Check deterministic output without writing files.')
args = parser.parse_args()

OUT=args.out_dir
if not args.check:
 OUT.mkdir(parents=True, exist_ok=True)
stale = []
def emit(target, content):
 if args.check:
  if not target.is_file() or target.read_text(encoding='utf-8') != content:
   stale.append(str(target))
  else:
   print(f'OK: {target}')
 else:
  target.write_text(content, encoding='utf-8')
  print(target)
INK='#20272B'; MUTED='#667075'; LINE='#D7DCDF'; SOFT='#F5F7F7'; WARM='#A87531'; CREAM='#FBF3E7'
s=[]
def add(x): s.append(x)
def rect(x,y,w,h,fill='white',stroke=LINE,rx=0,sw=1.5,extra=''):
 add(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" fill="{fill}" stroke="{stroke}" stroke-width="{sw}" {extra}/>')
def line(x1,y1,x2,y2,color=LINE,sw=2,extra=''):
 add(f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{color}" stroke-width="{sw}" {extra}/>')
def path(d,color=INK,sw=2,fill='none',extra=''):
 add(f'<path d="{d}" fill="{fill}" stroke="{color}" stroke-width="{sw}" {extra}/>')
def text(x,y,t,size=22,color=INK,weight=400,anchor='start',extra=''):
 add(f'<text x="{x}" y="{y}" font-size="{size}" fill="{color}" font-weight="{weight}" text-anchor="{anchor}" {extra}>{escape(t)}</text>')
def lines(x,y,lengths,step=16,color=LINE,sw=3):
 for i,l in enumerate(lengths): line(x,y+i*step,x+l,y+i*step,color,sw)
def button(x,y,w,t,active=False,size=20):
 rect(x,y,w,36,INK if active else 'white',INK if active else LINE,5)
 text(x+w/2,y+25,t,size,'white' if active else INK,500,'middle')
def paper(x,y,w,h):
 path(f'M{x} {y} H{x+w-25} L{x+w} {y+25} V{y+h} H{x} Z',INK,2,'white')
 path(f'M{x+w-25} {y} V{y+25} H{x+w}',INK,2)
def ui(x,y,w,h,label):
 rect(x,y,w,h,'white',INK,8,2)
 rect(x+1,y+1,w-2,43,SOFT,'none',7,0)
 line(x,y+44,x+w,y+44,LINE,1.5)
 text(x+20,y+29,label,21,INK,600)
def step(x,y,n,title,caption):
 text(x,y,n,25,MUTED,600)
 line(x+45,y-9,x+72,y-9,WARM,3)
 text(x+90,y,title,31,INK,650)
 text(x,y+42,caption,23,MUTED)

add('<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1370" viewBox="0 0 1600 1370" role="img" aria-labelledby="title desc" xml:lang="en">')
add('<title id="title">Pero Paper research: import, read, ask, and check the source</title>')
add('<desc id="desc">Simplified editorial UI schematics, not screenshots. Based on Paper UI source at master aea25549 and cross-checked against the v0.1.0-dev.20261104 source tag. Only their shared first-use controls are illustrated. Step one opens Paper, Add papers, PDF, and Import PDF. Step two reads the saved original PDF and selects text for Highlight or Discuss selection; Ask AI is also in the reader header. Step three places a frozen paper or passage reference into the shared Host Chat draft. The user reviews and sends it using configured Agent access. The Agent can read and search saved sources and submit an evidence-linked report. Step four closes Chat and opens the reader clock control, Research record, to inspect a saved report, reviews unverified conclusions and limitations, and follows citations back to original PDF pages or regions, and can continue from the saved result. Ambiguous citations require Citation evidence selection. Sample paper lines, page numbers and questions illustrate the interaction and are not research findings. Reading and annotation do not need a model. This diagram does not claim autonomous-research, scientific-quality, native-package or production acceptance. Latest downloadable preview v0.1.0-dev.20261104 is a separate older revision from current master.</desc>')
add('<defs><marker id="arrow" viewBox="0 0 12 12" refX="10" refY="6" markerWidth="12" markerHeight="12" orient="auto" markerUnits="userSpaceOnUse"><path d="M2 2 L10 6 L2 10" fill="none" stroke="#667075" stroke-width="2"/></marker></defs>')
add('<style>text{font-family:"Noto Sans CJK SC","Noto Sans CJK",Arial,sans-serif}path,line,rect{stroke-linecap:round;stroke-linejoin:round}</style>')
rect(0,0,1600,1370,'white','none',0,0)
text(80,64,'PERO  /  PAPER RESEARCH',23,MUTED,600,extra='letter-spacing="1"')
text(1520,64,'UI schematics · Not screenshots',22,MUTED,400,'end')
text(80,133,'From a paper to an answer you can check.',44,INK,700)
text(80,177,'Read the original. Ask with context. Keep the evidence within reach.',25,MUTED)
line(80,205,1520,205,LINE,1.5)

# 01: actual Add papers PDF tab, shown as an editorial crop.
step(80,256,'01','Add a paper','Papers → Add papers → PDF')
ui(80,320,680,290,'Papers')
# Navigation is deliberately a subset, not a claim to a complete screen.
rect(81,365,156,244,SOFT,'none',0,0)
line(237,365,237,610,LINE,1.5)
rect(94,386,130,39,'white','none',4,0)
text(110,413,'Library',21,INK,600)
text(110,454,'Discover',20,MUTED)
text(110,493,'Reading',20,MUTED)
text(110,532,'To read',20,MUTED)
text(264,395,'Add papers',24,INK,600)
text(264,438,'Search',19,MUTED)
text(352,438,'PDF',20,INK,600)
text(420,438,'Import text',19,MUTED)
text(561,438,'Research URL',19,MUTED)
line(264,450,730,450,LINE,1.5)
line(348,449,394,449,INK,3)
paper(270,478,42,55)
button(336,479,160,'Import PDF',True,20)
text(336,548,'A local PDF',21,MUTED)
text(80,650,'Read and annotate without a model key.',23,MUTED)

# 02: reading chrome, original page and actual selected-text actions.
step(840,256,'02','Read the original','Inspect the paper and select a passage')
ui(840,320,680,290,'‹  Library')
text(1039,349,'paper.pdf',20,MUTED)
button(1376,325,125,'Ask AI',False,20)
text(862,395,'Read',20,MUTED)
text(935,395,'PDF',20,INK,600)
line(929,406,979,406,INK,3)
text(1495,395,'Original PDF',19,MUTED,400,'end')
rect(887,425,586,184,'white',LINE,0,1)
lines(917,448,[265,408],18,MUTED,3)
lines(917,492,[222,222,202],17,LINE,3)
lines(1197,492,[243,215,243],17,LINE,3)
rect(912,514,247,23,CREAM,'none',1,0)
line(919,526,1137,526,WARM,3)
rect(994,554,454,43,'white',INK,5,1.5)
text(1012,583,'Highlight',21,INK,500)
line(1126,565,1126,587,LINE,1.5)
text(1144,583,'Discuss selection',21,INK,500)
text(840,650,'Use Ask AI for a paper, or Discuss selection.',23,MUTED)

# Sequential transition through the centre gutter without pretending to be a UI control.
line(777,465,823,465,MUTED,2.2,'marker-end="url(#arrow)"')
path('M1180 682 V704 H420 V726',MUTED,1.7,extra='marker-end="url(#arrow)"')

# 03: shared Host Chat is separate from Paper's domain UI.
step(80,773,'03','Ask with evidence','Review the shared Chat draft, then send')
ui(80,837,680,300,'Original PDF')
text(446,866,'Shared Chat',21,INK,600)
line(420,838,420,1137,LINE,1.5)
rect(104,902,290,213,'white',LINE,0,1)
lines(127,929,[196,230],16,MUTED,3)
lines(127,977,[226,226,199,226,211,225],17,LINE,3)
rect(121,1002,242,24,CREAM,'none',1,0)
line(127,1014,350,1014,WARM,3)
text(446,908,'Paper context attached',21,MUTED)
rect(446,931,286,44,SOFT,LINE,5,1)
path('M461 944 H473 L479 950 V962 H461 Z',MUTED,1.8)
text(491,959,'Selected passage',20,INK,500)
rect(446,993,286,120,'white',INK,6,1.5)
text(463,1022,'What supports this claim?',20,INK)
text(463,1051,'Cite the source.',20,INK)
rect(679,1070,38,32,INK,INK,5,1)
path('M698 1094 V1080 M692 1086 L698 1080 L704 1086','white',2)
text(80,1177,'Configured Agent access is required.',23,MUTED)

# 04: close Chat, then use the reader's Research record sidebar.
step(840,773,'04','Review and continue','Close Chat → clock icon → Research record')
ui(840,837,680,300,'Original PDF')
add('<circle cx="1120" cy="858" r="10" fill="none" stroke="#667075" stroke-width="2"/>')
path('M1120 852 V858 L1125 861',MUTED,1.8)
text(1140,866,'Research record',21,INK,600)
line(1094,838,1094,1137,LINE,1.5)
rect(859,902,215,214,'white',LINE,0,1)
lines(878,929,[128,176],16,MUTED,3)
lines(878,976,[175,175,153,175,163,174],17,LINE,3)
rect(872,1002,185,24,CREAM,'none',1,0)
line(878,1014,1045,1014,WARM,3)
text(1117,915,'Report saved',22,INK,600)
text(1117,945,'Conclusions not verified',20,MUTED,500)
lines(1117,969,[370,312],13,LINE,3)
rect(1117,1001,185,34,CREAM,'none',4,0)
text(1129,1026,'1  Page 2 ↗',20,INK,500)
path('M1108 1015 H1065',MUTED,1.8,extra='marker-end="url(#arrow)"')
text(1117,1064,'Limitations',21,INK,600)
line(1250,1057,1489,1057,LINE,3)
button(1117,1083,226,'Continue from here',False,20)
text(840,1177,'Follow a citation back to the original PDF.',23,MUTED)
line(777,987,823,987,MUTED,2.2,'marker-end="url(#arrow)"')

line(80,1210,1520,1210,LINE,1.5)
text(80,1247,'Agent scope: read / search saved sources → record evidence → save a report.',22,INK,500)
text(80,1281,'Ambiguous source matches open Citation evidence. Research conclusions still need human review.',21,MUTED)
text(80,1315,'First setup may download Python/PDF dependencies. Use papers you are allowed to send to your Agent.',21,MUTED)
text(1520,1350,'Source-based schematic · Not installed-package acceptance',19,MUTED,400,'end')
add('</svg>')
TRANSLATIONS = {
 'PERO  /  PAPER RESEARCH': 'PERO  /  论文研究',
 'UI schematics · Not screenshots': '界面示意 · 非产品截图',
 'From a paper to an answer you can check.': '从一篇论文，到可回查的答案。',
 'Read the original. Ask with context. Keep the evidence within reach.': '阅读原文，带着上下文提问，回到来源核对证据。',
 'Add a paper': '导入论文',
 'Papers → Add papers → PDF': '论文 → 添加论文 → PDF',
 'Papers': '论文', 'Library': '文库', 'Discover': '发现', 'Reading': '在读', 'To read': '待读',
 'Add papers': '添加论文', 'Search': '检索', 'Import text': '导入文本', 'Research URL': '链接导入',
 'Import PDF': '导入 PDF', 'A local PDF': '本地 PDF 文件',
 'Read and annotate without a model key.': '阅读和标注无需模型密钥。',
 'Read the original': '阅读原文',
 'Inspect the paper and select a passage': '阅读论文，选择需要核对的原文片段',
 '‹  Library': '‹  文库', 'paper.pdf': '论文.pdf', 'Ask AI': '询问 AI', 'Read': '正文',
 'Original PDF': '原始 PDF', 'Highlight': '高亮', 'Discuss selection': '讨论选段',
 'Use Ask AI for a paper, or Discuss selection.': '可“询问 AI”，也可针对选段提问。',
 'Ask with evidence': '带着证据提问',
 'Review the shared Chat draft, then send': '检查共享对话中的草稿，再由你发送',
 'Shared Chat': '共享对话', 'Paper context attached': '已附带论文上下文', 'Selected passage': '所选原文片段',
 'What supports this claim?': '这项结论有哪些依据？', 'Cite the source.': '请引用原文。',
 'Configured Agent access is required.': '提问前需配置 Agent 的模型访问。',
 'Review and continue': '核对证据，继续追问',
 'Close Chat → clock icon → Research record': '收起对话 → 时钟图标 → 研究记录',
 'Research record': '研究记录', 'Report saved': '报告已保存',
 'Conclusions not verified': '结论尚未核验', '1  Page 2 ↗': '1  页码 2 ↗',
 'Limitations': '局限与缺口', 'Continue from here': '从此处追问', 'Export ▾': '导出 ▾',
 'Follow a citation back to the original PDF.': '点击引用，回到原始 PDF 核对。',
 'Agent scope: read / search saved sources → record evidence → save a report.': 'Agent 范围：读取 / 检索已保存来源 → 记录证据 → 保存报告。',
 'Ambiguous source matches open Citation evidence. Research conclusions still need human review.': '原文匹配不唯一时，通过“引用证据”选择位置。研究结论仍需人工复核。',
 'First setup may download Python/PDF dependencies. Use papers you are allowed to send to your Agent.': '首次准备可能下载 Python / PDF 依赖。仅向 Agent 发送你有权提供的论文。',
 'Source-based schematic · Not installed-package acceptance': '依据源码绘制 · 不代表安装包验收',
 'Pero Paper research: import, read, ask, and check the source': 'Pero 论文研究：导入、阅读、提问并回查原文',
}
ZH_DESC = '这是一张简化的界面示意图，不是产品截图。以主干 aea25549 的 Paper 界面源码为基础，并与 v0.1.0-dev.20261104 源码标签交叉核对，只展示两者共有的首次使用控件。第一步进入论文、添加论文、PDF、导入 PDF。第二步阅读已保存的原始 PDF，选择文字后高亮或讨论选段，也可使用阅读器顶栏的询问 AI。第三步把固定的论文或选段引用加入共享 Host 对话草稿，由用户检查并通过已配置的 Agent 发送。Agent 可读取和检索已保存来源，记录证据并提交带引用的报告。第四步收起对话，打开阅读器时钟图标的研究记录，检查保存的报告、未核验的结论和局限，点击引用回到原始 PDF 页或选区，也可从此处追问。匹配不唯一时，需要在引用证据中选择位置。图中的论文线条、页码和问题只说明交互，不代表真实研究发现。阅读和标注不需要模型。本图不宣称自动研究、科学质量、原生安装包或生产验收通过。检查时最新已发布的预览包 v0.1.0-dev.20261104 与主干是不同版本。'

svg = '\n'.join(s) + '\n'
if args.lang in ('en', 'both'):
 target = OUT / (args.basename + '.svg')
 emit(target, svg)
if args.lang in ('zh-CN', 'both'):
 ET.register_namespace('', 'http://www.w3.org/2000/svg')
 root = ET.fromstring(svg)
 root.set('{http://www.w3.org/XML/1998/namespace}lang', 'zh-CN')
 for node in root.iter():
  if node.tag.endswith('}desc'):
   node.text = ZH_DESC
  elif node.tag.endswith('}text') or node.tag.endswith('}title'):
   node.text = TRANSLATIONS.get(node.text, node.text)
 target = OUT / (args.basename + '.zh-CN.svg')
 emit(target, ET.tostring(root, encoding='unicode') + '\n')

if stale:
 for target in stale:
  print(f'Stale or missing: {target}', file=sys.stderr)
 sys.exit(1)
