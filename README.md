# dsh-mcp-bridge

让 Codex 等 MCP 客户端委派任务给 DeepSeek Harness（DSH），等待执行结果，并在原 DSH 会话中继续沟通和返工。

目标工作方式：**GPT 规划与审查，DSH 原生执行，MCP 传递任务与反馈。** 不再手动复制两边的会话，也不把 DeepSeek 当作 Codex 原生子代理运行。

```text
Codex / 其他 MCP 客户端
          ↕ Streamable HTTP MCP（本机）
   dsh-mcp-bridge（DSH 插件）
          ↕ DSH 原生会话服务
   DSH 会话、模型、工具与执行循环
```

## 当前状态

**代码已完成，尚未联调。**

- 插件本体（`src/` 51 个 `.ts`）与进程外配置客户端（`dsh-mcp-bridge config`）均已落盘：四个任务工具 `dsh_start` / `dsh_wait` / `dsh_send` / `dsh_cancel`、六态状态机、设置读写路由 `/mcp/settings`、TUI 与 CLI 入口。
- `npm run typecheck`（依赖边界校验 + `tsc --noEmit`）与 `npm run build` 双绿；离线冒烟 5 组共 89 项通过（协议分派、错误码分界、传输层状态码、六态映射、回合归属、输出裁剪、权限三层解析）。
- **但插件从未被 DSH 真实加载过，也从未接过真实 MCP 客户端。** 按开发文档第 10 节第 6 条，真实闭环通过前不声称插件可用、不发布正式版本。

下一步是获授权联调（第 ⑤ 步）。联调有两个硬前置：DSH 桌面端设置里打开「允许浏览器访问」（默认关闭，关闭时请求在到达插件之前就被 `403` 拦下），以及启动 DSH 前设置 `DSH_MCP_BRIDGE_TOKEN`。逐条未验证项见 [安装与接入](docs/INSTALL.md) 第 7 节。

## 安装与快速上手

```bash
npm install && npm run typecheck && npm run build
```

把插件目录放进 `~/.dsh/profiles/desktop/node_modules/dsh-mcp-bridge/`，把 `dsh-mcp-bridge` 加进该 profile `package.json` 的 `dsh.profile.bundles`，设好 `DSH_MCP_BRIDGE_TOKEN`，重启 DSH。Codex 侧在 `~/.codex/config.toml` 加一张 `[mcp_servers.dsh_bridge]` 表，用 `bearer_token_env_var` 引用同一个环境变量。

完整步骤、卸载与排查见 [安装与接入](docs/INSTALL.md)；设置界面用 `dsh-mcp-bridge config`。

## 第一版目标

- 创建专用 DSH 会话并提交任务。
- 首次派单时按实际工作目录复用或注册 DSH 工作区，同项目的不同 Codex 对话使用各自的 DSH 会话。
- 提供 FastCtx 式终端设置界面，从 DSH 获取模型与思考强度，保存仅供桥接新会话使用的默认值。
- 同步当前 Codex 对话的“请求批准 / 帮我批准 / 完全访问”三档权限；获取不到时使用设置中的默认权限。
- 等待对应回合完成、失败或请求输入，获取增量输出。
- 在同一会话里补充信息、提出修改和返工。
- 显式取消任务，不因等待超时而重复派单。

第一版先串行完成一个工作目录中的任务；Codex 审查期间，DSH 不再同时修改同一处代码。

未设置桥接模型默认值时跟随 DSH 默认设置；修改默认值不覆盖已有会话，用户仍可在 DSH 中手动调整。设置入口为 `dsh-mcp-bridge config`（已实现，见 [安装与接入](docs/INSTALL.md)）。

实现方向、工作区关联、默认值与权限规则、拟定接口及开发顺序见 [开发文档](docs/DEVELOPMENT.md)；安装、Codex 接入、卸载与排查见 [安装与接入](docs/INSTALL.md)。

分层边界、模块依赖规则、MCP 工具面契约与架构决策见 [架构落地清单](docs/ARCHITECTURE.md)；一致性评审、风险与阶段衔接见 [架构评审](docs/REVIEW.md)；第 1 阶段的模块划分、数据流、错误处理策略、关键取舍与未验证项见 [实现说明](docs/IMPLEMENTATION.md)。
