"""Read public, pinned GitHub skill sources; never install or execute their code."""
from __future__ import annotations

import argparse
import base64
import concurrent.futures
import configparser
import hashlib
import io
import json
import re
import subprocess
import tempfile
import uuid
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path

from catalog import CATEGORIES, canonical_spdx, consolidate, make_entry, resource_fingerprint, spdx_from_text
from sources import ISSUE_URL, REPOSITORIES, RESOURCES, SOURCE_DOCUMENT


def github_api(endpoint: str) -> dict:
    process = subprocess.run(["gh", "api", endpoint], capture_output=True, text=True, encoding="utf-8")
    if process.returncode:
        raise RuntimeError(process.stderr.strip())
    return json.loads(process.stdout)


def raw(repo: str, commit: str, path: str, cache: Path, blob: str | None = None) -> bytes:
    identity = blob or hashlib.sha256((repo + commit + path).encode()).hexdigest()
    target = cache / (identity + ".blob")
    if target.exists():
        return target.read_bytes()
    url = f"https://raw.githubusercontent.com/{repo}/{commit}/" + urllib.parse.quote(path, safe="/")
    last_error = None
    for _ in range(3):
        try:
            with urllib.request.urlopen(url, timeout=60) as response:
                content = response.read(64 * 1024 * 1024 + 1)
            if len(content) > 64 * 1024 * 1024:
                raise ValueError("Source file exceeds 64 MiB collection limit")
            temporary = target.with_name(f"{target.name}.{uuid.uuid4().hex}.tmp")
            try:
                temporary.write_bytes(content)
                temporary.replace(target)
            finally:
                temporary.unlink(missing_ok=True)
            return content
        except (urllib.error.URLError, TimeoutError) as error:
            last_error = error
    raise RuntimeError(f"Unable to read {repo}:{path}: {last_error}")


def inspect_source(repo: str, cache: Path, commit: str | None = None, discovered_via: dict | None = None) -> tuple[dict, list[dict], list[dict]]:
    metadata_key = hashlib.sha256((repo + (commit or "HEAD")).encode()).hexdigest()
    snapshot_path = cache / (metadata_key + ".snapshot.json")
    if snapshot_path.exists():
        snapshot = json.loads(snapshot_path.read_text(encoding="utf-8"))
        commit, tree = snapshot["commit"], snapshot["tree"]
    else:
        commit_info = github_api(f"repos/{repo}/commits/{commit or 'HEAD'}")
        commit = commit_info["sha"]
        tree_info = github_api(f"repos/{repo}/git/trees/{commit}?recursive=1")
        if tree_info.get("truncated"):
            raise RuntimeError("GitHub returned truncated tree; completeness not established")
        tree = tree_info["tree"]
        snapshot_path.write_text(json.dumps({"commit": commit, "tree": tree}), encoding="utf-8")
    skills = [entry for entry in tree if entry["type"] == "blob" and entry["path"].split("/")[-1].lower() == "skill.md"]
    archives = [entry for entry in tree if re.search(r"skill[^/]*\.zip$", entry["path"], re.I)]
    licenses = [entry for entry in tree if re.match(r"^(?:licen[sc]e(?:[.\-_].*)?|copying(?:\..*)?)$", entry["path"].split("/")[-1], re.I)]
    source = {"id": repo if not discovered_via else repo + "@" + commit,
              "repository": repo, "commit": commit, "url": f"https://github.com/{repo}/tree/{commit}",
              "status": "read", "candidate_paths": len(skills), "archive_candidates": [],
              "submodules": [], "notes": [], "discovered_via": discovered_via}
    if not skills and not archives:
        source["notes"].append("未发现 SKILL.md 或 skill ZIP；作为参考仓库保留")
    items, failures = [], []
    license_content = {}
    for entry in licenses:
        if entry.get("size", 0) > 128 * 1024:
            continue
        try:
            license_content[entry["path"]] = raw(repo, commit, entry["path"], cache, entry["sha"]).decode("utf-8-sig", errors="replace")
        except RuntimeError as error:
            source["notes"].append(str(error))

    def license_for(path: str) -> dict | None:
        parents = list(Path(path).parents)
        for parent in parents:
            parent_path = parent.as_posix()
            prefix = "" if parent_path == "." else parent_path + "/"
            candidates = [(key, value) for key, value in license_content.items() if key.startswith(prefix) and "/" not in key[len(prefix):]]
            if candidates:
                key, value = candidates[0]
                return {"spdx": spdx_from_text(value), "evidence_url": f"https://github.com/{repo}/blob/{commit}/{key}",
                        "status": "repository_only" if "/" not in key else "directory_license", "declaration": None}
        return None

    def read_skill(entry: dict) -> dict:
        content = raw(repo, commit, entry["path"], cache, entry["sha"])
        return make_entry(repo, commit, entry["path"], content, entry["sha"], license_for(entry["path"]), package_fingerprint=resource_fingerprint(tree, entry["path"]))

    with concurrent.futures.ThreadPoolExecutor(max_workers=12) as executor:
        futures = {executor.submit(read_skill, entry): entry for entry in skills}
        for index, future in enumerate(concurrent.futures.as_completed(futures), 1):
            entry = futures[future]
            try:
                items.append(future.result())
            except (RuntimeError, ValueError, UnicodeError) as error:
                failures.append({"id": repo + "/" + entry["path"], "kind": "unreadable", "reason": str(error),
                                 "source": {"repository": repo, "commit": commit, "path": entry["path"], "url": f"https://github.com/{repo}/blob/{commit}/{entry['path']}"}})
            if index % 100 == 0:
                print(json.dumps({"repository": repo, "read": index, "total": len(skills)}), flush=True)

    for archive in archives:
        count = 0
        try:
            content = raw(repo, commit, archive["path"], cache, archive["sha"])
            with zipfile.ZipFile(io.BytesIO(content)) as bundle:
                members = []
                for member in bundle.infolist():
                    if member.is_dir():
                        continue
                    if member.file_size > 16 * 1024 * 1024:
                        raise ValueError("ZIP member exceeds 16 MiB read limit")
                    data = bundle.read(member)
                    blob = hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()
                    mode = "100755" if ((member.external_attr >> 16) & 0o111) else "100644"
                    members.append({"path": member.filename, "type": "blob", "sha": blob, "mode": mode})
                for entry in bundle.infolist():
                    if entry.filename.split("/")[-1].lower() != "skill.md":
                        continue
                    path = archive["path"] + "!" + entry.filename
                    count += 1
                    if entry.file_size > 16 * 1024 * 1024:
                        raise ValueError("ZIP skill exceeds 16 MiB read limit")
                    items.append(make_entry(repo, commit, path, bundle.read(entry), None, license_for(archive["path"]), archive["path"], resource_fingerprint(members, entry.filename)))
            source["archive_candidates"].append({"path": archive["path"], "skill_count": count, "status": "read"})
        except (RuntimeError, ValueError, zipfile.BadZipFile, UnicodeError) as error:
            source["archive_candidates"].append({"path": archive["path"], "skill_count": count, "status": "unreadable", "reason": str(error)})
            failures.append({"id": repo + "/" + archive["path"], "kind": "unreadable_archive", "reason": str(error), "source": {"repository": repo, "commit": commit, "path": archive["path"], "url": f"https://github.com/{repo}/blob/{commit}/{archive['path']}"}})
    source["candidate_paths"] += sum(x["skill_count"] for x in source["archive_candidates"])

    submodules = [entry for entry in tree if entry["mode"] == "160000"]
    if submodules:
        config = configparser.ConfigParser()
        known = {}
        evidence = None
        if any(entry["path"] == ".gitmodules" for entry in tree):
            config.read_string(raw(repo, commit, ".gitmodules", cache).decode("utf-8"))
        else:
            source["notes"].append("存在 Git 子模块引用但未提交 .gitmodules；继续检查已提交的 marketplace 来源记录")
        if any(entry["path"] == "plugins/known_marketplaces.json" for entry in tree):
            known = json.loads(raw(repo, commit, "plugins/known_marketplaces.json", cache).decode("utf-8"))
            evidence = f"https://github.com/{repo}/blob/{commit}/plugins/known_marketplaces.json"
        source["resolution_records_checked"] = [".gitmodules", "plugins/known_marketplaces.json"]
        for module in submodules:
            section = next((config[key] for key in config.sections() if config[key].get("path") == module["path"]), None)
            url = section.get("url") if section else ""
            declaration = known.get(module["path"].split("/")[-1], {}).get("source", {})
            if not url and declaration.get("source") == "github" and re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", declaration.get("repo", "")):
                url = "https://github.com/" + declaration["repo"]
            match = re.match(r"https://github.com/([^/]+/[^/]+?)(?:\.git)?$", url)
            source["submodules"].append({"path": module["path"], "repository": match.group(1) if match else None, "commit": module["sha"], "url": url, "resolution_evidence": evidence if not section else f"https://github.com/{repo}/blob/{commit}/.gitmodules"})
    return source, items, failures


def write_index(catalog: dict, output: Path) -> None:
    stats = catalog["stats"]
    lines = ["# 科研 Skills 完整分类索引", "", f"关联上游 [#156]({ISSUE_URL})。目录生成日期：{catalog['generated_at'][:10]}。", "",
             "目录按固定源码提交读取；仅做静态内容与来源核对，没有运行第三方脚本、安装技能或验证科研效果。英文原始说明保留，未人工核对的中文翻译留空，不用自动生成的描述冒充来源。", "",
             f"候选路径 **{stats['candidate_paths']}** 个；去重科研/辅助条目 **{stats['retained_skills']}** 个；合并副本 **{stats['duplicate_paths']}** 个；非科研 **{stats['excluded_paths']}** 个；待分类 **{stats['review_paths']}** 个；读取失败 **{stats['unreadable_paths']}** 个。", "",
             (f"另外记录 **{stats['unresolved_submodules']}** 个缺少可解析来源的 Git 子模块引用；它们的包内条目数量未知，不计入上述分母。" if stats['unresolved_submodules'] else "已声明且可解析来源的子模块均已按固定提交展开；缺失 .gitmodules 的引用使用已提交 marketplace 来源记录解析。") + "网盘资源不作数量推测。", "",
             "仅在 SKILL.md 的 SHA-256 与完整所在目录的资源指纹均相同时合并。资源不同或存在未解析子模块的条目保持独立；相同指引的相关条目见 `related_instruction_ids`。每个别名保留仓库、提交与路径。", "",
             "## 来源清单", "", "| 来源 | 固定提交 | 候选路径 | 状态 |", "| --- | --- | ---: | --- |"]
    for source in catalog["sources"]:
        lines.append(f"| [{source['repository']}]({source.get('url', 'https://github.com/' + source['repository'])}) | `{(source.get('commit') or '')[:12]}` | {source.get('candidate_paths', 0)} | {source['status']} |")
    lines += ["", "### 来源缺口", ""]
    for source in catalog["sources"]:
        for note in source.get("notes", []):
            lines.append(f"- {source['repository']}：{note}")
    for category, title in CATEGORIES.items():
        entries = [x for x in catalog["skills"] if x["category"] == category]
        if not entries:
            continue
        lines += ["", f"## {title}（{len(entries)}）", "", "| Skill / 原始说明 | 来源 | 类型 / 许可证证据 |", "| --- | --- | --- |"]
        for entry in entries:
            description = (entry["description_zh"] or entry["description"]).replace("\n", " ").replace("|", "\\|")
            name = entry["name"].replace("|", "\\|")
            source = entry["source"]
            license_data = entry["license"]
            label = {"research_skill": "科研", "research_support": "辅助", "internal_dependency": "内部依赖"}[entry["kind"]]
            license_label = (license_data["spdx"] or "未知") + " / " + license_data["status"]
            lines.append(f"| **{name}** — {description or '原文未声明描述，需回读核实。'} | [{source['repository']}]({source['url']}) | {label}；{license_label} |")
    lines += ["", "## 参考资源与待核实来源", "", "| 资源 | 类型 | 说明 |", "| --- | --- | --- |"]
    for resource in catalog["resources"]:
        lines.append(f"| [{resource['name']}]({resource['url']}) | {resource['kind']} | {resource['notes']} |")
    lines += ["", "## 排除与合并", "", "所有候选路径的具体去向、合并目标和原因见 JSON 的 `exclusions`；完整别名来源同时保留在每条 skill 的 `sources`。", "",
              "## 验证边界", "", "- frontmatter、描述、声明的兼容条件和依赖章节来自实际固定版本文件，未知字段不猜测。", "- 根仓库许可证只记录为 `repository_only`，不据此确认转收条目的授权；独立声明与目录内许可证分别标记。", "- 分类是内容规则整理结果，属于编辑标签；来源声明、安装兼容、实际运行和科学有效性是不同证据层。", "- 网盘包及不可读的外部页面保留为待核实资源，不伪造内部技能数量；ZIP/子模块读取不代表产品安装器已支持。", ""]
    lines.insert(len(lines) - 1, "- inputs、outputs、examples 仅提取明确章节并保留原文；空数组不代表无输入、无交付或无用法，应查看固定来源。")
    lines.insert(len(lines) - 1, "- dependencies 同时保留显式 YAML dependencies 和依赖章节；仅展示声明，不安装或执行。分类依据技能自身名称和首要用途，不继承合集祖先目录。")
    output.write_text("\n".join(lines), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cache", type=Path, default=Path(tempfile.gettempdir()) / "pero-research-skills-cache")
    parser.add_argument("--output", type=Path, default=Path(__file__).resolve().parents[2] / "docs/design-docs/research-skills-catalog.json")
    args = parser.parse_args()
    args.cache.mkdir(parents=True, exist_ok=True)
    sources, candidates, exclusions = [], [], []
    for repo in REPOSITORIES:
        print(json.dumps({"repository": repo, "status": "reading"}), flush=True)
        try:
            source, items, failures = inspect_source(repo, args.cache)
            sources.append(source); candidates.extend(items); exclusions.extend(failures)
            for module in source["submodules"]:
                if not module["repository"]:
                    source["notes"].append("子模块不是可识别的公开 GitHub 来源，未展开：" + module["path"])
                    continue
                try:
                    nested, nested_items, nested_failures = inspect_source(module["repository"], args.cache, module["commit"], {"repository": repo, "commit": source["commit"], "path": module["path"]})
                    sources.append(nested); candidates.extend(nested_items); exclusions.extend(nested_failures)
                except (RuntimeError, ValueError) as error:
                    source["notes"].append("子模块读取失败：" + str(error))
        except (RuntimeError, ValueError) as error:
            sources.append({"id": repo, "repository": repo, "commit": None, "candidate_paths": 0, "status": "unreadable", "notes": [str(error)]})
    retained = []
    for item in candidates:
        if item["kind"] == "needs_review":
            exclusions.append({**item, "reason": "未找到明确科研用途，保留完整静态元数据等待人工分类"})
        elif item["kind"] == "excluded":
            exclusions.append({"id": item["id"], "kind": "nonresearch", "name": item["name"], "reason": "通用开发/平台配置技能，不含独立科研任务", "source": item["source"]})
        else:
            retained.append(item)
    skills, aliases = consolidate(retained)
    exclusions.extend({**alias, "kind": "duplicate"} for alias in aliases)
    stats = {"source_count": len(sources), "candidate_paths": sum(x.get("candidate_paths", 0) for x in sources),
             "retained_skills": len(skills), "duplicate_paths": len(aliases),
             "excluded_paths": sum(x["kind"] == "nonresearch" for x in exclusions),
             "review_paths": sum(x["kind"] == "needs_review" for x in exclusions),
             "unreadable_paths": sum(x["kind"] == "unreadable" for x in exclusions),
             "unreadable_sources": sum(x["status"] == "unreadable" for x in sources),
             "unresolved_submodules": sum(not module.get("repository") for source in sources for module in source.get("submodules", [])),
             "by_category": dict(Counter(x["category"] for x in skills)),
             "by_kind": dict(Counter(x["kind"] for x in skills)),
             "by_license_status": dict(Counter(x["license"]["status"] for x in skills))}
    assert stats["candidate_paths"] == stats["retained_skills"] + stats["duplicate_paths"] + stats["excluded_paths"] + stats["review_paths"] + stats["unreadable_paths"], stats
    assert len({x["id"] for x in skills}) == len(skills), "Duplicate canonical identity"
    catalog = {"schema_version": 1, "collection_status": "complete", "generated_at": datetime.now(timezone(timedelta(hours=8))).isoformat(timespec="seconds"),
               "issue_url": ISSUE_URL, "source_document": SOURCE_DOCUMENT, "categories": CATEGORIES,
               "sources": sources, "skills": skills, "resources": RESOURCES, "exclusions": exclusions, "stats": stats}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    pending = args.output.with_suffix(".pending.json")
    pending.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    pending.replace(args.output)
    write_index(catalog, args.output.with_suffix(".md"))
    print(json.dumps(stats, ensure_ascii=True), flush=True)


if __name__ == "__main__":
    main()
