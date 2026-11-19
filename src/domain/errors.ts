/**
 * 桥接错误：对外暴露固定错误码，不泄漏宿主错误细节与堆栈。
 *
 * 为什么集中在这里而不是 `ports/`：`ports/` 只允许类型声明（依赖规则 D3），
 * 而错误类有运行时代码（`Error` 子类、`instanceof` 判断）。
 */

/** 对外固定错误码。新增可以，改名或删除会破坏客户端契约。 */
export type BridgeErrorCode =
  /** 请求参数不合法（缺字段、类型不对、互斥字段同时出现）。 */
  | 'invalid-argument'
  /** 工作目录不可用：不存在、不是目录、或不是绝对路径。 */
  | 'workspace-rejected'
  /** 同一工作目录已有本插件的任务在跑。 */
  | 'workspace-busy'
  /** 会话不存在，或不是本插件创建的。 */
  | 'session-not-found'
  /** 请求指定的模型在当前 Profile 中不存在。 */
  | 'model-unavailable'
  /** DSH 全局默认模型不在当前 Profile 的可用目录里；需要用户在 DSH 设置里改。 */
  | 'dsh-default-unavailable'
  /** 宿主拒绝了在会话上启用所选模型（接口都在，但写入没成功）。 */
  | 'model-selection-failed'
  /** 请求指定的思考强度不被该模型支持。 */
  | 'reasoning-effort-unavailable'
  /** 桥接保存的默认模型已失效。 */
  | 'saved-model-invalid'
  /** 请求的权限档位在当前环境不可用（典型：`auto` 但未启用自动审查）。 */
  | 'permission-unavailable'
  /** 宿主缺少本插件依赖的能力（如 `webServer`、`sessionController`）。 */
  | 'host-capability-missing'
  /** 会话在对应回合出现前就空闲，无法确认任务执行过。 */
  | 'turn-missing'
  /** 等待超时。不是失败，客户端可继续 wait。 */
  | 'wait-timeout'
  /** 桥接内部错误；不透出宿主堆栈。 */
  | 'internal'

/** 桥接错误的统一形态。 */
export class BridgeError extends Error {
  constructor(
    readonly code: BridgeErrorCode,
    message: string,
    /** 附加定位信息，会原样进入返回体（不得含密钥或任务正文）。 */
    readonly detail?: Readonly<Record<string, unknown>>,
    override readonly cause?: unknown,
  ) {
    super(message)
    this.name = 'BridgeError'
  }
}

/** 便捷构造。`cause` 只用于日志与本地排查，不会进入对外返回体。 */
export function bridgeError(
  code: BridgeErrorCode,
  message: string,
  detail?: Readonly<Record<string, unknown>>,
  cause?: unknown,
): BridgeError {
  return new BridgeError(code, message, detail, cause)
}
