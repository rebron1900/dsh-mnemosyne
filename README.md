# dsh-mnemosyne

> [Mnemosyne](https://github.com/mnemosyne-oss/mnemosyne) 记忆层在 [DeepSeek Harness](https://github.com/deepseek-ai) 中的插件 — 本地优先、SQLite 支持的跨会话记忆。

`dsh-mnemosyne` 是 [`@mnemosyne-oss/pi-mnemosyne`](https://github.com/mnemosyne-oss/Pi-mnemosyne) 的 DSH 移植版：把 remember / recall / forget / stats / sleep 五个记忆工具和一个 agent 技能注册进 DSH profile，全部操作代理到本地 `mnemosyne` CLI。

## 功能

- **五个原生工具**：`mnemosyne_remember` / `mnemosyne_recall` / `mnemosyne_forget` / `mnemosyne_stats` / `mnemosyne_sleep`
- **内嵌技能**：`mnemosyne` 技能随插件自动注册（runtime skill），无需复制文件
- **本地优先**：数据全部留在本机 SQLite，无云、无 API key
- **零配置**：装完即用；`cli` / `defaultTopK` / `timeoutMs` 可通过组合配置覆盖

## 前置条件

```bash
pip install mnemosyne-memory   # 提供 mnemosyne CLI
```

## 安装

```bash
dsh plugin --profile web add dsh-mnemosyne
# 重启 profile 生效
```

开发期本地链接：

```bash
cd ~/workspace/projects/active/dsh-mnemosyne
dsh plugin --profile web add ./.
```

## 工具

| 工具 | 用途 | CLI 映射 |
|------|------|----------|
| `mnemosyne_remember` | 存储一条记忆（可带 source / importance） | `mnemosyne store <content> [source] [importance]` |
| `mnemosyne_recall` | 按语义相似度检索记忆 | `mnemosyne recall <query> <top_k>` |
| `mnemosyne_forget` | 按 ID 删除记忆 | `mnemosyne delete <id>` |
| `mnemosyne_stats` | 查看数据库统计 | `mnemosyne stats` |
| `mnemosyne_sleep` | 整合压缩旧记忆为长期摘要 | `mnemosyne sleep` |

## 设计与实现方案

完整分析（Pi-mnemosyne 走读、DSH 扩展体系、概念映射与实现决策）见 [docs/design.md](docs/design.md)。

## 开发

```bash
pnpm install
pnpm test        # node --test
```

## License

MIT
