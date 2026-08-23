# dsh-mnemosyne

English | [简体中文](./README.zh-CN.md)

> A [DeepSeek Harness](https://github.com/deepseek-ai) plugin for [Mnemosyne](https://github.com/mnemosyne-oss/mnemosyne) — local-first, SQLite-backed cross-session memory.

## About Mnemosyne

[Mnemosyne](https://github.com/mnemosyne-oss/mnemosyne) is a zero-cloud, SQLite-backed, local-first AI memory system. One `pip install`, one SQLite file, no external services required. It uses a **BEAM** (Bilevel Episodic-Associative Memory) architecture:

- **Working Memory** — Hot context tier, auto-injected before LLM calls, TTL-based eviction
- **Episodic Memory** — Long-term storage with sqlite-vec + FTS5 hybrid search (50% vector similarity + 30% FTS5 rank + 20% importance)
- **TripleStore** — Temporal knowledge graph with version chains

Mnemosyne supports MCP, Python SDK, and multiple agent frameworks (Claude Code, Cursor, Codex, OpenWebUI, Pi, etc.). This plugin integrates it into DSH.

## About Pi-mnemosyne

This plugin is ported from [`@mnemosyne-oss/pi-mnemosyne`](https://github.com/mnemosyne-oss/pi-mnemosyne) — the official [Pi coding agent](https://pi.dev/) extension for Mnemosyne. Pi-mnemosyne contains no memory logic itself: all capabilities live in the `mnemosyne` CLI (`pip install mnemosyne-memory`), and the plugin acts as a stateless proxy between tool schemas and CLI arguments. The port to DSH preserves this architecture while adding a settings panel, automatic CLI installation, config management, and turn-end auto-consolidation.

## Features

- **Five native tools**: `mnemosyne_remember` / `mnemosyne_recall` / `mnemosyne_forget` / `mnemosyne_stats` / `mnemosyne_sleep`
- **Embedded skill**: The `mnemosyne` skill auto-registers with the plugin, guiding agents on when to store/retrieve memories
- **Settings panel**: A dedicated "Mnemosyne" entry in DSH Settings with CLI status, memory stats, one-click install/test, and a config form
- **Auto-install CLI**: The panel's Setup button runs `uv tool install mnemosyne-memory` and fills `config.yaml` defaults
- **Data isolation**: SQLite DB and `config.yaml` live under `~/.dsh/mnemosyne`, never touching `~/.hermes`
- **Config sync**: The panel reads actual values from the flat `config.yaml`; empty fields show default placeholders; saving triggers `mnemosyne config reload`
- **Reset to defaults**: The panel footer resets all managed config keys to Mnemosyne upstream defaults
- **Auto-consolidation**: On each `turn/end`, checks working memory count and runs `mnemosyne sleep` when the threshold is met
- **Automatic memory (opt-in)**: Three optional features that automate memory operations — all disabled by default, preserving manual-only behavior:
  - **Prompt section** — Injects a `# Mnemosyne Memory` header into the system prompt so the model knows memory is available
  - **Auto-sync** — Automatically stores user/assistant messages to Mnemosyne after each turn, so conversation context persists without manual `mnemosyne_remember` calls
  - **Auto-prefetch** — Recalls relevant memories before each model step and injects them into the conversation, so the model sees prior context without calling `mnemosyne_recall`

## Installation

```bash
dsh plugin --profile web add dsh-mnemosyne
# After restarting the profile, open Settings > Mnemosyne and click Setup to install the CLI
# Or manually: uv tool install mnemosyne-memory
```

<details>
<summary>Install from GitHub (without npm)</summary>

```bash
git clone https://github.com/rebron1900/dsh-mnemosyne.git
dsh plugin --profile web add ./dsh-mnemosyne
```

</details>

> The Setup button requires `uv` on PATH. If you don't have uv yet:
> ```bash
> curl -LsSf https://astral.sh/uv/install.sh | sh
> ```

## Configuration

Configuration comes from two sources: the plugin's own DSH settings (`~/.dsh/settings.yaml` under the `mnemosyne:` namespace) and Mnemosyne's flat `~/.dsh/mnemosyne/config.yaml`. The panel shows config.yaml values first; missing values display default placeholders.

| Group | Fields | Source |
|-------|--------|--------|
| Plugin | `cli` / `defaultTopK` / `timeoutMs` / `dataDir` | DSH settings / `cordis.patch.yml` |
| Embedding | `noEmbeddings` / `embeddingModel` / `embeddingDim` / `embeddingApiUrl` / `embeddingApiKey` | config.yaml `no_embeddings` / `embedding_*` |
| LLM | `llmEnabled` / `llmBaseUrl` / `llmApiKey` / `llmModel` / `llmTimeout` | config.yaml `llm_*` |
| Recall | `polyphonicRecall` | config.yaml `polyphonic_recall` |
| Working Memory | `wmMaxItems` / `wmTtlHours` | config.yaml `wm_*` |
| Working Memory | `autoSleep` / `sleepThreshold` / `ignorePatterns` | config.yaml `auto_sleep_enabled` / `sleep_threshold` / `ignore_patterns` |
| Automatic Memory | `promptSection` / `autoSync` / `autoPrefetch` / `prefetchTopK` / `prefetchMinQueryLen` | DSH settings / `cordis.patch.yml` |

> **Note**: The Automatic Memory fields are DSH-side config (saved via the Settings panel, not written to `config.yaml`). They take effect at runtime via the settings watcher — no DSH restart needed.

Saving writes to the corresponding config file and runs `mnemosyne config reload`. "Reset to Defaults" restores all panel-managed keys to Mnemosyne upstream defaults; additional config can be edited directly in `~/.dsh/mnemosyne/config.yaml`. Most settings hot-reload except `vec_type` and other startup-bound options.

## Architecture

```
┌──────────────────────────────────────┐
│           DSH Agent Session          │
│  (tools + skill + session/event +    │
│   agent/pre-step + systemPrompt)     │
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

The plugin itself contains no memory logic — it's a stateless proxy from DSH tool schemas to `mnemosyne` CLI arguments, consistent with the Pi-mnemosyne architecture.

## Design Document

See [docs/design.md](docs/design.md).

## Development

```bash
pnpm install
pnpm test        # node --test (65 tests: unit + integration + client)
```

## License

MIT