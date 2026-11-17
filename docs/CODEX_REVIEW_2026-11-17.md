# 实现审查与试运行结果

> **改名说明（后加）**：本文记录的是 2026-11-17 当时的实际操作，命令、路径与 MCP 名称均为当时的旧名 `dsh-mcp-bridge` / `dsh`。项目现已统一改名为 `codex-dsh-dispatch`，旧命令、旧登记、旧数据目录一律作废，需要按 [安装与接入](INSTALL.md) 的「从旧名升级」重做一次。本文的历史事实保持原样，未按新名改写。

本文是首次修复前的审查记录。后续修正代码和真实接入的证据见 [验收记录](ACCEPTANCE.md)；下文的问题编号和源码行号对应本次审查基线。

日期：2026-11-17。审查对象为 `63c6ca1` 加当前工作区，包括三个已修改的源码文件；未修改实现代码。

## 结论：尚不能作为可用插件交付

工作区注册、四个任务工具、默认值解析、设置接口和终端设置客户端都有实现，但原生调用、人工交互、请求恢复与目录串行执行仍有实质缺陷。`HANDOFF.md` 所说的 Browser access 开关不是唯一阻塞项；打开开关后，仍会碰到下列问题。

审查以 `docs/DEVELOPMENT.md` 和本次用户确认的需求为准，不把实现方新增的架构限制视为需求变更。特别是桥接模型设置不应修改 DSH 全局默认值，同目录的本插件任务不能同时写入，等待必须关联指定请求。

## 本次实际执行的检查

| 检查 | 实际结果 | 能证明的范围 |
| --- | --- | --- |
| `npm run typecheck` | 通过，51 个文件的依赖边界检查及 TypeScript 检查成功 | 本地手写类型下的静态检查，不代表宿主签名正确 |
| `npm run build` | 通过 | 当前源码可以生成 `lib/` |
| `node .runtime/offline-http-smoke.mjs` | 29/29 通过 | 现有 HTTP 冒烟；没有成功派单、原生审批或恢复场景 |
| 直接调用现有 `resolveStatus`，输入开放回合和待回答问题 | 返回 `running` | 重现问题 3，不是真实 DSH 会话 |
| 直接调用现有 `resolveStatus`，输入回复后的回合结束事件、但无新开始事件 | 返回 `failed` | 重现问题 4，不是真实 DSH 会话 |
| 请求当前 DSH 的 `/mcp/settings` 与 `/mcp/dsh-mcp-bridge` | 均为 `403 Browser access is disabled` | 宿主在插件之前拦截，不能据此判断插件是否加载 |
| 在真实终端启动 `node bin/dsh-mcp-bridge.mjs config`，然后输入 `q` | 正确显示上述 403 原因，退出码 1 | 终端启动、连接错误展示和退出可用；选择及保存尚无真实联调 |

终端探测仅给子进程传入临时探测字符串，没有读取或更改真实凭据。没有新增测试文件、安装插件、更改 DSH 偏好、重启 DSH 或向真实模型派单。

## 必须修复

### 1. [P1] 原生会话调用漏传必填的 AbortSignal

位置：`src/host/session-adapter.ts:62-67,137-150,203-211`；错误类型声明位于 `src/host/host-types.ts:123-147`。

适配器调用 `controller.prompt(request)`、`controller.state(request)` 和 `controller.events(request)` 时没有第二个参数。本机 DSH 的这些方法需要 `AbortSignal`；`prompt` 第一行和状态读取路径直接调用 `signal.throwIfAborted()`。原生调用不是经网关发送，网关不会替插件补参数。

因此 `dsh_start` 在读取提交前基线时就会失败，尚未到真正的 prompt；`dsh_send` 和等待中的状态/历史读取也受影响。TypeScript 没报错，是因为手写宿主类型把必填信号声明成了可选。

修复：先按本机真实签名更正声明，再为所有调用明确传信号。取消等待只取消等待；已经接收的任务不能因客户端断开被取消。

本机证据：`app.asar/node_modules/@deepseek-ai/dsh-api-session-controller/src/index.ts:468-469,543-544,576-577` 和 `src/state/controller.ts:134-135`。`@Remote` 装饰器记录方法元数据，并不为直接方法调用填充信号。

### 2. [P1] 设置桥接会话模型会改掉 DSH 全局默认模型

位置：`src/host/model-adapter.ts:42-52`，调用入口为 `src/app/start-task.ts:134-141`。

桥接使用 `sessionController.selectModel`。本机该接口除了 `agent.model.select(selected)`，还会异步执行 `agentDefaultModel.saveSelection(selected)`。因此保存并使用桥接专用模型后，用户直接在 DSH 新建的普通会话也会使用它，违反“桥接默认值只影响本插件会话”的约定。

修复：使用验证后的原生会话级选择路径，不走兼带全局默认值保存的界面接口。不要靠“先改全局、随后改回”补救，这会与用户的正常设置操作冲突。

本机证据：`app.asar/node_modules/@deepseek-ai/dsh-api-session-controller/src/commands.ts:166-185`，其中 `179-180` 同时设置会话模型和保存全局默认值。

### 3. [P1] 开放回合中的提问和审批被报成 running

位置：`src/domain/status-resolver.ts:96-106`。

一旦归属回合已开始但未结束，函数立即返回 `running`，之后才检查 `snapshot.pendingInput`。正常的等待审批或用户回答恰好发生在开放回合里，因此客户端会一直等待，而收不到 `needs_input` 的内容。

本次直接调用现有函数：`baselineTurn=0`、`startedTurn=1`、无结束事件，快照含 `pendingInput=['question']`，实际结果为 `running`。

修复：在保留已确认终态的前提下，让属于当前请求的待处理输入优先于普通 `running`；也要覆盖审批输入，不能只处理问题。

### 4. [P1] 回答开放回合的问题后，可能把成功执行报成失败

位置：`src/app/send-task.ts:88-94`、`src/host/session-adapter.ts:229`、`src/domain/turn-attribution.ts:68-71`。

对仍在开放回合的问题回复时，基线退到当前回合之前，但 `baselineCursor` 却设成回复之前的最新游标。原回合的 `turn/start` 已在该游标之前，被历史读取过滤掉；答案仍在同一回合执行，不会补发一条开始事件。

即使之后拿到这个回合的 `turn/end`，`attributeTurn` 仍因 `startedTurn === null` 先返回 `pending`。无待处理输入、会话空闲时便报 `failed`。本次直接调用状态解析函数已重现“有 completed 结束事件却返回 failed”。

修复：回复必须关联原开放回合，不能依赖回复游标之后再次出现它的开始事件。用原生回合/消息归属事实判定，并区分尚在前台等待的 `open` 问题与只接受 `answer` 的 `continued` 问题。

### 5. [P1] 插件重载后重试 dsh_start 会创建第二个任务

位置：`src/app/start-task.ts:62-74,164-176`；相关错误说明在 `src/app/deps.ts:37-43`。

请求回执只在内存 `deps.started` 中查找，函数没有实现注释承诺的“重载后按登记表 lastRequestId 找回会话”。第一次执行完成、插件重载后，用同一个请求 ID 重试会再次创建会话和提交任务。若任务已产生写入，就会重复执行。

此外，回执直到 `prompt` 成功返回后才写入内存，宿主已经接受任务但响应丢失的情况也没有恢复路径。

修复：持久化并恢复请求与会话的关联，区分已经创建、已经接收和未提交阶段；重试先核对原生接收事实，不直接新建。相同请求 ID 携带不同任务参数时也应拒绝复用。

### 6. [P1] dsh_send 失败后，同请求重试会被误认为已经提交

位置：`src/app/send-task.ts:71-82,88-116`。

函数在 `prompt` 或 `interaction.answer` 成功之前就把 `lastRequestId` 写入登记表。若提交失败，或者提问仍是 `open` 导致原生 `answer` 返回 `false`，客户端修正条件后用同一请求 ID 重试，会直接进入“重放”分支，不再调用 prompt/answer；请求事实上从未被接收。

修复：不能把“准备提交”当成“已接收”。保存提交阶段，并在失败或响应不确定时核对原生接收记录，确定是否需要继续提交；提问回答也要保留正确的接收状态。

### 7. [P1] 续聊没有目录占用检查，并发创建也存在检查空窗

位置：`src/app/send-task.ts:84-116`、`src/app/start-task.ts:74-75,112-166`、`src/app/deps.ts:119-141`。

占用检查只在 start 调用。已有会话 A 空闲、同目录会话 B 正在执行时，给 A 发送新任务仍会通过，两个会话可以同时改同一目录。两个 start 同时到达时，也可能在任一任务开始 running 之前都通过检查。

修复：在本插件的 start/send 提交入口按规范化目录串行化接收检查与提交过程，并检查其他本插件会话的在途任务。此处只协调本插件，不创建磁盘锁，也不限制用户或其他程序。

### 8. [P1] dsh_wait 的 requestId 没有关联到对应请求的基线

位置：`src/app/wait-task.ts:67-74,106-115`；覆盖基线的位置是 `src/app/send-task.ts:88-95`。

wait 虽然接受 `requestId`，但只把它用于观察缓存键，实际回合基线一律取会话登记表里的最新记录。发送 A、再发送 B 后等待 A，会使用 B 的基线；如果 A 的终态未进入缓存，就可能把 B 的结果当成 A 的结果。任意不存在的请求 ID 也没有被拒绝。

修复：按 `(sessionId, requestId)` 读取对应请求的基线和接收记录。不能匹配请求时明确报错，不能改用最新请求替代。

## 交付前也应补齐

### 9. [P2] 续聊回显的是旧源权限，不是 DSH 当前权限

位置：`src/app/send-task.ts:190-206`、`src/host/model-adapter.ts:63-74`。

用户在 DSH 中手动从 full 改成 ask 后，续聊确实不会改回去，但返回的 permission 仍按旧的 `lastSourcePermission` 宣称是 full。已有 `currentPreset` 读取能力却没有被使用；模型当前选择也恒为 null，续聊直接不返回模型，未完成开发文档要求的实际配置回读。

修复：读取原生当前权限和模型投影，区分“源端最后报告值”与“DSH 当前有效值”。不可读就标未知，不把缓存来源当成现值；读取本身不能覆盖用户的手动设置。

### 10. [P2] “跟随 DSH 默认设置”丢失 DSH 已保存的思考强度

位置：`src/host/model-adapter.ts:35-38`、`src/domain/model-choice.ts:157-171`。

宿主的 `catalog.default` 含 `reasoningEffort`，适配器只留下 provider/model。解析器随后改用模型能力声明的默认强度。例如 DSH 已保存 high、模型能力默认 medium，桥接会选 medium，而不是用户当前 DSH 默认的 high。

修复：第三层默认选择完整保留宿主的模型和强度；“指定模型但不指定强度”才按该模型默认强度解析。两种情况不能混用。

## 仍未完成的实际验收

- 当前真实宿主请求在插件之前被 Browser access 开关拦截，尚不能确认插件加载、MCP 客户端握手、真实模型执行、续聊、取消或设置保存成功。
- 现有 `reply` 只接入 `userQuestions.answer`；人工审批只有粗粒度标记，没有审批 ID、操作详情或原生审批回复入口。当前只能转到 DSH 人工处理，不能视为 Codex 端审批回复已实现。
- MCP 使用手写协议，偏离开发文档指定的官方 SDK 路线；当前 HTTP 冒烟不等于真实 MCP 客户端互操作通过。

建议先修复上述调用与状态问题，再由用户打开 DSH 的“允许浏览器访问”，按安装说明加载插件和配置独立凭据，然后进行隔离目录中的真实闭环。不要伪造桌面渲染进程凭据、修改宿主围栏或另起服务绕过当前拒绝。
