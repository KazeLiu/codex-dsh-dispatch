# 发布与商店投稿

先构建并打包，将同一份预构建产物发布到 npm 和 GitHub Release，再按条件提交商店条目。npm 发布与商店收录是两件事。

## 1. 发布前检查

| 项 | 状态 |
| --- | --- |
| `package.json` 的 `name` | `codex-dsh-dispatch` |
| `private` | 已移除，可 `npm publish` |
| `dsh.bundle.patch` → `cordis.patch.yml` | 已声明 |
| `repository` / `homepage` / `bugs` | 已指向 `KazeLiu/codex-dsh-dispatch` |
| `files` 是否含 `lib/` | 是；预构建包自带 `lib/`，用户不需要自己编译 |
| 官方 `@deepseek-ai/*` 是否在 peer | 是（4 个，全 optional） |
| `license` | 未声明；投稿要求里没有这条硬门槛，是否补由仓库所有者决定 |

`engines.dsh` 与四项 peer 都以 Harness `0.2.2-rc.3`（DSH NEXT 2.0.23-next 内置版本）为下限，范围为 `>=0.2.2-rc.3 <0.3.0-0`。`0.2.0` 和 `0.2.1` 的预发布线缺少派单所需的会话模型和状态接口，不在兼容范围内。扩大范围前先核对宿主接口。

## 2. 发 npm 包与 Release tgz

```sh
npm run typecheck
npm run build
# 产出 codex-dsh-dispatch-0.3.2.tgz
npm pack --ignore-scripts
# 发布刚检查过的同一份产物，不再次运行构建脚本
npm publish codex-dsh-dispatch-0.3.2.tgz --ignore-scripts --access public --registry=https://registry.npmjs.org
```

`prepare` 在源码安装和打包阶段编译 TypeScript，不登记 MCP、不写 AGENTS、不改 PATH。上面的流程先构建，再用 `--ignore-scripts` 打包并发布同一份产物。`--omit=dev` 不安装 TypeScript，但不会自动跳过脚本；源码构建仍需要开发依赖，预构建包应自带 `lib/`。

上传 Release 资产时**把文件名改成不带版本号的 `codex-dsh-dispatch.tgz`**（`npm pack` 产出的原名带版本号）。这样 `releases/latest/download/codex-dsh-dispatch.tgz` 在任何一次发版后都仍然有效。

### 发布后的安装形态

```cmd
rem 从 npm 安装全局命令
npm install -g codex-dsh-dispatch
```

```cmd
rem 或从本项目 Release 的 tgz 安装
npm install -g https://github.com/KazeLiu/codex-dsh-dispatch/releases/latest/download/codex-dsh-dispatch.tgz
```

```cmd
rem 锁定某个版本
npm install -g https://github.com/KazeLiu/codex-dsh-dispatch/releases/download/v0.3.1/codex-dsh-dispatch.tgz
```

DSH 插件也可以直接用同一个 tgz 安装，不需要用户保留源码目录。

## 3. 投稿到 awesome-dsh-plugin

向 [awesome-dsh-plugin 目录](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/contributing.md) 投稿。目录需要能读取公开仓库默认分支上的 `package.json`；PR 合并后，DSH 插件市场会跟随目录更新。

### 逐条对照

| 要求 | 本仓库 |
| --- | --- |
| `package.json` 声明 `dsh.bundle.patch` | ✅ `./cordis.patch.yml` |
| 仓库根有对应 `cordis.patch.yml` | ✅ |
| 真实可用的代码 | 原生派单的历史闭环记录见 `docs/ACCEPTANCE.md`；`queue` / `steer` 双模式仍需构建后在真实会话里联调 |
| 仓库创建满 24 小时 | 创建于 2026-11-17T02:02:28Z，最早 2026-11-18T02:02:28Z 满足 |
| 添加 `dsh-plugin` topic | 已添加 |
| 描述准确、无营销词 | 见下方草稿 |
| 官方 `@deepseek-ai/*` 用 peer | ✅ |
| 推荐：npm 预构建或 Release tgz | 按第 2 节发布预构建包后再提交 |

### 投稿草稿（可直接复制）

文件路径：`data/plugins/KazeLiu__codex-dsh-dispatch.yml`

```yaml
url: https://github.com/KazeLiu/codex-dsh-dispatch
name: KazeLiu/codex-dsh-dispatch
category: workflow
description:
  en: Lets Codex dispatch tasks to DeepSeek Harness, wait for results, and follow up in the same DSH session.
  zh: 让 Codex 向 DeepSeek Harness 派单、等待结果，并在原 DSH 对话中继续派单。
```

说明：

- `url` 必须与仓库地址完全一致（仓库是原仓库改名而来，不是新建）。
- `category` 选 `workflow`：这个插件做的是把两个 agent 串成一条协作流水线，不是 UI、不是工具集合。
- 描述只说功能，不含「强大」「最好」之类营销词。
- 没有 `icon:`（仓库里的 `icon.svg` 是 DSH 插件图标，商店卡片要求 GitHub 托管的**位图**）。
- 已发布的 npm 包由目录按 `repository` 自动关联；条目不用填 `npm:` 或固定的 `tarball:`。

### 提交

一个 PR 只加这一个文件。不要手工编辑仓库生成的 README，也不要动别人的条目。
