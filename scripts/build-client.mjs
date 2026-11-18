/**
 * 把 `src/client/logic/*.ts` 打成一个客户端工厂 `lib/client.js`。
 *
 * 为什么不走常规打包：宿主用 `window.__ModuleLoader__.load({id, factory})` 接收
 * 插件前端，工厂体里 `require('react')` 拿到的是宿主自己那份 React。任何打包器
 * 都会把依赖一起塞进来（React 打进第二份，hooks 立刻炸），所以这里只做一件事
 * ——把若干 TypeScript 片段转译成 JS、按顺序拼进同一个函数作用域。
 *
 * 拼接顺序就是依赖顺序：后面的片段能看见前面片段声明的符号。片段里不能有
 * `import`/`export`，否则它成了模块，符号对其它片段不可见（产物校验会拦）。
 *
 * 用 `ts.transpileModule` 而不是 `tsc`：后者按文件产出模块，还得再拼一次；
 * 前者逐片段出纯 JS，正好是这里需要的形状。typescript 已在 devDependencies。
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import ts from 'typescript'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const SOURCE_DIR = join(ROOT, 'src', 'client', 'logic')
const OUTPUT_FILE = join(ROOT, 'lib', 'client.js')

/**
 * 片段顺序。
 *
 * `globals.d.ts` 不参与：它只有类型声明，转译后是空文件。类型通过
 * `import('...')` 类型查询注入全局，编译期擦除，产物里没有对应代码。
 */
const BODY_ORDER = ['api.ts', 'store.ts', 'ui.ts', 'section.ts', 'register.ts', 'apply.ts']

/** 转译选项：输出与宿主一致的 ES2023，模块语法一律不产出。 */
const COMPILER_OPTIONS = {
  target: ts.ScriptTarget.ES2023,
  module: ts.ModuleKind.None,
  newLine: ts.NewLineKind.LineFeed,
  removeComments: false,
  sourceMap: false,
}

function transpileFragment(fileName) {
  const source = readFileSync(join(SOURCE_DIR, fileName), 'utf8')
  const result = ts.transpileModule(source, {
    compilerOptions: COMPILER_OPTIONS,
    fileName,
    reportDiagnostics: true,
  })

  const errors = (result.diagnostics ?? []).filter(
    diagnostic => diagnostic.category === ts.DiagnosticCategory.Error,
  )
  if (errors.length > 0) {
    const message = errors
      .map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, ' '))
      .join('; ')
    throw new Error(`客户端 TypeScript 片段无法转译（${fileName}）: ${message}`)
  }

  return result.outputText.replace(/\r\n/g, '\n').trim()
}

function build() {
  const body = BODY_ORDER.map(transpileFragment).join('\n\n')

  const output = `window.__ModuleLoader__.load({
  id: 'codex-dsh-dispatch',
  factory: function (require) {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
    var React = require('react');

${indent(body, 4)}

    exports.inject = ['slots'];
    exports.apply = apply;
    return module.exports;
  }
});
`

  // 产物校验：形状必须对，且不能混进模块语法。
  if (!output.includes('window.__ModuleLoader__.load({')) {
    throw new Error('客户端产物缺少 window.__ModuleLoader__.load 包装。')
  }
  const moduleSyntax = /\b(?:import|export)\s+(?:[A-Za-z{*]|default)\b/
  if (moduleSyntax.test(body)) {
    throw new Error('客户端片段里出现了 import/export 语句：片段必须共享同一个作用域。')
  }

  mkdirSync(dirname(OUTPUT_FILE), { recursive: true })
  writeFileSync(OUTPUT_FILE, output, 'utf8')
  process.stdout.write(`已生成 ${OUTPUT_FILE}（${BODY_ORDER.length} 个片段）。\n`)
}

function indent(text, spaces) {
  const pad = ' '.repeat(spaces)
  return text
    .split('\n')
    .map(line => (line === '' ? line : pad + line))
    .join('\n')
}

build()
