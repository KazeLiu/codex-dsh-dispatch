# dsh-mcp-bridge

让 Codex 等 MCP 客户端委派任务给 DeepSeek Harness（DSH），等待执行结果，并在原 DSH 会话中继续沟通和返工。

目标工作方式：**GPT 规划与审查，DSH 原生执行，MCP 传递任务与反馈。** 不再手动复制两边的会话，也不把 DeepSeek 当作 Codex 原生子代理运行。

```text
Codex / 其他 MCP 客户端
          ↕ Streamable HTTP MCP（本机）
   dsh-mcp-bridge（DSH 插件）
          ↕ DSH 原生会话服务
   DSH 会话、模型、工具与执行循环
```

## 当前状态

项目处于设计阶段，目前只有开发文档，尚未实现或发布插件。DSH 原生会话接口和 Agents Anywhere 的桥接实现已完成源码层面的调研；本机 DSH 的 SDK 版本适配和真实调用闭环仍待确认。

## 第一版目标

- 创建专用 DSH 会话并提交任务。
- 等待对应回合完成、失败或请求输入，获取增量输出。
- 在同一会话里补充信息、提出修改和返工。
- 显式取消任务，不因等待超时而重复派单。

第一版先串行完成一个工作目录中的任务；Codex 审查期间，DSH 不再同时修改同一处代码。

实现方向、拟定接口、关键约束及开发顺序见 [开发文档](docs/DEVELOPMENT.md)。
