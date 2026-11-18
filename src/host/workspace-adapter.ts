/**
 * 工作区适配器：`WorkspacePort` 的宿主实现。
 *
 * 关键行为来自宿主 `WorkspaceRegistry.create(path)`（dsh-workspace/src/index.ts:255）：
 * - 内部做 realpath 规范化；
 * - 相对路径、不存在、非目录都会 reject；
 * - 同一 canonical 路径重复调用返回既有实体，且**不改标题**。
 *
 * 因此桥接层不需要自己判重，也不需要自己维护「路径 → workspaceId」映射。
 */

import { bridgeError } from '../domain/errors.js'
import type {
  EnsureWorkspaceInput,
  EnsureWorkspaceResult,
  WorkspacePort,
  WorkspaceSummary,
} from '../ports/workspace-port.js'
import { readService, requireService } from './context.js'
import type { HostContext } from './host-types.js'

export function createWorkspaceAdapter(ctx: HostContext): WorkspacePort {
  return {
    async ensureWorkspace(input: EnsureWorkspaceInput): Promise<EnsureWorkspaceResult> {
      const registry = requireService(ctx, 'workspaceRegistry')

      // 前置校验：把「相对路径」在进入宿主前就拦下，错误信息比宿主的更明确。
      if (!isAbsolutePath(input.cwd)) {
        throw bridgeError('workspace-rejected', `工作目录必须是绝对路径：${input.cwd}`, {
          cwd: input.cwd,
        })
      }

      const before = registry.list().length
      let workspace
      try {
        workspace = await registry.create(input.cwd)
      } catch (cause) {
        throw bridgeError(
          'workspace-rejected',
          `工作目录不可用（不存在或不是目录）：${input.cwd}`,
          { cwd: input.cwd },
          cause,
        )
      }

      // `create` 对既有路径返回既有实体，所以「是否新建」用调用前后的数量差判断。
      // 宿主没有直接暴露 created 标志，这是唯一不引入额外状态的做法。
      const after = registry.list().length
      return {
        workspaceId: workspace.id,
        canonicalCwd: workspace.path,
        created: after > before,
      }
    },

    async resolveWorkspace(id: string): Promise<EnsureWorkspaceResult | null> {
      const registry = requireService(ctx, 'workspaceRegistry')
      const workspace = registry.get(id)
      if (workspace === undefined) return null
      return { workspaceId: workspace.id, canonicalCwd: workspace.path, created: false }
    },

    async listWorkspaces(): Promise<readonly WorkspaceSummary[] | null> {
      const registry = readService(ctx, 'workspaceRegistry')
      if (registry === undefined) return null
      try {
        return registry.list().map(workspace => ({
          id: workspace.id,
          path: workspace.path,
          title: workspace.title,
        }))
      } catch {
        return null
      }
    },
  }
}

/**
 * 判断绝对路径。
 *
 * 不用 `node:path.isAbsolute` 是为了同时接受 Windows 盘符路径与 POSIX 路径，
 * 且不把 `node:path` 的平台差异带进判断——客户端可能从 WSL 或容器里发来
 * `/home/x` 形式，只要宿主能 realpath 成功就应当放行。
 */
function isAbsolutePath(cwd: string): boolean {
  if (cwd.length === 0) return false
  if (cwd.startsWith('/')) return true
  // Windows 盘符：C:\ 或 C:/
  if (/^[A-Za-z]:[\\/]/.test(cwd)) return true
  // UNC：\\server\share
  if (cwd.startsWith('\\\\')) return true
  return false
}
