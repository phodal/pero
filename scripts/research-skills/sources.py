REPOSITORIES = [
    "Yuan1z0825/nature-skills",
    "K-Dense-AI/scientific-agent-skills",
    "Orchestra-Research/AI-Research-SKILLs",
    "pengjunchi0/codex-visio-paper-figure-skill",
    "Leey21/awesome-ai-research-writing",
    "LigphiDonk/academic-figure-generator",
    "zLanqing/codex-claude-academic-skills",
    "LeonChaoX/qinyan-academic-skills",
    "Trae1ounG/paper-plot-skills",
    "From-zero-tohero/ML-SHAP-Skill",
    "stephenlzc/AI-Powered-Literature-Review-Skills",
    "meleantonio/awesome-econ-ai-stuff",
    "Imbad0202/academic-research-skills",
    "Galaxy-Dawn/claude-scholar",
    "brycewang-stanford/Auto-Empirical-Research-Skills",
    "7toCR/paper2patent",
    "HKUSTDial/Supervisor-Skills",
    "l2461090/nature-figure-editable",
    "blader/humanizer",
    "ganzhi-black/humanities-thesis-skill",
    "WUBING2023/PaperSpine",
    "Master-cai/Research-Paper-Writing-Skills",
    "c-narcissus/paper-framework-figure-studio-pro",
    "Rss3208/Visiomaster",
    "Imbad0202/academic-research-skills-codex",
    "Gabberflast/academic-pptx-skill",
    "natolambert/colloquium",
]

SOURCE_DOCUMENT = "https://xcn0rimv5oar.feishu.cn/wiki/WjHUw00y0iCusvkVYyRcSaOknZc"
ISSUE_URL = "https://github.com/phodal/pero/issues/156"

RESOURCES = [
    {"name": "科研 skills 原始合集", "kind": "source_document", "url": SOURCE_DOCUMENT, "notes": "候选来源索引；标题中的数量不是独立 skill 数量"},
    {"name": "ai-paper-reader", "kind": "skill_listing", "url": "https://smithery.ai/skills/neversight/ai-paper-reader", "notes": "已读到论文阅读笔记、公式讲解和图表提取指引；未解析到固定源码与许可证，直接页面请求返回 404，暂不可核实安装版本"},
    {"name": "26 个 PPT skills 评测", "kind": "article", "url": "https://jermine.vdo.pub/tools/26-ppt-skills-review/", "notes": "二级推荐文章，不按文章宣传数量计为实际 skill"},
    {"name": "BioGDP", "kind": "external_service", "url": "https://biogdp.com/zh", "notes": "外部服务，不是已核实的独立 SKILL.md"},
    {"name": "awesome-public-datasets", "kind": "dataset_directory", "url": "https://github.com/awesomedata/awesome-public-datasets", "notes": "公开数据集索引，不是 skill"},
    {"name": "74 个科研 skills 网盘包", "kind": "unverified_archive", "url": "https://pan.baidu.com/s/1tGC-cuzDI7ZqC_qcUhA7Hg", "notes": "提取码 9ndy；缺少固定版本与可公开读取的逐项清单，不虚构包内条目"},
    {"name": "Humanizer 网盘副本", "kind": "archive_mirror", "url": "https://pan.baidu.com/s/1bmFrf7MNNV0kGmtV5wYOgQ?pwd=yp39", "notes": "原始 GitHub 来源已收录；未将未知字节的网盘包视为同一版本"},
    {"name": "awesome-ai-research-writing 网盘副本", "kind": "archive_mirror", "url": "https://pan.baidu.com/s/1PXgYNLoYFadFYnKrZiRYTw?pwd=1s9h", "notes": "原始 GitHub 来源已收录；镜像包版本未核实"},
    {"name": "论文诊断完整指令", "kind": "prompt", "url": "https://xcn0rimv5oar.feishu.cn/wiki/YNWWwk78fiy8PLk9EDjcJr4hntg", "notes": "提示词文档，未转为独立 skill"},
    {"name": "10 组 AI 提示词与组会 PPT 提示词", "kind": "prompt", "url": SOURCE_DOCUMENT, "notes": "原文内提示词/图片，不是已提供 SKILL.md 的安装包"},
    {"name": "Codex 运行案例与安装教程", "kind": "tutorial_archive", "url": "https://pan.baidu.com/s/1mN7nEZELRDzZBD3OzS0-OA", "notes": "提取码 haw3；教程不是科研 skill"},
    {"name": "Ponytail", "kind": "nonresearch_skill", "url": "https://github.com/DietrichGebert/ponytail", "notes": "通用开发工作方式，原文出现但不作为科研条目收录"},
]

PPT_REPOSITORIES = [
    "zarazhangrui/frontend-slides", "op7418/guizang-ppt-skill", "lewislulu/html-ppt-skill",
    "hubeiqiao/apple-bento-grid", "alchaincyf/deepseek-v4-deep-dive", "seulee26/mckinsey-pptx",
    "likaku/Mck-ppt-design-skill", "sunbigfly/ppt-agent-skills", "tfriedel/claude-office-skills",
    "promptadvisers/claude-code-polished-documents-skills", "barun-saha/slide-deck-ai",
    "leonid20000/odin-slides", "hugohe3/ppt-master", "op7418/NanoBanana-PPT-Skills",
    "wuyoscar/gpt_image_2_skill", "JuneYaooo/gpt-image2-ppt-skills", "NyxTides/ppt-image-first",
    "GongRzhe/Office-PowerPoint-MCP-Server", "icip-cas/PPTAgent", "NeekChaw/mcp-server-okppt",
    "Gabberflast/academic-pptx-skill", "natolambert/colloquium", "minhnv0807/fullstack-mkt-skills",
    "daekeun-ml/ppt-translator", "nexu-io/open-design", "docsagent/docsagent",
]
RESOURCES.extend({"name": repo.split("/")[-1], "kind": "presentation_article_reference", "url": "https://github.com/" + repo,
                  "notes": "PPT 评测文章的二级来源；学术专用来源另行展开，其他通用演示、MCP 和平台不直接计为科研 skill"} for repo in PPT_REPOSITORIES)
