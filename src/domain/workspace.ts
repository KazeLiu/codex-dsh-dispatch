/**
 * 已注册工作区的只读摘要。
 *
 * 为什么放在 `domain/`：设置页要把它当「无项目默认工作区」的候选项渲染，而
 * 设置快照（`domain/settings.ts`）与工作区端口都要用同一个形状。放两份会出现
 * 「端口改了字段、设置页还在读旧名字」这种只在界面上表现为空白的漂移。
 *
 * 这里只有类型，没有运行时依赖（依赖规则 D2）。
 */

/** 宿主原生工作区列表的一项。 */
export interface WorkspaceSummary {
  /** 宿主分配的工作区 ID；设置里保存的就是它，不是路径。 */
  readonly id: string
  /** 宿主 realpath 规范化后的绝对路径。 */
  readonly path: string
  readonly title: string
}
