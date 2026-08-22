# dsh-mnemosyne

## 项目概述

- **描述**：DeepSeek Harness（DSH）的 Mnemosyne 记忆插件 — Profile Bundle 形态，注册 5 个记忆工具与 1 个内嵌技能，提供 Settings 独立面板（CLI 状态/一键安装/测试），数据落 `~/.dsh/mnemosyne`，CLI 通过 `uv tool install` 自动安装。移植自 `mnemosyne-oss/Pi-mnemosyne`。
- **技术栈**：纯 ESM JavaScript + JSDoc；host 端用 `@deepseek-ai/dsh-tools`/`dsh-settings`/`schemastery`，client 端用 `window.__ModuleLoader__.load` 格式 + `React.createElement`（无构建链）。
- **运行时**：Node.js ≥ 20（DSH 宿主进程内运行）
- **仓库地址**：本地项目，暂未建远端

## 目录结构

```text
dsh-mnemosyne/
├── cordis.patch.yml   # bundle patch 层：把 mnemosyne 插件行插入 profile 组合树
├── src/index.js       # cordis host 插件：Config/buildEnv/apply → 5 工具 + skill + settings + harness RPC（setup/diagnose/testConnection）
├── src/client.js      # cordis client 插件：Settings 左侧独立 Mnemosyne 入口（状态卡/安装/测试）
├── test/              # node:test：index.test.js（单元）+ integration.test.js（真实 CLI）+ client.test.js（客户端模块）
├── docs/design.md     # 实现方案（Pi-mnemosyne 分析、DSH 扩展体系、概念映射、CLI 契约、面板/自动安装/.dsh 落盘）
└── package.json       # dsh.bundle 声明是 bundle 身份的关键
```

## 环境与依赖

- 包管理器：pnpm
- 环境变量：无（CLI 路径等走 Config）；依赖 PATH 上的 `mnemosyne` 可执行文件
- 安装命令：`pnpm install`
- 安装到 DSH：`dsh plugin --profile web add <npm 包名或本地路径>` 后重启 profile

## 代码规范

- ESM（`"type": "module"`），命名导出：`name` / `inject` / `Config` / `apply` / `SKILL`
- 服务访问遵循宿主约定：硬依赖写进 `inject` 导出，软依赖用 `ctx.get()` 判空；一切注册放在 `ctx.effect()` / `sctx.effect()` 内，保证 fiber 销毁时自动清理
- 不提交生成目录、依赖目录、密钥或本地环境文件。

## 命名约定

- 文件小写连字符；工具名 `mnemosyne_<verb>`；effect 标签 `"mnemosyne: <what>"`

## Git 规范

- 默认分支：`main`
- 分支命名：`feature/<name>`、`fix/<name>`
- Commit：Conventional Commits（feat/fix/chore/docs/test）

## 测试

- 测试框架：node:test（stdlib，零额外依赖）
- 执行命令：`pnpm test`
- 单元层 `test/index.test.js`（12 例，无需 CLI）：参数组装、5 个工具注册契约、skill 注册、render 输出、manifest（dsh.bundle 与 patch 行）、CLI 缺失/非零退出路径、`buildEnv` 只注入显式字段且总钉 dataDir
- 集成层 `test/integration.test.js`（9 例，需真实 `mnemosyne` CLI，否则自动 skip）：对照主仓库 `tests/test_cli_*.py` 契约，用 `MNEMOSYNE_DATA_DIR`+`MNEMOSYNE_NO_EMBEDDINGS=1` 隔离临时库，跑 remember/recall/forget/stats/sleep 全链路 + 端到端闭环 + apply() 的 execute() 闭包直驱真实 CLI
- 客户端层 `test/client.test.js`（3 例）：stub `window.__ModuleLoader__` + mock react，验证 client 模块导出 apply/name/inject、apply 注册 locale 字典与 `settings.section` slot（id=mnemosyne, order=50）、render 返回面板组件元素
- CLI 契约实测：`store`→`Stored: <16hex>`；`recall` 命中含 `ID:/Content:/Score:`、未命中仅 `Results for:`；`delete` 有效→`Deleted:`、缺失→reject `Memory not found`；`stats`→计数行；`sleep`→`Consolidation complete`

## CodeGraph

- 状态：未使用

## 常用命令

```bash
# 安装依赖
pnpm install

# 测试（24 例：单元 + 集成 + client）
pnpm test

# 安装进 web profile（面板 Setup 按钮自动装 CLI，或手动 uv tool install mnemosyne-memory）
dsh plugin --profile web add ~/workspace/projects/active/dsh-mnemosyne
```

## 其他规则

- 禁止反向测试和反向注释,不做的事情不用说出来
