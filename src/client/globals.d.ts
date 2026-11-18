/**
 * 客户端片段的全局声明。
 *
 * 两条硬约束：
 *
 * 1. React 由宿主工厂注入（`var React = require('react')`），**不打包第二份**——
 *    两个 React 实例会让 hooks 立刻失效。所以这里只声明类型，不引入运行时。
 * 2. 片段靠拼接顺序共享符号，一旦出现顶层 import/export 就成了模块，符号对其它
 *    片段不可见。跨文件类型一律用 `import('...')` 类型查询，编译期擦除。
 */

declare const React: typeof import('react')

type CdElement = import('react').ReactElement
type CdNode = import('react').ReactNode
type CdStyle = import('react').CSSProperties

type CdSettingsSnapshot = import('../domain/settings.js').SettingsSnapshot
type CdSettingsUpdate = import('../domain/settings.js').SettingsUpdate
type CdSavedModelChoice = import('../domain/settings.js').SavedModelChoice
type CdPermissionOption = import('../domain/settings.js').SettingsPermissionOption
type CdPermissionLevel = import('../domain/types.js').PermissionLevel
type CdIntegrationSnapshot = import('../domain/codex-integration.js').CodexIntegrationSnapshot
type CdRegistrationView = import('../domain/codex-integration.js').CodexRegistrationView
type CdAgentsFileView = import('../domain/codex-integration.js').AgentsFileView
type CdAgentsAction = import('../domain/codex-integration.js').AgentsAction
