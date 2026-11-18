/**
 * 客户端模块入口。宿主在插件启用后调用一次 `apply`。
 *
 * 停用插件时宿主卸载整个模块，注册项随之消失——不需要自己写清理逻辑。
 */

function apply(ctx: CdClientContext): void {
  cdRegister(ctx)
}
