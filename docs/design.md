# dsh-mnemosyne 实现方案

> 把 [`mnemosyne-oss/Pi-mnemosyne`](https://github.com/mnemosyne-oss/Pi-mnemosyne) 的 Mnemosyne 记忆能力移植到 DeepSeek Harness（DSH），以 Profile Bundle（静态 cordis 插件包）形态交付。

## 1. 背景

Pi-mnemosyne 是 [Mnemosyne](https://github.com/mnemosyne-oss/mnemosyne)（本地优先、SQLite 支持的 AI 记忆层）面向 Pi coding agent 的官方插件。它本身**不含任何记忆逻辑**：所有能力都在 `mnemosyne` CLI（`pip install mnemosyne-memory`）里，插件只做"工具 schema ↔ CLI 参数"的无状态代理。移植到 DSH 时保持这一架构不变。

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
- **D2 继续 CLI 代理，不内嵌存储**。记忆逻辑留在 mnemosyne 本体，插件保持无状态薄壳，上游升级零成本。
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

测试分两层，均用 `node:test`（stdlib，零额外依赖），`pnpm test` 一并执行。

### 8.1 单元测试 `test/index.test.js`（9 例，无需 mnemosyne CLI）

1. `storeArgs` / `recallArgs` 位置参数组装（含可选参数缺省）；
2. mock ctx 上 `apply()` 恰好注册 5 个预期工具，且每个都有 execute / output.schema / render；
3. skill 注册且名字合法 kebab-case、正文含工具引用；
4. render 输出为合法 text block 数组；
5. CLI 缺失 → 提示 `pip install mnemosyne-memory`；非零退出 → reject；
6. manifest 契约：`dsh.bundle.patch` 指向存在的 patch 文件，patch 含 insert 行。

### 8.2 集成测试 `test/integration.test.js`（9 例，需真实 `mnemosyne` CLI）

对照 mnemosyne 主仓库 `tests/test_cli_*.py` 的行为契约，对着真实 CLI 跑插件自己的代码路径（`runMnemosyne` + `storeArgs`/`recallArgs` + `apply()` 注册的 `execute()` 闭包）。`resolveCli()` 找不到 `mnemosyne` 时整组自动 skip。

隔离：`before` 钩子把 `process.env.MNEMOSYNE_DATA_DIR` 指向独立 tmpdir、`MNEMOSYNE_NO_EMBEDDINGS=1` 跳过嵌入模型，**绝不触碰用户真实记忆库**；`after` 还原 env 并清理 tmpdir。各用例用唯一 marker 避免相互命中。

覆盖：

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

### 8.3 真实 CLI 行为契约（实测得出）

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

`setupMnemosyne()` 先 `resolveCli("mnemosyne")`；已就绪则返回。否则 `resolveCli("uv")`，用 `uv tool install mnemosyne-memory` 安装（超时 180s），再探测 CLI 路径。面板 Setup 按钮通过 `harness.handle("mnemosyne.setup")` RPC 触发。uv 缺失时返回友好错误（含安装链接）。

### 10.3 配置透传

`buildEnv(config)` 把 `Config` 字段映射到 mnemosyne 环境变量，**仅注入显式设非默认的字段**，用户全局 env 里已设的 `MNEMOSYNE_*` 不被覆盖（`dataDir` 除外，它是插件核心契约）：

| Config 字段 | 环境变量 |
|---|---|
| `dataDir` | `MNEMOSYNE_DATA_DIR` |
| `noEmbeddings` | `MNEMOSYNE_NO_EMBEDDINGS` |
| `embeddingModel`/`embeddingDim`/`embeddingApiUrl`/`embeddingApiKey` | `MNEMOSYNE_EMBEDDING_*` |
| `llmEnabled`/`llmBaseUrl`/`llmApiKey`/`llmModel`/`llmTimeout` | `MNEMOSYNE_LLM_*` |
| `polyphonicRecall` | `MNEMOSYNE_POLYPHONIC_RECALL` |
| `wmMaxItems`/`wmTtlHours` | `MNEMOSYNE_WM_*` |

`autoSleep`/`sleepThreshold`/`ignorePatterns` 是 `config.yaml` 键（非 env），由 mnemosyne 在 `dataDir/config.yaml` 自行读取；`Config` 声明它们供 settings 表单编辑，未来可扩展 `harness.handle` 写入 config.yaml。

### 10.4 设置面板（client 端）

`src/client.js` 以 `window.__ModuleLoader__.load` 格式注册一个 cordis 客户端插件，`apply` 里：

1. `ctx.locale.register("dsh-mnemosyne", {zh, en})` 注册双语字典；
2. `ctx.slots.inject("settings.section", () => ctx.slots.register({name:"settings.section", id:"mnemosyne", order:50, label, locale}, render))` 在 Settings 左侧注册独立入口（仿 dsh-market）。

`MnemosynePanel` 组件（`React.createElement`，无 JSX）：
- **状态卡**：CLI 就绪/路径、数据目录、记忆计数（解析 `mnemosyne stats` 的 `Total memories:`）；
- **Setup 按钮**：`host.call("mnemosyne.setup")` 自动安装 CLI；
- **Test 按钮**：`host.call("mnemosyne.testConnection")` 跑 store+delete 探针；
- **Refresh 按钮**：`host.call("mnemosyne.diagnose")` 刷新状态。

配置编辑由 DSH 的 settings 表单承担（host 端 `ctx.settings.register("mnemosyne", Config)` 自动在 Settings 生成表单），面板提供配置提示文案。

`package.json` 声明 `dsh.client: { inject: [...client-ui 包], platform: "web" }` 与 `"./client"` 导出。

### 10.5 Host HTTP 路由

`apply` 软依赖 `ctx.inject(["webServer"])`，注册 HTTP 路由供面板 `fetch` 调用：

| path | method | 行为 |
|---|---|---|
| `/mnemosyne/diagnose` | GET | 探测 CLI + 确保 dataDir + 跑 stats，返回结构化报告 |
| `/mnemosyne/setup` | POST | 检测/安装 CLI（uv tool install） |
| `/mnemosyne/test` | POST | store 探针记忆 → delete，验证闭环 |
| `/mnemosyne/config` | GET | 读取 dataDir/config.yaml 的 memory.mnemosyne 段 |
| `/mnemosyne/config` | POST | 写入 dataDir/config.yaml 的 memory.mnemosyne 段（auto_sleep / sleep_threshold / ignore_patterns） |

### 10.6 会话收尾自动 sleep

`apply` 通过 `ctx.on("session/event", ...)` 监听 `turn/end` 事件。当 `config.yaml` 的 `auto_sleep` 为 true 且工作记忆条目数 ≥ `sleep_threshold` 时，自动调用 `mnemosyne sleep` 整合记忆。读取 `config.yaml`（而非 DSH settings）作为事实源，使面板编辑即时生效无需重启。失败静默跳过，不干扰会话。

## 11. 后续可选增强

- 去 CLI 化直连 SQLite — 与上游架构冲突，除非上游 API 变动否则不考虑。
