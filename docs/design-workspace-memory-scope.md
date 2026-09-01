# 设计方案：Mnemosyne 按工作区召回与隔离

> 状态：已实现并通过当前测试；本文保留设计、迁移边界与评审记录，后续改动以实现和测试为准
> 前置研究：[research-dsh-workspace-memory-scope.md](./research-dsh-workspace-memory-scope.md)（DSH workspace 证据 + 上游约束）
> 范围：仅改 dsh-mnemosyne 插件；不修改 Mnemosyne 上游 schema，不修改 DSH 宿主。

## 1. 问题与目标

现状：记忆按 DSH 会话隔离。`src/index.js` 的 `deriveSessionSid()`（L336）以 root session
（`findRootSession()`，L347）派生 `dsh_<sessionId>[_<createdAt>]` 作为 Mnemosyne
`session_id`。一个项目往往横跨几十次对话，每次对话的记忆互相不可见——这不是用户的心智模型。

用户诉求：**一个工作区里的对话共享该项目的所有记忆**，召回按 workspace 而不是 session。

设计目标：

1. workspace 粒度的召回与自动写入，同项目跨对话共享。
2. session 隔离保留为可选项；召回边界与写入层级是两个正交开关。
3. 工作区身份稳定：目录移动、改名、经不同路径（符号链接）打开，记忆归属不变。
4. 迁移安全：dry-run、备份、单一策略、可回滚；绝不把数据合并进 global。
5. 零上游 schema 变更：workspace 隔离用 namespace 字符串承载在 `session_id` 字段上。

非目标：

- 不引入 bank 物理隔离（多库）作为第一阶段；bank 适配器列为 Phase 3 评估项（见 §12）。
- 不做记忆内容级合并/去重，迁移只做 `session_id` 重写。
- 不在用户未明确授权时创建任何项目内文件。

## 2. 上游机制（事实基础）

- Mnemosyne `remember()` 默认 `scope="session"`：session-scoped 行仅对相同
  `session_id` 可见；`scope="global"` 行永远混入任何召回。检索过滤
  `session_id = ? OR scope = 'global'`（beam.py L428-454、L6072-6088）；
  `_cross_session=True` 移除过滤（beam.py L9072-9117）。本方案不使用跨会话模式，
  `global` 始终自动包含，无需第三查询。
- Hermes 集成直接把聚合串当 `session_id` 用，上游不关心键语义（`__init__.py`
  L794、L1303-1306、L1734-1784）。**把 namespace 当 session_id 传入即得隔离，零 schema 变更。**
- DSH 侧：插件在工具执行上下文可读 `exec.agent.session.header.cwd`（会话创建时的
  绝对工作目录）；`ctx.workspaceRegistry` 是 web profile 才组合的软依赖，
  `resolveByPath()` 返回的 `WorkspaceId` 是 UUID 元数据（删除重注册会变、不跨机器），
  **不能当主键**。headless 无 registry。

## 3. 三级记忆模型

| 级别 | namespace / scope | 可见性 | 写入途径 |
|---|---|---|---|
| session | `dsh_v2_session_<rootSessionId 派生>` | 仅本对话（+global） | 自动记忆默认（session 模式） |
| workspace | `dsh_v2_workspace_<identityDigest 或 identityKey>` | 同工作区全部对话（+global） | 自动记忆默认（workspace 模式）、显式 remember |
| global | `scope='global'` | 所有工作区 | 仅显式 `mnemosyne_remember(scope="global")` |

- `default`（现行 `sessionScope=false` 的共享池，见 `DEFAULT_TO_GLOBAL_SQL` /
  `SCOPED_TO_DEFAULT_SQL`，L1631-1637）定性为**遗留兼容模式**，提供一次性迁出工具，
  新配置不再产生 `default` 行。
- v2 namespace 带 `dsh_v2_` 前缀：与现存 `dsh_*` 行天然分区，回滚=切回旧配置即可，
  旧行原样躺在库里。

## 4. 配置：两个正交开关

```js
recallMode:   z.enum(["session", "workspace"]).default(...)  // READ 边界
autoWriteScope: z.enum(["session", "workspace"]).default(...)  // WRITE 层级（自动记忆）
```

- 新装默认 `workspace`/`workspace`；**存量安装升级后保持 `session`/`session`**
  （即行为不变），直到用户在面板显式迁移并切换——避免升级瞬间行为突变。
- `sessionScope: boolean` 保留为 deprecated 别名：`true`→session/session，
  `false`→维持 legacy default 池只读兼容（不再新写）。schema 层用 transform 归一。
- 显式工具 `mnemosyne_remember` 的 `scope` 参数语义不变（session|global），新增
  `workspace` 取值；`mnemosyne_recall` 的可见范围由 `recallMode` 决定，工具不接收
  越界参数（防注入式扩散）。
- 组合合法性（H1 修正）：`recallMode=workspace ⟹ autoWriteScope=workspace`
  （写入层级不得窄于召回边界，否则自己刚写的话自己召不回）。反向
  `recallMode=session + autoWriteScope=workspace` 合法（故意窄读）。schema 层校验，
  面板联动置灰非法组合。

## 5. namespace 与身份解析链

### 5.1 namespace 格式

- session：`dsh_v2_session_<deriveSessionSid(root)>`（复用现有 L336 逻辑，仅换前缀）。
- workspace：`dsh_v2_workspace_<hex>`。`<hex>` 为**身份摘要**：
  - 身份来自 marker / git remote 时：`sha256(identityKey)` 全长 64 hex；
  - 身份来自路径时：`sha256(canonicalPath)` 全长 64 hex。
  - **绑定时刻生成一次，此后作为不透明 ID 使用，绝不重算**（§5.3）。截断只允许
    出现在 bank 名（64 字符上限）等显示/命名场景，namespace 本体不截断。
  - 示例（fcitx-enhanced）：canonical path
    `/home/rebron1900/workspace/projects/active/fcitx-enhanced` →
    sha256 `654bfeeb…d5abfd8` → `dsh_v2_workspace_654bfeebadeb1285c36d7a7f3488f4017652cf74434550647fed55526d5abfd8`。

### 5.2 身份解析（仅标记，无自动降级）

```
<cwd 根目录> .mnemosyne-id 存在且合法             → identityKey = "id:<uuid>"
否则                                          → identityKey = null（未绑定，显式状态）
```

- **marker 文件 `.mnemosyne-id`**（项目根，永不自动创建）：单行
  `mnemosyne-workspace-v1: <uuid>`。带版本前缀，格式非法→视为未绑定。
  仅读取当前工作区根目录；子项目不会继承父目录的标记，必须显式绑定。
  git 项目建议加入 `.gitignore` 提示（不代写）。复制该文件到另一目录 =
  用户显式表达"这是同一个项目"（fork/多 checkout 合并语义）。
- **不做 git remote / path 自动推导**：避免"隐式归属"带来的理解负担，也规避
  fork/目录移动/多 remote 等边界。未绑定就是一个明确的"待绑定"状态，由 agent
  提示或面板发起点名，绝不静默映射。
- DSH `WorkspaceId` 只作为 identity.json 条目的关联元数据记录，不参与 key。

### 5.3 绑定即冻结（核心不变量）

namespace 在**首次绑定**时铸造（`dsh_v2_workspace_<sha256(identityKey)>`，identityKey
恒为 `id:<uuid>`），写入 identity.json 后即为不透明 ID。此后 marker 丢失、目录移动
都**不改变** namespace——身份源只是"轮子"，`resolveMemoryContext()` 接口不变：

```js
// src/identity.js（新文件）
export function parseMarkerLine(line)             // .mnemosyne-id 行解析（版本+uuid 校验）
export function resolveIdentity({ cwd })           // 仅标记 → identityKey / null
export function loadIdentityMap(dataDir)           // identity.json 读写（原子 tmp+rename，持锁）
export function resolveMemoryContext({ cwd, sessionId, config })
  // → { mode, namespace, identityKey, source, displayName, bound, reason }
export function upsertWorkspaceEntry(dataDir, info) // 绑定/收养：登记 + 铸 namespace
export function findWorkspaceEntry(map, identityKey) // 查已登记条目
```

## 6. 绑定持久化：`~/.dsh/mnemosyne/identity.json`

```json
{
  "version": 1,
  "workspaces": [
    {
      "identityKey": "id:9f2c…uuid",
      "namespace": "dsh_v2_workspace_a31f…64hex",
      "displayName": "dsh-mnemosyne",
      "canonicalPath": "/home/…/dsh-mnemosyne",
      "lastSeenPath": "/home/…/moved/dsh-mnemosyne",
      "dshWorkspaceId": "uuid-or-null",
      "boundAt": 1756000000000,
      "proposedAt": null,
      "declinedAt": null,
      "supersededBy": null
    }
  ]
}
```

- 写入并发：与现有 `withMemoryLock`（memoryLockKey 已按 dataDir+bank 加锁，L1800）
  同把锁；tmp+rename 原子替换。
- 该文件是可重建索引：丢失后按 §5.2 链重解析；marker/remote 仍在则 namespace
  复算一致，path 来源且目录已移动则降级为"建议重绑定"（§8），绝不静默改归属。

## 7. 三条绑定建立路径

### 7.1 agent 授权初始化（首选，零打断）

用户开启 `recallMode=workspace` 后，若当前 cwd 解析出的 identityKey **无绑定记录**：

1. 召回预取（prefetch）时，系统注入提示行末追加一行：
   `（本工作区尚未绑定项目记忆，可运行 mnemosyne_bind 完成初始化；用户不同意则忽略本行）`
2. agent 询问用户 → 同意后调用**新工具 `mnemosyne_bind`**（第 6 个工具）：
   - 铸 UUID → identity.json 登记 `id:<uuid>` 条目 → **由插件代码**写
     `.mnemosyne-id`（tmp+rename，非 agent 的 fs 工具——consent 与 action 分离：
     agent 只负责征得同意，写文件的是插件本体）。
   - 幂等：调用时先复查 marker；已存在合法 marker 则收养（adopt）并返回
     "已绑定"。
   - 安全闸：拒绝绑定到 `$HOME` 或 `/`。
3. 用户拒绝 → 记录 `declinedAt`，同一 identityKey 冷却期内（30 天）提示行不再出现，
   `top_k` 召回结果不受影响（提示行不参与排序池）。
4. agent 不主动问也行：面板按钮（7.2）是备份路径。

### 7.2 面板「工作区绑定」卡片

`src/client.js` 在配置卡附近新增**默认折叠**卡片：

- 每行：displayName、identityKey 类型徽标（id/git/path）、canonicalPath、
  该 namespace 记忆条数、状态。
- ⚠ 出现"建议重绑定"（§8）的行给出「一键重绑定」按钮。
- 「写入绑定文件」按钮 = 7.1 的插件侧等价物（对当前 web 会话 cwd）。
- 手动逃生舱：文本框直接粘贴已有 identityKey（跨机器恢复 marker 场景）。

### 7.3 手动 marker

用户自己创建 `.mnemosyne-id`（含从另一台机器复制）→ 下次解析直接收养。

### 7.4 面板 HTTP 路由（现有 webServer 内）

- `GET /api/workspaces`：工作区清单 + 每 namespace 记忆计数 + 建议（含 suggestion 来源）。
- `POST /api/workspaces/rebind`：`{ entryId, newIdentityKey }`，执行 §8 指针切换。
- `POST /api/workspaces/adopt`：`{ orphanNamespace, targetCwd }`，执行 §6 收养
  （钉 namespace + 写 marker，见 H2）。

**工作区清单数据源（孤儿恢复/收养下拉框）**：不再依赖"DSH workspace 列表"这一
内置概念（DSH 源码无 workspace 枚举）。改用宿主服务一次调用——插件 `inject` 增加
`"sessionQuery"`（`@deepseek-ai/dsh-session-query` 注册名），在 webServer fiber 内
`await hostCtx.sessionQuery.listSessions()` 得到全部会话记录（轻量，只读元数据，
不加载日志），按 `record.header.cwd` 去重并取最近 `createdAt` 组装清单：

- 每条：`displayName`（basename）、完整 cwd、会话数、最近活跃时间、`fs.existsSync(cwd)` 可写状态。
- 过滤：剔除 `$HOME`、`workspace` 根等非项目路径；项目已移动的 cwd 标「疑似已移动」，用户改用 §7.2 文本框逃生舱。
- 实测（本机 241 会话 → 8 去重 cwd，全量轻量读）；实现前用宿主服务实跑一次验证（§14-1 更新为 sessionQuery）。
- 该清单同时供 `GET /api/workspaces` 与孤儿收养下拉框使用，**不扫会话文件**（`session.jsonl.zstd`），只走宿主 API。

## 8. 重绑定（rebind）= 指针切换，零数据搬迁

场景：目录移动且无 marker 无 git remote（path 身份失效）、多路径打开、机器迁移。

检测：解析出的 identityKey 未绑定，但 identity.json 中某条目 `lastSeenPath` 的
basename 或（git 场景）remote 与当前**完全匹配**（remote 要求全等，不做模糊；
仅 basename 相同时只能作为"候选"展示记忆条数供用户判断，绝不自动合并）。

动作（全部在 identity.json 内完成）：

```
新 identityKey 条目 { namespace: 沿用旧 namespace, … }  ← 指向同一数据
旧条目.supersededBy = 新条目 identityKey
```

SQLite 一行不动——因为 namespace 从未改变。v2 再考虑 namespace 级合并
（库内 `UPDATE … SET session_id=?`）应对"两条独立历史合并"需求。

## 9. 召回与写入运行时

- `resolveMemoryContext()` 是**唯一入口**，读写共用；替换现 `agentSid`/`sidFor`
  调用点（L1893、L2356、L2389、L2396、L2669 等）。
- session 模式：单查询（现行行为，换 namespace 前缀）。
- workspace 模式：`mnemosyne_recall(namespace=workspaceNs)` ∪ global 由上游过滤
  天然并入，**一次 CLI 调用即可**；session 级补充可见性不需要双查询——
  对话内记忆自动写入时同时可被 working memory 读取路径覆盖。（若后续要求
  "workspace 召回也带上本对话的 session 行"，再实现双查询+去重+重排序+截断。）
- **未绑定/不可用（安全不变量）**：workspace 模式解析不出 marker → `bound:false,
  reason:"unbound"`，`namespace:null`。调用方据此给出绑定提示（agent 提示行/面板
  按钮）并**对该请求静默禁用 workspace 召回**（返回明确提示），**绝不静默回落到
  session/global 池，也永不回落 `process.cwd()`**。清晰暴露状态，不隐式降级。
- `mnemosyne_forget`：只允许删除"当前 namespace 或 global 且本次会话可见"的行，
  工具层校验 `memory_id` 所属 namespace（读行再比对），防跨区误删。
- auto-sleep：`memoryQueueKey`（L2310）由 session 对象改为 namespace 字符串，
  阈值计数按 namespace 聚合（workspace 模式下同项目共享 working memory 池，
  整合也必须按池触发）。
- 自动记忆写入（L2471/L2479）：走 `autoWriteScope`；`workspace` 时
  `store(..., namespace)`，`session` 时维持现 `sidFor`。

## 10. 迁移（一次性、显式、面板触发）

现有安装的数据形态：`session_id='default'`（legacy 池）、`dsh_<sid>`（会话行）、
可能含无 scope 列的 `memories` 旧表（`SCOPED_TO_DEFAULT_LEGACY_SQL` L1643 已处理过一轮）。

workspace 化迁移向导（面板按钮，先决条件：目标 identityKey 已绑定）：

1. **dry-run**：列出将被重写的行数（按来源 `dsh_*` GLOB 分组）与目标 namespace。
2. **备份**：复制当前 bank 的 SQLite 文件到
   `~/.dsh/mnemosyne/backups/<bank>-<ts>.db`（单文件复制即完整快照）。
3. **执行**：`UPDATE working_memory/episodic_memory SET session_id=<wsNs> WHERE
   session_id GLOB 'dsh_*'`（仅选定来源会话，或全部）；写入 journal 记录
   （来源清单+时间戳）支持反向 `revert`。
4. 单策略：一次只迁一种来源（`default` 池 → global 的既有工具保留原位）。
5. 无归属行（无 cwd 的 legacy session 行）：不猜测，留在原地，面板可查。

迁移完成≠切换开关：`recallMode/autoWriteScope` 仍由用户显式改，防止
"迁了一半数据但召回模式没跟上"的中间态靠默认值兜底。

## 11. 文件改动清单

| 文件 | 改动 |
|---|---|
| `src/identity.js` | 新增：normalizeGitRemote / resolveIdentity / resolveMemoryContext / loadIdentityMap / marker 读写 / suggestRebind |
| `src/index.js` | Config 新增 recallMode/autoWriteScope（sessionScope 转 deprecated）；`mnemosyne_bind` 工具；inject 增 `sessionQuery`；sidFor 调用点替换；memoryQueueKey 改 namespace；面板路由 3 个（workspaces/rebind/adopt）；迁移向导 |
| `src/client.js` | 「工作区绑定」卡片 + 迁移向导 UI |
| `test/identity.test.js` | 新增（§13 第 1、2 层） |
| `test/index.test.js` | bind 工具契约、配置归一、降级链 |
| `test/integration.test.js` | workspace namespace 端到端 + 迁移 |
| `AGENTS.md` / `README*` | 工具数 5→6、配置说明 |

实现顺序：`resolveMemoryContext`/`resolveIdentity`（纯函数，先行+全测）→ index 接线
→ bind 工具 → 面板 → 迁移向导。

## 12. bank 对照（为什么不选物理隔离，Phase 3 再议）

上游 CLI 的 `MNEMOSYNE_BANK`（插件已有 `resolveActiveBank`/`resolveBankDbPath`
L102-116）是**每 bank 一个 SQLite 文件**。若用 bank 承载工作区：

- 跨项目 global 语义断裂（每 bank 独立库，global 不再全局）→ 需默认库路由+双读补丁；
- 迁移变跨文件复制，embedding BLOB 随行搬迁，复杂度高；
- bank 名 `[A-Za-z0-9_-]{1,64}` 装不下 namespace 全 hash，需截断撞名风险。

namespace 方案全部回避。bank 保留其本来的用途（数据归档/测试隔离），Phase 3 若需要
"按项目物理拆库"再加适配器，不与本方案耦合。

## 13. 测试矩阵（node:test，`pnpm test`）

1. **纯函数层**：git remote 规范化 20+ 例（ssh/https/带端口/大小写/`.git` 尾缀）；
   marker 解析（合法/注释行/非法 uuid/版本前缀不认）；向上探测（最近者胜）；
   namespace 铸造确定性（同 identityKey 恒等同 namespace）。
2. **identity.json 层**：绑定/收养/supersededBy/并发写锁/损坏文件重建。
3. **工具契约层**：`mnemosyne_bind` 幂等、拒绝 `$HOME` 与 `/`、marker 由插件写；
   recall/forget 的 namespace 校验；降级链（cwd 缺失→root session→禁用，
   断言永不出现 global 回落）。
4. **集成层**：临时库中两"会话"共享 workspace namespace 互见；session 模式互不可见；
   迁移 dry-run→执行→revert 闭环；auto-sleep 按 namespace 聚合计数。

## 14. 风险与预验证

| # | 风险 | 缓解 / 预验证 |
|---|---|---|
| 1 | `sessionQuery.listSessions()` 是否可稳定取回历史 cwd（迁移分组 + 工作区清单依据） | 实现前插件 `inject` 加 `sessionQuery` 实测一次；不可用则工作区清单退化为仅当前会话 cwd，迁移按现有 `dsh_*` 行 GLOB 全量迁 |
| 2 | 带 `session_id` 列的表是否穷尽（working/episodic 之外） | 对临时库 `SELECT name FROM sqlite_master` 断言，穷举进迁移语句清单 |
| 3 | `sessionScope=false` 旧语义（共享池=全可见）用户是否有依赖 | legacy `default` 池只读保留 + 迁出工具，不静默改变 |
| 4 | 同机多用户/多 dataDir 场景 marker 冲突 | identity.json 按 dataDir 隔离，marker 只存 uuid 不含路径，天然无冲突 |
| 5 | git remote 是 fork（同 repo 不同 fork） | remote 全等匹配下 fork 即不同身份，符合直觉；需要合并者复制 marker |

## 15. 评审记录（glm5.3，2026-08-30）

**结论：approve_with_changes。** 上游机制核验通过：`remember()` 对 scope 无枚举校验
（memory.py L313/L967 直传入库），检索过滤确为 `session_id = ? OR scope = 'global'`
（L260/L269），namespace 承载方案成立。以下按严重度排序。

### C1（critical）§10 迁移 GLOB 会误伤 v2 行

`session_id GLOB 'dsh_*'` 同样匹配 `dsh_v2_workspace_*` / `dsh_v2_session_*`。
按现稿执行，二次迁移或 v2 落库后的迁移会把 workspace 行再改写一遍（静默错误归属）。
**修法**：来源判定改为精确谓词
`session_id GLOB 'dsh_*' AND session_id NOT GLOB 'dsh_v2_*'`，
或直接从 journal/会话清单枚举来源 sid（白名单式，天然幂等）。测试矩阵 §13.4
必须加"v2 行在迁移后 session_id 不变"断言。

### H1（high）§4 "4 种组合全部合法" 不成立

`recallMode=workspace + autoWriteScope=session` 组合下，本对话的自动记忆写进
session namespace，而召回只查 workspace namespace（+global）——**自己刚说的话自己
召不回**。§9 括号里"working memory 读取路径覆盖"不成立：working-count/sleep 均按
namespace 键控，跨 namespace 不可见。
**修法**：加约束 `recallMode=workspace ⟹ autoWriteScope=workspace`
（写入层级不得窄于召回边界）；反向组合（recall=session + write=workspace）合法，
语义为"故意窄读"。schema 层校验，面板联动置灰。

### H2（high）§5.3 与 §6 矛盾：identity.json 丢失后重建路径不闭合

"绑定即冻结"依赖 identity.json 存活；"可重建"依赖重解析。但 git:/path: 来源的绑定
（手动逃生舱、面板粘贴 identityKey 路径）没有 marker，identity.json 一旦丢失，
重解析得到新 identityKey → 新 namespace → 旧数据成孤儿，且 §8 的
lastSeenPath 检测也随之失效。
**修法**：把 SQLite 库本身当第二事实源——`GET /api/workspaces` 同时扫描库中
存在记忆但 identity.json 未登记的 namespace，作为"孤儿命名空间"提供收养入口；
面板左列孤儿、右列候选工作区（§7.4 数据源，`sessionQuery.listSessions()` 去重 cwd），
用户选定后 `POST /api/workspaces/adopt`（钉 namespace + 写目标目录 marker）。
此改动同时让跨机器恢复闭环。

### M1（medium）§9 forget 校验缺实现通道

"读行再比对"需要按 id 查行的 session_id，但 CLI 无此 verb。修法：走迁移同款
python+sqlite3 直读通道（L1680 已有先例），返回行归属后再决定放行。

### M2（medium）§4 存量 `sessionScope=false` 映射未定义

现行为是共享 default 池读写；"不再新写"对这批用户是行为突变（自动记忆停止落池）。
修法：显式映射表 `false → (session, session)` 并在面板顶出既有的
default→global 迁移工具（`DEFAULT_TO_GLOBAL_SQL` 已存在），升级公告里写明。

### M3（medium）§7.1 提示行的注入位置

若提示行混入用户回合文本，会被自动记忆当 `[USER]` 内容存库。修法：注明提示行
只进 system prompt 段（prefetch 注入同层），不进对话事件流。

### L1 git remote 边界（已随简化废止）

本地路径 remote（`../other`）、多 remote（仅取 origin）、worktree（gitdir 指针）等
问题，在改用 **仅 `.mnemosyne-id` 标记**（§5.2）后整体消失——不再有 git remote 身份
推导，故 normalizeGitRemote/路径兜底均不再需要。此项标记为"采纳简化后废止"。

### 评审确认的强项

- rebind 指针切换零数据搬迁，与"namespace 冻结"配合正确；
- 迁移备份用单文件 SQLite 快照，足够；
- bank 推迟 Phase 3 的论证成立；
- "永不回落 global/process.cwd()" 降级链方向正确（现表述为"仅标记、不隐式降级"）。

### 评审后行动项

1. §10 采纳 C1 精确谓词；2. §4 采纳 H1 约束并改"4 种组合"表述；
3. §6/§7.4 采纳 H2 孤儿扫描；4. M1/M2/M3/L1 按上文补写（L1 已随仅标记方案废止）。
kimi3 评审未执行成（模型不在本机目录，注册探测后用户改由 glm5.3 亲审，本节即结果）。
