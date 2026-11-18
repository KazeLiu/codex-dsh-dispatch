/**
 * 把「Codex 派单」注册进宿主设置的左侧导航。
 *
 * 只用一个槽位：`settings.section`。宿主负责导航行、选中态、面板容器与关闭，
 * 我们只提供一行文字和一个内容组件——不另建网页、不接管路由。
 *
 * 这里只声明用到的那两个方法（`inject` 与 `register`），不引入宿主包的类型：
 * `@deepseek-ai/*` 没有发布到 npm，声明一个最小结构既能让 tsc 检查调用形状，
 * 又不会在产物里留下任何 require。
 */

interface CdSlotRegistrar {
  inject(name: string, factory: () => () => void): void
  register(
    options: {
      readonly name: string
      readonly id: string
      readonly order: number
      readonly label: () => string
    },
    component: () => CdNode,
  ): () => void
}

interface CdClientContext {
  readonly slots?: CdSlotRegistrar
}

const CD_SECTION_ID = 'codex-dsh-dispatch'
const CD_SECTION_LABEL = 'Codex 派单'
const CD_SECTION_ORDER = 60

function cdRegister(ctx: CdClientContext): void {
  const slots = ctx.slots
  if (slots === undefined) return
  if (typeof slots.inject !== 'function' || typeof slots.register !== 'function') return
  slots.inject('settings.section', function () {
    return slots.register(
      {
        name: 'settings.section',
        id: CD_SECTION_ID,
        order: CD_SECTION_ORDER,
        // thunk：宿主按读取时求值，语言切换后不需要重新注册。
        label: function () {
          return CD_SECTION_LABEL
        },
      },
      function () {
        return React.createElement(CdSettingsSection, null)
      },
    )
  })
}
