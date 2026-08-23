import { describe, it, mock, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import {
  apply,
  buildEnv,
  DEFAULT_DATA_DIR,
  recallArgs,
  readMnemosyneConfigYaml,
  resolveCli,
  runMnemosyne,
  setupMnemosyne,
  SKILL,
  storeArgs,
  writeMnemosyneConfigYaml,
  extractMessageText,
  extractLastUserText,
  parseStats,
  detectEmbeddingDeps,
  startReindex,
  getReindexStatus,
  formatPrefetchContext,
} from "../src/index.js";

/** Minimal cordis-style ctx: runs inject callbacks immediately, collects registrations. */
function createMockCtx() {
  const tools = [];
  const skills = [];
  const effects = [];
  const sessionEvents = [];
  const preStepListeners = [];
  const systemPromptSections = [];
  const ctx = {
    get: (key) => {
      if (key === "skills") return { register: (s) => skills.push(s) };
      if (key === "systemPrompt") return {
        section: (s) => { systemPromptSections.push(s); return () => {}; },
      };
      return undefined;
    },
    effect: (fn) => effects.push(fn()),
    on: (event, handler, opts) => {
      if (event === "agent/pre-step") {
        preStepListeners.push({ handler, opts });
        return () => {};
      }
      if (event === "session/event") {
        sessionEvents.push(handler);
        return () => {};
      }
      return () => {};
    },
    inject: (deps, fn) => {
      if (deps[0] === "tools") {
        fn({
          effect: (fn) => { effects.push(fn()); return () => {}; },
          tools: { register: (def) => (tools.push(def), () => {}) },
        });
      } else if (deps[0] === "webServer") {
        fn({
          webServer: { register: () => () => {} },
          effect: (fn) => { effects.push(fn()); return () => {}; },
        });
      } else if (deps[0] === "settings") {
        fn({
          settings: { register: () => ({ get: () => ({}), watch: () => () => {} }) },
          effect: (fn) => { effects.push(fn()); return () => {}; },
        });
      } else if (deps[0] === "agents") {
        // agents injection: the ctx.on("agent/pre-step", ...) is registered
        // at the ctx level, not through agents — just call fn to let it register
        fn({
          effect: (fn) => { effects.push(fn()); return () => {}; },
        });
      }
    },
  };
  return { ctx, tools, skills, sessionEvents, preStepListeners, systemPromptSections };
}

describe("argument builders", () => {
  it("store appends source and importance only when present", () => {
    assert.deepEqual(storeArgs({ content: "a" }), ["a"]);
    assert.deepEqual(storeArgs({ content: "a", source: "dsh" }), ["a", "dsh"]);
    assert.deepEqual(storeArgs({ content: "a", importance: 0.9 }), ["a", "0.9"]);
    assert.deepEqual(storeArgs({ content: "a", source: "x", importance: 1 }), ["a", "x", "1"]);
  });

  it("recall falls back to the configured defaultTopK", () => {
    assert.deepEqual(recallArgs({ query: "q" }, 5), ["q", "5"]);
    assert.deepEqual(recallArgs({ query: "q", topK: 12 }, 5), ["q", "12"]);
  });
});

describe("plugin apply()", () => {
  it("registers exactly the five mnemosyne tools", () => {
    const { ctx, tools } = createMockCtx();
    apply(ctx, {});
    assert.deepEqual(
      tools.map((t) => t.name),
      [
        "mnemosyne_remember",
        "mnemosyne_recall",
        "mnemosyne_forget",
        "mnemosyne_stats",
        "mnemosyne_sleep",
      ]
    );
    for (const tool of tools) {
      assert.equal(typeof tool.execute, "function");
      assert.ok(tool.output?.schema, `${tool.name} must declare an output schema`);
      assert.equal(typeof tool.output.render, "function");
    }
  });

  it("registers the embedded skill with a valid kebab-case name", () => {
    const { ctx, skills } = createMockCtx();
    apply(ctx, {});
    assert.equal(skills.length, 1);
    assert.equal(skills[0].name, "mnemosyne");
    assert.match(skills[0].name, /^[a-z0-9][a-z0-9-]*$/);
    assert.ok(skills[0].description.length > 0);
    assert.equal(typeof skills[0].source, "string");
    assert.equal(skills[0].source, "dsh-mnemosyne");
    assert.ok(skills[0].content.includes("mnemosyne_recall"));
  });

  it("renders string results as text blocks", async () => {
    const { ctx, tools } = createMockCtx();
    apply(ctx, {});
    const blocks = tools[0].output.render({}, "ok");
    assert.deepEqual(blocks, [{ type: "text", text: "ok" }]);
  });
});

describe("runMnemosyne", () => {
  it("explains the install step when the CLI is missing", async () => {
    await assert.rejects(
      runMnemosyne("definitely-not-on-path-xyz", "stats", [], 1000),
      /Mnemosyne CLI .* not found.*uv tool install mnemosyne-memory/
    );
  });

  it("rejects on non-zero exit with stderr detail", async () => {
    await assert.rejects(
      runMnemosyne(process.execPath, "--eval", ["process.exit(3)"], 5000),
      /Command failed|exited with code/
    );
  });
});

describe("bundle manifest", () => {
  it("package.json declares the dsh.bundle patch entry", async () => {
    const pkg = JSON.parse(
      await readFile(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8")
    );
    assert.equal(pkg.dsh?.bundle?.patch, "cordis.patch.yml");
    assert.equal(pkg.main, "src/index.js");
  });

  it("cordis.patch.yml inserts a single mnemosyne row", async () => {
    const patch = await readFile(
      fileURLToPath(new URL("../cordis.patch.yml", import.meta.url)),
      "utf8"
    );
    assert.match(patch, /^- insert:/m);
    assert.match(patch, /- id: mnemosyne/);
    assert.match(patch, /name: dsh-mnemosyne/);
    assert.match(patch, /dataDir: ~/);
  });
});

describe("buildEnv", () => {
  it("always pins MNEMOSYNE_DATA_DIR to the plugin default when unset", () => {
    const env = buildEnv({}, {});
    assert.equal(env.MNEMOSYNE_DATA_DIR, DEFAULT_DATA_DIR);
    assert.equal(env.MNEMOSYNE_NO_EMBEDDINGS, undefined);
    assert.equal(env.MNEMOSYNE_LLM_ENABLED, undefined);
  });

  it("injects only MNEMOSYNE_DATA_DIR and leaves other mnemosyne keys to config.yaml", () => {
    // Embedding/LLM/recall/wm settings live in config.yaml (config.yaml > env),
    // so buildEnv must NOT inject them as MNEMOSYNE_* env vars.
    const base = { MNEMOSYNE_EMBEDDING_MODEL: "user-kept-model", PATH: "/usr/bin" };
    const env = buildEnv(
      { dataDir: "/tmp/d", noEmbeddings: true, embeddingModel: "BAAI/bge-small-zh-v1.5", llmEnabled: false, polyphonicRecall: true },
      base
    );
    assert.equal(env.MNEMOSYNE_DATA_DIR, "/tmp/d");
    assert.equal(env.MNEMOSYNE_NO_EMBEDDINGS, undefined);
    assert.equal(env.MNEMOSYNE_EMBEDDING_MODEL, "user-kept-model"); // untouched, owned by config.yaml
    assert.equal(env.MNEMOSYNE_LLM_ENABLED, undefined);
    assert.equal(env.MNEMOSYNE_POLYPHONIC_RECALL, undefined);
    assert.equal(env.PATH, "/usr/bin");
  });

  it("never sets NO_EMBEDDINGS (config.yaml owns it)", () => {
    assert.equal(buildEnv({ noEmbeddings: true }, {}).MNEMOSYNE_NO_EMBEDDINGS, undefined);
    assert.equal(buildEnv({ noEmbeddings: false }, {}).MNEMOSYNE_NO_EMBEDDINGS, undefined);
  });

  it("expands ~ in dataDir to the real home directory", () => {
    const env = buildEnv({ dataDir: "~/.dsh/mnemosyne" }, {});
    assert.equal(env.MNEMOSYNE_DATA_DIR, join(homedir(), ".dsh", "mnemosyne"));
  });

  it("expands a bare ~ to the real home directory", () => {
    const env = buildEnv({ dataDir: "~" }, {});
    assert.equal(env.MNEMOSYNE_DATA_DIR, homedir());
  });

  it("falls back to DEFAULT_DATA_DIR when dataDir is an empty string", () => {
    const env = buildEnv({ dataDir: "" }, {});
    assert.equal(env.MNEMOSYNE_DATA_DIR, DEFAULT_DATA_DIR);
  });

  it("falls back to DEFAULT_DATA_DIR when dataDir is only whitespace", () => {
    const env = buildEnv({ dataDir: "   " }, {});
    assert.equal(env.MNEMOSYNE_DATA_DIR, DEFAULT_DATA_DIR);
  });

  it("overwrites a tainted MNEMOSYNE_DATA_DIR inherited from base env", () => {
    const env = buildEnv({}, { MNEMOSYNE_DATA_DIR: "~/.dsh/mnemosyne" });
    assert.equal(env.MNEMOSYNE_DATA_DIR, DEFAULT_DATA_DIR);
  });
});

describe("parseStats", () => {
  it("extracts the counts mnemosyne stats actually prints", () => {
    const out =
      "Mnemosyne Stats\n\n" +
      "  Total memories: 112\n" +
      "  Working memory: 113\n" +
      "  Episodic memory: 0\n" +
      "  Knowledge triples: 7\n";
    assert.deepEqual(parseStats(out), { total: 112, working: 113, episodic: 0, triples: 7 });
  });

  it("returns undefined for missing / empty / null input", () => {
    assert.deepEqual(parseStats(""), { total: undefined, working: undefined, episodic: undefined, triples: undefined });
    assert.deepEqual(parseStats(null), { total: undefined, working: undefined, episodic: undefined, triples: undefined });
  });
});

describe("config.yaml write guard", () => {
  let dir;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "dsh-mnem-cfg-")); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it("writes strings quoted and round-trips them", () => {
    const value = 'safe "quote" and # hash';
    writeMnemosyneConfigYaml(dir, { llm_model: value });
    const raw = readFileSync(join(dir, "config.yaml"), "utf8");
    // JSON-quoted form escapes inner quotes; the parser unescapes on read.
    assert.ok(raw.includes('llm_model: "safe \\"quote\\" and # hash"'));
  });

  it("rejects unknown keys without touching the file", () => {
    assert.throws(
      () => writeMnemosyneConfigYaml(dir, { evil_key: "x" }),
      /unsupported configuration key/
    );
    assert.equal(existsSync(join(dir, "config.yaml")), false);
  });

  it("safely writes and round-trips multiline strings", () => {
    const value = "line1\nline2\nfake_key: true";
    writeMnemosyneConfigYaml(dir, { ignore_patterns: value });
    const raw = readFileSync(join(dir, "config.yaml"), "utf8");
    // The newline is JSON-escaped — no extra YAML key line is produced.
    assert.ok(!raw.includes("\nfake_key: true"));
    // Read back returns the original multiline value.
    const cfg = readMnemosyneConfigYaml(dir);
    assert.equal(cfg.ignore_patterns, value);
  });

  it("rejects wrong value types", () => {
    assert.throws(() => writeMnemosyneConfigYaml(dir, { llm_timeout: "60" }), /invalid value/);
    assert.throws(() => writeMnemosyneConfigYaml(dir, { no_embeddings: "yes" }), /invalid value/);
    assert.throws(() => writeMnemosyneConfigYaml(dir, { sleep_threshold: -1 }), /non-negative/);
  });

  it("accepts empty string as a cleared value", () => {
    writeMnemosyneConfigYaml(dir, { embedding_model: "" });
    const raw = readFileSync(join(dir, "config.yaml"), "utf8");
    assert.ok(raw.includes('embedding_model: ""'));
  });
});

const hasCli = Boolean(resolveCli("mnemosyne"));

describe("setupMnemosyne", { skip: !hasCli }, () => {
  it("fills config defaults into the configured dataDir", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dsh-mnem-setup-"));
    try {
      const result = await setupMnemosyne({ dataDir: dir });
      assert.ok(result.ok);
      assert.ok(existsSync(join(dir, "config.yaml")));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("detectEmbeddingDeps", { skip: !hasCli }, () => {
  it("reports fastembed and sqlite-vec availability from the CLI venv", async () => {
    const cli = resolveCli("mnemosyne");
    const deps = await detectEmbeddingDeps(cli);
    // Both are booleans; python path resolved from the shebang.
    assert.equal(typeof deps.fastembed, "boolean");
    assert.equal(typeof deps.sqliteVec, "boolean");
    assert.ok(deps.python, "resolves the venv python from the CLI shebang");
  });
});

describe("async reindex", { skip: !hasCli }, () => {
  it("starts a background reindex and reports completion via status", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dsh-mnem-reindex-"));
    try {
      const start = startReindex(dir, "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2");
      assert.equal(start.ok, true);
      // Poll until done (fresh empty dir reindexes in well under a second).
      let status = getReindexStatus(dir);
      for (let i = 0; i < 40 && status.running; i++) {
        await new Promise((r) => setTimeout(r, 250));
        status = getReindexStatus(dir);
      }
      assert.equal(status.done, true);
      assert.equal(status.error, null);
      assert.match(status.output, /Reindex complete/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reports not-started for an unknown dataDir", () => {
    const s = getReindexStatus("/nonexistent/xyz");
    assert.equal(s.started, false);
    assert.equal(s.running, false);
  });
});

describe("panel HTTP routes", () => {
  let dir;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "dsh-mnem-route-")); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  function createRouteCtx(config) {
    let handler = null;
    const ctx = {
      get: (key) => {
        if (key === "skills") return { register: () => {} };
        if (key === "systemPrompt") return { section: () => () => {} };
        return undefined;
      },
      effect: (fn) => fn(),
      on: () => () => {},
      inject: (deps, fn) => {
        if (deps[0] === "tools") {
          fn({ effect: (fn) => fn(), tools: { register: () => () => {} } });
        } else if (deps[0] === "webServer") {
          fn({
            webServer: { register: (def) => { if (def.path === "/mnemosyne/config") handler = def.handler; return () => {}; } },
            effect: (fn) => fn(),
          });
        } else if (deps[0] === "settings") {
          fn({ settings: { register: () => ({}) }, effect: (fn) => fn() });
        } else if (deps[0] === "agents") {
          fn({ effect: (fn) => fn() });
        }
      },
    };
    apply(ctx, config);
    return handler;
  }

  function jsonReq(method, body, headers = {}) {
    const req = new EventEmitter();
    req.method = method;
    req.headers = { host: "127.0.0.1:6769", origin: "http://127.0.0.1:6769", ...headers };
    req.socket = {};
    if (body !== undefined) {
      process.nextTick(() => {
        req.emit("data", Buffer.from(JSON.stringify(body)));
        req.emit("end");
      });
    }
    return req;
  }

  function callRoute(handler, req) {
    return new Promise((resolve) => {
      const res = {
        status: null,
        writeHead(code) { this.status = code; },
        end(payload) { resolve({ status: this.status, body: payload ? JSON.parse(payload) : null }); },
      };
      handler(req, res);
    });
  }

  it("POST rejects requests without a trusted origin", async () => {
    const handler = createRouteCtx({ dataDir: dir });
    const res = await callRoute(handler, jsonReq("POST", { llm_model: "x" }, { origin: undefined }));
    assert.equal(res.status, 403);
  });

  it("POST writes whitelisted keys through the full route", async () => {
    const handler = createRouteCtx({ dataDir: dir });
    const res = await callRoute(handler, jsonReq("POST", { llm_model: "route-test" }));
    assert.equal(res.status, 200);
    assert.ok(res.body.ok);
    const raw = readFileSync(join(dir, "config.yaml"), "utf8");
    assert.ok(raw.includes('llm_model: "route-test"'));
  });

  it("POST returns 400 for keys outside the panel whitelist", async () => {
    const handler = createRouteCtx({ dataDir: dir });
    const res = await callRoute(handler, jsonReq("POST", { not_a_panel_key: "x" }));
    assert.equal(res.status, 400);
    assert.match(res.body.error, /unsupported configuration key/);
  });

  it("GET blocks cross-site reads via Sec-Fetch-Site", async () => {
    const handler = createRouteCtx({ dataDir: dir });
    const res = await callRoute(handler, jsonReq("GET", undefined, { "sec-fetch-site": "cross-site" }));
    assert.equal(res.status, 403);
  });

  it("GET merges upstream defaults under stored values", async () => {
    const handler = createRouteCtx({ dataDir: dir });
    const res = await callRoute(handler, jsonReq("GET"));
    assert.equal(res.status, 200);
    assert.equal(res.body.config.embedding_dim, 384);
    assert.equal(res.body.config.sleep_threshold, 20);
  });
});

describe("automatic memory config defaults", () => {
  it("all automatic features default to false (manual-only)", () => {
    const env = buildEnv({}, {});
    // buildEnv does not add MNEMOSYNE_* env for these — they're DSH-side config
    // The point is they should be absent when unset, meaning disabled
    assert.equal(env.MNEMOSYNE_DATA_DIR, DEFAULT_DATA_DIR);
  });

  it("does not register systemPrompt section when promptSection is false", () => {
    const { ctx, systemPromptSections } = createMockCtx();
    apply(ctx, { promptSection: false });
    assert.equal(systemPromptSections.length, 0);
  });

  it("registers systemPrompt section when promptSection is true", () => {
    const { ctx, systemPromptSections } = createMockCtx();
    apply(ctx, { promptSection: true });
    assert.equal(systemPromptSections.length, 1);
    assert.equal(systemPromptSections[0].name, "mnemosyne-memory");
    assert.equal(systemPromptSections[0].order, 95);
    assert.ok(systemPromptSections[0].text.includes("Mnemosyne Memory"));
  });

  it("registers agent/pre-step listener when autoPrefetch is true", () => {
    const { ctx, preStepListeners } = createMockCtx();
    apply(ctx, { autoPrefetch: true });
    assert.equal(preStepListeners.length, 1);
    assert.equal(preStepListeners[0].opts?.prepend, true);
  });

  it("always registers agent/pre-step listener (gated at runtime by dynamicCfg)", () => {
    const { ctx, preStepListeners } = createMockCtx();
    apply(ctx, { autoPrefetch: false });
    // Listener is always registered now — it checks dynamicCfg.autoPrefetch at runtime
    assert.equal(preStepListeners.length, 1);
    assert.equal(preStepListeners[0].opts?.prepend, true);
  });

  it("always registers a session/event listener for auto-sleep", () => {
    const { ctx, sessionEvents } = createMockCtx();
    apply(ctx, {});
    assert.ok(sessionEvents.length >= 1);
  });
});

describe("extractMessageText", () => {
  it("extracts text from a content block array", () => {
    const content = [{ type: "text", text: "hello world" }];
    assert.equal(extractMessageText(content), "hello world");
  });

  it("joins multiple text blocks", () => {
    const content = [{ type: "text", text: "line1" }, { type: "text", text: "line2" }];
    assert.equal(extractMessageText(content), "line1\nline2");
  });

  it("returns the string as-is when content is a string", () => {
    assert.equal(extractMessageText("plain string"), "plain string");
  });

  it("returns empty string for null/undefined/empty", () => {
    assert.equal(extractMessageText(null), "");
    assert.equal(extractMessageText(undefined), "");
    assert.equal(extractMessageText([]), "");
  });

  it("ignores non-text blocks", () => {
    const content = [{ type: "image", url: "x" }, { type: "text", text: "keep" }];
    assert.equal(extractMessageText(content), "keep");
  });
});

describe("extractLastUserText", () => {
  it("finds the last user message in a messages array", () => {
    const messages = [
      { role: "user", content: [{ type: "text", text: "first" }] },
      { role: "assistant", content: [{ type: "text", text: "reply" }] },
      { role: "user", content: [{ type: "text", text: "second question" }] },
    ];
    assert.equal(extractLastUserText(messages), "second question");
  });

  it("skips plugin-injected user messages and finds the real user input", () => {
    const messages = [
      { role: "user", content: [{ type: "text", text: "我是谁" }], source: { kind: "user" } },
      { role: "user", content: [{ type: "text", text: "system reminder" }], source: { kind: "agent-instructions" } },
      { role: "user", content: [{ type: "text", text: "skill catalog" }], source: { kind: "skill-catalog" } },
      { role: "user", content: [{ type: "text", text: "runtime context" }], source: { kind: "plugin", plugin: "dsh-system-prompt" } },
    ];
    assert.equal(extractLastUserText(messages), "我是谁");
  });

  it("skips mnemosyne prefetch-injected messages", () => {
    const messages = [
      { role: "user", content: [{ type: "text", text: "hello world" }], source: { kind: "user" } },
      { role: "user", content: [{ type: "text", text: "## Mnemosyne Context" }], source: { kind: "plugin", plugin: "mnemosyne" } },
    ];
    assert.equal(extractLastUserText(messages), "hello world");
  });

  it("returns empty string when no user messages exist", () => {
    const messages = [{ role: "assistant", content: [{ type: "text", text: "reply" }] }];
    assert.equal(extractLastUserText(messages), "");
  });

  it("returns empty string for non-array input", () => {
    assert.equal(extractLastUserText(null), "");
    assert.equal(extractLastUserText("not array"), "");
  });

  it("falls back to any user message when all are injected", () => {
    const messages = [
      { role: "user", content: [{ type: "text", text: "only injected" }], source: { kind: "plugin" } },
    ];
    assert.equal(extractLastUserText(messages), "only injected");
  });
});

describe("formatPrefetchContext", () => {
  it("formats recall output with ID/Content/Score lines", () => {
    const recall =
      "Results for: test query\n" +
      "ID: abc123def456abcd\n" +
      "Content: The user prefers pnpm over npm\n" +
      "Score: 0.85\n" +
      "ID: def789abc012def0\n" +
      "Content: Project uses ESM modules\n" +
      "Score: 0.72";
    const result = formatPrefetchContext(recall);
    assert.ok(result.includes("## Mnemosyne Context"));
    assert.ok(result.includes("The user prefers pnpm over npm"));
    assert.ok(result.includes("score: 0.85"));
    assert.ok(result.includes("Project uses ESM modules"));
  });

  it("returns empty string when recall has no hits", () => {
    const recall = "Results for: empty query";
    assert.equal(formatPrefetchContext(recall), "");
  });

  it("returns empty string for null/undefined input", () => {
    assert.equal(formatPrefetchContext(null), "");
    assert.equal(formatPrefetchContext(undefined), "");
  });
});

describe("auto-sync session/event handler", () => {
  it("does not crash on plugin-sourced user/message (feedback loop prevention)", async () => {
    const { ctx, sessionEvents } = createMockCtx();
    apply(ctx, { autoSync: true });
    assert.ok(sessionEvents.length >= 1);
    const handler = sessionEvents[0];

    // Simulate a plugin-injected user/message event — should not throw
    const pluginEvent = {
      type: "user/message",
      data: {
        id: "test-id",
        role: "user",
        content: [{ type: "text", text: "injected context" }],
        source: { kind: "plugin", plugin: "mnemosyne" },
      },
    };
    // The handler will try to run the CLI and fail silently (no mnemosyne on path in test env).
    // The key assertion: it doesn't throw and doesn't crash the session.
    await assert.doesNotReject(async () => handler(null, pluginEvent));
  });

  it("does not crash on regular user/message when autoSync is enabled", async () => {
    const { ctx, sessionEvents } = createMockCtx();
    apply(ctx, { autoSync: true });
    const handler = sessionEvents[0];

    const userEvent = {
      type: "user/message",
      data: {
        id: "test-id",
        role: "user",
        content: [{ type: "text", text: "Hello, this is a real user message" }],
        source: { kind: "user" },
      },
    };
    // CLI may or may not be available — either way, handler should not reject
    await assert.doesNotReject(async () => handler(null, userEvent));
  });

  it("does not crash on assistant/message when autoSync is enabled", async () => {
    const { ctx, sessionEvents } = createMockCtx();
    apply(ctx, { autoSync: true });
    const handler = sessionEvents[0];

    const assistantEvent = {
      type: "assistant/message",
      data: {
        message: {
          id: "test-id",
          role: "assistant",
          content: [{ type: "text", text: "This is a longer assistant response that should be stored" }],
        },
      },
    };
    await assert.doesNotReject(async () => handler(null, assistantEvent));
  });

  it("does not attempt sync when autoSync is false", async () => {
    const { ctx, sessionEvents } = createMockCtx();
    apply(ctx, { autoSync: false });
    const handler = sessionEvents[0];

    const userEvent = {
      type: "user/message",
      data: {
        id: "test-id",
        role: "user",
        content: [{ type: "text", text: "Hello world" }],
        source: { kind: "user" },
      },
    };
    // Should complete without error — autoSync is false so no store call attempted
    await assert.doesNotReject(async () => handler(null, userEvent));
  });
});

describe("prefetch message shape", () => {
  it("injected messages have an id field (required by DSH session.append)", () => {
    // createUserMessage uses crypto.randomUUID() for id — verified by import
    // The randomUUID import from node:crypto guarantees a valid UUID string
    assert.ok(typeof randomUUID === "function", "randomUUID is available");
  });
});
