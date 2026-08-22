// dsh-mnemosyne client module — Settings section with config form + status panel.
// Follows the dsh-vision-router pattern: DSH design tokens via injected <style>,
// settingsScope for config read/write, collapsible card layout.
//
// Format: window.__ModuleLoader__.load — evaluated by the DSH client runtime.

window.__ModuleLoader__.load({ id: "dsh-mnemosyne", factory: (require) => {
  const module = { exports: {} };
  const exports = module.exports;
  Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

  const React = require("react");
  const h = React.createElement;
  const { useState, useCallback, useEffect, useMemo, useSyncExternalStore } = React;

  const NS = "dsh-mnemosyne";
  const LOCALE = {
    zh: {
      nav: "Mnemosyne 记忆",
      desc: "本地优先的跨会话记忆层",
      status: "状态",
      cliReady: "CLI 已就绪",
      cliMissing: "CLI 未安装",
      dataDir: "数据目录",
      memories: "记忆数量",
      setup: "安装 CLI",
      installing: "安装中…",
      setupDone: "安装完成",
      setupFail: "安装失败",
      test: "测试连接",
      testing: "测试中…",
      testOk: "连接正常",
      testFail: "连接失败",
      refresh: "刷新",
      noStats: "尚未获取统计",
      loading: "加载中…",
      saving: "保存中…",
      save: "保存",
      discard: "放弃",
      pending: "有未保存的修改",
      saveFailed: "保存失败",
      groupPlugin: "插件",
      groupPlugin_hint: "dsh-mnemosyne 插件自身行为。这些参数控制 CLI 调用方式与数据存放位置，仅作用于 dsh-mnemosyne，不影响 mnemosyne CLI 本体。",
      groupEmbedding: "Embedding",
      groupEmbedding_hint: "语义检索的向量化模型。mnemosyne 默认用 bge-small-en-v1.5（384 维），需 fastembed 库。禁用后退回关键词检索（FTS5），仍可用但语义匹配能力下降。",
      groupLLM: "LLM 整合",
      groupLLM_hint: "sleep() 整合时用 LLM 提炼摘要。启用后优先用远程 API，失败回退本地 GGUF（MiniCPM5-1B，约 656MB），再失败用 AAAK 关键词编码。不启用则只用 AAAK。",
      groupRecall: "召回调优",
      groupRecall_hint: "默认召回路径有词法门槛——长查询（4+词）需 30% 词面匹配才进入向量打分，对话式提问容易被误杀。开启多义召回可让向量证据单独准入，改善语义匹配。",
      groupWM: "工作记忆",
      groupWM_hint: "工作记忆是短期热数据层。auto_sleep / sleep_threshold / ignore_patterns 是 config.yaml 键（mnemosyne CLI 读取 dataDir/config.yaml），其余为环境变量。",
      f_cli: "CLI 路径",
      f_cli_hint: "dsh-mnemosyne 专用。留空则自动查找 PATH 与 uv tools 安装目录（~/.local/share/uv/tools/mnemosyne-memory/bin）。一般无需填写。",
      f_defaultTopK: "默认召回数量",
      f_defaultTopK_hint: "dsh-mnemosyne 专用。mnemosyne_recall 工具不传 top_k 时的默认值。增大可看到更多结果，但会引入更多噪声。",
      f_timeoutMs: "超时（毫秒）",
      f_timeoutMs_hint: "dsh-mnemosyne 专用。调用 mnemosyne CLI 的进程超时。首次 sleep 可能下载 GGUF 模型（656MB），建议至少 60000。",
      f_dataDir: "数据目录",
      f_dataDir_hint: "dsh-mnemosyne 专用。透传为 MNEMOSYNE_DATA_DIR，决定 SQLite 库（mnemosyne.db）与 config.yaml 的位置。默认 ~/.dsh/mnemosyne，确保数据落在 .dsh 目录下。",
      f_noEmbeddings: "禁用 embedding",
      f_noEmbeddings_hint: "透传 MNEMOSYNE_NO_EMBEDDINGS=1。跳过 embedding 模型加载，仅用关键词检索（FTS5）。适合无 fastembed 或纯关键词场景。语义匹配能力会下降。",
      f_embeddingModel: "Embedding 模型",
      f_embeddingModel_hint: "透传 MNEMOSYNE_EMBEDDING_MODEL。默认 bge-small-en-v1.5（384维）。中文可用 BAAI/bge-small-zh-v1.5；多语言可用 sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2。更换模型后需 reindex。",
      f_embeddingDim: "维度",
      f_embeddingDim_hint: "透传 MNEMOSYNE_EMBEDDING_DIM。显式指定向量维度，优先级高于模型内置映射。未知模型必须填写，否则启动报错。更换维度需 reindex。",
      f_embeddingApiUrl: "Embedding API 地址",
      f_embeddingApiUrl_hint: "透传 MNEMOSYNE_EMBEDDING_API_URL。自定义 embedding API 端点，回退到 OPENROUTER_BASE_URL。留空用默认 openrouter.ai。",
      f_embeddingApiKey: "Embedding API Key",
      f_embeddingApiKey_hint: "透传 MNEMOSYNE_EMBEDDING_API_KEY。embedding API 密钥，回退到 OPENROUTER_API_KEY 再回退 OPENAI_API_KEY。",
      f_llmEnabled: "启用 LLM 整合",
      f_llmEnabled_hint: "透传 MNEMOSYNE_LLM_ENABLED。开启后 sleep() 用 LLM 提炼记忆摘要，而非纯关键词编码。需配置远程 API 或安装本地 GGUF 模型。",
      f_llmBaseUrl: "LLM API 地址",
      f_llmBaseUrl_hint: "透传 MNEMOSYNE_LLM_BASE_URL。OpenAI 兼容 API 地址（如 http://localhost:11434/v1 用于 Ollama）。留空则回退本地 GGUF。",
      f_llmApiKey: "LLM API Key",
      f_llmApiKey_hint: "透传 MNEMOSYNE_LLM_API_KEY。远程 LLM API 的认证密钥。本地 Ollama 无需填写。",
      f_llmModel: "LLM 模型",
      f_llmModel_hint: "透传 MNEMOSYNE_LLM_MODEL。模型标识符（如 llama3、gpt-4o-mini）。留空用本地默认 MiniCPM5-1B。",
      f_llmTimeout: "LLM 超时（秒）",
      f_llmTimeout_hint: "透传 MNEMOSYNE_LLM_TIMEOUT，默认 60。推理模型或慢代理建议增大（如 300）。",
      f_polyphonicRecall: "多义召回",
      f_polyphonicRecall_hint: "透传 MNEMOSYNE_POLYPHONIC_RECALL=1。改用多义召回引擎（RRF 融合向量/图/事实/时间声部），向量证据可单独准入，改善对话式查询的召回率。注意：多用户场景下可能跨 scope 泄露，启用前需验证。",
      f_wmMaxItems: "工作记忆上限",
      f_wmMaxItems_hint: "透传 MNEMOSYNE_WM_MAX_ITEMS，默认 10000。未整合工作记忆条目上限，超限触发淘汰。已整合条目（consolidated_at）不受此限。",
      f_wmTtlHours: "工作记忆 TTL（小时）",
      f_wmTtlHours_hint: "透传 MNEMOSYNE_WM_TTL_HOURS，默认 168（7天）。未整合工作记忆的存活时间，超期淘汰。已整合条目不受此限。",
      f_autoSleep: "自动整合",
      f_autoSleep_hint: "config.yaml 键 auto_sleep，默认 true。会话开始/结束时自动运行 sleep 整合，将工作记忆归档到长期层。设为 false 则仅手动调用 mnemosyne_sleep。",
      f_sleepThreshold: "整合阈值",
      f_sleepThreshold_hint: "config.yaml 键 sleep_threshold，默认 20。触发自动整合所需的最少工作记忆条目数，低于此值跳过整合，避免琐碎会话浪费资源。",
      f_ignorePatterns: "忽略模式",
      f_ignorePatterns_hint: "config.yaml 键 ignore_patterns。正则表达式列表（Python re 语法），匹配的内容在 remember() 时被静默丢弃。每行一个模式，如 ^pip install、^Traceback、^sudo 。",
      reset: "重置",
    },
    en: {
      nav: "Mnemosyne",
      desc: "Local-first cross-session memory layer",
      status: "Status",
      cliReady: "CLI ready",
      cliMissing: "CLI not installed",
      dataDir: "Data directory",
      memories: "Memories",
      setup: "Setup CLI",
      installing: "Installing…",
      setupDone: "Setup complete",
      setupFail: "Setup failed",
      test: "Test connection",
      testing: "Testing…",
      testOk: "Connection OK",
      testFail: "Connection failed",
      refresh: "Refresh",
      noStats: "No stats yet",
      loading: "Loading…",
      saving: "Saving…",
      save: "Save",
      discard: "Discard",
      pending: "Unsaved changes",
      saveFailed: "Save failed",
      groupPlugin: "Plugin",
      groupPlugin_hint: "dsh-mnemosyne plugin behavior. These control CLI invocation and data location; they only affect the dsh plugin, not the mnemosyne CLI itself.",
      groupEmbedding: "Embedding",
      groupEmbedding_hint: "Vector model for semantic retrieval. mnemosyne defaults to bge-small-en-v1.5 (384-dim), requires fastembed. Disabling falls back to keyword search (FTS5) — still works but loses semantic matching.",
      groupLLM: "LLM consolidation",
      groupLLM_hint: "sleep() uses an LLM to distill summaries. When enabled, tries remote API first, then local GGUF (MiniCPM5-1B, ~656MB), then AAAK keyword encoding. Without it, only AAAK is used.",
      groupRecall: "Recall tuning",
      groupRecall_hint: "Default recall has a lexical gate — long queries (4+ tokens) need 30% surface match before vector scoring, which can cull semantically-matching rows. Polyphonic recall lets vector evidence admit rows on its own.",
      groupWM: "Working memory",
      groupWM_hint: "Working memory is the short-term hot tier. auto_sleep / sleep_threshold / ignore_patterns are config.yaml keys (read from dataDir/config.yaml); the rest are environment variables.",
      f_cli: "CLI path",
      f_cli_hint: "dsh-mnemosyne only. Leave empty to auto-resolve from PATH and uv tools dir (~/.local/share/uv/tools/mnemosyne-memory/bin). Usually no need to set.",
      f_defaultTopK: "Default top-K",
      f_defaultTopK_hint: "dsh-mnemosyne only. Default recall count when mnemosyne_recall is called without top_k. Higher shows more results but adds noise.",
      f_timeoutMs: "Timeout (ms)",
      f_timeoutMs_hint: "dsh-mnemosyne only. Process timeout for mnemosyne CLI calls. First sleep may download a GGUF model (~656MB); allow at least 60000.",
      f_dataDir: "Data directory",
      f_dataDir_hint: "dsh-mnemosyne only. Passed as MNEMOSYNE_DATA_DIR — determines where SQLite DB (mnemosyne.db) and config.yaml live. Defaults to ~/.dsh/mnemosyne to keep data under .dsh.",
      f_noEmbeddings: "Disable embeddings",
      f_noEmbeddings_hint: "Sets MNEMOSYNE_NO_EMBEDDINGS=1. Skips embedding model, uses keyword-only retrieval (FTS5). Semantic matching is reduced but keyword search still works.",
      f_embeddingModel: "Embedding model",
      f_embeddingModel_hint: "MNEMOSYNE_EMBEDDING_MODEL. Default bge-small-en-v1.5 (384-dim). Chinese: BAAI/bge-small-zh-v1.5; multilingual: sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2. Changing model requires reindex.",
      f_embeddingDim: "Dimensions",
      f_embeddingDim_hint: "MNEMOSYNE_EMBEDDING_DIM. Explicit vector dimension, overrides model's built-in mapping. Required for unknown models (startup fails otherwise). Changing dimension requires reindex.",
      f_embeddingApiUrl: "Embedding API URL",
      f_embeddingApiUrl_hint: "MNEMOSYNE_EMBEDDING_API_URL. Custom embedding API endpoint, falls back to OPENROUTER_BASE_URL. Empty uses default openrouter.ai.",
      f_embeddingApiKey: "Embedding API key",
      f_embeddingApiKey_hint: "MNEMOSYNE_EMBEDDING_API_KEY. API key for embedding endpoint, falls back to OPENROUTER_API_KEY then OPENAI_API_KEY.",
      f_llmEnabled: "Enable LLM consolidation",
      f_llmEnabled_hint: "MNEMOSYNE_LLM_ENABLED. When on, sleep() uses an LLM to distill memory summaries instead of keyword-only encoding. Requires remote API or local GGUF model.",
      f_llmBaseUrl: "LLM API URL",
      f_llmBaseUrl_hint: "MNEMOSYNE_LLM_BASE_URL. OpenAI-compatible API URL (e.g. http://localhost:11434/v1 for Ollama). Empty falls back to local GGUF.",
      f_llmApiKey: "LLM API key",
      f_llmApiKey_hint: "MNEMOSYNE_LLM_API_KEY. Auth key for remote LLM API. Not needed for local Ollama.",
      f_llmModel: "LLM model",
      f_llmModel_hint: "MNEMOSYNE_LLM_MODEL. Model identifier (e.g. llama3, gpt-4o-mini). Empty uses local default MiniCPM5-1B.",
      f_llmTimeout: "LLM timeout (s)",
      f_llmTimeout_hint: "MNEMOSYNE_LLM_TIMEOUT, default 60. Increase for reasoning models or slow proxies (e.g. 300).",
      f_polyphonicRecall: "Polyphonic recall",
      f_polyphonicRecall_hint: "MNEMOSYNE_POLYPHONIC_RECALL=1. Routes recall through PolyphonicRecallEngine (RRF fusion over vector/graph/fact/temporal voices). Vector evidence can admit rows alone, improving conversational recall. Warning: may cross-expose scopes in multi-user setups — verify before enabling.",
      f_wmMaxItems: "WM max items",
      f_wmMaxItems_hint: "MNEMOSYNE_WM_MAX_ITEMS, default 10000. Max unconsolidated working-memory items before eviction. Consolidated rows (consolidated_at) are exempt.",
      f_wmTtlHours: "WM TTL (hours)",
      f_wmTtlHours_hint: "MNEMOSYNE_WM_TTL_HOURS, default 168 (7 days). TTL for unconsolidated working-memory entries. Consolidated rows are exempt.",
      f_autoSleep: "Auto sleep",
      f_autoSleep_hint: "config.yaml key auto_sleep, default true. Automatically runs sleep consolidation on session start/end, archiving working memory to the long-term tier. Set false to only trigger manually via mnemosyne_sleep.",
      f_sleepThreshold: "Sleep threshold",
      f_sleepThreshold_hint: "config.yaml key sleep_threshold, default 20. Minimum working-memory entries required before auto-sleep triggers. Below this, consolidation is skipped to avoid wasting resources on trivial sessions.",
      f_ignorePatterns: "Ignore patterns",
      f_ignorePatterns_hint: "config.yaml key ignore_patterns. Regex patterns (Python re syntax); matching content is silently dropped at remember() time. One pattern per line, e.g. ^pip install, ^Traceback, ^sudo .",
      reset: "Reset",
    },
  };

  const name = "dsh-mnemosyne-client";
  const inject = ["settingsScope", "slots", "locale"];

  // type: "toggle" | "text" | "number" | "area"
  const FIELDS = [
    { group: "groupPlugin", key: "cli", type: "text", label: "f_cli", hint: "f_cli_hint" },
    { group: "groupPlugin", key: "defaultTopK", type: "number", label: "f_defaultTopK", hint: "f_defaultTopK_hint" },
    { group: "groupPlugin", key: "timeoutMs", type: "number", label: "f_timeoutMs", hint: "f_timeoutMs_hint" },
    { group: "groupPlugin", key: "dataDir", type: "text", label: "f_dataDir", hint: "f_dataDir_hint" },
    { group: "groupEmbedding", key: "noEmbeddings", type: "toggle", label: "f_noEmbeddings", hint: "f_noEmbeddings_hint" },
    { group: "groupEmbedding", key: "embeddingModel", type: "text", label: "f_embeddingModel", hint: "f_embeddingModel_hint" },
    { group: "groupEmbedding", key: "embeddingDim", type: "number", label: "f_embeddingDim", hint: "f_embeddingDim_hint" },
    { group: "groupEmbedding", key: "embeddingApiUrl", type: "text", label: "f_embeddingApiUrl", hint: "f_embeddingApiUrl_hint" },
    { group: "groupEmbedding", key: "embeddingApiKey", type: "text", label: "f_embeddingApiKey", hint: "f_embeddingApiKey_hint", secret: true },
    { group: "groupLLM", key: "llmEnabled", type: "toggle", label: "f_llmEnabled", hint: "f_llmEnabled_hint" },
    { group: "groupLLM", key: "llmBaseUrl", type: "text", label: "f_llmBaseUrl", hint: "f_llmBaseUrl_hint" },
    { group: "groupLLM", key: "llmApiKey", type: "text", label: "f_llmApiKey", hint: "f_llmApiKey_hint", secret: true },
    { group: "groupLLM", key: "llmModel", type: "text", label: "f_llmModel", hint: "f_llmModel_hint" },
    { group: "groupLLM", key: "llmTimeout", type: "number", label: "f_llmTimeout", hint: "f_llmTimeout_hint" },
    { group: "groupRecall", key: "polyphonicRecall", type: "toggle", label: "f_polyphonicRecall", hint: "f_polyphonicRecall_hint" },
    { group: "groupWM", key: "wmMaxItems", type: "number", label: "f_wmMaxItems", hint: "f_wmMaxItems_hint" },
    { group: "groupWM", key: "wmTtlHours", type: "number", label: "f_wmTtlHours", hint: "f_wmTtlHours_hint" },
    { group: "groupWM", key: "autoSleep", type: "toggle", label: "f_autoSleep", hint: "f_autoSleep_hint" },
    { group: "groupWM", key: "sleepThreshold", type: "number", label: "f_sleepThreshold", hint: "f_sleepThreshold_hint" },
    { group: "groupWM", key: "ignorePatterns", type: "area", label: "f_ignorePatterns", hint: "f_ignorePatterns_hint" },
  ];

  // ── Styles: DSH design tokens (mirrors dsh-vision-router) ──────────────
  const CSS =
    '.mn-card{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:12px;list-style:none;transition:border-color .16s,background .16s;margin-bottom:12px}' +
    '.mn-card:hover{border-color:var(--dsw-alias-label-dimmed)}' +
    '.mn-card-open{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-label-dimmed)}' +
    '.mn-header{appearance:none;width:100%;font:inherit;color:inherit;text-align:left;cursor:pointer;background:0 0;border:0;border-radius:12px;align-items:center;gap:12px;padding:14px 16px;display:flex}' +
    '.mn-header:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}' +
    '.mn-headText{flex-direction:column;flex:1;gap:4px;min-width:0;display:flex}' +
    '.mn-name{color:var(--dsw-alias-label-primary);font-size:15px;font-weight:600;line-height:1.4}' +
    '.mn-desc{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:1.5}' +
    '.mn-pending{white-space:nowrap;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);border-radius:999px;flex:none;padding:1px 8px;font-size:11px;font-weight:500;line-height:17px}' +
    '.mn-chevron{color:var(--dsw-alias-label-tertiary);flex:none;transition:transform .16s;font-size:12px;line-height:1}' +
    '.mn-chevron-open{transform:rotate(180deg)}' +
    '.mn-body{border-top:1px solid var(--dsw-alias-border-l2);margin:0 16px;padding-bottom:8px}' +
    '.mn-field{padding:12px 0;display:flex;align-items:flex-start;gap:16px}' +
    '.mn-field + .mn-field{border-top:1px solid var(--dsw-alias-border-l2)}' +
    '.mn-field-left{flex:0 0 38%;min-width:0;display:flex;flex-direction:column;gap:3px;padding-top:6px}' +
    '.mn-field-right{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px}' +
    '.mn-field-head{align-items:center;gap:8px;display:flex}' +
    '.mn-label{min-width:0;color:var(--dsw-alias-label-primary);font-size:13px;font-weight:500;line-height:1.5}' +
    '.mn-toggle{display:flex;align-items:center;gap:10px;width:100%;padding-top:6px}' +
    '.mn-check{width:16px;height:16px;accent-color:var(--dsw-alias-brand-primary);cursor:pointer;margin:0}' +
    '.mn-input{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);min-height:34px;font:inherit;color:var(--dsw-alias-label-primary);border-radius:8px;padding:6px 12px;font-size:13px;line-height:1.5;width:100%;box-sizing:border-box;max-width:420px}' +
    '.mn-input:focus-visible{border-color:var(--dsw-alias-brand-primary);outline:none}' +
    '.mn-input:disabled{color:var(--dsw-alias-label-tertiary);cursor:default}' +
    '.mn-area{resize:vertical;min-height:60px;font-family:monospace}' +
    '.mn-hint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:1.5}' +
    '.mn-card-hint{color:var(--dsw-alias-label-tertiary);margin:0 0 8px;font-size:12px;line-height:1.6;padding:0 16px}' +
    '.mn-group{content-visibility:auto;contain-intrinsic-size:auto 96px;border-top:1px solid var(--dsw-alias-border-l2);padding:10px 0 2px;display:flex;flex-direction:column;gap:8px}' +
    '.mn-group-title{font-size:12px;font-weight:600;color:var(--dsw-alias-label-tertiary);margin:0}' +
    '.mn-savebar{position:sticky;top:10px;z-index:20;width:max-content;max-width:100%;margin:0 0 10px auto;padding:5px 6px;display:flex;justify-content:flex-end;align-items:center;gap:6px;flex-wrap:wrap;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);border-radius:12px;box-shadow:0 3px 10px #00000012}' +
    '.mn-savebar .mn-pending{margin:0 4px 0 2px;font-size:12px}' +
    '.mn-savebar .mn-btn{padding:4px 10px}' +
    '.mn-btn{appearance:none;font:inherit;cursor:pointer;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:5px 14px;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-secondary);background:0 0}' +
    '.mn-btn:hover:not(:disabled){color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-dimmed)}' +
    '.mn-btn-save{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3);border-color:#0000}' +
    '.mn-btn:disabled{opacity:.4;cursor:default}' +
    '.mn-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}' +
    '.mn-status{margin:12px 0 2px;padding:12px 14px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-module-platform);display:flex;flex-direction:column;gap:5px}' +
    '.mn-status-row{font-size:13px;color:var(--dsw-alias-label-secondary);line-height:1.5}' +
    '.mn-status-error{color:var(--dsw-alias-label-error);font-size:12px;line-height:1.5}' +
    '.mn-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:8px 0 4px}' +
    '.mn-msg{font-size:12px;color:var(--dsw-alias-label-secondary);padding:4px 0}' +
    '@media(max-width:640px){.mn-field{flex-direction:column;gap:6px}.mn-field-left{flex:none;padding-top:0}}';

  let stylesInstalled = false;
  function installStyles() {
    if (stylesInstalled || typeof document === "undefined") return;
    stylesInstalled = true;
    const tag = document.createElement("style");
    tag.dataset.plugin = "dsh-mnemosyne";
    tag.dataset.pluginCss = "dsh-mnemosyne/settings";
    tag.textContent = CSS;
    document.head.appendChild(tag);
  }

  function MnemosynePanel(props) {
    const { t, scope } = props;
    installStyles();

    const subscribe = useMemo(() => (scope ? scope.subscribe.bind(scope) : () => () => {}), [scope]);
    const getSnapshot = useMemo(() => (scope ? scope.getSnapshot.bind(scope) : () => ({})), [scope]);
    const config = useSyncExternalStore(subscribe, getSnapshot);

    const [cardOpen, setCardOpen] = useState({ status: true });
    const [drafts, setDrafts] = useState({});
    const [saving, setSaving] = useState(false);
    const [failedFields, setFailedFields] = useState([]);
    const [diag, setDiag] = useState(null);
    const [busy, setBusy] = useState(null);
    const [msg, setMsg] = useState(null);
    const [yamlConfig, setYamlConfig] = useState({});

    const refresh = useCallback(async () => {
      setBusy("diag"); setMsg(null);
      try {
        const [diagRes, cfgRes] = await Promise.all([
          fetch("/mnemosyne/diagnose", { headers: { accept: "application/json" } }).then(r => r.json()),
          fetch("/mnemosyne/config").then(r => r.json()).catch(() => ({ ok: false })),
        ]);
        setDiag(diagRes);
        if (cfgRes.ok && cfgRes.config) setYamlConfig(cfgRes.config);
      } catch (e) { setDiag({ ok: false, error: String(e?.message ?? e) }); }
      finally { setBusy(null); }
    }, []);

    useEffect(() => { refresh(); }, [refresh]);

    const setup = async () => {
      setBusy("setup"); setMsg(null);
      try {
        const r = await fetch("/mnemosyne/setup", { method: "POST" });
        const data = await r.json();
        setMsg(data.ok ? t("setupDone") : t("setupFail") + ": " + (data.error || ""));
        if (data.ok) refresh();
      } catch (e) { setMsg(t("setupFail") + ": " + String(e?.message ?? e)); }
      finally { setBusy(null); }
    };

    const test = async () => {
      setBusy("test"); setMsg(null);
      try {
        const r = await fetch("/mnemosyne/test", { method: "POST" });
        const data = await r.json();
        setMsg(data.ok ? t("testOk") : t("testFail") + ": " + (data.error || ""));
      } catch (e) { setMsg(t("testFail") + ": " + String(e?.message ?? e)); }
      finally { setBusy(null); }
    };

    // scope.getSnapshot() returns { value, user, writable, status, revision }
    // — value holds the merged config (defaults + user overrides)
    const snapshot = config || {};
    const stored = (snapshot.value && typeof snapshot.value === "object") ? snapshot.value : {};

    const format = (key) => {
      if (key in drafts) return drafts[key];
      // config.yaml keys read from /mnemosyne/config, not DSH settings scope
      if (key in CONFIG_YAML_FIELDS) {
        const snake = CONFIG_YAML_FIELDS[key];
        const v = yamlConfig[snake];
        if (key === "ignorePatterns") {
          if (v == null) return "";
          if (Array.isArray(v)) return v.join("\n");
          return String(v);
        }
        if (key === "autoSleep") return v === "true" || v === true;
        if (key === "sleepThreshold") return v != null ? Number(v) : "";
        return v ?? "";
      }
      const v = stored[key];
      return v === undefined ? "" : v;
    };
    const isDirty = Object.keys(drafts).length > 0;
    const setDraft = (key, value) => { setDrafts((d) => ({ ...d, [key]: value })); setFailedFields([]); };
    const clearDrafts = () => { setDrafts({}); setFailedFields([]); };

    // config.yaml keys: stored in dataDir/config.yaml, not in DSH settings
    const CONFIG_YAML_FIELDS = {
      autoSleep: "auto_sleep",
      sleepThreshold: "sleep_threshold",
      ignorePatterns: "ignore_patterns",
    };

    const save = async () => {
      setSaving(true); setFailedFields([]);
      const failed = [];
      // Split drafts: DSH settings keys vs config.yaml keys
      const settingsDrafts = {};
      const yamlDrafts = {};
      for (const key of Object.keys(drafts)) {
        if (key in CONFIG_YAML_FIELDS) yamlDrafts[key] = drafts[key];
        else settingsDrafts[key] = drafts[key];
      }
      // Save DSH settings keys via scope
      if (scope && typeof scope.set === "function") {
        for (const key of Object.keys(settingsDrafts)) {
          try { await scope.set(key, settingsDrafts[key]); } catch { failed.push(key); }
        }
      }
      // Save config.yaml keys via HTTP route
      if (Object.keys(yamlDrafts).length > 0) {
        try {
          const payload = {};
          for (const [camel, snake] of Object.entries(CONFIG_YAML_FIELDS)) {
            if (camel in yamlDrafts) {
              payload[snake] = camel === "ignorePatterns"
                ? (Array.isArray(yamlDrafts[camel]) ? yamlDrafts[camel] : String(yamlDrafts[camel]).split("\n").map(s => s.trim()).filter(Boolean))
                : yamlDrafts[camel];
            }
          }
          await fetch("/mnemosyne/config", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
        } catch { failed.push(...Object.keys(yamlDrafts)); }
      }
      setSaving(false);
      if (failed.length > 0) setFailedFields(failed);
      else setDrafts({});
    };

    const resetField = async (key) => {
      if (!scope || typeof scope.set !== "function") return;
      try { await scope.set(key, undefined); setDrafts((d) => { const n = { ...d }; delete n[key]; return n; }); }
      catch { setFailedFields([key]); }
    };

    const total = (() => {
      const m = diag?.stats?.match(/Total memories:\s*(\d+)/);
      return m ? Number(m[1]) : null;
    })();

    const groups = useMemo(() => {
      const map = {};
      for (const f of FIELDS) { if (!map[f.group]) map[f.group] = []; map[f.group].push(f); }
      return map;
    }, []);
    const groupOrder = ["groupPlugin", "groupEmbedding", "groupLLM", "groupRecall", "groupWM"];

    const renderField = (f) => {
      const val = format(f.key);
      const isOverridden = f.key in drafts;
      // Toggle: label on left, checkbox on right — same row
      if (f.type === "toggle") {
        return h("div", { className: "mn-field", key: f.key },
          h("div", { className: "mn-field-left" },
            h("div", { className: "mn-field-head" },
              h("span", { className: "mn-label" }, t(f.label)),
              isOverridden ? h("button", { type: "button", className: "mn-btn", style: { padding: "2px 8px", fontSize: 11 }, onClick: () => resetField(f.key) }, t("reset")) : null,
            ),
            f.hint ? h("p", { className: "mn-hint" }, t(f.hint)) : null,
          ),
          h("div", { className: "mn-field-right", style: { paddingTop: 8 } },
            h("input", { type: "checkbox", className: "mn-check", checked: val === true, onChange: (e) => setDraft(f.key, e.target.checked) }),
          ),
        );
      }
      const inputType = f.type === "number" ? "number" : f.secret ? "password" : "text";
      const inputProps = {
        className: "mn-input" + (f.type === "area" ? " mn-area" : ""),
        value: val,
        onChange: (e) => setDraft(f.key, f.type === "number" ? (e.target.value === "" ? "" : Number(e.target.value)) : e.target.value),
      };
      if (f.type === "area") inputProps.rows = 3;
      return h("div", { className: "mn-field", key: f.key },
        h("div", { className: "mn-field-left" },
          h("div", { className: "mn-field-head" },
            h("span", { className: "mn-label" }, t(f.label)),
            isOverridden ? h("button", { type: "button", className: "mn-btn", style: { padding: "2px 8px", fontSize: 11 }, onClick: () => resetField(f.key) }, t("reset")) : null,
          ),
          f.hint ? h("p", { className: "mn-hint" }, t(f.hint)) : null,
        ),
        h("div", { className: "mn-field-right" },
          f.type === "area" ? h("textarea", inputProps) : h("input", { type: inputType, ...inputProps }),
        ),
      );
    };

    // ── Card builder: each card is a collapsible <li> ─────────────────────
    const renderCard = (cardKey, cardTitle, isOpen, children, cardHint) => {
      const openState = cardOpen[cardKey] ?? true;
      return h("li", { className: "mn-card" + (openState ? " mn-card-open" : ""), key: cardKey },
        h("button", {
          type: "button", className: "mn-header", "aria-expanded": openState,
          onClick: () => setCardOpen((s) => ({ ...s, [cardKey]: !openState })),
        },
          h("span", { className: "mn-headText" },
            h("span", { className: "mn-name" }, cardTitle),
          ),
          isDirty ? h("span", { className: "mn-pending" }, t("pending")) : null,
          h("span", { className: "mn-chevron" + (openState ? " mn-chevron-open" : "") }, "▾"),
        ),
        openState ? h("div", { className: "mn-body" },
          cardHint ? h("p", { className: "mn-card-hint" }, cardHint) : null,
          ...children,
        ) : null,
      );
    };

    return h(React.Fragment, null,
      // Card 1: Status & actions
      renderCard("status", t("nav"), true, [
        h("div", { className: "mn-status" },
          h("div", { className: "mn-status-row" },
            (diag?.cliReady ? "✅ " : "⚠️ ") + (diag?.cliReady ? t("cliReady") : t("cliMissing")),
            diag?.path ? "  (" + diag.path + ")" : "",
          ),
          diag?.dataDir ? h("div", { className: "mn-status-row" }, t("dataDir") + ": " + diag.dataDir) : null,
          total != null ? h("div", { className: "mn-status-row" }, t("memories") + ": " + total) : null,
          diag?.ok === false && diag?.error ? h("div", { className: "mn-status-error" }, diag.error) : null,
        ),
        h("div", { className: "mn-actions" },
          h("button", { type: "button", className: "mn-btn", disabled: !!busy, onClick: setup }, busy === "setup" ? t("installing") : t("setup")),
          h("button", { type: "button", className: "mn-btn", disabled: !!busy || !diag?.cliReady, onClick: test }, busy === "test" ? t("testing") : t("test")),
          h("button", { type: "button", className: "mn-btn", disabled: !!busy, onClick: refresh }, t("refresh")),
        ),
        msg ? h("div", { className: "mn-msg" }, msg) : null,
      ]),
      // Save bar (between status and config cards, shown when dirty)
      isDirty ? h("li", { className: "mn-card mn-card-open", key: "savebar" },
        h("div", { className: "mn-body" },
          h("div", { className: "mn-savebar", role: "region", "aria-label": t("pending") },
            failedFields.length > 0
              ? h("span", { className: "mn-status-error", role: "alert" }, t("saveFailed") + " (" + failedFields.join(", ") + ")")
              : h("span", { className: "mn-pending" }, t("pending")),
            h("button", { type: "button", className: "mn-btn", disabled: saving, onClick: clearDrafts }, t("discard")),
            h("button", { type: "button", className: "mn-btn mn-btn-save", disabled: saving, onClick: save }, saving ? t("saving") : t("save")),
          ),
        ),
      ) : null,
      // Config cards — one per group
      ...groupOrder.map((g) =>
        groups[g] ? renderCard(g, t(g), false,
          groups[g].map(renderField),
          t(g + "_hint"),
        ) : null,
      ),
    );
  }

  function apply(ctx) {
    ctx.effect(() => ctx.locale.register(NS, LOCALE), "dsh-mnemosyne: dictionaries");
    const t = ctx.locale.bind(NS);
    const scope = ctx.settingsScope.bind({ namespace: "mnemosyne" });

    ctx.slots.inject("settings.section", function* () {
      yield ctx.slots.register(
        {
          name: "settings.section",
          id: "mnemosyne",
          order: 50,
          label: () => t("nav"),
          inject: () => ({ t, scope }),
        },
        (props) => h("ul", { style: { listStyle: "none", margin: 0, padding: 0 } },
          h(MnemosynePanel, props),
        ),
      );
    });
  }

  exports.apply = apply;
  exports.inject = inject;
  exports.name = name;
  return module.exports;
}});