---
kind: analysis
date: 2026-11-13
github_issue: 219
github_state: open
github_url: https://github.com/phodal/pero/issues/219
---

# 架构参考：Pero 自有执行机与远程 Agent

## 潜在架构图

“已有”表示现有代码底座，不代表线上端到端验收。首版保留执行机上的 ACP Agent loop；虚线表示拟接入或后续扩展。

```mermaid
flowchart TB
    UI["Web / Desktop<br/>选择机器 · 提交任务 · 查看进度 · 取消"]

    subgraph CLOUD["线上控制面 · app.openpero.com"]
        API["已有：身份与项目授权<br/>拟新增：用户创建任务"]
        RUN["已有：Task / Run<br/>分派 · 租约 · 事件 · 取消"]
        PRESENCE["拟新增：机器状态<br/>最近联络 · 占用 · 可用能力"]
        CHAT["后续：持续会话<br/>消息 · Follow-up · Run 关联"]
        DB[("已有：PostgreSQL")]
        ART["后续：通用 Run 产物<br/>上传 · 下载 · 预览"]
        RELAY["后续：远程访问中继"]

        API --> RUN
        API --> PRESENCE
        RUN --> DB
        PRESENCE --> DB
        CHAT -.-> RUN
        CHAT -.-> DB
        ART -.-> DB
    end

    subgraph MACHINE["获准执行机 · Mac / Linux / 实验室服务器 / VM"]
        CONFIG["本机准入配置<br/>工作区 · Agent · 授权策略"]
        WORKER["已有：pero-worker<br/>Journal · 续租 · 取消 · 中断对账"]
        ACP["已有：ACP Harness<br/>Agent loop · 工具调用"]
        TOOLS["获准资源与工具<br/>文件 · Shell · Python · GPU · MCP"]
        ACCESS["后续：远程访问适配器<br/>文件 / 终端 / 端口 / 桌面"]

        CONFIG --> WORKER
        WORKER --> ACP
        ACP --> TOOLS
    end

    MODEL["配置的模型服务"]
    STORE[("后续：对象存储")]

    UI --> API
    RUN -->|"状态与事件"| UI
    WORKER <-->|"Worker 主动外连 HTTPS<br/>领取 · 续约 · 事件 · 取消状态"| RUN
    WORKER -.->|"状态上报"| PRESENCE
    UI -.-> CHAT
    ACP <-->|"模型请求与响应"| MODEL
    WORKER -.->|"仅上传获准产物"| ART
    ART -.-> STORE
    ART -.->|"下载与预览"| UI
    UI -.-> RELAY
    ACCESS <-.->|"执行机主动建立出站通道"| RELAY
```

Cloud 拥有项目授权、Run 与租约；执行机拥有本机准入、进程与工具执行。在线观察不授予执行权限；科研数据按授权保留在执行侧，执行完成、独立验证与结果接受分别记录。

## 参考架构

### Cursor Self-Hosted Machines

```mermaid
flowchart TB
    UI["Cursor Web / Desktop / Mobile"] <-->|"创建会话 · 续聊 · 事件"| CLOUD["Cursor Cloud<br/>Agent loop · 推理 · 规划"]
    MANAGER["Desktop Worker 管理器<br/>安装 CLI · 派生身份 · 启动 / 接管"] --> WORKER

    subgraph HOST["用户管理的机器"]
        WORKER["独立 Agent CLI Worker"]
        EXEC["ExecManager<br/>文件 · Shell · MCP · Computer Use"]
        SERVER["cursor-server<br/>127.0.0.1"]
        DESKTOP["桌面服务<br/>RFB"]
        WORKER --> EXEC
        WORKER --> SERVER
        WORKER --> DESKTOP
    end

    WORKER <-->|"主动出站 HTTP/2<br/>Connect：工具 RPC"| CLOUD
    UI <-->|"远程工作区 / 桌面"| RELAY["Cursor Relay"]
    WORKER <-.->|"CursorServerStream"| RELAY
    WORKER <-.->|"DesktopStream"| RELAY
```

- [Self-Hosted Machines](https://cursor.com/docs/cloud-agent/self-hosted)
- [My Machines](https://cursor.com/docs/cloud-agent/self-hosted/my-machines)
- [Team Pools](https://cursor.com/docs/cloud-agent/self-hosted/pool)
- [Computer Use / Desktop Sharing](https://cursor.com/docs/cloud-agent/self-hosted/computer-use)

本机静态参考：Cursor 3.30.8，应用 commit `4a44c846d0b817fab060823f93c63ea2861ac190`；应用下载的 Agent CLI 为 `2026.11.11-b912975`。主要实现位置为 `molten/dist/engine/engine.cjs`（SelfHostedWorkers、CloudRemoteMachines、CloudFollowUps）、CLI 的 `connect-pool-worker.js`（Connect / ExecManager / CursorServerStream / DesktopStream）、`cursor-resolver` 与 `pty-host`。这些是静态实现依据，未执行 Worker 或验证账户功能开关。

### Pero 现有架构

- [ADR 0002：远程任务分派与执行权威](https://github.com/phodal/pero/blob/c4f4ecdaf85b0a23dc3b04e1581bd680bba67b23/docs/adr/0002-remote-task-dispatch.md)
- [ADR 0010：Desktop Worker 设备注册](https://github.com/phodal/pero/blob/c4f4ecdaf85b0a23dc3b04e1581bd680bba67b23/docs/adr/0010-desktop-worker-enrollment.md)
- [独立 Worker 与本机准入](https://github.com/phodal/pero/blob/c4f4ecdaf85b0a23dc3b04e1581bd680bba67b23/crates/pero-worker/README.md)
- [ADR 0018：受信 Worker 与 Agent Sandbox](https://github.com/phodal/pero/blob/c4f4ecdaf85b0a23dc3b04e1581bd680bba67b23/docs/adr/0018-agent-sandbox-runtime.md)

