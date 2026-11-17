# 交接文档 · dsh-mcp-bridge

> **改名说明（后加）**：本文记录的是 2026-11-17 当时的实际操作，命令、路径与 MCP 名称均为当时的旧名 `dsh-mcp-bridge` / `dsh`。项目现已统一改名为 `codex-dsh-dispatch`，旧命令、旧登记、旧数据目录一律作废，需要按 [安装与接入](INSTALL.md) 的「从旧名升级」重做一次。本文的历史事实保持原样，未按新名改写。

本文保留 `63c6ca1` 实现完成、首次外部审查前的交接快照。当前接入方式、已完成的真实联调与使用方法以 [验收记录](ACCEPTANCE.md) 和 [安装与接入](INSTALL.md) 为准。

> 本文是写给**外部审查者**（如 ChatGPT）的独立交接材料：读完这一份就能理解项目是什么、做到哪一步、哪些结论有证据、哪些还是猜测、以及最该被挑毛病的地方在哪。
>
> 生成时间：2026-11-17。对应提交：`63c6ca1`（另有 3 处注释文案修正未提交）。
> 项目路径：`D:\code\dsh-mcp-bridge`。

---

## 1. 一句话定位

**把 DSH（DeepSeek Harness）的原生会话能力，包装成 MCP 工具，暴露给 Codex 等外部客户端。**

拓扑：

```
MCP 客户端（Codex / Claude Code / …）
   │  Streamable HTTP，仅回环 127.0.0.1
   ▼
DSH 宿主的 webServer（插件以路由形式挂载）
   │
   ├─ POST /mcp/dsh-mcp-bridge   ← MCP JSON-RPC 主通道（4 个工具）
   └─ GET|PUT /mcp/settings      ← 设置读写（供 TUI 与其它本机配置客户端）
   │
   ▼
本插件：认证围栏 → 工作区关联 → 会话归属 → 回合关联 → 结果投影
   │
   ▼
DSH 原生 Session Controller / 会话事件 / 权限预设 / 用户提问服务
```

**它不是一个独立服务**：没有自己的进程、不监听自己的端口、不持有模型密钥。它是 DSH 的一个插件，寄生在宿主的 HTTP 服务上。

---

## 2. 当前状态（最重要的一节）

### 2.1 已完成

| 阶段 | 状态 | 证据 |
|---|---|---|
| ① 契约与骨架 | ✅ | 51 个 `.ts`，依赖边界机械校验通过 |
| ② 回合归属与状态机 | ✅ | 六态可区分，`turn-missing` 显式报 `failed` |
| ③ 三层模型/强度 + 三档权限 | ✅ | 请求 > 桥接保存 > DSH 默认；`ask`/`auto`/`full` |
| ④ TUI 与交互路径 | ✅ | `dsh-mcp-bridge config` + `dsh_send.reply` 走原生 `answer` |
| ⑤ 真实联调 | ❌ **未开始** | 被宿主开关挡住，见 §7 |
| ⑥ 可安装交付 | ✅（文档侧） | `npm pack` 实测 109 文件 / 101.1 kB |

### 2.2 三条必须说清的事实

1. **插件从未被 DSH 真实加载过。** 所有验证都在离线环境完成：类型检查、构建、以及一个自建的 HTTP 冒烟脚本（把两条路由挂到裸 `node:http` 上跑真实 `fetch`）。
2. **从未接过真实 MCP 客户端。** 协议层行为（版本协商、`Accept` 分支、SSE）只按规范实现，没有与 Codex 实际握手过。
3. **因此不声称插件可用、不发布正式版本。** 这是 `docs/DEVELOPMENT.md` 第 10 节第 6 条的硬要求。

### 2.3 可复现的验证命令

```bash
npm install          # 只有 2 个 devDependency：typescript、@types/node
npm run typecheck    # = 边界校验 + tsc --noEmit
npm run build        # = tsc，产出 lib/
node .runtime/offline-http-smoke.mjs   # 29 项离线 HTTP 冒烟
npm pack --dry-run   # 发布清单
```

当前实测结果：

- `npm run typecheck` → `依赖规则校验通过（51 个文件）。` + tsc 0 错误
- `npm run build` → exit 0，`lib/` 产出 51 个 `.js` + 51 个 `.d.ts` + 102 个 `.map`
- 离线冒烟 → **29/29 通过**
- `npm pack --dry-run` → 109 files / package size 101.1 kB / unpacked 303.9 kB

---

## 3. 代码结构

```
src/
  index.ts            组装根：读 webServer 服务 → 装配 7 个端口 → 注册 2 条路由 → 挂 ctx.effect 清理
  transport/          HTTP 层：认证围栏、请求体读取、JSON/SSE 响应、两条路由的 handler
    auth.ts           回环判定 + Bearer 校验（timingSafeEqual）
    http.ts           MCP 路由：POST 分发、GET 405、DELETE 204、1 MiB 体上限
    settings-route.ts 设置路由：GET/PUT、64 KiB 体上限、405 带 allow 头
    route.ts          路由常量与类型
  mcp/                JSON-RPC 分派：手写，无 SDK
    dispatcher.ts     initialize / tools/list / tools/call 分派、版本协商表
    errors.ts         JSON-RPC 错误码 → 桥接错误码映射
    tools/            4 个工具的定义（name/title/description/inputSchema/run）
  app/                用例编排：每个工具一个文件
    start-task.ts     幂等回执 → 工作区 → 占用检查 → 权限解析 → 模型解析 → 建会话
    wait-task.ts      观测 → 状态解析 → 输出投影 → needsInput 载荷
    send-task.ts      text 走 prompt(queue) / reply 走 answer，基线不同
    cancel-task.ts    取消不继承 previous
    settings.ts       设置读写 + 校验
    deps.ts           AppDeps 容器、observeTask、assertNotBusy
  domain/             纯逻辑，不碰 node:*、不碰宿主
    types.ts          六态、TurnProgress、权限/模型视图
    status-resolver.ts 状态判定（唯一的判定入口）
    turn-attribution.ts 回合归属（T0+1）
    projection/output.ts 会话事件 → 文本增量（裁剪 + truncated）
    settings.ts       设置模型 + 快照构造
    model-choice.ts / permission-choice.ts  三层解析
    occupancy.ts / status.ts / errors.ts
  ports/              7 个端口接口（workspace / session / interaction / permission / model / settings / registry）
  host/               端口实现，唯一接触宿主形状的层（但零 import，见 ADR-009）
    host-types.ts     本地结构窄化声明（306 行，替代缺失的 .d.ts）
    session-adapter.ts / interaction-adapter.ts / registry-adapter.ts / ...
  tui/                进程外配置客户端（不在插件运行期依赖链上）
    state.ts / render.ts / client.ts / main.ts
bin/dsh-mcp-bridge.mjs  零依赖零构建的 CLI 入口
```

### 依赖方向（由 `scripts/check-boundaries.mjs` 机械强制）

```
index.ts（组装根）
  ├→ host/      （唯一可接触宿主 API 的层）
  ├→ transport/ → mcp/ → app/ → domain/ → ports/（最内层）
  └→ tui/ → domain/
```

规则要点：

- `domain/` 与 `ports/` **禁止** import `node:*`（D2）
- 全仓 **0 处** import `@deepseek-ai/*`（D1）
- `transport/` 不得 import `app/`（D5）——所以 handler 收的是 `DispatchFn` 回调，不是 `AppDeps`
- `tui/` 只能 import `domain/`（D8）

---

## 4. 对外契约

### 4.1 四个 MCP 工具

| 工具 | 必填 | 可选 |
|---|---|---|
| `dsh_start` | `cwd`（绝对路径）、`task`、`requestId` | `sourcePermission`（ask/auto/full）、`model`（provider/model 必成对，reasoningEffort 可省） |
| `dsh_wait` | `sessionId`、`requestId` | `cursor`（首次 -1 或省略）、`timeoutMs`（默认 30000） |
| `dsh_send` | `sessionId`、`requestId` | `text`、`reply`、`sourcePermission`（text 与 reply 严格互斥） |
| `dsh_cancel` | `sessionId` | — |

### 4.2 六态

`accepted` / `running` / `needs_input` / `completed` / `failed` / `cancelled`

只有 `completed` / `failed` / `cancelled` 是终态。`cancelled` **只能**由观察到 `turn/end.reason.kind === 'aborted'` 产生——`dsh_cancel` 的返回永远不报 `cancelled`，它只报「取消请求是否被接受」+ 当时的真实状态。

### 4.3 错误分界（这条最容易做错）

| 情形 | 返回 |
|---|---|
| 工具**根本没跑起来**（缺 `cwd`、`cwd` 非绝对路径、未知工具名、`requestId` 为空、`model` 只给一半） | JSON-RPC `-32602 INVALID_PARAMS` |
| 参数与当前环境不匹配（`model-unavailable`、`reasoning-effort-unavailable`、`saved-model-invalid`、`permission-unavailable`） | 也是 `-32602` |
| 工具**跑起来但业务失败**（`workspace-busy`、`session-not-found`、`turn-missing`、`wait-timeout`、`host-capability-missing`、`internal`） | HTTP 200 + `result.isError = true` |
| 压根不是合法 JSON-RPC（非对象、`jsonrpc` 不是 `"2.0"`、`method` 非字符串） | `-32600` |

### 4.4 设置路由

`GET /mcp/settings` 返回快照（`connection` / `providers` / `dshDefault` / `permissions` / `initialPermission` / `saved`）；`PUT` 写入。两者与 MCP 路由**共用同一套认证围栏**（回环 + Bearer），文案一致。

---

## 5. 关键设计决策（挑最容易被质疑的几条）

### ADR-001：手写 JSON-RPC 分派，不用 MCP SDK

**理由**：宿主 asar 内的 `@modelcontextprotocol/core@2.2.0`，其 `dist` 只有 10 KB 且全是 zod 常量，**没有** `McpServer` / `StreamableHTTPServerTransport`。装一个外部 SDK 会引入依赖树，与「插件零运行时依赖」的目标冲突。

**代价**：协议层要自己保证正确性。已覆盖 `initialize` 版本协商（5 个版本的回退表）、`notifications/initialized` 无响应、`tools/list` 省略 `nextCursor`、`tools/call` 的 `isError` 分支、`Accept` 双分支、`GET` 405、`DELETE` 204。**未做**：服务端主动通知、`Mcp-Session-Id` 分配。

### ADR-002：载体是 `ctx.webServer.register(route)`

宿主 `NextWebServer.register()` 返回一个注销函数，handler 可以长挂（这是将来做 SSE 的前提）。**但它在路由匹配之前有一道围栏**——见 §7。

### ADR-005：`requestId` 直接透传给宿主，不自建去重表

宿主 `prompt()` 首行就检查 `hasPromptRequest(rpcId)`，天然幂等。桥接自建一份去重表会在插件重载后与宿主不一致（两份事实源必然漂移）。桥接只额外保证「同一 requestId 不重复推进回合基线」。

### ADR-007：占用判定从原生状态投影，不维护锁表

遍历登记表，同 `canonicalCwd` 且 `readState().running === true` 即判占用。**不建文件锁、不建全局互斥表**——否则用户在 DSH 里自己改同一目录的文件会被插件拦住（R4）。

### ADR-009：宿主 API 用本地结构窄化声明，不 import 宿主类型

宿主包**没有 `.d.ts`**（全是打包后的 `.js`）。所以 `src/host/host-types.ts` 手写了 306 行结构声明，连 `Context` 都不 import。代价是宿主接口变化时**编译器不会报错**，只能靠运行期发现。

### ADR-010：`needs_input` 的唯一读法是已废弃的 API

宿主的 `sessionProjections.stateOf(session, 'userQuestions')` 已标 `@deprecated`，但它是唯一能拿到 `callId` 的路径。运行期会触发宿主的 `logger.warn`，**属预期日志，不是故障**。

### 关键取舍：`reply` 的回合基线要退一格

| | `text` | `reply` |
|---|---|---|
| 宿主调用 | `prompt({ mode: 'queue' })` | `userQuestions.answer(agent, callId, answer)` |
| 回合效果 | 当前回合结束后**新开**一个 | 作为 steering 消息塞进**当前开放的回合** |
| 归属基线 | `lastTurn`（目标 = `lastTurn + 1`） | `lastTurn - 1`（目标就是开放回合 `lastTurn`） |

混用会让 `expectedTurn` 永远等不到，任务卡在 `accepted`。这是**已实测抓到并修掉的真实缺陷**（离线冒烟发现的）。

另：`answer` 返回 `false` 必须报错。宿主对「`callId` 已不在 `continued` 态」返回 `false` 而非抛错；若当成功处理，客户端会以为回答送达，而模型永远等不到。

---

## 6. 未验证项（U2–U12）

这些**没有证据**，不要当成已通过。

| 编号 | 内容 | 影响 |
|---|---|---|
| U2 | 插件能被 DSH 真实加载 | 整个项目的前提，未验证 |
| U3 | 真实 MCP 客户端的版本协商与 SSE | Codex 能否连上，未验证 |
| U5 | 宿主 `wait` 在真实会话下的表现 | 尤其「等待期内一次状态都没拿到就抛 `session/wait-timeout`」的触发条件未知；`wait-task.ts` 把它降级成「退回一次普通观测」正依赖这一点 |
| U6 | `stateOf(session, 'userQuestions')` 的实际返回形状 | `needs_input` 的 `callId` 能不能读到 |
| U7 | `permissionPresets.current()` 与 `modelSelection` 投影回读 | 第 1 阶段刻意不回读（`currentSelection` 恒 `null`） |
| U8 | `workspaceRegistry.create` 的 `created` 判定 | 宿主未暴露该标志，用 `list().length` 前后差推断；并发注册同一路径可能误判。影响仅限返回值 |
| U9 | 设置路由在真实实例上的读写 | 被 §7 的围栏挡住 |
| U10 | TUI 在真实终端里的交互 | 只跑过 `--help` 与错误路径 |
| U11 | `reply` 走原生 `answer` 的真实行为 | 需要一次真实挂起的 `ask_user_question` |
| U12 | `reply` 基线退一格是否总能匹配 | 依赖宿主的 steering 行为 |

**已解除**：U1（类型正确性，`tsc --noEmit` 0 错误）、U4（`locale`/`icon.svg` 元数据）。

---

## 7. 硬前置：DSH 桌面端的 Browser access 围栏

**这是当前唯一的阻塞项，且不是插件缺陷。**

### 现象

```bash
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:7275/mcp/settings
# → 403
# body: Browser access is disabled
```

带不带 `Authorization: Bearer` 都一样。`/mcp/dsh-mcp-bridge` 与任意不存在的路径（如 `/mcp/nonexistent-xyz`）**同样 403**。

### 机制（已从宿主 asar 内逐层核实）

1. `lib/webserver.js` 的 `NextWebServer.register(route)` 返回 `super.register(wrapRegistration(route, this.policy(route.path)))`。
2. `policy()` 里的 handler 第一步就是 `if (!this.permits(request)) { writeHead(403); end("Browser access is disabled"); return }`——**围栏在路由匹配之前**。
3. `permits(request)` = `decideDesktopBrowserAccess(access, request) !== "denied"`。
4. `lib/desktop-browser-access-*.js` 的判定：
   - 请求头 `x-dsh-desktop-renderer` 等于宿主本次启动随机生成的 token → `"renderer"`（放行）
   - 否则若 `ordinaryBrowserEnabled === false` → `"denied"`
   - 否则 → `"browser"`（放行）
5. `lib/desktop-contract-*.js` 的 `DEFAULT_PREFERENCES` 与 `SAFE_MODE_PREFERENCES` 里 **`browserAccess: false`**。
6. `lib/host.js:220` 调 `configureNextBrowserAccess(process.env.DSH_NEXT_NATIVE_TOKEN, preferences.browserAccess)`，随后 `delete process.env.DSH_NEXT_NATIVE_TOKEN`。
7. 偏好持久化在 `~/.dsh/desktop-preferences.json`。**本机该文件不存在**，即当前用的是 `DEFAULT_PREFERENCES`（`browserAccess: false`）。

### 结论

- 默认配置下，**任何外部 MCP 客户端（含 Codex）的请求在到达插件之前就被 403**。
- 第 ⑤ 步联调前，必须由用户在 DSH 桌面端设置里打开「允许浏览器访问」并重启 DSH。
- **插件不得绕过**：不伪造 `x-dsh-desktop-renderer` 头、不改宿主偏好文件、不自起 HTTP 服务。`src/tui/client.ts` 的 `describeFailure` 已专门识别这条 403 并给出可执行指引。

---

## 8. 已知风险（R1–R10 摘要）

| 编号 | 风险 | 状态 |
|---|---|---|
| R1 | 回合归属误判为完成（把 `running === false` 当完成） | 已缓解：强制走 `turnBoundary` 归属判定 |
| R2 | 输出投影把事件当文本（token 爆掉） | 已缓解：只投影文本增量 + 工具摘要，双重裁剪 |
| R3 | 权限「自动审查」被重复注册（插件起不来） | 已规避：只消费 `auto`，不注册 |
| R4 | 串行占用锁住用户 | 已规避：占用只从状态投影判定，不建锁表 |
| R5 | 插件重载后归属关系丢失 | 已缓解：`baselineTurn` 等落盘到 `state.json` |
| R6 | MCP 版本协商与 `Accept` 分支覆盖不全 | 已实现，**未与真实客户端验证**（U3） |
| R7 | Node 版本错配 | 已实测：系统 node v22.19.0 与宿主 electron-node v24.21.0 都满足 `engines` |
| R8 | 契约冻结过早 | 已缓解：`source` 是开放枚举，只增不改 |
| R9 | 回合进展分页上限导致漏判 → 误报 `failed` | **已缓解**：`TurnProgress.truncated` 全链路，窗口耗尽时不判 `turn-missing` |
| R10 | `needs_input` 是「只能看见、不能回答」的死路 | **已解**：`InteractionPort.answer` + `reply` 均落地 |

### 一个仍开放的具体疑问（值得审查者重点看）

`docs/REVIEW.md` 第 352 行记着：宿主 `answer` 只服务 `state === 'continued'` 的提问，`open` 态调用返回 `false`。**桥接目前只报 `callId`，不区分 `open` / `continued`**——客户端可能在 `open` 阶段就尝试 `reply`，然后拿到 `not-pending`。

如果这个判断成立，`needsInput` 需要增加 `state: 'open' | 'continued'` 字段。**这一点必须在第 ⑤ 步联调时首先确认。**

---

## 9. 持久化

两个文件，都在 `$DSH_HOME/dsh-mcp-bridge/`（`$DSH_HOME` 缺省为 `~/.dsh`）：

| 文件 | 内容 | 容错 |
|---|---|---|
| `state.json` | 会话归属登记表：`workspaceId` / `canonicalCwd` / `lastRequestId` / `lastSourcePermission` / `baselineTurn` / `baselineCursor` | 损坏按空表处理并告警，不阻断加载 |
| `settings.json` | 桥接保存的默认模型/强度/权限（`version: 2`） | **逐字段校验，坏一项只丢一项**，不丢整个文件 |

两者都是 `.tmp` → `rename` 原子写，读写串行化。

**刻意不做内存缓存**：缓存会让「用户手工编辑 `settings.json`」永远不生效，也会让「文件损坏降级」路径实际不可达。这一点是离线冒烟抓到的真实缺陷（测试假通过）。

---

## 10. 发布元数据

```jsonc
// package.json 关键字段
{
  "main": "./lib/index.js",
  "types": "./lib/index.d.ts",
  "bin": { "dsh-mcp-bridge": "./bin/dsh-mcp-bridge.mjs" },
  "icon": "./icon.svg",
  "files": ["lib", "!lib/**/*.map", "bin", "locale", "icon.svg", "cordis.patch.yml", "README.md"],
  "engines": { "node": "^22.19.0 || >=24.9.0", "dsh": ">=0.2.0-rc.1 <0.3.0-0" },
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } },
  "peerDependencies": { /* 5 条 @deepseek-ai/*，全 optional */ }
}
```

### `engines.dsh` 的机制（已从宿主 asar 内核实）

宿主 `@deepseek-ai/dsh-app-boot/lib/index.js:1075-1180` 有 `evaluatePluginCompatibility()`：

- **若 manifest 自带 `engines.dsh`，它单独决定，`peerDependencies` 被完全忽略。**
- 否则回落遍历 `peerDependencies`，只检查名字等于 `@deepseek-ai/dsh` 或以 `@deepseek-ai/dsh-` 开头的项。
- 两侧都用 `semver.satisfies(runtimeVersion, range, { includePrerelease: true })`——**`includePrerelease: true` 是关键**，预发布版本参与匹配。
- `runtimeVersion` 取 app-boot 自身 `package.json` 的 `version`，本机为 **`0.2.2-rc.3`**。
- 不满足时宿主给兼容性警告，并提示可用 `dsh plugin allow-version` 或 exact-version exemption。

本项目 `engines.dsh` 与 5 条 peer 范围**完全一致**（`>=0.2.0-rc.1 <0.3.0-0`），实测对 `0.2.2-rc.3` 全部 `satisfies === true`。

---

## 11. 给审查者的具体问题清单

按优先级排列。**请重点挑这些地方的毛病**，其余部分可以略读。

### 高优先级

1. **回合归属的正确性**（`src/domain/turn-attribution.ts` + `status-resolver.ts`）
   - 判据是「对应回合 = `baselineTurn + 1`」，`startedTurn >= turn` 即认为本请求的回合已开始。
   - `reply` 走 `baselineTurn - 1`（因为答案塞进**当前开放**的回合）。
   - **问**：这套判定在「上一轮刚结束、新一轮还没开始」的窗口里会不会误判？`truncated === true` 时一律不判 `turn-missing`，会不会导致永久卡在 `running`？

2. **`reply` 的基线退一格是否总能匹配**（U12）
   - 依赖「答案作为 steering 消息塞进当前开放回合」这一宿主行为。
   - **问**：如果宿主在 `answer` 之后并没有真正开启/推进回合，`expectedTurn` 会永远等不到吗？桥接有没有兜底？

3. **`needs_input` 的 `open` / `continued` 状态缺失**（§8 末）
   - **问**：这个缺陷有多严重？是否必须在联调前修掉？

### 中优先级

4. **`-32602` 与 `isError` 的分界是否合理**（§4.3）
   - 现在把 `model-unavailable` 等四个码归到 `-32602`，理由是「参数与环境不匹配，换参数才能继续」。
   - **问**：这个归类对 MCP 客户端友好吗？客户端通常把 `-32602` 当「调用方 bug」而把 `isError` 当「业务失败」，这样分会不会让客户端误判？

5. **`ModelPort.currentSelection` 恒返回 `null`**（`src/host/model-adapter.ts`）
   - 宿主没有「读会话当前模型」的直接方法，模型选择记在会话日志 `request/header` 事件的 `config` 里，读它要走历史分页。
   - 后果：`dsh_send` 的返回体**不含 `model` 字段**。
   - **问**：这个取舍合理吗？还是应该走历史分页读回来？

6. **`TurnProgress.truncated` 的兜底策略**
   - 窗口耗尽（200 条/页 × 5 页 = 1000 条消息）时不判 `turn-missing`，宁可继续报 `running`/`accepted`。
   - **问**：误报 `failed` 与「长会话下永久 `running`」，哪个更糟？有没有第三条路（比如把窗口耗尽转成可重试的 `internal`）？

### 低优先级

7. **`workspaceRegistry.create` 的 `created` 判定**（U8）：用 `list().length` 前后差推断，并发注册同一路径可能误判。
8. **手写 JSON-RPC 分派的协议正确性**：没有 SDK 兜底，`initialize` 版本协商、`Accept` 分支、`notifications/*` 无响应这几处的实现是否符合规范？
9. **`src/host/host-types.ts` 的 306 行手写声明**：宿主接口变化时编译器不会报错，有没有办法加一层运行期断言？

---

## 12. 不该做的事（已经明确排除）

- ❌ 不要为了「让联调跑通」而绕过 Browser access 围栏（伪造头、改宿主偏好、自起 HTTP）。
- ❌ 不要把 `reply` 降级成普通 prompt 发送——那会让客户端以为回答送达，而模型永远等不到。
- ❌ 不要在 `auto` 权限不可用时静默降级成 `full`——放宽权限是安全事故。
- ❌ 不要把「读不到」当成「不存在」（模型目录读失败时跳过校验，而不是判所有模型无效）。
- ❌ 不要声称插件可用，直到 §7 的围栏打开并且真实闭环跑通。

---

## 13. 相关文档索引

| 文档 | 行数 | 内容 |
|---|---|---|
| `docs/DEVELOPMENT.md` | 222 | **需求与验收标准的源头**。六步开发顺序 + 六条验收行为 |
| `docs/ARCHITECTURE.md` | 848 | 分层、依赖规则、端口契约、对外契约、状态机、11 条 ADR |
| `docs/REVIEW.md` | 393 | 一致性评审、51 个文件逐条核对、R1–R10 风险、阶段衔接 |
| `docs/IMPLEMENTATION.md` | 365 | 实现说明、D-1…D-13 决策、与设计文档的 4 处偏差 |
| `docs/INSTALL.md` | 397 | 安装/卸载/Codex 接入/browserAccess 前置/支持版本/常见问题 |
| `README.md` | 51 | 项目简介、当前状态、快速上手 |

**读的顺序建议**：本文 → `docs/DEVELOPMENT.md`（需求）→ `docs/ARCHITECTURE.md` 第 5 节（契约）→ `docs/REVIEW.md` 第 2 节（风险）。`docs/IMPLEMENTATION.md` 与 `docs/INSTALL.md` 可按需查。
