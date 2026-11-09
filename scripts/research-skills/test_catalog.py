import json
import unittest

from catalog import canonical_spdx, classify, parse_skill, consolidate, extract_sections, make_entry, resource_fingerprint, runtime_catalog, spdx_from_text


class CatalogTest(unittest.TestCase):
    def test_skill_metadata(self):
        cases = [
            ("---\nname: paper-a\ndescription: >\n  Read papers\n  with citations.\nlicense: MIT\n---\n# Read\n", "paper-a", "Read papers with citations.", "MIT"),
            ("# Plain skill\nRead the evidence.", "plain-skill", "", None),
            ("---\nname: [wrong]\ndescription: true\n---\n", "fallback", "", None),
            ("---\nname: fallback\ndescription: Process scientific datasets, then output: clean tables.\ndependencies: [ray[data], pandas]\n---\n# Data\n", "fallback", "Process scientific datasets, then output: clean tables.", None),
        ]
        for content, name, description, license_id in cases:
            with self.subTest(name=name):
                fallback = "plain-skill" if name == "plain-skill" else "fallback"
                actual = parse_skill(content, fallback)
                self.assertEqual((actual["name"], actual["description"], actual["license"]), (name, description, license_id))

    def test_classification(self):
        cases = [
            ("skills/citation-check/SKILL.md", "Check paper references", "research_skill", "literature"),
            ("skills/git-workflow/SKILL.md", "Git branching and commits", "excluded", "development"),
            ("skills/nature-shared/SKILL.md", "Internal shared-reference support package. Do not invoke standalone.", "internal_dependency", "workflow"),
            ("skills/astropy/SKILL.md", "Astronomy and astrophysics", "research_skill", "scientific-computing"),
            ("skills/pdf/SKILL.md", "Read and manipulate PDF documents", "research_support", "documents"),
            ("skills/astropy/SKILL.md", "Read astronomy datasets and plot results", "research_skill", "scientific-computing"),
            ("skills/scientific-writing/SKILL.md", "Draft papers and respond to review", "research_skill", "writing"),
            ("skills/widget/SKILL.md", "Make interface widgets", "needs_review", "unclassified"),
            ("skills/09-machine-learning/liteparse/SKILL.md", "Local document and PDF parsing that returns spatial text with bounding boxes. Use for OCR and layout-preserved JSON for RAG and multimodal agents.", "research_support", "documents"),
            ("collection/ai-ml/scan-notes/SKILL.md", "Extract text from scanned PDF documents with OCR.", "research_support", "documents"),
            ("skills/13c-metabolic-flux/SKILL.md", "Estimates intracellular metabolic fluxes from carbon-13 isotope measurements; distinguishes measured-label inference from flux balance analysis.", "research_skill", "scientific-computing"),
            ("skills/ai-ml/conjoint-cleaning/SKILL.md", "Clean and reshape Qualtrics conjoint exports to analysis-ready long format.", "research_skill", "data"),
            ("skills/academic-paper/SKILL.md", "12-agent academic paper writing pipeline supporting revision and reviewer comments.", "research_skill", "writing"),
            ("skills/composer/SKILL.md", "Systematic writing framework for philosophy papers from outline to submission-ready manuscript.", "research_skill", "writing"),
            ("skills/academic-research-suite/SKILL.md", "Research, writing, manuscript review, screening and experiments.", "research_skill", "workflow"),
            ("skills/implementation/computational-inference/SKILL.md", "Computational methods for statistical inference and optimization", "research_skill", "statistics"),
            ("skills/a1/SKILL.md", "VS-Enhanced Research Question Refiner\nAlternatives presentation and differentiated question recommendation", "research_skill", "research-design"),
            ("skills/a2/SKILL.md", "Theoretical Framework Architect with Critique & Visualization\nDifferentiated framework presentation", "research_skill", "research-design"),
            ("skills/c5/SKILL.md", "Meta-Analysis Master with Data Integrity and Sensitivity\nUse for pooled effects, forest plots and funnel plots", "research_skill", "statistics"),
        ]
        for path, description, kind, category in cases:
            with self.subTest(path=path):
                self.assertEqual(classify(path, description), (kind, category))
                leaf = path.rsplit("/", 2)[-2]
                for collection in ["ai-ml", "writing", "statistics", "literature-review"]:
                    self.assertEqual(classify(f"vendor/{collection}/{leaf}/SKILL.md", description), (kind, category))

    def test_duplicate_identity(self):
        def item(repo, path, digest, name, package="same-package"):
            source = {"repository": repo, "path": path, "sha256": digest, "resource_fingerprint": package, "commit": "a" * 40, "url": "https://github.com/" + repo}
            return {"id": repo + "/" + path, "name": name, "source": source, "sources": [source]}
        source = item("owner/original", "skills/lit/SKILL.md", "same", "lit")
        vendor = item("owner/collection", "skills/01-vendor/lit/SKILL.md", "same", "lit")
        variant = item("owner/other", "skills/lit/SKILL.md", "different", "lit")
        unique, aliases = consolidate([vendor, variant, source])
        self.assertEqual(len(unique), 2)
        self.assertEqual(len(aliases), 1)
        self.assertEqual(len(next(x for x in unique if x["source"]["sha256"] == "same")["sources"]), 2)
        self.assertEqual(aliases[0]["canonical_id"], source["id"])
        changed_resources = item("owner/resources", "skills/lit/SKILL.md", "same", "lit", "different-package")
        unique, aliases = consolidate([source, changed_resources])
        self.assertEqual(len(unique), 2)
        self.assertEqual(aliases, [])

    def test_resource_identity(self):
        original = [{"path": "skills/lit/SKILL.md", "sha": "instruction", "mode": "100644", "type": "blob"},
                    {"path": "skills/lit/references/data.md", "sha": "data", "mode": "100644", "type": "blob"}]
        changed = [dict(entry) for entry in original]
        changed[1]["sha"] = "changed-data"
        self.assertNotEqual(resource_fingerprint(original, "skills/lit/SKILL.md"), resource_fingerprint(changed, "skills/lit/SKILL.md"))
        original.append({"path": "skills/lit/submodule", "sha": "commit", "mode": "160000", "type": "commit"})
        self.assertIsNone(resource_fingerprint(original, "skills/lit/SKILL.md"))

    def test_license_identity(self):
        for declaration, expected in [("MIT", "MIT"), ("BSD-3-Clause license", "BSD-3-Clause"),
                                      ("MIT OR Apache-2.0", "MIT OR Apache-2.0"),
                                      ("Some license permitting MIT-like use", None)]:
            with self.subTest(declaration=declaration):
                self.assertEqual(canonical_spdx(declaration), expected)
        self.assertEqual(spdx_from_text("GNU GENERAL PUBLIC LICENSE\nVersion 2, June 1991"), "GPL-2.0-only")

    def test_explicit_sections(self):
        cases = [
            ("# Skill\n## Required Inputs\n- CSV data\n### Columns\nX and Y\n## Deliverables\n- report.md\n## Usage Examples\n```md\n## Inputs\nnot a real section\n```\nDo the analysis.\n## Other\nignored\n",
             {"inputs": [("Required Inputs", "- CSV data\n### Columns\nX and Y")],
              "outputs": [("Deliverables", "- report.md")],
              "examples": [("Usage Examples", "```md\n## Inputs\nnot a real section\n```\nDo the analysis.")]}),
            ("# Skill\n## 输入材料\n论文 PDF\n## 输出\n中文阅读笔记\n## 示例\n读取论文。\n",
             {"inputs": [("输入材料", "论文 PDF")], "outputs": [("输出", "中文阅读笔记")], "examples": [("示例", "读取论文。")]}),
            ("# Skill\nNo explicit sections.\n", {"inputs": [], "outputs": [], "examples": []}),
        ]
        for content, expected in cases:
            with self.subTest(content=content[:30]):
                actual = extract_sections(content)
                for name, sections in expected.items():
                    self.assertEqual([(section.heading, section.text) for section in getattr(actual, name)], sections)

    def test_runtime_catalog_omits_extraction_and_secrets(self):
        digest = "b" * 64
        document = {"schema_version": 1, "generated_at": "2026-11-09", "issue_url": "https://example.invalid/156",
                    "sources": [{"repository": "owner/repo", "commit": "a" * 40, "url": "https://github.com/owner/repo"}],
                    "skills": [{"id": "owner/repo/SKILL.md", "name": "read", "kind": "research_skill",
                                "description": "Read evidence", "frontmatter_yaml": "token: hidden",
                                "examples": [{"heading": "Usage", "text": "See\n```python\nimport os\n```\napi_key: supersecretvalue"}],
                                "source": {"repository": "owner/repo", "commit": "a" * 40, "path": "SKILL.md", "sha256": digest, "git_blob_sha": "c" * 40},
                                "license": {"spdx": "MIT", "status": "declared_in_skill", "evidence_url": "https://example.invalid/LICENSE", "declaration": "MIT"},
                                "verification": {"content": "parsed", "runtime": "not_run", "notes": []}}]}
        served = json.dumps(runtime_catalog(document))
        self.assertNotIn("frontmatter_yaml", served)
        self.assertNotIn("import os", served)
        self.assertNotIn("supersecretvalue", served)
        self.assertNotIn("git_blob_sha", served)
        self.assertIn("api_key=<redacted>", served)
        self.assertIn(digest, served)
        self.assertEqual(runtime_catalog(document)["skills"][0]["source"]["sha256"], digest)

    def test_declared_dependencies(self):
        source = b"---\nname: knowledge-distillation\ndescription: Compress a language model.\ndependencies: [transformers, torch, datasets]\n---\n# Distillation\n## Requirements\nGPU access\n"
        entry = make_entry("owner/repo", "a" * 40, "skills/knowledge-distillation/SKILL.md", source, "blob")
        self.assertEqual(entry["dependencies"], [{"heading": "YAML dependencies", "text": "- transformers\n- torch\n- datasets"},
                                                  {"heading": "Requirements", "text": "GPU access"}])


if __name__ == "__main__":
    unittest.main()
