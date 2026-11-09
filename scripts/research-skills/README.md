# 科研 Skills 目录采集

关联 [上游 #156](https://github.com/phodal/pero/issues/156)。只读取公开来源，不安装或运行来源中的脚本、hooks、MCP、命令或提示词。

## 重新采集

前提：Python 3.10+、PyYAML（现有环境版本 6.0.2）、已认证 GitHub CLI。源码只通过 GitHub API 与固定提交的 raw 文件读取，认证凭据由 `gh` 持有，不写入目录。

```powershell
python scripts/research-skills/collect.py
python scripts/research-skills/verify.py
python -m unittest discover -s scripts/research-skills -p 'test_*.py' -v
```

采集是显式联网操作。默认缓存位于系统临时目录下的 `pero-research-skills-cache`；缓存固定每个来源的实际提交与 tree。相同缓存可恢复中断、重复生成相同来源快照；要核对新版本，使用一个新的 `--cache` 目录，不删除现有快照。生成时间会更新。

```powershell
python scripts/research-skills/collect.py --cache C:/Temp/pero-skills-new-snapshot
```

源仓库列表、二级 PPT 文章引用和非安装资源集中在 `sources.py`。`catalog.py` 定义内容解析、分类和去重规则；`collect.py` 负责 I/O；`verify.py` 在离线状态核对条目身份、统计、关系和中文索引。

## 身份与核实范围

- 来源固定实际 commit，文件记录 Git blob 和 SHA-256；ZIP 内条目单列 archive/member，子模块读取其声明的固定提交。
- 只有 SKILL.md 和所在目录全部文件的资源指纹均相同才合并，所有来源保留。同名异内容或相同指引但不同资源的包保持独立；后者记录 related_instruction_ids。未解析子模块使资源指纹未知，不自动合并。
- 许可证分为 skill 中声明、邻近目录许可证、仓库级证据和未知。根仓库许可证不自动授权转收条目；生成器不输出法律判断。
- 描述、兼容声明和依赖章节来自实际文件；英文原文保留。中文分类属于编辑标签，未核对的中文翻译留空。
- inputs、outputs、examples 仅提取明确标出的输入、输出/交付、用法/示例章节，保留原始标题和文本。dependencies 同时保留显式 YAML 声明（标题为 YAML dependencies，文本按已解析值序列化）和依赖章节；不安装或执行声明。空数组不代表无要求，应查看固定版本原文；代码块内的标题不当作文档章节。
- 分类只依据技能自身名称、首要用途和原始描述，不使用合集的祖先目录作为用途；识别任务而非将出现的 AI 工具名直接视为主分类。描述中 incidental 的图表、投稿、RAG 或 GPU 不改变已明确的首要工作。
- 如果整个 frontmatter 因其他字段格式错误而不可解析，只保留原始未缩进单行 description 字符串，并保留 YAML 错误说明；不将部分恢复描述当作完整元数据通过或可运行证明。
- 分类规则排除通用开发和平台配置，科研文档辅助与内部依赖单独标记。默认科研全流程的条目仍需人工细分，不冒充已审核推荐。
- 当前固定目录有 103 条显式 YAML dependencies 证据；加上正文依赖章节，共 464 条目包含可展示的依赖信息。没有声明的部分仍显示未知，不从分类、模型名或工具名猜测安装条件。
- 网盘包、二级通用工具和无法固定源码的页面作为资源保留，不计入虚构技能数量。网络、YAML 或 ZIP 失败记录原因，不能隐去后声称全部已验证。

离线验证不证明宿主兼容、第三方依赖可用、科学方法有效或作者已授权全部资源。产品安装和真实运行由市场的后续阶段分别验收。
