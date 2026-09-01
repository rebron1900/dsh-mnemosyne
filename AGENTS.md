# dsh-mnemosyne

## 项目概述

- **描述**：DeepSeek Harness（DSH）的 Mnemosyne 记忆插件 — Profile Bundle 形态，注册 6 个记忆工具与 1 个内嵌技能，提供 Settings 独立面板（CLI 状态/统计/一键安装/测试/配置/恢复默认）和 Memory Dashboard 管理区（工作区绑定、迁移与备份恢复），数据落 `~/.dsh/mnemosyne`，CLI 通过 `uv tool install` 自动安装。自动记忆增强（system prompt 声明段、自动对话存储、自动召回注入、sessionScope 会话隔离）默认对齐 Hermes 集成开启，可在面板逐项关闭。移植自 `mnemosyne-oss/Pi-mnemosyne`。
- **技术栈**：纯 ESM JavaScript + JSDoc；host 端用 `@deepseek-ai/dsh-tools`/`dsh-settings`/`schemastery`，client 端用 `window.__ModuleLoader__.load` 格式 + `React.createElement`（无构建链）。
- **运行时**：Node.js ≥ 20（DSH 宿主进程内运行）
- **仓库地址**：https://github.com/rebron1900/dsh-mnemosyne

## 目录结构

```text
dsh-mnemosyne/
├── cordis.patch.yml   # bundle patch 层：把 mnemosyne 插件行插入 profile 组合树
├── src/index.js       # cordis host 插件：Config/buildEnv/apply → 6 工具 + skill + settings + webServer HTTP 路由
├── src/identity.js    # 工作区 marker、identity.json 与 namespace 解析
├── src/client.js      # cordis client 插件：Settings 左侧 Mnemosyne 入口与 Memory Dashboard
├── test/              # node:test：index/identity（单元）+ integration（真实 CLI）+ client（客户端模块）
├── docs/design.md     # 实现方案（Pi-mnemosyne 分析、DSH 扩展体系、CLI 契约、面板、配置同步、自动安装与 .dsh 落盘）
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
- 单元层 `test/index.test.js` 与 `test/identity.test.js`：工具注册、配置归一、namespace/marker/identity.json、面板 HTTP 路由、批量管理与工作区绑定安全边界、自动记忆和迁移契约
- 集成层 `test/integration.test.js`：需真实 `mnemosyne` CLI，否则自动 skip；使用临时 dataDir 验证 remember/recall/forget/stats/sleep 全链路、session/workspace scope、迁移、过滤器桥接、auto-sync 与周期 auto-sleep
- 客户端层 `test/client.test.js`：stub `window.__ModuleLoader__` + mock React，验证 client 模块导出、locale/settings slot、Memory Dashboard 注册和渲染
- 配置行为：setup/diagnose 会补齐面板管理的 mnemosyne 默认值；面板从扁平 `config.yaml` 读取实际值，空值以 placeholder 显示默认值；保存后执行 config reload，支持恢复默认配置
- 面板行为：状态卡和插件卡默认展开，其余配置卡默认折叠；测试连接成功后立即重新执行 diagnose 并刷新 stats
- CLI 契约实测：`store`→`Stored: <16hex>`；`recall` 命中含 `ID:/Content:/Score:`、未命中仅 `Results for:`；`delete` 有效→`Deleted:`、缺失→reject `Memory not found`；`stats`→计数行；`sleep`→`Consolidation complete`

## CodeGraph

- 状态：未使用

## 常用命令

```bash
# 安装依赖
pnpm install

# 测试（当前 node --test 共 153 例；数量随测试扩展更新）
pnpm test

# 安装进 web profile（面板 Setup 按钮自动装 CLI，或手动 uv tool install mnemosyne-memory）
dsh plugin --profile web add ~/workspace/projects/active/dsh-mnemosyne
```

## 其他规则

- 禁止反向测试和反向注释,不做的事情不用说出来
