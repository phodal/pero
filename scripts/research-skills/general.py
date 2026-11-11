"""Reviewed general-method increment; no source code is executed during collection."""
from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
from collections import Counter
from copy import deepcopy
from pathlib import Path

from catalog import make_entry, resource_fingerprint

ROOT = Path(__file__).resolve().parents[2]
PINS = {"obra/superpowers": "22f0b463e7a5e579904dd6211a520321035526f7",
        "anthropics/skills": "2c5958ecac7cee2b583967a2c4981d0f4a75c579"}
# Each row records a content review, not a claim that a provider executed it.
REVIEWS = [
    ("obra/superpowers", "brainstorming", "planning", "任务澄清", "梳理目标、约束和备选设计，形成可讨论的说明。", "requires_adaptation", "依赖 Superpowers spec review / writing-plans；不自动启动浏览器或子 Agent。"),
    ("obra/superpowers", "writing-plans", "planning", "编写实施计划", "把已确认需求拆成文件、接口、测试和交付步骤。", "requires_adaptation", "执行交接要求 Superpowers 子技能；单技能安装不装配它们。"),
    ("obra/superpowers", "systematic-debugging", "engineering", "系统排错", "先复现和收集证据，再定位原因并验证最小修复。", "static_instructions", "文件读取、获准 shell 和项目测试工具；相关 TDD 指引可手动另选。"),
    ("obra/superpowers", "test-driven-development", "engineering", "测试驱动开发", "通过失败测试、最小实现和回归检查约束行为。", "static_instructions", "文件编辑、获准 shell 与项目测试运行器；不安装依赖。"),
    ("obra/superpowers", "verification-before-completion", "review", "完成前独立核查", "用实际命令结果检查完成声明，并明确失败和未验证范围。", "static_instructions", "获准 shell、可读取的产物和已有检查命令；指引不证明科研结论。"),
    ("obra/superpowers", "receiving-code-review", "review", "处理代码评审", "结合当前代码核查评审意见，逐项修复并记录证据。", "static_instructions", "文件读取、diff 与项目测试；GitHub 回复需要已有账号和用户授权。"),
    ("obra/superpowers", "using-git-worktrees", "environment", "隔离工作区准备", "检查 Git 工作区和基线，准备可保留的隔离 checkout。", "requires_adaptation", "引用 Superpowers 后续子技能；shell/Git、依赖安装和外部网络必须独立获准。"),
    ("obra/superpowers", "writing-skills", "skill-authoring", "技能创作与核查", "用任务场景检验技能说明，整理触发条件和资源。", "requires_adaptation", "要求子 Agent 压力测试、TDD 子技能及宿主技能目录；尚未映射 Pero。"),
    ("obra/superpowers", "finishing-a-development-branch", "collaboration", "整理开发交付", "检查测试与分支状态，准备合并或 PR 的可审查交接。", "requires_adaptation", "依赖 Superpowers 评审/工作区流程；push、PR、合并或删除必须分别授权。"),
    ("anthropics/skills", "webapp-testing", "engineering", "网页功能验证", "用 Playwright 观察页面、核对交互并保存截图和日志。", "requires_adaptation", "需要 Python Playwright、浏览器及本地服务；下载脚本不等于可执行或环境已准备。"),
    ("anthropics/skills", "skill-creator", "skill-authoring", "创建与评估技能", "整理技能指引、资源与评估样例，迭代触发说明。", "requires_adaptation", "评估脚本依赖 Claude CLI、子 Agent 和特定目录；不自动执行安装或自我修改。"),
    ("anthropics/skills", "internal-comms", "collaboration", "整理项目交接", "按受众组织状态、问题和下一步，准备交接或内部沟通草稿。", "static_instructions", "仅准备草稿；读取团队系统和对外发送继续由原连接与授权负责。"),
]
CATEGORIES = {"planning": "任务澄清与计划", "engineering": "代码与测试", "review": "验证与质量复核",
              "environment": "环境与复现准备", "skill-authoring": "技能创作与维护", "collaboration": "项目交接与协作"}
SHARED = [f"anthropics/skills/skills/{name}/SKILL.md" for name in ["doc-coauthoring", "docx", "pdf", "pptx", "xlsx"]]


def merge_catalog(research: dict, general: dict) -> dict:
    """Preserve old identities/pins; exact package duplicates become source aliases."""
    merged = deepcopy(research)
    by_id = {item["id"]: item for item in merged["skills"]}
    fingerprints = {(item["source"]["sha256"], item["source"].get("resource_fingerprint")): item
                    for item in merged["skills"] if item["source"].get("resource_fingerprint")}
    for entry in general["skills"]:
        item = deepcopy(entry)
        if item["id"] in by_id:
            raise ValueError(f"Duplicate skill identity: {item['id']}")
        key = (item["source"]["sha256"], item["source"].get("resource_fingerprint"))
        existing = fingerprints.get(key) if key[1] else None
        if existing:
            existing["sources"].extend(item["sources"])
            existing["discovery_scopes"] = ["general", "research"]
            continue
        by_id[item["id"]] = item
        merged["skills"].append(item)
        if key[1]:
            fingerprints[key] = item
    for identity in general["shared_ids"]:
        by_id[identity]["discovery_scopes"] = ["general", "research"]
    merged["categories"].update(general["categories"])
    existing_sources = {(source["repository"], source["commit"]) for source in merged["sources"]}
    merged["sources"].extend(source for source in general["sources"] if (source["repository"], source["commit"]) not in existing_sources)
    merged["stats"] = {"retained_skills": len(merged["skills"]), "by_kind": dict(Counter(item["kind"] for item in merged["skills"]))}
    return merged


def collect(checkouts: dict[str, Path]) -> dict:
    research = json.loads((ROOT / "docs/design-docs/research-skills-catalog.json").read_text())
    entries = []
    for repo, name, category, title, summary, compatibility, conditions in REVIEWS:
        directory, pin = checkouts[repo], PINS[repo]
        def git(*args: str) -> bytes:
            return subprocess.check_output(["git", "-C", str(directory), *args])
        path = f"skills/{name}/SKILL.md"
        content = git("show", f"{pin}:{path}")
        tree = []
        for row in git("ls-tree", "-r", pin).decode().splitlines():
            metadata, filename = row.split("\t", 1)
            mode, kind, sha = metadata.split()
            tree.append({"path": filename, "mode": mode, "type": kind, "sha": sha})
        license_path = "LICENSE" if repo == "obra/superpowers" else f"skills/{name}/LICENSE.txt"
        license_bytes = git("show", f"{pin}:{license_path}")
        # Reviewed exact files: MIT for Superpowers; directory Apache 2.0 for these three Anthropic skills.
        spdx = "MIT" if repo == "obra/superpowers" else "Apache-2.0"
        assert (b"MIT License" if spdx == "MIT" else b"Apache License") in license_bytes
        license = {"spdx": spdx, "status": "reviewed_repository" if repo == "obra/superpowers" else "directory_license",
                   "evidence_url": f"https://github.com/{repo}/blob/{pin}/{license_path}", "declaration": None}
        item = make_entry(repo, pin, path, content, git("rev-parse", f"{pin}:{path}").decode().strip(), license,
                          package_fingerprint=resource_fingerprint(tree, path))
        item.update(kind="general_skill", category=category, category_zh=CATEGORIES[category], title_zh=title, description_zh=summary,
                    license=license, compatibility={"declared": [conditions], "status": compatibility},
                    dependencies=[{"heading": "工具与宿主条件", "text": conditions}],
                    inputs=[{"heading": "输入", "text": "用户的任务目标、材料/工作区、约束与验收条件。"}],
                    outputs=[{"heading": "交付", "text": summary + " 保存实际文件或证据引用，并标明未完成项。"}],
                    examples=[{"heading": "示例", "text": f"请对当前研究任务使用「{title}」，先列明输入与约束，保存可审查结果并核查。"}],
                    verification={"content": "reviewed", "runtime": "not_run", "notes": [conditions, "只安装静态指引与资源，不授予工具权限。"]})
        item.pop("frontmatter_yaml", None)
        item.pop("classification", None)
        item["license_review"] = {"path": license_path, "sha256": hashlib.sha256(license_bytes).hexdigest(), "scope": "Read selected directory and repository notices at the pinned commit; no license inferred from visibility."}
        entries.append(item)
    retained_ids = {item["id"] for item in entries}
    decisions = []
    for candidate in research["exclusions"]:
        if candidate["kind"] != "nonresearch":
            continue
        identity = candidate["id"]
        if identity in retained_ids:
            outcome, reason = "reviewed", "在本增量中固定新版正文、许可与工具条件；旧排除记录保留供科研子集对账。"
        elif any(word in identity for word in ["stripe", "brand-guidelines", "slack-gif", "algorithmic-art", "canvas-design", "iso-13485"]):
            outcome, reason = "excluded", "不在本轮研究工程闭环范围。"
        else:
            outcome, reason = "needs_review", "仅有旧非科研分类证据；未逐条建立当前许可/工具兼容依据，不开放安装。"
        decisions.append({"id": identity, "disposition": outcome, "reason": reason, "source_commit": candidate["source"]["commit"]})
    return {"schema_version": 1, "issue_url": "https://github.com/phodal/pero/issues/200", "categories": CATEGORIES,
            "sources": [{"repository": repo, "commit": pin, "url": f"https://github.com/{repo}/tree/{pin}"} for repo, pin in PINS.items()],
            "skills": entries, "shared_ids": SHARED, "reviews": decisions,
            "notes": ["五个已有文档/表格条目跨范围发现，原 ID、类型、固定提交、正文摘要和许可保持不变；旧专有许可和未知许可仍阻止安装。", "非科研排除项未被批量准入；同正文且同资源指纹才可作为别名合并。"]}


def write_index(document: dict, path: Path) -> None:
    lines = ["# 通用 Skills 复审索引", "", document["issue_url"], "", *document["notes"], "",
             "12 个新通用条目，5 个已有文档类跨范围引用；覆盖计划、工程、验证、环境、创作、协作与文档。", "",
             "| 技能 | 用途 | 兼容状态 | 固定来源与许可 |", "| --- | --- | --- | --- |"]
    for item in document["skills"]:
        lines.append(f"| {item['title_zh']} | {item['description_zh']} | {item['compatibility']['status']} | [{item['id']}]({item['source']['url']}) · [{item['license']['spdx']}]({item['license']['evidence_url']}) |")
    lines += ["", "## 旧排除项复审去向", "", f"共 {len(document['reviews'])} 个候选路径。needs_review 不等于可安装，也不表示已核对新版正文。", ""]
    lines += [f"- `{item['id']}` — {item['disposition']}：{item['reason']}" for item in document["reviews"]]
    path.write_text("\n".join(lines) + "\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--superpowers", type=Path, required=True)
    parser.add_argument("--anthropics", type=Path, required=True)
    args = parser.parse_args()
    document = collect({"obra/superpowers": args.superpowers, "anthropics/skills": args.anthropics})
    target = ROOT / "docs/design-docs/general-skills-catalog.json"
    # One reviewed record per line keeps the generated delta small and diffable.
    sections = []
    for key, value in document.items():
        if key in {"skills", "reviews"}:
            encoded = "[\n" + ",\n".join("    " + json.dumps(item, ensure_ascii=False) for item in value) + "\n  ]"
        else:
            encoded = json.dumps(value, ensure_ascii=False)
        sections.append("  " + json.dumps(key) + ": " + encoded)
    target.write_text("{\n" + ",\n".join(sections) + "\n}\n")
    write_index(document, target.with_suffix(".md"))
