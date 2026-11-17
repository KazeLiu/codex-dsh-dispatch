import { search, select } from '@inquirer/prompts'
import { fetchSettings, readClientConfig, saveSettings, type ClientConfig } from './client.js'
import type { SettingsSnapshot } from '../domain/settings.js'
import { applySnapshot, currentModel, isDirty, selectEffort, selectModel, selectPermission, toUpdate } from './state.js'

/** 所有列表都取自当前 DSH；方向键选择，Enter 确认。 */
export async function runConfigTui(config: ClientConfig = readClientConfig()): Promise<number> {
  let state = applySnapshot(await fetchSettings(config))
  console.log('DSH MCP Bridge · 默认设置（↑↓ 选择，Enter 确认，Ctrl+C 退出）')
  try {
    for (;;) {
      const snapshot = state.snapshot!
      if (!snapshot.connection.ok) console.log(`DSH 模型目录不可读：${snapshot.connection.error}`)
      const action = await select({
        message: isDirty(state) ? '默认设置 · 有未保存的修改' : '默认设置',
        choices: [
          { name: `模型：${state.draftModel === null ? '跟随 DSH 默认设置' : `${state.draftModel.providerId} / ${state.draftModel.modelId}`}`, value: 'model' },
          { name: `思考强度：${state.draftModel?.reasoningEffort ?? '跟随模型默认设置'}`, value: 'effort', disabled: state.draftModel === null ? '请先选具体模型' : false },
          { name: `默认权限：${snapshot.permissions.find(item => item.level === state.draftPermission)?.label ?? '请求批准'}`, value: 'permission' },
          { name: '刷新模型列表', value: 'refresh' },
          { name: '保存默认值', value: 'save' },
          { name: '退出', value: 'quit' },
        ],
      })
      if (action === 'quit') return 0
      if (action === 'refresh') { state = applySnapshot(await fetchSettings(config)); continue }
      if (action === 'save') {
        state = applySnapshot(await saveSettings(config, toUpdate(state)))
        console.log('已保存。新建 DSH 会话立即生效，已有会话保持原设置。')
        continue
      }
      if (action === 'model') {
        const models = snapshot.providers.flatMap(provider => provider.models)
        const choices = [
          { name: '跟随 DSH 默认设置', value: -1 },
          ...models.map((model, index) => ({ name: `${model.providerId} / ${model.displayName}`, value: index })),
        ]
        const index = await search({ message: '默认模型（输入名称筛选）', pageSize: 12,
          source: term => choices.filter(choice => !term || choice.name.toLowerCase().includes(term.toLowerCase())),
        })
        const model = models[index]
        state = model === undefined ? { ...state, draftModel: null } : selectModel(state, model)
      } else if (action === 'effort') {
        const model = currentModel(state)
        const effort = await select<string | null>({ message: '默认思考强度', choices: [
          { name: '跟随模型默认设置', value: null },
          ...(model?.reasoningEfforts ?? []).map(option => ({ name: option.name, value: option.id })),
        ] })
        state = selectEffort(state, effort)
      } else if (action === 'permission') {
        const permission = await select({ message: '源会话权限不可读时使用', choices: snapshot.permissions.map(option => ({
          name: option.label, value: option.level, disabled: option.available ? false : option.unavailableReason ?? '当前 DSH 不支持',
        })) })
        state = selectPermission(state, permission)
      }
    }
  } catch (cause) {
    if (cause instanceof Error && cause.name === 'ExitPromptError') return 0
    throw cause
  }
}

export function printModels(snapshot: SettingsSnapshot): void {
  for (const provider of snapshot.providers) {
    for (const model of provider.models) console.log(`${provider.providerId} / ${model.modelId}  [${model.reasoningEfforts.map(option => option.id).join(', ')}]`)
  }
}
