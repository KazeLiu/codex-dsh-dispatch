/**
 * 端口汇总：应用层通过这里拿到全部宿主能力，不直接接触宿主包。
 *
 * 注意：本层只允许类型声明（依赖规则 D3）。
 */

import type { CodexConfigPort } from './codex-port.js'
import type { InteractionPort } from './interaction-port.js'
import type { ModelPort } from './model-port.js'
import type { PermissionPort } from './permission-port.js'
import type { SessionRegistryPort } from './registry-port.js'
import type { SessionPort } from './session-port.js'
import type { SettingsPort } from './settings-port.js'
import type { WorkspacePort } from './workspace-port.js'

export type {
  ApplyPresetInput,
  AvailablePresetsResult,
  CurrentPresetInput,
  PermissionPort,
  PresetOption,
} from './permission-port.js'
export type {
  ApplySelectionInput,
  CurrentSelectionInput,
  ModelCatalogResult,
  ModelPort,
} from './model-port.js'
export type {
  CancelInput,
  CancelResult,
  CreateSessionInput,
  CreateSessionResult,
  PromptInput,
  PromptResult,
  ReadProgressInput,
  ReadStateInput,
  SessionPort,
  WaitInput,
} from './session-port.js'
export type {
  EnsureWorkspaceInput,
  EnsureWorkspaceResult,
  WorkspacePort,
  WorkspaceSummary,
} from './workspace-port.js'
export type { CodexConfigPort } from './codex-port.js'
export type {
  AnswerInput,
  AnswerResult,
  InteractionPort,
  PendingInputOfInput,
  PendingInputSnapshot,
  PendingQuestion,
  QuestionAnswer,
  QuestionOption,
} from './interaction-port.js'
export type { RequestRecord, SessionRecord, SessionRegistryPort } from './registry-port.js'
export type { ReadSettingsInput, SettingsPort, WriteSettingsInput } from './settings-port.js'

/** 应用层可用的全部宿主能力。 */
export interface Ports {
  readonly workspace: WorkspacePort
  readonly session: SessionPort
  readonly interaction: InteractionPort
  readonly permission: PermissionPort
  readonly model: ModelPort
  readonly registry: SessionRegistryPort
  readonly settings: SettingsPort
  readonly codex: CodexConfigPort
}
