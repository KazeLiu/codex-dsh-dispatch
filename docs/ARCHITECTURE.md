# 架构落地清单（第 1 阶段）

本文把 `docs/DEVELOPMENT.md` 的设计意图落成可执行的目录、依赖规则与对外契约。
凡是与已安装 DSH（`dsh-desktop-next@2.0.23-next`，核心包 `0.2.2-rc.3`）实际 API 不一致的地方，以本文标注的**实测事实**为准，并已回写为约束。

## 1. 分层

依赖方向只能由外向内，内层对上层零感知。

```text
┌─ 组装根 ──────────────────────────────────────────────┐
│ src/index.ts        apply(ctx, config) 与全部装配      │
└───────────┬───────────────────────────┬───────────────┘
            │                           │
   ┌────────▼────────┐        ┌─────────▼─────────┐
   │ src/host/       │        │ src/transport/    │
   │ 宿主适配        │        │ HTTP / SSE / 认证 │
   │ 唯一可用        │        └─────────┬─────────┘
   │ @deepseek-ai/*  │                  │
   └────────┬────────┘        ┌─────────▼─────────┐
            │                 │ src/mcp/          │
            │                 │ JSON-RPC + 工具面 │
            │                 └─────────┬─────────┘
            │                 ┌─────────▼─────────┐
            │                 │ src/app/          │
            │                 │ 用例编排          │
            │                 └─────────┬─────────┘
            │                 ┌─────────▼─────────┐
            │                 │ src/domain/       │
            │                 │ 纯逻辑（无 IO）   │
            │                 └─────────┬─────────┘
            └────────────────►┌─────────▼─────────┐
                              │ src/ports/        │
                              │ 接口定义（最内层）│
                              └───────────────────┘
```

| 层 | 目录 | 职责 | 允许依赖 |
|---|---|---|---|
| 组装根 | `src/index.ts` | 读配置、构造适配器、注册路由与工具、返回清理函数 | 全部 |
| 宿主适配 | `src/host/` | 把 DSH 服务包成端口实现；唯一 `import '@deepseek-ai/*'` 处 | `ports/`、`domain/` 的类型 |
| 传输 | `src/transport/` | 路由注册、回环与认证围栏、JSON-RPC 帧、SSE 生命周期 | `mcp/` |
| 协议 | `src/mcp/` | 工具定义与参数校验、`tools/list`/`tools/call` 分派、结果与错误投影 | `app/`、`domain/` |
| 应用 | `src/app/` | 四个用例：start / wait / send / cancel | `domain/`、`ports/` |
| 领域 | `src/domain/` | 状态机、回合归属、权限映射、模型三层解析、串行占用判定 | 无（纯 TS） |
| 端口 | `src/ports/` | 宿主能力的接口声明 | 无 |

**为什么是这五层而不是更多**：每一层都对应一个真实的可替换缝——宿主 API 会随 DSH 版本漂移（隔离在 `host/`）、传输协议将来可能要加 stdio（隔离在 `transport/`）、JSON-RPC 帧与工具语义是两件事（隔离在 `mcp/`）、状态机是最容易出错且最需要脱离 DSH 单测的部分（隔离在 `domain/`）。再往下拆（如独立 `service/`、`repository/`）在第 1 阶段没有第二个实现，属于过早抽象。

## 2. 目录清单

```text
src/
  index.ts                    # apply()：装配根，注册两条路由并返回清理函数
  host/
    host-types.ts             # 宿主 API 的结构窄化声明（只声明实际用到的成员，见 ADR-009）
    context.ts                # ctx 服务门面，可选服务用 ctx.get() 惰性读取
    workspace-adapter.ts      # WorkspacePort 实现
    session-adapter.ts        # SessionPort 实现（create/prompt/wait/cancel/state/readProgress）
    interaction-adapter.ts    # InteractionPort 实现（pendingInput 只读 + answer 回答提问）
    permission-adapter.ts     # PermissionPort 实现（第 1 阶段即需：提交首条任务前要应用权限）
    model-adapter.ts          # ModelPort 实现（第 1 阶段即需：提交首条任务前要应用模型）
    registry-adapter.ts       # SessionRegistryPort 实现（$DSH_HOME 下的最小归属表）
    settings-adapter.ts       # SettingsPort 实现（$DSH_HOME/dsh-mcp-bridge/settings.json）
  ports/
    workspace-port.ts
    session-port.ts
    interaction-port.ts
    permission-port.ts
    model-port.ts
    registry-port.ts          # 会话归属登记（$DSH_HOME/dsh-mcp-bridge/state.json）
    settings-port.ts          # 桥接默认值持久化（$DSH_HOME/dsh-mcp-bridge/settings.json）
    index.ts                  # 端口聚合类型，供装配根引用
  domain/
    types.ts                  # 六态、视图、快照、输出记录等纯类型
    errors.ts                 # BridgeError 与 12 个固定错误码
    settings.ts               # 设置快照/更新形状 + 持久化模型 + 纯解析函数
    status.ts                 # TaskStatus 六态与迁移合法性
    turn-attribution.ts       # 请求 ↔ 回合归属判定
    status-resolver.ts        # 原生事实 → 六态
    occupancy.ts              # 规范化 cwd 的串行占用判定
    permission-map.ts         # ask/auto/full ↔ 原生预设 ID
    permission-choice.ts      # 权限三层解析（源会话 → 桥接默认 → 初始值）
    model-choice.ts           # 三层模型解析
    projection/
      output.ts               # 会话事件 → 可读增量文本
  app/
    deps.ts                   # 用例层依赖聚合（ports + observed 观察缓存 + started 回执）
    start-task.ts
    wait-task.ts
    send-task.ts              # text 走 prompt；reply 走原生 answer（基线不同，见 6.2）
    cancel-task.ts
    settings.ts               # 读/写设置快照（含失效判定）
  mcp/
    dispatcher.ts             # JSON-RPC 方法分派（initialize/tools/list/tools/call/...）
    errors.ts                 # 桥接错误码 ↔ JSON-RPC / CallToolResult
    tools/
      index.ts                # 工具注册表
      dsh-start.ts
      dsh-wait.ts
      dsh-send.ts
      dsh-cancel.ts
  transport/
    route.ts                  # WebRoute 本地结构化声明 + 两条路由路径常量（不 import 宿主包）
    auth.ts                   # 回环判定 + 客户端凭据校验
    http.ts                   # POST 处理、SSE 长挂、请求体上限
    settings-route.ts         # GET/PUT /mcp/settings（REST，复用 auth 围栏，见 5.8）
  tui/
    state.ts                  # 纯状态机（草稿、失效标记、脏判定）
    render.ts                 # 纯字符串渲染（CJK 双宽对齐，无第三方依赖）
    client.ts                 # 本机认证通道的 HTTP 客户端（凭据只从环境读）
    main.ts                   # 行命令主循环（跨 Windows shell 一致）
bin/
  dsh-mcp-bridge.mjs          # CLI 入口（零依赖、零构建，动态 import lib/tui/main.js）
locale/
  en.json                     # 插件元数据（meta.title / meta.description），宿主插件列表显示用
  zh.json                     # 同上，简体中文
icon.svg                      # 插件图标（宿主插件详情页显示用）
cordis.patch.yml              # 把插件挂进 cordis 树；id 必须等于 src/index.ts 的 export const name
package.json
```

第 1 阶段**不建**：`src/config/`、`src/cli/`。第 ④ 步的落地形态与原计划不同：设置持久化走 `src/domain/settings.ts` + `src/ports/settings-port.ts` + `src/host/settings-adapter.ts`（写 `$DSH_HOME/dsh-mcp-bridge/settings.json`，与归属表 `state.json` 分开），TUI 放 `src/tui/` 而非 `src/cli/`。`locale/` 与 `icon.svg` 已在第 ④ 步建好，`package.json` 的 `files` 已同步补全（C6 关闭）。

`src/tui/` 与 `bin/` 是**进程外的配置客户端**，不在插件运行期依赖链上：`src/tui/**` 只允许 import `src/domain/**`（`ALLOWED_TARGETS` 的 `tui → {domain}`），`bin/` 是纯 JS 启动脚本，不参与 `tsc`。

## 3. 依赖规则（可机械校验）

| 编号 | 规则 | 违反后果 |
|---|---|---|
| D1 | `@deepseek-ai/*` 只允许出现在 `src/index.ts` 与 `src/host/**`；**当前目标值是全仓 0 处 import**（宿主面由 `src/host/host-types.ts` 结构窄化声明，见 ADR-009） | 下层被宿主版本绑死，无法单测 |
| D2 | `src/domain/**` 不得 import `node:http`、`node:fs`、`@deepseek-ai/*`、`src/host/**` | 状态机无法脱离 DSH 验证 |
| D3 | `src/ports/**` 只含 `interface`/`type`，不得有运行时代码 | 端口变成隐式实现 |
| D4 | `src/mcp/**` 不得 import `src/host/**` | 协议面与宿主耦合 |
| D5 | `src/transport/**` 不得 import `src/host/**`、`src/app/**` | 传输层越权拿到用例 |
| D6 | 任何层不得 `import '@modelcontextprotocol/sdk/*'` | 本机无该包，运行时直接崩 |
| D7 | `src/` 内不得用相对路径**横向跳到兄弟层**。允许的跨层方向只有第 1 节表格声明的向内依赖：`host → {domain, ports}`、`transport → {mcp, domain, ports}`、`mcp → {app, domain, ports}`、`app → {domain, ports}`、`ports → {domain}`、`tui → {domain}`；同层内（含子目录回父目录，如 `domain/projection/x.ts → ../types`）合法 | 依赖方向倒置 |

CI 前置检查：`scripts/check-boundaries.mjs` 已实现 D1–D7 的静态扫描（D3 单独检查 ports 层无运行时代码）。

```bash
node scripts/check-boundaries.mjs     # 通过 exit 0，违规 exit 1 并逐条打印 文件:行号
```

该脚本只做文本扫描、不解析 TypeScript 语法树——规则本身足够简单，引入解析器会为一个 grep 能解决的问题增加依赖。已用故意违规的探针文件验证过 D1/D2/D3/D4/D5/D6/D7 均能命中；D7 另用 7 个跨层探针覆盖了「向内放行 / 横向拦截」两个方向（`ports → domain`、`host → ports`、`app → domain`、`transport → mcp` 放行；`mcp → host`、`transport → app`、`app → mcp`、`domain → ports` 拦截）。

## 4. 端口契约

端口返回的是**原生事实**，不是桥接状态。六态翻译只发生在 `domain/`，否则 `domain/` 会退化成宿主的薄包装。

```ts
// ports/session-port.ts
export interface SessionPort {
  createSession(input: { workspaceId: string }): Promise<{ sessionId: string }>
  prompt(input: {
    sessionId: string
    requestId: string
    text: string
    mode: 'queue' | 'steer'
  }): Promise<{ accepted: true }>
  wait(input: {
    sessionId: string
    /** 首次传 -1；缺省值由 app 层决定，端口层必填 */
    afterSeq: number
    /** 缺省值由 app 层决定，端口层必填 */
    timeoutMs: number
    /** 缺省值由 app 层决定，端口层必填 */
    maxMessages: number
  }): Promise<WaitOutcome>
  cancel(input: { sessionId: string }): Promise<{ accepted: true }>
  readState(input: { sessionId: string }): Promise<SessionSnapshot>
}

export interface SessionSnapshot {
  cursor: number
  active: boolean
  running: boolean
  pendingInput: readonly ('approval' | 'question' | 'other')[]
  /** 开放回合的 turn/start seq；回合之间为 null（对齐宿主 OptionalSessionSeq） */
  openTurnStartSeq: number | null
  /** 最近一次 turn/start 的回合号，首回合前为 0 */
  lastTurn: number
}

export interface WaitOutcome {
  reason: 'idle' | 'input-required' | 'timeout'
  state: SessionSnapshot
  /** 已投影为桥接语义的增量输出（宿主原始事件不进这一层） */
  records: readonly OutputRecord[]
  truncated: boolean
}

/** 游标之后的回合进展：已开始的最大回合号 + 全部回合结束事件。 */
export interface TurnProgress {
  startedTurn: number | null
  /** 必须是全部 `turn/end`，不能只留最新一条，理由见第 6.2 节 */
  ends: readonly TurnEndInfo[]
}
```

```ts
// ports/workspace-port.ts
export interface WorkspacePort {
  ensureWorkspace(input: { cwd: string }): Promise<{ workspaceId: string; canonicalCwd: string; created: boolean }>
}
```

```ts
// ports/interaction-port.ts —— 第 1 阶段只读
export interface PendingInputSnapshot {
  questions: readonly PendingQuestion[]
  /** 原生交互标识（`ask_user_question` 的 callId）；读不到为 null */
  callId: string | null
  /** 是否存在挂起的审批。刻意用布尔而非数量，理由见下 */
  hasApproval: boolean
}

export interface InteractionPort {
  pendingInput(input: { sessionId: string }): Promise<PendingInputSnapshot>
}
```

**为什么是 `hasApproval: boolean` 而不是 `approvalCount: number`**：宿主的 `SessionState.pendingInput` 是 `Set` 去重后的**种类**列表（`dsh-api-session-controller/src/state/controller.ts` 先 `kinds.add(...)` 再 `[...kinds]`），同时挂 3 个审批也只出现一个 `'approval'`，数出来恒为 1。叫 `approvalCount` 会谎报数量。

**为什么把 `questions` 与 `callId` 放在同一个快照里**：`dsh_send` 的 `reply` 入参是 `{ callId, answers }`，客户端拿到问题必须同时拿到 `callId` 才能回填。分成两个方法会出现「有 `questions` 但 `callId` 为 null」的中间态。

```ts
// ports/permission-port.ts —— 第 1 阶段即需（提交首条任务前应用权限）
export interface PermissionPort {
  /** 同步：宿主 `catalog()` 是同步读配置，不是 RPC */
  availablePresets(): AvailablePresetsResult
  applyPreset(input: { sessionId: string; presetId: string }): Promise<void>
  /** 读不到返回 null（调用方报 unknown），不用 undefined */
  currentPreset(input: { sessionId: string }): Promise<string | null>
}
```

```ts
// ports/model-port.ts —— 第 1 阶段即需（提交首条任务前应用模型）
export interface ModelPort {
  /** 一次读全目录；宿主 `modelCatalog()` 返回分组结构，适配器抹平为 entries */
  catalog(): Promise<ModelCatalogResult>
  applySelection(input: {
    sessionId: string
    provider: string
    model: string
    /** null 表示「跟随模型默认」，适配器不传该字段 */
    reasoningEffort: string | null
  }): Promise<void>
  currentSelection(input: { sessionId: string }): Promise<{
    provider: string
    model: string
    reasoningEffort: string | null
  } | null>
}
```

**为什么 `ModelPort` 不用 `listProviders`/`listModels`/`resolveModel` 三段式**：宿主的 `sessionController.modelCatalog()` 一次就返回完整目录（含每个模型的 `reasoningEfforts` 与默认强度），拆成三段会变成三次 RPC 且需要桥接自己拼装。目录规模是几十项，一次读全没有成本问题。`llm.listProviders`/`listModels` 是 `llm` 服务面，与「给会话选模型」不是同一件事，第 1 阶段用不到。

```ts
// ports/registry-port.ts —— 会话归属登记
export interface SessionRecord {
  readonly sessionId: string
  readonly workspaceId: string
  /** 规范化后的绝对路径，串行占用按它判定 */
  readonly canonicalCwd: string
  /** 最近一次提交的请求 ID，用于占用冲突时回显「谁在跑」 */
  readonly lastRequestId: string
  /** 最近一次从源取得的权限值，只用于「源权限是否真的变了」的比较 */
  readonly lastSourcePermission: PermissionLevel | null
  /** 最近一次提交前读到的 lastTurn，即回合归属的 T0 */
  readonly baselineTurn: number
  /** 最近一次提交前读到的会话游标 */
  readonly baselineCursor: number
}

export interface SessionRegistryPort {
  list(): Promise<readonly SessionRecord[]>
  /** 未登记返回 null（调用方据此报 session-not-found） */
  get(sessionId: string): Promise<SessionRecord | null>
  upsert(record: SessionRecord): Promise<void>
}
```

**为什么归属关系必须自己记**：宿主不提供「这个会话是谁建的」查询，而 DEVELOPMENT.md 第 9 节要求「只操作本插件创建或用户明确授权接管的会话」。宿主 `sessionController.list()` 返回全部会话，无法区分来源。

**为什么 `baselineTurn` 与 `baselineCursor` 必须落盘**：回合归属的判定式是「对应回合 = `T0 + 1`」（第 6.2 节），而 `dsh_wait` 与 `dsh_cancel` 都是**后续独立请求**——不持久化 T0，插件重载后只能重新猜，会把别的回合算成本请求的（风险 R5）。`baselineCursor` 是读回合进展的起点：若改用客户端回传的 `cursor`，当该回合开始得早于首次 `dsh_wait` 时就会漏掉 `turn/start`。

**为什么只记这七个字段**：`canonicalCwd` 是占用判定的键、`lastRequestId` 是冲突回显、`lastSourcePermission` 是权限「仅变化时同步」的比较基线、两个 baseline 是回合归属的锚点；其余一律不存——不复制会话内容、不缓存状态机、不存模型密钥（DEVELOPMENT.md 第 7 节「只存最小元数据，不复制第二份会话数据库」）。`running`、`status`、`cursor` 全部实时读宿主，不从登记表推断。

## 5. 对外契约：MCP 工具面

四个工具的参数与返回体是**对外契约**，第 1 阶段就要定稿；实现可以分期（权限与模型解析先走「省略即跟随 DSH 默认」）。

### 5.1 `dsh_start`

```jsonc
// input
{
  "cwd": "/abs/path",              // 必填，绝对路径
  "task": "……",                    // 必填，完整任务文字
  "requestId": "……",               // 必填，调用方稳定 ID
  "sourcePermission": "ask",       // 可选：ask | auto | full
  "model": {                       // 可选：本次显式指定
    "provider": "……", "model": "……", "reasoningEffort": "……"
  }
}
```

```jsonc
// output
{
  "workspaceId": "……",
  "sessionId": "……",
  "cwd": "/abs/path",              // 规范化后的 realpath
  "requestId": "……",
  "status": "accepted",
  "model": { "provider": "……", "model": "……", "reasoningEffort": "……",
             "source": "dsh-default" },  // request | bridge-default | dsh-default | unknown
  "permission": { "level": "ask", "presetId": "workspace-write",
                  "source": "initial" }  // source-session | bridge-default | initial（第 1 阶段不产生 unknown，见 5.6）
}
```

**为什么是平铺而不是 `config: { model, permission }`**：这两个字段的消费者是「客户端要回显什么」，不是「客户端要解析一棵配置树」——多包一层只是多一次解构。`StartRecord`（`src/app/deps.ts`）也按平铺定型，幂等回执直接展开。
**为什么是 `permission.level` 而不是 `permission.value`**：`level` 与 `PermissionLevel` 类型同名，客户端拿到的就是 `'ask' | 'auto' | 'full' | 'unknown'`；`value` 太泛，容易与 `presetId` 混淆（后者才是 DSH 侧的预设 ID）。


占用冲突时返回结构化错误（不是 `isError` 之外的模糊文本）：

```jsonc
{ "error": { "code": "workspace-busy", "message": "……",
             "busy": { "sessionId": "……", "requestId": "……", "cwd": "/abs/path" } } }
```

### 5.2 `dsh_wait`

```jsonc
// input
{ "sessionId": "……", "requestId": "……", "cursor": 0, "timeoutMs": 30000 }
// output
{
  "status": "running",
  "cursor": 42,                    // = 本次观察到的 SessionState.cursor，客户端下次原样回传
  "output": "……",                  // 自 cursor 起的增量文本，已做体量裁剪
  "truncated": false,
  "needsInput": {                  // 仅 status=needs_input 时出现
    "kind": "question",            // approval | question | other（固定优先级，见下）
    "callId": "……",                // 仅 kind=question 时可能非 null；其余恒为 null
    "questions": [ { "id": "……", "question": "……", "options": [] } ]
  },
  "turn": { "number": 3, "reason": "completed" }   // 终态时出现
}
```

**`cursor` 的语义是「观察到的会话游标」，不是「最后一条输出记录的 seq」**。两者在无输出时不同：前者仍会随会话推进而前进（例如只有工具调用、没有 assistant 消息的回合），后者会卡住不动。若用「最后一条输出的 seq」，客户端下次传入的 `afterSeq` 会重复拉取已经裁剪掉的记录。因此 `cursor` 取 `SessionState.cursor`，`afterSeq` 直接用客户端回传的 `cursor`——客户端不需要理解 seq 语义。

### 5.3 `dsh_send`

```jsonc
// input：text 与 reply 互斥
{
  "sessionId": "……",
  "requestId": "……",
  "text": "……",                    // 普通补充
  "reply": { "callId": "……", "answers": [ { "id": "……", "selected": ["……"] } ] },
  "sourcePermission": "ask"        // 可选
}
// output：{ sessionId, requestId, cursor, status, permission }
// 不含 workspaceId/cwd，也不含 model（理由见下）
```

**为什么 `dsh_send` 也返回 `cursor`**：客户端拿到 `dsh_send` 结果后通常紧接着 `dsh_wait`。没有 `cursor` 就只能猜 `-1`，而 `-1` 会让 `dsh_wait` 从头重放已裁剪过的历史（`assistantOutput` 的 `afterSeq` 语义）。返回本次提交后读到的新游标，客户端原样回传即可。
**为什么 `dsh_send` 不返回 `workspaceId`/`cwd`**：这两个值在 `dsh_start` 已经给过，会话不变它们就不变；重复返回只是让客户端多一份可能过期的副本。
**为什么 `dsh_send` 不返回 `model`**：`dsh_send` 不接受模型参数，而第 1 阶段无法回读会话当前生效的模型（`ModelPort.currentSelection` 恒为 `null`，见 `src/host/model-adapter.ts`）。返回一个恒为 `unknown` 的字段会让客户端误以为「模型被改过」，不如不返回——这与全仓「读不到就不猜」的约定一致。第 2 阶段接入 `modelSelection` 投影回读后再补。

**`reply` 的语义（第 ④ 步接入，`src/app/send-task.ts:100-110`）**：`reply` 走宿主原生 `UserQuestionService.answer(agent, callId, answer)`，**不是**把答案当普通 prompt 发出去。两条路径的差别是本质的：

| | `text` | `reply` |
|---|---|---|
| 宿主调用 | `prompt({ mode: 'queue' })` | `userQuestions.answer(agent, callId, answer)` |
| 回合效果 | 当前回合结束后**新开**一个回合 | 作为 steering 消息塞进**当前正在执行的回合** |
| 归属基线 | `lastTurn`（目标回合 `lastTurn + 1`） | `lastTurn - 1`（目标回合就是开放回合 `lastTurn`，见 §6.2） |

`reply` 失败**一律抛错**（`invalid-argument`），`detail.reason` 区分四种成因，客户端可据此决定是重读 `needs_input` 还是放弃：

| `detail.reason` | 成因 |
|---|---|
| `not-pending` | 宿主 `answer` 返回 `false`——该 `callId` 已不在 `continued` 态（可能已被 DSH 界面回答或已超时） |
| `already-queued` | 宿主抛 `REPLY_QUEUED`——同一提问已经排了一条回复 |
| `bad-answer` | 宿主抛 `BAD_ANSWER`——答案批次没有把该提问的每个子问题各答一次 |
| `caller-not-live` | 宿主抛 `CALLER_NOT_LIVE` / `DELEGATED_CALLER`——拿不到活的 `Agent` 实例，或该会话是子代理 |

**`reply` 被拒不得降级成普通 prompt 发送**：那会让客户端以为回答已经送达，而模型实际上还在等一个永远不会来的答案。

### 5.4 `dsh_cancel`

```jsonc
// input
{ "sessionId": "……" }
// output
{ "accepted": true, "status": "running" }   // 注意：不返回 cancelled
```

`status` 是**取消受理瞬间的观察值**，可能是 `accepted` / `running` / `needs_input`，也可能是 `completed`（取消来晚了、回合刚好结束）——这四种都是如实观察，不是错误。它**永远不返回 `cancelled`**：`cancelled` 只能由后续 `dsh_wait` 在观察到 `turn/end.reason.kind === 'aborted'` 之后报出。

### 5.5 契约硬约束

- `dsh_cancel` 的返回**只表示取消请求是否被接受**，`status` 保持观察到的真实状态。`cancelled` 只能在观察到对应回合 `turn/end.reason.kind === 'aborted'` 之后由 `dsh_wait` 报出。
- 所有工具返回体不得包含完整会话历史、全部工具输出或模型推理；`output` 必须按 `maxMessages` 与字节上限裁剪，并如实置 `truncated`。
- 错误统一走 `{ error: { code, message, ... } }`，`code` 取自固定枚举，不把原生异常栈直接透给客户端。
- `needsInput.callId` **字段必须存在**（可为 `null`），因为 `dsh_send` 的 `reply` 入参是 `{ callId, answers }`——缺了它交互回复无法回填。`kind !== 'question'` 时 `questions` 给空数组，但对象本身不得省略。
- `needsInput.kind` 按**固定优先级** `approval > question > other` 从 `pendingInput` 判定，**不看数组顺序**。宿主 `pendingInput` 是 `Set` 去重后展开的数组（`dsh-api-session-controller/src/state/controller.ts` 的 `private pendingInput`：`for (const { event, agentId } of this.ctx.typertGateway.getPendingRemoteEvents())` → `kinds.add(...)` → `return [...kinds]`），插入序即事件到达序，同时挂 `approval` 与 `question` 时取 `[0]` 会随机命中。固定优先级保证客户端可依赖。
- `needsInput.callId` **只可能来自 `userQuestions` 投影**：该投影只跟踪 `ask_user_question` 工具调用（`dsh-user-questions/src/projection.ts` 的 `key: 'userQuestions'`、`ASK_USER_QUESTION_TOOL = 'ask_user_question'`）。审批走 `approval/request` 事件，不进该投影；`approvalState` 投影只含 `{ policy, turnOpen }`，没有 `callId`。因此 `kind === 'question'` 时 `callId` 能读到就给、读不到给 `null`；`kind === 'approval' | 'other'` 时 **`callId` 恒为 `null`**（`dsh_send` 的 `reply` 只服务提问，没有审批回复通道）。
- `pendingInput` 非空但详细载荷读不到时仍报 `needs_input`，`needsInput` 降级为 `{ kind: <按上述优先级>, callId: null, questions: [] }`；**不得因为读不到细节就退回 `running`**。
- 两条读取路径互相独立、失败互不传染：`pendingInput` 走 `sessionController.state()`，提问详情走 `sessionProjections.stateOf(session, 'userQuestions')`。任一路读不到都只降级，不让 `dsh_wait` 整体失败。
- `dsh_start` / `dsh_send` 的返回体**平铺** `model` 与 `permission`，不套 `config` 包裹层；`permission` 用 `level` 而非 `value`（理由见 5.1）。
- `dsh_send` 的返回体**必须含 `cursor`**（提交后读到的新游标），否则客户端无法直接接着 `dsh_wait`；不含 `workspaceId`/`cwd`（`dsh_start` 已给过，会话不变它们就不变），也不含 `model`（`dsh_send` 不接受模型参数，第 1 阶段又无法回读生效模型，返回恒 `unknown` 的字段会误导）。
- **`-32602` 与 `isError` 的界线**：工具**根本没跑起来**（缺 `name`、未知工具名、`arguments` 非对象、缺 `cwd`、`cwd` 非绝对路径、`requestId` 为空、`model` 只给一半）→ JSON-RPC `-32602 INVALID_PARAMS`；工具**跑起来但业务失败**（`workspace-busy`/`session-not-found`/`turn-missing`/`wait-timeout`/`host-capability-missing`/`internal`）→ HTTP 200 + `result.isError = true`。`-32600 INVALID_REQUEST` 只用于「这压根不是合法 JSON-RPC 请求」（非对象、`jsonrpc` 不是 `"2.0"`、`method` 非字符串）。
- **`model-unavailable` / `reasoning-effort-unavailable` / `saved-model-invalid` / `permission-unavailable` 四个码走 `-32602`**：它们虽然发生在工具执行期，但对客户端而言都是「你的参数与当前环境不匹配，换参数才能继续」，与「任务执行失败」不是同一类。
- **`text` 与 `reply` 严格互斥**：两者都传或都不传 → `invalid-argument`。`reply` 必须走原生 `userQuestions.answer`，**不得降级成普通 prompt**——降级会让客户端以为回答已送达，而模型仍在等一个不会来的答案。`reply` 被拒时 `detail.reason` ∈ `not-pending` / `already-queued` / `bad-answer` / `caller-not-live`。

### 5.6 `config.*.source` 的取值语义

两个枚举刻意分开命名，因为它们描述的是**不同的三层**，混用会让客户端无法判断该值来自哪里。

| `model.source` | 含义 |
|---|---|
| `request` | 本次 `dsh_start` 显式传入 |
| `bridge-default` | 桥接保存的默认值（第 ③ 步的 TUI 写入） |
| `dsh-default` | DSH 全局默认设置 |
| `unknown` | 实际生效值暂时读不到 |

| `permission.source` | 含义 |
|---|---|
| `source-session` | 从 Codex 源会话取得的 `sourcePermission` |
| `bridge-default` | 桥接保存的默认权限 |
| `initial` | 初始值「请求批准」 |
| `unknown` | 实际生效值暂时读不到 |

`permission.level` 与 `permission.presetId` 是两件事：`level` 是桥接语义值（`ask`/`auto`/`full`），`presetId` 是 DSH 实际接受的预设 ID（如 `workspace-write`）。读不到时 `presetId` 置 `null`，**不得用 `level` 反推一个猜测的 `presetId`**。

**第 1 阶段 `bridge-default` 层是死代码**：TUI 保存默认值属第 ④ 步，`src/app/start-task.ts` 的 `savedDefault`/`saved` 恒传 `null`，因此 `PermissionSource.bridge-default` 与 `ModelSource.bridge-default` **永不产生**。保留这两个取值是为了第 ④ 步接 TUI 时不必改客户端契约；枚举成员上的注释已写明这一点，避免有人误以为现在已有代码路径在产出它。

**读不到可用预设时，`source` 仍报真实来源，不改成 `unknown`**。三层顺序 `sourcePermission ?? savedDefault ?? INITIAL_PERMISSION` 保证 `level` 恒有值，因此「读不到预设」这件事由 `presetId: null` 单独表达就够了。若此时把 `source` 也置 `unknown`，会同时抹掉「这个档位是谁定的」——而「初始值 `ask` + 读不到预设」与「源会话要 `full` + 读不到预设」的安全含义完全不同，客户端必须能区分。

由此，`permission.source` 的 `unknown` **在第 1 阶段不会产生**（保留它是为了开放枚举兼容与第 2 阶段回读）。`model.source` 的 `unknown` 则**真的会用到**：模型目录为空时连 `provider`/`model` 都不知道，只能报未知。两个枚举的 `unknown` 语义不同，不要合并理解。

**`source` 描述的是「选择的来源」，不是「生效的确认」**。`selectModel` / `permissionPresets.set` 成功即视为已应用——它们把选择写进会话，不返回回读校验。因此 `source: 'request'` 的含义是「本次显式传入且宿主接受了」，**不是**「已验证模型真的被用于下一次调用」。第 1 阶段不做这个区分（多一个枚举值会让客户端多一个分支），第 2 阶段若要回读，走 `dsh-agent` 的 `modelSelection` 投影（`lastUsed` / `next`），不要读 `request/header` 事件做历史分页。

`source` 是开放枚举：后续阶段可新增取值，但**不得改名或删除已有取值**。

### 5.7 MCP 协议面（传输层契约）

工具面之外还有一层必须定稿的契约：**JSON-RPC 帧与 HTTP 语义**。这层不归 `domain/`，但客户端只认它，所以同样是对外契约。

**协议版本**（实测自 `@modelcontextprotocol/core@2.2.0` 的 `dist/auth-BNDyLTqp.mjs`）：

```js
const JSONRPC_VERSION = "2.0";
const LATEST_PROTOCOL_VERSION = "2025-11-25";
const SUPPORTED_PROTOCOL_VERSIONS = [
  LATEST_PROTOCOL_VERSION, "2025-06-18", "2025-03-26", "2024-11-05", "2024-10-07",
];
```

`initialize` 时按此表协商：客户端请求的版本在表内则原样回，否则回 `LATEST_PROTOCOL_VERSION`（MCP 规范允许服务端回自己的最高版本，由客户端决定是否继续）。**不要自己编版本号**，也不要只接受 `2025-11-25`——Codex 侧实际发的版本可能落后几个修订。

**错误码只用标准值**（同文件）：

| 码 | 常量 | 用途 |
|---|---|---|
| `-32700` | `PARSE_ERROR` | 请求体不是合法 JSON |
| `-32600` | `INVALID_REQUEST` | JSON 合法但不是合法 JSON-RPC 帧 |
| `-32601` | `METHOD_NOT_FOUND` | 未实现的方法 |
| `-32602` | `INVALID_PARAMS` | 参数校验失败（工具入参不合 schema 走这里，**不是** `isError`） |
| `-32603` | `INTERNAL_ERROR` | 桥接内部异常 |

**工具执行失败与协议错误的界线**：工具**跑起来了但业务失败**（如 `workspace-busy`、`session-not-found`、`turn-missing`）→ HTTP 200 + `result.isError = true` + `content` 里放结构化错误；工具**根本没跑起来**（入参缺字段、`cwd` 不是绝对路径、`requestId` 为空）→ `-32602`。混用会让客户端无法区分「我的请求写错了」与「任务失败了」。

**HTTP 方法映射**（Streamable HTTP）：

| 方法 | 语义 | 关键约束 |
|---|---|---|
| `POST` | 发送 JSON-RPC 消息 | `Accept` 必须同时容忍 `application/json` 与 `text/event-stream`；只实现前者会让部分客户端协商失败 |
| `GET` | 建立服务端→客户端 SSE 流 | 第 1 阶段**可以返回 405**：桥接不发服务端主动通知（见下） |
| `DELETE` | 终止会话 | 第 1 阶段无跨请求会话状态，返回 204 即可 |

**第 1 阶段不发服务端主动通知，因此不需要维护 `Mcp-Session-Id`**。理由：桥接的工具是「请求-响应」型（`dsh_wait` 靠长挂 POST 而非推送完成），没有 `notifications/tools/list_changed` 之类的需求。省掉会话表就省掉了「会话过期」这一整类失败模式。**若第 2 阶段要加进度通知，必须同时补 `Mcp-Session-Id` 的分配、校验与过期**，不能只加 GET 流。

`notifications/initialized` 是**通知**，无 `id`、**不得回响应**（回了会让客户端认为帧序错乱）。这是手写分派最容易踩的坑：按「有 method 就回 result」写会直接破坏握手。

### 5.8 设置读写路由（`/mcp/settings`）

TUI 与其它本机配置客户端走这条**独立于 MCP 端点**的 REST 路由（`src/transport/settings-route.ts`，常量 `SETTINGS_ROUTE_PATH` 在 `src/transport/route.ts`）。

**为什么不复用 `/mcp/dsh-mcp-bridge`**：那条路径说的是 MCP 协议（JSON-RPC 帧、`initialize` 握手、`tools/call`），而设置是普通 REST 语义（`GET` 读快照、`PUT` 写默认值）。混进 MCP 端点会让一个只认 JSON-RPC 的客户端把设置请求当成非法帧，也会让分派器多出一堆「不是工具调用但要处理」的分支。

| 方法 | 语义 | 成功响应 |
|---|---|---|
| `GET` | 读设置快照（连接状态 + 模型目录 + 权限档位 + 已保存值 + 失效标记） | `200` + `SettingsSnapshot` |
| `PUT` | 写默认模型与默认权限 | `200` + 写入后的 `SettingsSnapshot` |
| 其它 | — | `405` + `allow: GET, PUT` |

**认证与任务接口完全一致**：复用 `src/transport/auth.ts` 的 `checkRequest`（回环判定 → 未配置凭据 → Bearer 校验），拒绝文案逐字相同。保存默认权限属于用户配置操作，未认证客户端**不得写**——不能因为「只是改个默认值」就放宽围栏。

**错误体是 REST 形状，不是 JSON-RPC 形状**：

| 情况 | 状态码 | 响应体 |
|---|---|---|
| 请求体不是合法 JSON | `400` | `{ "error": "请求体不是合法 JSON" }` |
| 请求体超上限（64 KiB） | `413` | 纯文本 |
| 字段非法（`invalid-argument`） | `400` | `{ "error": { "code", "message", "detail"? } }` |
| 其它内部错误 | `500` | 同上 |

**为什么 JSON 解析失败回 `400` 而不是 `-32700`**：`-32700` 是 JSON-RPC 的帧级错误码，出现在 REST 响应里会让客户端误以为自己在跟 MCP 端点说话。

**`connection.origin` 由传输层补**：用例层（`src/app/settings.ts`）按 D7 拿不到 `webServer`，所以 `buildSettingsSnapshot` 里 `origin` 恒为 `null`；传输层用 `req.headers.host` 拼 `http(s)://${host}` 补上，并**新建对象**而不是改原对象（`SettingsSnapshot` 是 `readonly`）。`connection.profile` 保持 `null`：宿主没有可 `ctx.get()` 的「读当前 profile 名」服务，猜一个名字比留空更糟。

**写入校验有两道，且都必要**：传输层把 body 原样交给用例层，用例层的 `writeSettings` 内部再调一次 `readSettingsUpdate` 做形状校验，然后校验「模型在目录里 / 强度属于该模型 / 权限预设可用」。传输层**不做预校验**——重复实现会让两处规则漂移。**目录读不到时用例层跳过第二类校验**（否则 DSH 还没起来时用户连保存都做不到），这是有意的不对称：形状永远严格，环境相关的一致性只在读得到时检查。

### 5.9 宿主 Browser access 围栏（部署前置，非本插件可控）

**这是本插件之外、但决定它能否被外部客户端访问的硬约束，必须在部署文档里写明。**

`DSH Desktop` 的 `NextWebServer`（`app.asar/lib/webserver.js`）覆写了 `register`/`registerUpgrade`，给**每一条**注册的路由套上 `policy(route)`：

```js
handler: (inner) => this.observeHttp(route, async (request, response) => {
  if (!this.permits(request)) {
    response.writeHead(403, { 'cache-control': 'no-store' })
    response.end('Browser access is disabled')
    return
  }
  ...
})
```

`permits()` 的判据（`app.asar/lib/desktop-browser-access-C9zC_PMD.js`）：

```js
function decideDesktopBrowserAccess(access, request) {
  if (sameToken(exactHeaderValue(request.headers), access.rendererHeader.value)) return 'renderer'
  if (!access.ordinaryBrowserEnabled || desktopBrowserUrlHasRendererMarkers(request.url)) return 'denied'
  return 'browser'
}
```

- `renderer` 需要请求头 `x-dsh-desktop-renderer: <每次启动随机生成的 32 字节 base64url>`，该 token 只注入 Electron 渲染进程的原生网络会话，**外部进程拿不到、也不该去拿**。
- `ordinaryBrowserEnabled` 来自桌面端偏好 `browserAccess`，默认值 `false`（`app.asar/lib/desktop-contract-YEiRp6ni.js` 的 `DEFAULT_PREFERENCES`）。
- 因此**默认配置下，任何不带渲染进程头的 HTTP 请求（包括 Codex 的 MCP 请求）在到达插件之前就被 403 掉**，响应体是纯文本 `Browser access is disabled`。

**结论与处置**：

1. 这是**部署前置条件**，不是本插件的 bug：用户必须在 DSH 桌面端设置里打开「允许浏览器访问」（`browserAccess`），桥接路由才可达。第 ⑤ 步联调前必须先确认该开关状态。
2. 本插件**不得**尝试绕过：不伪造 `x-dsh-desktop-renderer`、不改宿主偏好文件、不另起 HTTP 服务。绕过去等于把桌面端的安全边界拆掉。
3. 错误必须**可诊断**：`src/transport/auth.ts` 的围栏在宿主围栏之后才执行，所以客户端看到的是宿主的 403 纯文本而不是本插件的中文文案。`src/tui/client.ts` 的 `describeFailure` 已专门识别 `Browser access is disabled` 并给出「请在 DSH 设置里打开『允许浏览器访问』」的指引——**不要把这条 403 显示成「只接受本机回环连接」**，那会让用户去查回环配置。
4. 该围栏同时作用于 `registerUpgrade`，所以第 2 阶段若改用 WebSocket 传输，同样受此约束，不会因为换协议而豁免。

## 6. 状态机

### 6.1 输入事实

原生能提供且只提供这些：

| 事实 | 来源 |
|---|---|
| `prompt` 是否被接收 | `SessionPromptValue.accepted`（**只是接收确认**） |
| 会话是否在跑 | `SessionState.running` |
| 待处理输入类别 | `SessionState.pendingInput` |
| 开放回合 | `turnBoundary.openTurnStartSeq` |
| 最近回合号 | `turnBoundary.lastTurn` |
| 回合结束原因 | `turn/end { turn, reason }` |
| 输出增量 | `wait.output.records`（`SessionEventEntry[]`，**不是纯文本**） |

### 6.2 回合归属

提交前读一次 `lastTurn` 记为 `T0`。**对应回合固定为 `T0 + 1`**——不是「游标后第一个 `turn > T0`」，也不是「游标后最大 turn」。

- 已开始判据：`startedTurn >= T0 + 1`（回合号单调递增，`T0 + 2` 已开始则 `T0 + 1` 必然开始过）。
- 结束匹配：在游标后观察到的**全部** `turn/end` 里按 `turn === T0 + 1` 精确查找，命中即按 `reason` 翻译。
- 该回合 `turn/end` 未出现（`openTurnStartSeq` 指向它）→ 仍在执行。
- 出现 `turn > T0` 之前会话就 `idle` 且无 `pendingInput` → 异常路径，报 `failed`（`reason: 'turn-missing'`），不得报 `completed`。
- **读不到回合边界时按保守值处理**：适配器在 `agents` / `sessions` 服务缺失或 `turnBoundaryOf` 抛错时，返回 `{ openTurnStartSeq: null, lastTurn: 0 }` 而**不是抛错**。这样上层稳定落入 `turn-missing` 失败路径，而不是因为读不到边界就把「没有结束事件」误判成「回合已结束 → `completed`」。这是 R1 风险的兜底行为，不是可选优化。

**为什么必须固定 `T0 + 1` 而不是「最大 turn」**：游标之后若连跑多个回合（`mode: 'queue'` 排队，或用户在 DSH 界面手动又发了一条），「游标后观察到的最大 turn」会是 `T0 + 2`，此时

- `end.turn === T0 + 1`（本回合已结束）但 `end.turn !== T0 + 2` → 被误判为 `running`，**漏报已完成**；
- `end.turn === T0 + 2`（下一回合已结束）→ 被误判为 `ended`，**把下一回合的结果算成本请求的**。

两种误判方向相反，但都会让 Codex 拿到错误的终态。因此端口层的 `TurnProgress` 必须携带**全部** `turn/end`（`ends: readonly TurnEndInfo[]`），而不是只保留最新一条——只留最新一条时，`T0 + 1` 的结束事件会被 `T0 + 2` 覆盖掉，判定式再正确也无从匹配。

**`dsh_send` 的 `reply` 是唯一改变基线算法的分支**（`src/app/send-task.ts` 的 `replyBaselineTurn`）：

| 提交方式 | 目标回合 | 基线 `T0` 取值 | 理由 |
|---|---|---|---|
| `text`（`prompt({ mode: 'queue' })`） | `lastTurn + 1` | `lastTurn` | 排队等当前回合结束再新开一回合，`T0 + 1` 就是它 |
| `reply`（`userQuestions.answer`） | 当前开放回合 `lastTurn` | `lastTurn - 1` | 答案是 steering 消息，塞进**正在执行**的回合，不会新开回合；若仍用 `lastTurn` 当基线，`expectedTurn` 会永远等 `lastTurn + 1`，而那个回合根本不会出现 |

`reply` 时若会话此刻没有开放回合（`openTurnStartSeq` 为 `null`，理论上不该发生，但宿主状态可能已变），退回 `text` 的算法：把答案当成下一回合的输入，等它开新回合。这是保守兜底，不是正常路径。

### 6.3 六态翻译

| 原生事实 | 桥接状态 |
|---|---|
| `prompt` 已接收，尚未观察到 `turn > T0` 的 `turn/start` | `accepted` |
| 对应回合 `openTurnStartSeq` 非空 | `running` |
| `pendingInput` 非空（含审批与提问），且对应回合未结束 | `needs_input` |
| `turn/end.reason.kind === 'completed'` | `completed` |
| `turn/end.reason.kind === 'aborted'` | `cancelled` |
| `turn/end.reason.kind ∈ { error, blocked, max-tokens, interrupted }` | `failed` |
| `wait` 返回 `reason: 'timeout'` | 保持上一状态，**不升级为终态** |
| `turn/end.reason.kind === 'forked'` | 非本请求终态，继续等待 |

`blocked` 归入 `failed` 而非 `needs_input`：它是**回合结束原因**，回合已经结束；`needs_input` 描述的是回合仍在进行且挂起了待处理输入。两者语义不同，不可混用。

### 6.4 幂等

`requestId` 直接透传为 `SessionPromptRequest.requestId`。DSH 原生已按 `rpcId` 去重（`prompt()` 首行即 `hasPromptRequest` 检查，并重放 `user/message` 的 `source.rpcId`）。

**桥接层不得自建 requestId 去重表**——自建表会与原生记录形成两份事实源，重载后不一致。

### 6.5 终态保持的适用边界

`mergeStatus(previous, observed)` 的「终态不可再迁移」只用于**同一个请求的多次观察**，不跨请求继承。三个工具的适用方式不同：

| 工具 | `previous` 取值 | 理由 |
|---|---|---|
| `dsh_wait` | 该 `requestId` 上一次观察到的状态 | 同一请求的重复等待，终态必须稳定——否则「已取消」会被后续 wait 改成「已完成」 |
| `dsh_send` | **`null`（不继承）** | 新 `requestId` 就是新任务。若继承上一请求的 `completed`，客户端会看到「刚提交新任务，状态却是 completed」这种自相矛盾的返回 |
| `dsh_cancel` | **`null`（不继承）** | 返回的是**取消受理瞬间的观察值**，不是某个请求的终态结论 |

`dsh_cancel` 的 `status` 可能是 `accepted` / `running` / `needs_input`，也可能是 `completed`（取消来晚了、回合刚好结束）——这四种都是**如实观察**，不是错误。它**永远不返回 `cancelled`**：`cancelled` 只能由后续 `dsh_wait` 在观察到 `turn/end.reason.kind === 'aborted'` 之后报出。

**为什么 `dsh_send` 必须重置基线**：`dsh_send` 提交后立刻返回，此刻对应回合还没开始，按 §6.3 只能是 `accepted`。若沿用上一请求的终态，`mergeStatus` 会保留 `completed`，而它刚刚提交了新任务——这在客户端看来是矛盾的，且会让客户端误以为新任务已经完成。

## 7. 串行占用

占用键是 `WorkspacePort.ensureWorkspace` 返回的 `canonicalCwd`。

占用判定**不维护独立锁表**，而是从原生状态投影：

```text
cwd 被占用 ⟺ 该 cwd 下存在本插件创建、且 readState(sessionId).running === true 的会话
```

理由：独立锁表在插件重载后必然与真实执行状态脱节（锁还在、任务已死；或任务在跑、锁已丢）。投影式判定天然重载安全。

需要持久化的最小元数据只有归属关系：

```jsonc
// $DSH_HOME/dsh-mcp-bridge/state.json
{
  "version": 1,
  "sessions": {
    "<sessionId>": { "workspaceId": "……", "canonicalCwd": "/abs/path",
                     "lastRequestId": "……", "lastSourcePermission": "ask",
                     "baselineTurn": 3, "baselineCursor": 128 }
  }
}
```

不复制会话内容、不缓存状态机、不存模型密钥。读写走 `SessionRegistryPort`（见第 4 节），实现落在 `src/host/registry-adapter.ts`，路径由 `$DSH_HOME` 决定而非硬编码。

**写盘策略**：`upsert` 采用「读-改-写整份 JSON + 临时文件 rename」保证原子性；文件不存在视为空表，JSON 解析失败**不抛错也不覆盖**，而是记一条警告后按空表继续（宁可丢失占用回显，也不能让一个坏文件把插件启动卡死——归属表是辅助信息，不是事实源）。

## 8. 失败隔离

| 隔离面 | 规则 |
|---|---|
| 请求 | 单个 `tools/call` 抛错 → 返回 `isError: true` 的 `CallToolResult`，不关闭 SSE、不影响其他会话 |
| 等待 | `dsh_wait` 的 abort 只结束本次等待；客户端断开 SSE 只 abort 该 wait，**绝不 abort 会话执行** |
| 会话 | 一个会话失败/取消不传染同工作区其他会话 |
| 文件 | 占用只约束本插件派发的写入任务，**不锁文件系统**，不影响用户与其他程序 |
| 可选服务 | `ctx.get()` 惰性读取；缺失时该能力返回固定错误码，插件仍正常加载 |
| 配置 | 保存的模型/权限失效 → 新建会话明确报错并附已创建会话定位信息，不静默换档、不阻塞其他 cwd |
| 卸载 | `ctx.effect` 清理：关 MCP 监听、abort 全部 wait、保留 DSH 会话、不触碰 AA Connector 与其他进程 |
| 认证 | 认证失败返回 401，不透出内部错误与路径 |

## 9. 可扩展点

| 扩展点 | 位置 | 新增成本 |
|---|---|---|
| 新 MCP 工具 | `src/mcp/tools/` 加模块 + 注册表登记 | 不改分派器 |
| 新宿主能力 | 新端口 + 新适配器 | `domain/` 不变 |
| 输出投影策略 | `src/domain/projection/output.ts` | 可替换，不影响状态机 |
| 新传输（stdio 等） | `src/transport/` 新增实现 | `mcp/` 不变 |
| 配置项 | `src/config/` schema 版本化 | 插件与 TUI 共用同一 store |
| **交互回复（`dsh_send` 的 `reply`）** | `src/ports/interaction-port.ts` 加 `answer`，`src/host/interaction-adapter.ts` 实现 | 第 1 阶段只留了只读的 `pendingInput`；`answer` 需要活 `Agent`（`ctx.agents.get(sessionId)`）调 `UserQuestionService.answer(agent, callId, answer)`，属第 ④ 步。**这是 `needs_input` 从「能看见」到「能回答」的唯一缺口**，不补则客户端收到 `needs_input` 后只能 `dsh_cancel` |

## 10. 架构决策记录

### ADR-001：手写 JSON-RPC 分派，不引入 MCP SDK

**状态**：已接受

**背景**：本机 asar 内 `@modelcontextprotocol` 只有 `client@2.2.0` 与 `core@2.2.0`。`core` 的 `dist/index.mjs` 仅 10KB，导出全是 zod schema 常量，**不含** `Server`、`McpServer`、`Protocol`、`StreamableHTTPServerTransport`。

**决策**：用 `@modelcontextprotocol/core` 的 schema 常量做校验，自己实现 `initialize` / `tools/list` / `tools/call` / `notifications/initialized` 的分派与 SSE 帧。

**备选**：自带 `@modelcontextprotocol/sdk` 依赖并引入构建链。

**影响**：第 1 阶段零新增依赖、零构建步骤；代价是分派逻辑自己维护，需覆盖 MCP 版本协商与 `Accept` 头分支。

### ADR-002：HTTP 载体用 `ctx.webServer.register`

**状态**：已接受

**背景**：`WebRoute.handler(req, res)` 拥有完整响应生命周期，可长挂，适合 SSE；`Config.host` 在加载期就拒绝 `0.0.0.0`/`::`，天然满足「仅回环」。

**决策**：不自起 `http.createServer`，全部路由经 `ctx.webServer.register`。

**影响**：端口与生命周期由宿主统一管理，卸载即关闭；代价是路由路径需避开宿主已占用的前缀。

### ADR-003：端口/适配器隔离宿主 API

**状态**：已接受

**决策**：`@deepseek-ai/*` 只出现在 `src/index.ts` 与 `src/host/**`；端口只声明接口，返回原生事实。

**影响**：DSH 升级时改动收敛在 `host/`；`domain/` 可脱离 DSH 单测。

### ADR-004：复用原生 `wait`，不自建轮询

**状态**：已接受

**背景**：`SessionController.wait` 已实现「静默/待输入/超时」三态、`afterSeq` 增量与 `maxMessages` 上限，且其 `signal` 只取消等待、不取消执行。

**决策**：`dsh_wait` 直接映射到原生 `wait`，桥接层只补两件事：回合归属判定、`SessionEventEntry[]` → 可读文本投影。

**影响**：不引入轮询与自建超时；代价是 `wait` 超时抛 `session/wait-timeout` 时需自行区分「从未拿到状态」与「正常超时」。

### ADR-005：requestId 透传，不自建去重表

**状态**：已接受

**背景**：`prompt()` 首行即 `hasPromptRequest` 检查，并重放 `user/message` 的 `source.rpcId`。

**决策**：MCP 侧 `requestId` 原样作为 `SessionPromptRequest.requestId`。

**影响**：重试天然幂等、重载后仍有效；代价是桥接层不能对 requestId 做任何改写（如加前缀）。

### ADR-006：状态机在 `domain/`，输入是原生事实

**状态**：已接受

**决策**：六态翻译、回合归属、占用判定全部是纯函数，输入为端口返回的原生事实。

**影响**：可用固定输入快照覆盖全部迁移分支；代价是端口需暴露 `openTurnStartSeq`/`lastTurn` 这类原本属于投影的字段。

### ADR-007：占用判定从原生状态投影，不维护锁表

**状态**：已接受

**影响**：重载安全；代价是每次判定需 `readState`，第 1 阶段会话数量少，可接受。

### ADR-008：契约先定稿，实现分期

**状态**：已接受

**背景**：开发顺序第 ② 步只要求「原生会话闭环 + 四工具」，权限映射与配置解析在第 ③ 步。

**决策**：四个工具的 schema 与返回体在第 1 阶段定稿；`sourcePermission`/`model` 参数接受但先走「省略即跟随 DSH 默认」，`PermissionPort`/`ModelPort` 留接口不实现。

**影响**：Codex 侧接入不会被后续阶段破坏；代价是第 1 阶段返回的 `config.*.source` 恒为 `dsh-default`/`unknown`。

### ADR-009：宿主 API 用本地结构窄化声明，不 import 宿主类型

**状态**：已接受（2026-11-17 新增，由实测驱动）

**背景**：本机 `app.asar/node_modules/@deepseek-ai/*` 的 `.d.ts` 文件总数为 **0**。各包 `package.json` 的 `types` 字段都指向 `./lib/types/index.d.ts`，但该文件不存在，`lib/types/` 里只有 `.js`（如 `dsh-agent/lib/types/index.js` 是 21644 字节的真实现）。同时该 scope 在公共 npm 上查不到（`npm view @deepseek-ai/dsh-agent versions` 无输出），无法靠 `devDependencies` 装包拿类型。结果是：`import type { Context } from '@deepseek-ai/cordis'` 在 tsc 下会解析到缺失的 `.d.ts`，报 `TS7016` 或直接解析失败。

**备选方案**：

| 方案 | 做法 | 为什么不选 |
|---|---|---|
| 装宿主包拿类型 | `devDependencies` 加 20+ 个 `@deepseek-ai/*` | 公共 npm 不可得；参考实现 `dsh-config-manager` 这么做的版本号来源无法复现 |
| 环境声明给 `any` | `types/deepseek.d.ts` 里 `declare module '@deepseek-ai/*'` | `strict` 形同失效，端口契约的类型保护全丢 |
| **本地结构窄化** | `src/host/host-types.ts` 手写只含实际用到的成员 | 需在宿主升级时手动跟进，但这是唯一不依赖外部可得性的路 |

**决策**：`src/host/host-types.ts` 用 `interface`/`type` 声明桥接实际用到的宿主面（`Context`、`WebServer`、`WebRoute`、`SessionController`、`WorkspaceRegistry`、`PermissionPresetService`、`AgentRegistry` 的最小成员集），成员签名照 `app.asar` 内 `src/*.ts` 源码抄写并注明来源文件与行号。**`src/` 内 `@deepseek-ai/*` 的 import 数量为 0。**

**影响**：

- D1 从「限制 import 范围」降级为「天然满足」——`check-boundaries.mjs` 仍保留 D1 检查，作为回归护栏。
- 宿主升级时若成员签名变化，tsc 会在 `host-types.ts` 与适配器实现处报错，而不是静默 `any` 通过。
- 代价：`host-types.ts` 是手写副本，必须靠注释里的「来源：`dsh-api-session-controller/src/index.ts:598`」这类引用保持可追溯。**这是本架构里唯一一处「重复宿主定义」的妥协，且被限制在单个文件内。**

**验证方式**：`grep -rn "@deepseek-ai/" src` 应只命中注释、不命中 import 语句。

### ADR-010：只读消费投影时使用已废弃的 `sessionProjections.stateOf(session, key)`

**状态**：已接受（2026-11-17 新增，带明确退场条件）

**背景**：`dsh-session-projection/src/index.ts:454` 的注册表级读接口 `stateOf(session, key)` 已标 `@deprecated`，注释要求改用「awaited 注册返回的 `handle.stateOf(session)`」或「拥有该投影的领域服务」。但两条推荐路径在第 1 阶段都走不通：

- `handle` 只在**注册该投影的那个 effect** 内部可得。桥接是**只读消费方**，拿不到别人的 `handle`——`userQuestions` 投影由 `dsh-user-questions` 注册，`approvalState` 由 `dsh-user-approval` 注册。
- 拥有该投影的领域服务 `UserQuestionService` 只暴露 `answer(agent, callId, answer)` 与 `attachWait(agent, callId, signal)`，两者都要求**活的 `Agent` 对象**且会拒绝子代理调用，**没有「列出当前挂起提问」的读接口**。第 1 阶段只需要「如实告诉客户端卡在等什么」，不需要回答。

**备选方案**：

| 方案 | 做法 | 为什么不选 |
|---|---|---|
| 订阅 `session/event` 自己重放 | 监听 `user-questions/request` 等事件维护本地状态 | 与宿主投影重复实现同一份折叠逻辑；宿主改折叠规则时桥接会静默偏离 |
| 调 `UserQuestionService.attachWait` | 用流式等待拿挂起项 | 需要活 `Agent`，且语义是「等这一个 callId」，不是「列出全部挂起」 |
| **用废弃的注册表级 `stateOf`** | 只读消费，不改状态 | 有废弃警告，但宿主当前仍提供且行为稳定 |

**决策**：`src/host/interaction-adapter.ts` 使用 `sessionProjections.stateOf(session, 'userQuestions')`，并在 `host-types.ts` 与适配器注释里写明为什么仍用它。**只读、不写、不注册投影**，因此不会与宿主投影产生双写冲突。

**影响**：

- 宿主若移除该接口，编译期会在 `host-types.ts` 与适配器处报错，不会静默降级——这是可接受的失败方式。
- 运行期首次调用会触发宿主 `logger.warn`（`dsh-session-projection/src/index.ts:459` 的 `sessionProjections.stateOf(session, "...") is deprecated; ...`）。**这是预期日志，不是故障**，不要为此加抑制。
- **退场条件**：若后续 DSH 版本给 `UserQuestionService` 加了「列出挂起提问」的读接口，或提供了跨插件读取他人投影 handle 的正式通道，应立刻改用新接口并删除本 ADR 记录的用法。

### ADR-011：设置路由与 MCP 路由分离，TUI 只依赖 domain 层

**状态**：已接受（2026-11-17 新增）

**背景**：第 ④ 步要加「默认模型 / 思考强度 / 默认权限」的设置界面。它需要两样东西：一条能读写设置的 HTTP 通道，和一个能展示与编辑的终端界面。两条约束把方案逼窄了：

- 设置是**用户配置操作**，必须与任务接口用同一套本机认证围栏，不能因为「只是改默认值」就放宽。
- TUI 必须是**配置客户端**而不是第二个配置源（`docs/DEVELOPMENT.md` 第 5 节：不与插件各维护一份配置、不直接改写 DSH profile / 全局默认模型 / 会话文件）。

**备选方案**：

| 方案 | 做法 | 为什么不选 |
|---|---|---|
| 设置走 MCP 的 `tools/call` | 加 `dsh_settings_get` / `dsh_settings_set` 两个工具 | 设置不是「把任务委派给 DSH 会话」，塞进工具面会让 MCP 客户端把配置操作当任务；且 `tools/list` 会多出与任务无关的条目 |
| 设置路由与 MCP 路由共用 `/mcp/dsh-mcp-bridge` | 按 `Content-Type` 或路径后缀区分 | 分派器要多出一堆「不是 JSON-RPC 帧但要处理」的分支，且只认 JSON-RPC 的客户端会先撞上非法帧 |
| **独立 REST 路由 `/mcp/settings`** | `GET` 读快照、`PUT` 写默认值，复用 `auth.ts` 的围栏 | 语义清晰；认证围栏复用而非复制；MCP 端点保持纯净 |
| TUI 直接读写 `settings.json` | 绕过 HTTP，直接读 `$DSH_HOME` 下的文件 | 违反「不与插件各存一份配置」；且会绕过插件的校验（模型在不在目录里、预设可不可用），写进去的坏值只有在下次派单时才暴露 |
| TUI 起 raw-mode 单键界面 | 方向键选择、即时刷新 | Windows 的 `cmd`/PowerShell 对 raw mode 支持不一致（方向键序列、Ctrl 组合各不相同）；本界面只有三个下拉项与三个按钮，行命令足够且可复制粘贴、可脚本化 |
| **TUI 用行命令 + 只依赖 `domain/`** | `m/e/p/r/s/q` 命令，通过 HTTP 读写 | 跨平台一致；`ALLOWED_TARGETS` 加 `tui → {domain}` 让分层校验把「TUI 不许碰用例层与宿主层」变成机械约束 |

**决策**：

1. 设置路由独立成 `SETTINGS_ROUTE_PATH = '/mcp/settings'`，实现在 `src/transport/settings-route.ts`，认证复用 `src/transport/auth.ts` 的 `checkRequest`。
2. 传输层只接收 `SettingsHandlers { read, write }` 两个回调，**不 import `src/app/**`**（D5）；组装根 `src/index.ts` 把 `readSettings` / `writeSettings` 包成回调注入。
3. TUI 放 `src/tui/`，在 `scripts/check-boundaries.mjs` 的 `ALLOWED_TARGETS` 里登记 `['tui', new Set(['domain'])]`——只许依赖最内层的纯类型与纯函数。
4. CLI 入口是 `bin/dsh-mcp-bridge.mjs`（零依赖、零构建的启动脚本，动态 `import('../lib/tui/main.js')`），`package.json` 的 `bin` 指向它，`files` 补 `bin`。

**影响**：

- 好处：MCP 端点保持「只讲 JSON-RPC」；设置通道与任务通道共用同一套认证，不会有第二条更宽松的入口；TUI 无法绕过插件改配置（分层校验会拦）。
- 代价：多一条路由、多一层回调注入；`src/index.ts` 要同时注册两条路由并在失败时回滚已注册的那条。
- **未验证**：TUI 未在真实终端里跑过（只验证了 `--help` 与类型检查）；设置路由未接真实 DSH 实例（`U` 系列未验证项见 `docs/REVIEW.md` 1.2）。
- **退场条件**：若 DSH 后续提供官方的「插件设置界面」扩展点（类似 client 侧的 settings 面板），应把 TUI 换成该扩展点，本 ADR 随之失效。
