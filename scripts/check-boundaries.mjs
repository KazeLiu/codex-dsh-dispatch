#!/usr/bin/env node
/**
 * 分层依赖规则校验（对应 docs/ARCHITECTURE.md 第 3 节的 D1–D7）。
 *
 * 用法：node scripts/check-boundaries.mjs
 * 退出码：0 通过；1 有违规（逐条打印文件:行号与原因）。
 *
 * 只做静态文本扫描，不解析 TypeScript 语法树——规则本身足够简单，
 * 引入解析器会为一个 grep 能解决的问题增加依赖。
 */

import { readdir, readFile } from 'node:fs/promises'
import { join, posix, relative, sep } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const SRC = join(ROOT, 'src')

/** 收集 src 下全部 .ts 文件，返回相对 src 的 posix 路径。 */
async function collect(dir) {
  const out = []
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...(await collect(full)))
    else if (entry.name.endsWith('.ts')) out.push(relative(SRC, full).split(sep).join('/'))
  }
  return out
}

/** 取出所有 import/export-from 的模块说明符。 */
function specifiers(text) {
  const found = []
  const patterns = [
    /(?:^|\n)\s*import\s[^'"\n]*?from\s*['"]([^'"]+)['"]/g,
    /(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g,
    /(?:^|\n)\s*export\s[^'"\n]*?from\s*['"]([^'"]+)['"]/g,
  ]
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const line = text.slice(0, match.index).split('\n').length
      found.push({ spec: match[1], line })
    }
  }
  return found
}

/** 层名 → 该层是否允许 import 宿主包。 */
const HOST_ALLOWED = new Set(['index.ts', 'host'])

/**
 * 允许的跨层依赖方向（层 → 可引用的其它层）。
 *
 * 与 docs/ARCHITECTURE.md 第 1 节表格一致：依赖只能由外向内，
 * `transport → mcp → app → {domain, ports}`，`host → {domain, ports}`。
 * 未列出的目标层即视为横向跳层。
 */
const ALLOWED_TARGETS = new Map([
  ['host', new Set(['domain', 'ports'])],
  ['transport', new Set(['mcp', 'domain', 'ports'])],
  ['mcp', new Set(['app', 'domain', 'ports'])],
  ['app', new Set(['domain', 'ports', 'codex'])],
  ['domain', new Set()],
  ['ports', new Set(['domain'])],
  // Codex 接入层：只碰本机 Codex CLI 与 AGENTS.md，不依赖任何其它层。
  // 单独成层是因为它同时被插件后端（设置页）与进程外 TUI 使用——
  // 放进 tui/ 会让后端反向依赖进程外客户端，放进 app/ 又会让 TUI 越层。
  ['codex', new Set()],
  // 原生设置页的浏览器端代码：只能依赖最内层的纯类型与纯函数，
  // 不能碰 node:*（它在浏览器里跑），也不能碰任何后端实现。
  ['client', new Set(['domain'])],
  // TUI 是**进程外的配置客户端**：它通过本机认证通道读写插件服务，不 import
  // 任何用例层或宿主层模块。只允许依赖最内层的纯类型与纯函数，这样它既不会
  // 绕过插件直接改 profile/会话文件，也不会因为分层漂移而拿到不该有的能力。
  ['tui', new Set(['domain', 'codex'])],
])

/** 每层的禁入规则：层前缀 → 判定函数。 */
const RULES = [
  {
    id: 'D1',
    reason: '@deepseek-ai/* 只允许出现在 src/index.ts 与 src/host/**',
    check: (file, spec) =>
      spec.startsWith('@deepseek-ai/') &&
      !HOST_ALLOWED.has(file.split('/')[0]) &&
      file !== 'index.ts',
  },
  {
    id: 'D2',
    reason: 'src/domain/** 不得 import node:http、node:fs、宿主包或 src/host/**',
    check: (file, spec) =>
      file.startsWith('domain/') &&
      (/^node:(http|https|fs|net|tls)$/.test(spec) ||
        spec.startsWith('@deepseek-ai/') ||
        spec.includes('/host/') ||
        spec.startsWith('../host')),
  },
  {
    id: 'D4',
    reason: 'src/mcp/** 不得 import src/host/**',
    check: (file, spec) =>
      file.startsWith('mcp/') && (spec.includes('/host/') || spec.startsWith('../host')),
  },
  {
    id: 'D5',
    reason: 'src/transport/** 不得 import src/host/** 或 src/app/**',
    check: (file, spec) =>
      file.startsWith('transport/') &&
      (spec.includes('/host/') ||
        spec.startsWith('../host') ||
        spec.includes('/app/') ||
        spec.startsWith('../app')),
  },
  {
    id: 'D6',
    reason: 'MCP SDK 仅用于协议与传输适配',
    check: (file, spec) => spec.startsWith('@modelcontextprotocol/sdk') && !['mcp', 'transport', 'tui'].includes(file.split('/')[0]),
  },
  {
    id: 'D8',
    reason: 'src/client/** 在浏览器里跑，不得 import node:* 或宿主包',
    check: (file, spec) =>
      file.startsWith('client/') && (spec.startsWith('node:') || spec.startsWith('@deepseek-ai/')),
  },
  {
    id: 'D7',
    reason: '不得用相对路径横向跳到兄弟层（host/transport/app/mcp 之间）',
    check: (file, spec) => {
      if (!spec.startsWith('..')) return false
      const layer = file.split('/')[0]
      // 按 posix 归一化后再判断：同层内的 ../ 合法（如 domain/projection/x.ts → ../types）
      const resolved = posix.normalize(posix.join(posix.dirname(file), spec))
      const targetLayer = resolved.split('/')[0]
      // 同层内（含子目录回父目录）合法
      if (targetLayer === layer || targetLayer === 'connection.js') return false
      // 只允许第 1 节表格声明的向内依赖，其余跨层视为横向跳层
      return !(ALLOWED_TARGETS.get(layer)?.has(targetLayer) ?? false)
    },
  },
]

/** D3：ports 层只允许类型声明，不允许运行时实现。 */
async function checkPorts(files) {
  const violations = []
  for (const file of files.filter((f) => f.startsWith('ports/'))) {
    const text = await readFile(join(SRC, file), 'utf8')
    const lines = text.split('\n')
    lines.forEach((line, index) => {
      const trimmed = line.trim()
      if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return
      if (/^(export\s+)?(declare\s+)?(async\s+)?function\s/.test(trimmed) ||
          /^(export\s+)?(abstract\s+)?class\s/.test(trimmed) ||
          /^(export\s+)?(const|let|var)\s+\w/.test(trimmed)) {
        violations.push({
          rule: 'D3',
          file,
          line: index + 1,
          reason: 'src/ports/** 只允许 interface/type，不得有运行时代码',
          text: trimmed.slice(0, 80),
        })
      }
    })
  }
  return violations
}

const files = await collect(SRC)
if (files.length === 0) {
  console.log('src/ 下没有 .ts 文件，跳过依赖规则校验。')
  process.exit(0)
}

const violations = []
for (const file of files) {
  const text = await readFile(join(SRC, file), 'utf8')
  for (const { spec, line } of specifiers(text)) {
    for (const rule of RULES) {
      if (rule.check(file, spec)) {
        violations.push({ rule: rule.id, file, line, reason: rule.reason, text: spec })
      }
    }
  }
}
violations.push(...(await checkPorts(files)))

if (violations.length === 0) {
  console.log(`依赖规则校验通过（${files.length} 个文件）。`)
  process.exit(0)
}

for (const v of violations) {
  console.error(`${v.rule} src/${v.file}:${v.line}  ${v.reason}\n    → ${v.text}`)
}
console.error(`\n共 ${violations.length} 处违规。规则定义见 docs/ARCHITECTURE.md 第 3 节。`)
process.exit(1)
