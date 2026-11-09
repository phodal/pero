"""Offline consistency check for the generated catalog and Chinese index."""
import json
from collections import Counter
from pathlib import Path


def verify(path: Path) -> dict:
    catalog = json.loads(path.read_text(encoding="utf-8"))
    skills, exclusions, stats = catalog["skills"], catalog["exclusions"], catalog["stats"]
    ids = {entry["id"] for entry in skills}
    assert len(ids) == len(skills)
    assert stats["retained_skills"] == len(skills)
    assert stats["candidate_paths"] == len(skills) + len([x for x in exclusions if x["kind"] in {"duplicate", "nonresearch", "needs_review", "unreadable"}])
    assert stats["by_category"] == dict(Counter(x["category"] for x in skills))
    assert stats["by_kind"] == dict(Counter(x["kind"] for x in skills))
    assert stats["by_license_status"] == dict(Counter(x["license"]["status"] for x in skills))
    assert stats["unresolved_submodules"] == sum(not module.get("repository") for source in catalog["sources"] for module in source.get("submodules", []))
    paths = set()
    for skill in skills:
        assert skill["source"] in skill["sources"]
        for name in ["inputs", "outputs", "examples", "dependencies"]:
            assert isinstance(skill[name], list)
            assert all(set(section) == {"heading", "text"} and all(isinstance(value, str) for value in section.values()) for section in skill[name])
        assert skill["category"] in catalog["categories"]
        assert skill["verification"]["runtime"] == "not_run"
        assert skill["compatibility"]["status"] == "unverified"
        for source in skill["sources"]:
            assert len(source["commit"]) == 40, source
            assert len(source["sha256"]) == 64, source
            assert source["url"].startswith("https://github.com/")
            identity = (source["repository"], source["commit"], source["path"])
            assert identity not in paths, identity
            paths.add(identity)
    for exclusion in exclusions:
        if exclusion["kind"] == "duplicate":
            assert exclusion["canonical_id"] in ids
    index = path.with_suffix(".md").read_text(encoding="utf-8")
    assert "https://github.com/phodal/pero/issues/156" in index
    assert all(f"[{skill['source']['repository']}]({skill['source']['url']})" in index for skill in skills)
    assert str(stats["candidate_paths"]) in index
    return stats


if __name__ == "__main__":
    target = Path(__file__).resolve().parents[2] / "docs/design-docs/research-skills-catalog.json"
    print(json.dumps(verify(target), ensure_ascii=True))
