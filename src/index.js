import { execFile } from "node:child_process";
import { accessSync, constants, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve as resolvePath } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import { defineTool } from "@deepseek-ai/dsh-tools";
import z from "@deepseek-ai/schemastery";

// --- small HTTP helpers for the panel's webServer routes ---
function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(payload);
}
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin || !req.headers.host) return false;
  try {
    const u = new URL(origin);
    const protocol = req.socket?.encrypted ? "https:" : "http:";
    return u.protocol === protocol && u.host === req.headers.host;
  } catch {
    return false;
  }
}
// Same-origin GET fetches may omit Origin; use Sec-Fetch-Site when the browser
// provides it to block cross-site reads without breaking the panel's refresh.
function trustedRead(req) {
  const site = req.headers["sec-fetch-site"];
  return site === undefined || site === "same-origin";
}
function readJsonBody(req, limit = 1 << 20) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) { req.destroy(); reject(new Error("body too large")); return; }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
      catch { reject(new Error("invalid JSON")); }
    });
    req.on("error", reject);
  });
}

/**
 * dsh-mnemosyne — DeepSeek Harness profile bundle for Mnemosyne.
 *
 * Registers five agent tools that proxy to the `mnemosyne` CLI, plus one
 * embedded runtime skill. All data and config land under ~/.dsh/mnemosyne.
 * The CLI is auto-installed via `uv tool install mnemosyne-memory` when the
 * panel's setup action runs.
 */

export const name = "mnemosyne";

export const inject = ["tools", "agents"];

export const DEFAULT_DATA_DIR = join(homedir(), ".dsh", "mnemosyne");

function expandPath(value) {
  // Treat null/undefined/empty-string as "use the default" so a cleared
  // panel field never resolves to the process cwd. Expand a leading ~ to
  // the user's home directory — the upstream mnemosyne CLI does NOT call
  // expanduser() on MNEMOSYNE_DATA_DIR, so we must hand it an absolute path.
  const path = value && String(value).trim() || DEFAULT_DATA_DIR;
  return resolvePath(path === "~" ? homedir() : path.startsWith("~/") ? join(homedir(), path.slice(2)) : path);
}

const CONFIG_VALUE_TYPES = {
  no_embeddings: "boolean",
  embedding_model: "string",
  embedding_dim: "number",
  embedding_api_url: "string",
  embedding_api_key: "string",
  llm_enabled: "boolean",
  llm_base_url: "string",
  llm_api_key: "string",
  llm_model: "string",
  llm_timeout: "number",
  polyphonic_recall: "boolean",
  wm_max_items: "number",
  wm_ttl_hours: "number",
  auto_sleep_enabled: "boolean",
  sleep_threshold: "number",
  ignore_patterns: "string",
};

export class ConfigValidationError extends Error {}

function validateConfigValues(values) {
  if (!values || typeof values !== "object" || Array.isArray(values)) throw new ConfigValidationError("configuration must be an object");
  const result = {};
  for (const [key, value] of Object.entries(values)) {
    const type = CONFIG_VALUE_TYPES[key];
    if (!type) throw new ConfigValidationError(`unsupported configuration key: ${key}`);
    // Empty string = "cleared, fall back to upstream default" (panel clears
    // number inputs to ""). Anything else must match the field type.
    if (value !== "") {
      if (typeof value !== type || (type === "number" && !Number.isFinite(value))) {
        throw new ConfigValidationError(`invalid value for configuration key: ${key}`);
      }
      if (type === "number" && value < 0) throw new ConfigValidationError(`configuration key must be non-negative: ${key}`);
    }
    result[key] = value;
  }
  return result;
}

function yamlScalar(value) {
  if (typeof value === "string") return JSON.stringify(value);
  return String(value);
}

export const Config = z.object({
  // --- plugin behaviour ---
  cli: z.string().default("mnemosyne").description("Mnemosyne CLI executable (name on PATH or absolute path)."),
  defaultTopK: z.number().default(5).description("Recall cap when the model omits top_k."),
  timeoutMs: z.number().default(20_000).description("Per-call CLI timeout in milliseconds."),
  dataDir: z.string().default(DEFAULT_DATA_DIR).description("Where mnemosyne stores its SQLite DB and config.yaml."),

  // --- embedding ---
  noEmbeddings: z.boolean().default(false).description("Disable semantic embeddings (keyword/FTS5 only)."),
  embeddingModel: z.string().description("Embedding model id, e.g. BAAI/bge-small-zh-v1.5. Changing requires reindex."),
  embeddingDim: z.number().description("Explicit embedding output dimension; leave unset for built-in model mappings."),
  embeddingApiUrl: z.string().description("Custom embedding API endpoint (falls back to OPENROUTER_BASE_URL)."),
  embeddingApiKey: z.string().role("secret").description("Embedding API key (falls back to OPENROUTER_API_KEY / OPENAI_API_KEY)."),

  // --- LLM consolidation ---
  llmEnabled: z.boolean().default(true).description("Global gate for LLM-backed consolidation."),
  llmBaseUrl: z.string().description("OpenAI-compatible API base URL for remote LLM consolidation."),
  llmApiKey: z.string().role("secret").description("API key for the remote LLM endpoint."),
  llmModel: z.string().description("Remote LLM model id."),
  llmTimeout: z.number().default(60).description("HTTP timeout in seconds for remote LLM calls."),

  // --- recall tuning ---
  polyphonicRecall: z.boolean().default(false).description("Route recall through PolyphonicRecallEngine (better phrasing tolerance, cross-scope risk on shared banks)."),

  // --- automatic memory (opt-in; defaults preserve manual-only behavior) ---
  // When true, a "# Mnemosyne Memory" section is injected into the system prompt
  // on every assembly so the model knows memory is available and how to use it.
  promptSection: z.boolean().default(false).description("Inject a '# Mnemosyne Memory' section into the system prompt telling the model that memory tools are available."),
  // When true, user/assistant messages are automatically stored to Mnemosyne as
  // episodic memory after each turn — the model no longer needs to call
  // mnemosyne_remember manually for conversation context.
  autoSync: z.boolean().default(false).description("Automatically store user/assistant messages to Mnemosyne after each turn (episodic memory)."),
  // When true, relevant memories are recalled and injected into the conversation
  // before each model step — the model sees prior context without calling
  // mnemosyne_recall.
  autoPrefetch: z.boolean().default(false).description("Automatically recall and inject relevant memories before each model step."),
  prefetchTopK: z.number().default(5).description("Number of memories to recall for auto-prefetch injection."),
  prefetchMinQueryLen: z.number().default(8).description("Minimum user-message length to trigger auto-prefetch (shorter messages are skipped)."),

  // --- working memory / sleep ---
  wmMaxItems: z.number().description("Max unconsolidated working-memory items before eviction."),
  wmTtlHours: z.number().description("TTL in hours for unconsolidated working-memory entries."),
  autoSleep: z.boolean().default(true).description("Auto-run sleep consolidation on session start/end (config.yaml)."),
  sleepThreshold: z.number().default(20).description("Min working-memory entries before auto-sleep triggers (config.yaml)."),
  ignorePatterns: z.array(z.string()).description("Regex patterns filtering content before storage (config.yaml)."),
});

/**
 * Build the environment passed to the mnemosyne CLI. Only non-empty/non-default
 * fields are injected, so a user's own MNEMOSYNE_* env wins for anything we
 * leave undefined. dataDir is always set (it is the plugin's core contract).
 */
export function buildEnv(config, base = process.env) {
  const c = config ?? {};
  const env = { ...base };
  // data dir is always pinned to the plugin's contract (~/.dsh/mnemosyne)
  env.MNEMOSYNE_DATA_DIR = expandPath(c.dataDir);
  if (c.noEmbeddings) env.MNEMOSYNE_NO_EMBEDDINGS = "1";
  if (c.embeddingModel) env.MNEMOSYNE_EMBEDDING_MODEL = c.embeddingModel;
  if (c.embeddingDim != null) env.MNEMOSYNE_EMBEDDING_DIM = String(c.embeddingDim);
  if (c.embeddingApiUrl) env.MNEMOSYNE_EMBEDDING_API_URL = c.embeddingApiUrl;
  if (c.embeddingApiKey) env.MNEMOSYNE_EMBEDDING_API_KEY = c.embeddingApiKey;
  if (c.llmEnabled === false) env.MNEMOSYNE_LLM_ENABLED = "false";
  if (c.llmBaseUrl) env.MNEMOSYNE_LLM_BASE_URL = c.llmBaseUrl;
  if (c.llmApiKey) env.MNEMOSYNE_LLM_API_KEY = c.llmApiKey;
  if (c.llmModel) env.MNEMOSYNE_LLM_MODEL = c.llmModel;
  if (c.llmTimeout != null) env.MNEMOSYNE_LLM_TIMEOUT = String(c.llmTimeout);
  if (c.polyphonicRecall) env.MNEMOSYNE_POLYPHONIC_RECALL = "1";
  if (c.wmMaxItems != null) env.MNEMOSYNE_WM_MAX_ITEMS = String(c.wmMaxItems);
  if (c.wmTtlHours != null) env.MNEMOSYNE_WM_TTL_HOURS = String(c.wmTtlHours);
  return env;
}

/** Run one `mnemosyne` subcommand and resolve with trimmed stdout. */
export function runMnemosyne(cli, command, args, timeoutMs, env) {
  return new Promise((resolve, reject) => {
    execFile(
      cli,
      [command, ...args],
      { timeout: timeoutMs, windowsHide: true, env: env ?? process.env, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          if (error.code === "ENOENT") {
            reject(
              new Error(
                `Mnemosyne CLI "${cli}" not found on PATH. Install it via the Mnemosyne panel (Setup) or run: uv tool install mnemosyne-memory`
              )
            );
            return;
          }
          if (error.killed || error.signal === "SIGTERM") {
            reject(new Error(`mnemosyne ${command} timed out after ${timeoutMs}ms.`));
            return;
          }
          reject(new Error(stderr.trim() || error.message));
          return;
        }
        resolve(String(stdout).trim());
      }
    );
  });
}

/** Positional-argument builders kept exported for tests. */
export function storeArgs({ content, source, importance }) {
  const args = [content];
  if (source !== undefined) args.push(source);
  if (importance !== undefined) args.push(String(importance));
  return args;
}

export function recallArgs({ query, topK }, defaultTopK) {
  return [query, String(topK ?? defaultTopK)];
}

/** Resolve a CLI name to an absolute path on PATH (with ~/.local/bin appended),
 *  or null if not found. */
export function resolveCli(cli = "mnemosyne") {
  if (cli.includes("/") || cli.includes("\\")) {
    try {
      accessSync(cli, constants.X_OK);
      return cli;
    } catch {
      return null;
    }
  }
  const pathSep = process.platform === "win32" ? ";" : ":";
  const dirs = [
    ...String(process.env.PATH ?? "").split(pathSep),
    join(homedir(), ".local", "bin"),
  ];
  const exts = process.platform === "win32" ? [".exe", ""] : [""];
  for (const dir of dirs) {
    for (const ext of exts) {
      const p = `${dir}/${cli}${ext}`;
      try {
        accessSync(p, constants.X_OK);
        return p;
      } catch {}
    }
  }
  return null;
}

/** Build an env that points mnemosyne at an isolated data dir (no embeddings),
 *  so integration tests never touch the user's real memory database. */
export function isolatedEnv(dataDir, base = process.env) {
  return { ...base, MNEMOSYNE_DATA_DIR: dataDir, MNEMOSYNE_NO_EMBEDDINGS: "1", HOME: dataDir };
}

/** Resolve uv binary path (with ~/.local/bin appended), or null. */
function resolveUv() {
  return resolveCli("uv");
}

/** Install the mnemosyne CLI via `uv tool install`. Returns a status object. */
export async function setupMnemosyne(config = {}) {
  const cliName = config.cli ?? "mnemosyne";
  const dataDir = expandPath(config.dataDir);
  const existing = resolveCli(cliName);
  if (existing) {
    // Even if already installed, ensure config.yaml has defaults filled
    ensureConfigDefaults(dataDir);
    return { ok: true, alreadyInstalled: true, path: existing };
  }
  const uv = resolveUv();
  if (!uv) {
    return {
      ok: false,
      error: "uv not found on PATH. Install uv first: https://docs.astral.sh/uv/getting-started/installation/",
    };
  }
  try {
    const stdout = await runExec(uv, ["tool", "install", "mnemosyne-memory"], 180_000);
    const path = resolveCli(cliName);
    // Fill in mnemosyne upstream defaults in config.yaml right after install
    if (path) ensureConfigDefaults(dataDir);
    return { ok: true, alreadyInstalled: false, path, output: stdout };
  } catch (e) {
    return { ok: false, error: String(e?.message ?? e) };
  }
}

function runExec(file, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout: timeoutMs, windowsHide: true }, (error, stdout, stderr) => {
      if (error) reject(new Error(stderr.trim() || error.message));
      else resolve(String(stdout).trim());
    });
  });
}

/** Diagnose: detect CLI, ensure data dir + config defaults, run stats. */
export async function diagnoseMnemosyne(config) {
  const c = config ?? {};
  const cli = resolveCli(c.cli ?? "mnemosyne");
  const dataDir = expandPath(c.dataDir);
  if (!cli) return { ok: false, cliReady: false, error: "mnemosyne CLI not on PATH" };
  try {
    mkdirSync(dataDir, { recursive: true });
    // Ensure config.yaml has mnemosyne upstream defaults filled in.
    // mnemosyne auto-generates config.yaml on first run but leaves most
    // values empty; we write the known defaults so the panel shows real
    // values instead of blanks.
    ensureConfigDefaults(dataDir);
    const env = buildEnv(c);
    const stats = await runMnemosyne(cli, "stats", [], Math.max(1_000, Number(c.timeoutMs) || 20_000), env);
    return { ok: true, cliReady: true, path: cli, dataDir, stats };
  } catch (e) {
    return { ok: false, cliReady: true, path: cli, dataDir, error: String(e?.message ?? e) };
  }
}

const TEXT_OUTPUT = {
  schema: { type: "string" },
  render: (_args, value) => [{ type: "text", text: value }],
};

// --- config.yaml read/write (flat top-level keys) ---
// mnemosyne's config.yaml is a flat file of `key: value` lines at top level.
// We read/write the keys that map to our panel fields.

/** mnemosyne upstream defaults for panel-managed config.yaml keys. */
const MNEMOSYNE_YAML_DEFAULTS = {
  no_embeddings: false,
  embedding_model: "BAAI/bge-small-en-v1.5",
  embedding_dim: 384,
  embedding_api_url: "",
  embedding_api_key: "",
  llm_enabled: false,
  llm_base_url: "",
  llm_api_key: "",
  llm_model: "",
  llm_timeout: 60,
  polyphonic_recall: false,
  wm_max_items: 10000,
  wm_ttl_hours: 168,
  auto_sleep_enabled: true,
  sleep_threshold: 20, // dsh-mnemosyne extension, not in upstream DEFAULTS
  ignore_patterns: "",
};

/** Panel camelCase → config.yaml snake_case mapping. */
export const CONFIG_YAML_MAP = {
  noEmbeddings: "no_embeddings",
  embeddingModel: "embedding_model",
  embeddingDim: "embedding_dim",
  embeddingApiUrl: "embedding_api_url",
  embeddingApiKey: "embedding_api_key",
  llmEnabled: "llm_enabled",
  llmBaseUrl: "llm_base_url",
  llmApiKey: "llm_api_key",
  llmModel: "llm_model",
  llmTimeout: "llm_timeout",
  polyphonicRecall: "polyphonic_recall",
  wmMaxItems: "wm_max_items",
  wmTtlHours: "wm_ttl_hours",
  autoSleep: "auto_sleep_enabled",
  sleepThreshold: "sleep_threshold",
  ignorePatterns: "ignore_patterns",
};

/** Parse a YAML scalar string into a JS value: strips quotes, coerces numbers/bools/null. */
function parseYamlScalar(raw) {
  const s = raw.trim();
  if (s === "") return "";
  // Double-quoted — written by yamlScalar() as JSON.stringify, so decode with JSON.parse.
  if (s.startsWith('"') && s.endsWith('"')) {
    try { return JSON.parse(s); } catch { return s.slice(1, -1); }
  }
  // Single-quoted (YAML: '' = escaped single quote)
  if (s.startsWith("'") && s.endsWith("'")) return s.slice(1, -1).replace(/''/g, "'");
  // Boolean
  if (s === "true") return true;
  if (s === "false") return false;
  // Null
  if (s === "null" || s === "~") return null;
  // Number
  if (/^-?\d+$/.test(s)) return parseInt(s, 10);
  if (/^-?\d+\.\d+$/.test(s)) return parseFloat(s);
  // Bare string
  return s;
}

/** Parse a flat `key: value` YAML file into { key: value } object with typed values. */
export function readMnemosyneConfigYaml(dataDir) {
  const p = join(expandPath(dataDir), "config.yaml");
  if (!existsSync(p)) return {};
  const raw = readFileSync(p, "utf8");
  const result = {};
  for (const line of raw.split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^(\w+):\s*(.*)$/);
    if (m) result[m[1]] = parseYamlScalar(m[2]);
  }
  return result;
}

/** Update specific top-level keys in a flat config.yaml (merge, preserves others). */
export function writeMnemosyneConfigYaml(dataDir, values) {
  const dir = expandPath(dataDir);
  const p = join(dir, "config.yaml");
  const validated = validateConfigValues(values);
  mkdirSync(dir, { recursive: true });
  let raw = existsSync(p) ? readFileSync(p, "utf8") : "";
  for (const [snakeKey, val] of Object.entries(validated)) {
    const lineVal = yamlScalar(val);
    const regex = new RegExp(`^(${snakeKey}:\\s*).*$`, "m");
    if (regex.test(raw)) {
      raw = raw.replace(regex, `${snakeKey}: ${lineVal}`);
    } else {
      raw = raw + (raw && !raw.endsWith("\n") ? "\n" : "") + `${snakeKey}: ${lineVal}\n`;
    }
  }
  writeFileSync(p, raw, "utf8");
  return { ok: true, path: p };
}

/** Ensure config.yaml has mnemosyne upstream defaults for all panel-managed
 *  keys. Only writes keys that are missing or empty — preserves user values. */
export function ensureConfigDefaults(dataDir) {
  const existing = readMnemosyneConfigYaml(dataDir);
  const toWrite = {};
  for (const [key, defaultVal] of Object.entries(MNEMOSYNE_YAML_DEFAULTS)) {
    const current = existing[key];
    if (current === undefined || current === null || current === "") {
      toWrite[key] = defaultVal;
    }
  }
  if (Object.keys(toWrite).length > 0) {
    writeMnemosyneConfigYaml(dataDir, toWrite);
  }
  return toWrite;
}

/** Run `mnemosyne config reload` to hot-reload the config file. */
export async function reloadMnemosyneConfig(cliPath, dataDir, timeoutMs = 10_000) {
  const env = { ...process.env, MNEMOSYNE_DATA_DIR: expandPath(dataDir) };
  return runMnemosyne(cliPath, "config", ["reload"], timeoutMs, env);
}

/** Create one identified, frozen user-role message for session injection.
 *  Mirrors @deepseek-ai/dsh-llm's createUserMessage without adding a dependency. */
function createUserMessage(input) {
  const msg = Object.freeze({
    ...input,
    role: "user",
    id: randomUUID(),
  });
  return msg;
}

export function apply(ctx, config) {
  const cfg = () => config ?? {};
  const env = () => buildEnv(cfg());
  // Numeric guardrails at the trust boundary (model args + user config).
  const clampNum = (v, fallback, min, max) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
  };
  const callTimeout = () => clampNum(cfg().timeoutMs, 20_000, 1_000, 600_000);
  const topKLimit = () => Math.floor(clampNum(cfg().defaultTopK, 5, 1, 100));
  // Resolve the CLI path once (checks PATH + uv tools dir). Tools and panel
  // routes all go through this so they share one resolution path.
  const resolveCliPath = () => {
    const cli = resolveCli(cfg().cli ?? "mnemosyne");
    if (!cli) {
      throw new Error(
        "Mnemosyne CLI '" + (cfg().cli ?? "mnemosyne") + "' not found on PATH. " +
        "Install it via the Mnemosyne panel (Setup) or run: uv tool install mnemosyne-memory"
      );
    }
    return cli;
  };
  const run = (command, args) =>
    runMnemosyne(resolveCliPath(), command, args, callTimeout(), env());

  // Register the "mnemosyne" settings namespace so the client panel's
  // settingsScope can read/write config. Hard-dep via ctx.inject (not soft
  // ctx.get) — same pattern as dsh-vision-router, ensures registration fires
  // once the settings service is available.
  ctx.inject(["settings"], (sctx) => {
    sctx.effect(
      () => sctx.settings.register("mnemosyne", Config, { base: cfg() }),
      "mnemosyne: settings namespace"
    );
  });

  // --- system prompt section (opt-in) ---
  // When promptSection is enabled, inject a static "# Mnemosyne Memory" section
  // into the system prompt so the model knows memory tools are available.
  const systemPrompt = ctx.get("systemPrompt");
  if (systemPrompt) {
    if (cfg().promptSection) {
      ctx.effect(
        () => systemPrompt.section({
          name: "mnemosyne-memory",
          order: 95,
          text: (
            "# Mnemosyne Memory\n" +
            "Mnemosyne local memory is active. Use mnemosyne_remember to store durable facts, preferences, or insights. " +
            "Use mnemosyne_recall to search memories by semantic similarity. Use mnemosyne_forget to delete outdated memories. " +
            "Use mnemosyne_stats to check memory status. Use mnemosyne_sleep to consolidate working memories into long-term summaries."
          ),
        }),
        "mnemosyne: system prompt section"
      );
    }
  }

  // HTTP routes for the client panel (Client→Host via fetch). Soft-dep on
  // webServer: headless/minimal hosts without a server simply skip these.
  ctx.inject(["webServer"], (hostCtx) => {
    const web = hostCtx.webServer;
    const disposers = [];

    disposers.push(
      web.register({
        kind: "exact",
        path: "/mnemosyne/diagnose",
        handler: async (req, res) => {
          if (req.method !== "GET") return sendJson(res, 405, { error: "GET only" });
          if (!trustedRead(req)) return sendJson(res, 403, { error: "untrusted origin" });
          try {
            sendJson(res, 200, await diagnoseMnemosyne(cfg()));
          } catch (e) {
            sendJson(res, 500, { error: String(e?.message ?? e) });
          }
        },
      })
    );

    disposers.push(
      web.register({
        kind: "exact",
        path: "/mnemosyne/setup",
        handler: async (req, res) => {
          if (req.method !== "POST") return sendJson(res, 405, { error: "POST only" });
          if (!sameOrigin(req)) return sendJson(res, 403, { error: "untrusted origin" });
          try {
            sendJson(res, 200, await setupMnemosyne(cfg()));
          } catch (e) {
            sendJson(res, 500, { error: String(e?.message ?? e) });
          }
        },
      })
    );

    disposers.push(
      web.register({
        kind: "exact",
        path: "/mnemosyne/test",
        handler: async (req, res) => {
          if (req.method !== "POST") return sendJson(res, 405, { error: "POST only" });
          if (!sameOrigin(req)) return sendJson(res, 403, { error: "untrusted origin" });
          try {
            const marker = `dsh-conn-test-${Date.now()}`;
            const stored = await run("store", storeArgs({ content: marker, source: "dsh-panel" }));
            const id = stored.split("Stored:")[1]?.trim();
            if (id) await run("delete", [id]);
            sendJson(res, 200, { ok: true, message: "store + delete succeeded", probeId: id ?? null });
          } catch (e) {
            sendJson(res, 200, { ok: false, error: String(e?.message ?? e) });
          }
        },
      })
    );

    disposers.push(
      web.register({
        kind: "exact",
        path: "/mnemosyne/config",
        handler: async (req, res) => {
          if (req.method === "GET") {
            if (!trustedRead(req)) return sendJson(res, 403, { error: "untrusted origin" });
            try {
              const yaml = readMnemosyneConfigYaml(cfg().dataDir);
              // Merge defaults under user values so empty fields show defaults
              const merged = {};
              for (const [k, v] of Object.entries(MNEMOSYNE_YAML_DEFAULTS)) {
                merged[k] = (yaml[k] !== undefined && yaml[k] !== "") ? yaml[k] : v;
              }
              sendJson(res, 200, { ok: true, config: { ...yaml, ...merged } });
            } catch (e) {
              sendJson(res, 500, { error: String(e?.message ?? e) });
            }
          } else if (req.method === "POST") {
            if (!sameOrigin(req)) return sendJson(res, 403, { error: "untrusted origin" });
            try {
              const body = await readJsonBody(req);
              const dataDir = cfg().dataDir;
              const result = writeMnemosyneConfigYaml(dataDir, body);
              // Hot-reload the config so changes take effect without restarting dsh
              let reloadMsg = "";
              try {
                const cli = resolveCliPath();
                if (cli) reloadMsg = await reloadMnemosyneConfig(cli, dataDir);
              } catch { /* reload failure is non-fatal — file is still written */ }
              sendJson(res, 200, { ...result, reload: reloadMsg.trim() });
            } catch (e) {
              if (e instanceof ConfigValidationError) return sendJson(res, 400, { error: e.message });
              sendJson(res, 500, { error: String(e?.message ?? e) });
            }
          } else if (req.method === "DELETE") {
            if (!sameOrigin(req)) return sendJson(res, 403, { error: "untrusted origin" });
            try {
              const dataDir = cfg().dataDir;
              // Write all panel-managed keys back to their mnemosyne defaults
              const result = writeMnemosyneConfigYaml(dataDir, MNEMOSYNE_YAML_DEFAULTS);
              let reloadMsg = "";
              try {
                const cli = resolveCliPath();
                if (cli) reloadMsg = await reloadMnemosyneConfig(cli, dataDir);
              } catch { /* reload failure is non-fatal */ }
              sendJson(res, 200, { ...result, reload: reloadMsg.trim() });
            } catch (e) {
              sendJson(res, 500, { error: String(e?.message ?? e) });
            }
          } else {
            sendJson(res, 405, { error: "GET, POST, or DELETE only" });
          }
        },
      })
    );

    hostCtx.effect(() => () => disposers.forEach((d) => d?.()), "mnemosyne: http routes");
  });

  // --- session/event listeners ---
  // (1) Auto-sync: store user/assistant messages to Mnemosyne after each turn.
  //     (2) Auto-sleep: consolidate when working memory exceeds threshold.
  let autoSleepInFlight = false;
  ctx.effect(() =>
    ctx.on("session/event", async (_session, event) => {
      // --- auto-sync: store conversation to episodic memory ---
      if (cfg().autoSync) {
        try {
          if (event?.type === "user/message") {
            // Skip plugin-injected messages (e.g. our own prefetch) to avoid feedback loops
            const source = event.data?.source;
            if (source && typeof source === "object" && source.kind === "plugin") {
              // fall through to auto-sleep check below
            } else {
              const text = extractMessageText(event.data?.content);
              if (text && text.length > 5) {
                const truncated = text.slice(0, 500);
                await run("store", [truncated, "conversation", "0.5"]);
              }
            }
          } else if (event?.type === "assistant/message") {
            const text = extractMessageText(event.data?.message?.content);
            if (text && text.length > 10) {
              const truncated = text.slice(0, 800);
              await run("store", [truncated, "conversation", "0.15"]);
            }
          }
        } catch {
          // Auto-sync failures are non-fatal — don't disrupt the session
        }
      }

      // --- auto-sleep on turn/end ---
      if (event?.type !== "turn/end") return;
      if (autoSleepInFlight) return;
      autoSleepInFlight = true;
      try {
        const dataDir = cfg().dataDir;
        const yamlCfg = readMnemosyneConfigYaml(dataDir);
        const autoSleep = yamlCfg.auto_sleep_enabled !== "false" && yamlCfg.auto_sleep_enabled !== false;
        if (!autoSleep) return;
        const threshold = Number(yamlCfg.sleep_threshold) || 20;
        const cli = resolveCliPath();
        const e = env();
        // Sleep may download a GGUF model on first run — give it more time
        // than the per-call timeout, but never less.
        const sleepTimeout = Math.max(callTimeout(), 60_000);
        const stats = await runMnemosyne(cli, "stats", [], callTimeout(), e);
        const m = stats.match(/Working memory:\s*(\d+)/);
        const count = m ? Number(m[1]) : 0;
        if (count >= threshold) {
          await runMnemosyne(cli, "sleep", [], sleepTimeout, e);
        }
      } catch {
        // Auto-sleep failures are non-fatal — don't disrupt the session
      } finally {
        autoSleepInFlight = false;
      }
    }),
    "mnemosyne: session/event (auto-sync + auto-sleep)"
  );

  ctx.inject(["tools"], (sctx) => {
    sctx.effect(
      () =>
        sctx.tools.register(
          defineTool({
            name: "mnemosyne_remember",
            description:
              "Store a fact, preference, or observation in Mnemosyne memory. Use when the user reveals important context that should persist across sessions.",
            parameters: {
              content: { type: "string", required: true, description: "The memory content to store." },
              source: { type: "string", description: "Source tag for the memory (default: dsh)." },
              importance: { type: "number", description: "Importance score 0.0-1.0; higher ranks higher in recall." },
            },
            output: TEXT_OUTPUT,
            async execute(args) {
              return run("store", storeArgs({
                content: String(args?.content ?? ""),
                source: args?.source === undefined ? undefined : String(args.source),
                importance: args?.importance == null ? undefined : clampNum(args.importance, 0.5, 0, 1),
              }));
            },
          })
        ),
      "mnemosyne: remember tool"
    );

    sctx.effect(
      () =>
        sctx.tools.register(
          defineTool({
            name: "mnemosyne_recall",
            description:
              "Search Mnemosyne memory by semantic similarity. Use before starting work on a task to retrieve relevant prior context.",
            parameters: {
              query: { type: "string", required: true, description: "Natural-language query describing what you need." },
              top_k: { type: "number", description: `Maximum results to return (default: ${cfg().defaultTopK ?? 5}).` },
            },
            output: TEXT_OUTPUT,
            async execute(args) {
              const topK = args?.top_k == null ? undefined : Math.floor(clampNum(args.top_k, topKLimit(), 1, 100));
              return run("recall", recallArgs({ query: String(args?.query ?? ""), topK }, topKLimit()));
            },
          })
        ),
      "mnemosyne: recall tool"
    );

    sctx.effect(
      () =>
        sctx.tools.register(
          defineTool({
            name: "mnemosyne_forget",
            description:
              "Delete a memory from Mnemosyne by its ID. Use when the user asks to remove outdated or incorrect information.",
            parameters: { id: { type: "string", required: true, description: "The memory ID returned by mnemosyne_remember." } },
            output: TEXT_OUTPUT,
            async execute(args) {
              return run("delete", [String(args?.id ?? "")]);
            },
          })
        ),
      "mnemosyne: forget tool"
    );

    sctx.effect(
      () =>
        sctx.tools.register(
          defineTool({
            name: "mnemosyne_stats",
            description: "Show Mnemosyne database statistics: memory counts, bank sizes, and model status.",
            parameters: {},
            output: TEXT_OUTPUT,
            async execute() {
              return run("stats", []);
            },
          })
        ),
      "mnemosyne: stats tool"
    );

    sctx.effect(
      () =>
        sctx.tools.register(
          defineTool({
            name: "mnemosyne_sleep",
            description:
              "Run Mnemosyne consolidation (sleep). Use at the end of a long session to compress working memories into long-term summaries.",
            parameters: {},
            output: TEXT_OUTPUT,
            async execute() {
              return run("sleep", []);
            },
          })
        ),
      "mnemosyne: sleep tool"
    );
  });

  const skills = ctx.get("skills");
  if (skills) {
    ctx.effect(() => skills.register(SKILL), "mnemosyne: skill");
  }

  // --- agent/pre-step prefetch (opt-in) ---
  // When autoPrefetch is enabled, recall relevant memories before each model
  // step and inject them as a sourced user/message into the conversation.
  if (cfg().autoPrefetch) {
    // Track queries already prefetched in the current turn to avoid repetition.
    const prefetchedQueries = new Set();
    let lastPrefetchTurn = -1;

    ctx.effect(() =>
      ctx.on("agent/pre-step", async ({ agent, messages, turn, step, signal }, next) => {
        // Reset dedup set on turn change
        if (lastPrefetchTurn !== turn) {
          prefetchedQueries.clear();
          lastPrefetchTurn = turn;
        }

        const decision = await next();
        if (decision.kind === "reject" || signal.aborted) return decision;

        // Extract the latest user message text as the recall query
        const query = extractLastUserText(decision.messages);
        const minLen = cfg().prefetchMinQueryLen ?? 8;
        if (!query || query.length < minLen) return decision;
        // Skip if we already prefetched this exact query in this turn
        if (prefetchedQueries.has(query)) return decision;
        prefetchedQueries.add(query);

        try {
          const topK = Math.floor(clampNum(cfg().prefetchTopK ?? 5, topKLimit(), 1, 100));
          const result = await run("recall", recallArgs({ query, topK }, topKLimit()));
          // Skip if recall returned no hits (just "Results for: ..." with no ID lines)
          if (!result || !result.includes("ID:")) return decision;

          const contextText = formatPrefetchContext(result);
          if (!contextText) return decision;

          return {
            kind: "enter",
            messages: [...decision.messages, createUserMessage({
              content: [{ type: "text", text: contextText }],
              source: {
                kind: "plugin",
                plugin: "mnemosyne",
                form: "snapshot",
                sections: [{ name: "mnemosyne-prefetch", text: contextText }],
              },
            })],
          };
        } catch {
          // Prefetch failures are non-fatal — proceed without injected context
          return decision;
        }
      }, { prepend: true }),
      "mnemosyne: agent/pre-step prefetch"
    );
  }
}

// --- helpers for auto-sync and auto-prefetch ---

/** Extract plain text from a message content array (handles text blocks and strings). */
export function extractMessageText(content) {
  if (!content) return "";
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((block) => block && typeof block === "object" && block.type === "text")
    .map((block) => block.text || "")
    .join("\n")
    .trim();
}

/** Extract the last user message text from a messages array for prefetch query. */
export function extractLastUserText(messages) {
  if (!Array.isArray(messages)) return "";
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg && msg.role === "user") {
      return extractMessageText(msg.content);
    }
  }
  return "";
}

/** Format a recall result string into a memory-context block for prompt injection. */
export function formatPrefetchContext(recallOutput) {
  if (!recallOutput || typeof recallOutput !== "string") return "";
  const lines = recallOutput.split("\n").filter((l) => l.trim());
  // Expect lines like "ID: <hex>", "Content: ...", "Score: 0.xx"
  const memories = [];
  let current = null;
  for (const line of lines) {
    if (line.startsWith("ID:")) {
      if (current) memories.push(current);
      current = { id: line.slice(3).trim(), content: "", score: "" };
    } else if (line.startsWith("Content:")) {
      if (current) current.content = line.slice(8).trim();
    } else if (line.startsWith("Score:")) {
      if (current) current.score = line.slice(6).trim();
    }
  }
  if (current) memories.push(current);
  if (memories.length === 0) return "";

  const entries = memories
    .map((m) => `  • ${m.content}${m.score ? ` (score: ${m.score})` : ""}`)
    .join("\n");
  return `## Mnemosyne Context\nRelevant memories recalled for this turn:\n${entries}`;
}

export const SKILL = {
  name: "mnemosyne",
  source: "dsh-mnemosyne",
  description:
    "Persist and recall memories across DSH sessions using Mnemosyne, a local-first SQLite-backed memory layer. Use when the user reveals preferences, constraints, or project facts that should survive sessions, or when starting work on a topic where prior context may help.",
  whenToUse:
    'The user states a preference ("remember that I use pnpm"), asks you to remember/forget something, or a new task likely has relevant prior context.',
  content: `# Mnemosyne

[Mnemosyne](https://github.com/mnemosyne-oss/mnemosyne) is a local-first AI memory layer. It stores facts, preferences, and observations in a SQLite database on your machine and surfaces them with semantic search. No cloud. No API keys.

This skill ships inside the \`dsh-mnemosyne\` plugin. Data lives under \`~/.dsh/mnemosyne\`.

## When to use Mnemosyne

- The user states a preference ("I like my tests in \`tests/\`", "Use \`pnpm\` not \`npm\`").
- You learn something about the project that will matter in future sessions.
- You discover a bug, gotcha, or workaround worth remembering.
- You are starting a task and want to recall prior related context.
- The user asks you to remember or forget something.

## Available tools

- \`mnemosyne_remember\` — Store a memory.
- \`mnemosyne_recall\` — Search memories by semantic similarity.
- \`mnemosyne_forget\` — Delete a memory by ID.
- \`mnemosyne_stats\` — Show memory statistics.
- \`mnemosyne_sleep\` — Consolidate old memories into summaries.

## Best practices

- Store concise, factual memories. Avoid dumping entire conversations.
- Use \`importance\` between 0.7 and 0.95 for facts that should persist.
- Recall before starting work on a new but related task.
- Forget stale or incorrect memories when the user corrects you.
- Run \`mnemosyne_sleep\` occasionally to compress old working memories.

## Automatic memory (opt-in)

The plugin can automate memory operations. These are **disabled by default** — enable them in the Settings panel:

- **Prompt section** — Injects a "# Mnemosyne Memory" header into the system prompt so the model knows memory is available.
- **Auto-sync** — Automatically stores user/assistant messages to Mnemosyne after each turn, so conversation context persists without manual \`mnemosyne_remember\` calls.
- **Auto-prefetch** — Recalls relevant memories before each model step and injects them into the conversation, so the model sees prior context without calling \`mnemosyne_recall\`.

When all three are disabled (the default), behavior is identical to manual-only: the model must explicitly call the memory tools.

## Installation

\`\`\`bash
dsh plugin --profile web add dsh-mnemosyne
# Then open the Mnemosyne panel in Settings and click Setup to install the CLI,
# or run: uv tool install mnemosyne-memory
\`\`\`
`,
};