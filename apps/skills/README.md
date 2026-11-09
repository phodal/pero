# Skills

科研 Skills 市场，关联 [上游 #156](https://github.com/phodal/pero/issues/156)。

App 通过声明的 `skills` Host capability 读取固定目录和真实安装记录。目录的生成与来源证据见 [科研 Skills 索引](../../docs/design-docs/research-skills-catalog.md)。安装、版本与后续会话选择由 Rust Host 管理，App 不下载、不执行安装脚本，也不持久化 Desktop 偏好。

支持按任务/名称/来源搜索、分类筛选、可安装过滤、名称排序和“发现 / 已安装”切换。列表每页 12 项，默认先展示 16 个代表性技能；点击行打开共享 Dialog 的右侧详情抽屉，分别查看用途与条件、示例、来源与版本。窄窗口保留列表和操作，详情占满视口。

`ui-src/editorial.json` 保存已确认原型中的 16 项中文编辑说明，按完整目录身份和固定版本应用；同名不同来源不复用，旧版本不套用新说明。列表和搜索共用该说明入口，来源原文始终保留。独立安装任务提供取消、失败重试与完成后的使用入口，刷新失败保留已有内容。

安装后点击「去使用」或详情中的「在新会话中使用」，会打开共享聊天的普通草稿，由 Host 解析实际安装版本并附上可移除的技能引用，不自动发送、不启用全局装配。也可在聊天输入框的“技能”来源或 `@skill 名称` 中手动选择。选择器只列当前 profile 已安装的版本，支持名称与中英文说明搜索；已选内容不会随更新、回退或移除而被静默改写。

开启“用于后续普通聊天”则会为后续普通 Pero Agent 会话装配所选插件，不自动进入 App 会话。这与输入框的显式文本参考分开管理；其他 Agent 的文本上下文支持不等于原插件的执行兼容。停用/移除不能抹除已加载的模型上下文，已有会话仍绑定原快照。

```sh
npm ci --prefix apps/skills --ignore-scripts
npm --prefix apps/skills run check
node --test apps/skills/test/catalog.test.mjs
node scripts/build/apps.mjs --app skills
```

浏览器与真实 Host 接线的验收记录由 [Skills 市场验证](../../docs/fitness/skills-marketplace.md) 维护。静态目录、模拟模型、真实模型和 Native 窗口的验证范围分别记录。
