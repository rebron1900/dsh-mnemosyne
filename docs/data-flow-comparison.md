# dsh-mnemosyne 记忆数据流对比分析

> 分析日期：2026-03-15
>
> 对比基准：Mnemosyne 官方 [Data Flow](https://docs.mnemosyne.site/architecture/data-flow)、上游 `mnemosyne-oss/mnemosyne` `main` 分支的核心实现与 Hermes provider，以及当前工作区 `src/index.js`。当前工作区包含未提交的 Hermes 对齐改动，本文按读取时的最新文件分析。

## 结论摘要

`dsh-mnemosyne` 没有重写 BEAM 的核心写入、检索和整合算法，而是把 DSH 生命周期桥接到上游 `Mnemosyne` / `BeamMemory`。因此核心链路总体一致：写入进入 Working Memory，召回走上游混合检索，sleep 走上游 consolidation。

真正的差异集中在 BEAM 前后的 adapter 层：DSH 如何截取回合、如何映射 session、何时自动召回、如何过滤候选、何时 sleep。最新改动已经接通 Hermes 风格的结构化 prefetch，但仍不是完整 Hermes provider 等价实现。

当前判断：

- **核心 BEAM 数据流：高一致性。** DSH 直接调用上游，不应在插件层复制 ranking、indexing 或 consolidation。
- **基础 Hermes 生命周期：基本一致。** system prompt、post-turn sync、pre-step prefetch、user-only 默认同步、会话作用域均已覆盖。
- **Hermes prefetch：部分一致。** 已有 overfetch、topic gate、raw/assistant 抑制和去重，但算法细节和 profile/identity/model-slot 分支仍有差异。
- **自动 sleep：触发语义仍有差异。** DSH 与 Hermes 一样每 10 个 durable turn 检查一次，并在 `session/disposed` 做收尾；但 DSH 仍以 working count 阈值为入口，Hermes 还会由上游判断 TTL/2 eligible rows。
- **文档状态。** README、`docs/design.md`、面板文案已同步到自动记忆默认开启、session scope 默认开启的实现；本文件保留明确的上游差异清单，避免把近似实现误称为完整 parity。

## 一、官方核心数据流

### 写入路径

官方 Data Flow 描述：

```text
Agent Input
  -> remember(content, source, importance, metadata)
  -> Working Memory (SQLite raw entry)
  -> FTS5 index
  -> sleep()
  -> 按 source 分组、LLM 或 AAAK 摘要
  -> Episodic Memory
  -> vector + FTS5 index
```

上游当前 `Mnemosyne.remember()` 还包含网页简图未展开的步骤：统一 write filter、二进制内容清理、日期/时长 metadata、BEAM working 写入、legacy 表双写、可选 embedding，以及 `extract_entities` / `extract`。来源：[core/memory.py](https://github.com/mnemosyne-oss/mnemosyne/blob/main/mnemosyne/core/memory.py)、[core/beam.py](https://github.com/mnemosyne-oss/mnemosyne/blob/main/mnemosyne/core/beam.py)。

### 读取路径

官方 Data Flow 描述：

```text
query
  -> recall()
  -> query embedding
  -> sqlite-vec + FTS5 并行检索
  -> rank fusion
  -> ranked results
```

网页给出的简化公式是 `vec*0.5 + fts*0.3 + importance*0.2`，再乘 recency decay。实际权重、lexical gate、polyphonic/enhanced recall 等会随上游版本和配置变化，因此插件应把上游返回的 `score` 当作最终检索依据，不在 JS 中重做 BEAM ranking。

### consolidation 路径

官方网页写的是：选择早于 TTL/2 的 working rows，按 source 分组，LLM/AAAK 摘要，写入 episodic 并建索引，然后 eviction 原 working rows。

但上游 `main` 已改为 **additive consolidation**：eligible rows 先以 `consolidated_at` 原子 claim，创建 episodic summary 后保留 working originals；原行继续可召回，并通过 `summary_of` 保留来源关系。网页的“删除原行”对应较旧语义。DSH 只是调用上游 `sleep()`，实际行为由安装版本决定，不能把两者差异算作插件 bug。来源：[Data Flow](https://docs.mnemosyne.site/architecture/data-flow)、[core/beam.py](https://github.com/mnemosyne-oss/mnemosyne/blob/main/mnemosyne/core/beam.py)、[architecture.md](https://github.com/mnemosyne-oss/mnemosyne/blob/main/docs/architecture.md)。

## 二、DSH 当前实际流程

### 自动回合链路

```text
DSH user/message
  -> 只接受 source.kind=user
  -> 暂存完整 user 内容；turn/end 按 syncTurnUserLimit 截断

DSH assistant/message
  -> 暂存完整 assistant 内容；turn/end 按 syncTurnAssistantLimit 截断

turn/end
  -> 读取 config.yaml sync_roles
  -> user: importance 0.5；assistant: 0.15
  -> sessionScope=true 时调用 session helper
  -> Mnemosyne.remember(... extract_entities=True)
  -> Working Memory / FTS5 / 上游写过滤和去重
   -> 每 10 个 durable turn 检查 working count；session/disposed 强制收尾
  -> 达到 sleep_threshold 后调用上游 sleep()
```

### 自动召回链路

```text
agent/pre-step
  -> 从 decision.messages 找最后一个 source.kind=user 的真实用户消息
  -> 同一 turn/query 去重
  -> recall-json，候选数 max(topK*2, 10)
  -> selectPrefetchRows() 二次门控与语义去重
  -> formatPrefetchRows()
  -> 作为 source.kind=plugin 的 user message 注入
```

该注入消息不会被 auto-sync 再次存储，能阻断“召回内容 -> 再入库 -> 再召回”的反馈循环。

### 手动工具链路

- `mnemosyne_remember`：显式写入 session/global scope；调用上游 wrapper，保留 write filter、trust tier 默认与 entity extraction。
- `mnemosyne_recall`：返回较宽的原始上游 recall 结果，不套静默注入的保守 gate。这一分离是合理的：显式查询与无感 prompt 注入风险不同。
- `mnemosyne_forget`：session scope 下只允许当前 session 或 global 行；global 仍可被任意 session 删除，沿用上游语义。
- `mnemosyne_sleep`：sessionScope 开启时显式工具只整合当前 session，自动 sleep 也只处理当前 DSH session；需要全库整合时使用显式 CLI/管理入口。
- `mnemosyne_stats`：全库视角，不按 DSH session 切分。

## 三、逐阶段对比

| 阶段 | 官方 / Hermes | dsh-mnemosyne | 判断 |
|---|---|---|---|
| Agent 激活 | provider 被选中即提供 prompt、prefetch、sync | 当前默认 `promptSection/autoSync/autoPrefetch=true` | 基本一致 |
| 回合采集 | `sync_turn(user, assistant)`，默认 user-only | DSH 事件收集后在 `turn/end` 写入，`sync_roles` 控制角色 | 一致，宿主事件模型不同 |
| 内容格式 | Hermes 写 `[USER] ...` / `[ASSISTANT] ...` | 当前 DSH auto-sync 同样写入角色前缀，source=`conversation` | 一致 |
| 长度限制 | Hermes 使用可配置 `_sync_turn_*_limit()`，默认 500/800、`0` 不截断 | DSH 使用对应 DSH settings，默认值和 `0` 语义一致 | 一致；DSH 额外保证 Unicode code point 安全 |
| identity capture | user sync 后 `_capture_identity_signals()` | DSH 未调用 provider identity capture | **缺失** |
| 写过滤 | provider `_should_filter` + core `should_remember` | core filter 生效；插件桥接 ignore/write classifier | 核心一致 |
| 工作记忆写入 | `remember(... extract_entities=True)` | session helper 同样调用 wrapper 并开启 entity extraction | 一致 |
| session scope | Hermes provider/gateway session 映射 | DSH 根 session 派生稳定 sid，子代理共享根 sid，另有 global | 目标一致，映射策略不同 |
| 自动 prefetch | profile 化 overfetch + gate + source quality + dedup | overfetch + 本地 gate + dedup | 部分一致 |
| identity 常驻注入 | 当前 Hermes 对 active session identity rows 每 turn 前置注入 | 无 | **缺失** |
| canonical model slots | Hermes 按 query overlap 注入 user/workflow/project/agent slots | 无 | **缺失** |
| 多 prefetch source | Hermes profile 可组合 bank 和注册 source | 只支持 bank recall | **缺失** |
| temporal recall 参数 | Hermes general profile传 temporal weight/halflife | `recall-json` 仅传 query/top_k | **有差异** |
| topic signal | Hermes 取 `max(keyword, fts, dense)`，fact/entity match 至少 0.2 | DSH 用 query/content token overlap + keyword score | **语义不等价** |
| gate 阈值 | Hermes raw 0.18、distilled 0.08，另有 min score/importance | DSH 只要求 token signal > 0 或 keyword > 0.05 | **更宽松** |
| source quality | Hermes distilled 1.12、raw 0.72、USER 0.68、IDENTITY 0.8，assistant 排除 | DSH raw 统一乘 0.9，assistant 排除 | **更宽松** |
| sleep 触发 | Hermes 每 10 turn `_maybe_auto_sleep()` | DSH 每 10 durable turn 按 working count >= threshold，`session/disposed` 强制收尾 | 入口仍不同 |
| sleep 核心 | 上游 TTL/2、source grouping、LLM/AAAK、episodic | 直接调用上游 | 一致 |
| consolidation 后原行 | 官网称 eviction；上游 main 已 additive 保留 | 随安装的上游版本 | 非插件差异 |

## 四、主要风险与优先级

### P0：没有发现绕开 BEAM 核心写入/检索/整合的结构性错误

session helper 构造 `Mnemosyne` wrapper，而不是直接手写 Working/Episodic SQL；因此 write filter、去重、实体提取与上游 sleep 都仍在主链路上。迁移脚本直连 SQLite 属于 scope 迁移管理面，不是日常记忆流。

### P1：Hermes prefetch 门控仍不是 canonical parity

当前函数明确标为 Hermes-inspired DSH gate，仍只是近似：

- topic signal 改成 JS token overlap，未使用上游 `fts_score` / `dense_score` / fact/entity match；
- 未执行 Hermes `min_score=0.20 OR min_importance=0.65` 条件；
- raw signal 阈值显著更低；
- source quality 权重不同；
- dedup 只有 Jaccard 0.72，缺少 containment 0.86；
- recall 未传 temporal profile 参数。

影响是 silent injection 更容易混入弱相关 raw conversation，也可能漏掉“向量/实体相关但表面词不重合”的记忆。建议二选一：严格移植当前 upstream provider 的纯函数与 profile 默认值，或明确命名为 `selectDshPrefetchRows`，不宣称 canonical parity。

### P1：缺失 identity 和 canonical model context 两条 Hermes 分支

当前 Hermes provider 不只做普通 bank recall：

- active session 的 identity memories 每 turn 确定性注入，不依赖 query；
- canonical model slots 按 query overlap 注入；
- profile 可合并额外 prefetch sources。

DSH 只有普通 bank recall，所以“支持 Hermes provider 基础自动化”成立，“完整 Hermes 记忆上下文行为等价”不成立。若 DSH 当前目标只是偏好/项目事实记忆，可暂不实现，但文档需明确范围。

### P1：identity signal 的写入侧也缺失

Hermes `sync_turn()` 在保存 user turn 后调用 `_capture_identity_signals(user_content)`；DSH 已保存带 `[USER]` / `[ASSISTANT]` 前缀的 transcript，但没有调用 provider identity capture。这不仅少一个增强功能，还解释了为何读侧没有 identity rows 可常驻注入。identity 若纳入目标，应成对实现 capture + deterministic prefetch，不能只补一侧。

### P2：兼容默认截断仍可能丢失中段和尾部

DSH 现已复用 Hermes 的 500/800 默认值与 `0` 不截断语义，并在 `turn/end` 对配置做当轮快照。但该机制仍是前缀截断：默认配置下，重要信息若位于限制之后仍不会进入 Working Memory。用户可把对应 limit 设为 `0` 完整保存；这不会自动分块或摘要，也会增加 SQLite、召回和进程参数开销。

### P2：自动 sleep 的 count threshold 与 TTL eligibility 不是同一概念

DSH 的 working count 包括尚未达到 TTL/2 的新行；即使每 10 个 turn 才检查，仍可能在没有 eligible rows 时调用上游并由其 no-op。Hermes 也可能 no-op，但 provider 会进一步依赖上游 eligibility。当前实现已通过每 session cadence/backoff 降低空跑频率，后续可改为直接查询 eligible unconsolidated count。

### P1：默认值切换需要迁移提示，但当前实现已兼容无 session envelope 的手动工具

当前代码将 auto memory 和 sessionScope 从 false 改为 true。已有 `default` rows 在 session-scoped recall 下不可见，因此面板和文档提供迁移到 `global` 的入口；显式设置为 false 的旧配置仍保持关闭。自动 sync/prefetch 会增加额外写入和每步 helper 调用，这是与 Hermes 自动 provider 一致但有运行成本的行为。

### P3：官方网页与实际上游版本应在文档中区分

当前文档已将 consolidation 描述为由安装的 Mnemosyne 版本决定；上游 main 通常以 `consolidated_at` 标记并保留 originals，但最低兼容版本仍应在发布时固定。

## 五、建议实施顺序

1. **先固定兼容目标和上游版本。** 在 `package`/setup 逻辑中记录或约束最低 Mnemosyne 版本；测试应以该版本为契约，不以可能滞后的网页细节为唯一依据。
2. **决定 prefetch parity 等级。** 若要完整 Hermes parity，逐项移植 profile thresholds、source quality、topic signal、temporal kwargs、dedup containment；当前实现应继续明确为受限近似。
3. **补 identity capture + deterministic identity injection。** 作为独立可配置能力实现和测试，确保严格 session scope。
4. **把 eligible sleep count 暴露为上游调用能力。** 继续保持每 session cadence/backoff，避免新 working rows 多时空跑。
5. **维护 default -> global 升级迁移。** 新默认采用 Hermes 语义，既有安装通过面板迁移 legacy rows；保留显式 false 配置的兼容性。

## 六、建议测试矩阵

- auto-sync user 写入内容带角色标记、importance 0.5、scope=session、entity extraction 生效。
- `sync_roles=assistant` 时 assistant row 可入库，但永不进入 silent prefetch。
- vector/dense 相关、零 lexical overlap 的结果按目标 parity 正确进入或拒绝。
- 高 importance、零 topic signal 的结果不进入 silent prefetch。
- raw conversation 使用更高 signal threshold；distilled summary 使用较低 threshold。
- identity rows 对 generic query 仍注入，且绝不跨 DSH root session。
- sleep count 很高但没有 TTL/2 eligible rows 时不反复 spawn consolidation。
- 旧安装升级后 legacy `default` rows 不会无提示消失。
- 针对最低支持 Mnemosyne 版本验证 additive/eviction 差异和 `recall-json` 字段契约。

## 参考来源

- [Mnemosyne Data Flow](https://docs.mnemosyne.site/architecture/data-flow)
- [BEAM Architecture Overview](https://docs.mnemosyne.site/architecture/beam-overview)
- [Mnemosyne upstream architecture](https://github.com/mnemosyne-oss/mnemosyne/blob/main/docs/architecture.md)
- [Mnemosyne wrapper implementation](https://github.com/mnemosyne-oss/mnemosyne/blob/main/mnemosyne/core/memory.py)
- [BEAM implementation](https://github.com/mnemosyne-oss/mnemosyne/blob/main/mnemosyne/core/beam.py)
- [Canonical Hermes provider](https://github.com/mnemosyne-oss/mnemosyne/tree/8e6c010bc823b7833061f0ee53c2a73a9dd6dd24/integrations/hermes/src/mnemosyne_hermes)
- [Legacy Hermes memory provider](https://github.com/mnemosyne-oss/mnemosyne/tree/main/hermes_memory_provider)
- [Hermes provider parity tests](https://github.com/mnemosyne-oss/mnemosyne/blob/main/tests/test_hermes_provider_parity.py)
- [Sync roles tests](https://github.com/mnemosyne-oss/mnemosyne/blob/main/tests/test_sync_roles.py)
