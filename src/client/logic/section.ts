/**
 * 「Codex 派单」设置分区。
 *
 * 布局照原生设置页：扁平行 + 细分隔线，一行一件事。每组里操作按钮都在该行右侧、
 * 整组按钮不折行——要换行的是路径和文字，不是按钮。
 *
 * 所有状态都从模块级 store 读（见 store.ts 的注释）：这个分区会被宿主反复重挂载，
 * 组件 state 保不住草稿。
 *
 * 只有 Node 路径保存要二次确认（它影响后续 MCP 登记）；
 * 其余操作一击执行，失败在原行给反馈。
 */

interface CdSectionProps {
  readonly close?: () => void
}

function CdSettingsSection(_props: CdSectionProps): CdElement {
  const state = React.useSyncExternalStore(cdStore.subscribe, cdStore.getSnapshot)

  React.useEffect(function () {
    if (cdState.settings === null && cdState.loadingSettings === false && cdState.settingsError === null) {
      void cdDoLoadSettings()
    }
    if (cdState.integration === null && cdState.loadingIntegration === false && cdState.integrationError === null) {
      void cdDoLoadIntegration()
    }
  }, [])

  return React.createElement(
    'div',
    { style: cdSectionStyle },
    React.createElement('h2', { key: 'title', style: cdTitleStyle }, 'Codex 派单'),
    ...cdModelGroup(state),
    ...cdPermissionGroup(state),
    ...cdWorkspaceGroup(state),
    ...cdSaveBar(state),
    ...cdRegistrationGroup(state),
    ...cdAgentsGroup(state),
  )
}

// ---- 默认模型与思考强度 ----

function cdModelKey(providerId: string, modelId: string): string {
  return `${providerId}\u0000${modelId}`
}

function cdModelOptions(snapshot: CdSettingsSnapshot): Array<readonly [string, string]> {
  const options: Array<readonly [string, string]> = [['', '跟随 DSH 默认设置']]
  for (const provider of snapshot.providers) {
    for (const model of provider.models) {
      options.push([cdModelKey(provider.providerId, model.modelId), `${provider.displayName} / ${model.displayName}`])
    }
  }
  return options
}

function cdEffortOptions(snapshot: CdSettingsSnapshot, current: CdSavedModelChoice | null): Array<readonly [string, string]> {
  if (current === null) return [['', '跟随模型默认']]
  for (const provider of snapshot.providers) {
    if (provider.providerId !== current.providerId) continue
    for (const model of provider.models) {
      if (model.modelId !== current.modelId) continue
      const options: Array<readonly [string, string]> = [['', '跟随模型默认']]
      for (const effort of model.reasoningEfforts) options.push([effort.id, effort.name])
      return options
    }
  }
  return [['', '跟随模型默认']]
}

function cdModelGroup(state: CdState): CdNode[] {
  const snapshot = state.settings
  if (snapshot === null) {
    if (state.settingsError !== null) {
      return [
        cdActionRow(
          'settings-error-row',
          '默认模型',
          cdFacts('settings-error-facts', ['读取失败']),
          [
            cdButton('settings-retry', '重新读取', function () {
              void cdDoLoadSettings()
            }),
          ],
        ),
        cdErrorText('settings-error', state.settingsError),
      ]
    }
    return [cdValueRow('settings-loading', '默认模型', state.loadingSettings ? '读取中…' : '尚未读取')]
  }

  const current = cdCurrentModel(state)
  const modelValue = current === null ? '' : cdModelKey(current.providerId, current.modelId)
  const effortValue = current === null || current.reasoningEffort === null ? '' : current.reasoningEffort
  const efforts = cdEffortOptions(snapshot, current)
  const nodes: CdNode[] = [
    cdActionRow(
      'model-row',
      '默认模型',
      cdSelect(
        'model-select',
        modelValue,
        cdModelOptions(snapshot),
        function (next) {
          if (next === '') {
            cdSelectModel(null)
            return
          }
          const parts = next.split('\u0000')
          cdSelectModel({ providerId: parts[0] ?? '', modelId: parts[1] ?? '', reasoningEffort: null })
        },
        { disabled: state.saving, width: '260px' },
      ),
      [
        cdButton(
          'settings-refresh',
          '刷新',
          function () {
            void cdDoLoadSettings()
          },
          { disabled: state.saving || state.loadingSettings },
        ),
      ],
    ),
    cdRow(
      'effort-row',
      '思考强度',
      cdSelect(
        'effort-select',
        effortValue,
        efforts,
        function (next) {
          cdSelectEffort(next === '' ? null : next)
        },
        { disabled: state.saving || current === null || efforts.length <= 1, width: '200px' },
      ),
    ),
  ]

  if (snapshot.saved.invalid.model || snapshot.saved.invalid.reasoningEffort) {
    nodes.push(cdHint('invalid-model', '已保存的模型或强度在当前 Profile 里不可用，请重新选择。'))
  }
  if (snapshot.connection.error !== null) {
    nodes.push(cdErrorText('catalog-error', `模型目录读取失败：${snapshot.connection.error}`))
  }
  nodes.push(cdErrorText('settings-refresh-error', state.settingsError))
  return nodes
}

// ---- 默认权限 ----

function cdFindPermission(snapshot: CdSettingsSnapshot, level: CdPermissionLevel): CdPermissionOption | null {
  for (const option of snapshot.permissions) {
    if (option.level === level) return option
  }
  return null
}

function cdPermissionGroup(state: CdState): CdNode[] {
  const snapshot = state.settings
  if (snapshot === null) return []

  const current = cdCurrentPermission(state)
  const options: Array<readonly [string, string, boolean?]> = [['', '使用初始档位（请求批准）']]
  for (const option of snapshot.permissions) {
    options.push([option.level, option.available ? option.label : `${option.label}（不可用）`, !option.available])
  }
  const nodes: CdNode[] = [
    cdRow(
      'permission-row',
      '默认权限',
      cdSelect(
        'permission-select',
        current === null ? '' : current,
        options,
        function (next) {
          cdSelectPermission(next === '' ? null : (next as CdPermissionLevel))
        },
        { disabled: state.saving, width: '200px' },
      ),
    ),
  ]

  if (current !== null) {
    const option = cdFindPermission(snapshot, current)
    if (option !== null && !option.available && option.unavailableReason !== null) {
      nodes.push(cdHint('permission-reason', option.unavailableReason))
    }
  }
  if (snapshot.saved.invalid.permission) {
    nodes.push(cdHint('invalid-permission', '已保存的权限档位当前不可用，请重新选择。'))
  }
  return nodes
}

// ---- 无项目默认工作区 ----

/**
 * 候选项直接来自宿主已登记的工作区，保存的是 ID。
 *
 * 已保存的 ID 可能已经不在宿主里：此时仍把它列出来（标「已失效」），
 * 不替用户改选——自动换成别的工作区会让他们下次派单跑到一个没预期的目录。
 */
function cdWorkspaceOptions(snapshot: CdSettingsSnapshot, current: string | null): Array<readonly [string, string, boolean?]> {
  const options: Array<readonly [string, string, boolean?]> = [['', '未设置']]
  let listed = false
  for (const workspace of snapshot.workspaces ?? []) {
    options.push([workspace.id, `${workspace.title}（${workspace.path}）`])
    if (workspace.id === current) listed = true
  }
  if (current !== null && !listed) {
    options.push([current, snapshot.workspaces === null ? '已保存 · 列表暂不可读' : '已失效 · 请重新选择', true])
  }
  return options
}

function cdWorkspaceGroup(state: CdState): CdNode[] {
  const snapshot = state.settings
  if (snapshot === null) return []

  const current = cdCurrentWorkspaceId(state)
  const nodes: CdNode[] = [
    cdRow(
      'workspace-row',
      '无项目默认工作区',
      cdSelect(
        'workspace-select',
        current === null ? '' : current,
        cdWorkspaceOptions(snapshot, current),
        function (next) {
          cdSelectWorkspace(next === '' ? null : next)
        },
        { disabled: state.saving, width: '300px' },
      ),
    ),
  ]
  if (snapshot.workspaces === null) {
    nodes.push(cdHint('workspace-unavailable', '工作区列表暂不可读，请刷新。'))
  } else if (snapshot.workspaces.length === 0) {
    nodes.push(cdHint('workspace-empty', '还没有可选工作区。先在 DSH 打开一个目录，再刷新。'))
  }
  return nodes
}

// ---- 保存 / 还原 ----

function cdSaveBar(state: CdState): CdNode[] {
  const dirty = cdIsDirty(state)
  return [
    React.createElement(
      'div',
      { key: 'save-bar', style: cdBarStyle },
      React.createElement(
        'div',
        { key: 'status', style: cdBarStatusStyle },
        cdNoticeText('save-notice', state.notice),
        cdErrorText('save-error', state.saveError),
      ),
      React.createElement(
        'div',
        { key: 'actions', style: cdActionsStyle },
        cdButton(
          'revert',
          '还原',
          function () {
            cdRevert()
          },
          { disabled: !dirty || state.saving },
        ),
        cdButton(
          'save',
          state.saving ? '保存中…' : '保存',
          function () {
            void cdSave()
          },
          { variant: 'primary', disabled: !dirty || state.saving || state.settings === null },
        ),
      ),
    ),
  ]
}

// ---- Codex 接入 ----

function cdServerText(registration: CdRegistrationView): string {
  if (registration.node === null || !registration.cli.found || registration.error !== null) return '尚未读取'
  const server = registration.server
  if (!server.registered) return '未登记'
  if (!server.enabled) return '已登记但被停用，不会加载'
  if (!server.matchesCurrent) return '已登记，但指向别处'
  return '已登记，指向当前安装位置'
}

/** 读取失败时不能显示成「未登记」——那会让人以为点一下就能连上。 */
function cdRegistrationReadable(state: CdState): boolean {
  if (state.integration === null) return false
  if (state.loadingIntegration) return false
  if (state.integrationError !== null) return false
  const registration = state.integration.registration
  if (registration.node === null || !registration.cli.found) return false
  if (registration.error !== null) return false
  if (registration.cli.error !== null) return false
  return true
}

function cdRegistrationGroup(state: CdState): CdNode[] {
  const integration = state.integration
  const nodes: CdNode[] = [cdGroupTitle('registration-title', 'Codex 接入')]

  if (integration === null) {
    if (state.integrationError !== null) {
      nodes.push(
        cdActionRow(
          'integration-error-row',
          'Codex 接入',
          cdFacts('integration-error-facts', ['读取失败']),
          [
            cdButton('integration-retry', '重新读取', function () {
              void cdDoLoadIntegration()
            }),
          ],
        ),
        cdErrorText('integration-error', state.integrationError),
      )
    } else {
      nodes.push(cdValueRow('integration-loading', 'Codex 接入', state.loadingIntegration ? '读取中…' : '尚未读取'))
    }
    return nodes
  }

  const registration = integration.registration
  nodes.push(cdValueRow('config-path', 'Codex 配置', registration.configPath))
  nodes.push(cdValueRow('bin-path', 'MCP 入口', registration.bin))
  nodes.push(
    cdActionRow(
      'node-input-row',
      'Node 路径',
      cdTextInput(
        'node-input',
        state.nodeInput,
        '留空则自动查找 PATH 里的 Node',
        cdSetNodeInput,
        {
          wide: true,
          disabled: state.busy !== null,
          onEnter: cdBeginNodeSave,
          title: registration.configuredNode === null ? '从 PATH 自动查找；修改后可固定路径' : '已固定路径；清空并保存可恢复自动查找',
        },
      ),
      [
        cdButton(
          'node-save',
          '保存',
          function () {
            cdBeginNodeSave()
          },
          { disabled: !cdCanSaveNode(state) },
        ),
      ],
    ),
  )
  nodes.push(cdErrorText('node-error', registration.nodeError))
  nodes.push(...cdPendingBar(state))

  const readable = cdRegistrationReadable(state)
  const serverActions: CdNode[] = []
  if (readable) {
    if (registration.server.registered) {
      serverActions.push(
        cdButton(
          'unregister',
          '从 Codex 移除',
          function () {
            void cdRunCodex('unregister')
          },
          { variant: 'danger', disabled: state.busy !== null },
        ),
      )
    } else {
      serverActions.push(
        cdButton(
          'register',
          '连接到 Codex',
          function () {
            void cdRunCodex('register')
          },
          { variant: 'primary', disabled: state.busy !== null },
        ),
      )
    }
  } else if (registration.node !== null && (state.integrationError !== null || registration.error !== null || registration.cli.error !== null)) {
    serverActions.push(cdButton('registration-retry', '重新读取', () => {
      void cdDoLoadIntegration()
    }, { disabled: state.busy !== null || state.loadingIntegration }))
  }
  nodes.push(
    cdActionRow(
      'server-state',
      'MCP 登记',
      cdFacts('server-facts', [state.loadingIntegration ? '读取中…' : cdServerText(registration)]),
      serverActions,
    ),
  )

  nodes.push(cdErrorText('integration-error', state.integrationError ?? registration.error ?? registration.cli.error))
  nodes.push(cdNoticeText('integration-notice', state.integrationNotice))
  return nodes
}

// ---- 确认条（只有 Node 路径用） ----

function cdPendingBar(state: CdState): CdNode[] {
  const pending = state.pending
  if (pending === null) return []
  return [
    React.createElement(
      'div',
      { key: 'pending-node', style: cdBarStyle },
      React.createElement('div', { key: 'prompt', style: cdBarStatusStyle }, pending.prompt),
      React.createElement(
        'div',
        { key: 'actions', style: cdActionsStyle },
        cdButton(
          'pending-cancel',
          '取消',
          function () {
            cdCancelPending()
          },
          { disabled: state.busy !== null },
        ),
        cdButton(
          'pending-confirm',
          '确认',
          function () {
            void cdConfirmPending()
          },
          { variant: 'primary', disabled: state.busy !== null },
        ),
      ),
    ),
  ]
}

// ---- 协作规则（只写全局） ----

function cdAgentsGroup(state: CdState): CdNode[] {
  const nodes: CdNode[] = [cdGroupTitle('agents-title', '协作规则')]

  const integration = state.integration
  if (integration === null) {
    nodes.push(cdValueRow('agents-loading', '全局 AGENTS.md', state.loadingIntegration ? '读取中…' : '尚未读取'))
    return nodes
  }

  const view = cdGlobalAgentsView(state)
  if (view === null) {
    nodes.push(cdValueRow('agents-missing', '全局 AGENTS.md', '读取不到'))
    return nodes
  }

  const status = view.error !== null ? view.error : view.present ? '已写入协作规则' : '未写入协作规则'
  const busy = state.busy !== null || state.loadingIntegration
  const actions: CdNode[] = state.agentsError !== null ? [
    cdButton('agents-reload', '重新读取', () => { void cdDoLoadIntegration() }, { disabled: busy }),
  ] : [
    cdButton(
      'agents-write',
      view.present ? '更新' : '写入',
      function () {
        void cdRunAgents('write')
      },
      { disabled: busy || view.error !== null },
    ),
  ]
  if (view.present && state.agentsError === null) {
    actions.push(
      cdButton(
        'agents-remove',
        '移除',
        function () {
          void cdRunAgents('remove')
        },
        { variant: 'danger', disabled: busy || view.error !== null },
      ),
    )
  }
  nodes.push(
    cdActionRow('agents-global-row', '全局 AGENTS.md', cdFacts('agents-global-facts', [view.path, status]), actions),
  )
  if (view.overrideExists) {
    nodes.push(cdHint('agents-override', `同目录存在 ${view.overridePath}，它的优先级更高，会挡住这里写入的内容。`))
  }
  nodes.push(cdErrorText('agents-write-error', state.agentsError))
  nodes.push(cdNoticeText('agents-write-notice', state.agentsNotice))
  return nodes
}
