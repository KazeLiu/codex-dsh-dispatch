# 本机接入验收

> **改名说明（后加）**：本文记录的是 2026-11-17 当时的实际操作，命令、路径与 MCP 名称均为当时的旧名 `dsh-mcp-bridge` / `dsh`。项目现已统一改名为 `codex-dsh-dispatch`，旧命令、旧登记、旧数据目录一律作废，需要按 [安装与接入](INSTALL.md) 的「从旧名升级」重做一次。本文的历史事实保持原样，未按新名改写。

日期：2026-11-17。环境：DSH Desktop 2.0.23-next / DSH 服务 0.2.2-rc.3，Node.js 22.19.0。

## 实际完成的操作

- 用户通过 DSH 桌面插件管理界面安装并启用本地项目。desktop Profile 中的模块链接指向 `D:\code\dsh-mcp-bridge`。
- 插件发布独立的本机回环入口，模型目录和设置接口可访问；无需开启 DSH 的浏览器访问。
- 官方 MCP SDK 客户端通过 `bin/dsh-mcp-bridge.mjs mcp` 的 stdio 代理完成握手，列出四个工具并调用 start/wait。
- Codex 用户配置已登记启用的 `dsh` stdio MCP；启动命令已通过 `codex mcp get dsh` 核对。当前 Codex 对话尚未通过宿主工具清单直接调用这四个新工具。

## low 强度的真实会话

| 项 | 实际结果 |
| --- | --- |
| 工作目录 | `D:\code\dsh-mcp-bridge` |
| 工作区 ID | `30fc6e65-15fa-44ee-9878-093ba72770ac` |
| DSH 会话 ID | `session-8c7682c6-b1a7-4c61-af0f-5c6bc8f6e594` |
| 请求 ID | `codex-acceptance-20261117-low-01` |
| 模型 | `cpr / deepseek-v4.1-flash` |
| 实际回读的思考强度 | `low` |
| 问题 | `1+1等于几？只输出计算结果，不读取或修改文件，不调用任何工具。` |
| 助手原文 | `2` |
| 终态 | `completed`，原生回合 1 的结束原因为 `completed` |
| 输出游标 | `20`，助手文本事件序号 `18` |

同一创建请求再次发送，返回相同会话 ID 和 `completed`，未新建第二个任务。用不存在的请求 ID 等待该会话时，明确返回 `-32602`，没有拿最新请求结果替代。

DSH 全局默认模型仍为 `cpr / deepseek-v4.1-flash`，思考强度仍为 `high`。本次会话的 `low` 未写入全局默认值。

## CMD 设置界面

实际从 `cmd /d /c dsh-mcp-bridge config` 启动，完成了模型下拉的名称筛选、选择 `cpr / deepseek-v4.1-flash`、打开强度列表选择 `low`、保存和退出。

保存后通过真实设置接口回读得到模型和 `low`，DSH 全局强度仍为 `high`。验证结束后仅将本次临时保存的桥接默认值恢复为原有的 `model=null, permission=null`，即模型强度跟随 DSH，未知源权限时使用请求批准。用户可按安装文档自行固定默认值。

## 检查与剩余验证范围

当前源码的 `npm run typecheck` 和 `npm run build` 通过。没有新增测试用例。

本次真实验证覆盖接入、创建、等待、配置回读、创建请求重放、错误请求拒绝、模型目录及 CMD 默认值保存。完整的人工提问/审批回复、执行中取消、插件重载后的恢复以及同目录并发写入尚未进行真实联调；早期 `.runtime/offline-http-smoke.mjs` 针对旧的网页路由实现，不作为当前传输的验收证据。
