# dsh-mnemosyne 实现方案

> 把 [`mnemosyne-oss/Pi-mnemosyne`](https://github.com/mnemosyne-oss/Pi-mnemosyne) 的 Mnemosyne 记忆能力移植到 DeepSeek Harness（DSH），以 Profile Bundle（静态 cordis 插件包）形态交付。

## 1. 背景

Pi-mnemosyne 是 [Mnemosyne](https://github.com/mnemosyne-oss/mnemosyne)（本地优先、SQLite 支持的 AI 记忆层）面向 Pi coding agent 的官方插件。所有记忆逻辑都在 `mnemosyne` CLI（`pip install mnemosyne-memory`）里，插件保持 CLI 优先（一切记忆操作子进程调用 CLI），但**已超出原版"无状态代理"的边界**：会话隔离（§12）需要经 CLI venv 解释器在进程内构造 `Mnemosyne(session_id=...)` 的 Python helper，迁移路由直连 SQLite，写过滤器经 env 桥接。这些都是薄胶水，不重复实现记忆逻辑。

## 2. Pi-mnemosyne 代码走读

仓库共 439 行，五个文件承担四种职责：

| 文件 | 职责 |
|---|---|
| `package.json` | `"pi": { "extensions": ["src/index.ts"], "skills": ["skills"] }` 声明扩展入口与技能目录；peerDeps 引宿主 API 与 typebox |
| `src/index.ts` | 默认导出 `(pi: ExtensionAPI)`：调用 `pi.registerTool()` 五次，每次用 typebox `Type.Object` 定义参数，`execute()` 内 `spawn("mnemosyne", [...])` 并返回 `{ content: [{type:'text',text}], details }` |
| `skills/mnemosyne/SKILL.md` | frontmatter（name/description）+ 使用时机、五个工具说明、最佳实践 |
| `tests/index.test.ts` | vitest mock `ExtensionAPI`，断言注册了恰好 5 个预期名字的工具 |
| `.github/workflows/ci.yml` | typecheck + test |

五个工具及其 CLI 映射：

| 工具 | CLI 调用 |
|---|---|
| `mnemosyne_remember(content, source?, importance?)` | `mnemosyne store <content> [source] [importance]` |
| `mnemosyne_recall(query, top_k?)` | `mnemosyne recall <query> [top_k]` |
| `mnemosyne_forget(id)` | `mnemosyne delete <id>` |
| `mnemosyne_stats()` | `mnemosyne stats` |
| `mnemosyne_sleep()` | `mnemosyne sleep` |

错误处理仅两处：spawn 失败提示 `pip install mnemosyne-memory`；非零退出取 stderr。

## 3. DSH 扩展体系（调研结论）

以下结论来自本机 DSH 安装的权威材料：内置技能 `cordis-plugin-development`、`editing-cordis-compositions`，以及 `@deepseek-ai/dsh-tools` / `dsh-skill` / `dsh-settings` / `dsh-skill-filesystem` 各包 README 和真实第三方插件（`dsh-free-search` 等）源码。

### 3.1 组合模型

- `dsh --profile <name>` 启动一个 profile；profile 目录（如 `~/.dsh/profiles/web/`）持有 `package.json`、`cordis.yml`（根，空数组）、用户 patch 层 `cordis.patch.yml`。
- 配置树从空根开始按顺序叠加：**每个 bundle 的 patch 层** → profile 用户 patch → home patch → `--patch`。
- **bundle 的身份由 package.json 的 `"dsh": { "bundle": { "patch": "cordis.patch.yml" } }` 声明**。`dsh plugin --profile web add <pkg>` 用 pnpm 安装依赖后，凡解析结果声明了 `dsh.bundle.patch` 的依赖会自动追加进 `dsh.profile.bundles` 层列表；移除时自动退出。
- patch 层是 YAML 数组，典型写法是把插件自身作为一行插入组合树：

```yaml
- insert:
    - id: mnemosyne
      name: dsh-mnemosyne      # 解析为 profile node_modules 里的包入口
      config: { ...默认配置 }
```

### 3.2 插件模块形态（cordis 约定）

入口 ESM 模块使用命名导出：

```js
export const name = "mnemosyne";          // 行内标识
export const inject = ["tools"];          // 硬依赖服务；未就绪则插件等待
export const Config = z.object({...});    // schemastery 配置 schema，对应行的 config
export function apply(ctx, config) {...}  // 注册一切贡献，须放在 effect 内以便随 fiber 清理
```

服务访问规则：硬依赖写入 `inject` 导出；可选依赖用 `ctx.get('x')` 判空。未经声明的 `ctx.x` 访问会被 Guard 拒绝。

### 3.3 工具注册（对应 pi.registerTool）

`@deepseek-ai/dsh-tools` 提供 `ctx.tools.register(definition)`，官方惯例包装：

```js
ctx.inject(["tools"], (sctx) => {
  sctx.effect(
    () => sctx.tools.register(defineTool({
      name, description,
      parameters: { query: { type: "string", required: true, description } }, // JSON-schema 风格
      output: {
        schema: {...},                                   // 必填：execute 返回值的 JSON schema
        render: (_args, value) => [{ type: "text", text }],
      },
      async execute(args) { return "..."; },             // 返回值受 output.schema 校验
    })),
    "标签"
  );
});
```

要点：`output` 声明强制存在；`render` 直接返回 block 数组（官方 `web_search` 即如此）；注册即进入下一模型步可见；随调用 fiber 自动注销。

### 3.4 技能系统（对应 pi.skills）

`ctx.skills` 注册表 + 多 provider。文件系统 provider 按 rank 扫描：项目 `<root>/.dsh/skills`(100)、`.agents/skills`(200)、自定义目录(300)、`~/.dsh/skills`(400)、`~/.agents/skills`(500)。插件可走更简单的 **runtime 内嵌注册**：

```js
const skills = ctx.get("skills");
if (skills) ctx.effect(() => skills.register({
  name: "mnemosyne",            // 必须 kebab-case
  description, whenToUse?,
  content: "<markdown 正文>",
}), "标签");
```

runtime skill 固定 rank 250：可被项目/用户级同名文件覆盖，又覆盖内置 bundled(600)。省略 invocation 时 model/user 双面可用——与 pi-mnemosyne 的体验一致（随包装、零复制）。

### 3.5 其余可用面（本方案 v0.1 不用，见 §8）

- `ctx.settings.register(ns, schema)` + `./client` 导出 + `dsh.client` 声明 → Web 设置页；
- `slots.register` 系列 → 工具卡片、侧栏等 UI；
- agent loop / session 事件 → 会话生命周期钩子；
- 动态插件（`cordis_define` 等运行时工具）→ 进程内临时插件，不适合分发持久能力，故不采用。

## 4. 概念映射

| Pi-mnemosyne | dsh-mnemosyne |
|---|---|
| pi package（`pi.extensions` 入口） | Profile Bundle（`dsh.bundle.patch` 声明 + patch 行） |
| `pi.registerTool(...)` | `sctx.tools.register(defineTool({...}))` |
| typebox `Type.Object` 参数 | defineTool JSON-schema `parameters` |
| `skills/` 目录随包分发 | `ctx.skills.register()` runtime 内嵌技能 |
| `.pi/settings.json` packages 安装 | `dsh plugin --profile web add <pkg>` |
| `/reload` 生效 | 重启 profile 生效 |
| vitest + mock ExtensionAPI | node:test + mock ctx（stdlib，免新依赖） |

## 5. 设计决策

- **D1 纯 ESM JavaScript，无构建链**。参照 dsh-free-search / dsh-vision-router 先例，发布即源码；类型靠 JSDoc。跳过 TS/tsc，等项目复杂度上来再引入。
- **D2 继续 CLI 代理，不内嵌存储**。记忆逻辑留在 mnemosyne 本体，插件保持 CLI 优先薄壳，上游升级零成本。v0.4 起为会话隔离与迁移新增两块越界薄胶水（§12）：经 venv python 运行的会话级 helper、直连 SQLite 的 default→global 迁移——均不重复实现记忆逻辑。
- **D3 技能内嵌注册而非要求复制文件**。比"复制 SKILL.md 到 ~/.agents/skills"少一步手工操作，且可被项目级同名技能覆盖。
- **D4 硬依赖只声明 `tools`；`skills` 软依赖判空**。最小 headless 组合没有 skills 服务时工具仍可挂载。
- **D5 所有工具输出统一为字符串 + text block 渲染**。CLI stdout 本来就是面向人/模型的文本，不做结构化拆解（YAGNI）。
- **D6 `execFile` + timeout + ENOENT 友好提示**。CLI 缺失时直接给出安装命令，避免裸 ENOENT。

## 6. 已落地的项目结构

```text
dsh-mnemosyne/
├── package.json          # dsh.bundle 声明；deps: schemastery；peers: dsh-tools
├── cordis.patch.yml      # insert 一行：id=mnemosyne, config 默认值
├── src/index.js          # name/inject/Config/apply/SKILL；5 个 defineTool + runMnemosyne
├── test/index.test.js    # node:test：参数组装、注册契约、skill、manifest、CLI 失败路径
├── docs/design.md        # 本文档
├── AGENTS.md / README.md / LICENSE(MIT) / .gitignore
```

配置项（patch 行 `config:` 可覆盖）：`cli`（默认 `mnemosyne`）、`defaultTopK`（5）、`timeoutMs`（20000）。

## 7. 安装与验证

```bash
dsh plugin --profile web add dsh-mnemosyne        # npm 包；开发期可 add <本地路径>
# 重启 web profile 后：
# 1) 打开 Settings > Mnemosyne，点 Setup 自动安装 CLI（uv tool install mnemosyne-memory）
#    或手动：uv tool install mnemosyne-memory
# 2) 点 Test connection 验证 store+delete 闭环
# 3) 工具列表出现 mnemosyne_remember / recall / forget / stats / sleep
# 4) 技能目录出现 mnemosyne
```

数据与配置落点：`~/.dsh/mnemosyne/`（`MNEMOSYNE_DATA_DIR` 透传），SQLite 库 `mnemosyne.db` 与 `config.yaml` 均在此目录。

## 8. 测试策略

测试分三层，均用 `node:test`（stdlib，零额外依赖），`pnpm test` 一并执行（当前共 99 例：81 单元 + 15 集成 + 3 client）。

### 8.1 单元测试 `test/index.test.js`（81 例，无需 mnemosyne CLI）

1. `storeArgs` / `recallArgs` 位置参数组装（含可选参数缺省）；
2. mock ctx 上 `apply()` 恰好注册 5 个预期工具，且每个都有 execute / output.schema / render；
3. skill 注册且名字合法 kebab-case、正文含工具引用；
4. render 输出为合法 text block 数组；
5. CLI 缺失 → 提示 `pip install mnemosyne-memory`；非零退出 → reject；
6. manifest 契约：`dsh.bundle.patch` 指向存在的 patch 文件，patch 含 insert 行。

### 8.2 集成测试 `test/integration.test.js`（15 例，需真实 `mnemosyne` CLI）

对照 mnemosyne 主仓库 `tests/test_cli_*.py` 的行为契约，对着真实 CLI 跑插件自己的代码路径（`runMnemosyne` + `storeArgs`/`recallArgs` + `apply()` 注册的 `execute()` 闭包）。`resolveCli()` 找不到 `mnemosyne` 时整组自动 skip。

隔离：`before` 钩子把 `process.env.MNEMOSYNE_DATA_DIR` 指向独立 tmpdir、`MNEMOSYNE_NO_EMBEDDINGS=1` 跳过嵌入模型，**绝不触碰用户真实记忆库**；`after` 还原 env 并清理 tmpdir。各用例用唯一 marker 避免相互命中。

覆盖（下表为代表性契约，非穷举）：

| 用例 | 验证契约 |
|---|---|
| stats 空库 | `Mnemosyne Stats` + `Total memories: 0` |
| remember | `Stored: <16-hex-id>` |
| recall 未命中 | `Results for: <q>` 且无 `ID:` |
| recall 命中 | 含 `ID: <id>` / `Content:` / `Score:` |
| forget 有效 id | `Deleted: <id>` |
| forget 缺失 id | reject 含 `Memory not found: <id>`（exit 1 契约） |
| sleep | `Consolidation complete` |
| 端到端闭环 | remember→recall 命中→forget→recall 确认空 |
| execute 闭包 | `apply()` 注册的工具直接驱动真实 CLI（config 钉死绝对路径） |

集成验证（需真实宿主）按 §7 手工执行一次。

### 8.3 客户端测试 `test/client.test.js`（3 例）

使用 `window.__ModuleLoader__` 与 React mock 验证客户端模块导出、locale 注册、独立 `settings.section` slot、卡片渲染结构和客户端插件契约。

### 8.4 真实 CLI 行为契约（实测得出）

| 命令 | stdout | 退出码 |
|---|---|---|
| `stats` | `Mnemosyne Stats` + `Total/Working/Episodic/Knowledge triples` 计数行 | 0 |
| `store <c> [s] [imp]` | `Stored: <16-hex-id>` | 0 |
| `recall <q> [k]` 空 | `Results for: <q>` 无条目 | 0 |
| `recall <q> [k]` 命中 | `ID:` / `Content:` / `Score:` 行 | 0 |
| `sleep` | `Consolidation complete: {...}` | 0 |
| `delete <缺失id>` | stderr `Error: Memory not found: <id>` | 1 |
| `delete <有效id>` | `Deleted: <id>` | 0 |

## 9. 发布

版本号 bump → tag `vX.Y.Z` → `npm publish`（public）。关键词沿用 `deepseek-harness` / `dsh-plugin` 便于被检索。

## 10. 面板、自动安装与 .dsh 数据落盘（v0.2）

### 10.1 数据落盘

`MNEMOSYNE_DATA_DIR` 决定 mnemosyne 的 SQLite 库与 `config.yaml` 位置。插件 `Config.dataDir` 默认 `~/.dsh/mnemosyne`，`buildEnv()` 总是注入 `MNEMOSYNE_DATA_DIR`，因此数据与配置全部落在 `.dsh` 下，不再依赖 `~/.hermes`。

### 10.2 自动安装 CLI

`setupMnemosyne()` 先 `resolveCli("mnemosyne")`；已就绪则确保 `config.yaml` 的面板配置项有默认值后返回。否则 `resolveCli("uv")`，用 `uv tool install mnemosyne-memory` 安装（超时 180s），再探测 CLI 路径并补齐默认配置。面板 Setup 按钮通过 `POST /mnemosyne/setup` 触发。uv 缺失时返回友好错误。

### 10.3 配置透传

`buildEnv(config)` 负责插件调用 CLI 时的运行时环境，**只注入 `MNEMOSYNE_DATA_DIR`**（始终钉住，它是插件核心契约），外加一个例外：**写过滤器桥接**——上游 store 路径的写入过滤器（`core/filters.py`）只读 `MNEMOSYNE_IGNORE_PATTERNS` / `MNEMOSYNE_WRITE_CLASSIFIER` 环境变量，config.yaml 里的 `ignore_patterns`/`write_classifier` 键从未到达过滤器。因此 `buildEnv` 每次读取 config.yaml，把这两个键（若配置）注入 env（config.yaml > 用户基础 env），让面板 `ignorePatterns` 字段在 `remember()` 时真正过滤噪音（如 `^git `、`^pip install`、`^Traceback`；匹配即静默丢弃，返回 `Stored: None`）。`write_classifier` 不在面板白名单内，用户可手改 config.yaml 启用内置噪音/密钥/结构启发式过滤（`strict` 拒绝 / `warn` 仅记录）。mnemosyne 自身的其余配置由 `dataDir/config.yaml` 管理，文件优先级为 config.yaml > env vars > hardcoded defaults；面板直接读写 config.yaml 中的面板字段。Embedding / LLM / 召回调优 / 工作记忆等上游键**只存在于 config.yaml**，不在 `Config` schema 与 `buildEnv` 里声明，避免形成被 config.yaml 遮蔽的第二条通路；用户全局 env 里已设的 `MNEMOSYNE_*` 会被 config.yaml 未设的键保留。

面板字段对应 config.yaml 的扁平顶层键：`noEmbeddings`→`no_embeddings`、`embeddingModel`→`embedding_model`、`embeddingDim`→`embedding_dim`、`embeddingApiUrl`→`embedding_api_url`、`embeddingApiKey`→`embedding_api_key`、`llmEnabled`→`llm_enabled`、`llmBaseUrl`→`llm_base_url`、`llmApiKey`→`llm_api_key`、`llmModel`→`llm_model`、`llmTimeout`→`llm_timeout`、`polyphonicRecall`→`polyphonic_recall`、`wmMaxItems`→`wm_max_items`、`wmTtlHours`→`wm_ttl_hours`、`autoSleep`→`auto_sleep_enabled`、`sleepThreshold`→`sleep_threshold`、`ignorePatterns`→`ignore_patterns`。`cli`、`defaultTopK`、`timeoutMs`、`dataDir` 及自动记忆六键（`promptSection`/`autoSync`/`autoPrefetch`/`prefetchTopK`/`prefetchMinQueryLen`/`sessionScope`）是 DSH 专用设置（运行时目录以 DSH settings 的 `dataDir` 为唯一事实源，config.yaml 不再写 `data_dir`）。

`readMnemosyneConfigYaml()` 解析扁平 YAML 标量并恢复字符串、数字、布尔值和 null 类型；`ensureConfigDefaults()` 在 setup/diagnose 时只为缺失或空值补写 mnemosyne 默认值，不覆盖用户已有值。

### 10.4 设置面板（client 端）

`src/client.js` 以 `window.__ModuleLoader__.load` 格式注册一个 cordis 客户端插件，`apply` 里：

1. `ctx.locale.register("dsh-mnemosyne", {zh, en})` 注册双语字典；
2. `ctx.slots.inject("settings.section", () => ctx.slots.register({name:"settings.section", id:"mnemosyne", order:50, label, locale}, render))` 在 Settings 左侧注册独立入口（仿 dsh-market）。

`MnemosynePanel` 组件（`React.createElement`，无 JSX）：
- **状态卡**：CLI 就绪/路径、数据目录、记忆计数（解析 `mnemosyne stats` 的 `Total memories:`）；
- **Setup 按钮**：`POST /mnemosyne/setup` 自动安装 CLI，并补齐 config.yaml 默认值；
- **Test 按钮**：`POST /mnemosyne/test` 跑 store+delete 探针，成功后立即调用 diagnose 刷新 stats；
- **Refresh 按钮**：`GET /mnemosyne/diagnose` 刷新状态；
- **配置卡片**：状态卡和插件卡默认展开，其余配置卡默认折叠；每个字段采用左侧名称/问号 tooltip、右侧输入控件的单行布局；空值字段用默认值 placeholder；
- **恢复默认配置**：`DELETE /mnemosyne/config` 将面板管理的配置写回 mnemosyne 默认值并执行 config reload；
- **底部提醒**：提示用户可直接编辑 `~/.dsh/mnemosyne/config.yaml` 修改更多参数。

配置编辑由 DSH settings 与扁平 config.yaml 共同承担。config.yaml 字段通过 HTTP 路由读写，保存后自动执行 `mnemosyne config reload`；大部分配置无需重启，`vec_type` 等启动时确定的配置例外。

`package.json` 声明 `dsh.client: { inject: [...client-ui 包], platform: "web" }` 与 `"./client"` 导出。

### 10.5 Host HTTP 路由

`apply` 软依赖 `ctx.inject(["webServer"])`，注册 HTTP 路由供面板 `fetch` 调用：

| path | method | 行为 |
|---|---|---|
| `/mnemosyne/diagnose` | GET | 探测 CLI + 确保 dataDir + 跑 stats，返回结构化报告 |
| `/mnemosyne/setup` | POST | 检测/安装 CLI（uv tool install） |
| `/mnemosyne/test` | POST | store 探针记忆 → delete，验证闭环 |
| `/mnemosyne/config` | GET | 读取扁平 dataDir/config.yaml，**只返回面板管理字段的允许列表**（允许列表之外的键一律不下发），再合并 mnemosyne 默认值；密钥类值（`embedding_api_key`、`llm_api_key`、`llm_fallback_api_key`、`conflict_llm_api_key`、`sync_key` 等）以掩码 `***` 返回，真实值不出服务端 |
| `/mnemosyne/config` | POST | 写入面板管理的顶层 config.yaml 键，并执行 `mnemosyne config reload`（收到掩码 `***` 的密钥键视为"未修改"，跳过写入，防占位符覆盖已存密钥；空串则是显式清除） |
| `/mnemosyne/config` | DELETE | 将面板管理的顶层键恢复为 mnemosyne 默认值，并执行 config reload |
| `/mnemosyne/migrate-default-session` | POST | 把历史 `default` 会话记忆翻转为 `global` 作用域（venv python 直连 SQLite，事务 + 回滚，内容不变） |
| `/mnemosyne/migrate-session-scopes-to-default` | POST | 把 `dsh_*` session 行合并回共享 `default` 命名空间；这是显式不可逆操作，会丢失原会话归属 |

### 10.6 会话收尾自动 sleep

`apply` 通过 `ctx.on("session/event", ...)` 监听 `turn/end` 事件。当 `config.yaml` 的 `auto_sleep_enabled` 为 true 且工作记忆条目数 ≥ `sleep_threshold` 时，自动调用 `mnemosyne sleep` 整合记忆。读取 config.yaml（而非 DSH settings）作为事实源，使面板编辑即时生效无需重启。失败静默跳过，不干扰会话。

## 11. 自动记忆增强（v0.3）

对标 mnemosyne 主仓库 `hermes_memory_provider` 的三层自动化能力（system prompt 注入、pre-turn prefetch、post-turn sync），在保持 CLI 代理架构的前提下，利用 DSH 的 `agent/pre-step` waterfall 与 `session/event` 事件实现等价功能。**三项功能全部默认关闭**，保持当前手动调用行为不变。

### 11.1 配置项

| Config 字段 | 默认 | 作用 |
|---|---|---|
| `promptSection` | `false` | 在 system prompt 注入 `# Mnemosyne Memory` 声明段 |
| `autoSync` | `false` | 每轮对话后自动将**真实 user 消息**存入 Mnemosyne（默认不同步 assistant 输出；注入型上下文——`plugin` / `agent-instructions` / `skill-catalog`——永不入库） |
| `autoPrefetch` | `false` | 每个模型步骤前自动 recall 相关记忆并注入对话流 |
| `prefetchTopK` | `5` | 自动召回注入时返回的记忆条数 |
| `prefetchMinQueryLen` | `3` | 用户消息短于此长度时跳过自动召回 |
| `sessionScope` | `false` | 按 DSH 会话分区记忆（session_id 列）：每会话只召回自己的记录 + global 行 |

### 11.2 systemPrompt.section — 静态声明段

当 `promptSection` 为 true 时，通过 `ctx.get("systemPrompt").section()` 注册一个 order=95 的 prompt 段（在 tool guidance 100-199 之前），内容为 `# Mnemosyne Memory` 头部声明，告诉模型记忆工具可用及其使用方式。软依赖 `ctx.get("systemPrompt")`，不影响 inject 声明。

对应 hermes provider 的 `system_prompt_block()`。

### 11.3 session/event — 自动对话存储（sync_turn）

当 `autoSync` 为 true 时，扩展已有的 `session/event` 监听器，除了 `turn/end` 的 auto-sleep 逻辑，还处理**真实 user 消息**：

- 只处理 `source.kind === 'user'` 的 `user/message` 事件（每轮一次，不做逐 step 同步）
- 注入型上下文一律跳过：`plugin`（含本插件自己的 prefetch 注入）、`agent-instructions`、`skill-catalog`——与 `extractLastUserText()` 的注入来源名单保持一致，防止 system-reminder / AGENTS.md / 技能目录进入记忆并形成召回反馈循环
- 提取 text content（截断 500 字），`mnemosyne store <text> conversation 0.5`
- assistant 消息默认不自动存储（对齐上游 `sync_roles` 默认仅 `user` 的语义）

`extractMessageText()` 从消息 content blocks（`[{type:"text",text}]` 数组）中提取纯文本。失败静默跳过。

对应 hermes provider 的 `sync_turn()`。区别：hermes 是 in-process 直接调用 `beam.remember()`，dsh-mnemosyne 是 out-of-process spawn `mnemosyne store` 子进程。

### 11.4 agent/pre-step — 自动召回注入（prefetch）

当 `autoPrefetch` 为 true 时，通过 `ctx.on("agent/pre-step", ...)` 注册一个 prepend 监听器（`inject: ["agents"]`）。每个模型步骤前：

1. 调 `next()` 拿到下游决策（`{kind:'enter', messages}` 或 `{kind:'reject'}`）
2. 从 `decision.messages` 中提取最后一条 user 消息文本作为 query
3. 短消息（< `prefetchMinQueryLen`）跳过，避免对 "hi"/"ok" 浪费 CLI 调用
4. 同一 turn 内已 prefetch 过的相同 query 跳过（`prefetchedQueries` Set 去重）
5. `mnemosyne recall <query> <topK>` → 检查结果是否含 `ID:` 行（命中判断）
6. 命中则用 `formatPrefetchContext()` 格式化为 `## Mnemosyne Context` 文本块
7. 返回 `{kind:'enter', messages: [...decision.messages, injectedMsg]}`，注入消息带 `source: {kind:'plugin', plugin:'mnemosyne', ...}`
8. recall 失败或无命中时原样返回 decision，不干扰会话

对应 hermes provider 的 `prefetch()`。`dsh-time-context` 插件使用相同模式注入时间上下文。

### 11.5 inject 变更

`export const inject` 从 `["tools"]` 改为 `["tools", "agents"]`。`agents` 服务提供 `ctx.on("agent/pre-step", ...)` 事件注册能力。在 web profile 下 `agents` 是核心服务，必然存在。`systemPrompt` 通过软依赖 `ctx.get("systemPrompt")` 访问，不改 inject。

### 11.6 面板

新增 `groupAuto`（自动记忆）配置组，包含 6 个字段：`promptSection`（toggle）、`autoSync`（toggle）、`autoPrefetch`（toggle）、`sessionScope`（toggle）、`prefetchTopK`（number）、`prefetchMinQueryLen`（number）。这些字段是 DSH 侧配置（不写入 config.yaml，不走 buildEnv），由 DSH settings 管理。组内 `sessionScope` 字段下方常驻"迁移 default 会话记忆到 global"按钮（见 §12.1）。

### 11.7 测试

新增自动记忆与会话隔离相关用例（当前总计 99 例 = 81 单元 + 15 集成 + 3 client）：
- 自动记忆配置默认值（6 例）：验证三项功能默认关闭、systemPrompt.section 条件注册、agent/pre-step 条件注册
- `extractMessageText`（5 例）：从 content blocks 数组提取文本
- `extractLastUserText`（3 例）：从 messages 数组提取最后一条 user 消息
- `formatPrefetchContext`（3 例）：格式化 recall 输出为 prompt 注入文本
- 原有用例保持通过（累计 99 例）

## 12. 会话隔离（sessionScope，v0.4）

CLI 的 store/recall 没有会话参数，所有路径都落在默认 `session_id='default'`（CLI `_resolve_default_scope()` 默认 `session` 作用域）。为使每个 DSH 会话拥有独立记忆，新增 `sessionScope`（默认 false，开启后隔离生效）。

### 12.1 session_id 派生与迁移

- `deriveSessionSid()`：形如 `session-<uuid>` 的持久 id 原样加 `dsh_` 前缀。`session-<n>` 计数器形 id 在 DSH 持久化恢复后会保留原 id（`header.createdAt` 同样持久化），因此 sid 派生自 **session header 的 `createdAt`**（`dsh_<id>_<createdAt>`）：恢复的会话跨 DSH 重启保持同一 sid，记忆不丢；同 id 的新建会话 createdAt 必不同，不会撞名。（不能用每 boot 随机 uuid——会让恢复会话的旧记忆变成孤儿。）
- `findRootSession()`：沿 `header.parentSession` 链走到根会话——子代理归入其根会话，委托工作共享主会话记忆（有意设计，非缺陷）。
- 会话对象经 WeakMap 绑定 sid，不持有强引用；fiber 销毁后 GC，下次事件重新绑定。
- **迁移（default → global）**：历史 `default` 会话记忆在隔离下不可见（recall 只命中 `session_id = ? OR scope = 'global'`）。面板按钮调用 `POST /mnemosyne/migrate-default-session`，经 venv python 直连 SQLite，把 `working_memory`/`episodic_memory` 中 `session_id='default'` 且非 global 的行翻转为 `scope='global'`（事务 + 回滚，内容不变）。triples 表无 session_id/scope，天然共享，无需迁移。
- **反向迁移（dsh session → default）**：关闭 `sessionScope` 前可用面板按钮调用 `POST /mnemosyne/migrate-session-scopes-to-default`，把 `dsh_*` 的 session 行合并到 legacy `default`。该动作会丢失原会话归属，必须显式确认。

### 12.2 venv python 直驱 helper

CLI 无会话参数，因此 `SESSION_HELPER`（`mnemosyne_session_helper.py`，写入 dataDir）通过 CLI shebang 解析出的 python 在进程内构造 `Mnemosyne(session_id=..., bank=...)`，实现 store/recall/delete/sleep：

- store 接受显式 `session` / `global` scope；recall 强制 `_cross_session=False`，不让 config.yaml 绕过隔离；bank 从 `MNEMOSYNE_BANK` 继承，与 CLI 保持同一数据库
- recall 输出格式与 CLI 严格一致（`Results for:` / `ID:` / `Content:` / `Score:` / `[entity match]`），`formatPrefetchContext` 与工具文本解析零改动
- argv 直传内容（execFile 无 shell，仅 NUL/长度边界；auto-sync 已截断 500/800）

### 12.3 整合路径

- `mnemosyne_sleep` 仍显式整合全部会话；自动 sleep 在 sessionScope 下只整合触发它的当前会话，避免后台任务改变其他 profile 的活跃上下文。
- `mnemosyne_stats` 与面板统计为全库计数，不按会话区分（工具语义如此，属预期）。

### 12.4 依赖与边界

- 会话路径依赖 CLI shebang 解析出的 python；绝对解释器与 `#!/usr/bin/env python3` 形式都支持。
- 开启前旧记忆不可见——面板 hint 与 README 均提示先迁移。
- **global 是所有会话的共享命名空间，可读可写**：任何会话都能 recall 到 global 行，也能 delete 它们（engine 的 forget SQL 是 `session_id = ? OR scope = 'global'`）。这是上游语义，插件不额外做删除保护；需要只读公共记忆时别用 global。
- **`cross_session` 被会话 helper 强制关闭**：上游 config.yaml 的该键不会扩大 sessionScope 的 recall 范围。

### 12.5 安全：config 密钥掩码

`GET /mnemosyne/config` **只返回面板管理字段的允许列表**（允许列表之外的 config.yaml 键一律不下发，包括 `llm_fallback_api_key`、`conflict_llm_api_key`、`sync_key` 等未列入面板的上游密钥），密钥值统一返回固定掩码 `***`（`MASKED_SECRET`），真实值只存在于服务端 config.yaml，杜绝 GET 回显明文密钥（写路径有 sameOrigin，GET 只有 Sec-Fetch-Site 兜底）。`POST /mnemosyne/config` 收到掩码值时跳过该键（视为"未修改"），面板整表回写不会用占位符覆盖已存密钥；显式传空串才是清除。

## 13. 后续可选增强

- 去 CLI 化直连 SQLite — 与上游架构冲突，除非上游 API 变动否则不考虑。
