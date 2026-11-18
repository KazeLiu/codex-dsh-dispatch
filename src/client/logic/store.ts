/**
 * 设置页的模块级状态。
 *
 * 为什么不用组件 state：设置分区由宿主 `renderSlot('settings.section')` 渲染，
 * 对话进行中流式输出会持续触发整页重渲染，分区被重挂载时组件状态全部丢失——
 * 草稿凭空消失、输入框跳回已保存值。所以状态放在模块级，组件用
 * `useSyncExternalStore` 订阅；每次更新造新对象，靠引用变化触发重渲染。
 *
 * 三条不变量：
 *
 * 1. 草稿只在「用户明确丢弃」或「保存成功」时清空，重读不清。
 * 2. 只有 Node 路径保存要二次确认，确认时只用冻结值——用户在确认条弹出后改一下输入框，
 *    就会把另一个路径写进 Codex 配置。其余操作一击执行。
 * 3. 读取失败要能被看见、能被重试；失败不能被当成「没有」。
 */

interface CdDraft {
  readonly model: CdSavedModelChoice | null
  readonly permission: CdPermissionLevel | null
  /** 无项目默认工作区的 ID（不是路径）。 */
  readonly workspaceId: string | null
}

/** 待确认动作：只剩 Node 路径一项。 */
interface CdPending {
  readonly action: 'node'
  /** 冻结的落盘值：null 表示「回到自动解析」。 */
  readonly value: string | null
  readonly prompt: string
}

interface CdState {
  readonly settings: CdSettingsSnapshot | null
  readonly settingsError: string | null
  readonly loadingSettings: boolean
  readonly draft: CdDraft | null
  readonly saving: boolean
  readonly saveError: string | null
  readonly integration: CdIntegrationSnapshot | null
  readonly integrationError: string | null
  readonly integrationNotice: string | null
  readonly agentsError: string | null
  readonly agentsNotice: string | null
  readonly loadingIntegration: boolean
  readonly nodeInput: string
  /** 用户改过 Node 输入框：刷新时不要无声覆盖，也不要拿自动解析值当已保存值。 */
  readonly nodeInputDirty: boolean
  readonly busy: string | null
  readonly notice: string | null
  readonly pending: CdPending | null
}

const CD_INITIAL: CdState = {
  settings: null,
  settingsError: null,
  loadingSettings: false,
  draft: null,
  saving: false,
  saveError: null,
  integration: null,
  integrationError: null,
  integrationNotice: null,
  agentsError: null,
  agentsNotice: null,
  loadingIntegration: false,
  nodeInput: '',
  nodeInputDirty: false,
  busy: null,
  notice: null,
  pending: null,
}

let cdState: CdState = CD_INITIAL
const cdListeners: Array<() => void> = []

function cdSet(patch: Partial<CdState>): void {
  cdState = { ...cdState, ...patch }
  for (const listener of cdListeners.slice()) listener()
}

const cdStore = {
  getSnapshot(): CdState {
    return cdState
  },
  subscribe(listener: () => void): () => void {
    cdListeners.push(listener)
    return () => {
      const index = cdListeners.indexOf(listener)
      if (index !== -1) cdListeners.splice(index, 1)
    }
  },
}

function cdSavedModel(state: CdState): CdSavedModelChoice | null {
  return state.settings === null ? null : state.settings.saved.model
}

function cdSavedPermission(state: CdState): CdPermissionLevel | null {
  return state.settings === null ? null : state.settings.saved.permission
}

function cdSavedWorkspaceId(state: CdState): string | null {
  return state.settings === null ? null : state.settings.saved.workspaceId
}

function cdCurrentModel(state: CdState): CdSavedModelChoice | null {
  return state.draft === null ? cdSavedModel(state) : state.draft.model
}

function cdCurrentPermission(state: CdState): CdPermissionLevel | null {
  return state.draft === null ? cdSavedPermission(state) : state.draft.permission
}

function cdCurrentWorkspaceId(state: CdState): string | null {
  return state.draft === null ? cdSavedWorkspaceId(state) : state.draft.workspaceId
}

function cdSameModel(a: CdSavedModelChoice | null, b: CdSavedModelChoice | null): boolean {
  if (a === null || b === null) return a === b
  return a.providerId === b.providerId && a.modelId === b.modelId && a.reasoningEffort === b.reasoningEffort
}

function cdIsDirty(state: CdState): boolean {
  if (state.draft === null) return false
  return (
    !cdSameModel(state.draft.model, cdSavedModel(state)) ||
    state.draft.permission !== cdSavedPermission(state) ||
    state.draft.workspaceId !== cdSavedWorkspaceId(state)
  )
}

function cdDraftOf(state: CdState): CdDraft {
  return {
    model: cdCurrentModel(state),
    permission: cdCurrentPermission(state),
    workspaceId: cdCurrentWorkspaceId(state),
  }
}

// ---- 设置 ----

let settingsSerial = 0

async function cdDoLoadSettings(): Promise<void> {
  if (cdState.saving) return
  const serial = ++settingsSerial
  cdSet({ loadingSettings: true, settingsError: null })
  try {
    const snapshot = await cdApiReadSettings()
    if (serial !== settingsSerial) return
    // 重读保留未保存草稿：用户点「刷新」是想看最新目录，不是想丢掉刚选的模型。
    cdSet({
      settings: snapshot,
      loadingSettings: false,
      settingsError: null,
      draft: cdIsDirty(cdState) ? cdState.draft : null,
      saveError: null,
    })
  } catch (cause) {
    if (serial !== settingsSerial) return
    cdSet({ loadingSettings: false, settingsError: cdErrorMessage(cause) })
  }
}

function cdSelectModel(model: CdSavedModelChoice | null): void {
  if (cdState.saving) return
  cdSet({
    draft: {
      model,
      permission: cdCurrentPermission(cdState),
      workspaceId: cdCurrentWorkspaceId(cdState),
    },
    saveError: null,
    notice: null,
  })
}

function cdSelectEffort(effort: string | null): void {
  if (cdState.saving) return
  const current = cdCurrentModel(cdState)
  if (current === null) return
  cdSet({
    draft: {
      model: { providerId: current.providerId, modelId: current.modelId, reasoningEffort: effort },
      permission: cdCurrentPermission(cdState),
      workspaceId: cdCurrentWorkspaceId(cdState),
    },
    saveError: null,
    notice: null,
  })
}

function cdSelectPermission(permission: CdPermissionLevel | null): void {
  if (cdState.saving) return
  cdSet({
    draft: {
      model: cdCurrentModel(cdState),
      permission,
      workspaceId: cdCurrentWorkspaceId(cdState),
    },
    saveError: null,
    notice: null,
  })
}

function cdSelectWorkspace(workspaceId: string | null): void {
  if (cdState.saving) return
  cdSet({
    draft: {
      model: cdCurrentModel(cdState),
      permission: cdCurrentPermission(cdState),
      workspaceId,
    },
    saveError: null,
    notice: null,
  })
}

function cdRevert(): void {
  if (cdState.saving) return
  cdSet({ draft: null, saveError: null, notice: null })
}

async function cdSave(): Promise<void> {
  if (cdState.saving || !cdIsDirty(cdState)) return
  ++settingsSerial
  const draft = cdDraftOf(cdState)
  const update: CdSettingsUpdate = {
    ...(cdSameModel(draft.model, cdSavedModel(cdState)) ? {} : { model: draft.model }),
    ...(draft.permission === cdSavedPermission(cdState) ? {} : { permission: draft.permission }),
    ...(draft.workspaceId === cdSavedWorkspaceId(cdState) ? {} : { workspaceId: draft.workspaceId }),
  }
  cdSet({ saving: true, loadingSettings: false, saveError: null, notice: null })
  try {
    const snapshot = await cdApiWriteSettings(update)
    cdSet({
      settings: snapshot,
      saving: false,
      draft: null,
      saveError: null,
      notice: '已保存。新建会话生效，已有会话保持原设置。',
    })
  } catch (cause) {
    cdSet({ saving: false, saveError: cdErrorMessage(cause) })
  }
}

// ---- Codex 接入 ----

let integrationSerial = 0

/**
 * 输入框回显值：有明确覆盖就显示覆盖（哪怕它已失效，用户要能改掉），
 * 否则显示自动解析到的那条路径——这只是展示，不是已保存值。
 */
function cdNodeDisplay(registration: CdRegistrationView): string {
  if (registration.configuredNode !== null) return registration.configuredNode
  return registration.node === null ? '' : registration.node.path
}

async function cdDoLoadIntegration(): Promise<void> {
  if (cdState.busy !== null) return
  const serial = ++integrationSerial
  cdSet({ loadingIntegration: true, integrationError: null })
  try {
    const snapshot = await cdApiReadIntegration()
    if (serial !== integrationSerial) return
    cdSet({
      integration: snapshot,
      loadingIntegration: false,
      integrationError: null,
      agentsError: null,
      nodeInput: cdState.nodeInputDirty ? cdState.nodeInput : cdNodeDisplay(snapshot.registration),
    })
  } catch (cause) {
    if (serial !== integrationSerial) return
    cdSet({
      loadingIntegration: false,
      integrationError: cdErrorMessage(cause),
    })
  }
}

function cdSetNodeInput(value: string): void {
  // 改输入框就作废旧的确认：旧确认冻结的是另一个路径。
  cdSet({ nodeInput: value, nodeInputDirty: true, pending: null, integrationNotice: null })
}

/** 自动预填只是展示，没编辑过不能存——否则自动路径会被写成固定覆盖。 */
function cdCanSaveNode(state: CdState): boolean {
  if (!state.nodeInputDirty) return false
  if (state.busy !== null) return false
  const integration = state.integration
  if (integration === null) return false
  const value = state.nodeInput.trim()
  if (integration.registration.configuredNode === null && value === '') return false
  return value !== cdNodeDisplay(integration.registration)
}

function cdBeginNodeSave(): void {
  if (!cdCanSaveNode(cdState)) return
  const value = cdState.nodeInput.trim()
  const prompt =
    value === ''
      ? '确认清除 Node 覆盖、回到自动查找？'
      : `确认使用 ${value}？已登记的 MCP 不会自动修改。`
  cdSet({ pending: { action: 'node', value: value === '' ? null : value, prompt }, integrationNotice: null, integrationError: null })
}

function cdCancelPending(): void {
  cdSet({ pending: null })
}

async function cdConfirmPending(): Promise<void> {
  const pending = cdState.pending
  if (pending === null || cdState.busy !== null) return
  ++integrationSerial
  cdSet({ busy: 'node', loadingIntegration: false, pending: null, integrationError: null, integrationNotice: null })
  try {
    const snapshot = await cdApiWriteNode(pending.value)
    cdSet({
      integration: snapshot,
      busy: null,
      nodeInputDirty: false,
      nodeInput: cdNodeDisplay(snapshot.registration),
      integrationNotice: pending.value === null ? '已回到自动查找 Node。' : 'Node 路径已保存。',
    })
  } catch (cause) {
    cdSet({ busy: null, integrationError: cdErrorMessage(cause) })
  }
}

// ---- Codex 写操作：一击执行，无二次确认 ----

function cdGlobalAgentsView(state: CdState): CdAgentsFileView | null {
  const integration = state.integration
  if (integration === null) return null
  const view = integration.agents.filter(entry => entry.scope === 'global')[0]
  return view === undefined ? null : view
}

/** Node 解析不出来时登记命令根本拼不出来，此时不能点连接。 */
function cdCanWriteCodex(state: CdState): boolean {
  const integration = state.integration
  if (integration === null || state.busy !== null || state.loadingIntegration) return false
  return integration.registration.node !== null
}

async function cdRunCodex(action: 'register' | 'unregister'): Promise<void> {
  if (!cdCanWriteCodex(cdState)) return
  ++integrationSerial
  cdSet({ busy: action, loadingIntegration: false, integrationError: null, integrationNotice: null })
  try {
    const snapshot = action === 'register' ? await cdApiRegister() : await cdApiUnregister()
    cdSet({
      integration: snapshot,
      busy: null,
      nodeInput: cdState.nodeInputDirty ? cdState.nodeInput : cdNodeDisplay(snapshot.registration),
      integrationNotice: action === 'register' ? '已登记。重新加载 Codex 的 MCP 连接后生效。' : '已从 Codex 移除。',
    })
  } catch (cause) {
    cdSet({ busy: null, integrationError: cdErrorMessage(cause) })
  }
}

async function cdRunAgents(action: CdAgentsAction): Promise<void> {
  const view = cdGlobalAgentsView(cdState)
  if (view === null || view.error !== null || cdState.busy !== null || cdState.loadingIntegration) return
  ++integrationSerial
  cdSet({ busy: action, agentsError: null, agentsNotice: null })
  try {
    const result = await cdApiWriteAgents({ action, digest: view.digest })
    const suffix = result.changed ? '' : '（内容已是最新，未改动文件）'
    cdSet({ busy: null, agentsNotice: `${action === 'remove' ? '已移除' : '已写入'}协作规则${suffix}。` })
    await cdDoLoadIntegration()
  } catch (cause) {
    cdSet({ busy: null, agentsError: cdErrorMessage(cause) })
  }
}
