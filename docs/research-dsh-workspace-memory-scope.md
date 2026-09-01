# DSH Workspace Memory Scope Research

## 结论

DSH 当前源码提供正式的 workspace 实体与注册表 API：`@deepseek-ai/dsh-workspace` 通过 Cordis context 暴露 `ctx.workspaceRegistry`。每个 workspace 有稳定的 `WorkspaceId`，该 ID 是创建记录时生成的 UUID；workspace 的路径身份则是创建时经 `fs.realpath` 规范化后的 `Workspace.path`。

DSH 不会把 `workspaceId` 自动放入每个插件工具请求。插件侧稳定可用的会话级工作区信号是 `Session.header.cwd`，在工具执行上下文中对应 `exec.agent.session.header.cwd`。只有在 workspace registry 服务已被 profile 组合并由插件依赖或获取时，插件才能按路径查询 DSH workspace ID。

## Workspace 身份与 API

- `WorkspaceId` 是 branded string，语义上是创建记录时生成的 UUID，不是路径。见 [`workspace/lib/types/types.d.ts`](/home/rebron1900/.local/share/fnm/node-versions/v24.18.1/installation/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-workspace/lib/types/types.d.ts:11-13)。
- `Workspace` 公共字段包括 `id`, `path`, `title`, `createdAt`, `updatedAt`, `sessionIds`。见同文件第 15-43 行。
- `Workspace.path` 是 `fs.realpath` 结果，创建后即使目录消失也不会改写。见同文件第 23-27 行。
- `ctx.workspaceRegistry` 由 Cordis module augmentation 暴露。见 [`workspace/lib/types/index.d.ts`](/home/rebron1900/.local/share/fnm/node-versions/v24.18.1/installation/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-workspace/lib/types/index.d.ts:42-45)。
- 注册表公开 API 包括：
  - `create(path, title?)`: 对现有目录执行 realpath 规范化；同一 canonical path 至多一条记录，重复调用复用记录。
  - `get(id)`: 按 `WorkspaceId` 查找。
  - `list()`: 按持久化 registry 顺序返回 workspace。
  - `resolveByPath(path)`: realpath 后查找，不创建记录；未归属目录返回 `undefined`。
  - `delete(id)`: 删除 workspace 注册、顺序项和 session account，但不删除目录、用户文件、live session 或 session log。
  - `Workspace.attachSession(id)` / `detachSession(id)`：维护 workspace 的 session account。
  - `archiveSession(id)` / `archivedSessionIds`：注册表级隐藏 session，不删除 session log。
  这些签名与语义见 [`workspace/lib/types/index.d.ts`](/home/rebron1900/.local/share/fnm/node-versions/v24.18.1/installation/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-workspace/lib/types/index.d.ts:48-139) 和 [`@deepseek-ai/dsh-workspace/README.md`](/home/rebron1900/.local/share/fnm/node-versions/v24.18.1/installation/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-workspace/README.md:9-19)。

## 持久化字段与生命周期

workspace record 的 durable schema 是：`path`, `title`, `sessionIds`, `createdAt`, `updatedAt`。见 [`workspace/lib/types/spec.d.ts`](/home/rebron1900/.local/share/fnm/node-versions/v24.18.1/installation/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-workspace/lib/types/spec.d.ts:11-23)。

registry global state 包括：

- `initialized`: 是否完成首次历史 bootstrap；
- `workspaceIds`: 权威的 workspace 显示顺序；
- `archivedSessionIds`: registry 级归档集合；
- `pendingMutation`: create/delete 的恢复标记。

字段见同文件第 25-46 行；workspace domain 的 table/key/version 见第 48-82 行。

服务启动时等待 `sessionPersistence`，首次启动仅读取历史 session header 的 `id`, `cwd`, `createdAt` 来建立 workspace 候选索引，并在最后写入 initialized marker。创建和删除会先写 pending-mutation marker；重启时完成已标记操作，未解释的 order/table 不一致会失败。见 [`@deepseek-ai/dsh-workspace/README.md`](/home/rebron1900/.local/share/fnm/node-versions/v24.18.1/installation/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-workspace/README.md:21-23)。

同一目录删除注册后再注册会得到新的 workspace ID，不会自动重新接管保留的 session。见同 README 第 23 行。

## Session workspace 信号

`SessionHeader` 是不可变的持久化创建 metadata，其中：

- `id`: session identity；
- `createdAt`: 创建时间；
- `cwd?: string`: 创建时的绝对工作目录；
- 另有 parent/fork lineage 等字段。

见 [`dsh-session/lib/types/types.d.ts`](/home/rebron1900/.local/share/fnm/node-versions/v24.18.1/installation/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-session/lib/types/types.d.ts:38-77)。创建 session 时通过 `meta.cwd` 提供，见同文件第 80-99 行。

工具侧源码注释明确，文件工具从调用 agent 的 `exec.agent.session.header.cwd` 解析相对路径；非 agent 调用没有该 cwd。见 [`dsh-tool-fs/lib/types/session-cwd.d.ts`](/home/rebron1900/.local/share/fnm/node-versions/v24.18.1/installation/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-tool-fs/lib/types/session-cwd.d.ts:1-18)。

sandbox API 中的 `workspaceRoot` 是每次 capability call 的绝对边界，`sessionId` 是调用 session 的 opaque `SessionId`，不是 workspace ID。见 [`dsh-sandbox/lib/types/index.d.ts`](/home/rebron1900/.local/share/fnm/node-versions/v24.18.1/installation/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-sandbox/lib/types/index.d.ts:23-39)。

## 插件获取边界

- 插件可在工具 `execute(args, exec)` 中读取 `exec.agent?.session?.header?.cwd`，但必须处理 agentless call 或缺失 cwd。
- 若 profile 安装并启用了 workspace registry，插件可以调用 `ctx.workspaceRegistry.resolveByPath(cwd)` 并读取返回 `Workspace.id`。registry 是正式 API，但不是所有 profile 的默认请求字段；插件需要把它作为硬依赖 `inject`，或通过 `ctx.get('workspaceRegistry')` 软依赖获取。
- 没有证据表明普通 request 参数含有自动注入的 `workspaceId`。workspace 包 README 明确该包只服务 host-side consumers，不注册 tools、不注入 prompts、不写 session events，因此不会自行把 workspace 数据放入请求。
- DSH launcher 文档只规定 invoking directory 是默认 workspace root；不能把 `process.cwd()` 直接当作当前 session workspace。见 [`@deepseek-ai/dsh/README.md`](/home/rebron1900/.local/share/fnm/node-versions/v24.18.1/installation/lib/node_modules/@deepseek-ai/dsh/README.md:16)。

## Mnemosyne 上游约束

Mnemosyne 官方 [`docs/configuration.md`](https://raw.githubusercontent.com/mnemosyne-oss/mnemosyne/main/docs/configuration.md) 明确：`remember()` 默认 `scope="session"`，session-scoped rows 只对相同 `session_id` 可见；需要跨 session 的持久事实应使用 `scope="global"`。这意味着 workspace 共享可以兼容现有引擎：把 canonical workspace key 映射为 Mnemosyne 的 `session_id`，不必修改上游数据库 schema。但仅切换 resolver 不会自动迁移现有的 `dsh_<session>` rows。

官方 [`docs/README.md`](https://raw.githubusercontent.com/mnemosyne-oss/mnemosyne/main/docs/README.md) 将 API、配置和集成文档列为项目参考入口；本结论中的 Mnemosyne scope 语义以其配置文档为准。

## 对当前插件的落地建议

- 当前 `src/index.js:88` 只注入 `tools`、`agents`、`sessions`；`src/index.js:1882-1892` 的 `sidFor()` 以 root DSH session 派生 Mnemosyne `session_id`；`package.json:39-47` 没有 `@deepseek-ai/dsh-workspace` peer dependency。因此当前实现确实是 session-first，不会自动按 DSH workspace 聚合。
- 最小改造应增加 workspace scope mode：从 `exec.agent.session.header.cwd` 获取 session 工作目录，先 canonicalize，再通过可用的 `ctx.workspaceRegistry.resolveByPath(cwd)` 查官方 `WorkspaceId`；registry 缺失、workspace 未注册或 cwd 不可用时，降级为 canonical realpath 的稳定 hash。写入和 recall 必须使用同一个 resolver。
- 不要把 `Workspace.title` 当 key，因为标题允许重复；也不要只依赖 `WorkspaceId`，因为删除 workspace 注册后，同一路径重新注册会生成新的 UUID。建议使用 `workspace:<sha256(realpath(cwd))>` 作为连续 namespace，官方 `WorkspaceId` 作为诊断/关联元数据。
- 不建议直接把所有自动对话记忆都改成 workspace 共享：同项目中的多个对话可能混入临时任务、用户偏好或敏感上下文。更稳妥的是三层策略：`global` 作为显式跨项目事实；workspace scope 作为项目事实；session scope 保留为对话局部/短期记忆，并由设置项选择默认写入层。
- Subagent 继续先解析 root session，再使用 root 的 workspace key；否则一个项目中的委托任务会被意外拆散。
- 旧 `dsh_<session>` rows 不能靠新 resolver 自动归并。迁移应按 session header 的 canonical cwd 分组，提供 dry-run、重复/冲突处理、备份或回滚；没有 cwd 的 legacy rows 不应猜测归属，应保留在 legacy/default 或独立 fallback namespace。
- agentless 调用、无 cwd session 和非 Web profile 必须有明确 fallback，不应把 `process.cwd()` 猜成当前 workspace。Web profile 可使用 registry；为兼容 headless/minimal，建议 workspace registry 走软依赖。

## 结论判断

这个方向是合理的，而且比单纯按 session id 更符合 DSH Web 的实际用户心智：workspace 是项目边界，session 是一次对话。建议将 workspace 作为“项目记忆”的默认召回边界，同时保留 session 级隔离能力，而不是把 sessionScope 整体删除或把所有记忆无条件合并到 workspace。

## 一手来源

- 本机 DSH checkout：`/home/rebron1900/.local/share/fnm/node-versions/v24.18.1/installation/lib/node_modules/@deepseek-ai/dsh/`
- DSH 官方仓库：[deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)
- Mnemosyne 官方仓库：[mnemosyne-oss/mnemosyne](https://github.com/mnemosyne-oss/mnemosyne)

本文仅引用上述 DSH/Mnemosyne 官方源码、随附类型定义、包 README 和官方文档；未采用社区插件或二手文章作为证据。
