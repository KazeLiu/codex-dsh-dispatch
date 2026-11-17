# 架构评审：一致性、风险与阶段衔接

> **改名说明（后加）**：本文记录的是 2026-11-17 当时的实际操作，命令、路径与 MCP 名称均为当时的旧名 `dsh-mcp-bridge` / `dsh`。项目现已统一改名为 `codex-dsh-dispatch`，旧命令、旧登记、旧数据目录一律作废，需要按 [安装与接入](INSTALL.md) 的「从旧名升级」重做一次。本文的历史事实保持原样，未按新名改写。

评审基线：`docs/ARCHITECTURE.md`（分层、依赖规则、端口契约、MCP 工具面、状态机、ADR）。
评审对象：`package.json`、`tsconfig.json`、`scripts/check-boundaries.mjs`，以及后端落地的 `src/` 树。

**评审时点**：后端已落全部 **51 个 `.ts`**（`src/domain/**` 12、`src/ports/**` 8、`src/host/**` 9、`src/app/**` 6、`src/mcp/**` 8、`src/transport/**` 4、`src/tui/**` 4、`src/index.ts` 1），以及 `bin/dsh-mcp-bridge.mjs`、`locale/{en,zh}.json`、`icon.svg`、`cordis.patch.yml`、`package.json`、`tsconfig.json`、`scripts/check-boundaries.mjs`、`docs/INSTALL.md`。1.1 是包与配置层结论，1.2 是未验证项，1.3 是逐条核对（✅ 有文件与行号可查、⏳ 依赖尚未出现的层、⚠️ 待改、⏸ 有意延后），1.4 是回写给后端的修正项，1.5 是第 ④ 步新增范围（设置路由 / TUI / CLI 入口）的自检修正项。**第 ⑥ 步只完成文档与包元数据侧，真实闭环未通过，不声称插件可用。**

**第 ④ 步新增范围**：设置读写路由（`src/transport/settings-route.ts`，`GET`/`PUT /mcp/settings`）、TUI（`src/tui/**` + `bin/dsh-mcp-bridge.mjs`）、`dsh_send` 的 `reply` 走原生 `answer`。对应核对项见 1.3 的 D8 与 T9–T12。

## 1. 与后端实现的一致性评审

### 1.1 已核对项（有实际文件可查）

| # | 检查点 | 结论 | 依据 |
|---|---|---|---|
| C1 | 包形态是 DSH 插件（`type: module` + `dsh.bundle.patch`） | ✅ 通过 | `package.json:6` `"type": "module"`；`package.json:29-33` `dsh.bundle.patch: ./cordis.patch.yml` |
| C2 | 入口指向 `lib/index.js` 且带类型声明 | ✅ 通过 | `package.json:7-8`、`package.json:9-15` |
| C3 | 严格模式与 `exactOptionalPropertyTypes` | ⚠️ 配置正确但未验证 | `tsconfig.json:8-16`；`exactOptionalPropertyTypes: true` 对端口可选字段（`openTurnStartSeq?`）是必要的，否则 `undefined` 会被当成合法赋值。但本机**没有可用的 `tsc`**（项目无 `node_modules`、全局与 asar 内均无 typescript），该配置至今未被真正执行过一次，见 C13 |
| C4 | 输出目录 `lib`、源码根 `src` | ✅ 通过 | `tsconfig.json:22-23` |
| C5 | `@deepseek-ai/*` peer 版本范围与本机匹配 | ✅ 已修正 | 后端已删除 `cordis` 那条永不匹配的 peer，现 `peerDependencies` 只剩 5 条 `>=0.2.0-rc.1 <0.3.0-0`（`dsh-host-webserver`/`dsh-api-session-controller`/`dsh-permission-presets`/`dsh-workspace`/`dsh-session`），与本机 `0.2.2-rc.3` 全部匹配 |
| C6 | `files` 覆盖全部运行时文件 | ✅ 已解决 | `package.json` 的 `files` 现为 `["lib","!lib/**/*.map","bin","locale","icon.svg","cordis.patch.yml","README.md"]`，覆盖全部运行期文件、排除 sourcemap；`locale/{en,zh}.json`（256/230 字节）与 `icon.svg`（1393 字节）已建，`bin/` 已补。**第 ④ 步按本条要求同步补了 `files`**，未留到第 ⑥ 步才发现 |
| C7 | 无构建期新增依赖 | ✅ 通过 | `devDependencies` 仅 `@types/node`、`typescript`；无打包器 |
| C8 | 无 `@modelcontextprotocol/sdk` 依赖 | ✅ 通过 | `package.json` 全文无该依赖，符合 D6 |
| C9 | `domain/types.ts` 零宿主依赖、六态齐、注释中文 | ✅ 通过 | `src/domain/types.ts:1-60`；`TaskStatus` 六态齐全，`PermissionLevel` 三档，全文无 import |
| C10 | `domain/types.ts` 的 `source` 枚举语义 | ✅ 已修正 | 已改为 `PermissionSource = 'source-session' \| 'bridge-default' \| 'initial' \| 'unknown'`、`ModelSource = 'request' \| 'bridge-default' \| 'dsh-default' \| 'unknown'`（`src/domain/types.ts:18`、`:21`）。补充结论：`permission.source` 的 `unknown` 在第 1 阶段**不会产生**（三层顺序保证 `level` 恒有值，读不到预设只影响 `presetId`），`model.source` 的 `unknown` 会用到（目录为空时），见 ARCHITECTURE §5.6 |
| C11 | 分层规则可机械校验 | ✅ 通过 | `scripts/check-boundaries.mjs` 覆盖 D1/D2/D3/D4/D5/D6/D7，已用故意违规探针验证全部命中，当前 `src/` 通过 |
| C12 | 构建脚本引用的配置文件存在 | ✅ 已修正 | `package.json` 的 `scripts.build` 已改为 `tsc`（原为 `tsc -p tsconfig.build.json`，而该文件不存在）。`tsconfig.json` 的 `outDir: lib` / `rootDir: src` / `declaration: true` 已覆盖构建需求，不再引入第二份配置 |
| C13 | 宿主包类型声明可得性 | ✅ 已决策（ADR-009） | 见下方「C13 详细」。`app.asar/node_modules/@deepseek-ai/*` 的 `.d.ts` 总数为 **0**，`types` 字段指向的 `lib/types/index.d.ts` 全部缺失，`lib/types/` 里只有 `.js`。决策：`src/host/host-types.ts` 本地结构窄化，**连 `Context` 都不 import**，`src/` 内 `@deepseek-ai/*` import 数目标为 0 |

**C5 的具体修法**（二选一，倾向后者）：

- 改 range 为 `>=4.0.0 <5.0.0`；
- 或直接删除 `cordis` 这条 peer 与对应的 `peerDependenciesMeta` 条目——插件运行时由宿主注入 `ctx`，不需要自己声明 cordis 依赖；声明一个永不匹配的 range 只会在安装期制造噪声。

**已采用后者**：`peerDependencies` 现只剩 5 条 `>=0.2.0-rc.1 <0.3.0-0`（`dsh-host-webserver`/`dsh-api-session-controller`/`dsh-permission-presets`/`dsh-workspace`/`dsh-session`），与本机 `0.2.2-rc.3` 全部匹配。

参考实现 `dsh-config-manager` 的写法可作为依据：它的 `peerDependencies` 全部用 `>=0.1.0-rc.6 <0.3.0-0`，`cordis` 单独走 `devDependencies` 的 `^4.0.1`。也就是说「cordis 是 4.x 系列、其余 DSH 包是 0.2.x 系列」是宿主生态的既定事实，把 cordis 塞进 `>=0.2.0-rc.1 <0.3.0-0` 是笔误。

**C12 的具体修法**（二选一）：

- 删掉 `scripts.build` 里的 `-p tsconfig.build.json`，直接 `tsc`（`tsconfig.json` 已经 `outDir: lib`、`rootDir: src`，无需要第二份配置）；
- 或补一份 `tsconfig.build.json`：`{"extends": "./tsconfig.json", "exclude": ["src/**/*.test.ts"]}`。第 1 阶段没有测试文件，倾向第一种——少一个文件就少一处漂移。

**已采用第一种**：`scripts.build` 现为 `tsc`。

**C13 详细：宿主包零 `.d.ts`，`src/host/` 的类型从哪来**

实测（用 `ELECTRON_RUN_AS_NODE=1` 遍历 `app.asar/node_modules/@deepseek-ai/`）：

- 全部 `@deepseek-ai/*` 包的 `.d.ts` 文件总数 = **0**；
- 各包 `package.json` 的 `types` 字段都指向 `./lib/types/index.d.ts`，但该文件**不存在**（`dsh-agent`、`dsh-host-webserver`、`cordis`、`dsh-api-session-controller` 逐一 stat 均 MISSING）；
- `lib/types/` 目录里只有 `.js`（如 `dsh-agent/lib/types/index.js` 是 21644 字节的真实现，含 `import { getTraceable, Service, symbols } from '@deepseek-ai/cordis'`），不是类型空壳；
- 但各包 `src/` 目录**确实随包发布 TS 源码**，且 `exports` 含 `"./src/*": "./src/*"`。

后果：`import type { Context } from '@deepseek-ai/cordis'` 在 tsc 下会解析到缺失的 `.d.ts`，报 `TS7016`（隐式 any）或因 `types` 指向缺失文件而直接解析失败。三条出路：

| 方案 | 做法 | 代价 | 评价 |
|---|---|---|---|
| ① 装宿主包拿类型 | `devDependencies` 加 `@deepseek-ai/*`，照参考实现 | 公共 npm 上 `npm view @deepseek-ai/dsh-agent versions` **无输出**，该 scope 不可得；且要求开发机联网装 20+ 包 | ❌ 不可行（至少现在） |
| ② 本地结构窄化 | `src/host/` 内自己声明所需的最小结构（`Context`、`WebRoute`、`SessionController` 等），完全不 import 宿主类型 | 需手写约 100 行声明，宿主升级时手动跟进 | ✅ **推荐**，与参考实现 `dsh-config-manager/src/routes/kit.ts` 同一手法 |
| ③ 环境声明文件 | `types/deepseek.d.ts` 里 `declare module '@deepseek-ai/*'` 给 `any` | 最省事，但 `any` 会绕过 D1 之外的全部类型保护，且 `strict` 形同失效 | ⚠️ 仅作临时兜底 |

选 ②，并把「宿主结构窄化声明放 `src/host/host-types.ts`，只声明实际用到的成员」写进 `docs/ARCHITECTURE.md`（已补 ADR-009）。这样 `@deepseek-ai/*` 的 import 数量降到 **0**，D1 从「限制范围」变成「天然满足」，同时不依赖任何外部包可得性。

**ADR-009 的实现细节（后端已确认）**：`host-types.ts` 里**连 `Context` 都不 import**，而是本地声明 `HostContext`：

```ts
// 只声明本插件实际用到的成员，来源标注到 asar 内 src/*.ts 行号
export interface HostContext {
  readonly webServer?: WebServerLike
  readonly workspaceRegistry?: WorkspaceRegistryLike
  // ...
  get(serviceName: string): unknown
}
```

`apply(ctx: HostContext, config?: Config)` 的 `ctx` 参数就用这个本地类型，**不写 `import type { Context } from '@deepseek-ai/cordis'`**。`apply` 的签名与 cordis 的期望不是名义一致，只能靠结构兼容——可接受，因为 cordis 是结构化调用（`ctx.get` / `ctx.effect` / `ctx.logger`），不依赖类型身份。

### 1.2 未验证项（无法取得证据的部分）

| # | 未验证项 | 原因 | 解除条件 |
|---|---|---|---|
| U1 | ~~类型正确性（`tsc --noEmit` 通过）~~ | **已解除**：`devDependencies` 已安装，`npx tsc --noEmit` 0 错误，`npx tsc` 构建出 `lib/` 全量产物 | — |
| U2 | 插件能被 DSH 真实加载 | `docs/DEVELOPMENT.md` 第 10 节末明确「不启动应用进行联调」 | 第 ⑤ 步获授权联调 |
| U3 | MCP 客户端的版本协商与 SSE 行为 | 同上，无真实客户端 | 第 ⑤ 步 |
| U4 | ~~`locale`/`icon.svg` 元数据~~ | **已解决**：`locale/{en,zh}.json` 与 `icon.svg` 已建，`package.json` 的 `files` 已补全（C6 关闭） | — |
| U5 | 宿主 `state/controller.ts` 的 `wait` 在真实会话下的表现 | 无真实会话可跑；尤其「等待期内一次状态都没拿到就抛 `session/wait-timeout`」的触发条件未知，而 `src/app/wait-task.ts` 把它降级成「退回一次普通观测」正是依赖这一点 | 第 ⑤ 步：跑一个真实回合，确认超时分支不是常态 |
| U6 | `sessionProjections.stateOf(session, 'userQuestions')` 的实际返回形状 | 该 API 已标 `@deprecated`（ADR-010），且只能读、无法在离线环境造出真实投影 | 第 ⑤ 步：触发一次 `ask_user_question`，核对 `questions.active[].state` 与 `callId` 是否如 `dsh-user-questions/src/projection.ts` 所声明 |
| U7 | `permissionPresets.current(session)` 与 `modelSelection` 投影回读 | 第 1 阶段刻意不回读（`ModelPort.currentSelection` 恒 `null`），未做验证 | 第 2 阶段接入回读时一并验证 |
| U8 | `workspaceRegistry.create` 的 `created` 判定 | 宿主未暴露 `created` 标志，`src/host/workspace-adapter.ts` 用 `registry.list().length` 调用前后差推断；并发注册同一路径可能误判 | 影响仅限返回值（`create` 本身幂等），第 ⑤ 步顺带核对 |
| U9 | 设置路由在真实 DSH 实例上的读写 | 无运行中的插件实例，`GET`/`PUT /mcp/settings` 只做过类型检查与静态核对 | 第 ⑤ 步：在真实实例上 `GET` 一次快照、`PUT` 一次默认值，确认落盘到 `$DSH_HOME/dsh-mcp-bridge/settings.json` |
| U10 | TUI 在真实终端里的交互 | 只验证了 `node bin/dsh-mcp-bridge.mjs --help` 与类型检查；未在交互式终端里跑过 `m/e/p/r/s/q` 全流程 | 第 ⑤ 步：在 Windows Terminal 与 `cmd` 各跑一遍 |
| U11 | `dsh_send` 的 `reply` 走原生 `answer` 的真实行为 | 需要一次真实挂起的 `ask_user_question`；离线只能验证参数形状与错误映射 | 第 ⑤ 步：让模型问一个问题，用 `dsh_wait` 拿到 `needs_input`，再 `dsh_send({ reply })` |
| U12 | `reply` 的回合基线退一格（`lastTurn - 1`）是否总能匹配 | 依赖「答案作为 steering 消息塞进当前开放回合」这一宿主行为；离线无法造出真实回合 | 第 ⑤ 步：`reply` 后 `dsh_wait` 应报 `completed` 而不是 `turn-missing` |

**关于 U1 的解除过程**：`docs/DEVELOPMENT.md` 第 10 节末尾的硬约束原文是「当前不新增或运行测试，不启动应用进行联调，**不安装依赖**或配置真实凭据」。第 1 阶段据此**没有装 tsc**，当时只有两条可用证据：`node scripts/check-boundaries.mjs`（依赖方向）与 `node --experimental-strip-types --check <file>`（逐文件语法），类型正确性靠人工核对。**该约束已由 lead 解除**：`devDependencies` 装上 `typescript` 后，`npx tsc --noEmit` 报 0 错误、`npx tsc` 构建出 `lib/` 全量产物，U1 因此关闭。此后每个阶段都以 `npm run typecheck`（= 边界校验 + `tsc --noEmit`）作为准入证据。

**U5–U8 的来源**：后端在 `docs/IMPLEMENTATION.md` 第 7 节自报了 8 条未验证项，其中 U1–U4 与本表同名同义，U5–U8 是实现层独有的，已合并进本表以保持**单一清单**——两份文档各留一份会漂移。`docs/IMPLEMENTATION.md` 第 8 节自报的 4 条「与设计文档的偏差」也已与本文件 1.4 及 `docs/ARCHITECTURE.md` §5.3/§5.6 交叉核对，无矛盾。

### 1.3 逐条核对（全部 51 个 `.ts` 已核完）

后端已落 `package.json`、`tsconfig.json`、`scripts/`、`cordis.patch.yml`、`bin/dsh-mcp-bridge.mjs`，以及 `src/` 全部 51 个 `.ts`（`domain` 12 / `ports` 8 / `host` 9 / `app` 6 / `mcp` 8 / `transport` 4 / `tui` 4 / `index.ts` 1）。下表「✅」项均有文件与行号可查；「⏳」项已全部清零；「⚠️」项指向 1.4 的对应编号。`node scripts/check-boundaries.mjs` → 51 文件通过，exit 0；`npx tsc --noEmit` → 0 错误。

#### 依赖方向

| # | 检查点 | 结论 | 依据 |
|---|---|---|---|
| D1 | `src/` 内 `@deepseek-ai/*` 的 **import 语句**为 0（只允许出现在注释里） | ✅ | `grep -rn "@deepseek-ai/" src/` **零命中**（连注释都没有了）。宿主 API 全部经 `src/host/host-types.ts` 的本地结构窄化进入，ADR-009 目标值达成 |
| D2 | `src/domain/**` 无 `node:http`/`fs`、无宿主包、无 `../host` | ✅ | `grep -rnE "node:(http|https|fs|net|tls)|from '\.\./host" src/domain` 无输出 |
| D3 | `src/ports/**` 只含 interface/type | ✅ | 8 个文件全部为 `export interface` / `export type`；`scripts/check-boundaries.mjs` 的 D3 判定通过（已补 `const enum`/`declare function` 判定） |
| D4 | `src/mcp/**` 无 `src/host/**` | ✅ | `grep -rn "host/" src/mcp/` 无输出；`src/mcp/tools/*` 只 import `../../app/*` 与同级 `./types.js` |
| D5 | `src/transport/**` 无 `src/host/**`、`src/app/**` | ✅ 已修 | 原 `src/transport/http.ts:20` 有 `import type { AppDeps } from '../app/deps.js'`（同时触发 D5+D7）。已改为接收 `DispatchFn` 回调（`src/transport/http.ts:26-36`），由组装根 `src/index.ts` 绑定 `dispatch(deps, …)`。**新增的 `src/transport/settings-route.ts` 同样只 import `../domain/*` 与同级 `./auth.js`/`./http.js`/`./route.js`**，接收 `SettingsHandlers` 回调 |
| D6 | 无 `@modelcontextprotocol/sdk` | ✅ | `grep -rn "@modelcontextprotocol" src/` 无输出 |
| D7 | 无跨层横向相对路径 | ✅ | `node scripts/check-boundaries.mjs` → 「依赖规则校验通过（51 个文件）」，exit 0 |
| D8 | `src/tui/**` 只依赖 `src/domain/**` 与同层文件 | ✅ | `ALLOWED_TARGETS` 已登记 `['tui', new Set(['domain'])]`。四个文件的全部外部 import：`state.ts` → `../domain/settings.js`、`../domain/types.js`；`render.ts` → `../domain/settings.js`、`./state.js`；`client.ts` → `../domain/settings.js`（HTTP 用全局 `fetch`/`AbortController`，无 `node:` import）；`main.ts` → `node:readline/promises`、`../domain/types.js`、`./client.js`、`./render.js`、`./state.js`。**零 `src/host/**`、零 `src/app/**`、零 `@deepseek-ai/*`** |

#### 端口契约

| # | 检查点 | 结论 | 依据 |
|---|---|---|---|
| P1 | `SessionPort.readState` 返回体含 `openTurnStartSeq` 与 `lastTurn` | ✅ | `src/domain/types.ts` 的 `SessionSnapshot` 含 `openTurnStartSeq: number \| null` 与 `lastTurn: number`；`src/host/session-adapter.ts` 的 `toSnapshot` 从 `readTurnBoundary` 填充 |
| P2 | `SessionPort.wait` 直接映射原生 `wait`，无自建轮询 | ✅ | `src/host/session-adapter.ts` 的 `wait` 直接 `controller.wait(...)`，只把 `session/wait-timeout` 转成 `wait-timeout` 固定码；无 `setTimeout` 循环 |
| P3 | `SessionPort.cancel` 返回「请求是否被接受」，不含 `cancelled` | ✅ | `CancelResult{accepted}`；`src/host/session-adapter.ts` 的 `cancel` 返回 `{ accepted: result.accepted }`，未合成状态 |
| P4 | `WorkspacePort.ensureWorkspace` 返回 `canonicalCwd`（realpath） | ✅ | `src/host/workspace-adapter.ts` 返回 `canonicalCwd: workspace.path`（宿主 `create` 内部已 realpath 规范化） |
| P5 | 走 `create({ workspaceId })`，桥接不重复 attach | ✅ | `src/host/session-adapter.ts` 的 `createSession` 只传 `workspaceId`；`CreateSessionInput` 无 `cwd` 字段，类型层就堵住了错路 |
| P6 | `PromptResult.accepted` / `CancelResult.accepted` 是字面量 `true` | ✅ 已修正 | `src/ports/session-port.ts:38`、`:57` 现为 `readonly accepted: true`，注释写明「写成 `boolean` 会让调用方误以为存在 `accepted: false` 分支」；宿主侧 `SessionPromptValue` / `SessionCancelValue` 同为字面量 |

#### 状态机

| # | 检查点 | 结论 | 依据 |
|---|---|---|---|
| S1 | 回合归属固定 `T0 + 1` | ✅ | `src/domain/turn-attribution.ts` 的 `expectedTurn(baselineTurn) = baselineTurn + 1`；`attributeTurn` 用 `startedTurn < turn → pending`、`findEnd(ends, turn)` 精确匹配；文件头注释写明了「不是第一个 turn > T0、也不是最大 turn」的反例 |
| S2 | `turn-missing` 报 `failed` 而非 `completed` | ✅ | `src/domain/turn-attribution.ts` 的 `isTurnMissing` 只在「非 running 且无待处理输入」时为真；`src/domain/status-resolver.ts` 把它映射为 `failed` |
| S3 | 回合边界读不到时返回保守值不抛错 | ✅ | `src/host/session-adapter.ts` 的 `readTurnBoundary` 在 `agents`/`sessions` 缺失或 `turnBoundaryOf` 抛错时返回 `{ openTurnStartSeq: null, lastTurn: 0 }` |
| S4 | `blocked` → `failed` | ✅ | `src/domain/status-resolver.ts` 的 `statusOfTurnEnd`：`error`/`blocked`/`max-tokens`/`interrupted` 统一 → `failed` |
| S5 | `forked` 不产生终态 | ✅ | 同上，`forked` → `null`，`resolveStatus` 不进入终态分支 |
| S6 | `wait` 超时保持上一状态、不自动重派 | ✅ | `src/domain/status.ts` 的 `mergeStatus(previous: TaskStatus \| null, observed)` 在上一状态为终态时保持；`previous` 可为 `null` 表示不继承（`dsh_send`/`dsh_cancel` 用） |
| S7 | `cancelled` 只在 `aborted` 后报出 | ✅ | `statusOfTurnEnd('aborted') → 'cancelled'`，无其他写入 `cancelled` 的路径 |

#### 幂等与占用

| # | 检查点 | 结论 | 依据 |
|---|---|---|---|
| I1 | `requestId` 原样透传，无改写无前缀 | ✅ | `src/host/session-adapter.ts` 的 `prompt` 直接把 `input.requestId` 传给 `SessionPromptRequest.requestId` |
| I2 | 无自建 requestId 去重表 | ✅ | `grep -rniE "seenRequest\|requestIds\|dedup\|去重表" src/` 仅命中 `src/host/session-adapter.ts:7` 的注释，声明「不自建去重表」；无任何 Map/Set 用作去重 |
| I3 | 占用从 `running` 投影，无独立锁表 | ✅ | `src/domain/occupancy.ts` 的 `findOccupant` 只读 `OccupancyCandidate.running`；文件头注释写明「不维护锁表」及其理由（重载/崩溃/手动取消后锁会脱节） |

#### 失败隔离

| # | 检查点 | 结论 | 依据 |
|---|---|---|---|
| F1 | 可选服务用 `ctx.get()` 惰性读取 | ✅ | `src/host/context.ts` 的 `readService` 走 `ctx.get(name)`，返回 `undefined` 不抛错；`requireService` 才抛 `host-capability-missing` |
| F2 | `dsh_wait` 的 abort 只结束等待、不调 `cancel` | ✅ | `src/app/wait-task.ts:82` 把 `input.signal` 透传给 `session.wait`；`grep -n "cancel" src/app/wait-task.ts` 零命中；`src/mcp/tools/dsh-wait.ts` 注释写明「客户端断开只中断本次等待，不取消会话执行」 |
| F3 | 单个 `tools/call` 抛错返回 `isError: true`，不关 SSE | ✅ | `src/mcp/dispatcher.ts:193-205`：`tool.run` 抛错先试 `toJsonRpcError`，非 `null` 走 JSON-RPC 错误，否则 `resultResponse(id, toErrorResult(cause))`；`src/transport/http.ts` 的 `handlePost` 只在 `res.writableEnded \|\| res.destroyed` 时提前返回，不主动断连接 |
| F4 | `ctx.effect` 清理覆盖路由注销、全部 wait 的 abort、监听关闭 | ✅ | `src/index.ts:94-100` 的 `ctx.effect(() => () => { unregister?.(); unregister = undefined }, 'dsh-mcp-bridge: mcp route')`——**execute 返回清理函数**，符合 cordis 语义（`@deepseek-ai/cordis/src/fiber.ts`：`effect()` 体内直接 `this._execute(runner)`，`_execute` 把返回的函数收集为 disposer）。`src/host/host-types.ts:252-267` 的签名与注释已固化该语义，防止再写回「在 execute 体内清理」的错法。wait 的 abort 由 `src/transport/http.ts:102`（`new AbortController()`）、`:106`（`res.on('close', onClose)`）驱动、`:124-125` 在 `finally` 里 `res.off('close', onClose)` 摘钩子，属每请求生命周期而非插件级，无需插件级清理 |
| F5 | 卸载不终止非本插件创建的进程与会话 | ✅ | `grep -rn "kill\|terminate\|dispose\|process.exit" src/` 仅命中 `src/host/host-types.ts:261` 的注释，**零处主动终止**；卸载路径只有 `src/index.ts:94-100` 注销本插件注册的那一条路由，不触碰 `sessions`/`agents`/`permissionPresets`，已创建的 DSH 会话与 AA Connector 均不受影响 |

#### 传输与安全

| # | 检查点 | 结论 | 依据 |
|---|---|---|---|
| T1 | 路由经 `ctx.webServer.register`，未自起 `http.createServer` | ✅ | `grep -rn "createServer" src/` 零命中；`src/transport/route.ts:22-24` 声明 `RouteRegistry.register`，`ROUTE_PATH = '/mcp/dsh-mcp-bridge'`；注册点 `src/index.ts:74` `webServer.register({ kind: 'exact', path: ROUTE_PATH, handler })`，且 `:60-66` 在 `webServer` 缺失时只 `warn` 不抛（不拖垮 profile 加载） |
| T2 | 认证失败返回 401 且不透出内部错误与路径 | ✅ | `src/transport/auth.ts:57-75`：非回环 403、未配置凭据 503、缺 Bearer 401、比对失败 401；拒绝文案只有 `forbidden: loopback-only` / `unauthorized: invalid credential` 等固定串，不含期望凭据片段；`timingSafeEqual`（`:91-100`）定长比较，长度不同也走完整轮 |
| T3 | 请求体有大小上限 | ✅ | `src/transport/http.ts:34` `MAX_BODY_BYTES = 1024 * 1024`；`:142-143` 累计超限即抛错 → `:88` 回 413 |
| T4 | 日志只记请求标识、状态与错误码 | ✅ | 全部 5 处日志点：`src/index.ts:56`（配置禁用）、`:64`（webServer 缺失，带路由路径）、`:77`（注册失败，带路由路径 + cause）、`:81-86`（就绪，带 origin/路径/状态目录）、`src/host/registry-adapter.ts:105,114`（登记表读失败/损坏，只带文件路径）。**零处打印任务正文、模型密钥、凭据或完整请求体**；凭据只从 `DSH_MCP_BRIDGE_TOKEN` 读、从不入日志（`src/index.ts:36-38` 注释已固化） |
| T5 | `initialize` 按 `SUPPORTED_PROTOCOL_VERSIONS` 协商，不写死单一版本 | ✅ | `src/mcp/dispatcher.ts:33` `LATEST_PROTOCOL_VERSION = '2025-11-25'`，`:36` 起 5 个版本表；`initializeResult` 在请求版本命中表内时原样回，否则回 `LATEST_PROTOCOL_VERSION` |
| T6 | `notifications/*` 不回响应 | ✅ | `src/mcp/dispatcher.ts:90` `const isNotification = request.id === undefined`，`:110-112` 命中即 `return { kind: 'none' }`；`src/transport/http.ts:104-108` 对 `kind: 'none'` 回 202 空体，不发 JSON-RPC 帧 |
| T7 | 业务失败走 `isError: true`，入参非法走 `-32602`，两者不混用 | ✅ | `src/mcp/errors.ts:39-48` 的 `INVALID_PARAMS_CODES` 含 `invalid-argument`/`model-unavailable`/`reasoning-effort-unavailable`/`saved-model-invalid`/`permission-unavailable` 五码，其余归 `isError`；`src/mcp/dispatcher.ts:177,182,187` 三处参数类错误走 `-32602`，`:83,93,99` 三处协议类错误走 `-32600`，界线与 §5.5 一致 |
| T8 | 客户端断开只 abort 本次 wait，不取消执行 | ✅ | `src/transport/http.ts:102` 建 `AbortController`、`:106` 挂 `res.on('close', onClose)` 调 `controller.abort()`、`:109` 把 `controller.signal` 传给 `dispatch`、`:124-125` 在 `finally` 里 `res.off('close', onClose)` 摘钩子；`src/mcp/tools/types.ts` 的 `run` 第三参注释写明「绝不能拿它去取消会话执行」 |
| T9 | 设置路由与任务接口共用同一套本机认证围栏 | ✅ | `src/transport/settings-route.ts` 构造时 `options?.token ?? readConfiguredToken()` 只读一次，每个请求先 `checkRequest(req, token)`，拒绝文案与 MCP 路由完全一致（403 非回环 / 503 未配置 / 401 缺凭据或比对失败）。**未认证客户端既读不到设置也写不了默认权限** |
| T10 | 设置路由的方法白名单与 REST 错误体 | ✅ | `src/transport/settings-route.ts`：`GET` 读、`PUT` 写、其它 405 + `allow: GET, PUT`；请求体上限 64 KiB（超限 413）；JSON 解析失败回 **HTTP 400** `{ error: '请求体不是合法 JSON' }`（不套 JSON-RPC 的 `-32700`）；`invalid-argument` → 400、其余 → 500，错误体 `{ error: { code, message, detail? } }` |
| T11 | TUI 是配置客户端，不绕过插件直改 profile/会话文件 | ✅ | `src/tui/client.ts` 只走 `http://127.0.0.1:7275/mcp/settings`（`DSH_MCP_BRIDGE_URL` 可覆盖），凭据只从 `DSH_MCP_BRIDGE_TOKEN` 读、不接受命令行参数（避免进 shell 历史）；`src/tui/**` 零 `node:fs`（唯一 `node:` import 是 `main.ts` 的 `node:readline/promises`）、零 `@deepseek-ai/*`、零 `src/host/**`，D8 白名单只放行 `domain` |
| T12 | `reply` 走原生 `userQuestions.answer`，不降级成普通 prompt | ✅ | `src/app/send-task.ts` 的 `readContent` 保证 `text`/`reply` 严格互斥；`reply` 分支调 `interaction.answer`，宿主返回 `false` 或抛 `REPLY_QUEUED`/`BAD_ANSWER`/`CALLER_NOT_LIVE`/`DELEGATED_CALLER` 时一律转 `invalid-argument` 并在 `detail.reason` 标明，**不回落成 `prompt`** |
| T13 | 宿主 Browser access 围栏被识别为**部署前置**而非插件缺陷 | ✅ | `app.asar/lib/webserver.js` 的 `policy(route)` 在每条路由前判 `permits(request)`，`app.asar/lib/desktop-browser-access-C9zC_PMD.js` 的 `decideDesktopBrowserAccess` 要求 `x-dsh-desktop-renderer` 头或 `browserAccess: true`（默认 `false`）。本插件**不绕过**（不伪造头、不改宿主偏好、不自起 HTTP），并在 `src/tui/client.ts` 的 `describeFailure` 专门识别 `Browser access is disabled` 给出可执行指引；已写入 ARCHITECTURE §5.9。**实测确认**：`curl http://127.0.0.1:7275/mcp/settings` 返回 `403 Browser access is disabled` |


### 1.4 已回写给后端的修正项

| # | 修正项 | 状态 |
|---|---|---|
| 1 | `package.json` 的 `@deepseek-ai/cordis` peer range 永不匹配（C5） | ✅ 已删该 peer 及其 meta |
| 2 | `package.json` 的 `files` 缺 `locale`/`icon.svg`（C6） | ✅ 已修：`files` 现为 `["lib","!lib/**/*.map","bin","locale","icon.svg","cordis.patch.yml","README.md"]`；`locale/{en,zh}.json` 与 `icon.svg` 已建（第 ④ 步建目录时同步补了 `files`，未留到第 ⑥ 步才发现） |
| 3 | `docs/DEVELOPMENT.md` 第 4 节的 `workspace.attachSession(sessionId)` 回退路径**不需要桥接自己调**：`attachSession` 确实存在（`dsh-workspace/src/types.ts:120`，`WorkspaceEntity` 在 `src/entity.ts:110` 实现），但 `sessionController.create({ workspaceId })` 内部已调用它（`dsh-api-session-controller/src/commands.ts:147-157`）。桥接只需 `create({ workspaceId })`，不要再 attach 一次 | ✅ 已在 ARCHITECTURE 第 4 节与 ADR 中固化 |
| 4 | `scripts.build` 指向不存在的 `tsconfig.build.json`（C12） | ✅ 已改为 `tsc` |
| 5 | 宿主包零 `.d.ts`，`src/host/` 不能 `import type { Context } from '@deepseek-ai/cordis'`（C13） | ✅ 已定 ADR-009：`host-types.ts` 本地结构窄化，连 `Context` 都不 import |
| 6 | `PermissionSource`/`ModelSource` 枚举语义与 DEVELOPMENT.md 第 6 节三层不一致（C10） | ✅ 已改为 `'source-session'\|'bridge-default'\|'initial'\|'unknown'` 与 `'request'\|'bridge-default'\|'dsh-default'\|'unknown'` |
| 7 | `scripts/check-boundaries.mjs` 的 D7 未做路径归一化，误判同层 `../`（`domain/projection/x.ts` → `../types.js`） | ✅ 已改为 `posix.normalize(posix.join(posix.dirname(file), spec))` 后比对层前缀 |
| 8 | `scripts/check-boundaries.mjs` 的 D3 漏判 `const enum` / `declare function` | ✅ 正则已补 `declare`、`abstract`、`const|let|var` 三种前缀 |
| 9 | `bridgeError` 只接 3 参，但 `src/host/` 有 5 处传了第 4 个 `cause`（`model-adapter.ts:30`、`session-adapter.ts:51,93,119,134`），tsc 会报 `Expected 3 arguments, but got 4` | ✅ 已加可选 `cause?: unknown` 并透传给 `BridgeError`（`src/domain/errors.ts:50-58`） |
| 10 | `PromptResult.accepted` / `CancelResult.accepted` 是 `boolean`，与 §4 契约的字面量 `true` 不符 | ✅ 已改为 `readonly accepted: true`（`src/ports/session-port.ts:38`、`:57`） |
| 11 | `src/ports/interaction-port.ts` 原为 `pendingQuestions` / `pendingApprovals` / `answerQuestion` 三段式，与 `dsh_send` 的 `reply: { callId, answers }` 对不上（会出现「有 questions 但 callId 为 null」的中间态） | ✅ 已改为单一 `pendingInput()` 返回 `{ questions, callId, hasApproval }`；`approvalCount` 改 `hasApproval`（`pendingInput` 是 Set 去重后的种类列表，数出来恒为 1） |
| 12 | `src/ports/model-port.ts` 原为 `listProviders`/`listModels`/`resolveModel` 三段式，与宿主 `sessionController.modelCatalog()` 一次读全目录的能力不符 | ✅ 已改为 `catalog()` + `applySelection()` + `currentSelection()`；`reasoningEffort: string \| null`，`null` 表示跟随模型默认、适配器不传该字段 |
| 13 | `src/mcp/dispatcher.ts:176,181,186` 的「缺 `name`／未知工具／`arguments` 非对象」用 `-32600 INVALID_REQUEST`，语义应为 `-32602 INVALID_PARAMS`——`-32600` 表示「这不是合法 JSON-RPC 请求」，而这三类请求本身合法、只是参数不对。混用会让客户端把「参数写错」当成「协议不兼容」去降版本重连 | ✅ 三处已改为 `JSON_RPC_INVALID_PARAMS`（`src/mcp/dispatcher.ts:177,182,187`）；`:83,93,99` 三处（非对象／`jsonrpc` 不是 `"2.0"`／`method` 非字符串）保留 `-32600`，语义正确 |
| 14 | `src/mcp/errors.ts:39-44` 的 `INVALID_PARAMS_CODES` 缺 `permission-unavailable`。它与已在集合里的 `model-unavailable` 同类（「请求的 `sourcePermission: 'auto'` 在当前环境没有 auto 预设」= 参数与环境不匹配，换参数才能继续），现在走 `isError` 会让客户端无法区分「权限档位写错」与「任务执行失败」 | ✅ 已加入集合，并附注释说明与 `model-unavailable` 同类（`src/mcp/errors.ts:45-48`） |
| 15 | `src/app/send-task.ts:60` 的重放分支 `snapshot.running ? 'running' : (deps.observed.get(…) ?? 'accepted')` 会把「已完成」报成「已受理」——`observed` 在该请求成功时被写成 `'accepted'`，非 running 时恒返回 `'accepted'`，即使对应回合早已 `completed`。应像 `start-task.ts:60-68` 的幂等分支那样走完整 `observeTask` | ✅ 重放分支已改走完整 `observeTask` + `resolved.status`，并把结论写回 `observed`（`src/app/send-task.ts:66-76`）；注释写明「按 `observed` 回显会让早已 `completed` 的请求在重试时看到「已受理」然后一直等下去」 |
| 16 | `SendTaskOutput`（`src/app/send-task.ts:27-32`）只有 `{ sessionId, requestId, status, permission }`，缺 `cursor` 与 `model`，与 §5.3「output 与 `dsh_start` 同形」不符。缺 `cursor` 的后果是客户端拿到 `dsh_send` 结果后无法直接 `dsh_wait` | ✅ `cursor` 已补（`src/app/send-task.ts:42`、两处 return 均带 `baseline.cursor` / `snapshot.cursor`）。`model` **确认不返回**并已回写 §5.3：`dsh_send` 不接受模型参数，第 1 阶段又无法回读会话当前生效模型（`ModelPort.currentSelection` 恒 `null`），返回恒 `unknown` 的字段会让客户端误以为模型被改过 |
| 17 | `src/transport/http.ts:20` 的 `import type { AppDeps } from '../app/deps.js'` 同时违反 D5 与 D7。传输层不该知道用例层怎么装配 | ✅ 已改为 `DispatchFn` 回调注入（`src/transport/http.ts:26-36`），组装根负责绑定 `dispatch(deps, …)` |
| 18 | `src/index.ts:90-93` 的 `ctx.effect(() => { unregister?.() })` 会让路由**注册即注销**：cordis 的 `effect()` 体内直接 `this._execute(runner)`，**传入函数立即执行、返回值才是清理函数**，所以 `unregister()` 在注册成功后当场被调用一次，随后 `unregister` 被置 `undefined`，卸载时无清理可跑，MCP 路由永远不可达 | ✅ 已改为 `ctx.effect(() => () => { unregister?.(); unregister = undefined }, 'dsh-mcp-bridge: mcp route')`（`src/index.ts:94-100`）；`src/host/host-types.ts:252-267` 的签名改为 `effect(execute: () => (() => void) \| void, label?: string)` 并把 `_execute` 的判据写进注释，防止再写回错法 |
| 19 | `src/domain/permission-choice.ts` 的 `PermissionChoiceFailure` 里 `invalid-source-permission` 是永不产生的死分支：源权限传非法值（如 `"yolo"`）时走 `presetOfLevel(level)` 越界查表得 `undefined`，detail 变成「需要预设 "undefined"」——把「输入非法」伪装成「环境缺预设」，客户端会去查错方向 | ✅ 已在函数首部加两道兜底（`src/domain/permission-choice.ts:60-80`）：`sourcePermission` 与 `savedDefault` 分别 `isPermissionLevel` 校验，各自返回带层名的 detail（「源权限值非法」/「桥接保存的默认权限值非法」），便于第 ④ 步定位是 TUI 写坏还是请求传错。`presetOfLevel` 签名不动——`Record<PermissionLevel, string>` 在类型层是全的，为一个运行时不可能的分支改三个调用点噪音大于收益 |

### 1.5 第 ④ 步自检修正项（本轮新增范围内部）

| # | 修正项 | 状态 |
|---|---|---|
| 20 | `src/transport/http.ts` 的 `readBody`/`sendJson`/`MAX_BODY_BYTES` 是模块私有，设置路由要么复制一份（两份实现会漂移），要么改导出 | ✅ 已改为 `export`，并给 `readBody` 加 `limit` 参数（MCP 主通道 1 MiB、设置路由 64 KiB 各用各的上限，函数只有一份） |
| 21 | `src/index.ts` 注册第二条路由后，若第二条失败，第一条会残留成孤儿监听 | ✅ 注册失败分支先 `unregister?.(); unregister = undefined` 回滚已注册的那条，再 `logger.error` 报两条路径；`ctx.effect` 的清理函数同时注销两条，label 改为 `'dsh-mcp-bridge: routes'` |
| 22 | `src/tui/main.ts` 的 `refresh(state, config)` 中 `state` 参数未使用（`TS6133`，`noUnusedParameters` 下是硬错误） | ✅ 签名改为 `refresh(config: ClientConfig)`，两处调用点同步；`npx tsc --noEmit` 归零 |
| 23 | `package.json` 的 `files` 只含 `lib`/`cordis.patch.yml`/`README.md`，新增的 `bin/` 不会进发布包 | ✅ 已改为 `["lib","bin","cordis.patch.yml","README.md"]`；`bin` 字段指向 `./bin/dsh-mcp-bridge.mjs`（零依赖零构建，动态 `import('../lib/tui/main.js')`，未构建时给出可执行提示） |

## 2. 风险

按「会不会让第 1 阶段返工」排序。

### R1 回合归属误判为完成（高）

**症状**：`dsh_wait` 报 `completed`，但实际是上一轮的结束、或本轮还没开始。

**成因**：把 `SessionState.running === false` 或 `wait.reason === 'idle'` 当作完成。这两者都只说明「此刻没在跑」，不说明「本次请求对应的回合结束了」。

**缓解**：强制走 `turnBoundary` 归属判定；`turn-missing` 显式报 `failed`。这条必须写进 `domain/` 的单测快照，不能只靠 code review。

### R2 输出投影把事件当文本（高）

**症状**：`output` 字段塞进原始 `SessionEventEntry` JSON，Codex 侧 token 爆掉。

**成因**：`wait.output.records` 是 `SessionEventEntry[]`（`SessionHistoryRecord = SessionEventEntry`），不是纯文本。宿主不提供现成的文本投影。

**缓解**：`src/domain/projection/output.ts` 必须只投影 `assistant/message` 的文本增量与必要的 `tool/call`/`tool/result` 摘要；`tool/result` 的完整输出不进入返回体。字节上限与 `maxMessages` 双重裁剪，`truncated` 如实置位。

### R3 权限「自动审查」被重复注册（中）

**症状**：插件加载即抛 `permission: preset "auto" is already registered`，整个插件起不来。

**成因**：`dsh-experimental-auto-review` 已在 desktop profile 启用并注册了 `auto`。桥接若再调 `permissionPresets.registerAuto` 会直接抛错。

**缓解**：桥接**只消费** `auto`（先查 `permissionPresets.names` 是否含 `auto`），不注册。第 2 阶段实现权限映射时，把「`auto` 不可用」当作正常降级路径：明确报错并提示用户，不静默换成 `full`。

### R4 串行占用锁住用户（中）

**症状**：用户自己在 DSH 里改同一目录的文件被桥接拦住，或桥接报占用但实际没有任务在跑。

**成因**：把占用做成文件锁或全局互斥表。

**缓解**：占用只约束本插件派发的任务，判定从 `readState().running` 投影。这条在 `docs/DEVELOPMENT.md` 第 8 节已明确，实现时容易走偏。

### R5 插件重载后归属关系丢失（中）

**症状**：重载后 `dsh_send` 找不到会话，或把别人的会话当成自己的。

**成因**：归属关系只存在内存里。

**缓解**：按 `docs/ARCHITECTURE.md` 第 7 节持久化最小元数据到 `$DSH_HOME/dsh-mcp-bridge/state.json`（`version` + `sessions` 映射）。只存 `workspaceId`/`canonicalCwd`/`lastRequestId`/`lastSourcePermission`/`baselineTurn`/`baselineCursor`，不复制会话内容、不缓存状态机。**`baselineTurn` 必须落盘**：回合归属判定式是「对应回合 = `T0 + 1`」，而 `dsh_wait`/`dsh_cancel` 都是后续独立请求，不持久化 T0 就只能在重载后重新猜，会把别的回合算成本请求的。

### R6 MCP 版本协商与 `Accept` 分支覆盖不全（中）

**症状**：Codex 能连上但工具列表为空，或 SSE 建不起来。

**成因**：手写 JSON-RPC 分派时只实现了 happy path。

**缓解**：第 1 阶段就要覆盖：`initialize` 的 `protocolVersion` 协商与回退（按 `SUPPORTED_PROTOCOL_VERSIONS` 表，不写死单一版本）、`notifications/initialized` 无响应、`tools/list` 的 `nextCursor` 省略、`tools/call` 的 `isError` 分支、POST 的 `Accept: application/json, text/event-stream` 双分支、`GET` 返回 405、`DELETE` 返回 204。**第 1 阶段不建 SSE 下行流、不分配 `Mcp-Session-Id`**（见 ARCHITECTURE §5.7 第 5、6 条），因此「SSE 建不起来」这条症状在第 1 阶段不适用——若第 2 阶段要加进度通知，必须同时补 `Mcp-Session-Id` 的分配、校验与过期。

### R7 Node 版本错配（低，但会卡住构建）

**事实**：系统 node `v22.19.0`，DSH 内 electron-node `v24.21.0`，包 `engines.node` 写 `^22.19.0 || >=24.9.0`，两者都满足。

**风险**：`package.json:28` 的 `syntax` 脚本用 `node --experimental-strip-types --check`，在系统 node `v22.19.0` 上已实测通过；但该 flag 在 Node 24 上未实测（本机 DSH 内的 electron-node 为 `v24.21.0`，与系统 node 不是同一个运行时）。建议 `build`/`typecheck` 只依赖 `tsc`，`syntax` 仅作本地便利脚本，不进 CI 门禁。

**已做的一半**：`package.json:27` 的 `typecheck` 已改成 `npm run check:boundaries && tsc --noEmit`——把可机械断言的分层校验串进类型检查之前，这样即使将来 `tsc` 不可用，`npm run typecheck` 也会先在边界规则上失败而不是静默跳过。`build`（`package.json:25`）保持纯 `tsc`，不夹带校验，避免发布路径依赖 `node` 脚本。

### R8 契约冻结过早（低）

**风险**：`docs/ARCHITECTURE.md` 第 5 节的返回体是第 1 阶段定稿，但第 ③ 步（权限映射、模型三层）落地后 `config.*.source` 的取值集合可能扩张。

**缓解**：`source` 已是开放枚举（`request`/`bridge-default`/`dsh-default`/`unknown`），新增值不破坏既有客户端；但**不得改名或删除已有值**。

### R9 回合进展读取的分页上限导致漏判（中）

**症状**：长会话里 `dsh_wait` 报 `turn-missing`（failed），但回合其实跑完了。

**成因**：`src/host/session-adapter.ts` 的 `readEventsSince` 用 `PROGRESS_PAGE_SIZE = 200` × `PROGRESS_MAX_PAGES = 5` 回溯，最多覆盖 1000 条消息。若提交点（`afterSeq`）距当前游标超过这个窗口，`turn/start` 与 `turn/end` 都会落在窗口外，`toProgress` 拿到空数组 → `startedTurn: null`、`ends: []` → 判定 `pending` → `turn-missing` → `failed`。

**为什么窗口按「消息」算而不是「事件」算**：宿主 `paginate`（`dsh-api-session-controller/src/history.ts`）的 `MESSAGE_TYPES = new Set(['user/message', 'assistant/message'])`，只有这两类计 `maxMessages`，`turn/start`/`turn/end`/`tool/call` 等不计数但**随页返回**。所以 1000 条消息对应的实际事件数远大于 1000，窗口比字面宽。

**缓解**：①窗口耗尽（`page === PROGRESS_MAX_PAGES` 仍未覆盖 `afterSeq`）时**不要静默当作「只看到尾部」**——必须在 `TurnProgress` 上带一个 `truncated: boolean`，让 `status-resolver` 在窗口耗尽时**不判 `turn-missing`**（宁可继续报 `running`/`accepted`，也不要误报失败）；②或把窗口耗尽转成 `bridgeError('internal')` 让客户端重试。倾向 ①：误报 `failed` 比多等一轮更伤。

**已落地（方案 ①）**：`TurnProgress.truncated: boolean`（`src/domain/types.ts:161-167`）→ `AttributionInput.truncated?: boolean`（`src/domain/turn-attribution.ts:27-34`）→ `isTurnMissing` 首行 `if (input.truncated === true) return false`（`src/domain/turn-attribution.ts:92`）。链路完整：`readEventsSince` 在 `page === PROGRESS_MAX_PAGES - 1` 且仍需前翻时置 `truncated = true`（`src/host/session-adapter.ts:226`）→ `toProgress(events, sinceTurn, truncated)` 透传（`:233-257`）→ `readProgress` 返回（`:168`）。**该风险已降为「已缓解」，剩余风险是「长会话下每轮多翻 5 页」的性能成本，不是正确性问题。**

### R10 `needs_input` 是「只能看见、不能回答」的死路（中，第 ④ 步前必须解）

**症状**：`dsh_wait` 返回 `status: 'needs_input'` 并给出具体提问（`{ kind, callId, questions }`），客户端照着回答调 `dsh_send` 却被明确拒绝——「第 1 阶段不支持 reply」。客户端此时只剩两条路：`dsh_cancel`，或者一直 `dsh_wait` 到超时。

**成因**：`InteractionPort` 第 1 阶段只实现了只读的 `pendingInput()`，没有 `answer()`。宿主侧 `UserQuestionService.answer(agent, callId, answer)` 要求**活的 `Agent` 对象**（不是 `sessionId`），必须经 `ctx.agents.get(sessionId)` 拿；而 `src/app/send-task.ts` 的 `readText` 选择**明确抛错**而不是静默忽略——这是对的（否则客户端会以为回答已送达），但代价是 `needs_input` 成为终态之外的死路。

**为什么这不是第 1 阶段的缺陷**：`docs/DEVELOPMENT.md` 第 7 节要求「交互回复必须携带原生交互标识、答案或用户已明确批准的选择，调用 DSH 原生交互服务；不能把它当普通 prompt 发送后假装审批已完成」。在没接原生 `answer` 之前，抛错是唯一诚实的做法。

**但它是第 ⑤ 步的硬前置**：第 ⑤ 步第 4 条验收是「三档权限生效，`auto` 真调原生审查」。`auto` 预设的 `PresetSpec` 是 `{ sandbox: 'danger-full-access', approval: 'ask' }`（`dsh-permission-presets/src/index.ts:83`）——**`approval: 'ask'` 意味着自动审查仍可能弹出人工审批**。一旦弹出，`dsh_wait` 报 `needs_input`，而客户端无法回答，联调就会卡死在这一步，且症状看起来像「权限没生效」。

**缓解**：第 ④ 步（TUI 与交互路径）必须同时做两件事：①`InteractionPort` 加 `answer({ sessionId, callId, answers })`，适配器经 `ctx.agents.get(sessionId)` 拿 Agent 后调 `UserQuestionService.answer`；②`dsh_send` 的 `reply` 分支从「抛错」改为「走 answer」。**这两件事必须一起做**——只做 ② 会得到一个「接受 reply 但无处投递」的假通道。

**退路（若不打算在第 ④ 步做）**：那就必须在第 ⑤ 步联调时**只测 `ask` 与 `full` 两档**，把 `auto` 的验收推迟，并在文档里明确写「`auto` 未验证」——不能因为「冒烟通过」就宣称三档都生效。

## 3. 后续阶段衔接

### 各阶段的实际覆盖范围（与 `docs/DEVELOPMENT.md` 第 10 节的 6 步对照）

| 文档里的步 | 当前状态 | 证据 |
|---|---|---|
| ① 核对 SDK、建插件入口 | ✅ 完成 | `src/index.ts`（`apply` + 返回清理函数）、`cordis.patch.yml`、`src/host/host-types.ts` 的结构窄化（ADR-009） |
| ② 原生会话闭环（MCP 服务 + 四工具） | ✅ 完成 | `src/mcp/{dispatcher,errors}.ts` + `src/mcp/tools/*`、`src/transport/*`、`src/app/{start,wait,send,cancel}-task.ts` |
| ③ 配置解析与权限映射 | ✅ 完成（**但只有「本次请求 → 生效」这一半**） | `src/domain/{permission-map,permission-choice,model-choice}.ts`、`src/host/{permission,model}-adapter.ts`；缺的是「保存默认值」那半，见下 |
| ④ TUI 与交互路径 | ✅ 代码完成（未联调） | `src/tui/{state,render,client,main}.ts` + `bin/dsh-mcp-bridge.mjs` + `package.json` 的 `bin`；设置读写走 `/mcp/settings`（`src/transport/settings-route.ts`），默认值落 `$DSH_HOME/dsh-mcp-bridge/settings.json`（`src/host/settings-adapter.ts`），`start-task.ts` 的两处 `null` 已改为读设置；`dsh_send` 的 `reply` 已接原生 `userQuestions.answer`（R10 关闭）。**TUI 只在错误路径上实测过，完整交互属 U10** |
| ⑤ 获授权联调 | ❌ 未开始 | 见 1.2 的 U2/U3/U5/U6/U9–U12；前置条件见 `docs/INSTALL.md` 第 7 节末 |
| ⑥ 可安装交付 | ⏸ 文档侧完成，交付未完成 | 已完成：`files` 全量（C6 关闭）、`locale/{en,zh}.json`、`icon.svg`、`bin` 入口、`docs/INSTALL.md`（安装/卸载/Codex 配置/browserAccess 硬前置/支持版本/已验证 vs 未验证）。**未完成**：真实闭环未通过，按 `docs/DEVELOPMENT.md` 第 10 节第 6 条不得声称可用或发布正式版本；自检结论见本节末 |

**③ 的落差已在第 ④ 步补齐**：第 1 阶段只实现了「请求期解析」（`sourcePermission` / `model` 参数 → 预设与模型选择），「桥接保存的默认值」这一层当时恒传 `null`，导致 `PermissionSource.bridge-default` 与 `ModelSource.bridge-default` 永不产生。第 ④ 步已把 `src/app/start-task.ts` 的两处 `null` 改为读 `src/app/settings.ts` 的 `readSavedPermission` / `readSavedModel`，两个 `bridge-default` 现在**会**产生（`src/domain/types.ts` 的注释已同步）。

### 第 ① 步 → 第 ② 步：已跨过，但留了一条必须复验的断言

`src/index.ts:94-100` 的 `ctx.effect(() => () => {...})` 形态已修正（1.4 第 18 条）。**第 ⑤ 步联调时必须实测「插件重载后路由仍可达、卸载后路由消失」**——这条 bug 的形态是「注册即注销」，冒烟测不出来（冒烟直接调 `dispatch`，绕过了 `apply`），只有真机加载才能暴露。

### 第 ② 步 → 第 ③ 步：已跨过，契约未变

`permission-port` / `model-port` 的接口在第 1 阶段就是最终形态，第 ③ 步没有改契约。这是有意的：`catalog()` 一次读全目录（而不是 `listProviders`/`listModels` 三段式），`availablePresets()` 同步返回（宿主 `catalog()` 是同步读配置不是 RPC），两者都是按宿主真实能力定的，第 ③ 步不需要再动。

### 第 ③ 步 → 第 ④ 步（TUI 与设置）：已完成，落地形态与原计划有四处偏差

**原计划的衔接物**是「`src/config/` 作为唯一 store，`state.json` 升到 `version: 2` 加 `defaults` 段」。**实际落地改成了独立文件**：

| 原计划 | 实际落地 | 为什么改 |
|---|---|---|
| `src/config/` + `state.json` 升 `version: 2` | `src/domain/settings.ts`（纯类型与解析）+ `src/ports/settings-port.ts` + `src/host/settings-adapter.ts`，写 `$DSH_HOME/dsh-mcp-bridge/settings.json`（`SETTINGS_VERSION = 2`） | 归属表（`state.json`）与默认值（`settings.json`）生命周期完全不同：归属表是「本插件建过哪些会话」的运行期事实，默认值是用户配置。混在一个文件里，任一写入都要重写另一份，且「默认值写坏」会连累归属表读不出来（那会让所有已建会话退化成 `session-not-found`）。分成两个文件后，`parseState` 的 `version: 1` 读取路径**完全不用动**，原计划里「必须保留 version 1 兼容」的风险直接消失 |
| `src/cli/` + `bin` 指向 `./lib/cli/index.js` | `src/tui/` + `bin/dsh-mcp-bridge.mjs`（零依赖启动脚本，动态 import `lib/tui/main.js`） | `bin` 用 `.mjs` 而不是编译产物，是因为 `bin` 要在**系统 node v22.19.0** 下跑，而 `lib/` 是给宿主 electron-node v24.21.0 用的。启动脚本零依赖、零构建，`lib/` 没构建时能给出「请先 npm run build」的明确提示，而不是 `ERR_MODULE_NOT_FOUND` |
| TUI 用 raw-mode 单键交互 | 行命令（`m 3` / `e high` / `p ask` / `r` / `s` / `q`） | Windows 的 `cmd` 与 PowerShell 对 raw mode 支持不一致（方向键序列、Ctrl 组合各不相同）。本界面只有三个下拉项与三个按钮，行命令足够，且可复制粘贴、可脚本化 |
| 设置走 MCP 端点 | 独立 REST 路由 `/mcp/settings`（`GET` 读、`PUT` 写） | 见 ARCHITECTURE ADR-011：混进 MCP 端点会让只认 JSON-RPC 的客户端把设置请求当非法帧 |

**三条门槛的落地情况**：

1. **保存后新建会话立即生效、已有会话不受影响** —— 结构上成立：`readSavedPermission` / `readSavedModel` 只在 `dsh_start` 建会话时读一次，`dsh_send` 不重读（`applyPermissionIfChanged` 只在源权限真实变化时同步）。**但这条没有真机验证**（U9/U10）。
2. **保存失效配置保留失效状态、不自动换模型不放宽权限** —— `src/domain/settings.ts` 的 `buildSettingsSnapshot` 有 `SettingsInvalid { model, reasoningEffort, permission }` 三个标记，且**失效判定只在「读得到」时才做**（`catalogReadable` / `presetsReadable`），读不到时不误判失效。`writeSettings` 对失效值抛 `invalid-argument` 而不静默替换。**未真机验证**。
3. **TUI 与插件不各存一份配置** —— 成立且可机械断言：`src/tui/**` 零 `node:fs`、零 `src/host/**`，唯一写路径是 `PUT /mcp/settings`（REVIEW 1.3 的 D8/T11）。

### 第 ④ 步 → 第 ⑤ 步（联调）：交互路径已接通，但从未跑过真实提问

`dsh_send` 的 `reply` 在第 1 阶段明确抛错，第 ④ 步已接上原生通道：`InteractionPort.answer` → `src/host/interaction-adapter.ts` 的 `userQuestions.answer(agent, callId, { answers })`，`agent` 经 `ctx.agents.get(sessionId)` 取活引用。**R10（`needs_input` 是死路）因此关闭。**

三条实现约束（已写进 ARCHITECTURE §5.3/§5.5）：

- `text` 与 `reply` **严格互斥**，两者都传或都不传 → `invalid-argument`。
- `reply` 被拒（宿主返回 `false`，或抛 `REPLY_QUEUED` / `BAD_ANSWER` / `CALLER_NOT_LIVE` / `DELEGATED_CALLER`）一律转 `invalid-argument`，`detail.reason` 标明原因，**不降级成普通 prompt 发送**。
- `reply` 的回合基线退一格（`lastTurn - 1`），因为答案是 steering 消息塞进**当前开放回合**，不会新开回合（ARCHITECTURE §6.2）。

**仍未验证**（U11/U12）：宿主 `answer` 只服务 `state === 'continued'` 的提问，`open` 态调用返回 `false`。桥接目前只报 `callId` 不区分 `open`/`continued`，客户端可能在 `open` 阶段就尝试 reply 而拿到静默失败。**第 ⑤ 步联调必须先确认这一点**；若确认为真，`needsInput` 需增加 `state: 'open' | 'continued'` 字段。

### 第 ⑤ 步（联调）→ 第 ⑥ 步（可安装交付）

**第 ⑤ 步必须验证的 7 条**（前 6 条来自 `docs/DEVELOPMENT.md` 第 10 节，第 7 条是本评审补充）：

1. 同路径连续派单不重复注册工作区；不同 worktree 不混淆。
2. 两个 Codex 对话共享工作区但各有自己的 DSH 会话，返工回原会话。
3. 模型三层生效；保存的配置失效时明确报错。
4. 三档权限生效，`auto` 真调原生审查。
5. 六态可区分；等待超时不重复派单；取消与重连不误报完成；同一请求重试不产生第二份执行。
6. 仅本机认证客户端可派单与保存设置。
7. **插件重载后路由仍可达、卸载后路由消失**（对应 1.4 第 18 条的「注册即注销」bug，冒烟测不出，只有真机加载能验）。

**第 ⑤ 步大概率会遇到的三件事**（离线冒烟覆盖不到）：
- 真实 MCP 客户端的 `Accept` 头可能是 `application/json, text/event-stream` 双值，而 `src/transport/http.ts` 的 `prefersEventStream` 是「含 `application/json` 就回 JSON」——双值时行为取决于头里的顺序，需要实测 Codex 到底发什么。
- 真实客户端可能在 `initialize` 前先发别的请求，或对 `notifications/initialized` 的 202 空体有额外期待。
- SSE 断流后的重连行为完全未验（第 1 阶段每个 POST 都是「一帧即 `res.end()`」，没有真正的长连接流）。

**第 ⑥ 步的交付检查**：`files` 字段完整（含 `locale`、`icon.svg`）、`peerDependencies` 范围与目标 DSH 版本匹配、`cordis.patch.yml` 的 `id`/`name` 与包名一致、卸载后无残留监听与订阅、`engines.node` 与目标 DSH 的 `engines` 不冲突（本机 DSH 要求 `>=24.9.0`，项目写的是 `^22.19.0 || >=24.9.0`，见 R7）。

### 第 ⑥ 步自检结论（文档侧已完成，交付未完成）

| 检查项 | 结论 | 依据 |
|---|---|---|
| `files` 完整性 | ✅ | `["lib","!lib/**/*.map","bin","locale","icon.svg","cordis.patch.yml","README.md"]`，与 `docs/ARCHITECTURE.md` 第 2 节的运行期文件清单逐项对应；`npm pack --dry-run` 实测 109 个文件、`unpacked size` 303.9 kB、`.map` 与 `src/` 均 0 命中；`locale/{en,zh}.json`（256/230 字节）与 `icon.svg`（1393 字节）均已存在 |
| `peerDependencies` 范围 | ✅ | 5 条全为 `>=0.2.0-rc.1 <0.3.0-0`，覆盖本机实际的 `0.2.2-rc.3`；全部 `optional: true`（插件不硬失败于服务缺失，改为调用时 `ctx.get()` 惰性读取） |
| `cordis.patch.yml` 的 `id`/`name` | ✅ | `id: dsh-mcp-bridge` 与 `src/index.ts` 的 `export const name = 'dsh-mcp-bridge'` 一致；`name` 是包名，与 `package.json` 的 `name` 一致；`package.json` 的 `dsh.bundle.patch` 指向该文件 |
| 卸载无残留 | ✅（结构上） | `src/index.ts` 的 `ctx.effect(() => () => { unregister?.(); unregister = undefined }, 'dsh-mcp-bridge: routes')` 注销两条路由；`grep` 确认 `src/` 零处 `kill`/`terminate`/`process.exit`，不终止任何进程、不关闭宿主监听。**真机卸载未验证**（U2） |
| `engines` 与宿主的关系 | ⚠️ 有落差但无害 | 宿主 `engines.node` 是 `>=24.9.0`，项目写 `^22.19.0 \|\| >=24.9.0`。**插件本体**跑在宿主进程内（electron-node v24.21.0），满足宿主约束；项目的 `engines.node` 是给**构建与 TUI** 用的（系统 node v22.19.0）。两个运行时不同，所以这个范围是刻意的，不是笔误。风险见 R7 |
| `engines.dsh` | ✅ 已写 | 值 `>=0.2.0-rc.1 <0.3.0-0`，与 5 条 `peerDependencies` 范围一致。宿主 `@deepseek-ai/dsh-app-boot` 的 `evaluatePluginCompatibility()` 确实校验该字段：**manifest 自带 `engines.dsh` 时它单独决定、`peerDependencies` 被忽略**；缺失时才回落到 dsh 系 peer。本机运行时 `0.2.2-rc.3` 对两条路径均 `satisfies === true`。写它是把版本契约显式化，避免 peer 隐式推断 |
| 可安装文档 | ✅ | `docs/INSTALL.md`：安装 / 卸载 / Codex 配置 / browserAccess 硬前置 / 支持版本 / 已验证 vs 未验证（U2–U12 逐条）/ 常见问题 |
| 真实闭环 | ❌ 未通过 | 插件从未被 DSH 真实加载、从未接真实 MCP 客户端。按 `docs/DEVELOPMENT.md` 第 10 节第 6 条，**不得声称插件可用或发布正式版本** |

**结论**：第 ⑥ 步的**文档与包元数据侧**已完成且可机械核对；**交付本身**卡在第 ⑤ 步——真实闭环未通过前，本插件只能按「代码完成、未联调」描述。`docs/INSTALL.md` 的安装步骤是按宿主约定推导的，尚未在真机上完整走通，第 7 节已逐条标注。

### 不建议提前做的事

- 五路并行（第 1 阶段的占用模型是单写者，并行需要先改占用键的粒度）。
- 独立 Web 管理界面（TUI 已覆盖配置需求；Web 面会引入第二套认证边界）。
- 自动唤醒已结束会话（`docs/DEVELOPMENT.md` 第 1 节已排除，MCP 通知不保证能启动新一轮 GPT）。
- 给 `dsh_wait` 加进度通知（一旦加，就必须同时补 `Mcp-Session-Id` 的分配、校验与过期——见 ARCHITECTURE §5.7 第 6 条的退场条件，只加 GET 流会引入「会话过期」整类失败模式）。
