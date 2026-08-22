import { execFile } from "node:child_process";
import { accessSync, constants, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve as resolvePath } from "node:path";
import { homedir } from "node:os";
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
  if (!origin) return true; // same-origin browser navigations omit Origin
  try {
    const u = new URL(origin);
    return u.host === req.headers.host;
  } catch {
    return false;
  }
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

export const inject = ["tools"];

export const DEFAULT_DATA_DIR = join(homedir(), ".dsh", "mnemosyne");

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
  env.MNEMOSYNE_DATA_DIR = c.dataDir ?? DEFAULT_DATA_DIR;
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
      { timeout: timeoutMs, windowsHide: true, env: env ?? process.env },
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
export async function setupMnemosyne() {
  const existing = resolveCli("mnemosyne");
  if (existing) return { ok: true, alreadyInstalled: true, path: existing };
  const uv = resolveUv();
  if (!uv) {
    return {
      ok: false,
      error: "uv not found on PATH. Install uv first: https://docs.astral.sh/uv/getting-started/installation/",
    };
  }
  try {
    const stdout = await runExec(uv, ["tool", "install", "mnemosyne-memory"], 180_000);
    const path = resolveCli("mnemosyne");
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

/** Diagnose: detect CLI, ensure data dir, run stats. Returns a structured report. */
export async function diagnoseMnemosyne(config) {
  const c = config ?? {};
  const cli = resolveCli(c.cli ?? "mnemosyne");
  const dataDir = c.dataDir ?? DEFAULT_DATA_DIR;
  if (!cli) return { ok: false, cliReady: false, error: "mnemosyne CLI not on PATH" };
  try {
    mkdirSync(dataDir, { recursive: true });
    const env = buildEnv(c);
    const stats = await runMnemosyne(cli, "stats", [], c.timeoutMs ?? 20_000, env);
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
  data_dir: "",
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
  dataDir: "data_dir",
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
  // Double-quoted
  if (s.startsWith('"') && s.endsWith('"')) return s.slice(1, -1).replace(/\\"/g, '"');
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
  const p = join(dataDir, "config.yaml");
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
  const p = join(dataDir, "config.yaml");
  mkdirSync(dataDir, { recursive: true });
  let raw = existsSync(p) ? readFileSync(p, "utf8") : "";
  for (const [snakeKey, val] of Object.entries(values)) {
    const lineVal = typeof val === "boolean" ? String(val) : String(val);
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

/** Run `mnemosyne config reload` to hot-reload the config file. */
export async function reloadMnemosyneConfig(cliPath, dataDir, timeoutMs = 10_000) {
  const env = { ...process.env, MNEMOSYNE_DATA_DIR: dataDir };
  return runMnemosyne(cliPath, "config", ["reload"], timeoutMs, env);
}

export function apply(ctx, config) {
  const cfg = () => config ?? {};
  const env = () => buildEnv(cfg());
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
    runMnemosyne(resolveCliPath(), command, args, cfg().timeoutMs ?? 20_000, env());

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
            sendJson(res, 200, await setupMnemosyne());
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
            try {
              const yaml = readMnemosyneConfigYaml(cfg().dataDir ?? DEFAULT_DATA_DIR);
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
              const dataDir = cfg().dataDir ?? DEFAULT_DATA_DIR;
              const result = writeMnemosyneConfigYaml(dataDir, body);
              // Hot-reload the config so changes take effect without restarting dsh
              let reloadMsg = "";
              try {
                const cli = resolveCliPath();
                if (cli) reloadMsg = await reloadMnemosyneConfig(cli, dataDir);
              } catch { /* reload failure is non-fatal — file is still written */ }
              sendJson(res, 200, { ...result, reload: reloadMsg.trim() });
            } catch (e) {
              sendJson(res, 500, { error: String(e?.message ?? e) });
            }
          } else if (req.method === "DELETE") {
            if (!sameOrigin(req)) return sendJson(res, 403, { error: "untrusted origin" });
            try {
              const dataDir = cfg().dataDir ?? DEFAULT_DATA_DIR;
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

  // Auto-sleep on turn/end: when auto_sleep is enabled in config.yaml and
  // working memory exceeds sleep_threshold, run `mnemosyne sleep` to
  // consolidate. Reads from config.yaml (dataDir/config.yaml) so panel edits
  // take effect without restart.
  ctx.effect(() =>
    ctx.on("session/event", async (_session, event) => {
      if (event?.type !== "turn/end") return;
      try {
        const dataDir = cfg().dataDir ?? DEFAULT_DATA_DIR;
        const yamlCfg = readMnemosyneConfigYaml(dataDir);
        const autoSleep = yamlCfg.auto_sleep_enabled !== "false" && yamlCfg.auto_sleep_enabled !== false;
        if (!autoSleep) return;
        const threshold = Number(yamlCfg.sleep_threshold) || 20;
        const cli = resolveCliPath();
        const e = env();
        const stats = await runMnemosyne(cli, "stats", [], cfg().timeoutMs ?? 20_000, e);
        const m = stats.match(/Working memory:\s*(\d+)/);
        const count = m ? Number(m[1]) : 0;
        if (count >= threshold) {
          await runMnemosyne(cli, "sleep", [], cfg().timeoutMs ?? 60_000, e);
        }
      } catch {
        // Auto-sleep failures are non-fatal — don't disrupt the session
      }
    }),
    "mnemosyne: auto-sleep on turn/end"
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
              return run("store", storeArgs(args));
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
              return run("recall", recallArgs({ query: args.query, topK: args.top_k }, cfg().defaultTopK ?? 5));
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
              return run("delete", [args.id]);
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
}

export const SKILL = {
  name: "mnemosyne",
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

## Installation

\`\`\`bash
dsh plugin --profile web add dsh-mnemosyne
# Then open the Mnemosyne panel in Settings and click Setup to install the CLI,
# or run: uv tool install mnemosyne-memory
\`\`\`
`,
};