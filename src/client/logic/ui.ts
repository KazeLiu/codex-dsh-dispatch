/**
 * 设置页的视觉语言。
 *
 * 全部用 `--dsw-alias-*` 主题令牌，不写死颜色：DSH 有亮/暗两套主题，写死一个
 * 灰色在另一套里就会糊成一片。令牌名取自宿主设置页自身（`dsw-alias-label-primary`
 * 等），缺少时回落到 `inherit`/半透明，至少不会变成不可读的纯黑块。
 *
 * 布局照抄原生设置页的「扁平行 + 细分隔线」：一行一件事，控件靠右，不堆卡片、
 * 不堆说明标题——设置页里多一层容器就多一层视觉噪音。
 */

const cdSectionStyle: CdStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: '4px',
  maxWidth: '720px',
  color: 'var(--dsw-alias-label-primary, inherit)',
}

const cdTitleStyle: CdStyle = {
  margin: '0 0 8px',
  fontSize: '18px',
  lineHeight: '28px',
  fontWeight: 600,
  color: 'var(--dsw-alias-label-primary, inherit)',
}

const cdGroupStyle: CdStyle = {
  display: 'flex',
  flexDirection: 'column',
  margin: '0 0 8px',
}

const cdGroupTitleStyle: CdStyle = {
  margin: '12px 0 0',
  fontSize: '13px',
  lineHeight: '20px',
  fontWeight: 600,
  color: 'var(--dsw-alias-label-secondary, inherit)',
}

const cdRowStyle: CdStyle = {
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'nowrap',
  gap: '10px',
  padding: '10px 0',
  borderBottom: '1px solid var(--dsw-alias-border-l2, rgba(127, 127, 127, 0.24))',
}

const cdRowLabelStyle: CdStyle = {
  flex: '0 0 min(10rem, 28%)',
  minWidth: 0,
  fontSize: '13px',
  lineHeight: '20px',
  color: 'var(--dsw-alias-label-primary, inherit)',
}

const cdRowValueStyle: CdStyle = {
  flex: '1 1 260px',
  minWidth: 0,
  fontSize: '12px',
  lineHeight: '18px',
  color: 'var(--dsw-alias-label-tertiary, #666)',
  overflowWrap: 'anywhere',
}

const cdActionsStyle: CdStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '6px',
  marginLeft: 'auto',
  flexWrap: 'nowrap',
  flexShrink: 0,
}

const cdInputStyle: CdStyle = {
  height: '28px',
  minWidth: 0,
  marginLeft: 'auto',
  padding: '0 8px',
  borderRadius: '6px',
  border: '1px solid var(--dsw-alias-border-l3, rgba(127, 127, 127, 0.4))',
  background: 'var(--dsw-alias-bg-layer-2, transparent)',
  color: 'var(--dsw-alias-label-primary, inherit)',
  fontSize: '13px',
  fontFamily: 'inherit',
}

const cdWideInputStyle: CdStyle = Object.assign({}, cdInputStyle, { flex: '1 1 260px', minWidth: 0 })

const cdButtonStyle: CdStyle = {
  height: '28px',
  padding: '0 12px',
  borderRadius: '6px',
  border: '1px solid var(--dsw-alias-border-l3, rgba(127, 127, 127, 0.4))',
  background: 'var(--dsw-alias-bg-layer-3, transparent)',
  color: 'var(--dsw-alias-label-primary, inherit)',
  fontSize: '13px',
  fontFamily: 'inherit',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
}

const cdPrimaryButtonStyle: CdStyle = Object.assign({}, cdButtonStyle, {
  border: '1px solid transparent',
  background: 'var(--dsw-alias-brand-primary, #4d6bfe)',
  color: 'var(--dsw-alias-label-primary-foreground, #fff)',
})

const cdDangerButtonStyle: CdStyle = Object.assign({}, cdButtonStyle, {
  color: 'var(--dsw-alias-state-error-primary, #d33)',
})

const cdBarStyle: CdStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  flexWrap: 'nowrap',
  padding: '12px 0 4px',
}

/** 底栏左侧的状态区：占满剩余宽度，错误与提示上下堆叠。 */
const cdBarStatusStyle: CdStyle = Object.assign({}, cdRowValueStyle, {
  flex: '1 1 220px',
  display: 'flex',
  flexDirection: 'column',
})

const cdErrorStyle: CdStyle = {
  margin: '4px 0',
  fontSize: '12px',
  lineHeight: '18px',
  color: 'var(--dsw-alias-state-error-primary, #d33)',
  whiteSpace: 'pre-wrap',
}

const cdNoticeStyle: CdStyle = {
  margin: '4px 0',
  fontSize: '12px',
  lineHeight: '18px',
  color: 'var(--dsw-alias-state-success-primary, #2a2)',
}

const cdHintStyle: CdStyle = {
  margin: '2px 0 0',
  fontSize: '12px',
  lineHeight: '18px',
  color: 'var(--dsw-alias-label-tertiary, #666)',
}

/** 按钮。`variant` 只区分主次/危险，避免各处手写颜色。 */
function cdButton(
  key: string,
  label: string,
  onClick: () => void,
  options?: { variant?: 'default' | 'primary' | 'danger'; disabled?: boolean },
): CdElement {
  const variant = options?.variant ?? 'default'
  const style =
    variant === 'primary' ? cdPrimaryButtonStyle : variant === 'danger' ? cdDangerButtonStyle : cdButtonStyle
  const disabled = options?.disabled === true
  return React.createElement(
    'button',
    {
      key,
      type: 'button',
      style: disabled ? Object.assign({}, style, { opacity: 0.5, cursor: 'default' }) : style,
      disabled,
      onClick: disabled ? undefined : onClick,
    },
    label,
  )
}

/** 一行：左侧标签，右侧控件。控件可以有多个（输入框 + 按钮）。 */
function cdRow(key: string, label: string, ...children: CdNode[]): CdElement {
  return React.createElement(
    'div',
    { key, style: cdRowStyle },
    React.createElement('div', { key: 'label', style: cdRowLabelStyle }, label),
    ...children,
  )
}

/** 可换行的只读文字（路径、版本、状态）；`lines` 每项一行。 */
function cdFacts(key: string, lines: ReadonlyArray<string | null>): CdElement {
  const children = lines
    .filter((line): line is string => line !== null && line !== '')
    .map((line, index) => React.createElement('div', { key: `${key}-${index}` }, line))
  return React.createElement('div', { key, style: cdRowValueStyle }, ...children)
}

/** 左侧标签、中间可换行的事实、右侧操作行（不折行）。 */
function cdActionRow(key: string, label: string, value: CdNode, actions: CdNode[]): CdElement {
  return React.createElement(
    'div',
    { key, style: cdRowStyle },
    React.createElement('div', { key: 'label', style: cdRowLabelStyle }, label),
    value,
    actions.length > 0 ? React.createElement('div', { key: 'actions', style: cdActionsStyle }, ...actions) : null,
  )
}

/** 只读的值行（路径、版本这类不需要编辑的事实）。 */
function cdValueRow(key: string, label: string, value: string): CdElement {
  return cdRow(key, label, React.createElement('div', { key: 'value', style: cdRowValueStyle }, value))
}

/** 分组小标题。只做视觉分段，不承担说明职责。 */
function cdGroupTitle(key: string, text: string): CdElement {
  return React.createElement('div', { key, style: cdGroupTitleStyle }, text)
}

function cdErrorText(key: string, message: string | null): CdNode {
  if (message === null || message === '') return null
  return React.createElement('div', { key, style: cdErrorStyle }, message)
}

function cdNoticeText(key: string, message: string | null): CdNode {
  if (message === null || message === '') return null
  return React.createElement('div', { key, style: cdNoticeStyle }, message)
}

function cdHint(key: string, text: string): CdElement {
  return React.createElement('div', { key, style: cdHintStyle }, text)
}

/** 下拉框。`options` 是 `[value, label]` 对，`value` 用 `''` 表示空选择。 */
function cdSelect(
  key: string,
  value: string,
  options: ReadonlyArray<readonly [string, string, boolean?]>,
  onChange: (next: string) => void,
  extra?: { disabled?: boolean; width?: string },
): CdElement {
  return React.createElement(
    'select',
    {
      key,
      style: extra?.width === undefined ? cdInputStyle : Object.assign({}, cdInputStyle, { width: extra.width }),
      value,
      disabled: extra?.disabled === true,
      onChange: (event: { target: { value: string } }) => onChange(event.target.value),
    },
    options.map(option =>
      React.createElement('option', { key: option[0], value: option[0], disabled: option[2] }, option[1]),
    ),
  )
}

function cdTextInput(
  key: string,
  value: string,
  placeholder: string,
  onChange: (next: string) => void,
  extra?: { wide?: boolean; disabled?: boolean; onEnter?: () => void; title?: string },
): CdElement {
  return React.createElement('input', {
    key,
    type: 'text',
    style: extra?.wide === true ? cdWideInputStyle : cdInputStyle,
    value,
    disabled: extra?.disabled,
    placeholder,
    title: extra?.title,
    'aria-label': 'Node 路径',
    spellCheck: false,
    onChange: (event: { target: { value: string } }) => onChange(event.target.value),
    onKeyDown: (event: { key: string }) => {
      if (event.key === 'Enter' && extra?.onEnter !== undefined) extra.onEnter()
    },
  })
}
