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

import { apply, recallArgs, resolveCli, runMnemosyne, storeArgs } from "../src/index.js";

const CLI = resolveCli("mnemosyne");
const TIMEOUT = 30_000;

const suite = CLI ? describe : describe.skip;

let dataDir;
let savedEnv;
function createMockCtx() {
  const tools = [];
  const ctx = {
    get: () => undefined, // no skills service in the minimal host
    effect: (fn) => fn(),
    inject: (_deps, fn) =>
      fn({
        effect: (fn) => fn(),
        tools: { register: (def) => (tools.push(def), () => {}) },
      }),
  };
  return { ctx, tools };
}

suite("dsh-mnemosyne × real mnemosyne CLI", { concurrency: false }, () => {
  before(() => {
    dataDir = mkdtempSync(join(tmpdir(), "dsh-mnem-it-"));
    savedEnv = {
      MNEMOSYNE_DATA_DIR: process.env.MNEMOSYNE_DATA_DIR,
      MNEMOSYNE_NO_EMBEDDINGS: process.env.MNEMOSYNE_NO_EMBEDDINGS,
    };
    process.env.MNEMOSYNE_DATA_DIR = dataDir;
    process.env.MNEMOSYNE_NO_EMBEDDINGS = "1";
  });

  after(() => {
    if (savedEnv.MNEMOSYNE_DATA_DIR === undefined) delete process.env.MNEMOSYNE_DATA_DIR;
    else process.env.MNEMOSYNE_DATA_DIR = savedEnv.MNEMOSYNE_DATA_DIR;
    if (savedEnv.MNEMOSYNE_NO_EMBEDDINGS === undefined) delete process.env.MNEMOSYNE_NO_EMBEDDINGS;
    else process.env.MNEMOSYNE_NO_EMBEDDINGS = savedEnv.MNEMOSYNE_NO_EMBEDDINGS;
    rmSync(dataDir, { recursive: true, force: true });
  });

  const run = (command, args) => runMnemosyne(CLI, command, args, TIMEOUT);

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
    // apply() under a minimal host (no skills service) and the isolated env
    // wired into process.env; the config pins the resolved absolute CLI path
    // so execute() does not depend on PATH lookup.
    const { ctx, tools } = createMockCtx();
    apply(ctx, { cli: CLI });
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
});