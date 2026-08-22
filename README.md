# dsh-mnemosyne

> [Mnemosyne](https://github.com/mnemosyne-oss/mnemosyne) 记忆层在 [DeepSeek Harness](https://github.com/deepseek-ai) 中的插件 — 本地优先、SQLite 支持的跨会话记忆。

`dsh-mnemosyne` 把 remember / recall / forget / stats / sleep 五个记忆工具和一个 agent 技能注册进 DSH profile，并提供设置面板。所有数据与配置落在 `~/.dsh/mnemosyne`。

## 功能

- **五个原生工具**：`mnemosyne_remember` / `mnemosyne_recall` / `mnemosyne_forget` / `mnemosyne_stats` / `mnemosyne_sleep`
- **内嵌技能**：`mnemosyne` 技能随插件自动注册
- **设置面板**：DSH Settings 左侧独立 "Mnemosyne" 入口，含 CLI 状态、记忆统计、一键安装/测试
- **自动安装 CLI**：面板 Setup 按钮用 `uv tool install mnemosyne-memory` 自动装好
- **数据隔离**：SQLite 库与 `config.yaml` 存于 `~/.dsh/mnemosyne`，不碰 `~/.hermes`
- **配置透传**：embedding 模型/维度、LLM 后端、召回调优、工作记忆阈值等通过环境变量透传给 CLI

## 安装

```bash
dsh plugin --profile web add dsh-mnemosyne
# 重启 profile 后，打开 Settings > Mnemosyne，点 Setup 自动安装 CLI
# 或手动：uv tool install mnemosyne-memory
```

## 配置

配置通过 DSH settings（`~/.dsh/settings.yaml` 的 `mnemosyne:` 命名空间）或 profile 的 `cordis.patch.yml` 覆盖。面板字段对应 `Config` schema：

| 分组 | 字段 | 透传给 |
|------|------|--------|
| 插件 | `cli` / `defaultTopK` / `timeoutMs` / `dataDir` | dataDir → `MNEMOSYNE_DATA_DIR` |
| Embedding | `noEmbeddings` / `embeddingModel` / `embeddingDim` / `embeddingApiUrl` / `embeddingApiKey` | `MNEMOSYNE_*` |
| LLM | `llmEnabled` / `llmBaseUrl` / `llmApiKey` / `llmModel` / `llmTimeout` | `MNEMOSYNE_LLM_*` |
| 召回 | `polyphonicRecall` | `MNEMOSYNE_POLYPHONIC_RECALL` |
| 工作记忆 | `wmMaxItems` / `wmTtlHours` / `autoSleep` / `sleepThreshold` / `ignorePatterns` | env / config.yaml |

## 设计与实现方案

见 [docs/design.md](docs/design.md)。

## 开发

```bash
pnpm install
pnpm test        # node --test（24 例：单元 + 集成 + client）
```

## License

MIT
