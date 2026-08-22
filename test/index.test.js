import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import {
  apply,
  recallArgs,
  runMnemosyne,
  SKILL,
  storeArgs,
} from "../src/index.js";

/** Minimal cordis-style ctx: runs inject callbacks immediately, collects registrations. */
function createMockCtx() {
  const tools = [];
  const skills = [];
  const effects = [];
  const ctx = {
    get: (key) => (key === "skills" ? { register: (s) => skills.push(s) } : undefined),
    effect: (fn) => effects.push(fn()),
    inject: (deps, fn) => {
      assert.deepEqual(deps, ["tools"]);
      fn({
        effect: (fn) => {
          effects.push(fn());
          return () => {};
        },
        tools: { register: (def) => (tools.push(def), () => {}) },
      });
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
      /pip install mnemosyne-memory/
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
  });
});
