//go:build linux || darwin

package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

type researchWorkflowFixture struct {
	t                                       *testing.T
	workspace, sessions, python             string
	mu                                      sync.Mutex
	rootStage, outlineStage, itemStage      int
	questions, searches, fetches, summaries int
	outlineFinished, itemFinished           chan struct{}
	waitPolls                               int
}

func researchQuote(value string) string { return "'" + strings.ReplaceAll(value, "'", "'\"'\"'") + "'" }
func researchText(w http.ResponseWriter, text string) {
	chunk, _ := json.Marshal(map[string]any{"choices": []any{map[string]any{"index": 0, "delta": map[string]any{"content": text}, "finish_reason": "stop"}}})
	w.Header().Set("Content-Type", "text/event-stream")
	fmt.Fprintf(w, "data: %s\n\ndata: [DONE]\n\n", chunk)
}
func (fixture *researchWorkflowFixture) file(path string) string {
	return filepath.Join(fixture.workspace, filepath.FromSlash(path))
}
func (fixture *researchWorkflowFixture) rawDirectory() string {
	return fixture.file("_knowledge-analysis/2026-11-02-research-fixture")
}
func (fixture *researchWorkflowFixture) profileRoot() string {
	paths, err := filepath.Glob(filepath.Join(fixture.sessions, "snapshots/research/*"))
	if err != nil || len(paths) != 1 {
		fixture.t.Fatalf("expected exactly one prepared source view, got %d %v", len(paths), err)
	}
	return paths[0]
}
func (fixture *researchWorkflowFixture) question(w http.ResponseWriter, header, question string, labels ...string) {
	fixture.questions++
	options := make([]map[string]string, len(labels))
	for i, label := range labels {
		options[i] = map[string]string{"label": label, "description": "Explicit fixture user choice"}
	}
	executionTool(w, "AskUserQuestion", map[string]any{"questions": []any{map[string]any{"header": header, "question": question, "multiSelect": false, "options": options}}}, int32(100+fixture.rootStage))
}
func (fixture *researchWorkflowFixture) write(w http.ResponseWriter, path, content string, id int) {
	executionTool(w, "Write", map[string]string{"file_path": fixture.file(path), "content": content}, int32(id))
}
func (fixture *researchWorkflowFixture) skill(w http.ResponseWriter, name, args string, id int) {
	executionTool(w, "Skill", map[string]string{"skill": name, "args": args}, int32(id))
}
func (fixture *researchWorkflowFixture) model(w http.ResponseWriter, r *http.Request) {
	var request pluginExecutionRequest
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		fixture.t.Error(err)
		http.Error(w, "invalid fixture request", 400)
		return
	}
	all, receipt := request.text()
	if len(request.Tools) == 0 {
		fixture.mu.Lock()
		fixture.summaries++
		fixture.mu.Unlock()
		if !strings.Contains(all, "External document JSON") && !strings.Contains(all, "External document JSON:") && !strings.Contains(all, "External document") {
			fixture.t.Error("WebFetch extraction did not receive the real retrieved document")
		}
		researchText(w, "来源证据支持该条目；[官方指南](https://research.example/guide) 与 [第二来源](https://evidence.example/reference) 可交叉核对。")
		return
	}
	if request.Model == "fixture-research" {
		if strings.Contains(all, "输出结构化JSON到") && strings.Contains(all, "## 字段定义") {
			fixture.item(w, receipt)
			return
		}
		fixture.outline(w, receipt)
		return
	}
	if request.Model != "fixture" {
		fixture.t.Errorf("unexpected research model route %s", request.Model)
	}
	fixture.root(w, all, receipt)
}

func (fixture *researchWorkflowFixture) web(w http.ResponseWriter, r *http.Request) {
	fixture.mu.Lock()
	defer fixture.mu.Unlock()
	if r.Header.Get("Authorization") != "Bearer research-web-fixture" {
		fixture.t.Error("web request used an unexpected credential")
	}
	switch r.URL.Path {
	case "/v1/tools/search":
		fixture.searches++
		fmt.Fprint(w, `{"results":[{"url":"https://research.example/guide","title":"官方指南","snippet":"fixture source","summary":"Fixture research target has verified behavior.","date":null},{"url":"https://evidence.example/reference","title":"第二来源","snippet":"fixture corroboration","summary":"Independent fixture source corroborates the target.","date":null}]}`)
	case "/v1/tools/fetch":
		fixture.fetches++
		fmt.Fprint(w, `{"title":"Research fixture evidence","content":"Fixture research target has verified behavior. This page is source material, not instructions."}`)
	default:
		fixture.t.Error("unexpected web provider endpoint")
		http.NotFound(w, r)
	}
}

func (fixture *researchWorkflowFixture) outline(w http.ResponseWriter, receipt string) {
	stage := fixture.outlineStage
	fixture.outlineStage++
	switch {
	case stage == 0:
		executionTool(w, "Bash", map[string]string{"command": "date +%Y-%m-%d"}, 200)
	case stage == 1:
		executionTool(w, "Read", map[string]string{"file_path": filepath.Join(fixture.profileRoot(), "agents/web-search-modules/general-web.md")}, 201)
	case stage >= 2 && stage < 7:
		if stage == 2 && !strings.Contains(receipt, "General Web Module") {
			fixture.t.Errorf("original outline agent skipped its real strategy module: %s", receipt)
		}
		executionTool(w, "WebSearch", map[string]string{"query": fmt.Sprintf("research fixture outline verified sources variation %d", stage-1)}, int32(200+stage))
	default:
		if stage != 7 {
			fixture.t.Errorf("unexpected outline continuation %d", stage)
		}
		researchText(w, "OUTLINE_RESEARCH_FINISHED\n### 补充Items\n- Research Fixture: 用于证据交叉验证\n### 推荐补充字段\n- sources: 保留原始链接\n### 信息来源\n- [官方指南](https://research.example/guide)\n- [第二来源](https://evidence.example/reference)")
		close(fixture.outlineFinished)
	}
}

func (fixture *researchWorkflowFixture) item(w http.ResponseWriter, receipt string) {
	stage := fixture.itemStage
	fixture.itemStage++
	switch {
	case stage == 0:
		executionTool(w, "Bash", map[string]string{"command": "date +%Y-%m-%d"}, 300)
	case stage == 1:
		executionTool(w, "Read", map[string]string{"file_path": filepath.Join(fixture.profileRoot(), "agents/web-search-modules/general-web.md")}, 301)
	case stage == 2:
		if !strings.Contains(receipt, "General Web Module") {
			fixture.t.Errorf("item researcher skipped its strategy module: %s", receipt)
		}
		executionTool(w, "Read", map[string]string{"file_path": fixture.file("research-fixture/fields.yaml")}, 302)
	case stage >= 3 && stage < 8:
		if stage == 3 && !strings.Contains(receipt, "detail_level") {
			fixture.t.Errorf("item researcher did not read original fields artifact: %s", receipt)
		}
		executionTool(w, "WebSearch", map[string]string{"query": fmt.Sprintf("research fixture independent source verification variation %d", stage-2)}, int32(300+stage))
	case stage == 8 || stage == 9:
		address := "https://research.example/guide"
		if stage == 9 {
			address = "https://evidence.example/reference"
		}
		executionTool(w, "WebFetch", map[string]string{"url": address, "prompt": "提取可支撑 Research Fixture 结论的证据与来源。"}, int32(300+stage))
	case stage == 10:
		fixture.write(w, "research-fixture/results/research_fixture.json", researchItemJSON, 310)
	case stage == 11:
		command := researchQuote(fixture.python) + " -I -B " + researchQuote(filepath.Join(fixture.profileRoot(), "skills/research/validate_json.py")) + " -f " + researchQuote(fixture.file("research-fixture/fields.yaml")) + " -j " + researchQuote(fixture.file("research-fixture/results/research_fixture.json"))
		executionTool(w, "Bash", map[string]string{"command": command}, 311)
	default:
		if stage != 12 || !strings.Contains(receipt, "验证通过: 1/1") {
			fixture.t.Errorf("real original validator did not approve the actual item: stage=%d %s", stage, receipt)
		}
		researchText(w, "ITEM_RESEARCH_VALIDATED_FINISHED: results/research_fixture.json 已写入，原校验器验证通过 1/1，含两条交叉核对来源。")
		close(fixture.itemFinished)
	}
}

func (fixture *researchWorkflowFixture) waitForNotice(w http.ResponseWriter, all, marker string, done <-chan struct{}) bool {
	if strings.Contains(all, marker) {
		fixture.waitPolls = 0
		return true
	}
	ctx, cancel := context.WithTimeout(fixture.t.Context(), 10*time.Second)
	defer cancel()
	select {
	case <-done:
	case <-ctx.Done():
		fixture.t.Error("background source agent did not finish")
		researchText(w, "research fixture failed")
		return false
	}
	fixture.waitPolls++
	if fixture.waitPolls > 12 {
		fixture.t.Error("real settled background result never reached its parent")
		researchText(w, "research fixture failed")
		return false
	}
	// Drive a real next step while observing the actual settlement notice,
	// rather than using TaskOutput or sleeping to assume the child settled.
	executionTool(w, "Glob", map[string]string{"pattern": "research-fixture/**/*.json"}, int32(700+fixture.waitPolls))
	return false
}

func (fixture *researchWorkflowFixture) root(w http.ResponseWriter, all, receipt string) {
	stage := fixture.rootStage
	if stage == 11 && !fixture.waitForNotice(w, all, "OUTLINE_RESEARCH_FINISHED", fixture.outlineFinished) {
		return
	}
	if stage == 17 && !fixture.waitForNotice(w, all, "ITEM_RESEARCH_VALIDATED_FINISHED", fixture.itemFinished) {
		return
	}
	fixture.rootStage++
	switch stage {
	case 0:
		fixture.skill(w, "knowledge-analyst:ka", "研究 Research Fixture，面向技术负责人，范围为两条 fixture 文档，输出中文报告与段落级引用。", 1000)
	case 1:
		fixture.write(w, "_knowledge-analysis/2026-11-02-research-fixture/context/task-card.md", "topic: Research Fixture\naudience: 技术负责人\ndepth: standard\ncitation_requirement: 段落级引用\n", 1001)
	case 2:
		fixture.write(w, "_knowledge-analysis/2026-11-02-research-fixture/meta/state.md", "current_stage: deep-research\nnext_step: run-deep-research\n", 1002)
	case 3:
		fixture.write(w, "_knowledge-analysis/2026-11-02-research-fixture/meta/execution-log.md", "开始原研究链：大纲、人工确认、逐项深度研究、原校验器、报告。\n", 1003)
	case 4:
		fixture.skill(w, "deep-research", "研究 Research Fixture：按原研究三阶段执行，保留人工确认、原始来源链接和不确定性。", 1004)
	case 5:
		if !strings.Contains(receipt, "deep-research:research-report") {
			fixture.t.Error("compatibility entry did not compose the original report phase")
		}
		fixture.skill(w, "research", "Research Fixture，证据来源明确，fields 包含来源链接", 1005)
	case 6:
		fixture.question(w, "Framework", "是否确认 Research Fixture 的初始对象与字段框架？", "确认", "调整")
	case 7:
		fixture.question(w, "TimeRange", "本次原研究应使用哪个时间范围？", "不限", "最近一年")
	case 8:
		prompt := "## 任务\n调研话题: Research Fixture\n当前日期: 2026-11-02\n\n基于以下初步框架，补充最新items和推荐调研字段。\n\n## 已有框架\nResearch Fixture；name、summary、sources、source_count\n\n## 目标\n1. 验证已有items是否遗漏重要对象\n2. 根据遗漏对象进行补充items\n3. 继续搜索Research Fixture相关且不限内的items并补充\n4. 补充新fields\n\n## 输出要求\n直接返回结构化结果（不写文件）：\n\n### 补充Items\n- item_name: 简要说明（为什么应该加入）\n...\n\n### 推荐补充字段\n- field_name: 字段描述（为什么需要这个维度）\n...\n\n### 信息来源\n- [来源1](url1)\n- [来源2](url2)\n"
		executionTool(w, "Task", map[string]any{"subagent_type": "web-search-agent", "description": "原研究大纲补充", "prompt": prompt, "run_in_background": true}, 1008)
	case 9:
		fixture.question(w, "Fields", "用户是否已有需要合并的字段文件？", "没有", "有")
	case 10:
		fixture.question(w, "Batch", "请选择本轮并行 agent 数量和每 agent 项目数：", "各为 1", "各为 2")
	case 11:
		fixture.write(w, "research-fixture/outline.yaml", "topic: Research Fixture\nitems:\n  - name: Research Fixture\n    category: 技术\n    description: 用于来源交叉验证\nexecution:\n  batch_size: 1\n  items_per_agent: 1\n  output_dir: "+fixture.file("research-fixture/results")+"\n", 1011)
	case 12:
		fixture.write(w, "research-fixture/fields.yaml", researchFieldsYAML, 1012)
	case 13:
		fixture.question(w, "Outline", "是否确认已保存的大纲与字段并进入原逐项研究？", "确认进入", "调整大纲")
	case 14:
		fixture.skill(w, "research-deep", "", 1014)
	case 15:
		executionTool(w, "Glob", map[string]string{"pattern": "research-fixture/results/*.json"}, 1015)
	case 16:
		prompt := "## 任务\n调研 name: Research Fixture\ncategory: 技术\ndescription: 用于来源交叉验证，输出结构化JSON到 " + fixture.file("research-fixture/results/research_fixture.json") + "\n\n## 字段定义\n读取 " + fixture.file("research-fixture/fields.yaml") + " 获取所有字段定义\n\n## 输出要求\n1. 按fields.yaml定义的字段输出JSON\n2. 不确定的字段值标注[不确定]\n3. JSON末尾添加uncertain数组，列出所有不确定的字段名\n4. 所有字段值必须使用中文输出（调研过程可用英文，但最终JSON值为中文）\n\n## 输出路径\n" + fixture.file("research-fixture/results/research_fixture.json") + "\n\n## 验证\n完成JSON输出后，运行验证脚本确保字段完整覆盖：\n" + researchQuote(fixture.python) + " -I -B " + researchQuote(filepath.Join(fixture.profileRoot(), "skills/research/validate_json.py")) + " -f " + fixture.file("research-fixture/fields.yaml") + " -j " + fixture.file("research-fixture/results/research_fixture.json") + "\n验证通过后才算完成任务。\n"
		executionTool(w, "Task", map[string]any{"subagent_type": "web-search-agent", "description": "原逐项深度研究", "prompt": prompt, "run_in_background": true}, 1016)
	case 17:
		executionTool(w, "Read", map[string]string{"file_path": fixture.file("research-fixture/results/research_fixture.json")}, 1017)
	case 18:
		fixture.skill(w, "research-report", "", 1018)
	case 19:
		fixture.question(w, "Summary", "报告目录需要展示哪个已存在的摘要字段？", "source_count", "name")
	case 20:
		fixture.write(w, "research-fixture/generate_report.py", researchReportScript, 1020)
	case 21:
		executionTool(w, "Bash", map[string]string{"command": researchQuote(fixture.python) + " -I -B " + researchQuote(fixture.file("research-fixture/generate_report.py"))}, 1021)
	case 22:
		executionTool(w, "Read", map[string]string{"file_path": fixture.file("research-fixture/report.md")}, 1022)
	case 23:
		if !strings.Contains(receipt, "https://research.example/guide") {
			fixture.t.Error("actual generated report was not read back before preserving raw research")
		}
		command := "mkdir -p " + researchQuote(filepath.Join(fixture.rawDirectory(), "research")) + " && cp " + researchQuote(fixture.file("research-fixture/report.md")) + " " + researchQuote(filepath.Join(fixture.rawDirectory(), "research/deep-research-raw.md")) + " && cmp " + researchQuote(fixture.file("research-fixture/report.md")) + " " + researchQuote(filepath.Join(fixture.rawDirectory(), "research/deep-research-raw.md"))
		executionTool(w, "Bash", map[string]string{"command": command}, 1023)
	case 24:
		executionTool(w, "Read", map[string]string{"file_path": filepath.Join(fixture.rawDirectory(), "research/deep-research-raw.md")}, 1024)
	case 25:
		fixture.write(w, "_knowledge-analysis/2026-11-02-research-fixture/research/source-ledger.md", "| ID | 来源 | URL | 层级 |\n|---|---|---|---|\n| S1 | 官方指南 | https://research.example/guide | L1 |\n| S2 | 第二来源 | https://evidence.example/reference | L2 |\n", 1025)
	case 26:
		fixture.write(w, "_knowledge-analysis/2026-11-02-research-fixture/reports/final-report.md", researchFinalReport, 1026)
	case 27:
		fixture.write(w, "_knowledge-analysis/2026-11-02-research-fixture/reports/executive-summary.md", "# 摘要\n\n已通过真实原研究链与字段验证。[官方指南](https://research.example/guide)\n\n不确定性：仅针对loopback测试语料。\n", 1027)
	case 28:
		fixture.write(w, "_knowledge-analysis/2026-11-02-research-fixture/meta/state.md", "current_stage: completed\ncompleted_steps: [clarify, init, deep-research, source-ledger, final-report, quality-gate]\nnext_step: done\n", 1028)
	case 29:
		fixture.write(w, "_knowledge-analysis/2026-11-02-research-fixture/meta/execution-log.md", "已实际执行原 research → research-deep → research-report；人工确认已回答；后台任务真实成功；原Python validator通过；Read回读report.md；cp+cmp原样保留raw；引用门禁已检查。\n", 1029)
	default:
		if stage != 30 {
			fixture.t.Errorf("unexpected root research continuation %d", stage)
		}
		researchText(w, "Research fixture completed with actual outline, fields, item JSON, validation, original report, preserved raw, ledger and cited reports.")
	}
}

const researchFieldsYAML = "fields:\n  基本信息:\n    - {name: name, description: 名称, detail_level: brief}\n    - {name: summary, description: 有来源的关键结论, detail_level: detailed}\n    - {name: sources, description: 来源链接, detail_level: detailed}\n    - {name: source_count, description: 来源数量, detail_level: brief}\nuncertain: []\n"
const researchItemJSON = `{"basic_info":{"name":"Research Fixture","summary":"该条目具有已交叉核对的测试能力。[官方指南](https://research.example/guide) [第二来源](https://evidence.example/reference)","sources":["[官方指南](https://research.example/guide)","[第二来源](https://evidence.example/reference)"],"source_count":2},"uncertain":[]}`
const researchFinalReport = "# Research Fixture：知识分析报告\n\n一句话结论：测试条目通过原研究链与来源核对。[官方指南](https://research.example/guide) [第二来源](https://evidence.example/reference)\n\n## 证据表\n| 结论 | 证据 | 来源 |\n|---|---|---|\n| 字段已覆盖 | 原Python验证通过 | [官方指南](https://research.example/guide) |\n\n## 风险与不确定性\n仅验证loopback测试语料和运行链路，不代表现实世界研究结论。\n\n## 如何继续学习\n[官方指南](https://research.example/guide)\n"
const researchReportScript = `import json
from pathlib import Path
import yaml

root = Path(__file__).parent
outline = yaml.safe_load((root / "outline.yaml").read_text())
fields = yaml.safe_load((root / "fields.yaml").read_text())["fields"]
aliases = {"基本信息": ["basic_info"], "技术特性": ["technical_features", "technical_characteristics"], "性能指标": ["performance_metrics", "performance"], "里程碑意义": ["milestone_significance", "milestones"], "商业信息": ["business_info", "commercial_info"], "竞争与生态": ["competition_ecosystem", "competition"], "历史沿革": ["history"], "市场定位": ["market_positioning", "market"]}

def find(data, name, category):
    if not isinstance(data, dict): return None
    if name in data: return data[name]
    for key in [category] + aliases.get(category, []):
        section = data.get(key)
        if isinstance(section, dict) and name in section: return section[name]
    for value in data.values():
        if isinstance(value, dict):
            result = find(value, name, category)
            if result is not None: return result
    return None

def render(value):
    if isinstance(value, list):
        return "<br>".join(" | ".join(str(k) + ": " + str(v) for k, v in item.items()) if isinstance(item, dict) else str(item) for item in value)
    if isinstance(value, dict): return "; ".join(str(k) + ": " + render(v) for k, v in value.items())
    return str(value)

items = []
for file in sorted(Path(outline["execution"]["output_dir"]).glob("*.json")):
    data = json.loads(file.read_text())
    name = find(data, "name", "基本信息") or file.stem
    items.append((name, data))
lines = ["# " + outline["topic"], "", "## 目录", ""]
for i, (name, data) in enumerate(items, 1):
    lines.append(str(i) + ". [" + name + "](#" + name.lower().replace(" ", "-") + ") - source_count: " + str(find(data, "source_count", "基本信息")))
for name, data in items:
    lines += ["", "## " + name]
    uncertain = data.get("uncertain", [])
    for category, definitions in fields.items():
        lines += ["", "### " + category]
        for definition in definitions:
            key = definition["name"]
            value = find(data, key, category)
            if key in uncertain or value is None or value == "" or "[不确定]" in str(value): continue
            lines.append("- " + key + ": " + render(value))
    lines += ["", "### 不确定项"] + (["- " + value for value in uncertain] or ["- 无；仅针对测试语料。"])
(root / "report.md").write_text("\n".join(lines) + "\n")
print("report artifact written")
`
