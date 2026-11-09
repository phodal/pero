"""Pure catalog parsing, classification and content identity rules."""
from __future__ import annotations

import hashlib
import re
from copy import deepcopy
from dataclasses import asdict, dataclass

import yaml

CATEGORIES = {
    "research-design": "选题与研究设计",
    "literature": "文献与知识管理",
    "data": "数据获取与处理",
    "statistics": "统计与实证分析",
    "ai": "机器学习与 AI 实验",
    "scientific-computing": "专业科学计算",
    "laboratory": "实验室与科研平台",
    "visualization": "科研绘图",
    "writing": "论文写作与排版",
    "review": "审稿投稿与返修",
    "presentation": "学术汇报",
    "workflow": "科研全流程",
    "documents": "科研文档辅助",
    "development": "通用开发（排除）",
    "unclassified": "待人工判定",
}

GENERIC = {
    "agent-identifier", "architecture-design", "bug-detective", "code-review-excellence",
    "command-development", "daily-coding", "frontend-design", "git-workflow",
    "hook-development", "mcp-integration", "plugin-structure", "skill-development",
    "skill-improver", "skill-quality-reviewer", "ui-ux-pro-max", "uv-package-manager",
    "verification-loop", "web-design-reviewer", "webapp-testing", "commit-push-pr",
    "code-simplifier", "techdebt", "sdd", "agent-browser", "browser-use",
    "coding", "testing", "debugging", "tdd-workflow", "autoskill",
    "get-available-resources", "iso-13485-certification", "create-skill",
    "pi-agent", "commit", "deep-audit", "learn", "agent-authoring", "skill-authoring",
    "dont-lie", "anti-hallucination", "handoff", "meta-optimize", "do-agent", "skill-creator",
    "web-access", "strategic-management-guide",
    "brand-guidelines", "internal-comms", "slack-gif-creator", "web-artifacts-builder", "template",
    "template-skill", "algorithmic-art", "mcp-builder", "claude-md-improver", "plugin-settings",
    "claude-automation-recommender", "example-skill", "stripe-best-practices", "agent-development",
    "canvas-design", "writing-rules",
}

# These names were reviewed against the actual source descriptions, not inferred
# from the name of the enclosing collection.
REVIEWED_CLASSIFICATIONS = {
    "fictiv": ("research_support", "laboratory"),
    "nemo-evaluator": ("research_skill", "ai"), "a-evolve": ("research_skill", "ai"),
    "obsidian-kb-artifacts": ("research_support", "documents"),
    "obsidian-cli": ("research_support", "documents"),
    "obsidian-markdown": ("research_support", "documents"),
    "obsidian-project-lifecycle": ("research_support", "documents"),
    "estimate": ("research_skill", "statistics"), "replicate": ("research_skill", "workflow"),
    "review-r": ("research_support", "statistics"), "strategize": ("research_skill", "research-design"),
    "tools": ("internal_dependency", "workflow"), "help": ("internal_dependency", "workflow"),
    "daaf-orchestrator": ("internal_dependency", "workflow"),
    "education-data-explorer": ("research_skill", "data"),
    "markdown-unwrap": ("research_support", "documents"),
    "simulation-architect": ("research_skill", "statistics"),
    "sensitivity-analyst": ("research_skill", "statistics"),
    "mediation-meta-analyst": ("research_skill", "statistics"),
    "env-snapshot": ("research_support", "workflow"), "execute": ("research_support", "workflow"),
    "freeze-check": ("research_support", "workflow"), "new-notebook": ("research_support", "documents"),
    "robustness-table": ("research_skill", "statistics"), "json-canvas": ("research_support", "documents"),
    "feishu-notify": ("internal_dependency", "workflow"), "dse-loop": ("research_skill", "scientific-computing"),
    "monitor-experiment": ("research_skill", "workflow"), "system-profile": ("research_support", "scientific-computing"),
    "training-check": ("research_skill", "ai"), "vast-gpu": ("research_support", "laboratory"),
    "data-cog-guide": ("research_skill", "data"), "missing-data-handling": ("research_skill", "statistics"),
    "streamline-analyst-guide": ("research_skill", "data"), "generative-ai-guide": ("research_skill", "ai"),
    "nlp-toolkit-guide": ("research_skill", "ai"), "dblp-api": ("research_skill", "literature"),
    "software-heritage-api": ("research_support", "workflow"), "species-distribution-guide": ("research_skill", "scientific-computing"),
    "mooc-analytics-guide": ("research_skill", "statistics"), "open-syllabus-api": ("research_skill", "data"),
    "akshare-finance-data": ("research_skill", "data"), "risk-modeling-guide": ("research_skill", "statistics"),
    "options-analytics-agent-guide": ("research_skill", "statistics"), "portfolio-optimization-guide": ("research_skill", "statistics"),
    "quantitative-finance-guide": ("research_skill", "statistics"), "climate-modeling-guide": ("research_skill", "scientific-computing"),
    "opencontracts-guide": ("research_support", "documents"), "legal-nlp-guide": ("research_skill", "ai"),
    "political-history-guide": ("research_skill", "literature"), "caselaw-access-api": ("research_skill", "data"),
    "uk-legislation-api": ("research_skill", "data"), "lean-theorem-proving-guide": ("research_skill", "scientific-computing"),
    "oeis-api": ("research_skill", "scientific-computing"), "topology-data-analysis": ("research_skill", "statistics"),
    "drug-development-guide": ("research_skill", "scientific-computing"), "madd-drug-discovery-guide": ("research_skill", "scientific-computing"),
    "pharmacovigilance-guide": ("research_skill", "scientific-computing"), "drug-target-interaction": ("research_skill", "scientific-computing"),
    "rd-agent-guide": ("research_skill", "workflow"), "scoping-review-guide": ("research_skill", "literature"),
    "kosmos-scientist-guide": ("research_skill", "workflow"), "nsf-award-api-guide": ("research_skill", "research-design"),
    "nsf-grant-guide": ("research_skill", "research-design"), "experimental-design-guide": ("research_skill", "research-design"),
    "grounded-theory-guide": ("research_skill", "statistics"), "code-exec": ("research_support", "documents"),
    "python-reproducibility-guide": ("research_support", "workflow"), "document": ("research_support", "documents"),
    "large-document-reader": ("research_support", "documents"), "pdf-extraction-guide": ("research_support", "documents"),
    "graphiti-guide": ("research_support", "literature"), "openspg-guide": ("research_support", "literature"),
    "repository-harvesting-guide": ("research_skill", "data"), "conjoint-diagnostics": ("research_skill", "statistics"),
    "conjoint-design": ("research_skill", "research-design"), "methods-reporting": ("research_skill", "review"),
    "post-ocr-cleanup": ("research_support", "documents"), "list-experiment": ("research_skill", "research-design"),
    "topic-modeling": ("research_skill", "ai"), "vlm-ocr-pipeline": ("research_support", "documents"),
    "tables": ("research_support", "visualization"), "briefing-note": ("research_skill", "writing"),
    "fiscal-briefing": ("research_skill", "statistics"), "chinese-quote-converter": ("research_support", "documents"),
    "01-phack-taxonomy": ("research_skill", "statistics"), "search-procedures": ("research_skill", "statistics"),
    "09-search-procedures": ("research_skill", "statistics"),
    "market-analysis-guide": ("research_skill", "statistics"),
    "architecture-design-guide": ("research_skill", "scientific-computing"),
    "theme-factory": ("research_support", "presentation"),
    "liteparse": ("research_support", "documents"),
    "13c-metabolic-flux": ("research_skill", "scientific-computing"),
    "ncats-arax": ("research_skill", "data"), "nwb-conversion": ("research_skill", "data"),
    "optimize-for-gpu": ("research_support", "scientific-computing"),
    "pymoo": ("research_skill", "scientific-computing"),
    "scikit-survival": ("research_skill", "statistics"),
    "timesfm-forecasting": ("research_skill", "statistics"),
    "hypogenic": ("research_skill", "research-design"),
    "ray-data": ("research_skill", "data"), "wrangling-skills": ("research_skill", "data"),
    "wrangling": ("research_skill", "data"), "conjoint-cleaning": ("research_skill", "data"),
    "e3": ("research_skill", "statistics"), "computational-inference": ("research_skill", "statistics"),
    "specification-search": ("research_skill", "statistics"), "03-specification-search": ("research_skill", "statistics"),
    "curriculum-design-guide": ("research_skill", "research-design"),
    "modal": ("research_support", "laboratory"), "serverless-modal": ("research_support", "laboratory"),
    "lambda-labs": ("research_support", "laboratory"), "skypilot": ("research_support", "laboratory"),
    "qzcli": ("research_support", "laboratory"), "run-experiment": ("research_support", "laboratory"),
    "deep-learning-papers-guide": ("research_skill", "literature"),
    "graph-learning-papers-guide": ("research_skill", "literature"),
    "huggingface-api": ("research_skill", "data"),
    "academic-paper": ("research_skill", "writing"), "composer": ("research_skill", "writing"),
    "academic-paper-composer": ("research_skill", "writing"),
    "strategist": ("research_skill", "research-design"), "academic-paper-strategist": ("research_skill", "research-design"),
    "academic-research-suite": ("research_skill", "workflow"), "paper-spine": ("research_skill", "writing"),
    "academic-paper-verify": ("research_skill", "review"), "paper_verification": ("research_skill", "review"),
    "publication-strategist": ("research_skill", "review"),
    "openrlhf-training": ("research_skill", "ai"), "nemo-guardrails": ("research_skill", "ai"),
    "gguf-quantization": ("research_skill", "ai"), "sglang": ("research_skill", "ai"),
    "serving-llms-vllm": ("research_skill", "ai"), "experiment-tracking-swanlab": ("research_skill", "ai"),
    "evaluating-cosmos-policy": ("research_skill", "ai"), "llava": ("research_skill", "ai"),
    "segment-anything-model": ("research_skill", "ai"), "whisper": ("research_skill", "ai"),
    "doaj-api": ("research_skill", "literature"), "open-access-guide": ("research_skill", "literature"),
    "osf-api": ("research_skill", "literature"), "pmc-ftp-bulk-download": ("research_skill", "literature"),
    "bibliometrix-guide": ("research_skill", "literature"), "crossref-api": ("research_skill", "literature"),
    "doi-content-negotiation": ("research_skill", "literature"), "doi-resolution-guide": ("research_skill", "literature"),
    "journal-metrics-guide": ("research_skill", "literature"), "viaf-authority-api": ("research_skill", "literature"),
    "ieee-xplore-api": ("research_skill", "literature"), "open-library-api": ("research_skill", "literature"),
    "open-semantic-search-guide": ("research_skill", "literature"), "plos-open-access-api": ("research_skill", "literature"),
    "worldcat-search-api": ("research_skill", "literature"), "mendeley-api": ("research_skill", "literature"),
    "depmap": ("research_skill", "data"), "ena-sequence-api": ("research_skill", "data"),
    "enrichr-api": ("research_skill", "scientific-computing"), "ensembl-rest-api": ("research_skill", "data"),
    "genotex-benchmark-guide": ("research_skill", "scientific-computing"), "ncbi-blast-api": ("research_skill", "scientific-computing"),
    "quickgo-api": ("research_skill", "data"), "catalysis-hub-api": ("research_skill", "data"),
    "spectroscopy-analysis-guide": ("research_skill", "scientific-computing"),
    "meta-analysis-guide": ("research_skill", "statistics"), "ml-experiment-tracker": ("research_skill", "ai"),
    "nonparametric-tests-guide": ("research_skill", "statistics"), "sem-guide": ("research_skill", "statistics"),
    "meta-apply": ("internal_dependency", "workflow"),
    "nature-data": ("research_skill", "data"), "datacommons-client": ("research_skill", "data"),
    "i1": ("research_skill", "literature"), "i3": ("research_skill", "ai"),
    "five-questions": ("research_skill", "literature"), "paper-reading-assistant": ("research_skill", "literature"),
    "ontology-term-resolution": ("research_skill", "data"), "imaging-data-commons": ("research_skill", "data"),
    "treatment-plans": ("research_support", "documents"),
    "context-status": ("internal_dependency", "workflow"), "data-analysis": ("research_skill", "statistics"),
    "audit-replication": ("research_skill", "review"), "data-deposit": ("research_skill", "data"),
    "identify": ("research_skill", "research-design"), "integrity-forensics": ("research_skill", "review"),
    "paper-compile": ("research_support", "writing"), "scholar-evaluation": ("research_skill", "review"),
    "extract-tikz": ("research_support", "visualization"), "marp-export": ("research_support", "presentation"),
    "visiomaster": ("research_skill", "visualization"), "experiment-audit": ("research_skill", "review"),
    "research-implement-feature": ("research_support", "workflow"), "computer-vision-guide": ("research_skill", "ai"),
    "proof-checker": ("research_skill", "scientific-computing"),
    "methods-communicator": ("research_skill", "writing"), "typst-paper": ("research_skill", "writing"),
    "academic-translation-guide": ("research_skill", "writing"), "conciseness-editing-guide": ("research_skill", "writing"),
    "templates-skills": ("research_support", "writing"), "conference-paper-template": ("research_support", "writing"),
    "graphical-abstract-guide": ("research_skill", "visualization"), "scientific-article-pdf": ("research_support", "writing"),
    "econ-write": ("research_skill", "writing"), "guidance": ("research_skill", "ai"),
}

NATURE_SUMMARIES = {
    "nature-academic-search": ("文献检索与引文核对", "跨来源检索文献、管理和核对引用，构建 MeSH 检索策略及引用影响审计。"),
    "nature-citation": ("论文主张与支持文献", "为 Nature/CNS 范围的论文主张查找和核对支持文献，建立主张到来源的映射并导出引用。"),
    "nature-data": ("数据与代码可用性声明", "起草或检查数据与代码可用性声明、访问途径、仓储计划和 FAIR 元数据。"),
    "nature-downloader": ("学术全文获取", "通过合法的开放获取、机构访问或出版商 API 获取学术全文及补充材料。"),
    "nature-figure": ("科研结果图绘制", "使用 Python/R 创建、修改、检查并导出论文图；可按明确请求制作图形摘要和机制示意图。"),
    "nature-image2ppt": ("图片重建为可编辑 PPT", "将幻灯片图片、截图、扫描 PDF 或纯图片 PPTX 重建为对象级可编辑 PowerPoint。"),
    "nature-literature-pipeline": ("文献发现与精读流程", "组合多源检索、六维评分、精读、格式化交付和归档，包含可配置的定时应用层。"),
    "nature-paper-card": ("论文精读卡", "为单篇科学论文整理方法、实验到主张的证据、局限与研究想法，生成结构化精读卡。"),
    "nature-paper-to-patent": ("论文转专利初稿", "以论文或发明人材料为依据，起草中文发明专利与技术交底文件并整理 DOCX 交付。"),
    "nature-paper-xray": ("单篇论文深度拆解", "重建作者的问题起点与设计选择，用具体例子讲解关键公式，并核查证据所能支持的范围。"),
    "nature-paper2ppt": ("论文转学术汇报", "以论文或精读笔记生成或改进中文学术 PPTX，保留来源图与演讲备注。"),
    "nature-polishing": ("学术语言润色", "润色、翻译或精简已有学术文本，保留事实、术语与证据边界；支持 LaTeX 版式修正。"),
    "researchwrite": ("研究计划与开题报告", "以支持证据撰写、修订和检查科研项目申请、开题报告及研究计划。"),
    "nature-reader": ("中英对照论文阅读", "生成带来源对应的中英论文阅读材料，对齐文本、图、表与公式，也可只处理指定片段或问题。"),
    "nature-response": ("审稿意见回复", "起草、审查或修改逐点审稿回复、返修信和带修改标记的稿件包。"),
    "nature-reviewer": ("模拟同行评审", "依据稿件或片段提供有证据的模拟同行评审，检查意义、有效性和主要及次要问题。"),
    "nature-shared": ("Nature 内部共享依赖", "为其他 Nature skills 提供共享参考文件；不作为独立用户工作流调用。"),
    "nature-statistics": ("统计报告审查", "审查实验单位、重复、误差、不确定性、统计检验与图注统计；仅在提供数据并请求时开展新分析。"),
    "nature-writing": ("科学论文写作", "基于作者提供的证据起草或重组论文论证、章节和首次投稿材料。"),
}

def parse_skill(content: str, fallback: str) -> dict:
    metadata, notes, frontmatter, body = {}, [], "", content
    if content.lstrip("\ufeff").startswith("---\n") or content.startswith("---\r\n"):
        parts = re.split(r"(?m)^---\s*$", content.lstrip("\ufeff"), maxsplit=2)
        if len(parts) == 3:
            frontmatter = parts[1].strip("\r\n")
            body = parts[2]
            try:
                value = yaml.safe_load(parts[1])
                if isinstance(value, dict):
                    metadata = value
                else:
                    notes.append("frontmatter 不是对象")
            except yaml.YAMLError as error:
                notes.append("frontmatter 无法解析：" + str(error).splitlines()[0])
                # A malformed unrelated field must not hide a literal source
                # description. Retain only an unindented, single-line string;
                # the original YAML error still prevents claiming valid metadata.
                declared = re.search(r"(?m)^description:[ \t]+([^\r\n]+)$", frontmatter)
                if declared:
                    literal = declared.group(1).strip()
                    if literal and literal[0] not in "[{'\"!|>" and not re.fullmatch(r"true|false|yes|no|null|~|[-+]?\d+(?:\.\d+)?", literal, re.I):
                        metadata["description"] = literal
                        notes.append("description 按原始未缩进单行字段保留；frontmatter 整体仍未通过 YAML 解析")
        else:
            notes.append("frontmatter 缺少结束分隔符")
    else:
        notes.append("未发现 YAML frontmatter，名称来自目录")
    name = metadata.get("name")
    description = metadata.get("description")
    license_id = metadata.get("license")
    dependencies = metadata.get("dependencies")
    return {
        "name": name if isinstance(name, str) and name.strip() else fallback,
        "description": description.strip() if isinstance(description, str) else "",
        "license": license_id if isinstance(license_id, str) else None,
        "compatibility": metadata.get("compatibility") if isinstance(metadata.get("compatibility"), str) else None,
        "metadata": metadata,
        "notes": notes,
        "frontmatter_yaml": frontmatter,
        "body": body,
        "dependencies_yaml": dependencies if isinstance(dependencies, str) else yaml.safe_dump(dependencies, allow_unicode=True, sort_keys=False).strip() if dependencies is not None else None,
    }


@dataclass(frozen=True)
class SkillSection:
    heading: str
    text: str


@dataclass(frozen=True)
class SkillSections:
    dependencies: tuple[SkillSection, ...] = ()
    inputs: tuple[SkillSection, ...] = ()
    outputs: tuple[SkillSection, ...] = ()
    examples: tuple[SkillSection, ...] = ()


def extract_sections(body: str) -> SkillSections:
    """Retain explicit Markdown sections verbatim, excluding code-block headings."""
    lines, headings, fence = body.splitlines(), [], None
    patterns = {
        "dependencies": r"\b(?:Requirements|Prerequisites|Dependencies|Installation)\b|依赖|前置|环境要求",
        "inputs": r"\bInputs?\b|输入材料|所需材料|输入",
        "outputs": r"\bOutputs?\b|\bDeliverables?\b|输出|交付",
        "examples": r"\bExamples?\b|\bUsage\b|\bQuick\s*Start\b|示例|样例|使用方式|用法",
    }
    for index, line in enumerate(lines):
        marker = re.match(r"^\s{0,3}(`{3,}|~{3,})", line)
        if marker:
            run = marker.group(1)
            if fence is None:
                fence = run
            elif run[0] == fence[0] and len(run) >= len(fence):
                fence = None
            continue
        if fence is not None:
            continue
        heading = re.match(r"^(#{1,6})\s+(.+?)\s*#*\s*$", line)
        if heading:
            headings.append((index, len(heading.group(1)), heading.group(2)))
    sections = {name: [] for name in patterns}
    for position, (index, level, heading) in enumerate(headings):
        end = next((row for row, depth, _ in headings[position + 1:] if depth <= level), len(lines))
        section = SkillSection(heading, "\n".join(lines[index + 1:end]).strip())
        for name, pattern in patterns.items():
            if re.search(pattern, heading, re.I):
                sections[name].append(section)
    return SkillSections(**{name: tuple(values) for name, values in sections.items()})

def classify(path: str, description: str, skill_name: str | None = None) -> tuple[str, str]:
    name = path.replace("\\", "/").split("/")[-2] if "/" in path else ""
    names = [re.sub(r"\s+", "-", value.lower()) for value in [skill_name, name] if value]
    if any(value in GENERIC for value in names):
        return "excluded", "development"
    for value in names:
        if value in REVIEWED_CLASSIFICATIONS:
            return REVIEWED_CLASSIFICATIONS[value]
    if name == "nature-shared" or re.search(r"internal shared.reference|not.*standalone.*workflow|dependency of another installed", description, re.I):
        return "internal_dependency", "workflow"
    if name.lower() in {"pdf", "pptx", "docx", "xlsx", "markitdown", "defuddle", "doc-coauthoring", "markdown-mermaid-writing", "open-notebook", "r-package-development", "r-oop", "r-performance", "r-style-guide", "rlang-patterns", "tidyverse-patterns"}:
        return "research_support", "documents"
    libraries = {
        "scientific-computing": "astropy anndata arboreto biopython bioservices cellxgene-census deeptools etetoolkit flowio geniml gget gtars lamindb phylogenetics pydeseq2 pysam scanpy scikit-bio scvelo scvi-tools tiledbvcf zarr-python datamol deepchem diffdock matchms medchem molecular-dynamics molfeat pyopenms pytdc rdkit rowan torchdrug histolab neurokit2 neuropixels-analysis pathml pydicom pyhealth adaptyv esm glycoengineering cirq cobrapy fluidsim matlab pennylane pymatgen qiskit qutip simpy sympy cantera cellprofiler flowkit mageck nmrglue primer-design qiime2-amplicon relion geopandas geomaster arbor",
        "ai": "aeon hypogenic pufferlib pymoo pytorch-lightning scikit-learn scikit-survival shap stable-baselines3 timesfm-forecasting torch-geometric transformers umap-learn nemo-evaluator-sdk evolving-ai-agents nnsight pyvene saelens accelerate deepspeed megatron-core pytorch-fsdp2 ray-train axolotl llama-factory peft unsloth litgpt mamba nanogpt rwkv torchtitan",
        "statistics": "pymc statsmodels statistical-analysis general-equilibrium-model-builder",
        "data": "dask polars vaex nextflow",
        "visualization": "matplotlib seaborn plotly networkx",
        "literature": "exa-search parallel-web paperzilla nature-downloader qinyan-paper-analysis",
        "research-design": "consciousness-council dhdna-profiler what-if-oracle",
    }
    for category, library_names in libraries.items():
        if any(value in library_names.split() for value in names):
            return "research_skill", category
    rules = [
        ("review", r"rebuttal|referee|peer.review|pre.submission|submission|审稿|返修|journal.review|paper.review|review.response|nature.response|post.acceptance"),
        ("presentation", r"paper2ppt|image2ppt|slide|beamer|poster|presentation|conference.talk|汇报|演示|ppt"),
        ("visualization", r"figure|plot|visualiz|drawio|\bvisio\b|schematic|infographic|绘图|配图|diagram"),
        ("literature", r"citation|literature|bibliograph|bibliometr|paper.search|paper.reader|paper.reading|paper.summar|paper.summary|paper.recommend|papers.we.love|paper.feeds|academic.search|paper.lookup|openalex|pubmed|biorxiv|arxiv|zotero|reference.guide|paper.card|paper.xray|paper.trans|paper.downloader|full.?text|preprint|crossref|orcid|orkg|ror.organization|scholarly.metadata|scholarly.and.patent|conference.proceedings|research.impact.metrics|wikidata|openaire|scielo|share.research|institutional.repository|interlibrary.loan|core.api|hal.archive|boolean.search|findpapers|eric.education|academic.databases|文献|论文检索|论文阅读"),
        ("research-design", r"hypothes|ideation|brainstorm|research.idea|topic.selection|proposal|preregistr|pre.registration|research.grant|nsfc|nssfc|research.question|scientific.critical|research.design|idea.evaluat|选题|研究设计|基金"),
        ("laboratory", r"benchling|labarchive|labrobot|opentrons|cloud.lab|protocolsio|omero|dnanexus|latchbio|experiment.log|laboratory|实验室|实验记录"),
        ("statistics", r"econom|causal|stata|regression|statistic|bayes|pymc|causalpy|panel.data|difference.in.differences|\bdid\b|\brdd\b|synthetic.control|instrumental.variable|spss|amos|survey|qualitative|thematic|sem/|计量|实证|统计|定性"),
        ("writing", r"paper.writ|scientific.writ|academic.writ|paper.polish|nature.polish|manuscript|thesis|latex|paper.spine|paper2word|humaniz|proofread|de.aigc|avoid.ai.writ|stop.slop|citation.fidelity|writing|论文写作|润色|学位论文|专利|patent"),
        ("ai", r"model.architecture|tokenization|fine.tun|post.training|(?:model|safety|llm).alignment|distributed.training|(?:model|llm).inference|mlops|prompt.engineer|mechanistic|multimodal|model.prun|model.merg|distillation|long.context|speculative|rag/|observability|huggingface|transformer|pytorch|tensorflow|scikit.learn|\bshap\b|machine.learning|deep.learning|neural|reinforcement|ml.training|mlflow|tensorboard|weights.and.biases|langchain|llamaindex|chroma|faiss|pinecone|qdrant|dspy|instructor|outlines|autogpt|crewai|\bmodal\b|lambda.labs|skypilot|ray.train|生成式|机器学习|人工智能"),
        ("data", r"database|data.clean|data.fetch|data.collect|data.acquis|data.process|data.profile|data.valid|data.provenance|data.audit|data.access|data.source|data.extract|data.avail|data.management|dataset|fred.economic|edgartools|kaggle|exploratory|open.data|api.data|数据获取|数据处理|科学数据库"),
        ("scientific-computing", r"astro|bio|genom|protein|chem|molecul|phylo|quantum|qiskit|qutip|cirq|pennylane|pymatgen|matlab|sympy|simpy|fluidsim|cantera|rdkit|scanpy|anndata|pysam|medic|clinical|neuro|health|geopandas|geomaster|geospatial|shapely|networkx|materials|physics|物理|化学|生物|医学|材料|地理"),
    ]
    purpose = re.split(r"(?<=[.!?])\s+(?:Use\b|Not\b|Applies\b|For\b)", description.splitlines()[0] if description else "", maxsplit=1)[0]
    primary_purposes = [
        ("research-design", r"research question refiner|theoretical framework architect|(?:quantitative|qualitative|mixed methods) design consultant|measurement instrument developer"),
        ("statistics", r"meta.analysis master|mixed methods integration specialist|quantitative analysis guide|qualitative coding specialist"),
        ("literature", r"paper retrieval agent|screening assistant.*prisma"),
        ("writing", r"humanization quality verifier|academic style auditor"),
        ("review", r"evidence quality appraiser|research guardian.*ethics"),
    ]
    for category, pattern in primary_purposes:
        if re.search(pattern, purpose, re.I):
            return "research_skill", category
    if re.search(r"\b(?:document|pdf|office).*\b(?:pars\w*|extract\w*|conver\w*|ocr)\b|\b(?:pars\w*|extract\w*|ocr)\b.*\b(?:pdf|document|scan\w*)\b|文档解析|文字识别|扫描.*识别", purpose, re.I):
        return "research_support", "documents"
    # A collection's directory names describe its publisher's organisation, not
    # this skill's task. Only the skill identity and its own purpose participate.
    for candidate in [*names, purpose, description]:
        for category, pattern in rules:
            if re.search(pattern, candidate, re.I):
                return "research_skill", category
    if re.search(r"research|scientific|academic|scholar|paper|thesis|实验|科学|科研|论文|研究|文献", name + " " + description, re.I):
        return "research_skill", "workflow"
    return "needs_review", "unclassified"

def consolidate(items: list[dict]) -> tuple[list[dict], list[dict]]:
    """Instruction bytes and complete package resources must both match."""
    groups = {}
    for item in items:
        source = item["source"]
        package = source.get("resource_fingerprint")
        groups.setdefault((source["sha256"], package or item["id"]), []).append(item)
    unique, aliases = [], []
    for group in groups.values():
        group.sort(key=lambda x: (x["source"]["path"].count("/"), len(x["source"]["path"]), x["id"]))
        canonical = deepcopy(group[0])
        canonical["sources"] = [item["source"] for item in group]
        unique.append(canonical)
        for item in group[1:]:
            aliases.append({"id": item["id"], "canonical_id": canonical["id"], "reason": "SKILL.md 内容与完整包目录资源指纹均相同", "source": item["source"]})
    instructions = {}
    for item in unique:
        instructions.setdefault(item["source"]["sha256"], []).append(item["id"])
    for item in unique:
        item["related_instruction_ids"] = [identity for identity in instructions[item["source"]["sha256"]] if identity != item["id"]]
    return sorted(unique, key=lambda x: (x.get("category", ""), x["id"])), aliases

def resource_fingerprint(entries: list[dict], skill_path: str) -> str | None:
    parent = skill_path.rsplit("/", 1)[0] + "/" if "/" in skill_path else ""
    files = [entry for entry in entries if entry["path"].startswith(parent) and entry["type"] != "tree"]
    if any(entry["mode"] == "160000" for entry in files):
        return None
    manifest = "\n".join(sorted(entry["path"][len(parent):] + "\0" + entry["sha"] + "\0" + entry["mode"] for entry in files))
    return hashlib.sha256(manifest.encode("utf-8")).hexdigest()

def spdx_from_text(text: str) -> str | None:
    normalized = text.lower()
    for name, pattern in [
        ("Apache-2.0", "apache license"), ("MIT", "mit license"),
        ("CC-BY-SA-4.0", "attribution-sharealike 4.0"), ("CC-BY-4.0", "attribution 4.0"),
        ("BSD-3-Clause", "neither the name"), ("BSD-2-Clause", "redistributions in binary form"),
    ]:
        if pattern in normalized:
            return name
    if "gnu general public license" in normalized:
        if re.search(r"version\s+3\b", normalized):
            return "GPL-3.0-only"
        if re.search(r"version\s+2\b", normalized):
            return "GPL-2.0-only"
    return None

def canonical_spdx(value: str | None) -> str | None:
    if not value:
        return None
    identifiers = ["Apache-2.0", "MIT", "CC-BY-SA-4.0", "CC-BY-4.0", "BSD-3-Clause", "BSD-2-Clause", "GPL-3.0", "GPL-3.0-only", "GPL-3.0-or-later", "GPL-2.0-only", "GPL-2.0-or-later", "AGPL-3.0", "CC0-1.0", "Unlicense"]
    normalized = re.sub(r"\s+license$", "", value.strip(), flags=re.I)
    for identifier in identifiers:
        if identifier.lower() == normalized.lower():
            return identifier
    if re.search(r"\b(?:AND|OR|WITH)\b", value):
        tokens = re.findall(r"[A-Za-z0-9.-]+", value)
        if tokens and all(token in identifiers or token in {"AND", "OR", "WITH"} for token in tokens):
            return value.strip()
    return None

def _opening(body: str) -> str:
    text = body.lstrip(" ")
    while text.startswith(">"):
        text = text[1:].lstrip(" ")
    return text


def _strip_fences(text: str) -> str:
    lines, kept, fence = text.splitlines(keepends=True), [], None
    for line in lines:
        marker = re.match(r"(`{3,}|~{3,})", _opening(line.rstrip("\r\n")))
        if marker:
            run = marker.group(1)
            if fence is None:
                fence = run
                continue
            if run[0] == fence[0] and len(run) >= len(fence):
                fence = None
                continue
        if fence is None:
            kept.append(line)
    return "".join(kept)


def _redact_secrets(text: str) -> str:
    return re.sub(
        r"(?i)(?<![A-Za-z0-9_])(api[-_]?key|apikey|authorization|password|secret|token)(?![A-Za-z0-9_])\s*[:=]\s*[^\s\",]+",
        lambda match: match.group(1) + "=<redacted>",
        text,
    )


def _clean_text(text: str, cap: bool) -> str:
    cleaned = _redact_secrets(_strip_fences(text))
    if cap and len(cleaned) > 4000:
        return cleaned[:4000].rstrip() + "…"
    return cleaned


def _runtime_source(source: dict) -> dict:
    kept = {key: source.get(key) for key in ("repository", "commit", "path", "url", "sha256") if key in source}
    if source.get("archive"):
        kept["archive"] = source["archive"]
    return kept


def runtime_catalog(document: dict) -> dict:
    """Marketplace projection: no raw frontmatter, fenced extraction, or credential-shaped text."""
    skills = []
    for item in document.get("skills", []):
        skill = {
            "id": item["id"],
            "name": item.get("name", ""),
            "title_zh": item.get("title_zh", ""),
            "description": _clean_text(item.get("description") or "", False),
            "description_zh": _clean_text(item.get("description_zh") or "", False),
            "category": item.get("category", ""),
            "category_zh": item.get("category_zh", ""),
            "kind": item.get("kind", ""),
            "source": _runtime_source(item.get("source") or {}),
            "sources": [_runtime_source(source) for source in item.get("sources") or []],
            "license": {key: (item.get("license") or {}).get(key) for key in ("spdx", "status", "evidence_url")},
            "compatibility": item.get("compatibility") or {"declared": [], "status": "unverified"},
            "verification": {
                "content": (item.get("verification") or {}).get("content", "parsed"),
                "runtime": "not_run",
                "notes": [_clean_text(note, False) for note in (item.get("verification") or {}).get("notes") or []],
            },
        }
        for key in ("dependencies", "inputs", "outputs", "examples"):
            skill[key] = [
                {"heading": section.get("heading", ""), "text": _clean_text(section.get("text") or "", True)}
                for section in item.get(key) or []
                if _clean_text(section.get("text") or "", True)
            ]
        skills.append(skill)
    return {
        "schema_version": document.get("schema_version", 1),
        "collection_status": document.get("collection_status", "complete"),
        "generated_at": document.get("generated_at", ""),
        "issue_url": document.get("issue_url", ""),
        "source_document": document.get("source_document", ""),
        "categories": document.get("categories") or {},
        "sources": [
            {"repository": source.get("repository"), "commit": source.get("commit"), "url": source.get("url")}
            for source in document.get("sources") or []
        ],
        "skills": skills,
        "resources": [],
        "exclusions": [],
        "stats": document.get("stats") or {},
    }


def describe_zh(name: str, description: str, category: str) -> str:
    if re.search(r"[\u4e00-\u9fff]", description):
        return description
    return ""  # Original English is retained; an unreviewed translation is not evidence.

def make_entry(repo: str, commit: str, path: str, content: bytes, git_blob_sha: str | None, license_data: dict | None = None, archive: str | None = None, package_fingerprint: str | None = None) -> dict:
    text = content.decode("utf-8-sig")
    fallback = path.split("/")[-2] if "/" in path else repo.split("/")[-1]
    parsed = parse_skill(text, fallback)
    kind, category = classify(path if "/" in path else fallback + "/" + path, parsed["description"], parsed["name"])
    source = {"repository": repo, "commit": commit, "path": path,
              "url": f"https://github.com/{repo}/blob/{commit}/{archive or path}",
              "git_blob_sha": git_blob_sha, "sha256": hashlib.sha256(content).hexdigest()}
    source["resource_fingerprint"] = package_fingerprint
    if archive:
        source["archive"] = archive
    license_id = canonical_spdx(parsed["license"])
    license_data = ({"spdx": license_id, "evidence_url": source["url"], "status": "declared_in_skill", "declaration": parsed["license"]} if parsed["license"] else license_data)
    if not license_data:
        license_data = {"spdx": None, "evidence_url": None, "status": "unknown", "declaration": None}
    declared = [parsed["compatibility"]] if parsed["compatibility"] else []
    sections = extract_sections(parsed["body"])
    declared_dependencies = (SkillSection("YAML dependencies", parsed["dependencies_yaml"]),) if parsed["dependencies_yaml"] is not None else ()
    summary = NATURE_SUMMARIES.get(parsed["name"]) if repo == "Yuan1z0825/nature-skills" else None
    if repo == "blader/humanizer":
        summary = ("学术文本去模板化", "编辑或审查带有 AI 套话的文本，在保留原意的前提下调整表达和作者声音。")
    return {
        "id": repo + "/" + path,
        "name": parsed["name"], "title_zh": summary[0] if summary else parsed["name"],
        "description": parsed["description"],
        "description_zh": summary[1] if summary else describe_zh(parsed["name"], parsed["description"], category),
        "category": category, "category_zh": CATEGORIES[category], "kind": kind,
        "source": source, "sources": [source], "license": license_data,
        "compatibility": {"declared": declared, "status": "unverified"},
        "dependencies": [asdict(section) for section in (*declared_dependencies, *sections.dependencies)],
        "inputs": [asdict(section) for section in sections.inputs],
        "outputs": [asdict(section) for section in sections.outputs],
        "examples": [asdict(section) for section in sections.examples],
        "frontmatter_yaml": parsed["frontmatter_yaml"],
        "verification": {"content": "parsed", "runtime": "not_run", "notes": parsed["notes"]},
        "classification": {"method": "body_review" if fallback.lower() in {"market-analysis-guide", "architecture-design-guide"} else "description_review" if any(re.sub(r"\s+", "-", value.lower()) in REVIEWED_CLASSIFICATIONS for value in [fallback, parsed["name"]]) else "content_rules", "needs_review": kind == "needs_review", "reason": "未匹配已知科研类别或明确科研用途" if kind == "needs_review" else "按技能自身名称、明确首要用途及原始描述归类，不使用合集祖先目录；非运行或科学有效性认证"},
    }
