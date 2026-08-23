import { describe, it, mock, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { homedir } from "node:os";
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
} from "../src/index.js";

/** Minimal cordis-style ctx: runs inject callbacks immediately, collects registrations. */
function createMockCtx() {
  const tools = [];
  const skills = [];
  const effects = [];
  const ctx = {
    get: (key) => (key === "skills" ? { register: (s) => skills.push(s) } : undefined),
    effect: (fn) => effects.push(fn()),
    on: () => () => {},
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
      }
    },
  };
  return { ctx, tools, skills };
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

  it("injects only explicitly-set fields and leaves user env untouched otherwise", () => {
    const base = { MNEMOSYNE_EMBEDDING_MODEL: "user-kept-model", PATH: "/usr/bin" };
    const env = buildEnv(
      { dataDir: "/tmp/d", embeddingModel: "BAAI/bge-small-zh-v1.5", embeddingDim: 512, llmEnabled: false, polyphonicRecall: true },
      base
    );
    assert.equal(env.MNEMOSYNE_DATA_DIR, "/tmp/d");
    assert.equal(env.MNEMOSYNE_EMBEDDING_MODEL, "BAAI/bge-small-zh-v1.5");
    assert.equal(env.MNEMOSYNE_EMBEDDING_DIM, "512");
    assert.equal(env.MNEMOSYNE_LLM_ENABLED, "false");
    assert.equal(env.MNEMOSYNE_POLYPHONIC_RECALL, "1");
    assert.equal(env.MNEMOSYNE_NO_EMBEDDINGS, undefined);
    assert.equal(env.PATH, "/usr/bin");
  });

  it("sets NO_EMBEDDINGS only when explicitly true", () => {
    assert.equal(buildEnv({ noEmbeddings: true }, {}).MNEMOSYNE_NO_EMBEDDINGS, "1");
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

describe("panel HTTP routes", () => {
  let dir;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "dsh-mnem-route-")); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  function createRouteCtx(config) {
    let handler = null;
    const ctx = {
      get: (key) => (key === "skills" ? { register: () => {} } : undefined),
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
