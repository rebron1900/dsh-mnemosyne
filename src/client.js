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
      groupEmbedding: "Embedding",
      groupLLM: "LLM 整合",
      groupRecall: "召回调优",
      groupWM: "工作记忆",
      f_cli: "CLI 路径",
      f_cli_hint: "留空则自动查找 PATH 与 uv tools 目录",
      f_defaultTopK: "默认召回数量",
      f_timeoutMs: "超时（毫秒）",
      f_dataDir: "数据目录",
      f_dataDir_hint: "SQLite 库与 config.yaml 的存放路径",
      f_noEmbeddings: "禁用 embedding",
      f_noEmbeddings_hint: "跳过 embedding 模型，仅用关键词检索",
      f_embeddingModel: "Embedding 模型",
      f_embeddingDim: "维度",
      f_embeddingApiUrl: "Embedding API 地址",
      f_embeddingApiKey: "Embedding API Key",
      f_llmEnabled: "启用 LLM 整合",
      f_llmBaseUrl: "LLM API 地址",
      f_llmApiKey: "LLM API Key",
      f_llmModel: "LLM 模型",
      f_llmTimeout: "LLM 超时（秒）",
      f_polyphonicRecall: "多义召回",
      f_wmMaxItems: "工作记忆上限",
      f_wmTtlHours: "工作记忆 TTL（小时）",
      f_autoSleep: "自动整合",
      f_sleepThreshold: "整合阈值",
      f_ignorePatterns: "忽略模式",
      f_ignorePatterns_hint: "换行分隔的通配符模式",
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
      groupEmbedding: "Embedding",
      groupLLM: "LLM consolidation",
      groupRecall: "Recall tuning",
      groupWM: "Working memory",
      f_cli: "CLI path",
      f_cli_hint: "Leave empty to auto-resolve from PATH and uv tools",
      f_defaultTopK: "Default top-K",
      f_timeoutMs: "Timeout (ms)",
      f_dataDir: "Data directory",
      f_dataDir_hint: "Where SQLite DB and config.yaml are stored",
      f_noEmbeddings: "Disable embeddings",
      f_noEmbeddings_hint: "Skip embedding model, keyword-only retrieval",
      f_embeddingModel: "Embedding model",
      f_embeddingDim: "Dimensions",
      f_embeddingApiUrl: "Embedding API URL",
      f_embeddingApiKey: "Embedding API key",
      f_llmEnabled: "Enable LLM consolidation",
      f_llmBaseUrl: "LLM API URL",
      f_llmApiKey: "LLM API key",
      f_llmModel: "LLM model",
      f_llmTimeout: "LLM timeout (s)",
      f_polyphonicRecall: "Polyphonic recall",
      f_wmMaxItems: "WM max items",
      f_wmTtlHours: "WM TTL (hours)",
      f_autoSleep: "Auto sleep",
      f_sleepThreshold: "Sleep threshold",
      f_ignorePatterns: "Ignore patterns",
      f_ignorePatterns_hint: "Newline-separated glob patterns",
      reset: "Reset",
    },
  };

  const name = "dsh-mnemosyne-client";
  const inject = ["settingsScope", "slots", "locale"];

  // type: "toggle" | "text" | "number" | "area"
  const FIELDS = [
    { group: "groupPlugin", key: "cli", type: "text", label: "f_cli", hint: "f_cli_hint" },
    { group: "groupPlugin", key: "defaultTopK", type: "number", label: "f_defaultTopK" },
    { group: "groupPlugin", key: "timeoutMs", type: "number", label: "f_timeoutMs" },
    { group: "groupPlugin", key: "dataDir", type: "text", label: "f_dataDir", hint: "f_dataDir_hint" },
    { group: "groupEmbedding", key: "noEmbeddings", type: "toggle", label: "f_noEmbeddings", hint: "f_noEmbeddings_hint" },
    { group: "groupEmbedding", key: "embeddingModel", type: "text", label: "f_embeddingModel" },
    { group: "groupEmbedding", key: "embeddingDim", type: "number", label: "f_embeddingDim" },
    { group: "groupEmbedding", key: "embeddingApiUrl", type: "text", label: "f_embeddingApiUrl" },
    { group: "groupEmbedding", key: "embeddingApiKey", type: "text", label: "f_embeddingApiKey", secret: true },
    { group: "groupLLM", key: "llmEnabled", type: "toggle", label: "f_llmEnabled" },
    { group: "groupLLM", key: "llmBaseUrl", type: "text", label: "f_llmBaseUrl" },
    { group: "groupLLM", key: "llmApiKey", type: "text", label: "f_llmApiKey", secret: true },
    { group: "groupLLM", key: "llmModel", type: "text", label: "f_llmModel" },
    { group: "groupLLM", key: "llmTimeout", type: "number", label: "f_llmTimeout" },
    { group: "groupRecall", key: "polyphonicRecall", type: "toggle", label: "f_polyphonicRecall" },
    { group: "groupWM", key: "wmMaxItems", type: "number", label: "f_wmMaxItems" },
    { group: "groupWM", key: "wmTtlHours", type: "number", label: "f_wmTtlHours" },
    { group: "groupWM", key: "autoSleep", type: "toggle", label: "f_autoSleep" },
    { group: "groupWM", key: "sleepThreshold", type: "number", label: "f_sleepThreshold" },
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
    '.mn-field{content-visibility:auto;contain-intrinsic-size:auto 96px;flex-direction:column;gap:6px;padding:12px 0;display:flex}' +
    '.mn-field + .mn-field{border-top:1px solid var(--dsw-alias-border-l2)}' +
    '.mn-field-head{align-items:center;gap:8px;display:flex}' +
    '.mn-label{min-width:0;color:var(--dsw-alias-label-primary);flex:1;font-size:13px;font-weight:500;line-height:1.5}' +
    '.mn-toggle{display:flex;align-items:center;gap:10px;justify-content:space-between;width:100%}' +
    '.mn-check{width:16px;height:16px;accent-color:var(--dsw-alias-brand-primary);cursor:pointer;margin:0}' +
    '.mn-input{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);min-height:34px;font:inherit;color:var(--dsw-alias-label-primary);border-radius:8px;padding:6px 12px;font-size:13px;line-height:1.5;width:100%;box-sizing:border-box}' +
    '.mn-input:focus-visible{border-color:var(--dsw-alias-brand-primary);outline:none}' +
    '.mn-input:disabled{color:var(--dsw-alias-label-tertiary);cursor:default}' +
    '.mn-area{resize:vertical;min-height:60px;font-family:monospace}' +
    '.mn-hint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:1.5}' +
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
    '.mn-msg{font-size:12px;color:var(--dsw-alias-label-secondary);padding:4px 0}';

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

    const refresh = useCallback(async () => {
      setBusy("diag"); setMsg(null);
      try {
        const r = await fetch("/mnemosyne/diagnose", { headers: { accept: "application/json" } });
        setDiag(await r.json());
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
      const v = stored[key];
      return v === undefined ? "" : v;
    };
    const isDirty = Object.keys(drafts).length > 0;
    const setDraft = (key, value) => { setDrafts((d) => ({ ...d, [key]: value })); setFailedFields([]); };
    const clearDrafts = () => { setDrafts({}); setFailedFields([]); };

    const save = async () => {
      if (!scope || typeof scope.set !== "function") return;
      setSaving(true); setFailedFields([]);
      const failed = [];
      for (const key of Object.keys(drafts)) {
        try { await scope.set(key, drafts[key]); } catch { failed.push(key); }
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
      if (f.type === "toggle") {
        return h("div", { className: "mn-field", key: f.key },
          h("div", { className: "mn-toggle" },
            h("span", { className: "mn-label" }, t(f.label)),
            h("input", { type: "checkbox", className: "mn-check", checked: val === true, onChange: (e) => setDraft(f.key, e.target.checked) }),
          ),
          f.hint ? h("p", { className: "mn-hint" }, t(f.hint)) : null,
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
        h("div", { className: "mn-field-head" },
          h("span", { className: "mn-label" }, t(f.label)),
          isOverridden ? h("button", { type: "button", className: "mn-btn", style: { padding: "2px 8px", fontSize: 11 }, onClick: () => resetField(f.key) }, t("reset")) : null,
        ),
        f.type === "area" ? h("textarea", inputProps) : h("input", { type: inputType, ...inputProps }),
        f.hint ? h("p", { className: "mn-hint" }, t(f.hint)) : null,
      );
    };

    // ── Card builder: each card is a collapsible <li> ─────────────────────
    const renderCard = (cardKey, cardTitle, isOpen, children) => {
      // Track open state per-card via a ref object
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
        openState ? h("div", { className: "mn-body" }, ...children) : null,
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