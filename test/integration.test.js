// Integration tests for dsh-mnemosyne against the real `mnemosyne` CLI.
//
// These mirror the behavioural contract of the mnemosyne main repo's CLI
// tests (tests/test_cli_*.py) but exercise the plugin's own code path
// (runMnemosyne + storeArgs/recallArgs + the execute() closures registered
// by apply()). They require the `mnemosyne` binary on PATH; otherwise the
// whole suite is skipped. An isolated MNEMOSYNE_DATA_DIR + NO_EMBEDDINGS
// env keeps the user's real memory database untouched.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { apply, countConsolidations, migrateDefaultSessionToGlobal, migrateSessionScopesToDefault, recallArgs, resolveCli, resolvePythonInterp, runMnemosyne, storeArgs, writeMnemosyneConfigYaml } from "../src/index.js";

const CLI = resolveCli("mnemosyne");
const TIMEOUT = 30_000;

const suite = CLI ? describe : describe.skip;

let dataDir;
let savedEnv;
function createMockCtx() {
  const tools = [];
  const sessionEvents = [];
  const disposedHandlers = [];
  const ctx = {
    get: () => undefined, // no skills service in the minimal host
    effect: (fn) => fn(),
    on: (name, fn) => {
      if (name === "session/event") sessionEvents.push(fn);
      if (name === "session/disposed") disposedHandlers.push(fn);
      return () => {};
    },
    inject: (deps, fn) => {
      if (deps[0] === "tools") {
        fn({ effect: (fn) => fn(), tools: { register: (def) => (tools.push(def), () => {}) } });
      } else if (deps[0] === "webServer") {
        fn({ webServer: { register: () => () => {} }, effect: (fn) => fn() });
      } else if (deps[0] === "settings") {
        fn({ settings: { register: () => ({ get: () => ({}), watch: () => () => {} }) }, effect: (fn) => fn() });
      } else if (deps[0] === "agents") {
        fn({ effect: (fn) => fn() });
      }
    },
  };
  return { ctx, tools, sessionEvents, disposedHandlers };
}

suite("dsh-mnemosyne × real mnemosyne CLI", { concurrency: false }, () => {
  before(() => {
    dataDir = mkdtempSync(join(tmpdir(), "dsh-mnem-it-"));
    savedEnv = {
      MNEMOSYNE_DATA_DIR: process.env.MNEMOSYNE_DATA_DIR,
      MNEMOSYNE_NO_EMBEDDINGS: process.env.MNEMOSYNE_NO_EMBEDDINGS,
      MNEMOSYNE_BANK: process.env.MNEMOSYNE_BANK,
      MNEMOSYNE_SKIP_SETTINGS_FILE: process.env.MNEMOSYNE_SKIP_SETTINGS_FILE,
    };
    process.env.MNEMOSYNE_DATA_DIR = dataDir;
    process.env.MNEMOSYNE_NO_EMBEDDINGS = "1";
    delete process.env.MNEMOSYNE_BANK;
    process.env.MNEMOSYNE_SKIP_SETTINGS_FILE = "1";
  });

  after(() => {
    if (savedEnv.MNEMOSYNE_DATA_DIR === undefined) delete process.env.MNEMOSYNE_DATA_DIR;
    else process.env.MNEMOSYNE_DATA_DIR = savedEnv.MNEMOSYNE_DATA_DIR;
    if (savedEnv.MNEMOSYNE_NO_EMBEDDINGS === undefined) delete process.env.MNEMOSYNE_NO_EMBEDDINGS;
    else process.env.MNEMOSYNE_NO_EMBEDDINGS = savedEnv.MNEMOSYNE_NO_EMBEDDINGS;
    if (savedEnv.MNEMOSYNE_BANK === undefined) delete process.env.MNEMOSYNE_BANK;
    else process.env.MNEMOSYNE_BANK = savedEnv.MNEMOSYNE_BANK;
    if (savedEnv.MNEMOSYNE_SKIP_SETTINGS_FILE === undefined) delete process.env.MNEMOSYNE_SKIP_SETTINGS_FILE;
    else process.env.MNEMOSYNE_SKIP_SETTINGS_FILE = savedEnv.MNEMOSYNE_SKIP_SETTINGS_FILE;
    rmSync(dataDir, { recursive: true, force: true });
  });

  const run = (command, args) => runMnemosyne(CLI, command, args, TIMEOUT);
  const waitForMatch = async (query, pattern, timeoutMs = 15_000) => {
    const deadline = Date.now() + timeoutMs;
    let output = "";
    while (Date.now() < deadline) {
      output = await run("recall", [query, "5"]);
      if (pattern.test(output)) return output;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return output;
  };

  it("stats on a fresh isolated store shows zero totals", async () => {
    const out = await run("stats", []);
    assert.match(out, /Mnemosyne Stats/);
    assert.match(out, /Total memories: 0/);
    assert.match(out, /Working memory: 0/);
    assert.match(out, /Knowledge triples: 0/);
  });

  it("remember stores a memory and prints a hex id", async () => {
    const out = await run("store", storeArgs({ content: "it-remember-001 prefers pnpm", source: "dsh-it", importance: 0.9 }));
    assert.match(out, /^Stored: [0-9a-f]{16}$/);
  });

  it("recall returns nothing for an unmatched query", async () => {
    const out = await run("recall", recallArgs({ query: "zzz-unmatched-999" }, 5));
    assert.match(out, /Results for: zzz-unmatched-999/);
    assert.doesNotMatch(out, /ID:/);
  });

  it("recall finds a just-stored memory", async () => {
    const marker = "it-recall-hit-002 likes dark mode";
    const stored = await run("store", storeArgs({ content: marker, source: "dsh-it" }));
    const id = stored.split("Stored:")[1].trim();

    const out = await run("recall", recallArgs({ query: "dark mode preference" }, 5));
    assert.match(out, /Results for: dark mode preference/);
    assert.match(out, new RegExp(`ID: ${id}`));
    assert.match(out, /Content: .*dark mode/);
    assert.match(out, /Score:/);
  });

  it("forget deletes an existing memory", async () => {
    const stored = await run("store", storeArgs({ content: "it-forget-003 temp fact" }));
    const id = stored.split("Stored:")[1].trim();
    const out = await run("delete", [id]);
    assert.equal(out, `Deleted: ${id}`);
  });

  it("forget on a missing id reports an operation failure", async () => {
    await assert.rejects(run("delete", ["deadbeefdeadbeef"]), /Memory not found: deadbeefdeadbeef/);
  });

  it("sleep completes without error", async () => {
    const out = await run("sleep", []);
    assert.match(out, /Consolidation complete/);
  });

  it("end-to-end: remember → recall → forget → recall-empty", async () => {
    const marker = "it-e2e-004 user prefers vitest over jest";
    const stored = await run("store", storeArgs({ content: marker, source: "dsh-it", importance: 0.85 }));
    const id = stored.split("Stored:")[1].trim();
    assert.match(id, /^[0-9a-f]{16}$/);

    const hit = await run("recall", recallArgs({ query: "vitest testing preference" }, 5));
    assert.match(hit, new RegExp(`ID: ${id}`));
    assert.match(hit, /vitest/);

    const gone = await run("delete", [id]);
    assert.equal(gone, `Deleted: ${id}`);

    const after = await run("recall", recallArgs({ query: "vitest testing preference" }, 5));
    assert.doesNotMatch(after, new RegExp(`ID: ${id}`));
  });

  it("the plugin's execute() closures drive the real CLI", async () => {
    // apply() under a minimal host (no skills service); dataDir pinned to the
    // isolated env dir so nothing touches the user's real database.
    const { ctx, tools } = createMockCtx();
    apply(ctx, { cli: CLI, dataDir });
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));

    const marker = "it-execute-005 remembers to use uv for python";
    const stored = await byName.mnemosyne_remember.execute({ content: marker, source: "dsh-it", importance: 0.7 });
    const id = stored.split("Stored:")[1].trim();

    const stats = await byName.mnemosyne_stats.execute({});
    assert.match(stats, /Total memories:/);

    const recalled = await byName.mnemosyne_recall.execute({ query: "uv python", top_k: 5 });
    assert.match(recalled, new RegExp(`ID: ${id}`));

    const forgotten = await byName.mnemosyne_forget.execute({ id });
    assert.equal(forgotten, `Deleted: ${id}`);
  });

  it("sessionScope partitions memories per DSH session through the venv python helper", async () => {
    const { ctx, tools } = createMockCtx();
    apply(ctx, { cli: CLI, dataDir, sessionScope: true });
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
    const execA = {
      agent: { session: { id: "session-11111111-2222-3333-4444-555555555555", header: {} } },
    };
    const execB = {
      agent: { session: { id: "session-99999999-8888-7777-6666-555555555555", header: {} } },
    };

    const marker = "it-scope-006 private fact for session A only";
    const stored = await byName.mnemosyne_remember.execute({ content: marker, source: "dsh-it", importance: 0.8 }, execA);
    const id = stored.split("Stored:")[1].trim();
    assert.match(id, /^[0-9a-f]{16}$/);

    // Same session recalls its own row; another session cannot see it.
    const own = await byName.mnemosyne_recall.execute({ query: "private fact session", top_k: 5 }, execA);
    assert.match(own, new RegExp(`ID: ${id}`));
    const other = await byName.mnemosyne_recall.execute({ query: "private fact session", top_k: 5 }, execB);
    assert.doesNotMatch(other, new RegExp(`ID: ${id}`));

    // Forget is session-scoped too: session B cannot delete session A's row.
    await assert.rejects(byName.mnemosyne_forget.execute({ id }, execB), /Memory not found/);
    const deleted = await byName.mnemosyne_forget.execute({ id }, execA);
    assert.equal(deleted, `Deleted: ${id}`);
  });

  it("migrateSessionScopesToDefault restores dsh rows to legacy shared recall", async () => {
    const { ctx, tools } = createMockCtx();
    apply(ctx, { cli: CLI, dataDir, sessionScope: true });
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
    const exec = { agent: { session: { id: "session-4", header: { createdAt: 1700000000000 } } } };
    const marker = "scope-reverse-migration-7fd2";
    await byName.mnemosyne_remember.execute({ content: marker, source: "dsh-it" }, exec);
    const before = await run("recall", [marker, "5"]);
    assert.doesNotMatch(before, /ID:/);
    const result = await migrateSessionScopesToDefault(resolvePythonInterp(CLI), dataDir);
    assert.equal(result.ok, true);
    assert.ok(result.migrated >= 1);
    const after = await run("recall", [marker, "5"]);
    assert.match(after, new RegExp(marker));
  });

  it("migrateDefaultSessionToGlobal makes legacy default rows visible to session recall", async () => {
    const { ctx, tools } = createMockCtx();
    apply(ctx, { cli: CLI, dataDir, sessionScope: true });
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
    // Seed legacy rows into the "default" session via the plain CLI path
    const marker = "legacy-default-marker-8f3c";
    await run("store", [marker + " shared fact", "dsh-it", "0.7"]);
    await run("store", [marker + " another shared fact", "dsh-it", "0.7"]);
    // Before migration the rows are invisible to a session-scoped recall
    const execA = {
      agent: { session: { id: "session-11111111-2222-3333-4444-555555555555", header: {} } },
    };
    const before = await byName.mnemosyne_recall.execute({ query: marker, top_k: 5 }, execA);
    assert.doesNotMatch(before, /ID:/, "legacy rows must be invisible before migration");

    const res = await migrateDefaultSessionToGlobal(resolvePythonInterp(CLI), dataDir);
    assert.ok(res.ok);
    assert.ok(res.working >= 2, `expected >=2 working rows migrated, got ${res.working}`);

    const after = await byName.mnemosyne_recall.execute({ query: marker, top_k: 5 }, execA);
    assert.match(after, /ID:/, "migrated rows must be recallable from a session scope");
  });

  it("ignore_patterns in panel config.yaml filters stores via the env bridge", async () => {
    writeMnemosyneConfigYaml(dataDir, { ignore_patterns: "^git status" });
    try {
      const { ctx, tools } = createMockCtx();
      apply(ctx, { cli: CLI, dataDir });
      const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
      // Matching noise is silently dropped by the write filter (remember → None)
      const filtered = await byName.mnemosyne_remember.execute({
        content: "git status\nOn branch main",
        source: "dsh-it",
        importance: 0.5,
      });
      assert.match(filtered, /Stored: None/);
      // Non-matching content still stores normally
      const stored = await byName.mnemosyne_remember.execute({
        content: "it-filter-004 prefers pnpm",
        source: "dsh-it",
        importance: 0.7,
      });
      assert.match(stored, /^Stored: [0-9a-f]{16}/);
      const id = stored.split("Stored:")[1].trim();
      await byName.mnemosyne_forget.execute({ id });
    } finally {
      writeMnemosyneConfigYaml(dataDir, { ignore_patterns: "" });
    }
  });

  it("auto-sync writes one real user message at turn end and honors ignore_patterns", async () => {
    writeMnemosyneConfigYaml(dataDir, { ignore_patterns: "^git status", sync_roles: "user" });
    try {
      const { ctx, sessionEvents } = createMockCtx();
      apply(ctx, { cli: CLI, dataDir, autoSync: true, sessionScope: false });
      const handler = sessionEvents[0];
      const session = { id: "session-auto-sync", header: { createdAt: 1 } };
      const marker = "noise-token-9c1e";
      await handler(session, {
        type: "user/message",
        data: { id: "test-id", role: "user", content: [{ type: "text", text: "git status\nOn branch main " + marker }], source: { kind: "user" } },
      });
      await handler(session, { type: "turn/end", data: { turn: 1 } });
      const outBeforeNormal = await run("recall", [marker, "5"]);
      assert.doesNotMatch(outBeforeNormal, /ID:/, "filtered noise must not be stored by auto-sync");

      const userMarker = "auto-sync-user-4b02";
      const assistantMarker = "auto-sync-assistant-7c31";
      await handler(session, {
        type: "user/message",
        data: { id: "test-id-2", role: "user", content: [{ type: "text", text: "regular user message " + userMarker }], source: { kind: "user" } },
      });
      await handler(session, {
        type: "assistant/message",
        data: { message: { role: "assistant", content: [{ type: "text", text: "intermediate assistant output " + assistantMarker }] } },
      });
      await handler(session, { type: "turn/end", data: { turn: 2 } });
      const userOut = await waitForMatch(userMarker, /ID:/);
      assert.match(userOut, /ID:/, "real user conversation must be stored at turn end");
      const assistantOut = await run("recall", [assistantMarker, "5"]);
      assert.doesNotMatch(assistantOut, new RegExp(`Content: .*${assistantMarker}`), "assistant output is opt-in via sync_roles");
    } finally {
      writeMnemosyneConfigYaml(dataDir, { ignore_patterns: "", sync_roles: "user" });
    }
  });

  it("auto-sync applies Hermes limits and zero preserves the full user message", async () => {
    const keptMarker = "sync-limit-kept-61ab";
    const cutMarker = "sync-limit-cut-9e42";
    const limited = createMockCtx();
    apply(limited.ctx, {
      cli: CLI,
      dataDir,
      autoSync: true,
      sessionScope: false,
      syncTurnUserLimit: keptMarker.length,
    });
    const limitedSession = { id: "session-sync-limit", header: { createdAt: 3 } };
    await limited.sessionEvents[0](limitedSession, {
      type: "user/message",
      data: {
        role: "user",
        content: [{ type: "text", text: `${keptMarker} ${"x".repeat(80)} ${cutMarker}` }],
        source: { kind: "user" },
      },
    });
    await limited.sessionEvents[0](limitedSession, { type: "turn/end", data: { turn: 1 } });
    assert.match(await waitForMatch(keptMarker, /ID:/), /ID:/);
    assert.doesNotMatch(
      await run("recall", [cutMarker, "5"]),
      new RegExp(`Content: .*${cutMarker}`),
    );

    const tailMarker = "sync-limit-full-tail-74cd";
    const unlimited = createMockCtx();
    apply(unlimited.ctx, {
      cli: CLI,
      dataDir,
      autoSync: true,
      sessionScope: false,
      syncTurnUserLimit: 0,
    });
    const unlimitedSession = { id: "session-sync-unlimited", header: { createdAt: 4 } };
    await unlimited.sessionEvents[0](unlimitedSession, {
      type: "user/message",
      data: {
        role: "user",
        content: [{ type: "text", text: `full message ${"y".repeat(700)} ${tailMarker}` }],
        source: { kind: "user" },
      },
    });
    await unlimited.sessionEvents[0](unlimitedSession, { type: "turn/end", data: { turn: 1 } });
    assert.match(await waitForMatch(tailMarker, /ID:/), /ID:/);
  });

  it("auto-sync ignores skill catalogs and agent instructions", async () => {
    const { ctx, sessionEvents } = createMockCtx();
    apply(ctx, { cli: CLI, dataDir, autoSync: true });
    const handler = sessionEvents[0];
    const session = { id: "session-auto-injected", header: { createdAt: 2 } };
    const marker = "injected-skill-catalog-8af1";
    for (const kind of ["skill-catalog", "agent-instructions", "plugin"]) {
      await handler(session, {
        type: "user/message",
        data: { role: "user", content: [{ type: "text", text: marker + " " + kind }], source: { kind } },
      });
    }
    await handler(session, { type: "turn/end", data: { turn: 1 } });
    const out = await run("recall", [marker, "5"]);
    assert.doesNotMatch(out, /ID:/);
  });

  it("periodic auto-sleep uses the config.yaml threshold and skips a cleared one", async () => {
    // Behavioural pinning of resolveSleepThreshold() against a real CLI: the
    // cleared-threshold case is fully covered in the unit suite ("" / 0 / -3 /
    // "abc" all resolve to the 50 default). Here we only prove the periodic
    // 10-turn check reads the YAML value and that a huge threshold stays quiet.
    writeMnemosyneConfigYaml(dataDir, { sleep_threshold: 100000, auto_sleep_enabled: true });
    try {
      const { ctx, sessionEvents } = createMockCtx();
      apply(ctx, { cli: CLI, dataDir, autoSync: true, sessionScope: false });
      const handler = sessionEvents[0];
      const session = { id: "session-it-threshold", header: { createdAt: 13 } };
      const marker = "threshold-huge-3f88";
      await handler(session, {
        type: "user/message",
        data: { role: "user", content: [{ type: "text", text: marker + " preference" }], source: { kind: "user" } },
      });
      await handler(session, { type: "turn/end", data: { turn: 1 } });
      assert.match(await waitForMatch(marker, /ID:/), /ID:/);
      const before = await countConsolidations(dataDir);
      for (let turn = 2; turn <= 10; turn++) {
        await handler(session, { type: "turn/end", data: { turn } });
      }
      await new Promise((r) => setTimeout(r, 800));
      assert.equal(await countConsolidations(dataDir), before, "huge threshold must keep the periodic check quiet");
      const stillThere = await run("recall", [marker, "5"]);
      assert.match(stillThere, /ID:/, "the row must remain in working memory");
    } finally {
      writeMnemosyneConfigYaml(dataDir, { sleep_threshold: 50 });
    }
  });
});