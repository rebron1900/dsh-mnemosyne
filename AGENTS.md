# dsh-mnemosyne

## 项目概述

- **描述**：DeepSeek Harness（DSH）的 Mnemosyne 记忆插件 — Profile Bundle 形态，注册 5 个记忆工具与 1 个内嵌技能，操作代理到本地 `mnemosyne` CLI（`pip install mnemosyne-memory`）。移植自 `mnemosyne-oss/Pi-mnemosyne`。
- **技术栈**：纯 ESM JavaScript + JSDoc；宿主 API 为 `@deepseek-ai/dsh-tools`（peer）、`@deepseek-ai/schemastery`（config schema）。无构建步骤，发布即源码。
- **运行时**：Node.js ≥ 20（DSH 宿主进程内运行）
- **仓库地址**：本地项目，暂未建远端

## 目录结构

```text
dsh-mnemosyne/
├── cordis.patch.yml   # bundle patch 层：把 mnemosyne 插件行插入 profile 组合树
├── src/index.js       # cordis 插件：Config / apply → 注册 5 工具 + runtime skill；runMnemosyne/resolveCli/isolatedEnv
├── test/              # node:test：index.test.js（单元）+ integration.test.js（对真实 CLI 的集成）
├── docs/design.md     # 实现方案（Pi-mnemosyne 分析、DSH 扩展体系、概念映射、CLI 契约）
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
- 单元层 `test/index.test.js`（9 例，无需 CLI）：参数组装、5 个工具注册契约、skill 注册、render 输出、manifest（dsh.bundle 与 patch 行）、CLI 缺失/非零退出路径
- 集成层 `test/integration.test.js`（9 例，需真实 `mnemosyne` CLI，否则自动 skip）：对照主仓库 `tests/test_cli_*.py` 契约，用 `MNEMOSYNE_DATA_DIR`+`MNEMOSYNE_NO_EMBEDDINGS=1` 隔离临时库，跑 remember/recall/forget/stats/sleep 全链路 + 端到端闭环 + apply() 的 execute() 闭包直驱真实 CLI
- CLI 契约实测：`store`→`Stored: <16hex>`；`recall` 命中含 `ID:/Content:/Score:`、未命中仅 `Results for:`；`delete` 有效→`Deleted:`、缺失→reject `Memory not found`；`stats`→计数行；`sleep`→`Consolidation complete`

## CodeGraph

- 状态：未使用

## 常用命令

```bash
# 安装依赖
pnpm install

# 测试
pnpm test

# 安装进 web profile 并验证（需先 pip install mnemosyne-memory）
dsh plugin --profile web add ~/workspace/projects/active/dsh-mnemosyne
```

## 其他规则

- 禁止反向测试和反向注释,不做的事情不用说出来
