# 安装与接入

本文说明如何把 `dsh-mcp-bridge` 装进 DSH Desktop、如何让 Codex 连上它、如何卸载，以及**哪些环节已经验证过、哪些还没有**。

> **口径（重要）**：代码已完成，`npm run typecheck`（依赖边界校验 + `tsc --noEmit`）与 `npm run build` 双绿，离线冒烟 5 组 89 项通过。**但插件从未被 DSH 真实加载过，也从未接过真实 MCP 客户端。** 按 `docs/DEVELOPMENT.md` 第 10 节第 6 条，真实闭环通过前不声称插件可用、不发布正式版本。本文的安装步骤是**按宿主约定推导出的路径**，尚未在真机上完整走通——第 7 节逐条列出未验证项。

---

## 1. 前置条件

| 条件 | 要求 | 说明 |
|---|---|---|
| 宿主 | DSH Desktop（`dsh-desktop-next`）**2.0.23-next** | 插件依赖宿主内 `@deepseek-ai/dsh-{host-webserver,api-session-controller,permission-presets,workspace,session}` 的运行时服务，版本均为 **0.2.2-rc.3** |
| Node（构建） | `>=24.9.0` 或 `^22.19.0` | `package.json` 的 `engines.node`。构建只需要能跑 `tsc` |
| Node（TUI） | 系统 node `v22.19.0` 可用 | `bin/dsh-mcp-bridge.mjs` 用系统 node 跑 |
| 凭据 | 环境变量 `DSH_MCP_BRIDGE_TOKEN` | **必填**。未设置时插件启动后所有请求回 `503`，TUI 直接报错退出 |
| 宿主开关 | DSH 设置里「允许浏览器访问」**必须打开** | 默认关闭，关闭时任何请求在到达插件之前就被 `403` 掉。见第 5 节 |

插件本体运行在 DSH 进程内（宿主内 electron-node `v24.21.0`），TUI 是**进程外的配置客户端**，两者用同一份 HTTP 凭据。

---

## 2. 安装

### 2.1 构建

在插件源码目录执行：

```bash
npm install          # 只装 typescript 与 @types/node
npm run typecheck    # 依赖边界校验 + tsc --noEmit，应为 0 错误
npm run build        # 产出 lib/（含 lib/index.js 与 lib/tui/main.js）
```

`lib/` 是运行期必需产物：`package.json` 的 `main` 指向 `./lib/index.js`，`bin/dsh-mcp-bridge.mjs` 动态 import `../lib/tui/main.js`。**没构建就装进去，宿主加载会失败、TUI 会提示「请先在插件目录执行 npm run build」。**

### 2.2 放入 profile 的 `node_modules`

DSH Desktop 的 profile 目录在本机是：

```text
C:\Users\<用户名>\.dsh\profiles\desktop\
```

把整个插件目录复制到该 profile 的 `node_modules` 下，目录名必须与包名一致：

```text
~/.dsh/profiles/desktop/node_modules/dsh-mcp-bridge/
    package.json
    lib/
    bin/
    locale/
    icon.svg
    cordis.patch.yml
    README.md
```

`package.json` 的 `files` 字段声明了这 6 项（`lib`、`bin`、`locale`、`icon.svg`、`cordis.patch.yml`、`README.md`），另有 `!lib/**/*.map` 排除 sourcemap。手工复制时按它抄即可，不要漏 `cordis.patch.yml`——宿主靠它把插件挂进 cordis 树。

### 2.3 加入 profile 的 `dsh.profile.bundles`

编辑 `~/.dsh/profiles/desktop/package.json`，在 `dsh.profile.bundles` 数组里追加包名：

```json
{
  "dsh": {
    "profile": {
      "bundles": [
        "...已有的 34 项...",
        "dsh-mcp-bridge"
      ]
    }
  }
}
```

**这一步不能省**：`bundles` 是宿主决定加载哪些插件的清单，只把包放进 `node_modules` 不会生效。

如果同时想把包登记进 profile 的 `dependencies`（便于 `pnpm install` 管理），本地路径需要用 `file:` 说明符，例如 `"dsh-mcp-bridge": "file:../../code/dsh-mcp-bridge"`。**这条路径未验证**（见第 7 节 U2），手工复制到 `node_modules` 是更确定的做法。

### 2.4 确认 `cordis.patch.yml` 的 `id` / `name`

`cordis.patch.yml` 的内容是：

```yaml
- insert:
    - id: dsh-mcp-bridge
      name: 'dsh-mcp-bridge'
```

两条硬约束：

- **`id` 必须等于 `src/index.ts` 里 `export const name` 的值**（当前都是 `dsh-mcp-bridge`）。不一致时宿主按 row id 找不到插件，加载会**静默跳过**——没有报错，只是路由不存在。
- **`name` 是包名**，宿主按它 resolve 到 `main`（`./lib/index.js`）。

`package.json` 的 `dsh.bundle.patch` 字段指向本文件（`./cordis.patch.yml`），是 CLI 把包追加进 `dsh.profile.bundles` 的硬条件。

### 2.5 设置凭据

插件只从环境变量读凭据，**不接受配置文件、不接受命令行参数**：

```powershell
# PowerShell（当前会话）
$env:DSH_MCP_BRIDGE_TOKEN = "<自己生成的长随机串>"

# 永久（用户级，重启后仍有效）
[Environment]::SetEnvironmentVariable('DSH_MCP_BRIDGE_TOKEN', '<同一个值>', 'User')
```

```bash
# bash / zsh
export DSH_MCP_BRIDGE_TOKEN='<自己生成的长随机串>'
```

要点：

- **必须在启动 DSH 之前设置**。插件在 `apply()` 时读一次 `process.env`，之后不再重读；未设置时所有请求回 `503 bridge is not configured`。
- 生成方式建议 `openssl rand -base64 32` 或 `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`。
- **不要写进源码、Git、任务正文或日志**。Codex 侧用 `bearer_token_env_var` 引用同一个环境变量名，不把值抄进 `config.toml`。

### 2.6 重启 DSH 并确认加载

重启 DSH Desktop。插件加载成功时，宿主日志里能看到一条就绪信息：

```text
dsh-mcp-bridge 已就绪：/mcp/dsh-mcp-bridge 与 /mcp/settings（状态目录：<$DSH_HOME>/dsh-mcp-bridge）
```

如果没看到这条日志，按顺序排查：

1. `dsh.profile.bundles` 里有没有 `dsh-mcp-bridge`；
2. `cordis.patch.yml` 的 `id` 是否等于 `export const name`；
3. `lib/index.js` 是否存在（有没有跑过 `npm run build`）；
4. `DSH_MCP_BRIDGE_TOKEN` 是否在**启动 DSH 的那个环境**里。

插件**不声明 `inject`**，改为调用时 `ctx.get()` 惰性读取宿主服务。原因是宿主服务（尤其 `webServer`）可能晚于插件就绪，声明 `inject` 会让插件在服务缺失时根本不加载。代价是：`webServer` 缺失时插件只打一条 `warn` 就返回，不抛错——所以「加载了但没注册路由」是可能状态，要靠第 2.7 节的探针区分。

### 2.7 验证两条路由存在

```bash
TOKEN='<你设置的 DSH_MCP_BRIDGE_TOKEN>'
BASE='http://127.0.0.1:7275'     # 端口取 DSH 的 Web GUI 端口，本机默认 7275

# 设置路由：应返回 200 + JSON 快照
curl -s -o /dev/null -w '%{http_code}\n' \
  -H "Authorization: Bearer $TOKEN" "$BASE/mcp/settings"

# 不带凭据：应返回 401
curl -s -o /dev/null -w '%{http_code}\n' "$BASE/mcp/settings"

# 不存在的路径：应返回 404（证明插件确实注册了路由，而不是全被兜底吃掉）
curl -s -o /dev/null -w '%{http_code}\n' \
  -H "Authorization: Bearer $TOKEN" "$BASE/mcp/nonexistent-xyz"
```

判据：

| 观察 | 含义 |
|---|---|
| `/mcp/settings` → `200` | 插件已加载且路由已注册，认证通过 |
| `/mcp/settings` → `401` | 路由在，凭据不对（检查 `DSH_MCP_BRIDGE_TOKEN` 是否与启动 DSH 时的值一致） |
| `/mcp/settings` → `503` | 路由在，但插件启动时没读到凭据 |
| `/mcp/settings` → `403` + 正文 `Browser access is disabled` | **请求没到插件**，是宿主围栏拦下的，见第 5 节 |
| `/mcp/settings` → `404` | 路由没注册：插件未加载，或 `webServer` 服务缺失时提前返回了 |
| `/mcp/nonexistent-xyz` → `404` | 正常（宿主对未匹配路径回 404） |
| `/mcp/nonexistent-xyz` → `403` | 宿主围栏仍开着，先按第 5 节处理，否则 404/200 都测不出来 |

> **注意**：`403 Browser access is disabled` 会**盖住一切**——包括不存在的路径。所以在打开「允许浏览器访问」之前，`403` 不能用来判断「路由不存在」。本机实测：围栏关闭时 `/`、`/mcp/settings`、`/mcp/dsh-mcp-bridge`、`/mcp/nonexistent-xyz` **全部**返回 `403`。

---

## 3. 卸载

1. 从 `~/.dsh/profiles/desktop/package.json` 的 `dsh.profile.bundles` 里**删掉** `"dsh-mcp-bridge"`。
2. 如果曾把它加进 `dependencies`，一并删掉那一行。
3. 删除 `~/.dsh/profiles/desktop/node_modules/dsh-mcp-bridge/` 整个目录。
4. 重启 DSH。

**确认无残留**：

```bash
TOKEN='<原凭据>'
BASE='http://127.0.0.1:7275'

# 两条路由都应变成 404
curl -s -o /dev/null -w 'settings=%{http_code}\n' \
  -H "Authorization: Bearer $TOKEN" "$BASE/mcp/settings"
curl -s -o /dev/null -w 'mcp=%{http_code}\n' \
  -H "Authorization: Bearer $TOKEN" -X POST \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"ping"}' "$BASE/mcp/dsh-mcp-bridge"
```

前提仍是**「允许浏览器访问」已打开**，否则一律 `403`，看不出差别。

卸载后**不会**自动清理的：

- `$DSH_HOME/dsh-mcp-bridge/state.json`（会话归属登记表）
- `$DSH_HOME/dsh-mcp-bridge/settings.json`（桥接默认模型与默认权限）

这两个文件是插件自己的数据，删不删都不影响宿主；需要彻底清干净就手工删目录。**插件不写 DSH profile、不写 DSH 会话文件、不改全局默认模型**，所以卸载不会牵动宿主配置。

插件卸载时只注销自己注册的两条路由（`src/index.ts` 的 `ctx.effect` 清理函数），**不终止任何进程、不关闭宿主监听、不动其它插件的订阅**。

---

## 4. Codex 侧接入

编辑 `~/.codex/config.toml`（用户级；项目内 `.codex/config.toml` 只对受信项目生效）：

```toml
[mcp_servers.dsh_bridge]
url = "http://127.0.0.1:7275/mcp/dsh-mcp-bridge"
bearer_token_env_var = "DSH_MCP_BRIDGE_TOKEN"
startup_timeout_sec = 20
tool_timeout_sec = 120
```

字段说明：

| 字段 | 作用 |
|---|---|
| `url` | Streamable HTTP 端点。端口取 DSH 的 Web GUI 端口（本机默认 `7275`），路径固定 `/mcp/dsh-mcp-bridge` |
| `bearer_token_env_var` | **一个环境变量名**。Codex 读它的值，作为 `Authorization: Bearer <值>` 发出。**值本身不进配置文件** |
| `startup_timeout_sec` | 握手超时，默认 10 秒。本机冷启动时给到 20 秒更稳 |
| `tool_timeout_sec` | 单次工具调用超时，默认 60 秒。`dsh_wait` 会按自己的 `timeoutMs` 长挂（默认 30 秒），这里给到 120 秒留余量 |

要点：

- **不要**用 `http_headers = { Authorization = "Bearer xxx" }` 把凭据明文写进配置文件——那会进 Git、进备份、进截图。
- Codex CLI、IDE 扩展、桌面 app **共享同一份 `config.toml`**。加坏一条会影响三者，改之前先备份。
- `codex mcp list` 可以确认 server 已登记。
- 环境变量必须在**启动 Codex 的那个环境**里可见（GUI 启动的 Codex 未必继承 shell 里的 `export`）。

四个工具：`dsh_start`（派单）、`dsh_wait`（等结果）、`dsh_send`（补充说明或回答提问）、`dsh_cancel`（取消）。契约见 `docs/ARCHITECTURE.md` 第 5 节。

---

## 5. 硬前置：DSH 的「允许浏览器访问」

**这是最容易卡住的一步，且症状完全不像权限问题。**

### 现象

任何 HTTP 请求（包括 Codex 的 MCP 请求、TUI 的设置读写）都返回：

```text
HTTP/1.1 403 Forbidden
cache-control: no-store
content-type: text/plain;charset=UTF-8

Browser access is disabled
```

带不带 `Authorization` 头都一样。

### 原因

DSH Desktop 的 `NextWebServer` 在 `register()` 时把每条路由包了一层 `policy()`，围栏是 handler 的**第一步**，在路由匹配**之前**：

```js
if (!this.permits(request)) {
  response.writeHead(403, { 'cache-control': 'no-store' })
  response.end('Browser access is disabled')
  return
}
```

`permits()` 的判定（`decideDesktopBrowserAccess`）：

1. 请求头 `x-dsh-desktop-renderer` 与宿主启动时随机生成的 token 一致 → 放行（**只注入 Electron 渲染进程的原生网络会话**）；
2. 否则若 `browserAccess` 关闭 → 拒绝；
3. 否则放行。

`browserAccess` 的默认值是 **`false`**。

### 处理

在 **DSH Desktop 的设置界面**里打开「允许浏览器访问」开关。打开后无需重启 DSH，围栏立即放行。

### 排查顺序

1. 先看响应正文是不是 `Browser access is disabled`——是就只查这个开关，别去查回环地址、防火墙、端口。
2. 开关已开仍 `403`：确认请求没带 `x-dsh-desktop-renderer` 头（带了但 token 不对也会被拒）。
3. 开关已开、`403` 消失但仍连不上：再按第 2.7 节的 `401`/`503`/`404` 分支排查。

### 插件不做的事

插件**不绕过**这道围栏：不伪造 `x-dsh-desktop-renderer`、不改宿主偏好文件、不自起 HTTP 服务。这是宿主的安全边界，绕过等于把本机 DSH 的全部路由暴露给任何本机进程。

TUI 已经能识别这条 `403` 并给出中文提示：

```text
403：DSH 桌面端未允许浏览器访问，请求在到达插件之前就被拦下了。请在 DSH 设置里打开「允许浏览器访问」后重试（该开关默认关闭）
```

---

## 6. 支持的版本

| 项 | 值 | 依据 |
|---|---|---|
| 宿主版本 | `dsh-desktop-next` **2.0.23-next** | 本机实测 |
| 宿主内 DSH 服务 | `@deepseek-ai/dsh-{host-webserver,api-session-controller,permission-presets,workspace,session}` **0.2.2-rc.3** | 本机实测 |
| `peerDependencies` | `>=0.2.0-rc.1 <0.3.0-0`（5 条，全部 `optional: true`） | `package.json` |
| `engines.node` | `^22.19.0 \|\| >=24.9.0` | `package.json` |
| `engines.dsh` | `>=0.2.0-rc.1 <0.3.0-0` | `package.json`，与 5 条 `peerDependencies` 范围一致 |
| 宿主要求的 node | `>=24.9.0` | 宿主 `package.json` 的 `engines` |
| 插件本体实际运行环境 | electron-node **v24.21.0** | 宿主进程内，满足 `>=24.9.0` |
| TUI 实际运行环境 | 系统 node **v22.19.0** | 满足 `^22.19.0` |

关于 `engines.dsh`：宿主**确实**会校验它。`@deepseek-ai/dsh-app-boot` 的 `lib/index.js` 里有 `evaluatePluginCompatibility(manifest, exemptions, runtimeVersion)`，其 `unmetRequirements()` 的判定是：

- manifest 自带 `engines.dsh` → **它单独决定**，`peerDependencies` 被完全忽略；
- 没有 `engines.dsh` → 遍历 `peerDependencies`，只检查名字等于 `@deepseek-ai/dsh` 或以 `@deepseek-ai/dsh-` 开头的项。

两侧都用 `semver.satisfies(runtimeVersion, range, { includePrerelease: true })`，`runtimeVersion` 默认取 app-boot 自己的 `package.json` 的 `version`（本机 **0.2.2-rc.3**）。不满足时宿主会给出兼容性警告，并提示可用 `dsh plugin allow-version` 或插件管理器授予 exact-version exemption。

本项目两条路径都已实测通过：5 条 `peerDependencies` 范围对 0.2.2-rc.3 全部 `satisfies === true`；`engines.dsh` 写成 `>=0.2.0-rc.1 <0.3.0-0` 同样为 `true`。写 `engines.dsh` 的作用是把版本契约显式化（不再依赖 peer 隐式推断），范围与 peer 保持一致以免两处口径分叉。

换到别的 DSH 版本前仍应先核对那几个 `@deepseek-ai/dsh-*` 服务的接口是否仍一致（`docs/IMPLEMENTATION.md` 第 3 节列了实际用到的全部签名）——版本号满足不等于接口不变。

---

## 7. 已验证范围与未验证项

### 已验证（有可复现证据）

| 项 | 证据 |
|---|---|
| 依赖边界 | `npm run check:boundaries` → 「依赖规则校验通过（51 个文件）」，exit 0 |
| 类型正确性 | `npx tsc --noEmit` → 0 错误 |
| 构建产物 | `npm run build` → `lib/` 全量产出（含 `lib/index.js`、`lib/tui/main.js`） |
| CLI 入口 | `node bin/dsh-mcp-bridge.mjs --help` → exit 0；未知命令 → exit 2；`config` 带多余参数 → exit 2 |
| TUI 无凭据路径 | `printf 'q\n' \| DSH_MCP_BRIDGE_TOKEN= node bin/dsh-mcp-bridge.mjs config` → exit 1，提示「未设置环境变量 DSH_MCP_BRIDGE_TOKEN」 |
| TUI 遇宿主围栏 | 同上但带假凭据 → exit 1，提示「403：DSH 桌面端未允许浏览器访问…」 |
| 协议与领域逻辑 | 离线冒烟 5 组 89 项：版本协商、`-32600`/`-32601`/`-32602` 分界、通知不回帧、`Accept` 双分支、401/403/503/405/204/413、六态映射、回合归属、输出裁剪、权限三层解析 |

离线冒烟**不在仓库里**：做法是把 `src/` 复制到临时目录、把 `.js` 说明符改成 `.ts`、用 `node --experimental-transform-types` 跑。它验证的是纯函数与分派逻辑，**不经过真实 HTTP 服务器，也不经过宿主**。

### 未验证（按 `docs/REVIEW.md` 1.2 的编号）

| # | 未验证项 | 为什么没验 | 怎么解除 |
|---|---|---|---|
| U2 | 插件能被 DSH 真实加载 | 未启动 DSH 联调 | 按本文装好后看第 2.6 节的就绪日志 |
| U3 | MCP 客户端的版本协商与 SSE 行为 | 无真实客户端 | 用 Codex 连一次，确认 `initialize` 成功、四个工具可列 |
| U4 | ~~`locale`/`icon.svg` 元数据~~ | **已解决**：`locale/{en,zh}.json` 与 `icon.svg` 已建，`files` 已补全 | — |
| U5 | 宿主 `wait` 在真实会话下的表现 | 无真实会话 | 跑一个真实回合，确认超时分支不是常态 |
| U6 | `sessionProjections.stateOf(session,'userQuestions')` 的实际形状 | 该 API 已废弃，离线造不出投影 | 触发一次 `ask_user_question` |
| U7 | `permissionPresets.current` / `modelSelection` 回读 | 第 1 阶段刻意不回读 | 第 2 阶段接入回读时验 |
| U8 | `workspaceRegistry.create` 的 `created` 判定 | 宿主未暴露该标志，靠 `list().length` 差推断 | 第 ⑤ 步顺带核对 |
| U9 | 设置路由在真实实例上的读写 | 无运行中的插件实例 | `GET` 一次快照、`PUT` 一次默认值，确认落盘到 `$DSH_HOME/dsh-mcp-bridge/settings.json` |
| U10 | TUI 在真实终端里的完整交互 | 只验了 help 与错误路径 | 在 Windows Terminal 与 `cmd` 各跑一遍 `m/e/p/r/s/q` |
| U11 | `reply` 走原生 `answer` 的真实行为 | 需要真实挂起的提问 | 让模型问一个问题，`dsh_wait` 拿到 `needs_input`，再 `dsh_send({ reply })` |
| U12 | `reply` 的回合基线退一格是否总能匹配 | 依赖「答案作为 steering 消息塞进当前开放回合」 | `reply` 后 `dsh_wait` 应报 `completed` 而非 `turn-missing` |

### 联调（第 ⑤ 步）的前置条件

1. **用户明确授权**启动 DSH 做联调（`docs/DEVELOPMENT.md` 第 10 节末的约束）。
2. **DSH 设置里「允许浏览器访问」已打开**（第 5 节）。
3. `DSH_MCP_BRIDGE_TOKEN` 在启动 DSH 的环境里可见。
4. 一个真实 MCP 客户端（Codex）已按第 4 节配好。

联调必须验的 7 条（前 6 条来自 `docs/DEVELOPMENT.md` 第 10 节，第 7 条是评审补充）：

1. 同路径连续派单不重复注册工作区；不同 worktree 不混淆。
2. 两个 Codex 对话共享工作区但各有自己的 DSH 会话，返工回原会话。
3. 模型三层生效；保存的配置失效时明确报错。
4. 三档权限生效，`auto` 真调原生审查。
5. 六态可区分；等待超时不重复派单；取消与重连不误报完成；同一请求重试不产生第二份执行。
6. 仅本机认证客户端可派单与保存设置。
7. **插件重载后路由仍可达、卸载后路由消失**——这条只有真机加载能验（离线冒烟直接调 `dispatch`，绕过了 `apply`）。

---

## 8. 常见问题

**Q：`/mcp/settings` 一直 403，正文是 `Browser access is disabled`。**
A：第 5 节。去 DSH 设置打开「允许浏览器访问」。

**Q：`/mcp/settings` 返回 404。**
A：插件没被加载，或加载了但 `webServer` 服务缺失时提前返回了。按第 2.6 节四条排查；重点看 `cordis.patch.yml` 的 `id` 是否等于 `export const name`。

**Q：返回 503。**
A：插件启动了但没读到凭据。`DSH_MCP_BRIDGE_TOKEN` 必须在**启动 DSH 的那个环境**里，改完要重启 DSH。

**Q：Codex 里能看到四个工具，但 `dsh_start` 报 `workspace-busy`。**
A：同一规范化工作目录同时只允许本插件的一个写入任务。等前一个任务 `completed`/`failed`/`cancelled`，或先 `dsh_cancel`。这个限制**只约束本插件派发的任务**，不锁用户或其它程序的文件操作。

**Q：`dsh_wait` 报 `turn-missing`（`failed`）。**
A：插件没能在会话历史里找到本请求对应回合的结束事件。长会话下可能撞上分页窗口上限（`docs/REVIEW.md` R9，已做保守兜底：窗口耗尽时不判 `turn-missing`）。若稳定复现，请连同 `sessionId`、`requestId`、会话游标一起反馈。

**Q：TUI 里模型列表是空的。**
A：`connection.ok` 为假表示模型目录没读到。TUI 会显示连接错误而**不伪造列表**。先确认第 2.7 节的 `/mcp/settings` 返回 200。

**Q：TUI 里 `auto`（帮我批准）是灰的。**
A：`auto` 预设由宿主的自动审查插件（`dsh-experimental-auto-review`）动态提供。该插件未启用时 `auto` 不可选，TUI 会显示原因。**桥接不自己注册 `auto`**——重复注册会让宿主抛 `permission: preset "auto" is already registered`。
