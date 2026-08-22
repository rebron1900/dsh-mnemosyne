# dsh-mnemosyne

> [Mnemosyne](https://github.com/mnemosyne-oss/mnemosyne) 记忆层在 [DeepSeek Harness](https://github.com/deepseek-ai) 中的插件 — 本地优先、SQLite 支持的跨会话记忆。

## 关于 Mnemosyne

[Mnemosyne](https://github.com/mnemosyne-oss/mnemosyne) 是一个零云依赖、SQLite 支持的本地优先 AI 记忆系统。一个 `pip install`，一个 SQLite 文件，无需外部服务。它采用 **BEAM**（Bilevel Episodic-Associative Memory）架构：

- **工作记忆**（Working Memory）— 热上下文层，自动注入 LLM 调用前，基于 TTL 淘汰
- **情景记忆**（Episodic Memory）— 长期存储，sqlite-vec + FTS5 混合检索（50% 向量相似度 + 30% FTS5 排序 + 20% 重要性）
- **知识三元组**（TripleStore）— 带版本链的时序知识图谱

Mnemosyne 支持 MCP、Python SDK 及多种 agent 框架（Claude Code、Cursor、Codex、OpenWebUI、Pi 等）。本插件是其在 DSH 中的集成。

## 关于 Pi-mnemosyne

本插件移植自 [`@mnemosyne-oss/pi-mnemosyne`](https://github.com/mnemosyne-oss/pi-mnemosyne) — Mnemosyne 官方的 [Pi coding agent](https://pi.dev/) 扩展。Pi-mnemosyne 本身不含任何记忆逻辑：所有能力都在 `mnemosyne` CLI（`pip install mnemosyne-memory`）里，插件只做"工具 schema ↔ CLI 参数"的无状态代理。移植到 DSH 时保持这一架构不变，并增加了设置面板、CLI 自动安装、配置管理和会话收尾自动整合。

## 功能

- **五个原生工具**：`mnemosyne_remember` / `mnemosyne_recall` / `mnemosyne_forget` / `mnemosyne_stats` / `mnemosyne_sleep`
- **内嵌技能**：`mnemosyne` 技能随插件自动注册，指导 agent 何时存储/检索记忆
- **设置面板**：DSH Settings 左侧独立 "Mnemosyne" 入口，含 CLI 状态、记忆统计、一键安装/测试、配置表单
- **自动安装 CLI**：面板 Setup 按钮用 `uv tool install mnemosyne-memory` 自动装好，并补齐 `config.yaml` 默认值
- **数据隔离**：SQLite 库与 `config.yaml` 存于 `~/.dsh/mnemosyne`，不碰 `~/.hermes`
- **配置同步**：面板从扁平的 `config.yaml` 读取 mnemosyne 实际配置，空值字段显示默认值 placeholder；保存后自动执行 `mnemosyne config reload`
- **默认值恢复**：面板底部支持将面板管理的配置恢复为 mnemosyne 默认值
- **自动整理**：每次 `turn/end` 检查工作记忆数量，达到阈值时自动执行 `mnemosyne sleep`

## 安装

```bash
dsh plugin --profile web add dsh-mnemosyne
# 重启 profile 后，打开 Settings > Mnemosyne，点 Setup 自动安装 CLI
# 或手动：uv tool install mnemosyne-memory
```

> Setup 按钮需要 PATH 上有 `uv`。如果尚未安装 uv：
> ```bash
> curl -LsSf https://astral.sh/uv/install.sh | sh
> ```

## 配置

配置有两个来源：插件自身的 DSH settings（`~/.dsh/settings.yaml` 的 `mnemosyne:` 命名空间）以及 mnemosyne 的扁平 `~/.dsh/mnemosyne/config.yaml`。面板优先显示 config.yaml 中的实际值；缺少值时显示默认值 placeholder。

| 分组 | 字段 | 配置来源 |
|------|------|----------|
| 插件 | `cli` / `defaultTopK` / `timeoutMs` / `dataDir` | DSH settings / `cordis.patch.yml` |
| Embedding | `noEmbeddings` / `embeddingModel` / `embeddingDim` / `embeddingApiUrl` / `embeddingApiKey` | config.yaml `no_embeddings` / `embedding_*` |
| LLM | `llmEnabled` / `llmBaseUrl` / `llmApiKey` / `llmModel` / `llmTimeout` | config.yaml `llm_*` |
| 召回 | `polyphonicRecall` | config.yaml `polyphonic_recall` |
| 工作记忆 | `wmMaxItems` / `wmTtlHours` | config.yaml `wm_*` |
| 工作记忆 | `autoSleep` / `sleepThreshold` / `ignorePatterns` | config.yaml `auto_sleep_enabled` / `sleep_threshold` / `ignore_patterns` |

面板保存会写入对应配置文件，并执行 `mnemosyne config reload`。底部"恢复默认配置"会将面板管理的配置恢复为 mnemosyne 默认值；更多未展示的配置可以直接编辑 `~/.dsh/mnemosyne/config.yaml`。除 `vec_type` 等启动时确定的配置外，大部分配置支持热加载。

## 架构

```
┌──────────────────────────────────────┐
│           DSH Agent Session          │
│  (tools + skill + session/event)     │
└──────────────┬───────────────────────┘
               │ execFile (no shell)
┌──────────────▼───────────────────────┐
│         mnemosyne CLI                │
│  store / recall / delete /           │
│  stats / sleep / config              │
└──────────────┬───────────────────────┘
               │
┌──────────────▼───────────────────────┐
│      ~/.dsh/mnemosyne/               │
│  ├── mnemosyne.db (SQLite)           │
│  │   ├── Working Memory (hot tier)   │
│  │   ├── Episodic Memory (long-term) │
│  │   └── TripleStore (temporal KG)   │
│  └── config.yaml (flat key: value)   │
└──────────────────────────────────────┘
```

插件本身不含记忆逻辑——它是 DSH 工具 schema 到 `mnemosyne` CLI 参数的无状态代理，与 Pi-mnemosyne 保持一致的架构。

## 设计与实现方案

见 [docs/design.md](docs/design.md)。

## 开发

```bash
pnpm install
pnpm test        # node --test（36 例：单元 + 集成 + client）
```

## License

MIT