# 第 1 阶段实现说明

本文件记录第 1 阶段（插件入口 + 原生会话闭环）的落地结果：模块划分、核心接口签名、数据流、错误处理策略，以及关键设计决策的取舍理由与未验证项。

架构约束与 MCP 工具面契约以 [ARCHITECTURE.md](ARCHITECTURE.md) 为准，一致性评审与风险以 [REVIEW.md](REVIEW.md) 为准；本文件只补充「为什么这么写」和「哪些还没被证明」。

- **实现规模**：`src/` 下 42 个 `.ts`，共 4573 行。
- **可编译性**：`node scripts/check-boundaries.mjs` 通过（42 文件，exit 0）；42 个文件逐个 `node --experimental-strip-types --check` 通过。`tsc --noEmit` **未执行**（见 U1）。
- **未启动 DSH、未装依赖、未配真实凭据**，符合 `docs/DEVELOPMENT.md` 第 10 节末尾的约束。

---

## 1. 模块划分

### 1.1 分层与职责

| 层 | 目录 | 职责 | 允许依赖 |
|---|---|---|---|
| 组装根 | `src/index.ts` | 声明插件名与配置、装配端口、注册路由、`ctx.effect` 清理 | 全部 |
| 宿主适配 | `src/host/` | 把宿主服务翻译成端口；**唯一**接触宿主形状的层 | `ports`、`domain` |
| 传输 | `src/transport/` | HTTP 帧、认证围栏、SSE/JSON 分支 | `mcp`、`domain`、`ports` |
| 协议 | `src/mcp/` | 手写 JSON-RPC 分派、工具注册表、错误映射 | `app`、`domain`、`ports` |
| 用例 | `src/app/` | 四个工具的编排：校验 → 解析配置 → 建会话 → 观测 → 翻译 | `domain`、`ports` |
| 领域 | `src/domain/` | 纯函数：状态机、回合归属、占用、权限/模型选择、输出投影 | 无 |
| 端口 | `src/ports/` | 只含 `interface` / `type`，无运行时代码 | `domain`（仅类型） |

依赖方向由 `scripts/check-boundaries.mjs` 强制（D1–D7）。关键点：**`src/` 内 `@deepseek-ai/*` 的 import 数为 0**——宿主包在本机没有 `.d.ts`（ADR-009），宿主契约由 `src/host/host-types.ts` 手写结构窄化声明，每个成员注释标注来源文件与行号。

### 1.2 文件清单

```text
src/index.ts                        组装根（113 行）
src/host/
  host-types.ts      267  宿主形状的本地窄化声明（零宿主 import）
  context.ts          64  readService / requireService（ctx.get 惰性读取）
  workspace-adapter.ts 69  workspaceRegistry.create → WorkspacePort
  session-adapter.ts 368  会话七件事 + 回合进展（历史分页）
  interaction-adapter.ts 152  待回答提问与审批标记（只读）
  permission-adapter.ts  97  预设目录与套用（只消费 auto，不注册）
  model-adapter.ts    99  模型目录与选择
  registry-adapter.ts 234  state.json 持久化（node:fs，串行化）
src/ports/           7 个文件  workspace / session / interaction / permission / model / registry + index
src/domain/
  types.ts           168  六态、视图、快照、回合进展
  errors.ts           57  12 个固定错误码 + BridgeError
  status.ts           48  终态集合、迁移、mergeStatus
  turn-attribution.ts 94  T0+1 归属判定
  status-resolver.ts 116  六态翻译（唯一产生 TaskStatus 的地方）
  occupancy.ts        47  投影式占用判定
  permission-map.ts   57  三档语义值 ↔ DSH 预设 ID
  permission-choice.ts 111 三层权限解析
  model-choice.ts    190  三层模型解析
  projection/output.ts 154 事件 → 可读增量（条数 + 字节双裁剪）
src/app/
  deps.ts            142  用例共享装配（端口 + 观察缓存 + 幂等回执）
  start-task.ts      229
  wait-task.ts       192
  send-task.ts       212
  cancel-task.ts      63
src/mcp/
  dispatcher.ts      230  手写 JSON-RPC 分派
  errors.ts          101  错误码 → JSON-RPC / isError 映射
  tools/{types,index,dsh-start,dsh-wait,dsh-send,dsh-cancel}.ts
src/transport/
  route.ts            27  本地结构化路由声明 + ROUTE_PATH
  auth.ts            100  回环围栏 + Bearer 校验
  http.ts            184  Streamable HTTP（POST/GET/DELETE）
```

---

## 2. 数据流

### 2.1 一次 `tools/call` 的完整路径

```text
HTTP POST /mcp/dsh-mcp-bridge
  → src/transport/http.ts:48  createMcpHandler
      · src/transport/auth.ts:57  checkRequest：回环 + Bearer（失败 403/401/503）
      · readBody：1 MiB 上限（超限 413）
      · JSON.parse 失败 → 200 + -32700
      · AbortController + res.on('close')  ← 客户端断开只中断本次等待
  → DispatchFn（组装根绑定：dispatch(deps, message, signal)）
  → src/mcp/dispatcher.ts:77  dispatch
      · id === undefined（通知）→ { kind: 'none' } → 202 空体，绝不回帧
      · initialize / ping / tools/list / tools/call / 其余 -32601
      · tools/call → findTool → tool.run(deps, args, signal)
  → src/app/{start,wait,send,cancel}-task.ts
      · 参数校验（invalid-argument）
      · 端口调用（src/ports → src/host 适配器 → 宿主服务）
      · 领域纯函数（resolveStatus / resolvePermissionChoice / …）
  → 结果：成功 toTextResult；业务失败 toErrorResult（isError: true）；参数类失败 -32602
  → 200 + application/json 或 text/event-stream
```

### 2.2 `dsh_start`（`src/app/start-task.ts:50`）

顺序是刻意的，**配置解析全部在建会话之前**，任何一步失败都不留空会话：

1. `requireNonEmpty` 校验 `cwd` / `task` / `requestId`（`:51-53`）
2. `readSourcePermission` / `readRequestedModel` 解析可选参数（`:54-55`）
3. `isAbsolutePath(cwd)`（`:57`）——相对路径在用例层就报 `invalid-argument`，不走工作区注册
4. 幂等回执：`deps.started.get(requestId)` 命中则按登记表找回会话重观测（`:62-71`）
5. `workspace.ensureWorkspace({ cwd })`（`:73`）→ `{ workspaceId, canonicalCwd, created }`
6. `assertNotBusy(deps, canonicalCwd, null)`（`:74`）
7. `permission.availablePresets()` + `resolvePermissionChoice`（`:77-90`）
8. `model.catalog()` + `resolveModelChoice`（`:92-105`）
9. `session.createSession({ workspaceId })`（`:107`）
10. **此后任何错误都带 `location = { workspaceId, sessionId, cwd, requestId }`**（`:111-116`）
11. `permission.applyPreset`（`:118`）→ `model.applySelection`（`:129`）
12. `session.readState` 取基线（`:148`）→ `registry.upsert`（`:159`）
13. `session.prompt({ sessionId, requestId, text: task, mode: 'queue' })`（`:161`）
14. 写回执与观察值（`:171-172`），返回 `status: 'accepted'`

### 2.3 `dsh_wait`（`src/app/wait-task.ts:61`）

```text
registry.get(sessionId) → 缺失即 session-not-found
previous = observed[sessionId\0requestId] ?? null
session.wait({ afterSeq: cursor, timeoutMs, maxMessages: 50, signal })
  ├─ 抛 wait-timeout → 退回一次普通观测，output: []，超时不是失败（:87-102）
  └─ 成功 → readProgress + resolveStatus
resolveStatus({ previous, baselineTurn, progress, snapshot })
  → buildOutput：status === 'needs_input' 时补 needsInput
```

`cursor` 的语义是**上一次返回的 `cursor`**，直接当宿主的 `afterSeq` 用。它是 `SessionState.cursor`，不是「最后一条输出的 seq」——只有工具调用、没有文本的回合里游标照样前进，用后者会让客户端反复拉取已裁剪的记录。

### 2.4 `dsh_send`（`src/app/send-task.ts:54`）

- **同一 `requestId` 重放**（`record.lastRequestId === requestId`）：不重复提交、不推进基线，走完整 `observeTask` 回当前状态（`:71-82`）。这里必须走完整观测而不是「不在 running 就算 accepted」——否则一个早已 `completed` 的请求在客户端重试时会看到「已受理」然后一直等下去。
- 否则：`applyPermissionIfChanged`（仅当源权限值真正变化才同步一次）→ 取新基线 → `registry.upsert` → 清该 requestId 的旧观察值 → `prompt`。
- 提交方式固定 `queue`，不用 `steer`：`steer` 会插进正在执行的回合、可能打断正在跑的工具调用，让「一条补充说明」变成「一次上下文突变」。
- `reply` 在第 1 阶段**接受但明确报错**（`invalid-argument`），不静默忽略：宿主 `UserQuestionService.answer(agent, callId, answer)` 要求活的 `Agent` 对象且只服务 `continued` 态，桥接拿不到。

### 2.5 `dsh_cancel`（`src/app/cancel-task.ts:32`）

`registry.get` → `session.cancel`（同步，只表示受理）→ 立刻观测一次并如实报状态 → 清该会话全部观察值。`previous` 传 `null`（不继承终态）。返回的 `status` 可能是 `accepted` / `running` / `needs_input` / `completed`，**永远不会是 `cancelled`**——`cancelled` 只能由 `dsh_wait` 观察到 `turn/end.reason.kind === 'aborted'` 后报出。

---

## 3. 核心接口签名

### 3.1 端口（`src/ports/`）

```ts
interface Ports {                      // src/ports/index.ts:54
  readonly workspace: WorkspacePort
  readonly session: SessionPort
  readonly interaction: InteractionPort
  readonly permission: PermissionPort
  readonly model: ModelPort
  readonly registry: SessionRegistryPort
}

interface SessionPort {                // src/ports/session-port.ts:91
  createSession(input: CreateSessionInput): Promise<CreateSessionResult>   // { workspaceId } → { sessionId }
  prompt(input: PromptInput): Promise<PromptResult>                        // PromptInput :24
  wait(input: WaitInput): Promise<WaitOutcome>                             // WaitInput   :42
  cancel(input: CancelInput): Promise<CancelResult>
  readState(input: ReadStateInput): Promise<SessionSnapshot>
  readProgress(input: ReadProgressInput): Promise<TurnProgress>            // ReadProgressInput :78
}
```

`readProgress` 单独成方法而不是塞进 `readState`：`readState` 只读投影（O(1)），回合结束事件必须走历史分页（读会话日志），两者代价差一个量级。

`PromptResult.accepted` / `CancelResult.accepted` 是字面量 `true`，不是 `boolean`——拒绝只通过抛错表达，写成 `boolean` 会让调用方以为存在 `accepted: false` 分支。

### 3.2 领域纯函数（`src/domain/`）

```ts
resolveStatus(input: ResolveInput): ResolveResult          // :69  唯一产生 TaskStatus 的地方
expectedTurn(baselineTurn: number): number                 // :46  baselineTurn + 1
attributeTurn(input: AttributionInput): Attribution         // :64  pending | running | ended
isTurnMissing(input, running, hasPendingInput): boolean     // :86  truncated 时恒 false
mergeStatus(previous: TaskStatus | null, observed): TaskStatus  // :44
findOccupant(canonicalCwd, candidates): OccupancyConflict | null // :33
resolvePermissionChoice(input): PermissionChoiceResult      // :55
resolveModelChoice(input): ModelChoiceResult                // :93
projectOutput(events, options): ProjectResult               // :113
```

### 3.3 用例入口（`src/app/`）

```ts
startTask(deps: AppDeps, input: StartTaskInput): Promise<StartTaskOutput>   // :50
waitTask(deps: AppDeps, input: WaitTaskInput): Promise<WaitTaskOutput>      // :61
sendTask(deps: AppDeps, input: SendTaskInput): Promise<SendTaskOutput>      // :54
cancelTask(deps: AppDeps, input: CancelTaskInput): Promise<CancelTaskOutput> // :32
```

### 3.4 传输层

```ts
type DispatchFn = (message: unknown, signal?: AbortSignal) => Promise<DispatchResult>
createMcpHandler(dispatch: DispatchFn, options?: Partial<TransportOptions>): RouteHandler  // src/transport/http.ts:48
```

传输层**不接收 `AppDeps`**（D5：`transport` 不得 import `app`）。它只负责 HTTP 帧与认证围栏，用例层怎么装配由组装根绑定后传进来。

---

## 4. 关键设计决策

### D-1 手写 JSON-RPC 分派，不引入 MCP SDK

本机 `app.asar/node_modules/@modelcontextprotocol/` 只有 `client@2.2.0` 与 `core@2.2.0`；`core/dist/index.mjs` 仅 10 KB，全是 zod schema 常量，对 `StreamableHTTPServerTransport` / `McpServer` / `registerTool` 的 `includes` 计数均为 0。**没有服务端实现**。

取舍：手写 `initialize` / `ping` / `tools/list` / `tools/call` 四个方法 + 通知静默，约 230 行。代价是版本协商、`Accept` 分支要自己覆盖（见 U3）；收益是不新增依赖（第 1 阶段禁止装依赖），且协议面完全可控。第 2 阶段若要加进度通知，需要重新评估是否引入官方 SDK。

### D-2 HTTP 载体用 `ctx.webServer.register`，不自起 server

`WebServer.Config.host` 在加载期拒绝 unspecified 地址（`0.0.0.0` / `::`），只接受具体本地接口字面量——天然满足「仅本机回环」，自己 `http.createServer` 反而要重新实现这道围栏。`register` 的 handler 拥有完整响应生命周期、可长挂，`dsh_wait` 的长等待就落在这一条 POST 上。

### D-3 端口 + 适配器隔离宿主

`src/domain/` 与 `src/app/` 不接触任何宿主形状。好处不只是可测试：宿主包**没有 `.d.ts`**（ADR-009），任何 `import type { Context } from '@deepseek-ai/cordis'` 都会让 `tsc` 直接失败。端口层把宿主能力收敛成 6 个接口，`host-types.ts` 是唯一一处「重复宿主定义」的妥协，每个成员都标了来源行号。

### D-4 复用原生 `wait`，不自建轮询

`sessionController.wait` 内部已经做了「状态变化 vs `whenIdle()` 竞速」和超时兜底（`state/controller.ts:57-123`）。自建轮询要么更慢，要么复刻同一套竞态逻辑。

配套的硬约束：**`signal` 只取消本次等待，绝不取消会话执行**。`src/transport/http.ts` 在 `res.on('close')` 时 abort 的只是那个 `AbortController`；适配器把中断转成 `wait-timeout`（「等待被中断，会话仍在执行」），不调 `cancel`。取消执行只能由 `dsh_cancel` 显式发起。

### D-5 `requestId` 直接透传，不自建去重表

宿主 `prompt()` 首行即 `hasPromptRequest(agent.session, request.requestId)` 检查并按 `source.rpcId` 重放去重。自建表会形成两份事实源，插件重载后必然不一致。

唯一的例外是 `dsh_start`：它每次都会**新建会话**，宿主的会话内去重覆盖不到，所以桥接自己持有一份 `deps.started` 回执（内存，不落盘）。

### D-6 回合归属固定 `T0 + 1`，且必须携带全部 `turn/end`

提交前读 `lastTurn` 记 T0，对应回合**固定**是 `T0 + 1`。不能用「游标后第一个 turn」或「最大 turn」：`mode: 'queue'` 下会话可能连跑多回合，`end.turn === T0+1` 会被误判 running（漏报完成）、`end.turn === T0+2` 会被误判 ended（把下一回合算成本请求），两种误判方向相反但都错。所以 `TurnProgress.ends` 是**全部** `turn/end`，按 `turn === T0+1` 精确匹配。

`turn-missing` 显式报 `failed` 而不是 `completed`：会话在对应回合出现前就空闲，只能说明「我们没看到它跑」，不能说明「它跑完了」。

### D-7 截断是「没看到」，不是「不存在」

`readProgress` 最多回溯 5 页 × 200 条。翻完仍未覆盖提交点时置 `truncated: true`，`isTurnMissing` 首行 `if (input.truncated === true) return false`。**误报 `failed` 比多等一轮更伤**——前者会让客户端重派任务、在同一个目录里并发跑两份。

### D-8 串行占用用投影，不维护锁表

`cwd 被占用 ⟺ 该 cwd 下存在本插件创建、且 readState().running === true 的会话`。独立锁表在插件重载后必然与真实执行状态脱节（锁还在、任务已死；或任务在跑、锁已丢）。占用只约束本插件派发的任务，不锁用户、不锁文件系统。

### D-9 权限「只消费不注册」，且不猜不降级

`auto` 预设由已启用的 `@deepseek-ai/dsh-experimental-auto-review` 通过 `permissionPresets.registerAuto()` 发布；桥接再调会抛 `permission: preset "auto" is already registered`（`dsh-permission-presets/src/index.ts:307`）。所以桥接只读 `names` / `catalog()` 判断可用性。

三层解析顺序 `源权限 → 桥接默认 → 初始 ask`。读不到可用预设时**保留真实 `source`**、只把 `presetId` 置 `null` 且 `apply: false`——「初始值 ask + 读不到预设」与「源会话要 full + 读不到预设」安全含义完全不同，把 source 抹成 `unknown` 会丢掉这个区别。预设不存在则明确报 `permission-unavailable`，绝不静默降级成 `full`（放宽权限是安全事故）或 `ask`（收紧是行为变化）。

### D-10 输出投影：只给文本与摘要，双上限

`wait.output.records` 是 `SessionEventEntry[]`，不是纯文本。`src/domain/projection/output.ts` 只投影 `assistant/message` 的 **text 块**（跳过 reasoning）、`tool/call` 的名字 + 200 字符参数预览、`tool/result` 的 `isError`。条数（`maxRecords`）与字节（`TOTAL_TEXT_LIMIT = 16000`）双上限，任一触发都如实置 `truncated: true`。

### D-11 `state.json` 用 `node:fs`，不引入 `storageDomain`

`storageDomain` 需要额外 backend 配置 + `defineDomain` + zod schema + version，而本插件只存几十行扁平 JSON，收益只有格式校验。写入走「`mkdir` → 写 `.tmp` → `rename`」防半截 JSON；全部读写串行化在一个 Promise 链上（`dsh_start` 与 `dsh_send` 可能并发，整文件「读-改-写」不原子）。JSON 损坏时 warn + 空表且**不覆盖原文件**（保留现场）。

只存 `{ version, sessions: { sessionId: { workspaceId, canonicalCwd, lastRequestId, lastSourcePermission, baselineTurn, baselineCursor } } }`。`baselineTurn` 必须落盘：回合归属判定式是 `T0 + 1`，而 `dsh_wait` / `dsh_cancel` 是后续独立请求，不持久化就只能在重载后重新猜。

### D-12 插件不声明 `inject`

宿主服务可能晚于本插件就绪（典型是 `webServer` 要等端口绑定）。声明 `inject` 会让插件在服务缺失时根本不加载；改为调用时 `ctx.get()` 惰性读取，缺失返回固定错误码 `host-capability-missing`，插件本身照常加载。

`webServer` 缺失时只 `warn` 不抛（`src/index.ts:60-66`）——抛错会让整个 profile 加载失败，代价远大于「本插件暂时不可用」。

### D-13 `ctx.effect` 的语义容易写反

cordis 的 `effect(execute)` 体内**立即同步执行** `execute`，它的**返回值**才是清理函数（`@deepseek-ai/cordis/src/fiber.ts` 的 `_execute` 把返回的函数收集为 disposer）。写成 `ctx.effect(() => { unregister?.() })` 会在注册成功后**当场注销路由**，且不报错。正确形态见 `src/index.ts:94-100`：

```ts
ctx.effect(() => () => { unregister?.(); unregister = undefined }, 'dsh-mcp-bridge: mcp route')
```

`src/host/host-types.ts:252-267` 的签名与注释已固化该语义。没有收严到只接受 `() => () => void`——宿主里存在 `() => { ...; return () => {...} }` 带前置副作用的合法形态。

---

## 5. 错误处理策略

### 5.1 固定错误码（`src/domain/errors.ts:9`）

| 码 | 含义 | 客户端该做什么 |
|---|---|---|
| `invalid-argument` | 缺字段、类型不对、互斥字段同时出现 | 改参数，重试无意义 |
| `workspace-rejected` | 目录不存在 / 不是目录 / 不是绝对路径 | 改 `cwd` |
| `workspace-busy` | 同目录已有本插件的任务在跑 | 读 `detail.busy`，等或换目录 |
| `session-not-found` | 会话不存在或不属于本插件 | 重新 `dsh_start` |
| `model-unavailable` | 请求的模型不在当前 Profile | 改 `model` |
| `reasoning-effort-unavailable` | 该模型不支持这个强度 | 改 `reasoningEffort` 或省略 |
| `saved-model-invalid` | 桥接保存的默认模型已失效 | 重设默认值（第 ④ 步） |
| `permission-unavailable` | 请求的档位在当前环境不存在（典型：`auto` 但未启用自动审查） | 改 `sourcePermission` |
| `host-capability-missing` | 宿主缺少本插件依赖的能力 | 环境问题，需人工处理 |
| `turn-missing` | 会话在对应回合出现前就空闲 | 任务可能没跑起来，可重派 |
| `wait-timeout` | 等待超时 | 带同一 `cursor` 继续 `dsh_wait` |
| `internal` | 桥接内部错误 | 报告问题；不带宿主堆栈 |

新增可以，改名或删除会破坏客户端契约。

### 5.2 `isError` 与 `-32602` 的界线（`src/mcp/errors.ts`）

- **工具根本没跑起来**（缺 `cwd`、`cwd` 不是绝对路径、`requestId` 为空、`model` 只给一半）→ JSON-RPC 错误 `-32602`。客户端应认为「我的请求写错了」。
- **工具跑起来但业务失败**（`workspace-busy` / `session-not-found` / `turn-missing` / `wait-timeout`）→ HTTP 200 + `result.isError = true`，结构化错误放在 `content` 里。

`INVALID_PARAMS_CODES` 是固定枚举（`:39`）：`invalid-argument`、`model-unavailable`、`reasoning-effort-unavailable`、`saved-model-invalid`、`permission-unavailable`。后四个虽然发生在执行期，但对客户端而言仍是「参数与环境不匹配」，换参数才能继续。混用会让客户端无法区分「参数写错」（不该重试）与「任务失败」（可能该重试）。

### 5.3 失败隔离

| 场景 | 行为 |
|---|---|
| 单个 `tools/call` 抛错 | `isError: true`，不关 SSE、不影响其他工具 |
| `dsh_wait` 被中断 | 只结束本次等待，**绝不 abort 会话执行** |
| 一个会话失败 | 不传染到其他会话 |
| 占用检查 | 不锁文件系统，只读投影 |
| 可选服务缺失 | `ctx.get()` 惰性读，返回固定错误码，插件照常加载 |
| 配置失效 | 新建会话明确报错 + 附已创建会话定位信息（`location`） |
| 卸载 | `ctx.effect` 只注销本插件注册的路由；已创建的 DSH 会话保留 |
| 认证失败 | 401/403/503，不透内部错误与路径 |

### 5.4 认证围栏（`src/transport/auth.ts:57`）

非回环 → `403 forbidden: loopback-only`；未配置凭据 → `503`（**fail closed**，不是放行）；缺 Bearer → `401`；不匹配 → `401`。比对走定长比较（长度不同也走完整轮）。凭据只从 `DSH_MCP_BRIDGE_TOKEN` 环境变量读，不进源码 / Git / profile 配置 / 任务正文 / 日志。

`isLoopbackAddress` 会把 `::ffff:127.0.0.1` 递归剥成 IPv4 再判——Node 双栈监听时 IPv4 连接报成这个形式，漏判会让所有本机请求被拒。

---

## 6. 验证证据

| 手段 | 结果 | 等级 |
|---|---|---|
| `node scripts/check-boundaries.mjs` | 依赖规则校验通过（42 个文件），exit 0 | ✅ 真实执行 |
| `node --experimental-strip-types --check <file>` × 42 | 全部 exit 0 | ✅ 真实执行（仅语法，不含类型） |
| 传输层离线冒烟（假 `req`/`res`） | 401/403/503、405、204、JSON/SSE 双分支、202 通知静默、`-32700`、413 全部符合契约 | ✅ 离线冒烟通过（未进仓库、未装依赖、未启动 DSH） |
| 分派器离线冒烟 | 版本协商（表内原样回 / 表外回落 `2025-11-25`）、`ping`、`tools/list` 四工具无 `nextCursor`、`-32600`/`-32601`/`-32602` 分界正确 | ✅ 离线冒烟通过 |
| 领域层离线冒烟 | `expectedTurn`、`attributeTurn` 四态、`isTurnMissing`（含 `truncated`）、`resolveStatus` 六态映射、`mergeStatus`、`resolvePermissionChoice` 七例、`projectOutput` 裁剪、`findOccupant` 全部符合契约 | ✅ 离线冒烟通过 |

冒烟脚本未进仓库（在临时目录，把 `src/` 复制后批量改 `.js` → `.ts` 后缀，用 `node --experimental-transform-types` 跑——strip-only 模式不支持 `constructor(readonly code: ...)` 这类参数属性）。

---

## 7. 未验证项清单

| # | 未验证项 | 原因 | 解除条件 |
|---|---|---|---|
| U1 | **类型正确性**（`tsc --noEmit` 通过） | 本机无可用 `tsc`：项目无 `node_modules`，全局 npm 目录只有 `cnpm http-server pnpm sass`，`app.asar/node_modules/typescript` 不存在。`--check` 只做语法检查 | 用户授权安装 `devDependencies`（`typescript` + `@types/node`）后跑 `npm run typecheck` |
| U2 | **插件能被 DSH 真实加载** | `docs/DEVELOPMENT.md` 第 10 节末明确「不启动应用进行联调」 | 第 ⑤ 步获授权联调 |
| U3 | **真实 MCP 客户端的版本协商与 SSE 行为** | 离线冒烟的 `Accept` 头是手搓的。Codex 会不会发 `Accept: application/json, text/event-stream` 双值、`initialize` 前会不会先发别的、SSE 断流怎么重连，全未验 | 第 ⑤ 步 |
| U4 | `locale` / `icon.svg` 元数据 | 本阶段不建 `locale/`、无图标，`package.json` 的 `files` 也未含它们 | 第 ④ 步建目录时**必须同步补 `files`**，否则发布会漏文件 |
| U5 | **宿主 `state/controller.ts` 的 `wait` 行为在真实会话下的表现** | 只读了源码，没跑过真实会话。特别是「等待期内一次状态都没拿到就抛 `session/wait-timeout`」的触发条件 | 第 ⑤ 步 |
| U6 | **`sessionProjections.stateOf(session, 'userQuestions')` 的实际返回形状** | 该方法已标 `@deprecated`，本插件是只读消费方仍用它。投影状态的字段名（`active` / `callId` / `questions`）按源码推断，未在真实会话里验证过 | 第 ⑤ 步；若形状不符，`needsInput` 会降级为 `{ kind, callId: null, questions: [] }`（仍报 `needs_input`，不退回 `running`） |
| U7 | **`permissionPresets.current(session)` 与 `modelSelection` 投影的回读** | 第 1 阶段不消费（`currentSelection` 恒 `null`），留给第 2 阶段 | 第 ② 步 |
| U8 | **`workspaceRegistry.create` 的 `created` 判定** | 宿主不暴露 created 标志，用调用前后 `list().length` 差推断。并发注册同一路径时可能误判（但 `create` 本身幂等，影响仅限返回值） | 第 ⑤ 步观察 |

---

## 8. 与设计文档的偏差

| # | 文档原文 | 实现 | 理由 |
|---|---|---|---|
| 1 | `docs/DEVELOPMENT.md` 第 4 节：`create({ cwd })` + `workspace.attachSession(sessionId)` 回退路径 | 只走 `create({ workspaceId })` | `attachSession` 确实存在，但 `sessionController.create({ workspaceId })` 内部已调用它（`dsh-api-session-controller/src/commands.ts:147-157`）。桥接再 attach 一次是重复；且 `workspaceId` 与 `cwd` 互斥，两条路径不能同时存在 |
| 2 | ARCHITECTURE §5.3：`dsh_send` 输出「与 `dsh_start` 同形」 | 返回 `{ sessionId, requestId, status, cursor, permission }`，**无 `model`** | `dsh_send` 不接受模型参数，第 1 阶段又无法回读会话当前生效模型，返回恒 `unknown` 的字段会让客户端误以为模型被改过 |
| 3 | ARCHITECTURE §5.2：`needsInput` 含 `approvalCount`（早期草稿） | `hasApproval: boolean`（端口内部字段，不进返回体） | 宿主 `pendingInput` 是 `Set` 去重后的**种类**列表，同时挂 3 个审批也只出现一个 `'approval'`，数出来恒为 1 |
| 4 | `docs/DEVELOPMENT.md` 第 7 节：`dsh_send` 支持 `reply` | 接受参数但明确报 `invalid-argument` | 宿主 `UserQuestionService.answer(agent, callId, answer)` 要求活的 `Agent` 对象且只服务 `continued` 态，桥接拿不到 |
