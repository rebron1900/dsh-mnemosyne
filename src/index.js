import { execFile } from "node:child_process";
import { accessSync, constants, mkdirSync } from "node:fs";
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

  // Persist config into the DSH settings namespace when the settings service is
  // available (web profile). Headless/minimal hosts keep using entry config.
  const settings = ctx.get("settings");
  if (settings) {
    ctx.effect(() => settings.register("mnemosyne", Config, { base: cfg() }), "mnemosyne: settings namespace");
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

    hostCtx.effect(() => () => disposers.forEach((d) => d?.()), "mnemosyne: http routes");
  });

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